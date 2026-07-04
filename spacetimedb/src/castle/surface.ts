/**
 * Level-aware castle surfaceAt for SpacetimeDB — mirrors castleNavSurface.js.
 */

import {
  CASTLE_NAV_META,
  CASTLE_NAV_BITMAPS_B64,
  CASTLE_LEVELS,
  CASTLE_STAIRS,
  CASTLE_STEP_UP,
  CASTLE_STEP_DOWN,
} from './navGrids.js';

type Stair = typeof CASTLE_STAIRS[number];
type Surface = { y: number; level: number };

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

function stairSurfaceY(st: Stair, x: number, z: number): number | null {
  const yLo = CASTLE_LEVELS[st.lo].y;
  const yHi = CASTLE_LEVELS[st.hi].y;
  const yMid = (yLo + yHi) / 2;
  const u = st.axis === 'z' ? z : x;
  const v = st.axis === 'z' ? x : z;
  const u1 = st.u0 + st.runLen;
  const u2 = u1 + st.landingD;
  const vA0 = st.v0, vA1 = st.v0 + st.laneW;
  const vB0 = vA1 + st.gap, vB1 = vB0 + st.laneW;

  if (u >= u1 && u <= u2 && v >= vA0 && v <= vB1) return yMid;
  if (u < st.u0 || u > u1) return null;
  const t = (u - st.u0) / st.runLen;
  if (v >= vA0 && v <= vA1) return yLo + t * (yMid - yLo);
  if (v >= vB0 && v <= vB1) return yHi + t * (yMid - yHi);
  return null;
}

function surfaceAt(wx: number, wz: number, currentY: number): Surface | null {
  const { anchor, bounds, navCellM, cols, rows } = CASTLE_NAV_META;
  const x = wx - anchor.x, z = wz - anchor.z;
  if (x < bounds.x0 || x >= bounds.x1 || z < bounds.z0 || z >= bounds.z1) return null;

  const col = Math.floor((x - bounds.x0) / navCellM);
  const row = Math.floor((z - bounds.z0) / navCellM);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
  const idx = row * cols + col;
  const grids = decodeGrids();

  const stairYCache = CASTLE_STAIRS.map((st) => {
    const u2 = st.u0 + st.runLen + st.landingD;
    return (lx: number, lz: number) => {
      let u = st.axis === 'z' ? lz : lx;
      const v = st.axis === 'z' ? lx : lz;
      u = Math.min(Math.max(u, st.u0), u2);
      return st.axis === 'z'
        ? stairSurfaceY(st, v, u)
        : stairSurfaceY(st, u, v);
    };
  });

  let bestY = -Infinity, bestLevel = -1;
  for (let li = 0; li < grids.length; li++) {
    const v = grids[li][idx];
    if (v === 0) continue;
    let y: number, level = li;
    if (v === 1) {
      y = CASTLE_LEVELS[li].y;
    } else {
      const sy = stairYCache[v - 2](x, z);
      if (sy == null) continue;
      y = sy;
      const st = CASTLE_STAIRS[v - 2];
      level = y >= (CASTLE_LEVELS[st.lo].y + CASTLE_LEVELS[st.hi].y) / 2 ? st.hi : st.lo;
    }
    if (y <= currentY + CASTLE_STEP_UP && y >= currentY - CASTLE_STEP_DOWN && y > bestY) {
      bestY = y; bestLevel = level;
    }
  }
  return bestLevel >= 0 ? { y: bestY, level: bestLevel } : null;
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

/** null = outside castle; otherwise surface reachable at currentY. */
export function castleInteriorSurfaceAt(
  worldXM: number,
  worldZM: number,
  currentY: number,
): Surface | null {
  if (!isInCastleInterior(worldXM, worldZM)) return null;
  return surfaceAt(worldXM, worldZM, currentY);
}

/** null = skip validation; false = blocked; true = allowed. */
export function castleInteriorMoveAllowed(
  worldXM: number,
  worldZM: number,
  currentY: number,
): boolean | null {
  if (!isInCastleInterior(worldXM, worldZM)) return null;
  return castleInteriorSurfaceAt(worldXM, worldZM, currentY) != null;
}
