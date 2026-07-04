/**
 * Room / structure builders — floors, walls, doors, windows, arches,
 * columns, beams, trims, railings for the castle interior.
 *
 * Everything is derived from CASTLE_PLAN (the same data the nav model
 * rasterizes) and baked in WORLD SPACE into the shared Collector, which the
 * merge pass later flattens per (level × material). No lights are created
 * here — window glass and flames are emissive; real light is the pool's job.
 */

/* global BABYLON */

import {
  LEVELS, ROOMS, DOORS, VOIDS, STAIRS, LOCAL_BOUNDS,
  WALL_T, SLAB_T, stairRects, doorLevel,
} from '../castlePlan.js';
import { box, slabBox, rectSubtract, cyl, archTube } from './mergeUtil.js';
import { hash2 } from '../../worldgen/rng.js';

// Which room kinds read as "royal" (marble floors, cornices) vs wood vs raw.
const FLOOR_MAT = {
  entrance: 'marble', corridor: 'marble', gallery: 'marble', stairHall: 'marble',
  ballroom: 'marble', treasury: 'marble', bathroom: 'marble',
  dining: 'woodFloor', bedroom: 'woodFloor', master: 'woodFloor', royal: 'woodFloor',
  sitting: 'woodFloor', library: 'woodFloor', observatory: 'woodFloor',
  kitchen: 'darkStone', servant: 'woodFloor', storage: 'darkStone',
  dungeonHall: 'darkStone', cells: 'darkStone', guard: 'darkStone', vault: 'darkStone',
};
const WALL_MAT_BY_LEVEL = ['darkStone', 'stone', 'plaster', 'plaster', 'plaster'];
const WINDOWED_KINDS = new Set([
  'entrance', 'ballroom', 'bedroom', 'master', 'royal', 'sitting', 'library',
  'bathroom', 'observatory', 'dining', 'kitchen', 'gallery', 'corridor', 'stairHall',
]);
const FANCY_KINDS = new Set([
  'entrance', 'ballroom', 'gallery', 'royal', 'master', 'library', 'sitting',
  'dining', 'stairHall', 'treasury',
]);
const DOOR_H = { single: 3.8, double: 5.4, iron: 3.4 };

const doorHeight = (d) => (d.iron ? DOOR_H.iron : d.double ? DOOR_H.double : DOOR_H.single);
const wallMatFor = (level) => WALL_MAT_BY_LEVEL[level];
const G = (level) => `L${level}`; // merge group per level

// ── Floors & ceilings ────────────────────────────────────────────────────────

/**
 * Structural slabs: one full-bounds slab per level minus stair shafts and
 * voids, plus the roof over f4. Slab top = level y. The slab above a level
 * is its ceiling — one build pass covers both.
 */
export function createFloorSlabs(ctx, ax, az) {
  for (let li = 0; li < LEVELS.length; li++) {
    const holes = [
      ...STAIRS.filter((s) => s.hi === li).map((s) => stairRects(s).footprint),
      ...VOIDS.filter((v) => v.level === li).map((v) => v.rect),
    ];
    const rects = rectSubtract([LOCAL_BOUNDS], holes);
    rects.forEach((r, i) => {
      ctx.add(slabBox(ctx.scene, `slab_${li}_${i}`, r, LEVELS[li].y, SLAB_T, ax, az),
        li === 0 ? 'darkStone' : 'stone', G(li));
      ctx.addCollider?.((r.x0 + r.x1) / 2 + ax, LEVELS[li].y - SLAB_T / 2, (r.z0 + r.z1) / 2 + az,
        r.x1 - r.x0, SLAB_T, r.z1 - r.z0);
    });
  }
  // roof cap
  const top = LEVELS[LEVELS.length - 1];
  ctx.add(slabBox(ctx.scene, 'slab_roof', LOCAL_BOUNDS, top.y + top.clear + SLAB_T, SLAB_T, ax, az),
    'stone', G(LEVELS.length - 1));
  ctx.addCollider?.((LOCAL_BOUNDS.x0 + LOCAL_BOUNDS.x1) / 2 + ax,
    top.y + top.clear + SLAB_T / 2,
    (LOCAL_BOUNDS.z0 + LOCAL_BOUNDS.z1) / 2 + az,
    LOCAL_BOUNDS.x1 - LOCAL_BOUNDS.x0, SLAB_T, LOCAL_BOUNDS.z1 - LOCAL_BOUNDS.z0);
}

/** Per-room floor overlays: the visible marble/wood/darkstone surfaces. */
export function createRoom(ctx, room, ax, az) {
  const L = LEVELS[room.level];
  const inset = WALL_T / 2;
  const r = {
    x0: room.rect.x0 + inset, z0: room.rect.z0 + inset,
    x1: room.rect.x1 - inset, z1: room.rect.z1 - inset,
  };
  // overlay sits 3 cm proud of the slab; nav y stays the slab top (feet sink
  // 3 cm into the overlay — invisible at game scale, avoids z-fighting)
  const holes = [
    ...STAIRS.filter((s) => s.hi === room.level).map((s) => stairRects(s).footprint),
  ];
  for (const piece of rectSubtract([r], holes)) {
    ctx.add(slabBox(ctx.scene, `floor_${room.id}`, piece, L.y + 0.03, 0.06, ax, az),
      FLOOR_MAT[room.kind] ?? 'stone', G(room.level));
  }
  // marble rooms get a dark border ribbon — kills the "plain box" read
  if ((FLOOR_MAT[room.kind] === 'marble') && (r.x1 - r.x0) > 6 && (r.z1 - r.z0) > 5) {
    const b = 0.65;
    for (const strip of [
      { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z0 + b },
      { x0: r.x0, z0: r.z1 - b, x1: r.x1, z1: r.z1 },
      { x0: r.x0, z0: r.z0 + b, x1: r.x0 + b, z1: r.z1 - b },
      { x0: r.x1 - b, z0: r.z0 + b, x1: r.x1, z1: r.z1 - b },
    ]) {
      for (const piece of rectSubtract([strip], holes)) {
        ctx.add(slabBox(ctx.scene, `border_${room.id}`, piece, L.y + 0.045, 0.03, ax, az),
          'marbleDark', G(room.level));
      }
    }
  }
  if (FANCY_KINDS.has(room.kind)) createTrim(ctx, room, ax, az);
  if (['kitchen', 'dining', 'bedroom', 'servant', 'library'].includes(room.kind)) {
    createCeilingBeams(ctx, room, ax, az);
  }
  return room;
}

/** Skirting + cornice ribbons along the room perimeter. */
export function createTrim(ctx, room, ax, az) {
  const L = LEVELS[room.level];
  const { x0, z0, x1, z1 } = room.rect;
  const inset = WALL_T / 2 + 0.05;
  const mk = (y, h, t) => {
    ctx.add(box(ctx.scene, `trim_${room.id}`, (x0 + x1) / 2 + ax, y, z0 + inset + az, x1 - x0 - inset * 2, h, t), 'marbleDark', G(room.level));
    ctx.add(box(ctx.scene, `trim_${room.id}`, (x0 + x1) / 2 + ax, y, z1 - inset + az, x1 - x0 - inset * 2, h, t), 'marbleDark', G(room.level));
    ctx.add(box(ctx.scene, `trim_${room.id}`, x0 + inset + ax, y, (z0 + z1) / 2 + az, t, h, z1 - z0 - inset * 2), 'marbleDark', G(room.level));
    ctx.add(box(ctx.scene, `trim_${room.id}`, x1 - inset + ax, y, (z0 + z1) / 2 + az, t, h, z1 - z0 - inset * 2), 'marbleDark', G(room.level));
  };
  mk(L.y + 0.14, 0.28, 0.08);                       // skirting
  const tallCeil = room.kind === 'ballroom';
  if (!tallCeil) mk(L.y + L.clear - 0.18, 0.24, 0.07); // cornice
}

/** Exposed ceiling beams (wood) across the room's short axis. */
export function createCeilingBeams(ctx, room, ax, az) {
  const L = LEVELS[room.level];
  const { x0, z0, x1, z1 } = room.rect;
  const w = x1 - x0, d = z1 - z0;
  const y = L.y + L.clear - 0.26;
  const alongX = w < d; // beams span the short direction
  const len = alongX ? w - WALL_T : d - WALL_T;
  const span = alongX ? d : w;
  const n = Math.max(2, Math.floor(span / 3));
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    if (alongX) {
      ctx.add(box(ctx.scene, `beam_${room.id}`, (x0 + x1) / 2 + ax, y, z0 + t * d + az, len, 0.34, 0.26), 'woodDark', G(room.level));
    } else {
      ctx.add(box(ctx.scene, `beam_${room.id}`, x0 + t * w + ax, y, (z0 + z1) / 2 + az, 0.26, 0.34, len), 'woodDark', G(room.level));
    }
  }
}

// ── Walls ────────────────────────────────────────────────────────────────────

/**
 * The wall pass for one level. Room edges are collected into shared wall
 * lines, unioned, split by door openings (piece + lintel + frame), split by
 * the ballroom void projection (double-height walls), and turned into
 * boxes. Exterior-facing pieces get arched glowing windows for rooms whose
 * kind wants them; void-facing edges become railings (the royal balcony).
 */
export function createWallsForLevel(ctx, level, ax, az) {
  const rooms = ROOMS.filter((r) => r.level === level);
  const L = LEVELS[level];
  const wallMat = wallMatFor(level);

  // gather lines: key -> { axis, at, spans: [{lo, hi, room, side}] }
  const lines = new Map();
  const addEdge = (axis, at, lo, hi, room, side) => {
    const key = `${axis}:${at}`;
    let line = lines.get(key);
    if (!line) { line = { axis, at, spans: [] }; lines.set(key, line); }
    line.spans.push({ lo, hi, room, side });
  };
  for (const room of rooms) {
    const { x0, z0, x1, z1 } = room.rect;
    addEdge('x', x0, z0, z1, room, +1); // room lies at +x of this line
    addEdge('x', x1, z0, z1, room, -1);
    addEdge('z', z0, x0, x1, room, +1);
    addEdge('z', z1, x0, x1, room, -1);
  }

  const voidsHere = VOIDS.filter((v) => v.level === level).map((v) => v.rect);
  const voidsAbove = VOIDS.filter((v) => v.level === level + 1).map((v) => v.rect);

  for (const line of lines.values()) {
    // split points: span ends, door edges, void projections
    const cuts = new Set();
    for (const s of line.spans) { cuts.add(s.lo); cuts.add(s.hi); }
    for (const d of DOORS.filter((d) => doorLevel(d) === level &&
      d.edge === line.axis && d.at === line.at)) {
      cuts.add(d.lo); cuts.add(d.hi);
    }
    for (const v of [...voidsHere, ...voidsAbove]) {
      const lo = line.axis === 'x' ? v.z0 : v.x0;
      const hi = line.axis === 'x' ? v.z1 : v.x1;
      cuts.add(lo); cuts.add(hi);
    }
    const sorted = [...cuts].sort((a, b) => a - b);

    for (let i = 0; i < sorted.length - 1; i++) {
      const lo = sorted[i], hi = sorted[i + 1];
      if (hi - lo < 0.02) continue;
      const mid = (lo + hi) / 2;
      const covering = line.spans.filter((s) => s.lo <= lo + 0.01 && s.hi >= hi - 0.01);
      if (!covering.length) continue; // no room edge along this stretch
      const negRoom = covering.find((s) => s.side === -1)?.room ?? null;
      const posRoom = covering.find((s) => s.side === +1)?.room ?? null;

      // probe just beyond each side of the line (void checks)
      const probe = (side) => line.axis === 'x'
        ? { x: line.at + side * (WALL_T / 2 + 0.2), z: mid }
        : { x: mid, z: line.at + side * (WALL_T / 2 + 0.2) };
      const inVoid = (p, list) => list.some((v) =>
        p.x > v.x0 && p.x < v.x1 && p.z > v.z0 && p.z < v.z1);

      // Railing instead of wall: room on one side, same-level void on the
      // other — the gallery balustrade overlooking the ballroom.
      const negVoid = !negRoom && inVoid(probe(-1), voidsHere);
      const posVoid = !posRoom && inVoid(probe(+1), voidsHere);
      if ((negVoid && posRoom) || (posVoid && negRoom)) {
        createRailing(ctx, level, line, lo, hi, ax, az);
        continue;
      }

      const door = DOORS.find((d) => doorLevel(d) === level && d.edge === line.axis &&
        d.at === line.at && d.lo <= lo + 0.01 && d.hi >= hi - 0.01);

      // Double height where the space above is a void — the ballroom's
      // perimeter walls rise through the missing f3 slab to the f4 slab.
      const tallAbove = LEVELS[level + 1] &&
        (inVoid(probe(-1), voidsAbove) || inVoid(probe(+1), voidsAbove));
      const hUp = tallAbove
        ? (LEVELS[level + 2] ? LEVELS[level + 2].y - SLAB_T - L.y : L.clear)
        : L.clear;

      if (door) {
        const dh = doorHeight(door);
        if (door.sealed) {
          // Decorative-only gates keep the wall/collision solid; the press-E
          // teleport remains a proximity hotspot rather than a walk-through.
          createWall(ctx, level, line, lo, hi, L.y, hUp, wallMat, ax, az);
        } else {
          // jamb-to-jamb opening: wall exists only above the door
          createWall(ctx, level, line, lo, hi, L.y + dh, hUp - dh, wallMat, ax, az);
        }
        createDoor(ctx, level, line, door, ax, az);
      } else {
        createWall(ctx, level, line, lo, hi, L.y, hUp, wallMat, ax, az);
        // dado rail on plaster walls: a stone band proud of both faces
        // breaks up the uniform full-height plaster panels. Full segments
        // only — never emitted across door openings.
        if (wallMat === 'plaster') {
          const len = hi - lo + WALL_T;
          const dado = line.axis === 'x'
            ? box(ctx.scene, `dado_${level}`, line.at + ax, L.y + 0.9, (lo + hi) / 2 + az, WALL_T + 0.12, 0.18, len)
            : box(ctx.scene, `dado_${level}`, (lo + hi) / 2 + ax, L.y + 0.9, line.at + az, len, 0.18, WALL_T + 0.12);
          ctx.add(dado, 'stone', G(level));
        }
        // windows on exterior-facing pieces (exactly one side is a room)
        const roomSide = negRoom ?? posRoom;
        const isPerimeter = !negRoom !== !posRoom;
        if (isPerimeter && level > 0 && roomSide && WINDOWED_KINDS.has(roomSide.kind)) {
          placeWindows(ctx, level, line, lo, hi, roomSide, negRoom ? -1 : +1, hUp, ax, az);
        }
      }
    }
  }
}

/** One wall box on a line segment from yBase up h meters. Also records an
 *  identical invisible collision proxy — Babylon's camera collision slides
 *  the orbit camera along these instead of clipping through rooms. */
export function createWall(ctx, level, line, lo, hi, yBase, h, matKey, ax, az) {
  if (h <= 0.02) return null;
  const len = hi - lo + WALL_T; // overlap corners by half a wall each side
  const m = line.axis === 'x'
    ? box(ctx.scene, `wall_${level}`, line.at + ax, yBase + h / 2, (lo + hi) / 2 + az, WALL_T, h, len)
    : box(ctx.scene, `wall_${level}`, (lo + hi) / 2 + ax, yBase + h / 2, line.at + az, len, h, WALL_T);
  if (line.axis === 'x') ctx.addCollider?.(line.at + ax, yBase + h / 2, (lo + hi) / 2 + az, WALL_T, h, len);
  else ctx.addCollider?.((lo + hi) / 2 + ax, yBase + h / 2, line.at + az, len, h, WALL_T);
  return ctx.add(m, matKey, G(level));
}

/**
 * Door dressing: jambs + lintel band + (arch) a half-torus, plus swung-open
 * wooden panels (iron-banded) so passable openings never read as sealed.
 */
export function createDoor(ctx, level, line, door, ax, az) {
  const L = LEVELS[level];
  const dh = doorHeight(door);
  const w = door.hi - door.lo;
  const mid = (door.lo + door.hi) / 2;
  const at = line.at;
  const put = (u, v, y, sx, sy, sz, matKey) => {
    const m = line.axis === 'x'
      ? box(ctx.scene, `door_${door.id}`, u + ax, y, v + az, sx, sy, sz)
      : box(ctx.scene, `door_${door.id}`, v + ax, y, u + az, sz, sy, sx);
    return ctx.add(m, matKey, G(level));
  };
  const frameMat = level === 0 ? 'darkStone' : 'stone';
  // jambs proud of the wall on both faces
  put(at, door.lo - 0.14, L.y + dh / 2, WALL_T + 0.22, dh, 0.3, frameMat);
  put(at, door.hi + 0.14, L.y + dh / 2, WALL_T + 0.22, dh, 0.3, frameMat);
  // lintel band
  put(at, mid, L.y + dh + 0.16, WALL_T + 0.22, 0.34, w + 0.6, frameMat);
  if (door.arch) {
    // decorative semicircular arch springing from the lintel
    const arch = archTube(ctx.scene, `arch_${door.id}`, w + 0.4, 0.28, 18);
    if (line.axis === 'x') arch.rotation.y = Math.PI / 2;
    arch.position = line.axis === 'x'
      ? new BABYLON.Vector3(at + ax, L.y + dh + 0.3, mid + az)
      : new BABYLON.Vector3(mid + ax, L.y + dh + 0.3, at + az);
    ctx.add(arch, frameMat, G(level));
  }
  const panelMat = door.iron ? 'iron' : 'woodDark';
  const ph = dh - 0.15, pw = door.double ? w / 2 : Math.min(w, 1.6);
  if (door.sealed) {
    // One broad closed panel on the room-side wall face: no outside vista.
    const faceOff = WALL_T / 2 + 0.08;
    const panelW = Math.max(0.8, w - 0.35);
    put(at + faceOff, mid, L.y + ph / 2, 0.12, ph, panelW, panelMat);
    if (!door.iron) {
      put(at + faceOff + 0.04, mid, L.y + ph * 0.28, 0.035, 0.12, panelW * 0.96, 'iron');
      put(at + faceOff + 0.04, mid, L.y + ph * 0.75, 0.035, 0.12, panelW * 0.96, 'iron');
      if (door.double) put(at + faceOff + 0.05, mid, L.y + ph / 2, 0.035, ph * 0.96, 0.10, 'iron');
    }
    return;
  }
  // swung-open panels (flat against the wall face beside the opening)
  put(at + 0.62, door.lo + 0.08, L.y + ph / 2, 0.09, ph, pw * 0.94, panelMat);
  if (door.double) put(at + 0.62, door.hi - 0.08, L.y + ph / 2, 0.09, ph, pw * 0.94, panelMat);
  // iron banding on wooden panels
  if (!door.iron) {
    put(at + 0.68, door.lo + 0.08, L.y + ph * 0.28, 0.03, 0.1, pw * 0.9, 'iron');
    put(at + 0.68, door.lo + 0.08, L.y + ph * 0.75, 0.03, 0.1, pw * 0.9, 'iron');
  }
}

/** Arched, glowing windows spaced along an exterior-facing wall piece. */
function placeWindows(ctx, level, line, lo, hi, room, sideIn, wallH, ax, az) {
  const L = LEVELS[level];
  const tall = room.kind === 'ballroom';
  const winH = tall ? 9.0 : 4.2;
  const winW = tall ? 2.4 : 1.9;
  const spacing = tall ? 8.0 : 6.0;
  const len = hi - lo;
  const n = Math.floor(len / spacing);
  if (n < 1) return;
  const y0 = L.y + (tall ? 2.4 : 1.5) + winH / 2;
  if (y0 + winH / 2 > L.y + wallH - 0.3) return;
  for (let i = 0; i < n; i++) {
    const v = lo + (i + 0.5) * (len / n);
    createWindow(ctx, level, line, v, y0, winW, winH, sideIn, ax, az);
  }
}

/**
 * A single arched window unit: stone frame + sill + arch cap and a warm
 * emissive glass pane inset into the room-side wall face. Glass is opaque —
 * there is no "outside" behind interior walls (the flat plain would show).
 */
export function createWindow(ctx, level, line, v, yC, w, h, sideIn, ax, az) {
  const at = line.at;
  const faceOff = sideIn * (WALL_T / 2 + 0.02);
  const frameMat = level === 0 ? 'darkStone' : 'stone';
  const put = (u, vv, y, sx, sy, sz, matKey) => {
    const m = line.axis === 'x'
      ? box(ctx.scene, `win_${level}`, u + ax, y, vv + az, sx, sy, sz)
      : box(ctx.scene, `win_${level}`, vv + ax, y, u + az, sz, sy, sx);
    return ctx.add(m, matKey, G(level));
  };
  // frame: jambs + sill + head
  put(at + faceOff, v - w / 2 - 0.1, yC, 0.12, h + 0.2, 0.18, frameMat);
  put(at + faceOff, v + w / 2 + 0.1, yC, 0.12, h + 0.2, 0.18, frameMat);
  put(at + faceOff, v, yC - h / 2 - 0.12, 0.2, 0.16, w + 0.5, frameMat);
  put(at + faceOff, v, yC + h / 2 + 0.1, 0.12, 0.16, w + 0.36, frameMat);
  // semicircular arch cap
  const arch = archTube(ctx.scene, `winArch_${level}`, w + 0.15, 0.14, 12);
  if (line.axis === 'x') arch.rotation.y = Math.PI / 2;
  arch.position = line.axis === 'x'
    ? new BABYLON.Vector3(at + faceOff + ax, yC + h / 2 + 0.1, v + az)
    : new BABYLON.Vector3(v + ax, yC + h / 2 + 0.1, at + faceOff + az);
  ctx.add(arch, frameMat, G(level));
  // glass: warm glow pane + iron mullion cross
  put(at + faceOff * 0.9, v, yC, 0.03, h, w, 'windowGlow');
  put(at + faceOff, v, yC, 0.07, h, 0.08, 'iron');
  put(at + faceOff, v, yC + h * 0.12, 0.07, 0.08, w, 'iron');
}

/** Stone balustrade: posts + rail — gallery edges and stair voids. */
export function createRailing(ctx, level, line, lo, hi, ax, az) {
  const L = LEVELS[level];
  const y = L.y;
  const len = hi - lo;
  const put = (u, v, yy, sx, sy, sz, matKey) => {
    const m = line.axis === 'x'
      ? box(ctx.scene, `rail_${level}`, u + ax, yy, v + az, sx, sy, sz)
      : box(ctx.scene, `rail_${level}`, v + ax, yy, u + az, sz, sy, sx);
    return ctx.add(m, matKey, G(level));
  };
  // top rail + base curb
  put(line.at, (lo + hi) / 2, y + 1.06, 0.18, 0.12, len, 'marbleDark');
  put(line.at, (lo + hi) / 2, y + 0.10, 0.16, 0.2, len, 'marbleDark');
  const n = Math.max(2, Math.round(len / 1.1));
  for (let i = 0; i <= n; i++) {
    const v = lo + (i / n) * len;
    const p = cyl(ctx.scene, `railPost_${level}`,
      line.axis === 'x' ? line.at + ax : v + ax,
      y + 0.55,
      line.axis === 'x' ? v + az : line.at + az,
      0.9, 0.11, 8);
    ctx.add(p, 'marble', G(level));
  }
}

/** Fluted column with base + capital. */
export function createColumn(ctx, level, x, z, h, ax, az, matKey = 'marble', dia = 0.85) {
  const L = LEVELS[level];
  // solid: the base plinth footprint blocks movement
  ctx.addNavBlocker?.(level, x - (dia + 0.5) / 2, z - (dia + 0.5) / 2,
    x + (dia + 0.5) / 2, z + (dia + 0.5) / 2);
  ctx.add(box(ctx.scene, `colBase_${level}`, x + ax, L.y + 0.25, z + az, dia + 0.5, 0.5, dia + 0.5), matKey, G(level));
  ctx.add(cyl(ctx.scene, `col_${level}`, x + ax, L.y + h / 2, z + az, h, dia, 14), matKey, G(level));
  ctx.add(box(ctx.scene, `colCap_${level}`, x + ax, L.y + h - 0.22, z + az, dia + 0.6, 0.44, dia + 0.6), matKey, G(level));
}

/** Column rows, carpets, dais — the showpiece structure per room kind. */
export function dressStructuralRooms(ctx, ax, az) {
  for (const room of ROOMS) {
    const L = LEVELS[room.level];
    const { x0, z0, x1, z1 } = room.rect;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;

    if (room.kind === 'entrance') {
      // twin column rows flanking the red runner to the inner doors
      for (const dz of [-4.5, 4.5]) {
        for (let x = x0 + 4; x <= x1 - 3; x += 4.5) {
          createColumn(ctx, room.level, x, cz + dz, L.clear, ax, az, 'marble');
        }
      }
      ctx.add(slabBox(ctx.scene, 'runner_entr',
        { x0: x0 + 1, z0: cz - 1.6, x1: x1 - 0.5, z1: cz + 1.6 }, L.y + 0.055, 0.025, ax, az),
        'carpet', G(room.level));
    }

    if (room.kind === 'ballroom') {
      // heights derive from the level table: colonnade meets the gallery
      // slab; the great columns rise to the f4 slab through the void
      const galleryH = LEVELS[3].y - SLAB_T - L.y;
      const tallH = LEVELS[4].y - SLAB_T - L.y - 0.2;
      for (let x = x0 + 4; x <= x1 - 3.5; x += 7.2) {
        createColumn(ctx, room.level, x, -0.9, galleryH, ax, az, 'marble', 0.9);
      }
      // twin rows of full-height columns down the hall
      for (let x = x0 + 7; x <= x1 - 7; x += 8.8) {
        createColumn(ctx, room.level, x, cz - 8, tallH, ax, az, 'marble', 1.2);
        createColumn(ctx, room.level, x, cz + 3, tallH, ax, az, 'marble', 1.2);
      }
      // dais at the west end
      ctx.add(slabBox(ctx.scene, 'dais',
        { x0: x0 + 1.2, z0: cz - 5, x1: x0 + 6.2, z1: cz + 3 }, L.y + 0.42, 0.42, ax, az),
        'marbleDark', G(room.level));
    }

    if (room.kind === 'corridor' || room.kind === 'gallery') {
      // long red runner
      const alongX = (x1 - x0) >= (z1 - z0);
      const rug = alongX
        ? { x0: x0 + 1, z0: cz - 1.1, x1: x1 - 1, z1: cz + 1.1 }
        : { x0: cx - 1.1, z0: z0 + 1, x1: cx + 1.1, z1: z1 - 1 };
      ctx.add(slabBox(ctx.scene, `runner_${room.id}`, rug, L.y + 0.055, 0.025, ax, az),
        'carpet', G(room.level));
    }

    if (room.kind === 'stairHall') {
      // corner columns give the shaft its monumental read
      for (const [px, pz] of [[x0 + 1.4, z0 + 1.4], [x1 - 1.4, z0 + 1.4],
        [x0 + 1.4, z1 - 1.4], [x1 - 1.4, z1 - 1.4]]) {
        createColumn(ctx, room.level, px, pz, L.clear, ax, az, 'stone', 0.7);
      }
    }

    if (room.kind === 'cells') {
      // engaged half-columns along the corridor-facing wall — dungeon rhythm
      const zEdge = room.rect.z0 === 4 ? z0 + 0.6 : z1 - 0.6;
      for (let x = x0 + 3; x <= x1 - 3; x += 5) {
        ctx.add(cyl(ctx.scene, 'dArchCol', x + ax, L.y + 1.5, zEdge + az, 3.0, 0.5, 10),
          'darkStone', G(room.level));
      }
    }
  }
}

/** Deterministic per-room pseudo-random in [0,1) — furniture variance. */
export function roomRand(room, salt) {
  return hash2(room.rect.x0 * 3.1 + salt, room.rect.z0 * 7.7 + room.level * 13.3);
}
