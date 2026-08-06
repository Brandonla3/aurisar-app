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
 * Deliberately free of the BABYLON global itself — it only calls methods on
 * ActorPrototypes/ActorRig, which are the layer that actually touches the
 * engine.
 */

import { ActorPrototypes } from './ActorPrototypes.js';
import { ActorRig } from './ActorRig.js';

/** Distinct from each other and from PLAYER_ARCHETYPE — see the header. */
const PLAYER_ARCHETYPE = 'unbound';
const DEMO_ARCHETYPES = Object.freeze(['legion', 'orghon']);

/** The exact world positions P4c's temporary sentinel boxes stood at. */
const DEMO_POSITIONS = Object.freeze([
  { x: 150, z: 0 },
  { x: -200, z: 150 },
]);

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
      return rig;
    });
  }

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
