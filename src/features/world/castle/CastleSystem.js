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
  CASTLE_PLAN, LEVELS, INTERIOR_ANCHOR, ENTRY, EXTERIOR, buildLightAnchors,
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

const ENTER_DIST_SQ = 5.0 * 5.0;
const EXIT_PROMPT_DIST_SQ = 3.4 * 3.4;
const LEAVE_DIST_SQ = 7.0 * 7.0;   // hysteresis
const PROX_MS = 200;
const MOOD_MS = 300;

// Warm interior mood vs the darker, rougher dungeon level. Applied through
// LightingManager.setDungeonMood so the LM stays the only writer of
// scene-global fog/exposure.
// Colors as plain arrays — BABYLON isn't on window at module-eval time
// (same call-time-only rule as the rest of the world code).
//
// The castle interior has NO fog — it owns its own always-on themed ambient
// (AMBIENT_PALETTES below), and any haze just dims the far end of the big
// halls. fogDensity 0 (EXP2 factor → 1) disables it on both moods; the
// fogColor is retained only as an inert value.
const WARM_MOOD = {
  fogColor: [0.11, 0.13, 0.17],
  fogDensity: 0.0,
  exposure: 1.04,
  fill: 0.42, // scene hemispheric lift on top of the themed castle ambient
  noGrading: true, // the cold dungeon LUT mutes the royal reds/golds
};
const DUNGEON_MOOD = {
  fogColor: [0.045, 0.05, 0.062],
  fogDensity: 0.0,
  exposure: 1.05,
  fill: 0.50,
};

// The castle's OWN themed always-on ambient. A single scoped HemisphericLight
// (castleAmbient) can only theme per LEVEL — floors are mixed-use — so the
// scheme progresses as you climb: a warm, vibrant "royal stone" on the grand
// public floors, warmer still on the private upper floors, and a bright BLUE
// dungeon. Warm rooms sitting on a warm floor keep their character via wood
// floors + dense warm torch/candle/fireplace accents. Plain arrays: applied
// at call time.
const AMBIENT_ROYAL = { diffuse: [0.66, 0.63, 0.62], ground: [0.38, 0.34, 0.30], intensity: 0.80 };
const AMBIENT_WARM = { diffuse: [0.68, 0.60, 0.46], ground: [0.36, 0.30, 0.22], intensity: 0.72 };
// dungeon: distinctly blue but bright — close to the rest of the castle so it
// reads as a cold hall, not a black pit.
const AMBIENT_DUNGEON = { diffuse: [0.48, 0.56, 0.74], ground: [0.28, 0.33, 0.44], intensity: 0.98 };
// level → palette. L0 dungeon; L1 entrance/L2 ballroom = grand cool royal;
// L3 masters+library / L4 royal suite+treasury = warm private quarters.
const AMBIENT_BY_LEVEL = [
  AMBIENT_DUNGEON, AMBIENT_ROYAL, AMBIENT_ROYAL, AMBIENT_WARM, AMBIENT_WARM,
];

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

  /**
   * Overworld collision against the exterior shell: the walls are real.
   * Blocks CROSSING INTO the footprint (rect + the four tower circles)
   * with the same axis-slide feel as the interior nav; a player already
   * inside (older save, edge case) can always walk out.
   */
  resolveShellCollision(prevX, prevZ, pos) {
    const E = EXTERIOR;
    const m = 0.7; // player radius + skin
    const x0 = E.site.x - E.halfW - m, x1 = E.site.x + E.halfW + m;
    const z0 = E.site.z - E.halfD - m, z1 = E.site.z + E.halfD + m;
    const tr = E.towerR + m;
    const gr = 2.6 + m; // gatehouse turret body (protrudes past the wall line)
    const blocked = (x, z) => {
      if (x > x0 && x < x1 && z > z0 && z < z1) return true;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const tx = E.site.x + dx * E.halfW, tz = E.site.z + dz * E.halfD;
        if ((x - tx) * (x - tx) + (z - tz) * (z - tz) < tr * tr) return true;
      }
      for (const s of [-1, 1]) {
        const tx = E.site.x - E.halfW, tz = E.gate.z + s * (E.gate.width / 2 + 1.6);
        if ((x - tx) * (x - tx) + (z - tz) * (z - tz) < gr * gr) return true;
      }
      return false;
    };
    if (!blocked(pos.x, pos.z) || blocked(prevX, prevZ)) return;
    if (!blocked(pos.x, prevZ)) { pos.z = prevZ; return; }       // slide along x
    if (!blocked(prevX, pos.z)) { pos.x = prevX; return; }       // slide along z
    pos.x = prevX; pos.z = prevZ;                                 // fully blocked
  }

  /** Ceiling height over (x, z) for the camera clamp while inside. */
  ceilingYAt(x, z, refY) {
    const s = this.nav.surfaceAt(x, z, refY + 0.5);
    const level = s ? s.level : this.nav.levelAtY(refY);
    const L = LEVELS[level];
    return L.y + L.clear - 0.3;
  }

  /** Camera LOS vs the exterior shell: distance from the orbit target along
   *  dir before the ray enters wall / tower / gatehouse / keep mass, or
   *  maxDist when clear. Outdoor counterpart of the interior nav march —
   *  without it, orbiting near the walls (the gate front especially) buries
   *  the camera inside the masonry, where dragging appears dead and only
   *  zoom visibly changes anything. Analytic point tests against the same
   *  footprint resolveShellCollision uses, plus the two gate turrets that
   *  protrude past the wall line. */
  shellCameraOpenDist(tx, ty, tz, dirX, dirY, dirZ, maxDist) {
    const E = EXTERIOR;
    const rr = E.halfW + E.halfD + maxDist; // quick reject: ray can't reach
    if ((tx - E.site.x) ** 2 + (tz - E.site.z) ** 2 > rr * rr) return maxDist;
    if (this._siteBaseY == null) {
      this._siteBaseY = this._worldgen.surfaceY(E.site.x, E.site.z);
    }
    const m = 0.5; // camera skin
    const x0 = E.site.x - E.halfW - m, x1 = E.site.x + E.halfW + m;
    const z0 = E.site.z - E.halfD - m, z1 = E.site.z + E.halfD + m;
    const wallTop = this._siteBaseY + E.wallH + 2.2; // + battlements
    const cyls = [];
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      cyls.push([E.site.x + dx * E.halfW, E.site.z + dz * E.halfD,
        (E.towerR + m) ** 2, this._siteBaseY + E.towerH + 1]);
    }
    for (const s of [-1, 1]) {
      cyls.push([E.site.x - E.halfW, E.gate.z + s * (E.gate.width / 2 + 1.6),
        (3.2 + m) ** 2, wallTop + 6]);
    }
    const blocked = (x, y, z) => {
      for (const [cx, cz, r2, top] of cyls) {
        if (y < top && (x - cx) ** 2 + (z - cz) ** 2 < r2) return true;
      }
      if (x > x0 && x < x1 && z > z0 && z < z1) {
        if (y < wallTop) return true;
        if (y < this._siteBaseY + E.keep.h + 1 &&
            Math.abs(x - E.site.x) < E.keep.halfW + m &&
            Math.abs(z - E.site.z) < E.keep.halfD + m) return true;
      }
      return false;
    };
    const steps = Math.max(2, Math.ceil(maxDist / 0.4));
    for (let k = 1; k <= steps; k++) {
      const d = (k / steps) * maxDist;
      if (blocked(tx + dirX * d, ty + dirY * d, tz + dirZ * d)) {
        return Math.max(0, d - 0.4);
      }
    }
    return maxDist;
  }

  async init() {
    if (this._disposed) return;
    this._mats = createCastleMaterials(this.scene);
    // yield between build chunks via the render loop, NOT setTimeout —
    // browsers throttle timers under heavy rAF load (a 1.6 s build was
    // stretching to ~28 s of throttled waits in headless profiling)
    const yieldFrame = () => new Promise((r) =>
      this.scene.onAfterRenderObservable.addOnce(() => r()));

    // ── exterior shell on the terrain (always visible) ──
    this._extRoot = new BABYLON.TransformNode('castle_exterior', this.scene);
    {
      const ctx = createCollector(this.scene, this._mats);
      const { gateTorchPositions } = createCastleExterior(ctx, this._worldgen);
      const extMeshes = mergeCollector(ctx, this._extRoot, (mesh, group, matKey) => {
        // shadow casters: stone masses only (windows/flames don't cast)
        if (matKey.includes('Stone') || matKey === 'stone') this._host.castShadow?.(mesh);
      });
      this._spawnGateTorchLights(gateTorchPositions, extMeshes);
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
      // invisible camera-collision proxies (walls/slabs recorded during the
      // build). The camera collides against ~250 simple boxes instead of the
      // merged render meshes — cheap, and Babylon's collision response never
      // touches the player's zoom, so the camera can't get "stuck".
      for (const c of ctx.colliders) {
        const b = BABYLON.MeshBuilder.CreateBox('castleCamCol', {
          width: c.w, height: c.h, depth: c.d,
        }, this.scene);
        b.position.set(c.cx, c.cy, c.cz);
        b.isVisible = false;
        b.isPickable = false;
        b.checkCollisions = true;
        b.parent = this._intRoot;
        b.freezeWorldMatrix();
      }
      ctx.colliders.length = 0;
      this._intMeshes = mergeCollector(ctx, this._intRoot);
      this._pool = new CastleLightPool(this.scene, anchors, this._host.isMobile ? 3 : 6);
      this._pool.setIncludedMeshes(this._intMeshes);
      this._spawnInteriorLights();
    }
    this._intRoot.setEnabled(false);
    this._built = true;
  }

  /** Mutate an enabled hemispheric's colors/intensity to a palette entry.
   *  Recompile-free (only touches Color3/scalar state, never setEnabled). */
  _applyAmbientPalette(amb, pal) {
    amb.diffuse = new BABYLON.Color3(...pal.diffuse);
    amb.groundColor = new BABYLON.Color3(...pal.ground);
    amb.intensity = pal.intensity;
  }

  _spawnInteriorLights() {
    // The castle's OWN bright, themed ambient: a scoped hemispheric that only
    // castle meshes see. This is the always-on base — rooms stay bright
    // corner-to-corner regardless of torch proximity; the pooled torches
    // merely accent it. The axis is tilted off vertical so surfaces facing it
    // catch the sky `diffuse` and opposing faces catch `groundColor`, giving
    // columns/walls real dimensional shading without spending a light on the
    // castle's already-saturated (>8) budget. Palette is swapped per level in
    // _updateMood; ROYAL is the initial (ground-floor) look.
    const amb = new BABYLON.HemisphericLight('castleAmbient',
      new BABYLON.Vector3(0.35, 1.0, 0.15).normalize(), this.scene);
    this._applyAmbientPalette(amb, AMBIENT_ROYAL);
    amb.includedOnlyMeshes = [...this._intMeshes];
    // the always-enabled pool torches + scene fill/bounce would otherwise fill
    // the material light budget and evict this base; a high renderPriority
    // guarantees the themed ambient is always applied.
    amb.renderPriority = 100;
    this._ambLight = amb;

    // Dedicated character light: the avatar is a PBR-material GLB, which
    // needs ~10x the intensity Standard materials do — the pooled lights
    // barely register on it (the "why is my character pitch black" bug).
    // Scoped to the avatar only, follows the player, active while inside.
    const cl = new BABYLON.PointLight('castleCharLight', BABYLON.Vector3.Zero(), this.scene);
    cl.diffuse = new BABYLON.Color3(1.0, 0.85, 0.65);
    cl.specular = new BABYLON.Color3(0.25, 0.2, 0.14);
    cl.intensity = 0;
    cl.range = 9;
    cl.includedOnlyMeshes = [];
    this._charLight = cl;
    this._charObs = this.scene.onBeforeRenderObservable.add(() => {
      if (!this._inside || !this._charLight) return;
      const p = this._host.getPlayerPos();
      if (p) this._charLight.position.set(p.x + 0.5, p.y + 2.4, p.z + 0.5);
    });
  }

  _spawnGateTorchLights(positions, extMeshes) {
    // two steady lights at the gate, scoped to the shell so world shaders
    // never recompile. Deliberately NOT flickering: the shell is one merged
    // facade, so any modulation reads as every window strobing at once.
    for (const p of positions) {
      const l = new BABYLON.PointLight('castleGateTorch', p, this.scene);
      l.diffuse = new BABYLON.Color3(1.0, 0.55, 0.2);
      l.intensity = 2.2;
      l.range = 11;
      l.includedOnlyMeshes = [...extMeshes];
      this._gateLights.push({ l, ph: hash2(p.x, p.z) * 6.28 });
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
      // swap the castle's own themed ambient to this level's palette (cool
      // royal on the grand floors, warm on the private upper floors, dim in
      // the dungeon) — recompile-free colour/intensity mutation.
      if (this._ambLight) {
        this._applyAmbientPalette(
          this._ambLight, AMBIENT_BY_LEVEL[level] ?? AMBIENT_ROYAL);
      }
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
    this._pool?.setActive(true, () => {
      const pos = this._host.getPlayerPos();
      return pos ? { pos, level: this._moodLevel >= 0 ? this._moodLevel : null } : null;
    });
    // light the character: refresh the avatar mesh list (it can change on
    // equip) into the dedicated PBR-strength character light and the ambient
    const avatarMeshes = this._host.getAvatarMeshes?.() ?? [];
    if (this._charLight) {
      this._charLight.includedOnlyMeshes = avatarMeshes;
      this._charLight.intensity = 26;
    }
    if (avatarMeshes.length && this._ambLight && this._intMeshes) {
      this._ambLight.includedOnlyMeshes = [...this._intMeshes, ...avatarMeshes];
    }
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
    if (this._charLight) this._charLight.intensity = 0;
    // drop the avatar from the castle ambient scope — it must not stay
    // warmed/brightened by the interior hemispheric out in the overworld
    if (this._ambLight && this._intMeshes) {
      this._ambLight.includedOnlyMeshes = [...this._intMeshes];
    }
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
    if (this._charObs) {
      this.scene.onBeforeRenderObservable.remove(this._charObs);
      this._charObs = null;
    }
    this._charLight?.dispose();
    this._charLight = null;
    this._ambLight?.dispose();
    this._ambLight = null;
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
