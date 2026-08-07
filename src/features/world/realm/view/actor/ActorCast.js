/**
 * ActorCast — the actor roster the dev spike drives: the player, plus a
 * small cast of static demo actors standing at distance.
 *
 * Exists so spike.js's contribution to this phase is construction plus one
 * per-frame call. spike.js is capped at 400 lines by boundary.test.js and
 * had no headroom left to build a shared actor material, four (archetype,
 * stage) masters, and several live rigs inline — that work moved here.
 *
 * The two demo actors are what P4c's `sentinelAt` boxes stood in for: their
 * comment said "delete both the moment a real distant actor exists" — this
 * is that moment. They sit at the SAME two world positions the sentinels
 * used, of DIFFERENT archetypes from each other and from the player, so
 * walking up to one is the live demonstration of the phase's exit bar: its
 * LOD tier steps up to NEAR and a real shadow switches on; walk away and
 * both switch off.
 *
 * ── TASK 7: A POSED ACTOR, LIVE ─────────────────────────────────────────────
 *
 * `demoActors[POSED_DEMO_INDEX]` (legion) is bent into `CANARY_POSE.legion`
 * ONCE, HERE, AT CONSTRUCTION — never per frame. This phase ships static
 * poses only; a clock driving the bones is P9's (ActorRig.js's `setPose`
 * doc says the same). The player and the OTHER demo actor (orghon) are left
 * at rest deliberately: nothing anywhere calls their skeleton's `setPose`,
 * so their palettes stay bit-identical to `rest()`, and it is the CONTRAST
 * — one archetype standing bent next to two standing straight — that is the
 * live demonstration a real GPU can skin a mesh at all.
 *
 * AND IT IS NOT A WALK, because no rig in this roster can express one. The
 * derivation is `model/actorRig.js`'s header, under "ONE BONE PER CAP PIVOT":
 * a pivot joining N masses spawns exactly ONE bone owning every mass beyond
 * it, "so legs move as a pair". Both unbound and legion put `{legL, legR}` on
 * a single bone (bone 1 on each, re-derived from `buildActorRig` rather than
 * taken on trust), which makes independent legs a GENOME change and a P9
 * carry-forward, not a P7 omission. A CANARY_POSE-derived stance sidesteps it
 * entirely: the canary poses every non-root bone by construction and asks
 * nothing of leg independence.
 *
 * Legion, not orghon, is the one posed: `DEMO_POSITIONS[0]` (150, 0) is
 * closer to spawn than `DEMO_POSITIONS[1]` (-200, 150) — `hypot(150,0) = 150`
 * vs `hypot(200,150) = 250` — so it is the demo actor a fresh session walks
 * up to FIRST, and Task 8's GPU verification wants the posed actor to be the
 * one already in frame, not the second one a tester has to go find.
 *
 * The pose used is `CANARY_POSE.legion` UNSCALED, not a hand-tuned or scaled
 * variant, on purpose: it is the exact table `ActorSkeleton.test.js`,
 * `ActorRigSkin.test.js` and `gen/actorSealPose.test.js` already measure
 * against, so a real GPU rendering it correctly corroborates the SAME
 * numbers those headless gates already trust, rather than putting an
 * unvetted pose on screen for the first time here. `model/actorCanary.js`'s
 * header documents its own floor for whether this reads at all — every mass
 * has a surface vertex moving at least 0.0288 m, legion's own worst (yokeL)
 * at 0.0340 m — which is plenty at the NEAR-tier range this actor is built
 * to be walked up to.
 *
 * Deliberately free of the BABYLON global itself — it only calls methods on
 * ActorPrototypes/ActorRig, which are the layer that actually touches the
 * engine.
 */

import { ActorPrototypes } from './ActorPrototypes.js';
import { ActorRig } from './ActorRig.js';
import { CANARY_POSE } from '../../model/actorCanary.js';

/** Distinct from each other and from PLAYER_ARCHETYPE — see the header. */
const PLAYER_ARCHETYPE = 'unbound';
const DEMO_ARCHETYPES = Object.freeze(['legion', 'orghon']);

/** The exact world positions P4c's temporary sentinel boxes stood at. */
const DEMO_POSITIONS = Object.freeze([
  { x: 150, z: 0 },
  { x: -200, z: 150 },
]);

/**
 * Index into `demoActors`/`DEMO_ARCHETYPES` of the one demo actor posed at
 * construction — see the header's "TASK 7" section for which archetype this
 * resolves to today (legion) and why.
 */
const POSED_DEMO_INDEX = 0;

export class ActorCast {
  /**
   * @param {object} scene
   * @param {object} opts
   * @param {object} opts.material the built actor NodeMaterial (actorNME.js)
   * @param {object} opts.field terrainField — read once here to seat the
   *   static demo actors; the player is seated every frame from the walker
   *   in update() instead.
   * @param {object} [opts.shadowRig] ActorShadowRig — forwarded to every
   *   rig's own `shadowRig` option so each registers itself at construction.
   *   Optional so a cast can exist with no sun (tests, headless sims).
   */
  constructor(scene, { material, field, shadowRig = null }) {
    this._protos = new ActorPrototypes(scene, material);
    this._disposed = false;

    /** The live actor integrateWalker drives. */
    this.player = new ActorRig(scene, this._protos, PLAYER_ARCHETYPE, {
      name: 'player',
      shadowRig,
    });

    /** Static demo actors — see the header for what they are standing in for. */
    this.demoActors = DEMO_ARCHETYPES.map((archetypeId, i) => {
      const rig = new ActorRig(scene, this._protos, archetypeId, {
        name: `demo_${archetypeId}`,
        shadowRig,
      });
      const { x, z } = DEMO_POSITIONS[i];
      rig.seatOn(x, field.surfaceY(x, z), z);
      // POSED ONCE, HERE, AT CONSTRUCTION — see the header's "TASK 7"
      // section for which index this is and why. Every other rig (the
      // player, and this loop's other iteration) is left untouched, so its
      // skeleton stays at the rest palette `buildActorSkeleton` starts it at.
      if (i === POSED_DEMO_INDEX) rig.setPose(CANARY_POSE[archetypeId]);
      return rig;
    });
  }

  /**
   * The one demo actor posed into a static bent stance at construction —
   * see the header. Exposed as its own getter (rather than making callers
   * index `demoActors[0]`) so Task 8's GPU verification, and anything typed
   * at `window.__realmSpike.actorCast` in a browser console, can reach the
   * posed rig, its `.skeleton`, and its `.setPose()`/`.rest()` without first
   * having to know which index this file currently picks.
   */
  get posedDemo() { return this.demoActors[POSED_DEMO_INDEX]; }

  /**
   * One call per rendered frame: seat and face the player from the walker's
   * state, then re-tier every actor — player AND the static demo actors —
   * against the same focus point. The demo actors never move, but their
   * DISTANCE to a moving focus does, so they still need re-tiering every
   * frame to ever step up to NEAR as the player approaches.
   * @param {{x: number, y: number, z: number, yaw: number}} walker
   * @param {{x: number, y: number, z: number}} focusPos the camera's orbit
   *   target — see ActorRig.update / ActorShadowRig.update for why not the
   *   camera itself.
   */
  update(walker, focusPos) {
    if (this._disposed) return;
    this.player.seatOn(walker.x, walker.y, walker.z);
    this.player.setYaw(walker.yaw);
    this.player.update(focusPos);
    for (const rig of this.demoActors) rig.update(focusPos);
  }

  /** Release every rig, then the shared masters. Idempotent. */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.player.dispose();
    for (const rig of this.demoActors) rig.dispose();
    this.demoActors = [];
    this._protos.dispose();
  }
}
