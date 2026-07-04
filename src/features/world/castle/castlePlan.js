/**
 * castlePlan — Castle Ashwood's single source of truth.
 *
 * Pure data + pure math. No Babylon, no I/O — runs in Node (vitest) and in
 * every client identically. BOTH the geometry builders (castle/builders/*)
 * and the navigation model (castleNav.js) consume only this module, so the
 * rendered castle and its walkable space can never drift apart.
 *
 * Coordinate scheme:
 *   - All rects/positions are in INTERIOR-LOCAL meters. World position =
 *     local + interiorAnchor. The exterior shell lives separately at
 *     exterior.site on the overworld terrain.
 *   - Rects are { x0, z0, x1, z1 } with x0 < x1, z0 < z1.
 *   - levels[i].y is the walkable floor SURFACE height for level i.
 *
 * SEAM:layout-manifest — this object is JSON-serializable (minus the helper
 * functions); a future script can emit it as DungeonDef.layoutManifest.
 */

// ── Navigation / construction constants ─────────────────────────────────────
export const WALL_T     = 0.5;   // wall thickness (walls sit centered on room edges)
export const PLAYER_R   = 0.35;  // player capsule radius baked into the nav grid inset
export const STEP_UP    = 0.55;  // max step-up per move (stair seams, thresholds)
export const NAV_CELL   = 0.25;  // nav grid cell size in meters
export const SLAB_T     = 0.6;   // floor slab thickness (slab top = level y)

// Interior-local bounds (nav grid + slab extents). Interior anchor keeps the
// far edge at x = 840 + 33 = 873 m — inside the server clamp (x <= 999 m,
// spacetimedb WORLD_MAX_PX) with >120 m headroom. Enforced by castlePlan.test.
// Every XZ dimension below is authored at base scale and multiplied by
// PLAN_SCALE on export — hallways, rooms, doors and stairs all grow
// together, and the nav grid + builders only ever see the scaled plan.
export const PLAN_SCALE = 1.75;
const SXZ = PLAN_SCALE;
export const LOCAL_BOUNDS = Object.freeze({
  x0: -33 * SXZ, z0: -25 * SXZ, x1: 33 * SXZ, z1: 25 * SXZ,
});

// ── Levels ───────────────────────────────────────────────────────────────────
// Dungeon is the lowest floor of a raised stack (not below y=0): the flat
// terrain plane at y=0 east of x=500 would slice any true basement. Its
// "underground" feel comes from lighting + materials, not absolute Y.
// clear = wall height; chosen so walls meet the next level's slab exactly
// (y + clear === nextY - SLAB_T) — no gaps, no overdraw. Generous heights:
// the third-person camera needs headroom, and the brief demands tall rooms.
export const LEVELS = Object.freeze([
  { id: 'dungeon', y: 0.6,  clear: 9.8 },  // 0 — cells, vault, guard post
  { id: 'ground',  y: 11.0, clear: 10.4 }, // 1 — entrance, kitchen, dining, servants
  { id: 'f2',      y: 22.0, clear: 9.0 },  // 2 — ballroom (double height), guests, baths
  { id: 'f3',      y: 31.6, clear: 9.0 },  // 3 — master suites, library, gallery
  { id: 'f4',      y: 41.2, clear: 9.0 },  // 4 — royal suite, treasury, tower rooms
]);

// ── Rooms ────────────────────────────────────────────────────────────────────
// kind drives fit-out (furniture/fixtures) and material palette in the
// builders. Rooms on a level tile edge-to-edge; walls sit on shared edges.
const RAW_ROOMS = [
  // ═══ DUNGEON (level 0) ═════════════════════════════════════════════════════
  { id: 'dCorridor',   level: 0, rect: { x0: -24, z0: -4,  x1: 24, z1: 4  }, kind: 'dungeonHall' },
  { id: 'cellBlockN',  level: 0, rect: { x0: -24, z0: 4,   x1: 2,  z1: 16 }, kind: 'cells' },
  { id: 'cellBlockS',  level: 0, rect: { x0: -24, z0: -16, x1: 2,  z1: -4 }, kind: 'cells' },
  { id: 'guardPost',   level: 0, rect: { x0: 2,   z0: 4,   x1: 24, z1: 16 }, kind: 'guard' },
  { id: 'dVault',      level: 0, rect: { x0: 2,   z0: -16, x1: 24, z1: -4 }, kind: 'vault' },
  { id: 'dVestibule',  level: 0, rect: { x0: 24,  z0: -6,  x1: 32, z1: 6  }, kind: 'dungeonHall' },

  // ═══ GROUND / FLOOR 1 (level 1) — entrance, kitchens, dining, servants ═════
  { id: 'entranceHall', level: 1, rect: { x0: -32, z0: -12, x1: -12, z1: 12 }, kind: 'entrance' },
  { id: 'corridor1',    level: 1, rect: { x0: -12, z0: -4,  x1: 24,  z1: 4  }, kind: 'corridor' },
  { id: 'kitchen',      level: 1, rect: { x0: -12, z0: 4,   x1: 8,   z1: 22 }, kind: 'kitchen' },
  { id: 'stairHall1',   level: 1, rect: { x0: 8,   z0: 4,   x1: 24,  z1: 22 }, kind: 'stairHall' },
  { id: 'diningHall',   level: 1, rect: { x0: -12, z0: -22, x1: 8,   z1: -4 }, kind: 'dining' },
  { id: 'servantHall',  level: 1, rect: { x0: 8,   z0: -22, x1: 20,  z1: -4 }, kind: 'servant' },
  { id: 'storeRoom',    level: 1, rect: { x0: 20,  z0: -22, x1: 32,  z1: -6 }, kind: 'storage' },
  { id: 'gVestibule',   level: 1, rect: { x0: 24,  z0: -6,  x1: 32,  z1: 6  }, kind: 'stairHall' },

  // ═══ FLOOR 2 (level 2) — ballroom, guest rooms, sitting room, bath ═════════
  { id: 'ballroom',    level: 2, rect: { x0: -32, z0: -22, x1: 4,  z1: 4  }, kind: 'ballroom' },
  { id: 'corridor2',   level: 2, rect: { x0: -32, z0: 4,   x1: 8,  z1: 12 }, kind: 'corridor' },
  { id: 'guestWest',   level: 2, rect: { x0: -32, z0: 12,  x1: -18, z1: 22 }, kind: 'bedroom' },
  { id: 'guestEast',   level: 2, rect: { x0: -18, z0: 12,  x1: -6,  z1: 22 }, kind: 'bedroom' },
  { id: 'bathroom2',   level: 2, rect: { x0: -6,  z0: 12,  x1: 8,   z1: 22 }, kind: 'bathroom' },
  { id: 'stairHall2',  level: 2, rect: { x0: 8,   z0: 4,   x1: 24,  z1: 22 }, kind: 'stairHall' },
  { id: 'sittingRoom', level: 2, rect: { x0: 4,   z0: -10, x1: 24,  z1: 4  }, kind: 'sitting' },
  { id: 'guestSouth',  level: 2, rect: { x0: 4,   z0: -22, x1: 24,  z1: -10 }, kind: 'bedroom' },
  { id: 'linenRoom',   level: 2, rect: { x0: 24,  z0: -6,  x1: 32,  z1: 6  }, kind: 'storage' },

  // ═══ FLOOR 3 (level 3) — masters, library, ballroom gallery ════════════════
  // gallery3 doubles as the floor's corridor; its south edge over the
  // ballroom (x < 4) is a railing, not a wall — the royal balcony.
  { id: 'gallery3',    level: 3, rect: { x0: -32, z0: 0,   x1: 24, z1: 4  }, kind: 'gallery' },
  { id: 'masterWest',  level: 3, rect: { x0: -32, z0: 4,   x1: -10, z1: 22 }, kind: 'master' },
  { id: 'library',     level: 3, rect: { x0: -10, z0: 4,   x1: 8,   z1: 22 }, kind: 'library' },
  { id: 'stairHall3',  level: 3, rect: { x0: 8,   z0: 4,   x1: 24,  z1: 22 }, kind: 'stairHall' },
  { id: 'masterEast',  level: 3, rect: { x0: 4,   z0: -22, x1: 24,  z1: 0  }, kind: 'master' },
  { id: 'bathroom3',   level: 3, rect: { x0: 24,  z0: -6,  x1: 32,  z1: 6  }, kind: 'bathroom' },

  // ═══ FLOOR 4 (level 4) — royal suite, treasury, tower rooms ════════════════
  { id: 'corridor4',    level: 4, rect: { x0: -32, z0: -2,  x1: 24, z1: 4  }, kind: 'corridor' },
  { id: 'royalSuite',   level: 4, rect: { x0: -32, z0: 4,   x1: -6, z1: 22 }, kind: 'royal' },
  { id: 'treasury',     level: 4, rect: { x0: -6,  z0: 4,   x1: 8,  z1: 22 }, kind: 'treasury' },
  { id: 'stairHall4',   level: 4, rect: { x0: 8,   z0: 4,   x1: 24, z1: 22 }, kind: 'stairHall' },
  { id: 'royalStudy',   level: 4, rect: { x0: -32, z0: -22, x1: -12, z1: -2 }, kind: 'master' },
  { id: 'guardChamber', level: 4, rect: { x0: -12, z0: -22, x1: 8,   z1: -2 }, kind: 'sitting' },
  { id: 'towerRoom',    level: 4, rect: { x0: 8,   z0: -22, x1: 24,  z1: -2 }, kind: 'sitting' },
  { id: 'towerTop',     level: 4, rect: { x0: 24,  z0: -6,  x1: 32,  z1: 6  }, kind: 'observatory' },
];
export const ROOMS = Object.freeze(RAW_ROOMS.map((r) => ({
  ...r,
  rect: { x0: r.rect.x0 * SXZ, z0: r.rect.z0 * SXZ, x1: r.rect.x1 * SXZ, z1: r.rect.z1 * SXZ },
})));

// ── Doors ────────────────────────────────────────────────────────────────────
// Openings between two rooms sharing an edge. edge: 'x' means the shared
// wall line runs along z at x = at (door crosses it); 'z' means the wall
// line runs along x at z = at. lo..hi is the opening extent along the line.
// b: 'EXTERIOR' marks the main gate (teleport interface, not a nav strip).
const RAW_DOORS = [
  // dungeon
  { id: 'd_cellsN',  a: 'dCorridor', b: 'cellBlockN', edge: 'z', at: 4,  lo: -14, hi: -11 },
  { id: 'd_cellsS',  a: 'dCorridor', b: 'cellBlockS', edge: 'z', at: -4, lo: -14, hi: -11 },
  { id: 'd_guard',   a: 'dCorridor', b: 'guardPost',  edge: 'z', at: 4,  lo: 10,  hi: 13 },
  { id: 'd_vault',   a: 'dCorridor', b: 'dVault',     edge: 'z', at: -4, lo: 10,  hi: 13, iron: true },
  { id: 'd_vest',    a: 'dCorridor', b: 'dVestibule', edge: 'x', at: 24, lo: -2,  hi: 2, arch: true },
  // ground
  { id: 'g_gate',    a: 'entranceHall', b: 'EXTERIOR',   edge: 'x', at: -32, lo: -2.2, hi: 2.2, double: true },
  { id: 'g_entr',    a: 'entranceHall', b: 'corridor1',  edge: 'x', at: -12, lo: -2.2, hi: 2.2, double: true, arch: true },
  { id: 'g_kitch',   a: 'corridor1',   b: 'kitchen',     edge: 'z', at: 4,   lo: -6,  hi: -3 },
  { id: 'g_stair',   a: 'corridor1',   b: 'stairHall1',  edge: 'z', at: 4,   lo: 14,  hi: 18, double: true, arch: true },
  { id: 'g_dining',  a: 'corridor1',   b: 'diningHall',  edge: 'z', at: -4,  lo: -6,  hi: -2, double: true },
  { id: 'g_serv',    a: 'corridor1',   b: 'servantHall', edge: 'z', at: -4,  lo: 12,  hi: 15 },
  { id: 'g_vest',    a: 'corridor1',   b: 'gVestibule',  edge: 'x', at: 24,  lo: -2,  hi: 2, arch: true },
  { id: 'g_store',   a: 'gVestibule',  b: 'storeRoom',   edge: 'z', at: -6,  lo: 26,  hi: 29 },
  { id: 'g_kstair',  a: 'kitchen',     b: 'stairHall1',  edge: 'x', at: 8,   lo: 4.6, hi: 7.4 }, // opens onto the south walkway
  { id: 'g_dserv',   a: 'diningHall',  b: 'servantHall', edge: 'x', at: 8,   lo: -14, hi: -11 },
  // floor 2
  { id: 'f2_ballW',  a: 'ballroom',   b: 'corridor2',  edge: 'z', at: 4,   lo: -20, hi: -16, double: true, arch: true },
  { id: 'f2_ballE',  a: 'ballroom',   b: 'corridor2',  edge: 'z', at: 4,   lo: -6,  hi: -2,  double: true, arch: true },
  { id: 'f2_ballS',  a: 'ballroom',   b: 'sittingRoom', edge: 'x', at: 4,  lo: -6,  hi: -2, double: true },
  { id: 'f2_guestW', a: 'corridor2',  b: 'guestWest',  edge: 'z', at: 12,  lo: -27, hi: -24 },
  { id: 'f2_guestE', a: 'corridor2',  b: 'guestEast',  edge: 'z', at: 12,  lo: -14, hi: -11 },
  { id: 'f2_bath',   a: 'corridor2',  b: 'bathroom2',  edge: 'z', at: 12,  lo: -1,  hi: 2 },
  { id: 'f2_stair',  a: 'corridor2',  b: 'stairHall2', edge: 'x', at: 8,   lo: 4.6, hi: 7.4, double: true, arch: true }, // south walkway
  { id: 'f2_sit',    a: 'stairHall2', b: 'sittingRoom', edge: 'z', at: 4,  lo: 12,  hi: 15 },
  { id: 'f2_guestS', a: 'sittingRoom', b: 'guestSouth', edge: 'z', at: -10, lo: 12, hi: 15 },
  { id: 'f2_linen',  a: 'sittingRoom', b: 'linenRoom',  edge: 'x', at: 24,  lo: -2, hi: 2 },
  // floor 3
  { id: 'f3_masterW', a: 'gallery3',   b: 'masterWest', edge: 'z', at: 4,  lo: -24, hi: -21, double: true },
  { id: 'f3_lib',     a: 'gallery3',   b: 'library',    edge: 'z', at: 4,  lo: -4,  hi: -1, double: true },
  { id: 'f3_stair',   a: 'gallery3',   b: 'stairHall3', edge: 'z', at: 4,  lo: 14,  hi: 18, double: true, arch: true },
  { id: 'f3_masterE', a: 'gallery3',   b: 'masterEast', edge: 'z', at: 0,  lo: 12,  hi: 16, double: true },
  { id: 'f3_bath',    a: 'masterEast', b: 'bathroom3',  edge: 'x', at: 24, lo: -4,  hi: -1 },
  // floor 4
  { id: 'f4_royal',  a: 'corridor4', b: 'royalSuite',   edge: 'z', at: 4,  lo: -22, hi: -18, double: true, arch: true },
  { id: 'f4_treas',  a: 'corridor4', b: 'treasury',     edge: 'z', at: 4,  lo: -2,  hi: 2, iron: true },
  { id: 'f4_stair',  a: 'corridor4', b: 'stairHall4',   edge: 'z', at: 4,  lo: 14,  hi: 18, double: true, arch: true },
  { id: 'f4_study',  a: 'corridor4', b: 'royalStudy',   edge: 'z', at: -2, lo: -25, hi: -22 },
  { id: 'f4_guard',  a: 'corridor4', b: 'guardChamber', edge: 'z', at: -2, lo: -5,  hi: -1 },
  { id: 'f4_tower',  a: 'corridor4', b: 'towerRoom',    edge: 'z', at: -2, lo: 14,  hi: 17 },
  { id: 'f4_ttop',   a: 'towerRoom', b: 'towerTop',     edge: 'x', at: 24, lo: -5,  hi: -2 },
];
export const DOORS = Object.freeze(RAW_DOORS.map((d) => ({
  ...d, at: d.at * SXZ, lo: d.lo * SXZ, hi: d.hi * SXZ,
})));

// ── Stairs ───────────────────────────────────────────────────────────────────
// U-shaped switchbacks. Two lanes run along `axis` (u); lanes are offset
// along the perpendicular (v). Lane A rises from the LOWER level's floor at
// u0 to the mid-landing at u0+runLen; the landing spans both lanes; lane B
// returns from the landing to u0, arriving at the UPPER level's floor.
// The upper floor slab gets a shaft hole over the whole footprint; upper
// arrival is the upper-floor cells adjacent to lane B at u < u0.
// Successive grand stairs alternate v0 so their plan-view footprints never
// overlap — each nav cell holds at most one ramp per level grid.
const RAW_STAIRS = [
  // dungeon <-> ground, in d/gVestibule; runs along x, arrival faces the door
  { id: 'dstair', lo: 0, hi: 1, axis: 'x', u0: 25.6, runLen: 4.2, landingD: 2.2,
    laneW: 2.6, gap: 0.5, v0: -4.0 },
  // the monumental grand stairwell (reference: cathedral-wide marble flights).
  // Consecutive stairs alternate v0 so footprints stay disjoint per grid.
  // u0 8 leaves a wide south walkway (z 4..8) inside every stair hall —
  // all doors into the halls open onto FLOOR, never onto ramps or shafts.
  { id: 'grand1', lo: 1, hi: 2, axis: 'z', u0: 8, runLen: 9, landingD: 4.2,
    laneW: 3.4, gap: 0.8, v0: 8.3 },
  { id: 'grand2', lo: 2, hi: 3, axis: 'z', u0: 8, runLen: 9, landingD: 4.2,
    laneW: 3.4, gap: 0.8, v0: 16.1 },
  { id: 'grand3', lo: 3, hi: 4, axis: 'z', u0: 8, runLen: 9, landingD: 4.2,
    laneW: 3.4, gap: 0.8, v0: 8.3 },
];
export const STAIRS = Object.freeze(RAW_STAIRS.map((st) => ({
  ...st,
  u0: st.u0 * SXZ, runLen: st.runLen * SXZ, landingD: st.landingD * SXZ,
  laneW: st.laneW * SXZ, gap: st.gap * SXZ, v0: st.v0 * SXZ,
})));

// ── Double-height voids ──────────────────────────────────────────────────────
// Rect holes cut from a level's floor slab (and nav grid) to open vertical
// space to the level below. The ballroom void gives it an ~11 m ceiling;
// gallery3's remaining strip (z 0..4) is the royal balcony over it.
export const VOIDS = Object.freeze([
  { level: 3, rect: { x0: -32 * SXZ, z0: -22 * SXZ, x1: 4 * SXZ, z1: 0 }, over: 'ballroom' },
]);

// ── Exterior shell + world placement ─────────────────────────────────────────
export const EXTERIOR = Object.freeze({
  site: { x: 150, z: 20 },     // overworld terrain site (rolling meadow east of hub)
  facing: 'west',              // gates face -x, toward the hub / east trail
  halfW: 34, halfD: 30,        // shell footprint half-extents
  wallH: 30,                   // curtain-wall top (4 storeys)
  towerR: 6.5, towerH: 39,     // corner towers
  keep: { halfW: 16, halfD: 12, h: 36 },  // raised central keep block
  gate: { z: 20, width: 6.4, height: 9 }, // gate centered on west wall at site.z
});

export const INTERIOR_ANCHOR = Object.freeze({ x: 840, z: 0 });

// Where the player lands when entering / exiting (world coords derived here
// so CastleSystem and tests share them).
export const ENTRY = Object.freeze({
  // inside the gate with room behind for the third-person orbit
  spawnLocal: { x: -26.5 * SXZ, z: 0 },
  spawnFacing: Math.PI / 2, // avatar yaw: +x
  // exit hotspot inside (by the gate) and return spot outside the shell gates
  exitHotspotLocal: { x: -30.5 * SXZ, z: 0 },
  gateWorld: { x: EXTERIOR.site.x - EXTERIOR.halfW - 3.5, z: EXTERIOR.gate.z },
});

// ── Aggregate plan object (SEAM:layout-manifest — JSON-serializable) ─────────
export const CASTLE_PLAN = Object.freeze({
  name: 'Castle Ashwood',
  exterior: EXTERIOR,
  interiorAnchor: INTERIOR_ANCHOR,
  bounds: LOCAL_BOUNDS,
  levels: LEVELS,
  rooms: ROOMS,
  doors: DOORS,
  stairs: STAIRS,
  voids: VOIDS,
  entry: ENTRY,
  // SEAM:dungeon-def — v2 mob spawns, DungeonSpawnDef-shaped, seeded by the
  // server when the castle becomes a real instance. Positions are
  // interior-local; contentPos = local + interiorAnchor.
  spawnMarkers: [],
});

// ── Stair math (shared by geometry AND nav — the anti-drift seam) ────────────

/** Per-stair derived rects: lanes, landing, full footprint. */
export function stairRects(st) {
  const u1 = st.u0 + st.runLen;
  const u2 = u1 + st.landingD;
  const vA0 = st.v0, vA1 = st.v0 + st.laneW;
  const vB0 = vA1 + st.gap, vB1 = vB0 + st.laneW;
  const mk = (uLo, uHi, vLo, vHi) => st.axis === 'z'
    ? { x0: vLo, z0: uLo, x1: vHi, z1: uHi }
    : { x0: uLo, z0: vLo, x1: uHi, z1: vHi };
  return {
    laneA:     mk(st.u0, u1, vA0, vA1),
    laneB:     mk(st.u0, u1, vB0, vB1),
    landing:   mk(u1, u2, vA0, vB1),
    footprint: mk(st.u0, u2, vA0, vB1),
  };
}

/**
 * Walk-surface height of a stair at a local point, or null when the point is
 * off the stair. THE shared ramp math: the step-mesh builder and the nav
 * grid both derive from this, so stairs always look like they walk.
 */
export function stairSurfaceY(st, x, z) {
  const yLo  = LEVELS[st.lo].y;
  const yHi  = LEVELS[st.hi].y;
  const yMid = (yLo + yHi) / 2;
  const u = st.axis === 'z' ? z : x;
  const v = st.axis === 'z' ? x : z;
  const u1 = st.u0 + st.runLen;
  const u2 = u1 + st.landingD;
  const vA0 = st.v0, vA1 = st.v0 + st.laneW;
  const vB0 = vA1 + st.gap, vB1 = vB0 + st.laneW;

  if (u >= u1 && u <= u2 && v >= vA0 && v <= vB1) return yMid;          // landing
  if (u < st.u0 || u > u1) return null;
  const t = (u - st.u0) / st.runLen;
  if (v >= vA0 && v <= vA1) return yLo + t * (yMid - yLo);               // lane A up
  if (v >= vB0 && v <= vB1) return yHi + t * (yMid - yHi);               // lane B up
  return null;                                                            // railing gap
}

// ── Lookups ──────────────────────────────────────────────────────────────────
export const ROOMS_BY_ID = Object.freeze(
  Object.fromEntries(ROOMS.map((r) => [r.id, r]))
);
export function roomsOnLevel(level) {
  return ROOMS.filter((r) => r.level === level);
}

/** Rect containment with optional inset. */
export function inRect(rect, x, z, inset = 0) {
  return x >= rect.x0 + inset && x <= rect.x1 - inset &&
         z >= rect.z0 + inset && z <= rect.z1 - inset;
}

/**
 * Door opening rect crossing its wall line — used by nav (connector strip)
 * and by the wall builder (hole in the wall segment). `reach` extends the
 * strip past the wall line on both sides so the inset room grids connect.
 */
export function doorStripRect(door, reach = WALL_T / 2 + PLAYER_R + 0.15) {
  const lo = door.lo + PLAYER_R, hi = door.hi - PLAYER_R;
  return door.edge === 'x'
    ? { x0: door.at - reach, z0: lo, x1: door.at + reach, z1: hi }
    : { x0: lo, z0: door.at - reach, x1: hi, z1: door.at + reach };
}

/** The level a door lives on (from its `a` room). */
export function doorLevel(door) {
  return ROOMS_BY_ID[door.a].level;
}

// ── Light anchors (derived, deterministic) ───────────────────────────────────
// ~120 warm glow points. ONLY CastleLightPool ever turns the nearest few
// into real PointLights; every anchor also gets an emissive flame/glow mesh
// from the builders. kind: torch | chandelier | fireplace | candle | brazier.
// priority: higher wins when ranking pool assignment at equal distance.
export function buildLightAnchors() {
  const anchors = [];
  const add = (kind, level, x, z, y, priority = 1) =>
    anchors.push({ kind, level, x, z, y, priority });

  for (const room of ROOMS) {
    const L = LEVELS[room.level];
    const { x0, z0, x1, z1 } = room.rect;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const w = x1 - x0, d = z1 - z0;
    const torchY = L.y + 2.5;

    switch (room.kind) {
      case 'corridor': case 'gallery': {
        // paired wall torches marching down the long axis
        const along = w >= d ? 'x' : 'z';
        const len = along === 'x' ? w : d;
        const n = Math.max(2, Math.floor(len / 7));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          if (along === 'x') {
            add('torch', room.level, x0 + t * w, z0 + 0.4, torchY);
            add('torch', room.level, x0 + t * w, z1 - 0.4, torchY);
          } else {
            add('torch', room.level, x0 + 0.4, z0 + t * d, torchY);
            add('torch', room.level, x1 - 0.4, z0 + t * d, torchY);
          }
        }
        break;
      }
      case 'entrance':
        add('chandelier', room.level, cx, cz, L.y + L.clear - 1.6, 3);
        add('torch', room.level, x0 + 0.4, cz - 6, torchY);
        add('torch', room.level, x0 + 0.4, cz + 6, torchY);
        add('torch', room.level, cx, z0 + 0.4, torchY);
        add('torch', room.level, cx, z1 - 0.4, torchY);
        break;
      case 'ballroom': {
        // three great chandeliers down the long axis + wall sconces
        for (const t of [0.22, 0.5, 0.78]) {
          add('chandelier', room.level, x0 + t * w, cz, L.y + 13.5, 4);
        }
        for (const t of [0.2, 0.5, 0.8]) {
          add('torch', room.level, x0 + t * w, z0 + 0.4, torchY);
          add('torch', room.level, x0 + 0.4, z0 + t * d, torchY);
        }
        break;
      }
      case 'dining':
        add('chandelier', room.level, cx - 4, cz, L.y + L.clear - 1.5, 3);
        add('chandelier', room.level, cx + 4, cz, L.y + L.clear - 1.5, 3);
        add('fireplace', room.level, x0 + 0.7, cz, L.y + 1.0, 3);
        break;
      case 'kitchen':
        add('fireplace', room.level, cx, z1 - 0.7, L.y + 1.0, 3); // great hearth
        add('torch', room.level, x0 + 0.4, cz, torchY);
        add('torch', room.level, x1 - 0.4, cz - 4, torchY);
        break;
      case 'stairHall':
        add('chandelier', room.level, cx, cz, L.y + L.clear - 1.4, 2);
        add('torch', room.level, x0 + 0.4, z0 + 2, torchY);
        add('torch', room.level, x1 - 0.4, z1 - 2, torchY);
        break;
      case 'master': case 'royal':
        add('fireplace', room.level, x0 + 0.7, cz, L.y + 1.0, 3);
        add('candle', room.level, cx + 3, cz + 3, L.y + 1.1);
        add('candle', room.level, cx - 3, cz - 3, L.y + 1.1);
        break;
      case 'bedroom': case 'sitting':
        add('candle', room.level, cx, cz - 2, L.y + 1.1);
        add('torch', room.level, x0 + 0.4, cz, torchY);
        break;
      case 'library':
        add('chandelier', room.level, cx, cz, L.y + L.clear - 1.5, 2);
        add('candle', room.level, cx - 4, cz, L.y + 1.1);
        add('candle', room.level, cx + 4, cz, L.y + 1.1);
        break;
      case 'bathroom':
        add('candle', room.level, cx, cz, L.y + 1.1);
        add('torch', room.level, x0 + 0.4, cz, torchY);
        break;
      case 'treasury':
        add('candle', room.level, cx - 3, cz, L.y + 1.3, 2);
        add('candle', room.level, cx + 3, cz, L.y + 1.3, 2);
        add('torch', room.level, cx, z0 + 0.4, torchY);
        break;
      case 'observatory':
        add('candle', room.level, cx, cz, L.y + 1.1);
        break;
      case 'dungeonHall': case 'cells': {
        // sparse — the dungeon stays dark between pools of torchlight
        const along = w >= d ? 'x' : 'z';
        const len = along === 'x' ? w : d;
        const n = Math.max(1, Math.floor(len / 12));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          if (along === 'x') add('torch', room.level, x0 + t * w, z0 + 0.4, torchY, 2);
          else               add('torch', room.level, x0 + 0.4, z0 + t * d, torchY, 2);
        }
        break;
      }
      case 'guard':
        add('brazier', room.level, cx, cz, L.y + 0.9, 3);
        break;
      case 'vault':
        add('torch', room.level, cx, z1 - 0.4, torchY, 2);
        add('candle', room.level, cx, cz, L.y + 1.0);
        break;
      case 'storage': case 'servant':
        add('torch', room.level, cx, z1 - 0.4, torchY);
        break;
    }
  }
  return anchors;
}
