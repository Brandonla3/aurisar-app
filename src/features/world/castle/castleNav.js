/**
 * castleNav — pure-math walkability model for Castle Ashwood's interior.
 *
 * No Babylon, no I/O. Built once from CASTLE_PLAN at init (a few ms) into
 * per-level walkable grids; runtime queries are single array lookups so the
 * per-frame movement cost is ~15 reads and zero allocation.
 *
 * This is the castle's replacement for worldgen.surfaceY: while the player
 * is inside, BabylonWorldScene routes movement through resolveMove() and
 * ground queries through surfaceAt() instead of the terrain heightfield.
 *
 * Grid encoding per level (Uint16Array, NAV_CELL m cells over LOCAL_BOUNDS):
 *   0            blocked (wall mass, void, outside every room)
 *   1            flat floor at levels[i].y (rooms, door strips)
 *   2 + k        on stairs[k] — height from stairSurfaceY (ramp / landing)
 *
 * The player radius is baked in at build time: room floors are rasterized
 * inset by PLAYER_R, so collision at runtime is a point test, not a swept
 * circle. Door strips bridge the inset gap across wall lines.
 *
 * SEAM:remote-y — remote players/mobs inside the region can ride floors by
 * routing their Y through surfaceAt(x, z, prevY) (v1 keeps them on terrain).
 */

import {
  CASTLE_PLAN, LEVELS, ROOMS, DOORS, STAIRS, VOIDS,
  LOCAL_BOUNDS, NAV_CELL, PLAYER_R, STEP_UP, WALL_T,
  stairRects, stairSurfaceY, doorStripRect, doorLevel, ROOMS_BY_ID,
} from './castlePlan.js';

export { STEP_UP };

// Max drop per move. Large enough that descending a ramp never sticks,
// small enough that a blocked cell can never resolve to the floor BELOW
// (min vertical gap between stacked surfaces is ~2.9 m, half a flight).
export const STEP_DOWN = 1.4;

export function buildNav(anchor = CASTLE_PLAN.interiorAnchor) {
  const b = LOCAL_BOUNDS;
  const cols = Math.ceil((b.x1 - b.x0) / NAV_CELL);
  const rows = Math.ceil((b.z1 - b.z0) / NAV_CELL);
  const grids = LEVELS.map(() => new Uint16Array(cols * rows));

  // cell center in local coords
  const cellX = (c) => b.x0 + (c + 0.5) * NAV_CELL;
  const cellZ = (r) => b.z0 + (r + 0.5) * NAV_CELL;
  const colOf = (x) => Math.floor((x - b.x0) / NAV_CELL);
  const rowOf = (z) => Math.floor((z - b.z0) / NAV_CELL);

  function fillRect(grid, rect, value, clampRect = null) {
    const x0 = Math.max(rect.x0, clampRect ? clampRect.x0 : rect.x0);
    const z0 = Math.max(rect.z0, clampRect ? clampRect.z0 : rect.z0);
    const x1 = Math.min(rect.x1, clampRect ? clampRect.x1 : rect.x1);
    const z1 = Math.min(rect.z1, clampRect ? clampRect.z1 : rect.z1);
    if (x1 <= x0 || z1 <= z0) return;
    const c0 = Math.max(0, colOf(x0)), c1 = Math.min(cols - 1, colOf(x1));
    const r0 = Math.max(0, rowOf(z0)), r1 = Math.min(rows - 1, rowOf(z1));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = cellX(c), z = cellZ(r);
        if (x < x0 || x > x1 || z < z0 || z > z1) continue;
        grid[r * cols + c] = value;
      }
    }
  }

  const inset = (rect, m) => ({ x0: rect.x0 + m, z0: rect.z0 + m, x1: rect.x1 - m, z1: rect.z1 - m });
  const expand = (rect, m) => inset(rect, -m);

  // 1. Room floors, inset by the player radius (+ half wall: walls sit
  //    centered on room edges, so the walkable area starts inside them).
  const roomInset = PLAYER_R + WALL_T / 2;
  for (const room of ROOMS) {
    fillRect(grids[room.level], inset(room.rect, roomInset), 1);
  }

  // 2. Double-height voids: blocked on their own level.
  for (const v of VOIDS) {
    fillRect(grids[v.level], expand(v.rect, PLAYER_R), 0);
  }

  // 3. Stair shaft holes on the UPPER level (exact footprint — railings are
  //    visual; the nav edge sits at the footprint line so the descent onto
  //    lane B stays connected).
  for (const st of STAIRS) {
    fillRect(grids[st.hi], stairRects(st).footprint, 0);
  }

  // 4. Stair ramp/landing surfaces on the LOWER level's grid, clamped inside
  //    the containing room's inset rect so lanes never hug a wall closer
  //    than the player radius.
  STAIRS.forEach((st, k) => {
    const fp = stairRects(st).footprint;
    const loRoom = ROOMS.find((r) => r.level === st.lo &&
      fp.x0 >= r.rect.x0 - 0.01 && fp.x1 <= r.rect.x1 + 0.01 &&
      fp.z0 >= r.rect.z0 - 0.01 && fp.z1 <= r.rect.z1 + 0.01);
    const clamp = loRoom ? inset(loRoom.rect, roomInset) : null;
    fillRect(grids[st.lo], fp, 2 + k, clamp);
    // Re-block the railing gap between the lanes (fillRect covered the whole
    // footprint; stairY() returns null in the gap and surfaceAt treats that
    // as blocked, but keeping the grid exact makes isOpen() honest too).
  });

  // 5. Door connector strips: flat floor bridging the inset gap across the
  //    wall line. Written last so they override wall-adjacent blocking.
  for (const door of DOORS) {
    if (door.b === 'EXTERIOR') continue; // the gate is a teleport, not a walk
    fillRect(grids[doorLevel(door)], doorStripRect(door), 1);
  }

  // ── Queries (world coords — anchor subtracted internally) ─────────────────

  // Stair height with the run coordinate clamped into the stair's u-range:
  // grid cells are NAV_CELL wide, so a cell marked "stair" can catch a query
  // point up to half a cell outside the exact footprint. Clamping u (never v
  // — the railing gap between lanes must stay impassable) keeps the base and
  // top seams continuous instead of flickering null at cell boundaries.
  const stairYCache = STAIRS.map((st) => {
    const u2 = st.u0 + st.runLen + st.landingD;
    return (x, z) => {
      let u = st.axis === 'z' ? z : x;
      const v = st.axis === 'z' ? x : z;
      u = Math.min(Math.max(u, st.u0), u2);
      return st.axis === 'z'
        ? stairSurfaceY(st, v, u)
        : stairSurfaceY(st, u, v);
    };
  });

  /**
   * Highest walkable surface at (x, z) reachable from currentY: at most
   * STEP_UP above and STEP_DOWN below it (so a blocked cell can never
   * resolve to the floor of the level underneath — no falling through
   * slabs). Returns { y, level } or null when blocked.
   */
  function surfaceAt(wx, wz, currentY) {
    const x = wx - anchor.x, z = wz - anchor.z;
    if (x < b.x0 || x >= b.x1 || z < b.z0 || z >= b.z1) return null;
    const idx = rowOf(z) * cols + colOf(x);
    let bestY = -Infinity, bestLevel = -1;
    for (let li = 0; li < grids.length; li++) {
      const v = grids[li][idx];
      if (v === 0) continue;
      let y;
      if (v === 1) {
        y = LEVELS[li].y;
      } else {
        y = stairYCache[v - 2](x, z);
        if (y == null) continue; // railing gap between lanes
      }
      if (y <= currentY + STEP_UP && y >= currentY - STEP_DOWN && y > bestY) {
        bestY = y; bestLevel = li;
      }
    }
    return bestLevel >= 0 ? { y: bestY, level: bestLevel } : null;
  }

  /**
   * Resolve one movement step: accept the new position when a reachable
   * surface exists there, otherwise wall-slide per axis, otherwise stay.
   * Mutates pos ({x, y, z} — a BABYLON.Vector3 in the scene, but any object
   * with x/y/z works, keeping this testable in Node).
   */
  function resolveMove(prevX, prevZ, pos) {
    const cy = pos.y;
    let s = surfaceAt(pos.x, pos.z, cy);
    if (!s) {
      s = surfaceAt(pos.x, prevZ, cy);            // slide along x
      if (s) { pos.z = prevZ; }
      else {
        s = surfaceAt(prevX, pos.z, cy);          // slide along z
        if (s) { pos.x = prevX; }
        else {
          pos.x = prevX; pos.z = prevZ;           // fully blocked
          s = surfaceAt(prevX, prevZ, cy);
        }
      }
    }
    if (s) pos.y = s.y;
    return s;
  }

  /** True when (x, z) has any walkable surface near refY — camera occlusion probe. */
  function isOpen(wx, wz, refY) {
    return surfaceAt(wx, wz, refY + STEP_UP) != null;
  }

  /**
   * Camera-permissive openness: true when ANY surface exists at (x, z) from
   * refY+1 down to refY-depth. Unlike surfaceAt, this sees across
   * double-height voids and stair shafts (the ballroom floor far below the
   * gallery railing still counts as open), so the third-person camera only
   * clamps against true wall mass.
   */
  function isOpenBelow(wx, wz, refY, depth = 12) {
    const x = wx - anchor.x, z = wz - anchor.z;
    if (x < b.x0 || x >= b.x1 || z < b.z0 || z >= b.z1) return false;
    const idx = rowOf(z) * cols + colOf(x);
    for (let li = 0; li < grids.length; li++) {
      const v = grids[li][idx];
      if (v === 0) continue;
      const y = v === 1 ? LEVELS[li].y : stairYCache[v - 2](x, z);
      if (y != null && y <= refY + 1 && y >= refY - depth) return true;
    }
    return false;
  }

  /** Level index the player is on given their current Y (nearest floor below). */
  function levelAtY(y) {
    let best = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      if (y >= LEVELS[i].y - 0.6) best = i;
    }
    return best;
  }

  /** Nearest walkable point to (wx, wz) at currentY — spiral cell search. */
  function nearestWalkable(wx, wz, currentY, maxRadiusM = 8) {
    const direct = surfaceAt(wx, wz, currentY);
    if (direct) return { x: wx, z: wz, y: direct.y, level: direct.level };
    const maxR = Math.ceil(maxRadiusM / NAV_CELL);
    for (let ring = 1; ring <= maxR; ring++) {
      for (let dc = -ring; dc <= ring; dc++) {
        for (const dr of (Math.abs(dc) === ring
          ? Array.from({ length: ring * 2 + 1 }, (_, i) => i - ring)
          : [-ring, ring])) {
          const x = wx + dc * NAV_CELL, z = wz + dr * NAV_CELL;
          const s = surfaceAt(x, z, currentY);
          if (s) return { x, z, y: s.y, level: s.level };
        }
      }
    }
    return null;
  }

  return {
    anchor, cols, rows, grids,
    surfaceAt, resolveMove, isOpen, isOpenBelow, levelAtY, nearestWalkable,
    // exposed for tests
    _local: { colOf, rowOf, cellX, cellZ },
  };
}

/** Convenience: room center in world coords (for tests + spawn points). */
export function roomCenterWorld(roomId, anchor = CASTLE_PLAN.interiorAnchor) {
  const r = ROOMS_BY_ID[roomId];
  return {
    x: (r.rect.x0 + r.rect.x1) / 2 + anchor.x,
    z: (r.rect.z0 + r.rect.z1) / 2 + anchor.z,
    level: r.level,
  };
}
