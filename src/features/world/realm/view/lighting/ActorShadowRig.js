/**
 * ActorShadowRig — dynamic actor/prop shadows, amortized over TIME not SPACE.
 *
 * Two ordinary BABYLON.ShadowGenerator instances instead of one
 * CascadedShadowGenerator recomputing every split every frame: a near
 * generator that stays always-fresh (Babylon's own default refreshRate, 1)
 * for whatever sits close to the camera focus point, and a far generator
 * whose refreshRate is throttled (model/shadowCadence.js's
 * FAR_REFRESH_RATE), amortizing cost across several frames instead of a
 * second spatial cascade split. "Near"/"far" here means distance from the
 * camera FOCUS point, not the camera itself, and has nothing to do with
 * terrain — terrain's own self-shadow (model/terrainField.js's
 * shadeProxyAt) is a completely separate, static, baked system; this rig
 * only ever casts from things that move.
 *
 * Every caster is re-bucketed every update() call through
 * classifyShadowCadence's pure hysteresis policy, so an actor orbiting near
 * the boundary distance does not thrash between generators every frame —
 * that churn (removeShadowCaster + addShadowCaster) would itself cost more
 * than either generator's throttle saves.
 *
 * The far light is a SEPARATE DirectionalLight, intensity 0 (shadow-only —
 * it must never double-light the scene the way the real sun light does),
 * cloned from the real sun's direction at construction and re-synced every
 * update() call. Two ShadowGenerators cannot share one light's shadow map,
 * which is the entire reason a second light exists at all.
 *
 * `RenderTargetTexture.refreshRate`'s setter resets its internal frame
 * counter on ANY write, even to the SAME value — so a naive per-frame
 * assignment would silently force full-cost every-frame rendering again,
 * defeating the whole throttle. This rig sidesteps the hazard entirely by
 * setting each generator's refreshRate exactly ONCE, at construction, and
 * never touching it again. If a future perf governor needs the far rate to
 * change dynamically, guard that write with a value-changed check — do not
 * assign it unconditionally on a per-frame path.
 */

/* global BABYLON */

import { classifyShadowCadence, refreshRateForBucket } from '../../model/shadowCadence.js';

export class ActorShadowRig {
  /**
   * @param {object} scene
   * @param {object} sunLight the scene's real directional light — read for
   *   direction only, never written.
   * @param {object} [opts] { mapSize, nearRadiusM, hysteresisM }
   */
  constructor(scene, sunLight, {
    mapSize = 1024,
    nearRadiusM,
    hysteresisM,
  } = {}) {
    this._scene = scene;
    this._sunLight = sunLight;
    this._policyOpts = { nearRadiusM, hysteresisM };

    this._farLight = new BABYLON.DirectionalLight(
      'actorShadowFarLight', sunLight.direction.clone(), scene,
    );
    this._farLight.intensity = 0; // shadow-only — never lights the scene

    this._nearGen = new BABYLON.ShadowGenerator(mapSize, sunLight);
    this._farGen = new BABYLON.ShadowGenerator(mapSize, this._farLight);
    // Set exactly once — see the module doc comment on why this never
    // happens again on any per-frame path.
    this._nearGen.getShadowMap().refreshRate = refreshRateForBucket('near');
    this._farGen.getShadowMap().refreshRate = refreshRateForBucket('far');

    /** mesh -> { bucket: 'near'|'far'|null, pinned: boolean } */
    this._casters = new Map();
  }

  /**
   * Register a mesh as a shadow-casting, camera-focus-relative actor. It
   * starts unbucketed and is classified on the next update() call.
   * @param {object} mesh
   * @param {{pin?: boolean}} [opts] pin: true force-keeps this caster in the
   *   near (always-fresh) bucket regardless of distance — e.g. a future
   *   combat system pinning the player's current target. Not driven by
   *   anything in this codebase yet; the hook exists because
   *   classifyShadowCadence's design doc names it as the direct fix for the
   *   sharpest failure mode (a stale shadow on whatever the player is
   *   fighting), and threading it through later would mean revisiting every
   *   call site instead of just flipping a flag.
   */
  addCaster(mesh, { pin = false } = {}) {
    this._casters.set(mesh, { bucket: null, pinned: pin });
    mesh.receiveShadows = true;
  }

  removeCaster(mesh) {
    const entry = this._casters.get(mesh);
    if (!entry) return;
    if (entry.bucket === 'near') this._nearGen.removeShadowCaster(mesh);
    if (entry.bucket === 'far') this._farGen.removeShadowCaster(mesh);
    this._casters.delete(mesh);
  }

  /**
   * @param {{x: number, y: number, z: number}} focusPos the camera's orbit
   *   target, NOT the camera's own position — an orbiting chase camera
   *   changing radius must not itself flip every actor's bucket the way a
   *   camera-position-relative measure would.
   */
  update(focusPos) {
    this._farLight.direction.copyFrom(this._sunLight.direction);

    for (const [mesh, entry] of this._casters) {
      const targetBucket = entry.pinned ? 'near' : this._classify(mesh, entry.bucket, focusPos);
      if (targetBucket !== entry.bucket) {
        this._moveCaster(mesh, entry.bucket, targetBucket);
        entry.bucket = targetBucket;
      }
    }
  }

  _classify(mesh, prevBucket, focusPos) {
    // absolutePosition, NOT .position — a caster parented to a TransformNode
    // (e.g. the spike's player capsule, parented to playerRoot) has a
    // .position that is its LOCAL offset from that parent and never changes
    // as the parent moves, which silently measured distance from world
    // origin instead of from the actual actor — caught live in the browser
    // (a player who had walked 290m still read world-origin-relative and
    // classified 'far' despite the camera focus sitting 1.5m away). Forcing
    // the world matrix recompute here removes any dependency on where in the
    // frame this runs relative to Babylon's own matrix-update pass.
    mesh.computeWorldMatrix(true);
    const p = mesh.absolutePosition;
    const distanceM = Math.hypot(
      p.x - focusPos.x,
      p.y - focusPos.y,
      p.z - focusPos.z,
    );
    return classifyShadowCadence(distanceM, prevBucket, this._policyOpts);
  }

  _moveCaster(mesh, fromBucket, toBucket) {
    if (fromBucket === 'near') this._nearGen.removeShadowCaster(mesh);
    if (fromBucket === 'far') this._farGen.removeShadowCaster(mesh);
    const gen = toBucket === 'near' ? this._nearGen : this._farGen;
    gen.addShadowCaster(mesh);
  }

  /** For diagnostics/tests: the bucket a registered caster currently sits in. */
  bucketOf(mesh) {
    return this._casters.get(mesh)?.bucket ?? null;
  }

  dispose() {
    this._nearGen.dispose();
    this._farGen.dispose();
    this._farLight.dispose();
    this._casters.clear();
  }
}
