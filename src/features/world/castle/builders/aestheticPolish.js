/**
 * Castle aesthetic polish builders.
 *
 * These helpers add higher-silhouette exterior detail and room-specific hero
 * props while staying inside the existing castle rendering strategy: primitive
 * Babylon meshes, deterministic placement, shared material keys, and collector
 * merging by group/material. They are intentionally side-effect free so they
 * can be wired into CastleSystem in one small follow-up import/call.
 */

/* global BABYLON */

import { EXTERIOR, LEVELS, ROOMS_BY_ID } from '../castlePlan.js';
import { box, cyl } from './mergeUtil.js';
import { hash2 } from '../../worldgen/rng.js';

const EG = 'EXT';
const G = (level) => `L${level}`;

function addButtress(ctx, x, z, baseY, height, face) {
  const alongX = face === 'north' || face === 'south';
  const signX = face === 'east' ? 1 : face === 'west' ? -1 : 0;
  const signZ = face === 'south' ? 1 : face === 'north' ? -1 : 0;
  const offX = signX * 0.72;
  const offZ = signZ * 0.72;
  const w = alongX ? 1.55 : 2.15;
  const d = alongX ? 2.15 : 1.55;
  ctx.add(box(ctx.scene, 'extButtressBase', x + offX, baseY + 2.1, z + offZ, w, 4.2, d), 'darkStone', EG);
  ctx.add(box(ctx.scene, 'extButtressShaft', x + offX * 0.9, baseY + height * 0.42, z + offZ * 0.9,
    alongX ? 1.05 : 1.45, height * 0.70, alongX ? 1.45 : 1.05), 'extStone', EG);
  ctx.add(box(ctx.scene, 'extButtressCap', x + offX * 0.8, baseY + height * 0.78, z + offZ * 0.8,
    alongX ? 1.35 : 1.8, 0.7, alongX ? 1.8 : 1.35), 'stone', EG);
}

function addCorbelRun(ctx, x0, z0, x1, z1, y) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.floor(len / 2.4));
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  for (let i = 0; i <= n; i++) {
    const t = i / Math.max(1, n);
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    ctx.add(box(ctx.scene, 'extCorbel', x, y, z, alongX ? 0.75 : 1.0, 0.45, alongX ? 1.0 : 0.75), 'stone', EG);
  }
}

function addChimney(ctx, x, z, baseY, h = 5.4) {
  ctx.add(box(ctx.scene, 'keepChimney', x, baseY + h / 2, z, 1.0, h, 0.85), 'darkStone', EG);
  ctx.add(box(ctx.scene, 'keepChimneyCap', x, baseY + h + 0.28, z, 1.35, 0.38, 1.15), 'stone', EG);
  ctx.add(box(ctx.scene, 'keepChimneyGlow', x, baseY + h + 0.02, z, 0.52, 0.08, 0.42), 'ember', EG);
}

function addCourtyardCrate(ctx, x, y, z, s, rot = 0) {
  const c = box(ctx.scene, 'courtCrate', x, y + s / 2, z, s, s, s);
  c.rotation.y = rot;
  ctx.add(c, 'woodFloor', EG);
  const b = box(ctx.scene, 'courtCrateBand', x, y + s * 0.55, z, s * 1.04, 0.08, s * 1.04);
  b.rotation.y = rot;
  ctx.add(b, 'ironRust', EG);
}

function addTrainingDummy(ctx, x, y, z, rot = 0) {
  const post = cyl(ctx.scene, 'trainPost', x, y + 1.15, z, 2.3, 0.16, 8);
  ctx.add(post, 'woodDark', EG);
  const torso = box(ctx.scene, 'trainTorso', x, y + 1.6, z, 0.55, 0.85, 0.32);
  torso.rotation.y = rot;
  ctx.add(torso, 'linen', EG);
  const arm = box(ctx.scene, 'trainArm', x, y + 1.72, z, 1.35, 0.14, 0.14);
  arm.rotation.y = rot;
  ctx.add(arm, 'woodDark', EG);
}

function addGateBrazier(ctx, x, y, z) {
  ctx.add(cyl(ctx.scene, 'gateBrazierBowl', x, y + 0.85, z, 0.38, 1.0, 12), 'iron', EG);
  ctx.add(cyl(ctx.scene, 'gateBrazierCoals', x, y + 1.05, z, 0.18, 0.7, 10), 'ember', EG);
  for (const rot of [0, Math.PI / 2]) {
    const flame = BABYLON.MeshBuilder.CreatePlane('gateBrazierFlame', { width: 0.55, height: 0.9 }, ctx.scene);
    flame.position.set(x, y + 1.42, z);
    flame.rotation.y = rot + hash2(x, z) * 0.7;
    ctx.add(flame, 'flame', EG);
  }
}

/**
 * Decorative exterior polish: buttresses, corbel shadows, chimneys, courtyard
 * clutter, and stronger arrival framing around the gate.
 */
export function createCastleExteriorPolish(ctx, worldgen, baseY) {
  const E = EXTERIOR;
  const sx = E.site.x, sz = E.site.z;
  const wallTop = baseY + E.wallH;
  const K = E.keep;
  const keepTop = baseY + K.h;

  // Heavy base courses make the castle feel embedded in the terrain instead of
  // floating as a clean primitive box.
  ctx.add(box(ctx.scene, 'extBaseCourseN', sx, baseY + 0.55, sz - E.halfD - 0.22, E.halfW * 2 + 2.5, 1.1, 0.7), 'darkStone', EG);
  ctx.add(box(ctx.scene, 'extBaseCourseS', sx, baseY + 0.55, sz + E.halfD + 0.22, E.halfW * 2 + 2.5, 1.1, 0.7), 'darkStone', EG);
  ctx.add(box(ctx.scene, 'extBaseCourseE', sx + E.halfW + 0.22, baseY + 0.55, sz, 0.7, 1.1, E.halfD * 2 + 2.5), 'darkStone', EG);
  ctx.add(box(ctx.scene, 'extBaseCourseW', sx - E.halfW - 0.22, baseY + 0.55, sz, 0.7, 1.1, E.halfD * 2 + 2.5), 'darkStone', EG);

  // Buttresses along the long wall faces. Skip the gate mouth so the entry
  // stays readable and unobstructed.
  for (const z of [sz - 20, sz - 10, sz + 10, sz + 20]) {
    addButtress(ctx, sx - E.halfW - 0.45, z, baseY, E.wallH, 'west');
    addButtress(ctx, sx + E.halfW + 0.45, z, baseY, E.wallH, 'east');
  }
  for (const x of [sx - 22, sx - 11, sx, sx + 11, sx + 22]) {
    addButtress(ctx, x, sz - E.halfD - 0.45, baseY, E.wallH, 'north');
    addButtress(ctx, x, sz + E.halfD + 0.45, baseY, E.wallH, 'south');
  }

  // Corbel/machicolation rhythm beneath parapets and keep roofline.
  addCorbelRun(ctx, sx - E.halfW + 1.5, sz - E.halfD - 1.25, sx + E.halfW - 1.5, sz - E.halfD - 1.25, wallTop - 1.0);
  addCorbelRun(ctx, sx - E.halfW + 1.5, sz + E.halfD + 1.25, sx + E.halfW - 1.5, sz + E.halfD + 1.25, wallTop - 1.0);
  addCorbelRun(ctx, sx - E.halfW - 1.25, sz - E.halfD + 1.5, sx - E.halfW - 1.25, sz + E.halfD - 1.5, wallTop - 1.0);
  addCorbelRun(ctx, sx + E.halfW + 1.25, sz - E.halfD + 1.5, sx + E.halfW + 1.25, sz + E.halfD - 1.5, wallTop - 1.0);
  addCorbelRun(ctx, sx + 4 - K.halfW, sz - K.halfD - 1.0, sx + 4 + K.halfW, sz - K.halfD - 1.0, keepTop - 0.85);
  addCorbelRun(ctx, sx + 4 - K.halfW, sz + K.halfD + 1.0, sx + 4 + K.halfW, sz + K.halfD + 1.0, keepTop - 0.85);

  // Chimneys and roof vents break up the keep silhouette from long range.
  addChimney(ctx, sx + 4 - K.halfW * 0.48, sz - K.halfD * 0.35, keepTop + 1.7, 5.2);
  addChimney(ctx, sx + 4 + K.halfW * 0.42, sz + K.halfD * 0.32, keepTop + 1.7, 4.5);
  addChimney(ctx, sx + 4 + K.halfW * 0.02, sz - K.halfD * 0.58, keepTop + 1.7, 3.9);

  // Gate arrival: braziers, crates, and training props frame the entry path.
  const gx = sx - E.halfW;
  const gz = E.gate.z;
  const gateFloor = worldgen.surfaceY(gx - 2, gz);
  addGateBrazier(ctx, gx - 5.1, gateFloor, gz - E.gate.width / 2 - 2.8);
  addGateBrazier(ctx, gx - 5.1, gateFloor, gz + E.gate.width / 2 + 2.8);
  for (let i = 0; i < 5; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    addCourtyardCrate(ctx, gx + 5 + i * 1.2, baseY + 0.1, gz + side * (8 + Math.floor(i / 2) * 1.4), 0.85 + (i % 3) * 0.12, hash2(i, 8) * 1.4);
  }
  addTrainingDummy(ctx, sx - 12, baseY + 0.1, sz - 13, 0.6);
  addTrainingDummy(ctx, sx - 9.5, baseY + 0.1, sz - 15.4, -0.35);
  addCourtyardCrate(ctx, sx + 15, baseY + 0.1, sz + 14, 1.05, 0.4);
  addCourtyardCrate(ctx, sx + 16.4, baseY + 0.1, sz + 13.4, 0.8, -0.15);
}

function addCrestMedallion(ctx, level, x, z, ax, az, r = 2.4) {
  const y = LEVELS[level].y;
  const disk = cyl(ctx.scene, 'heroCrestDisk', x + ax, y + 0.065, z + az, 0.035, r * 2, 48);
  ctx.add(disk, 'gold', G(level));
  ctx.add(box(ctx.scene, 'heroCrestRed', x + ax, y + 0.095, z + az, r * 1.6, 0.026, 0.28), 'redFabric', G(level));
  ctx.add(box(ctx.scene, 'heroCrestBlue', x + ax, y + 0.105, z + az, 0.28, 0.026, r * 1.6), 'blueFabric', G(level));
}

function addThrone(ctx, level, x, z, ax, az) {
  const fy = LEVELS[level].y;
  ctx.add(box(ctx.scene, 'heroThroneBase', x + ax, fy + 0.24, z + az, 2.1, 0.48, 1.5), 'marbleDark', G(level));
  ctx.add(box(ctx.scene, 'heroThroneSeat', x + ax, fy + 0.76, z + az, 1.55, 0.42, 1.08), 'redFabric', G(level));
  ctx.add(box(ctx.scene, 'heroThroneBack', x - 0.62 + ax, fy + 1.92, z + az, 0.32, 2.8, 1.65), 'redFabric', G(level));
  for (const dz of [-0.72, 0.72]) {
    ctx.add(cyl(ctx.scene, 'heroThronePost', x - 0.78 + ax, fy + 1.95, z + dz + az, 2.95, 0.14, 10), 'gold', G(level));
    ctx.add(cyl(ctx.scene, 'heroThroneFinial', x - 0.78 + ax, fy + 3.5, z + dz + az, 0.22, 0.34, 10), 'gold', G(level));
  }
  ctx.add(box(ctx.scene, 'heroThroneCrown', x - 0.8 + ax, fy + 3.38, z + az, 0.22, 0.24, 1.9), 'gold', G(level));
}

function addVaultDoor(ctx, level, x, z, ax, az) {
  const fy = LEVELS[level].y;
  ctx.add(box(ctx.scene, 'heroVaultFrame', x + ax, fy + 2.0, z + az, 3.2, 4.0, 0.28), 'darkStone', G(level));
  ctx.add(cyl(ctx.scene, 'heroVaultRound', x + ax, fy + 2.0, z + 0.08 + az, 0.22, 2.45, 32), 'iron', G(level));
  ctx.add(cyl(ctx.scene, 'heroVaultLock', x + ax, fy + 2.0, z + 0.24 + az, 0.28, 0.72, 14), 'gold', G(level));
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const sx = Math.cos(a) * 0.9;
    const sy = Math.sin(a) * 0.9;
    ctx.add(cyl(ctx.scene, 'heroVaultBolt', x + sx + ax, fy + 2.0 + sy, z + 0.26 + az, 0.16, 0.18, 8), 'gold', G(level));
  }
}

function addLibraryGlobe(ctx, level, x, z, ax, az) {
  const fy = LEVELS[level].y;
  ctx.add(cyl(ctx.scene, 'heroGlobeStand', x + ax, fy + 0.72, z + az, 1.45, 0.08, 8), 'gold', G(level));
  const globe = BABYLON.MeshBuilder.CreateSphere('heroGlobe', { diameter: 1.05, segments: 16 }, ctx.scene);
  globe.position.set(x + ax, fy + 1.55, z + az);
  ctx.add(globe, 'windowCool', G(level));
  const ring = BABYLON.MeshBuilder.CreateTorus('heroGlobeRing', { diameter: 1.22, thickness: 0.04, tessellation: 18 }, ctx.scene);
  ring.rotation.z = 0.55;
  ring.position.set(x + ax, fy + 1.55, z + az);
  ctx.add(ring, 'gold', G(level));
}

function addDrainGrate(ctx, level, x, z, ax, az) {
  const fy = LEVELS[level].y;
  ctx.add(box(ctx.scene, 'dungeonDrainFrame', x + ax, fy + 0.08, z + az, 1.1, 0.05, 1.1), 'ironRust', G(level));
  for (let i = -2; i <= 2; i++) {
    ctx.add(box(ctx.scene, 'dungeonDrainBarX', x + ax + i * 0.2, fy + 0.115, z + az, 0.04, 0.04, 0.92), 'ironRust', G(level));
    ctx.add(box(ctx.scene, 'dungeonDrainBarZ', x + ax, fy + 0.12, z + az + i * 0.2, 0.92, 0.04, 0.04), 'ironRust', G(level));
  }
}

function addWallChart(ctx, level, x, z, ax, az) {
  const fy = LEVELS[level].y;
  ctx.add(box(ctx.scene, 'heroChartBacking', x + ax, fy + 2.35, z + az, 2.6, 1.8, 0.04), 'blueFabric', G(level));
  ctx.add(box(ctx.scene, 'heroChartRodTop', x + ax, fy + 3.3, z + az, 2.85, 0.08, 0.08), 'gold', G(level));
  ctx.add(box(ctx.scene, 'heroChartRodBot', x + ax, fy + 1.4, z + az, 2.85, 0.08, 0.08), 'gold', G(level));
  for (let i = 0; i < 7; i++) {
    const px = x - 1.0 + hash2(i, 1.7) * 2.0;
    const py = fy + 1.7 + hash2(i, 3.9) * 1.15;
    ctx.add(cyl(ctx.scene, 'heroChartStar', px + ax, py, z - 0.02 + az, 0.035, 0.09, 6), 'candleGlow', G(level));
  }
}

/**
 * Interior hero props for the rooms that should read as memorable set pieces:
 * entrance crest, ballroom throne, library globe, treasury vault door,
 * dungeon grates, and observatory chart.
 */
export function createCastleInteriorHeroProps(ctx, ax, az) {
  const entrance = ROOMS_BY_ID.entranceHall;
  const ballroom = ROOMS_BY_ID.ballroom;
  const library = ROOMS_BY_ID.library;
  const treasury = ROOMS_BY_ID.treasury;
  const dungeon = ROOMS_BY_ID.dCorridor;
  const observatory = ROOMS_BY_ID.towerTop;

  if (entrance) {
    addCrestMedallion(ctx, entrance.level,
      (entrance.rect.x0 + entrance.rect.x1) / 2,
      (entrance.rect.z0 + entrance.rect.z1) / 2,
      ax, az, 2.8);
  }

  if (ballroom) {
    const cz = (ballroom.rect.z0 + ballroom.rect.z1) / 2 - 1;
    addThrone(ctx, ballroom.level, ballroom.rect.x0 + 3.2, cz, ax, az);
    addCrestMedallion(ctx, ballroom.level, ballroom.rect.x0 + 8.2, cz + 5.5, ax, az, 2.1);
  }

  if (library) {
    addLibraryGlobe(ctx, library.level, library.rect.x1 - 2.3, library.rect.z0 + 2.1, ax, az);
  }

  if (treasury) {
    addVaultDoor(ctx, treasury.level,
      (treasury.rect.x0 + treasury.rect.x1) / 2,
      treasury.rect.z0 + 0.36,
      ax, az);
  }

  if (dungeon) {
    for (const x of [-15, 0, 15]) addDrainGrate(ctx, dungeon.level, x * 1.75, 0, ax, az);
  }

  if (observatory) {
    addWallChart(ctx, observatory.level,
      (observatory.rect.x0 + observatory.rect.x1) / 2,
      observatory.rect.z0 + 0.42,
      ax, az);
  }
}
