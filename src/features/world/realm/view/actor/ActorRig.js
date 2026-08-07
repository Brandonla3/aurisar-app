/**
 * ActorRig — one live actor: a root transform, the stage mesh under it, the
 * LOD tier that picks which stage, and the shadow-caster registration.
 *
 * ONE MESH PER ACTOR, and that is a budget commitment, not a simplification.
 * realmActorBudget.test.js spends `maxSimultaneousActors * 1` draw call
 * against whatever props leave of BUDGET_CEILINGS; slicing the payload's
 * per-mass vertex ranges into child nodes would multiply that by the mass
 * count (11 for orghon) and quietly invalidate a census that has already been
 * signed off. A SKELETON ADDS NO DRAW CALL — the bone palette rides the same
 * draw as a block of vertex uniforms (THE PIN, ActorSkeleton.js) — so the
 * census still stands with bones in it.
 *
 * ── THE SKELETON IS PER RIG, AND IT OUTLIVES EVERY MESH THIS RIG OWNS ───────
 *
 * `Mesh.clone()` copies the `skeleton` REFERENCE (a live engine fact, asserted
 * in ActorSkeleton.test.js), so a skeleton parked on ActorPrototypes' shared
 * master would be shared by every actor of that archetype: one guard raises an
 * arm and the whole faction raises one. `buildActorSkeleton` therefore runs
 * ONCE per ActorRig, at construction, and `_applyTier` RE-ATTACHES it to each
 * fresh clone. That re-attachment is not belt-and-braces: the master carries
 * no skeleton to copy, so a clone arrives with `skeleton === null` and would
 * render its bind pose forever — a character that walks around the world
 * without bending a joint.
 *
 * THE POSE IS RETAINED ACROSS A TIER SWAP. Bone state lives on the Skeleton,
 * and a swap rebuilds only the MESH, so an actor mid-stride that crosses the
 * 96 m band edge keeps its stride: no re-application, no bookkeeping, nothing
 * to forget. The rejected alternative — reset to rest and let the caller pose
 * again — would make the LOD boundary visible as a one-frame T-pose, the exact
 * class of artefact the hysteresis in `tierForDistance` exists to prevent.
 * ActorRigSkin.test.js asserts the palette is BYTE-IDENTICAL either side of a
 * forced swap, so "retained" is measured rather than reasoned.
 *
 * NO ANIMATION AND NO CLIPS — not even an idle bob. `setPose`/`rest` are the
 * whole motion surface, and they are absolute (ActorSkeleton.js): what drives
 * them over time is P9's.
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

import { ACTOR_POSE_MARGIN_M } from '../../model/actorEnvelope.js';
import { PROP_TIER, TIER_BANDS_M, TIER_HYST_M } from '../../model/propLod.js';
import { buildActorSkeleton } from './ActorSkeleton.js';

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

/**
 * Grow a live actor mesh's LOCAL bounding box by `ACTOR_POSE_MARGIN_M` on
 * every face, so the frustum culler tests a box a POSED actor still fits
 * inside. model/actorEnvelope.js carries the measurement, the headroom
 * argument and the P9 revisit trigger; this is only the application.
 *
 * ON THE CLONE, NOT ON THE MASTER, and that placement is a MEASURED ENGINE
 * FACT rather than a preference. Expanding the master looks like the obvious
 * one-write-serves-every-actor move — it is where the skinning buffers are
 * written, for exactly that reason — but `Mesh.clone()` does NOT copy the
 * source's `_boundingInfo`: it derives a fresh one from the shared geometry's
 * vertex extents. Measured on unbound near stage with a 0.35 m probe margin:
 * master reads min.x -0.7250 after `setBoundingInfo`, and its clone reads
 * -0.3750 — the untouched rest value. So the master version of this fix is
 * a silent no-op that reviews perfectly. Poking `geometry._extend` instead
 * fails the same way (`refreshBoundingInfo` re-derives it from the buffer).
 *
 * It STICKS, which is the other half of the question: measured across
 * parenting, `setEnabled`, the skeleton attach, `setPose`, two `scene.render`
 * passes and a moved root, the local box stays expanded and the WORLD box
 * tracks the world matrix (root at x=30 gives world min.x 29.275 = 30 - 0.725).
 * Babylon never recomputes it on its own; only an explicit
 * `refreshBoundingInfo()` would, and nothing here calls one.
 *
 * Called on every pass through `_applyTier`, not just the first, for the same
 * reason the skeleton re-attach is: each tier swap builds a NEW clone, and a
 * fresh clone arrives with the rest-pose box again.
 */
function expandForPose(mesh) {
  const { minimum, maximum } = mesh.getBoundingInfo();
  mesh.setBoundingInfo(new BABYLON.BoundingInfo(
    new BABYLON.Vector3(
      minimum.x - ACTOR_POSE_MARGIN_M,
      minimum.y - ACTOR_POSE_MARGIN_M,
      minimum.z - ACTOR_POSE_MARGIN_M,
    ),
    new BABYLON.Vector3(
      maximum.x + ACTOR_POSE_MARGIN_M,
      maximum.y + ACTOR_POSE_MARGIN_M,
      maximum.z + ACTOR_POSE_MARGIN_M,
    ),
  ));
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
    this._stage = -1;
    this._disposed = false;

    this.archetypeId = archetypeId;
    this._mesh = null;
    this._meta = null;
    this._tier = null;
    // RESOLVED FIRST, before anything is put in the scene. `metaFor` is where
    // an unknown archetype throws (via stageFor), and doing it here means the
    // failing constructor leaves behind no TransformNode and no Skeleton — the
    // latter would matter, because a Skeleton is scene-registered and is not
    // swept up by disposing a node tree.
    const { rig } = prototypes.metaFor(archetypeId, tier);
    this._root = new BABYLON.TransformNode(`actor_${name}`, scene);
    // ONE skeleton per actor, built before the first mesh so `_applyTier` —
    // the single place a mesh and a skeleton are married — never runs without
    // one. `rig` is the SAME object at every stage of an archetype
    // (ActorPrototypes hoists it out of its stage loop), so bone k means the
    // same joint whichever master this rig is currently cloning.
    this._skin = buildActorSkeleton(scene, rig, `actorSkel_${name}`);
    this._applyTier(tier);
  }

  /** The node the sim drives. Its position IS the ground-contact point. */
  get root() { return this._root; }

  /** The single live mesh — the one draw call, and the shadow caster. */
  get mesh() { return this._mesh; }

  /** The tier last resolved by update() (or the constructor's initial tier). */
  get tier() { return this._tier; }

  /**
   * The live stage's payload facts — `minY`, the counts, `massIndex`,
   * `pivots`, and the `rig` this actor's skeleton was built from.
   */
  get meta() { return this._meta; }

  /**
   * This actor's own `BABYLON.Skeleton`, shared with no other rig, `null` once
   * disposed. The mesh points at this exact object at every tier.
   */
  get skeleton() { return this._skin ? this._skin.skeleton : null; }

  /** Diagnostics: how many times this actor has rebuilt its mesh for LOD. */
  get swapCount() { return this._swaps; }

  /**
   * Pose the bones from a CANARY_POSE-shaped table
   * (`{boneIndex: {axis, angleRad}}`, unit axis, missing entries the
   * identity). ABSOLUTE, never incremental — see ActorSkeleton.js — and it
   * SURVIVES a tier swap, so the caller poses when the pose changes and not
   * once per rebuilt mesh. A no-op after dispose(), like update().
   *
   * P9 HANDOFF: this surface expresses ROTATIONS ONLY — there is no
   * translation channel anywhere in `{axis, angleRad}`. Ground (i) of
   * ActorSkeleton.js's `bone._matrix` rationale is precisely about translation
   * channels, so when P9 adds one it must EXTEND setPose (and keep writing
   * each local absolutely against `getRestMatrix()`) rather than reach past
   * this API to the bones; posing a translation any other way collapses the
   * argument that keeps the write correct. See ActorSkeleton.js's setPose.
   */
  setPose(pose) {
    if (!this._disposed) this._skin.setPose(pose);
    return this;
  }

  /** Every bone back to rest; the palette returns to bit-exact identity. */
  rest() {
    if (!this._disposed) this._skin.rest();
    return this;
  }

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
    // COMPARE THE RESOLVED STAGE, NOT THE TIER. These are not the same
    // question: `stageFor` clamps a tier to the archetype's last stage, and
    // with two stages both NEAR (0) and MID (1) already map onto themselves
    // — but the constructor accepts ANY tier (`opts.tier`, documented as
    // legal and used for a rig built far away), and props' FAR (2) clamps to
    // stage 1 exactly as MID does. So a rig constructed at FAR and first
    // updated at MID used to see `2 !== 1`, and pay a full clone + shadow
    // re-registration + dispose to arrive at the geometry it was already
    // rendering. Comparing stages makes that a no-op, and makes the swap
    // counter mean "the mesh really changed" — which is what
    // ActorRig.test.js reads it as.
    if (next !== this._tier) {
      const nextStage = this._protos.stageFor(this.archetypeId, next);
      if (nextStage === this._stage) this._tier = next;
      else this._applyTier(next);
    }
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
    // THE RE-ATTACHMENT, and it is load-bearing on EVERY pass through here,
    // not just the first: the master carries no skeleton, so the clone arrives
    // with `skeleton === null` and would render its bind pose for the rest of
    // the actor's life — moving through the world without bending a joint.
    // The skeleton object itself is untouched by the swap, which is what
    // carries the POSE across it (see the header).
    mesh.skeleton = this._skin.skeleton;
    // STATED, NOT INHERITED, and the difference is one engine detail wide.
    // `Mesh.clone()` copies the influence count from the master as a SNAPSHOT
    // — whatever the master holds AT CLONE TIME is what this mesh gets and
    // keeps, for any value (measured: 1 -> 1, 3 -> 3, 4 -> 4). So the master's
    // own `= 1` covers this line only for as long as the master still holds 1,
    // and a master whose count ever drifts — a pooled prototype table, a
    // diagnostics toggle, a Task 6 define-prep path that writes the field back
    // — would hand every actor cloned AFTERWARDS four bone-matrix blends per
    // vertex to reach the answer one gives. Silent 4x on vertex cost, no
    // visible fault, forever.
    //
    // Deleting this line turns ActorRigSkin.test.js's `the live mesh reads ONE
    // influence even when the MASTER says four` red, and nothing else — that
    // test perturbs the master after boot precisely so this line is killable
    // rather than merely correct. It also keeps the skeleton and the influence
    // count as ONE decision written in ONE place, which is the line above.
    mesh.numBoneInfluencers = 1;
    // Nothing in the Realm picks yet. Explicit rather than inherited so the
    // day something does, this line is the one to flip.
    mesh.isPickable = false;
    expandForPose(mesh);

    this._mesh = mesh;
    this._meta = meta;
    this._tier = tier;
    this._stage = meta.stage;
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
    // A Skeleton is SCENE-REGISTERED (`scene.skeletons`) and is NOT a Node, so
    // tearing down the mesh and the root leaves it behind entirely — one
    // orphan per actor ever spawned, each holding its bones and its palette.
    // Disposed AFTER the mesh, because the mesh is the thing pointing at it.
    this._skin.skeleton.dispose();
    this._skin = null;
    this._root.dispose();
  }
}
