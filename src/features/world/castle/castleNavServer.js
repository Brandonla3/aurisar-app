/**
 * castleNavServer — pure walkability checks shared by client tests and the
 * SpacetimeDB module (which mirrors this logic against emitted nav bitmaps).
 *
 * A column is walkable when ANY level's nav cell is non-zero at (x, z).
 * This is intentionally permissive across stacked floors — sufficient for
 * server-side horizontal wall rejection until full surfaceAt lands.
 */

import { LOCAL_BOUNDS, INTERIOR_ANCHOR, NAV_CELL } from './castlePlan.js';

export function isInInteriorBounds(wx, wz, anchor = INTERIOR_ANCHOR) {
  const lx = wx - anchor.x, lz = wz - anchor.z;
  return lx >= LOCAL_BOUNDS.x0 && lx < LOCAL_BOUNDS.x1 &&
         lz >= LOCAL_BOUNDS.z0 && lz < LOCAL_BOUNDS.z1;
}

/** @param {{ cols: number, rows: number, grids: Uint16Array[], anchor: {x:number,z:number} }} nav */
export function isWalkableColumn(nav, wx, wz) {
  const lx = wx - nav.anchor.x, lz = wz - nav.anchor.z;
  const b = LOCAL_BOUNDS;
  if (lx < b.x0 || lx >= b.x1 || lz < b.z0 || lz >= b.z1) return false;
  const col = Math.floor((lx - b.x0) / NAV_CELL);
  const row = Math.floor((lz - b.z0) / NAV_CELL);
  if (col < 0 || col >= nav.cols || row < 0 || row >= nav.rows) return false;
  const idx = row * nav.cols + col;
  for (const grid of nav.grids) {
    if (grid[idx] !== 0) return true;
  }
  return false;
}

/**
 * Returns null when outside the interior region (caller skips validation),
 * otherwise whether the column has any walkable nav cell.
 */
export function castleMoveAllowed(nav, wx, wz) {
  if (!isInInteriorBounds(wx, wz, nav.anchor)) return null;
  return isWalkableColumn(nav, wx, wz);
}
