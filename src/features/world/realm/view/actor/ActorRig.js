/**
 * ActorRig — one live actor: a root transform, the stage mesh under it, the
 * LOD tier that picks which stage, and the shadow-caster registration.
 *
 * ONE MESH PER ACTOR, and that is a budget commitment, not a simplification.
 * realmActorBudget.test.js spends `maxSimultaneousActors * 1` draw call
 * against whatever props leave of BUDGET_CEILINGS; slicing the payload's
 * per-mass vertex ranges into child nodes would multiply that by the mass
 * count (11 for orghon) and quietly invalidate a census that has already been
 * signed off. `massIndex` and `pivots` therefore ride along on
 * ActorPrototypes.metaFor() as inert DATA for P7's skinning, and nothing here
 * reads them.
 *
 * NO ANIMATION, NO SKINNING, NO VERTEX DEFORMATION — not even an idle bob.
 * This phase ships static rigs; motion is P9's, bones are P7's, and putting
 * either here would bake a rig decision into the phase that measures
 * silhouettes.
 *
 * NEVER freezeWorldMatrix(). PropStreamer freezes its carriers and is right
 * to — a prop chunk's world matrix is identity forever and the instance
 * matrices carry the world. An actor's whole job is to move, and a frozen
 * matrix would pin it wherever it was first drawn while every other system
 * (camera focus, shadow bucketing, the sim) went on believing it had walked
 * away. ActorRig.test.js proves the absence behaviourally: move the root,
 * recompute, and the mesh's absolutePosition must follow.
 *
 * GROUND SEATING, and the residual it cannot remove. The root sits at the
 * actor's ground-contact point — `seatOn(x, groundY, z)` takes the terrain
 * height directly — and the mesh hangs at a local `-minY` so the payload's
 * LOWEST VERTEX lands exactly on `groundY`. That correction is per STAGE,
 * because minY is not stage-invariant: a capped foot's near stage (icosphere
 * level 2) reaches slightly BELOW the authored sole plane while its far stage
 * (level 1) reaches only 0.851r down and stops slightly above it. Measured
 * across the roster: near -0.010..0.000, far 0.000..+0.011. Seating by the
 * live stage's own minY is what stops a near actor standing 5-10 mm into the
 * ground.
 *
 * What survives is the DIFFERENCE: swapping tier translates the body by
 * minY(near) - minY(far), at worst 0.0211 m (orghon). The tier boundary is
 * 96 m away, where that subtends under a third of a pixel at 1080p, so it is
 * sub-pixel exactly where it happens. It is NOT fixed by sinking the feet
 * into the far-stage geometry: every band-occupancy measurement the phase's
 * exit-bar gate rests on (gen/actorSilhouette.test.js) is taken against this
 * geometry, and moving a vertex to hide a third of a pixel would move them.
 */

/* global BABYLON */

import { PROP_TIER, TIER_BANDS_M, TIER_HYST_M } from '../../model/propLod.js';

/**
 * Actors reuse props' NEAR/MID tier vocabulary and band edge deliberately: an
 * actor and the props around its feet dropping detail at DIFFERENT distances
 * is a seam a player can see, and one constant is the only way two systems
 * agree permanently. Only NEAR and MID are ever produced here — props' FAR
 * means "render nothing, the terrain tint covers it", which is a decision
 * about a chunk's vegetation field and not about a character. A FAR tier
 * arriving from anywhere still resolves safely: ActorPrototypes.stageFor
 * clamps it to the archetype's last stage.
 */
export function tierForDistance(distanceM, prevTier = null) {
  const edge = TIER_BANDS_M.nearMaxM;
  // Hysteresis, the same wider-exit-than-entry shape propLod, chunkMath and
  // shadowCadence all use: an actor jogging along the boundary must not
  // rebuild its mesh every frame.
  if (prevTier === PROP_TIER.NEAR) {
    return distanceM > edge + TIER_HYST_M ? PROP_TIER.MID : PROP_TIER.NEAR;
  }
  if (prevTier === PROP_TIER.MID) {
    return distanceM < edge - TIER_HYST_M ? PROP_TIER.NEAR : PROP_TIER.MID;
  }
  return distanceM <= edge ? PROP_TIER.NEAR : PROP_TIER.MID;
}

export class ActorRig {
  /**
   * @param {object} scene
   * @param {object} prototypes ActorPrototypes
   * @param {string} archetypeId throws here (via stageFor) if unknown, rather
   *   than at the first frame with an undefined master
   * @param {object} [opts]
   * @param {string} [opts.name] suffix for the node names; ids collide
   *   harmlessly in Babylon but not in a diagnostics readout
   * @param {object} [opts.shadowRig] ActorShadowRig — optional, so an actor
   *   can exist in a scene with no sun (tests, headless sims)
   * @param {boolean} [opts.pinShadow] forwarded to addCaster's `pin`
   * @param {number} [opts.tier] the tier to build at before the first update()
   */
  constructor(scene, prototypes, archetypeId, {
    name = archetypeId,
    shadowRig = null,
    pinShadow = false,
    tier = PROP_TIER.NEAR,
  } = {}) {
    this._scene = scene;
    this._protos = prototypes;
    this._shadowRig = shadowRig;
    this._pinShadow = pinShadow;
    this._name = name;
    this._swaps = 0;
    this._disposed = false;

    this.archetypeId = archetypeId;
    this._root = new BABYLON.TransformNode(`actor_${name}`, scene);
    this._mesh = null;
    this._meta = null;
    this._tier = null;
    this._applyTier(tier);
  }

  /** The node the sim drives. Its position IS the ground-contact point. */
  get root() { return this._root; }

  /** The single live mesh — the one draw call, and the shadow caster. */
  get mesh() { return this._mesh; }

  /** The tier last resolved by update() (or the constructor's initial tier). */
  get tier() { return this._tier; }

  /**
   * The live stage's payload facts, including the untouched `massIndex` and
   * `pivots` P7 will read. Never consumed here.
   */
  get meta() { return this._meta; }

  /** Diagnostics: how many times this actor has rebuilt its mesh for LOD. */
  get swapCount() { return this._swaps; }

  /**
   * Seat the actor with its SOLE on `groundY` — pass terrainField.surfaceY(x, z)
   * straight in. The mesh's own local offset does the minY correction.
   */
  seatOn(x, groundY, z) {
    this._root.position.set(x, groundY, z);
    return this;
  }

  setYaw(yaw) {
    this._root.rotation.y = yaw;
    return this;
  }

  /**
   * Re-tier against a focus point — the camera's ORBIT TARGET, not the camera
   * itself, for the reason ActorShadowRig.update documents: an orbiting chase
   * camera changing radius must not re-tier every actor in the world.
   * @returns {number} the resolved tier
   */
  update(focusPos) {
    if (this._disposed) return this._tier;
    // absolutePosition, not .position — the root is unparented today, but the
    // moment anything parents it (a mount, a vehicle, a boarding platform)
    // .position becomes a local offset that measures from world origin. That
    // exact bug shipped once already, in ActorShadowRig.
    this._root.computeWorldMatrix(true);
    const p = this._root.absolutePosition;
    const distanceM = Math.hypot(p.x - focusPos.x, p.y - focusPos.y, p.z - focusPos.z);
    const next = tierForDistance(distanceM, this._tier);
    if (next !== this._tier) this._applyTier(next);
    return this._tier;
  }

  /**
   * Swap in the mesh for `tier`, re-seat it, and hand the shadow rig the NEW
   * mesh before the old one is disposed. Order is load-bearing: a disposed
   * mesh left registered as a caster would sit in the ShadowGenerator's
   * renderList forever, and the rig keys its bucket map by mesh identity.
   */
  _applyTier(tier) {
    const master = this._protos.masterFor(this.archetypeId, tier);
    const meta = this._protos.metaFor(this.archetypeId, tier);
    const previous = this._mesh;

    const mesh = master.clone(`actor_${this._name}_s${meta.stage}_${this._swaps}`);
    mesh.parent = this._root;
    // The seat: local -minY puts the payload's lowest vertex on the root's own
    // Y, which seatOn() has already put on the terrain. See the header for the
    // sub-pixel residual this deliberately does not chase.
    mesh.position.set(0, -meta.minY, 0);
    // A clone inherits the master's DISABLED state (the same reason
    // PropStreamer re-enables its carriers); without this the actor is a
    // perfectly correct mesh that never draws.
    mesh.setEnabled(true);
    mesh.useVertexColors = true;
    mesh.receiveShadows = true;
    // Nothing in the Realm picks yet. Explicit rather than inherited so the
    // day something does, this line is the one to flip.
    mesh.isPickable = false;

    this._mesh = mesh;
    this._meta = meta;
    this._tier = tier;
    if (previous) this._swaps++;

    if (this._shadowRig) {
      this._shadowRig.addCaster(mesh, { pin: this._pinShadow });
      if (previous) this._shadowRig.removeCaster(previous);
    }
    if (previous) previous.dispose(false, false);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._shadowRig && this._mesh) this._shadowRig.removeCaster(this._mesh);
    this._mesh?.dispose(false, false);
    this._mesh = null;
    this._root.dispose();
  }
}
