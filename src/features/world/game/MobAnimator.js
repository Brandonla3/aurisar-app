/**
 * MobAnimator — per-mob presentation driver (docs/world-design-plan.md,
 * Batch A). The server owns mob AI/position/hp; this class owns everything
 * the client should *show* about a mob between row updates:
 *
 *  - Position smoothing toward the last server position (mobs previously
 *    teleported tile-to-tile at every row update — same easing as
 *    _lerpRemote, snap on >50 m instance jumps).
 *  - Velocity-derived facing (root yaw eases toward the movement heading).
 *  - Skeletal life via AnimationController when the mob's GLB ships clips
 *    (7 of the 8 mob GLBs do — the scene used to discard them), driven by
 *    the smoothed displacement speed.
 *  - Procedural fallback life for clipless visuals (wolf.glb and the
 *    primitive composites): idle bob, walk lean, per-mesh overlay hit
 *    flash (never material tints — mob materials are shared via _stdMat),
 *    and a fall-over death.
 *  - A proximity attack loop: the server sends no per-swing event, so a
 *    stationary mob in melee range of the local player winds up on its
 *    own attack cadence. Purely cosmetic; damage stays server-side.
 *  - suspend()/resume() distance gating driven by the scene (per-tier
 *    animating-mob caps — see BabylonWorldScene._updateMobs).
 *
 * Death: playDeath() returns a play-out duration; the scene defers the
 * actual dispose (see _removeMob) so kills read as kills, not vanishings.
 */

/* global BABYLON */

import { AnimationController } from './AnimationController.js';

/**
 * mobType → semantic clip names inside that type's GLB (exact-suffix
 * matches; see AnimationController.resolveClips). Authored against the
 * clip inventories actually shipped in public/assets/mobs/*.glb — the
 * mobClips test asserts this table stays truthful.
 *
 * wolf.glb ships NO clips (design-plan Batch C replaces it); forest_wolf /
 * old_greyjaw / legacy wolf are deliberately absent here and take the
 * procedural fallback. tribal/glubevolved are flying-creature rigs shared
 * by bandit/murloc — goofy but alive; Batch C recasts the bandit.
 */
export const MOB_CLIPS = {
  wild_boar: {
    idle: 'Idle', walk: 'Walk', run: 'Gallop',
    attack: 'Attack_Headbutt', hit: 'Idle_HitReact_Left', death: 'Death',
  },
  webwood_spider: {
    idle: 'Spider_Idle', walk: 'Spider_Walk', run: 'Spider_Walk',
    attack: 'Spider_Attack', hit: null, death: 'Spider_Death',
  },
  mudfin_murloc: {
    idle: 'Flying_Idle', walk: 'Fast_Flying', run: 'Fast_Flying',
    attack: 'Punch', hit: 'HitReact', death: 'Death',
  },
  tunnel_rat: {
    idle: 'Idle', walk: 'Walk', run: 'Run',
    attack: 'Attack', hit: 'HitRecieve', death: 'Death',
  },
  vale_bandit: {
    idle: 'Flying_Idle', walk: 'Fast_Flying', run: 'Fast_Flying',
    attack: 'Punch', hit: 'HitReact', death: 'Death',
  },
  restless_bones: {
    idle: 'Idle', walk: 'Walking_A', run: 'Running_A',
    attack: '1H_Melee_Attack_Slice_Diagonal', hit: 'Hit_A', death: 'Death_A',
  },
  gorrak: {
    idle: 'Idle', walk: 'Walk', run: 'Walk',
    attack: 'Bite_Front', hit: 'HitRecieve', death: 'Death',
  },
};

const HIT_FLASH_MS = 150;
const MELEE_RANGE_SQ = 3.2 * 3.2;   // slightly over the 3.0 attack range
const FALL_DEATH_MS = 900;

export class MobAnimator {
  /**
   * @param {Object} entry  the scene's mob entry ({ root, visual })
   * @param {Object} opts
   * @param {string}  opts.mobType
   * @param {Array}  [opts.animGroups]      groups from the GLB instantiate
   * @param {number} [opts.moveSpeedMps]    MobDef.moveSpeedMps (chase speed)
   * @param {number} [opts.attackSpeedSec]  MobDef.attackSpeedSec (cadence)
   */
  constructor(entry, { mobType, animGroups, moveSpeedMps = 4.0, attackSpeedSec = 2.0 } = {}) {
    this._root = entry.root;
    this._visual = entry.visual;
    const clips = MOB_CLIPS[mobType];
    this._ctl = clips && animGroups?.length
      ? new AnimationController(animGroups, clips, {
          // Chasing (full moveSpeed) reads as run; the AI's amble as walk.
          runThresholdMps: moveSpeedMps * 0.72,
          walkRefMps: 1.5,
          runRefMps: moveSpeedMps,
        })
      : null;

    this._attackIntervalMs = Math.max(900, attackSpeedSec * 1000);
    this._attackCdMs = 0;

    this._targetX = this._root.position.x;
    this._targetZ = this._root.position.z;
    this._speedMps = 0;
    this._bobT = Math.random() * Math.PI * 2; // desync fallback bobs
    this._flashMs = 0;
    this._dyingMs = -1;
    this._meshes = null; // lazy — overlay flash targets
    this._suspended = false;
  }

  /** New authoritative server position (world units). */
  setTarget(x, z) {
    this._targetX = x;
    this._targetZ = z;
  }

  /** Hit reaction: clip if the rig has one, overlay flash otherwise. */
  onHit() {
    if (this._dyingMs >= 0) return;
    if (this._ctl?.has('hit') && !this._suspended) {
      this._ctl.playOneShot('hit');
    } else {
      this._flash();
    }
  }

  /**
   * Begin the death play-out. Returns how long the caller should wait
   * before disposing the root (ms).
   */
  playDeath() {
    if (this._dyingMs >= 0) return FALL_DEATH_MS;
    if (this._ctl?.has('death')) {
      this._dyingMs = 0;
      this._deathClip = true;
      return Math.max(600, this._ctl.playDeath());
    }
    // Fallback: fall over sideways and sink, driven from update().
    this._dyingMs = 0;
    this._deathClip = false;
    return FALL_DEATH_MS;
  }

  /** Distance gating (scene-driven). Position smoothing keeps running so
   *  a gated mob is still WHERE the server says; only animation stops. */
  setSuspended(on) {
    if (on === this._suspended) return;
    this._suspended = on;
    if (this._ctl) (on ? this._ctl.suspend() : this._ctl.resume());
  }

  /**
   * Per-frame update. ctx: { playerX, playerZ, groundYFor }.
   * Returns nothing; mutates root/visual.
   */
  update(dtMs, ctx) {
    const p = this._root.position;

    // Death play-out owns the visual once started.
    if (this._dyingMs >= 0) {
      this._dyingMs += dtMs;
      if (!this._deathClip) {
        const t = Math.min(1, this._dyingMs / FALL_DEATH_MS);
        const e = t * (2 - t); // ease-out
        this._visual.rotation.z = e * (Math.PI / 2);
        this._visual.position.y = -e * 0.35;
      }
      return;
    }

    // ── Position smoothing (always, even suspended) ──
    const jx = this._targetX - p.x;
    const jz = this._targetZ - p.z;
    const jumpSq = jx * jx + jz * jz;
    let dx = 0, dz = 0;
    if (jumpSq > 2500) {
      // >50 m = instance/teleport jump — snap, don't sweep.
      p.x = this._targetX;
      p.z = this._targetZ;
    } else if (jumpSq > 1e-6) {
      const f = 1 - Math.pow(0.04, dtMs / 100);
      dx = jx * f;
      dz = jz * f;
      p.x += dx;
      p.z += dz;
    }
    p.y = ctx.groundYFor(p.x, p.z, p.y);

    // ── Facing: ease yaw toward the movement heading ──
    const dist = Math.hypot(dx, dz);
    const raw = dtMs > 0 ? dist / (dtMs / 1000) : 0;
    this._speedMps += (raw - this._speedMps) * Math.min(1, dtMs / 120);
    if (this._speedMps > 0.3 && dist > 1e-4) {
      const target = Math.atan2(dx, dz);
      let diff = target - this._root.rotation.y;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      this._root.rotation.y += diff * Math.min(1, dtMs / 130);
    }

    if (this._suspended) return;

    // ── Skeletal or fallback life ──
    if (this._ctl) {
      this._ctl.setLocomotionSpeed(this._speedMps);
      this._ctl.update(dtMs);
    } else {
      this._fallbackLife(dtMs);
    }

    // ── Cosmetic attack wind-up when parked in melee range ──
    this._attackCdMs -= dtMs;
    if (this._attackCdMs <= 0 && this._speedMps < 0.4) {
      const ax = ctx.playerX - p.x;
      const az = ctx.playerZ - p.z;
      if (ax * ax + az * az < MELEE_RANGE_SQ) {
        this._attackCdMs = this._attackIntervalMs;
        if (this._ctl?.has('attack')) {
          this._ctl.playOneShot('attack');
        } else {
          // Fallback lunge: brief forward pitch, decays in _fallbackLife.
          this._lungeMs = 220;
        }
      }
    }
  }

  // Idle bob / walk lean / lunge / flash decay for clipless visuals.
  _fallbackLife(dtMs) {
    this._bobT += dtMs * 0.004;
    const moving = this._speedMps > 0.3;
    const bobAmp = moving ? 0.05 : 0.02;
    const bobHz = moving ? 2.2 : 1.0;
    this._visual.position.y = Math.abs(Math.sin(this._bobT * bobHz)) * bobAmp;
    const targetLean = moving ? 0.06 : 0;
    this._visual.rotation.x += (targetLean - this._visual.rotation.x) * Math.min(1, dtMs / 150);

    if (this._lungeMs > 0) {
      this._lungeMs -= dtMs;
      this._visual.rotation.x = 0.28 * Math.sin(Math.PI * Math.max(0, this._lungeMs) / 220);
    }
    if (this._flashMs > 0) {
      this._flashMs -= dtMs;
      if (this._flashMs <= 0) this._setOverlay(false);
    }
  }

  _flash() {
    this._flashMs = HIT_FLASH_MS;
    this._setOverlay(true);
  }

  _setOverlay(on) {
    if (!this._meshes) {
      this._meshes = this._visual.getChildMeshes ? this._visual.getChildMeshes(false) : [];
    }
    for (const mesh of this._meshes) {
      mesh.renderOverlay = on;
      if (on) {
        mesh.overlayColor = mesh.overlayColor ?? new BABYLON.Color3(1, 0.25, 0.2);
        mesh.overlayAlpha = 0.55;
      }
    }
  }

  dispose() {
    this._ctl?.dispose();
    this._meshes = null;
  }
}
