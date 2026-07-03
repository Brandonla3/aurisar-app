/**
 * Furniture — per-room fit-out driven by room.kind. Deterministic layout
 * (hash2-seeded variance only), primitives tagged for the per-level merge.
 * Covers the brief's full roster: beds (royal → simple), chests, desks,
 * wardrobes, bookcases, kitchens (counters/ovens/barrels/hanging pots),
 * bathrooms (stone tub/basin/mirror/privacy screen), dining tables,
 * dungeon cells (iron bars, chains, straw), treasury hoards.
 */

/* global BABYLON */

import {
  LEVELS, ROOMS, DOORS, WALL_T, ROOMS_BY_ID, doorStripRect,
} from '../castlePlan.js';
import { box, cyl } from './mergeUtil.js';
import { hash2 } from '../../worldgen/rng.js';

const G = (level) => `L${level}`;

// ── Doorway clearance ────────────────────────────────────────────────────────
// No furniture may sit in front of a doorway: every piece checks its
// footprint against the door approach zones before building. Pieces that
// would block simply don't spawn (rooms are large; the loss is invisible).
const DOOR_ZONES = (() => {
  const byLevel = new Map();
  for (const d of DOORS) {
    if (d.b === 'EXTERIOR') continue;
    const level = ROOMS_BY_ID[d.a].level;
    const r = doorStripRect(d, 2.8); // reach well past the wall on both sides
    const grow = 1.0;
    const rect = { x0: r.x0 - grow, z0: r.z0 - grow, x1: r.x1 + grow, z1: r.z1 + grow };
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(rect);
  }
  return byLevel;
})();

/** True when a piece with half-extent `half` at local (x, z) keeps every
 *  doorway approach clear. */
function doorClear(level, x, z, half = 0.9) {
  const zones = DOOR_ZONES.get(level);
  if (!zones) return true;
  for (const r of zones) {
    if (x + half > r.x0 && x - half < r.x1 && z + half > r.z0 && z - half < r.z1) {
      return false;
    }
  }
  return true;
}

// ── Individual pieces ────────────────────────────────────────────────────────

export function createBed(ctx, level, x, z, ax, az, royal = false) {
  const fy = LEVELS[level].y;
  const w = royal ? 2.6 : 1.7, d = royal ? 3.0 : 2.3;
  if (!doorClear(level, x, z, Math.max(w, d) / 2 + 0.3)) return;
  const wx = x + ax, wz = z + az;
  // frame + legs
  ctx.add(box(ctx.scene, `bed_${level}`, wx, fy + 0.42, wz, w, 0.28, d), 'woodDark', G(level));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.add(box(ctx.scene, `bedLeg_${level}`, wx + sx * (w / 2 - 0.1), fy + 0.2, wz + sz * (d / 2 - 0.1), 0.16, 0.4, 0.16), 'woodDark', G(level));
  }
  // headboard (against -z end)
  ctx.add(box(ctx.scene, `bedHead_${level}`, wx, fy + 1.0, wz - d / 2 + 0.06, w, 1.2, 0.12), 'woodDark', G(level));
  // mattress + blanket + pillows
  ctx.add(box(ctx.scene, `bedMat_${level}`, wx, fy + 0.64, wz, w - 0.14, 0.2, d - 0.14), 'linen', G(level));
  ctx.add(box(ctx.scene, `bedBlan_${level}`, wx, fy + 0.76, wz + d * 0.12, w - 0.1, 0.1, d * 0.62), royal ? 'redFabric' : 'blueFabric', G(level));
  for (const off of royal ? [-0.6, 0.6] : [0]) {
    ctx.add(box(ctx.scene, `bedPil_${level}`, wx + off, fy + 0.8, wz - d / 2 + 0.45, 0.7, 0.14, 0.45), 'linen', G(level));
  }
  if (royal) {
    // four-poster canopy
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.add(cyl(ctx.scene, `bedPost_${level}`, wx + sx * (w / 2 - 0.06), fy + 1.3, wz + sz * (d / 2 - 0.06), 2.6, 0.1, 8), 'woodDark', G(level));
    }
    ctx.add(box(ctx.scene, `bedCanopy_${level}`, wx, fy + 2.62, wz, w + 0.2, 0.08, d + 0.2), 'redFabric', G(level));
  }
}

export function createChest(ctx, level, x, z, ax, az, rotY = 0, gold = false) {
  if (!doorClear(level, x, z, 0.9)) return;
  const fy = LEVELS[level].y;
  const wx = x + ax, wz = z + az;
  const body = box(ctx.scene, `chest_${level}`, wx, fy + 0.34, wz, 1.15, 0.6, 0.7);
  body.rotation.y = rotY;
  ctx.add(body, 'woodDark', G(level));
  const lid = cyl(ctx.scene, `chestLid_${level}`, wx, fy + 0.64, wz, 1.15, 0.7, 12);
  lid.rotation.z = Math.PI / 2;
  lid.rotation.y = rotY;
  lid.scaling.z = 0.55;
  ctx.add(lid, 'woodDark', G(level));
  const band = box(ctx.scene, `chestBand_${level}`, wx, fy + 0.45, wz, 1.19, 0.09, 0.74);
  band.rotation.y = rotY;
  ctx.add(band, gold ? 'gold' : 'iron', G(level));
  const clasp = box(ctx.scene, `chestClasp_${level}`, wx + Math.sin(rotY + Math.PI / 2) * 0.36, fy + 0.5, wz + Math.cos(rotY + Math.PI / 2) * 0.36, 0.12, 0.2, 0.06);
  clasp.rotation.y = rotY;
  ctx.add(clasp, gold ? 'gold' : 'iron', G(level));
}

export function createDesk(ctx, level, x, z, ax, az, rotY = 0) {
  if (!doorClear(level, x, z, 1.3)) return;
  const fy = LEVELS[level].y;
  const wx = x + ax, wz = z + az;
  const top = box(ctx.scene, `desk_${level}`, wx, fy + 0.78, wz, 1.6, 0.08, 0.85);
  top.rotation.y = rotY;
  ctx.add(top, 'woodDark', G(level));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.add(box(ctx.scene, `deskLeg_${level}`, wx + sx * 0.7, fy + 0.38, wz + sz * 0.34, 0.1, 0.76, 0.1), 'woodDark', G(level));
  }
  // chair
  const cxp = wx + Math.sin(rotY) * 0.9, czp = wz + Math.cos(rotY) * 0.9;
  ctx.add(box(ctx.scene, `chairSeat_${level}`, cxp, fy + 0.45, czp, 0.5, 0.07, 0.5), 'woodDark', G(level));
  ctx.add(box(ctx.scene, `chairBack_${level}`, cxp, fy + 0.85, czp + 0.22, 0.5, 0.75, 0.07), 'woodDark', G(level));
}

export function createWardrobe(ctx, level, x, z, ax, az) {
  if (!doorClear(level, x, z, 1.1)) return;
  const fy = LEVELS[level].y;
  ctx.add(box(ctx.scene, `ward_${level}`, x + ax, fy + 1.1, z + az, 1.5, 2.2, 0.7), 'woodDark', G(level));
  ctx.add(box(ctx.scene, `wardTrim_${level}`, x + ax, fy + 2.24, z + az, 1.6, 0.1, 0.8), 'woodDark', G(level));
  ctx.add(box(ctx.scene, `wardSplit_${level}`, x + ax, fy + 1.1, z + az + 0.36, 0.05, 2.0, 0.03), 'iron', G(level));
}

export function createBookcase(ctx, level, x, z, ax, az, w = 2.2) {
  if (!doorClear(level, x, z, w / 2 + 0.3)) return;
  const fy = LEVELS[level].y;
  const wx = x + ax, wz = z + az;
  ctx.add(box(ctx.scene, `bookc_${level}`, wx, fy + 1.35, wz, w, 2.7, 0.45), 'woodDark', G(level));
  for (let s = 0; s < 4; s++) {
    // book row: an emissive-free multicolor slab (books texture)
    ctx.add(box(ctx.scene, `books_${level}`, wx, fy + 0.55 + s * 0.62, wz + 0.03, w - 0.2, 0.42, 0.34), 'books', G(level));
  }
}

export function createTable(ctx, level, x, z, ax, az, w, d, withBenches = false) {
  if (!doorClear(level, x, z, Math.max(w, d) / 2 + (withBenches ? 0.9 : 0.3))) return;
  const fy = LEVELS[level].y;
  const wx = x + ax, wz = z + az;
  ctx.add(box(ctx.scene, `table_${level}`, wx, fy + 0.82, wz, w, 0.1, d), 'woodDark', G(level));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.add(box(ctx.scene, `tableLeg_${level}`, wx + sx * (w / 2 - 0.18), fy + 0.4, wz + sz * (d / 2 - 0.18), 0.14, 0.8, 0.14), 'woodDark', G(level));
  }
  if (withBenches) {
    for (const s of [-1, 1]) {
      ctx.add(box(ctx.scene, `bench_${level}`, wx, fy + 0.44, wz + s * (d / 2 + 0.45), w - 0.5, 0.09, 0.4), 'woodDark', G(level));
      for (const bx of [-w / 2 + 0.4, w / 2 - 0.4]) {
        ctx.add(box(ctx.scene, `benchLeg_${level}`, wx + bx, fy + 0.2, wz + s * (d / 2 + 0.45), 0.12, 0.4, 0.34), 'woodDark', G(level));
      }
    }
  }
}

export function createBarrel(ctx, level, x, z, ax, az) {
  if (!doorClear(level, x, z, 0.7)) return;
  const fy = LEVELS[level].y;
  const b = cyl(ctx.scene, `barrel_${level}`, x + ax, fy + 0.55, z + az, 1.1, 0.85, 12);
  ctx.add(b, 'woodDark', G(level));
  for (const hy of [0.25, 0.85]) {
    const hoop = BABYLON.MeshBuilder.CreateTorus(`hoop_${level}`, { diameter: 0.87, thickness: 0.04, tessellation: 12 }, ctx.scene);
    hoop.position.set(x + ax, fy + hy, z + az);
    ctx.add(hoop, 'iron', G(level));
  }
}

export function createCrate(ctx, level, x, z, ax, az, s = 0.8, rot = 0) {
  if (!doorClear(level, x, z, s / 2 + 0.3)) return;
  const fy = LEVELS[level].y;
  const c = box(ctx.scene, `crate_${level}`, x + ax, fy + s / 2, z + az, s, s, s);
  c.rotation.y = rot;
  ctx.add(c, 'woodFloor', G(level));
}

export function createRug(ctx, level, x, z, ax, az, w, d, matKey = 'carpet') {
  const fy = LEVELS[level].y;
  ctx.add(box(ctx.scene, `rug_${level}`, x + ax, fy + 0.05, z + az, w, 0.024, d), matKey, G(level));
}

/** One dungeon cell: iron-bar front with gate gap, side partitions, straw,
 *  wall chains. Cell opens toward the block's inner aisle. */
export function createDungeonCell(ctx, level, x0, z0, x1, z1, openSide, ax, az) {
  const fy = LEVELS[level].y;
  const barH = 2.6;
  const front = openSide === 'north' ? z1 : z0;
  // partitions (solid stone) on east/west
  ctx.add(box(ctx.scene, `cellWallW_${level}`, x0 + ax, fy + barH / 2, (z0 + z1) / 2 + az, 0.3, barH, z1 - z0), 'darkStone', G(level));
  ctx.add(box(ctx.scene, `cellWallE_${level}`, x1 + ax, fy + barH / 2, (z0 + z1) / 2 + az, 0.3, barH, z1 - z0), 'darkStone', G(level));
  // iron bars across the front, leaving a 0.9m gate gap at the west end
  const gate0 = x0 + 0.5, gate1 = x0 + 1.4;
  for (let bx = x0 + 0.15; bx <= x1 - 0.15; bx += 0.3) {
    if (bx > gate0 && bx < gate1) continue;
    ctx.add(cyl(ctx.scene, `cellBar_${level}`, bx + ax, fy + barH / 2, front + az, barH, 0.07, 6), 'iron', G(level));
  }
  ctx.add(box(ctx.scene, `cellRail_${level}`, (x0 + x1) / 2 + ax, fy + barH, front + az, x1 - x0, 0.12, 0.12), 'iron', G(level));
  ctx.add(box(ctx.scene, `cellRailB_${level}`, (x0 + x1) / 2 + ax, fy + 0.08, front + az, x1 - x0, 0.16, 0.12), 'iron', G(level));
  // open gate leaf against the partition
  const leaf = box(ctx.scene, `cellGate_${level}`, gate0 + ax - 0.05, fy + barH / 2 - 0.15, front + az + (openSide === 'north' ? 0.45 : -0.45), 0.06, barH - 0.3, 0.9);
  ctx.add(leaf, 'iron', G(level));
  // straw pile + bench + wall chains
  const backZ = openSide === 'north' ? z0 + 0.7 : z1 - 0.7;
  const straw = BABYLON.MeshBuilder.CreateSphere(`straw_${level}`, { diameter: 1.2, segments: 5 }, ctx.scene);
  straw.scaling.y = 0.22;
  straw.position.set(x0 + 1.0 + ax, fy + 0.12, backZ + az);
  ctx.add(straw, 'linen', G(level));
  ctx.add(box(ctx.scene, `cellBench_${level}`, x1 - 0.9 + ax, fy + 0.3, backZ + az, 1.3, 0.14, 0.5), 'woodDark', G(level));
  for (const cxp of [x0 + (x1 - x0) * 0.35, x0 + (x1 - x0) * 0.65]) {
    const ch = cyl(ctx.scene, `chain_${level}`, cxp + ax, fy + 1.7, backZ + az - (openSide === 'north' ? -0.6 : 0.6) * 0 + 0.0, 1.1, 0.045, 5);
    ch.rotation.x = 0.35;
    ctx.add(ch, 'iron', G(level));
  }
}

// ── Per-room fit-out ─────────────────────────────────────────────────────────

function fitBedroom(ctx, room, ax, az, tier /* 'bedroom'|'master'|'royal' */) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const royal = tier !== 'bedroom';
  const r = hash2(x0 * 1.3, z0 * 2.7);
  // bed against the north wall
  createBed(ctx, level, cx + (r - 0.5) * 3, z1 - 2.2, ax, az, royal);
  createRug(ctx, level, cx, cz, ax, az, Math.min(5, x1 - x0 - 4), Math.min(3.6, z1 - z0 - 5), royal ? 'carpet' : 'blueFabric');
  createChest(ctx, level, x0 + 1.4, z1 - 1.2, ax, az, 0, tier === 'royal');
  if (royal) {
    createDesk(ctx, level, x1 - 2.2, z0 + 2.0, ax, az, Math.PI);
    createWardrobe(ctx, level, x1 - 1.2 - WALL_T, cz, ax, az);
    createTable(ctx, level, cx - 2.5, z0 + 2.4, ax, az, 1.2, 1.2);
  } else {
    // nightstand
    createTable(ctx, level, cx + 2.2, z1 - 1.4, ax, az, 0.7, 0.7);
  }
  if (tier === 'royal') {
    // second seating rug + chests of the royal apartment
    createChest(ctx, level, x0 + 2.6, z1 - 1.2, ax, az, 0.3, true);
    createRug(ctx, level, x0 + 4, z0 + 4, ax, az, 3.4, 2.6);
  }
}

function fitKitchen(ctx, room, ax, az) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  const fy = LEVELS[level].y;
  // counters along the west wall (skipping doorway approaches)
  for (let z = z0 + 2; z <= z1 - 3; z += 2.2) {
    if (!doorClear(level, x0 + 1.0, z, 1.3)) continue;
    ctx.add(box(ctx.scene, `counter_${level}`, x0 + 1.0 + ax, fy + 0.5, z + az, 1.5, 1.0, 2.0), 'stone', G(level));
    ctx.add(box(ctx.scene, `counterTop_${level}`, x0 + 1.0 + ax, fy + 1.03, z + az, 1.6, 0.07, 2.1), 'woodDark', G(level));
  }
  // bread ovens: two arched mouths beside the hearth (north wall)
  for (const dx of [-3.2, 3.2]) {
    const cxp = (x0 + x1) / 2 + dx;
    ctx.add(box(ctx.scene, `oven_${level}`, cxp + ax, fy + 0.9, z1 - 1.0 + az, 2.0, 1.8, 1.6), 'darkStone', G(level));
    const mouth = cyl(ctx.scene, `ovenMouth_${level}`, cxp + ax, fy + 0.75, z1 - 1.55 + az, 0.5, 0.9, 12);
    mouth.rotation.x = Math.PI / 2;
    ctx.add(mouth, 'ember', G(level));
  }
  // long prep table down the middle
  createTable(ctx, level, (x0 + x1) / 2, (z0 + z1) / 2, ax, az, 6.5, 1.6);
  // hanging pot rack over it
  const rackY = fy + 2.3;
  ctx.add(box(ctx.scene, `rack_${level}`, (x0 + x1) / 2 + ax, rackY, (z0 + z1) / 2 + az, 4.5, 0.08, 0.08), 'iron', G(level));
  for (let i = 0; i < 5; i++) {
    const px = (x0 + x1) / 2 - 2 + i * 1.0;
    ctx.add(cyl(ctx.scene, `potHang_${level}`, px + ax, rackY - 0.25, (z0 + z1) / 2 + az, 0.4, 0.04, 5), 'iron', G(level));
    const pot = cyl(ctx.scene, `pot_${level}`, px + ax, rackY - 0.55, (z0 + z1) / 2 + az, 0.32, 0.4, 10);
    ctx.add(pot, 'iron', G(level));
  }
  // barrels + crates in the SE corner
  for (let i = 0; i < 5; i++) {
    createBarrel(ctx, level, x1 - 1.3 - (i % 3) * 1.1, z0 + 1.3 + Math.floor(i / 3) * 1.1, ax, az);
  }
  createCrate(ctx, level, x1 - 4.6, z0 + 1.2, ax, az, 0.9, 0.4);
  createCrate(ctx, level, x1 - 4.5, z0 + 2.2, ax, az, 0.7, 0.1);
  // shelf band on the east wall
  ctx.add(box(ctx.scene, `shelf_${level}`, x1 - 0.7 + ax, fy + 1.6, (z0 + z1) / 2 + az, 0.4, 0.06, (z1 - z0) * 0.5), 'woodDark', G(level));
}

function fitBathroom(ctx, room, ax, az) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  const fy = LEVELS[level].y;
  const cx = (x0 + x1) / 2;
  // sunken stone tub
  ctx.add(box(ctx.scene, `tub_${level}`, cx + ax, fy + 0.5, z1 - 2.2 + az, 3.2, 1.0, 2.2), 'marble', G(level));
  ctx.add(box(ctx.scene, `tubWater_${level}`, cx + ax, fy + 0.86, z1 - 2.2 + az, 2.7, 0.08, 1.7), 'water', G(level));
  // basin pedestal + bowl
  ctx.add(cyl(ctx.scene, `basinPed_${level}`, x0 + 1.4 + ax, fy + 0.5, z0 + 1.6 + az, 1.0, 0.4, 10), 'marble', G(level));
  const bowl = cyl(ctx.scene, `basin_${level}`, x0 + 1.4 + ax, fy + 1.08, z0 + 1.6 + az, 0.24, 0.85, 14);
  ctx.add(bowl, 'marble', G(level));
  // mirror (cool-glow plane in a gold frame)
  ctx.add(box(ctx.scene, `mirFrame_${level}`, x0 + 1.4 + ax, fy + 2.0, z0 + 0.42 + az, 0.9, 1.2, 0.07), 'gold', G(level));
  ctx.add(box(ctx.scene, `mirror_${level}`, x0 + 1.4 + ax, fy + 2.0, z0 + 0.47 + az, 0.74, 1.04, 0.03), 'windowCool', G(level));
  // privacy screen: three angled panels
  for (let i = 0; i < 3; i++) {
    if (!doorClear(level, x1 - 1.6 + i * 0.55, z0 + 2.2 + i * 0.3, 0.7)) continue;
    const p = box(ctx.scene, `screen_${level}`, x1 - 1.6 + i * 0.55 + ax, fy + 1.0, z0 + 2.2 + i * 0.3 + az, 0.06, 2.0, 0.85);
    p.rotation.y = 0.5 - i * 0.45;
    ctx.add(p, 'woodDark', G(level));
  }
  createRug(ctx, level, cx, (z0 + z1) / 2 - 1, ax, az, 2.4, 1.6, 'blueFabric');
}

function fitDining(ctx, room, ax, az) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // two long feast tables with benches
  createTable(ctx, level, cx, cz + 3.4, ax, az, 11, 1.8, true);
  createTable(ctx, level, cx, cz - 3.4, ax, az, 11, 1.8, true);
  // sideboard on the east wall
  const fy = LEVELS[level].y;
  if (doorClear(level, x1 - 0.9, cz, 3.0)) {
    ctx.add(box(ctx.scene, `sideb_${level}`, x1 - 0.9 + ax, fy + 0.6, cz + az, 0.8, 1.2, 5.5), 'woodDark', G(level));
  }
  void z0; void z1;
}

function fitLibrary(ctx, room, ax, az) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  // bookcase ranks along north + south walls
  for (let x = x0 + 2; x <= x1 - 2; x += 2.6) {
    createBookcase(ctx, level, x, z1 - 0.55 - WALL_T / 2, ax, az);
    createBookcase(ctx, level, x, z0 + 0.55 + WALL_T / 2, ax, az);
  }
  // center reading tables + rug
  createTable(ctx, level, (x0 + x1) / 2 - 2.5, (z0 + z1) / 2, ax, az, 2.4, 1.2);
  createTable(ctx, level, (x0 + x1) / 2 + 2.5, (z0 + z1) / 2, ax, az, 2.4, 1.2);
  createRug(ctx, level, (x0 + x1) / 2, (z0 + z1) / 2, ax, az, 7, 3.5);
}

function fitTreasury(ctx, room, ax, az) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  const fy = LEVELS[level].y;
  // chest ranks + gold piles
  let k = 0;
  for (let x = x0 + 1.6; x <= x1 - 1.6; x += 1.7) {
    for (const z of [z0 + 1.6, z1 - 1.6]) {
      createChest(ctx, level, x, z, ax, az, hash2(x, z) * 0.6 - 0.3, k++ % 2 === 0);
    }
  }
  for (const [gx, gz, s] of [[(x0 + x1) / 2 - 1.5, (z0 + z1) / 2, 1.6],
    [(x0 + x1) / 2 + 1.2, (z0 + z1) / 2 + 1.5, 1.1], [(x0 + x1) / 2 + 0.6, (z0 + z1) / 2 - 1.6, 0.9]]) {
    const pile = BABYLON.MeshBuilder.CreateSphere(`goldPile_${level}`, { diameter: s, segments: 6 }, ctx.scene);
    pile.scaling.y = 0.35;
    pile.position.set(gx + ax, fy + s * 0.16, gz + az);
    ctx.add(pile, 'gold', G(level));
  }
  // strongbox plinth at the center-back
  ctx.add(box(ctx.scene, `plinth_${level}`, (x0 + x1) / 2 + ax, fy + 0.3, z1 - 2.6 + az, 1.4, 0.6, 1.4), 'marbleDark', G(level));
  createChest(ctx, level, (x0 + x1) / 2, z1 - 2.6, ax, az, 0, true);
}

function fitSitting(ctx, room, ax, az) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const fy = LEVELS[level].y;
  createRug(ctx, level, cx, cz, ax, az, 5, 3.4);
  createTable(ctx, level, cx, cz, ax, az, 1.6, 1.0);
  // armchairs around the table
  for (const [dx, dz, r] of [[-1.8, 0, Math.PI / 2], [1.8, 0, -Math.PI / 2], [0, 1.8, Math.PI], [0, -1.8, 0]]) {
    if (!doorClear(level, cx + dx, cz + dz, 0.7)) continue;
    const seat = box(ctx.scene, `arm_${level}`, cx + dx + ax, fy + 0.42, cz + dz + az, 0.8, 0.35, 0.8);
    seat.rotation.y = r;
    ctx.add(seat, 'redFabric', G(level));
    const back = box(ctx.scene, `armBack_${level}`, cx + dx - Math.sin(r) * 0.38 + ax, fy + 0.85, cz + dz - Math.cos(r) * 0.38 + az, 0.8, 0.9, 0.14);
    back.rotation.y = r;
    ctx.add(back, 'redFabric', G(level));
  }
  createBookcase(ctx, level, x0 + 1.6, z0 + 0.55 + WALL_T / 2, ax, az, 1.8);
  void z1;
}

function fitStorage(ctx, room, ax, az) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  const r = (s) => hash2(x0 * 5.1 + s, z0 * 3.3 + s);
  // barrel + crate clutter, deterministic scatter
  const n = Math.floor(((x1 - x0) * (z1 - z0)) / 14);
  for (let i = 0; i < n; i++) {
    const px = x0 + 1.2 + r(i * 2) * (x1 - x0 - 2.4);
    const pz = z0 + 1.2 + r(i * 2 + 1) * (z1 - z0 - 2.4);
    if (r(i * 3) > 0.5) createBarrel(ctx, level, px, pz, ax, az);
    else createCrate(ctx, level, px, pz, ax, az, 0.6 + r(i * 5) * 0.5, r(i * 7) * 1.5);
  }
  // one locked chest tucked in a corner (loot bait)
  createChest(ctx, level, x1 - 1.3, z1 - 1.1, ax, az, 0.2);
}

function fitServant(ctx, room, ax, az) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  // bunk rows + small table
  for (let z = z0 + 2.2; z <= z1 - 2.2; z += 3.2) {
    createBed(ctx, level, x0 + 1.6, z, ax, az, false);
  }
  createTable(ctx, level, x1 - 2.6, (z0 + z1) / 2, ax, az, 2.2, 1.2, true);
  createCrate(ctx, level, x1 - 1.2, z0 + 1.2, ax, az, 0.7, 0.3);
}

function fitGuard(ctx, room, ax, az) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  createTable(ctx, level, (x0 + x1) / 2, (z0 + z1) / 2 + 2, ax, az, 2.6, 1.4, true);
  // weapon racks (angled polearms against the wall)
  const fy = LEVELS[level].y;
  for (let i = 0; i < 4; i++) {
    const spear = cyl(ctx.scene, `spear_${level}`, x1 - 0.8 + ax, fy + 1.2, z0 + 1.2 + i * 0.5 + az, 2.4, 0.05, 6);
    spear.rotation.z = 0.18;
    ctx.add(spear, 'woodDark', G(level));
    ctx.add(box(ctx.scene, `spearHead_${level}`, x1 - 1.0 + ax, fy + 2.35, z0 + 1.2 + i * 0.5 + az, 0.06, 0.3, 0.12), 'iron', G(level));
  }
  createCrate(ctx, level, x0 + 1.4, z1 - 1.4, ax, az, 0.8, 0.2);
  createChest(ctx, level, x0 + 1.3, z0 + 1.2, ax, az, -0.2);
}

function fitVault(ctx, room, ax, az) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  // the dungeon hoard: chests + crates + a gold pile behind bars-free vault
  for (let x = x0 + 2; x <= x1 - 2; x += 2.4) {
    createChest(ctx, level, x, z0 + 1.5, ax, az, hash2(x, z0) - 0.5);
  }
  createCrate(ctx, level, x0 + 2, z1 - 1.6, ax, az, 0.9, 0.3);
  createCrate(ctx, level, x0 + 3.2, z1 - 1.8, ax, az, 0.7, 0.9);
  createBarrel(ctx, level, x1 - 1.8, z1 - 1.6, ax, az);
  const fy = LEVELS[level].y;
  const pile = BABYLON.MeshBuilder.CreateSphere(`dGold_${level}`, { diameter: 1.4, segments: 6 }, ctx.scene);
  pile.scaling.y = 0.32;
  pile.position.set((x0 + x1) / 2 + ax, fy + 0.2, (z0 + z1) / 2 + az);
  ctx.add(pile, 'gold', G(level));
}

function fitCells(ctx, room, ax, az) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  // cells along the far wall, opening toward the corridor side
  const openSide = room.rect.z0 === 4 ? 'south' : 'north'; // corridor sits at z ∈ [-4, 4]
  const cellD = 5.2;
  const cz0 = openSide === 'south' ? z1 - cellD : z0;
  const cz1 = openSide === 'south' ? z1 : z0 + cellD;
  const n = Math.floor((x1 - x0 - 1) / 4.2);
  for (let i = 0; i < n; i++) {
    const cx0 = x0 + 0.6 + i * 4.2;
    createDungeonCell(ctx, level, cx0, cz0, cx0 + 4.0, cz1,
      openSide === 'south' ? 'south' : 'north', ax, az);
  }
  // guard bench + brazier clutter on the aisle side
  createCrate(ctx, level, x1 - 1.4, openSide === 'south' ? z0 + 1.2 : z1 - 1.2, ax, az, 0.7, 0.4);
}

function fitObservatory(ctx, room, ax, az) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  const fy = LEVELS[level].y;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // star table + charts + a brass "telescope" on a tripod
  createTable(ctx, level, cx - 1, cz, ax, az, 2.2, 1.4);
  const tube = cyl(ctx.scene, `scope_${level}`, cx + 1.6 + ax, fy + 1.5, cz + 1 + az, 1.6, 0.18, 10);
  tube.rotation.z = 0.7;
  tube.rotation.y = 0.5;
  ctx.add(tube, 'gold', G(level));
  for (const a of [0, 2.1, 4.2]) {
    const leg = cyl(ctx.scene, `scopeLeg_${level}`, cx + 1.6 + Math.cos(a) * 0.4 + ax, fy + 0.55, cz + 1 + Math.sin(a) * 0.4 + az, 1.1, 0.06, 6);
    leg.rotation.z = Math.cos(a) * 0.3;
    leg.rotation.x = -Math.sin(a) * 0.3;
    ctx.add(leg, 'woodDark', G(level));
  }
  createBookcase(ctx, level, x0 + 1.4, z0 + 0.55 + WALL_T / 2, ax, az, 1.6);
}

function fitBallroom(ctx, room, ax, az) {
  const { x0, z1 } = room.rect;
  const level = room.level;
  const fy = LEVELS[level].y;
  // long banquet sideboards along the north wall under the gallery
  for (const dx of [8, 16, 24]) {
    ctx.add(box(ctx.scene, `ballSide_${level}`, x0 + dx + ax, fy + 0.55, z1 - 1.2 + az, 3.2, 1.1, 0.9), 'woodDark', G(level));
  }
  // hanging banners between the tall windows (west + south walls)
  for (let i = 0; i < 6; i++) {
    const bz = room.rect.z0 + 4 + i * 6.5;
    if (bz > room.rect.z1 - 3) break;
    const b = box(ctx.scene, `banner_${level}`, x0 + 0.45 + ax, fy + 9.6, bz + az, 0.06, 4.6, 1.5);
    ctx.add(b, i % 2 === 0 ? 'redFabric' : 'blueFabric', G(level));
    ctx.add(box(ctx.scene, `bannerRod_${level}`, x0 + 0.45 + ax, fy + 11.95, bz + az, 0.1, 0.1, 1.8), 'gold', G(level));
  }
}

function fitEntrance(ctx, room, ax, az) {
  const { x0, z0, x1, z1 } = room.rect;
  const level = room.level;
  const fy = LEVELS[level].y;
  // heraldic banners flanking the inner doors + statue plinths
  for (const dz of [-6, 6]) {
    const cz = (z0 + z1) / 2 + dz;
    ctx.add(box(ctx.scene, `entrBanner_${level}`, x1 - 0.5 + ax, fy + 4.4, cz + az, 0.06, 2.8, 1.1), 'redFabric', G(level));
    ctx.add(box(ctx.scene, `entrRod_${level}`, x1 - 0.5 + ax, fy + 5.85, cz + az, 0.1, 0.08, 1.4), 'gold', G(level));
  }
  for (const dz of [-8.5, 8.5]) {
    const cz = (z0 + z1) / 2 + dz;
    ctx.add(box(ctx.scene, `plinth_${level}`, x0 + 2.2 + ax, fy + 0.55, cz + az, 1.1, 1.1, 1.1), 'marbleDark', G(level));
    // stylized armor stand: torso + helm
    ctx.add(box(ctx.scene, `armor_${level}`, x0 + 2.2 + ax, fy + 1.8, cz + az, 0.62, 1.0, 0.4), 'iron', G(level));
    const helm = BABYLON.MeshBuilder.CreateSphere(`helm_${level}`, { diameter: 0.4, segments: 8 }, ctx.scene);
    helm.position.set(x0 + 2.2 + ax, fy + 2.55, cz + az);
    ctx.add(helm, 'iron', G(level));
  }
}

/** Fit out every room by kind. */
export function createAllFurniture(ctx, ax, az) {
  for (const room of ROOMS) {
    switch (room.kind) {
      case 'bedroom': fitBedroom(ctx, room, ax, az, 'bedroom'); break;
      case 'master':  fitBedroom(ctx, room, ax, az, 'master'); break;
      case 'royal':   fitBedroom(ctx, room, ax, az, 'royal'); break;
      case 'kitchen': fitKitchen(ctx, room, ax, az); break;
      case 'bathroom': fitBathroom(ctx, room, ax, az); break;
      case 'dining':  fitDining(ctx, room, ax, az); break;
      case 'library': fitLibrary(ctx, room, ax, az); break;
      case 'treasury': fitTreasury(ctx, room, ax, az); break;
      case 'sitting': fitSitting(ctx, room, ax, az); break;
      case 'storage': fitStorage(ctx, room, ax, az); break;
      case 'servant': fitServant(ctx, room, ax, az); break;
      case 'guard':   fitGuard(ctx, room, ax, az); break;
      case 'vault':   fitVault(ctx, room, ax, az); break;
      case 'cells':   fitCells(ctx, room, ax, az); break;
      case 'observatory': fitObservatory(ctx, room, ax, az); break;
      case 'ballroom': fitBallroom(ctx, room, ax, az); break;
      case 'entrance': fitEntrance(ctx, room, ax, az); break;
    }
  }
}
