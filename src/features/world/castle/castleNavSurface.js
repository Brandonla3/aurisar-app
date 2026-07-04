/**
 * castleNavSurface — level-aware surfaceAt for server validation parity.
 * Algorithm mirrors castleNav.js surfaceAt; keep spacetimedb/src/castle/surface.ts in sync.
 */

import {
  LOCAL_BOUNDS, LEVELS, STAIRS, STEP_UP, NAV_CELL, stairSurfaceY,
} from './castlePlan.js';
import { STEP_DOWN } from './castleNav.js';

/** @param {{ anchor: {x:number,z:number}, cols: number, rows: number, grids: Uint16Array[] }} nav */
export function createSurfaceQuery(nav) {
  const { anchor, cols, rows, grids } = nav;
  const b = LOCAL_BOUNDS;
  const colOf = (x) => Math.floor((x - b.x0) / NAV_CELL);
  const rowOf = (z) => Math.floor((z - b.z0) / NAV_CELL);

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

  /** @returns {{ y: number, level: number } | null} */
  function surfaceAt(wx, wz, currentY) {
    const x = wx - anchor.x, z = wz - anchor.z;
    if (x < b.x0 || x >= b.x1 || z < b.z0 || z >= b.z1) return null;
    const idx = rowOf(z) * cols + colOf(x);
    let bestY = -Infinity, bestLevel = -1;
    for (let li = 0; li < grids.length; li++) {
      const v = grids[li][idx];
      if (v === 0) continue;
      let y, level = li;
      if (v === 1) {
        y = LEVELS[li].y;
      } else {
        y = stairYCache[v - 2](x, z);
        if (y == null) continue;
        const st = STAIRS[v - 2];
        level = y >= (LEVELS[st.lo].y + LEVELS[st.hi].y) / 2 ? st.hi : st.lo;
      }
      if (y <= currentY + STEP_UP && y >= currentY - STEP_DOWN && y > bestY) {
        bestY = y; bestLevel = level;
      }
    }
    return bestLevel >= 0 ? { y: bestY, level: bestLevel } : null;
  }

  return { surfaceAt };
}

/** Convenience when a buildNav() result is available. */
export function navSurfaceAt(nav, wx, wz, currentY) {
  return createSurfaceQuery(nav).surfaceAt(wx, wz, currentY);
}
