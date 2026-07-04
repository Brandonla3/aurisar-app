/**
 * Castle interior nav validation for SpacetimeDB movePlayer.
 * Mirrors src/features/world/castle/castleNavServer.js column-walkable checks.
 */

import { CASTLE_NAV_META, CASTLE_NAV_BITMAPS_B64 } from './navGrids.js';

let decoded: Uint16Array[] | null = null;

function decodeBase64(b64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;

  const len = b64.length;
  const outLen = (len * 3) >> 2;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = lookup[b64.charCodeAt(i)];
    const b = lookup[b64.charCodeAt(i + 1)];
    const c = lookup[b64.charCodeAt(i + 2)];
    const d = lookup[b64.charCodeAt(i + 3)];
    out[o++] = (a << 2) | (b >> 4);
    if (b64[i + 2] !== '=') out[o++] = ((b & 15) << 4) | (c >> 2);
    if (b64[i + 3] !== '=') out[o++] = ((c & 3) << 6) | d;
  }
  return out;
}

function decodeGrids(): Uint16Array[] {
  if (decoded) return decoded;
  decoded = CASTLE_NAV_BITMAPS_B64.map((b64) => {
    const bytes = decodeBase64(b64);
    return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
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
