/**
 * Castle interior nav validation for SpacetimeDB movePlayer.
 * Mirrors src/features/world/castle/castleNavServer.js column-walkable checks.
 */

import { CASTLE_NAV_META, CASTLE_NAV_BITMAPS_B64 } from './navGrids.js';

let decoded: Uint16Array[] | null = null;

function decodeGrids(): Uint16Array[] {
  if (decoded) return decoded;
  decoded = CASTLE_NAV_BITMAPS_B64.map((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Uint16Array(bytes.buffer);
  });
  return decoded;
}

export function pxToWorldM(px: number): number {
  return (px - 1600) / 32;
}

export function isInCastleInterior(worldXM: number, worldZM: number): boolean {
  const { anchor, bounds } = CASTLE_NAV_META;
  const lx = worldXM - anchor.x;
  const lz = worldZM - anchor.z;
  return lx >= bounds.x0 && lx < bounds.x1 && lz >= bounds.z0 && lz < bounds.z1;
}

/** null = outside castle region (skip); false = blocked wall column. */
export function castleInteriorWalkable(worldXM: number, worldZM: number): boolean | null {
  if (!isInCastleInterior(worldXM, worldZM)) return null;
  const { bounds, navCellM, cols, rows } = CASTLE_NAV_META;
  const lx = worldXM - CASTLE_NAV_META.anchor.x;
  const lz = worldZM - CASTLE_NAV_META.anchor.z;
  const col = Math.floor((lx - bounds.x0) / navCellM);
  const row = Math.floor((lz - bounds.z0) / navCellM);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return false;
  const idx = row * cols + col;
  for (const grid of decodeGrids()) {
    if (grid[idx] !== 0) return true;
  }
  return false;
}
