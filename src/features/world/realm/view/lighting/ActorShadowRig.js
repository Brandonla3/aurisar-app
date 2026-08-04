/**
 * ActorShadowRig — real-time shadows for whatever is close to the player.
 *
 * ONE ordinary BABYLON.ShadowGenerator on the scene's REAL sun light. Every
 * registered caster is re-bucketed every update() call through
 * model/shadowCadence.js's pure hysteresis policy: 'near' (within the
 * camera-focus radius) is added to the shadow map and casts a real shadow
 * every frame; 'far' is removed and casts NO shadow at all. Cost scales with
 * how many actors are actually near the player, not with total actor count —
 * an actor orbiting near the boundary distance does not thrash in and out of
 * the shadow map every frame (that churn would cost more than skipping
 * distant casters saves).
 *
 * PRIOR DESIGN, REVERTED: an earlier version ran a SECOND ShadowGenerator on
 * a second, shadow-only light for the far bucket, throttling its refresh
 * rate instead of dropping it — "amortize over time, not space." Caught in
 * PR review as architecturally broken: shadows are per-light. Removing a
 * caster from the KEY light's shadow map when it goes 'far' means it stops
 * casting the SUN's shadow, full stop — the far light (intensity 0, so it
 * never illuminates anything) contributed no real located shadow, only a
 * dilution artifact from Babylon averaging its per-material shadow term
 * across every active light regardless of intensity. A correct amortized-
 * far-shadow design needs either a real CascadedShadowGenerator with genuine
 * per-cascade refresh control, or custom sampling of a second map into the
 * key light's own attenuation — both out of scope here. This is the honest
 * version: near actors get a real shadow, far actors get none, until one of
 * those exists.
 *
 * `RenderTargetTexture.refreshRate`'s setter resets its internal frame
 * counter on ANY write, even to the SAME value — not relevant to THIS
 * design (nothing here ever touches refreshRate; the single generator stays
 * at Babylon's own default of "every frame" for the whole rig's lifetime),
 * but recorded here because it was the reason the reverted design's own
 * far-generator throttle was written defensively. If a future change
 * reintroduces a second, throttled map, that gotcha applies again.
 */

/* global BABYLON */

import { classifyShadowCadence } from '../../model/shadowCadence.js';

export class ActorShadowRig {
  /**
   * @param {object} scene
   * @param {object} sunLight the scene's real directional light — read for
   *   nothing here beyond being the ShadowGenerator's light; never mutated.
   * @param {object} [opts] { mapSize, nearRadiusM, hysteresisM }
   */
  constructor(scene, sunLight, {
    mapSize = 1024,
    nearRadiusM,
    hysteresisM,
  } = {}) {
    this._scene = scene;
    this._policyOpts = { nearRadiusM, hysteresisM };
    this._generator = new BABYLON.ShadowGenerator(mapSize, sunLight);

    /** mesh -> { bucket: 'near'|'far'|null, pinned: boolean } */
    this._casters = new Map();
  }

  /**
   * Register a mesh as a shadow-casting, camera-focus-relative actor. It
   * starts unbucketed and is classified on the next update() call.
   * @param {object} mesh
   * @param {{pin?: boolean}} [opts] pin: true force-keeps this caster 'near'
   *   (always casting) regardless of distance — e.g. a future combat system
   *   pinning the player's current target. Not driven by anything in this
   *   codebase yet; the hook exists because classifyShadowCadence's design
   *   doc names it as the direct fix for the sharpest failure mode (a
   *   shadow disappearing off whatever the player is fighting), and
   *   threading it through later would mean revisiting every call site
   *   instead of just flipping a flag.
   */
  addCaster(mesh, { pin = false } = {}) {
    this._casters.set(mesh, { bucket: null, pinned: pin });
    mesh.receiveShadows = true;
  }

  removeCaster(mesh) {
    const entry = this._casters.get(mesh);
    if (!entry) return;
    if (entry.bucket === 'near') this._generator.removeShadowCaster(mesh);
    this._casters.delete(mesh);
  }

  /**
   * @param {{x: number, y: number, z: number}} focusPos the camera's orbit
   *   target, NOT the camera's own position — an orbiting chase camera
   *   changing radius must not itself flip every actor's bucket the way a
   *   camera-position-relative measure would.
   */
  update(focusPos) {
    for (const [mesh, entry] of this._casters) {
      const targetBucket = entry.pinned ? 'near' : this._classify(mesh, entry.bucket, focusPos);
      if (targetBucket !== entry.bucket) {
        if (targetBucket === 'near') this._generator.addShadowCaster(mesh);
        // Only remove if it was actually registered — a fresh caster's first
        // classification (prevBucket null) going straight to 'far' has never
        // been added to the generator. Babylon's removeShadowCaster is a
        // harmless no-op either way, but calling it with no reason to is not.
        else if (entry.bucket === 'near') this._generator.removeShadowCaster(mesh);
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

  /** For diagnostics/tests: the bucket a registered caster currently sits in. */
  bucketOf(mesh) {
    return this._casters.get(mesh)?.bucket ?? null;
  }

  dispose() {
    this._generator.dispose();
    this._casters.clear();
  }
}
