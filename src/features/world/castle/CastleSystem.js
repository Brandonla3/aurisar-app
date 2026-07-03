/**
 * CastleSystem — Castle Ashwood's scene system.
 *
 * Owns both halves of the castle:
 *  - the EXTERIOR shell standing on the overworld terrain at the plan's
 *    site (always enabled, casts CSM shadows, glowing windows), and
 *  - the INTERIOR instance built in the flat far-east interiors region
 *    (enabled only while the local player is inside).
 *
 * The two are linked only by the press-E door teleport. enterInterior()/
 * exitInterior() are the ONLY teleport paths — SEAM:enter-reducer — v2
 * replaces their bodies with a server-authoritative enterDungeon(instanceId)
 * reducer call and group gating.
 *
 * Lifecycle follows the PropsSystem convention: constructed next to the
 * other systems, init() builds asynchronously (chunked per level so first
 * render never blocks), dispose() tears everything down.
 */

/* global BABYLON */

import {
  CASTLE_PLAN, LEVELS, INTERIOR_ANCHOR, ENTRY, buildLightAnchors,
} from './castlePlan.js';
import { buildNav } from './castleNav.js';
import { createCastleMaterials } from './builders/materials.js';
import { createCollector, mergeCollector } from './builders/mergeUtil.js';
import { createFloorSlabs, createRoom, createWallsForLevel, dressStructuralRooms } from './builders/rooms.js';
import { createAllStaircases } from './builders/staircase.js';
import { createAllFurniture } from './builders/furniture.js';
import { createFixturesFromAnchors } from './builders/fixtures.js';
import { createCastleExterior } from './builders/exterior.js';
import { CastleLightPool } from './CastleLightPool.js';
import { hash2 } from '../worldgen/rng.js';

const ENTER_DIST_SQ = 3.2 * 3.2;
const EXIT_PROMPT_DIST_SQ = 3.2 * 3.2;
const LEAVE_DIST_SQ = 4.8 * 4.8;   // hysteresis
const PROX_MS = 200;
const MOOD_MS = 300;

// Warm interior mood vs the darker, rougher dungeon level. Applied through
// LightingManager.setDungeonMood so the LM stays the only writer of
// scene-global fog/exposure.
// Colors as plain arrays — BABYLON isn't on window at module-eval time
// (same call-time-only rule as the rest of the world code).
const WARM_MOOD = {
  fogColor: [0.095, 0.062, 0.038],
  fogDensity: 0.012,
  exposure: 1.02,
};
const DUNGEON_MOOD = {
  fogColor: [0.045, 0.05, 0.062],
  fogDensity: 0.02,
  exposure: 0.94,
};

export class CastleSystem {
  /**
   * @param {BABYLON.Scene} scene
   * @param {object} worldgen   pure-math world model (surfaceY for the shell)
   * @param {object} lm         LightingManager (setZone + setDungeonMood)
   * @param {object} host       scene bridge:
   *   castShadow(mesh), isMobile,
   *   getPlayerPos() -> Vector3|null,
   *   teleportPlayer(x, y, z, yaw),
   *   cameraEnter({x,y,z}, alpha), cameraExit(),
   *   onZoneChange(zone), onNearbyDoor(info|null)
   */
  constructor(scene, worldgen, lm, host) {
    this.scene = scene;
    this._worldgen = worldgen;
    this._lm = lm;
    this._host = host;
    this.nav = buildNav(INTERIOR_ANCHOR);
    this._inside = false;
    this._built = false;
    this._disposed = false;
    this._mats = null;
    this._extRoot = null;
    this._intRoot = null;
    this._pool = null;
    this._gateLights = [];
    this._nearbyDoorId = null;
    this._lastProxAt = 0;
    this._lastMoodAt = 0;
    this._moodLevel = -1;
    this._gateObs = null;
  }

  isInside() { return this._inside; }

  /** Ceiling height over (x, z) for the camera clamp while inside. */
  ceilingYAt(x, z, refY) {
    const s = this.nav.surfaceAt(x, z, refY + 0.5);
    const level = s ? s.level : this.nav.levelAtY(refY);
    const L = LEVELS[level];
    return L.y + L.clear - 0.3;
  }

  async init() {
    if (this._disposed) return;
    this._mats = createCastleMaterials(this.scene);
    const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

    // ── exterior shell on the terrain (always visible) ──
    this._extRoot = new BABYLON.TransformNode('castle_exterior', this.scene);
    {
      const ctx = createCollector(this.scene, this._mats);
      const { gateTorchPositions } = createCastleExterior(ctx, this._worldgen);
      mergeCollector(ctx, this._extRoot, (mesh, group, matKey) => {
        // shadow casters: stone masses only (windows/flames don't cast)
        if (matKey.includes('Stone') || matKey === 'stone') this._host.castShadow?.(mesh);
      });
      this._spawnGateTorchLights(gateTorchPositions);
    }
    if (this._disposed) return;
    await yieldFrame();

    // ── interior instance in the far-east flat region ──
    const ax = INTERIOR_ANCHOR.x, az = INTERIOR_ANCHOR.z;
    this._intRoot = new BABYLON.TransformNode('castle_interior', this.scene);
    {
      const ctx = createCollector(this.scene, this._mats);
      createFloorSlabs(ctx, ax, az);
      for (const room of CASTLE_PLAN.rooms) createRoom(ctx, room, ax, az);
      await yieldFrame();
      if (this._disposed) return;
      for (let li = 0; li < LEVELS.length; li++) {
        createWallsForLevel(ctx, li, ax, az);
      }
      await yieldFrame();
      if (this._disposed) return;
      dressStructuralRooms(ctx, ax, az);
      createAllStaircases(ctx, ax, az);
      await yieldFrame();
      if (this._disposed) return;
      createAllFurniture(ctx, ax, az);
      const anchors = buildLightAnchors().map((a) => ({
        ...a, x: a.x + ax, z: a.z + az,
      }));
      createFixturesFromAnchors(ctx, anchors, 0, 0); // anchors already world-space
      mergeCollector(ctx, this._intRoot);
      this._pool = new CastleLightPool(this.scene, anchors, this._host.isMobile ? 3 : 6);
    }
    this._intRoot.setEnabled(false);
    this._built = true;
  }

  _spawnGateTorchLights(positions) {
    // two real flickering lights at the gate (campfire precedent — LM-independent)
    for (const p of positions) {
      const l = new BABYLON.PointLight('castleGateTorch', p, this.scene);
      l.diffuse = new BABYLON.Color3(1.0, 0.55, 0.2);
      l.intensity = 14;
      l.range = 11;
      this._gateLights.push({ l, ph: hash2(p.x, p.z) * 6.28 });
    }
    if (this._gateLights.length && !this._gateObs) {
      this._gateObs = this.scene.onBeforeRenderObservable.add(() => {
        const t = performance.now() / 1000;
        for (const g of this._gateLights) {
          g.l.intensity = 14 * (1 + Math.sin(t * 7.3 + g.ph) * 0.2 + Math.sin(t * 17.1 + g.ph) * 0.08);
        }
      });
    }
  }

  // ── proximity → press-E prompt ────────────────────────────────────────────

  /** Called from the scene tick. Throttled; fires onNearbyDoor on change. */
  checkProximity() {
    const now = performance.now();
    if (now - this._lastProxAt < PROX_MS || !this._built) return;
    this._lastProxAt = now;
    const p = this._host.getPlayerPos();
    if (!p) return;

    let id = this._nearbyDoorId;
    if (!this._inside) {
      const g = ENTRY.gateWorld;
      const d2 = (p.x - g.x) ** 2 + (p.z - g.z) ** 2;
      if (id !== 'castle_gate' && d2 < ENTER_DIST_SQ) id = 'castle_gate';
      else if (id === 'castle_gate' && d2 > LEAVE_DIST_SQ) id = null;
    } else {
      const e = ENTRY.exitHotspotLocal;
      const ex = e.x + INTERIOR_ANCHOR.x, ez = e.z + INTERIOR_ANCHOR.z;
      const d2 = (p.x - ex) ** 2 + (p.z - ez) ** 2;
      if (id !== 'castle_exit' && d2 < EXIT_PROMPT_DIST_SQ) id = 'castle_exit';
      else if (id === 'castle_exit' && d2 > LEAVE_DIST_SQ) id = null;
      this._updateMood(p, now);
    }
    if (id !== this._nearbyDoorId) {
      this._nearbyDoorId = id;
      this._host.onNearbyDoor?.(id ? {
        id,
        label: id === 'castle_gate' ? 'Enter Castle Ashwood' : 'Leave the castle',
      } : null);
    }
  }

  _updateMood(p, now) {
    if (now - this._lastMoodAt < MOOD_MS) return;
    this._lastMoodAt = now;
    const s = this.nav.surfaceAt(p.x, p.z, p.y + 0.5);
    const level = s ? s.level : this.nav.levelAtY(p.y);
    if (level !== this._moodLevel) {
      this._moodLevel = level;
      this._lm.setDungeonMood?.(level === 0 ? DUNGEON_MOOD : WARM_MOOD);
    }
  }

  /** Press-E handler — the single enter/exit choke point. */
  useDoor(id) {
    if (id === 'castle_gate' && !this._inside) this.enterInterior();
    else if (id === 'castle_exit' && this._inside) this.exitInterior();
  }

  // ── enter / exit (SEAM:enter-reducer) ─────────────────────────────────────

  enterInterior({ snapToNearestWalkable = false } = {}) {
    if (!this._built || this._inside) return;
    this._inside = true;
    this._intRoot.setEnabled(true);

    // destination: entrance-hall spawn, or (reconnect) nearest walkable to
    // wherever the server row put us
    const ax = INTERIOR_ANCHOR.x, az = INTERIOR_ANCHOR.z;
    let dest = {
      x: ENTRY.spawnLocal.x + ax,
      z: ENTRY.spawnLocal.z + az,
      y: LEVELS[1].y,
      yaw: ENTRY.spawnFacing,
    };
    if (snapToNearestWalkable) {
      const p = this._host.getPlayerPos();
      const near = p && this.nav.nearestWalkable(p.x, p.z, LEVELS[1].y + 1, 60);
      if (near) dest = { ...near, yaw: ENTRY.spawnFacing };
      else {
        const s = this.nav.surfaceAt(dest.x, dest.z, dest.y + 1);
        if (s) dest.y = s.y;
      }
    } else {
      const s = this.nav.surfaceAt(dest.x, dest.z, dest.y + 1);
      if (s) dest.y = s.y;
    }

    this._host.teleportPlayer(dest.x, dest.y, dest.z, dest.yaw);
    this._host.cameraEnter({ x: dest.x, y: dest.y + 1.2, z: dest.z }, dest.yaw);
    this._lm.setZone('dungeon', 0.6);
    this._moodLevel = -1; // force a mood refresh on the next tick
    this._lm.setDungeonMood?.(WARM_MOOD);
    this._pool?.setActive(true, () => this._host.getPlayerPos());
    this._clearPrompt();
    this._host.onZoneChange?.('castle');
  }

  exitInterior() {
    if (!this._inside) return;
    this._inside = false;
    const g = ENTRY.gateWorld;
    const gy = this._worldgen.surfaceY(g.x, g.z);
    this._host.teleportPlayer(g.x, gy, g.z, -Math.PI / 2); // face away from the gate
    this._host.cameraExit({ x: g.x, y: gy + 1.2, z: g.z }, -Math.PI / 2);
    this._settleOutside();
    this._host.onZoneChange?.('overworld');
  }

  /** Reset interior state WITHOUT teleporting (death/respawn — the server
   *  already moved the player; the caller snaps the avatar). */
  forceExit() {
    if (!this._inside) return;
    this._inside = false;
    this._host.cameraExit();
    this._settleOutside();
    this._host.onZoneChange?.('overworld');
  }

  _settleOutside() {
    this._lm.setDungeonMood?.(null);
    this._lm.setZone('overworld', 0.8);
    this._pool?.setActive(false);
    this._intRoot?.setEnabled(false);
    this._moodLevel = -1;
    this._clearPrompt();
  }

  _clearPrompt() {
    if (this._nearbyDoorId) {
      this._nearbyDoorId = null;
      this._host.onNearbyDoor?.(null);
    }
  }

  dispose() {
    this._disposed = true;
    this._pool?.dispose();
    this._pool = null;
    if (this._gateObs) {
      this.scene.onBeforeRenderObservable.remove(this._gateObs);
      this._gateObs = null;
    }
    for (const g of this._gateLights) g.l.dispose();
    this._gateLights.length = 0;
    this._extRoot?.dispose(false, true);
    this._intRoot?.dispose(false, true);
    this._extRoot = this._intRoot = null;
    this._lm?.setDungeonMood?.(null);
    this._mats?.disposeAll();
    this._mats = null;
  }
}
