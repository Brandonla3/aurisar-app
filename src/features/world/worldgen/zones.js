/**
 * zones — Wildwood / mountain membership tests and switchback-path fields.
 *
 * Pure math ported from the Ashwood prototype (public/reference/ashwood.html,
 * lines ~1288-1350). No Babylon, no I/O.
 */

import { sstep } from './rng.js';

const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

export function createZones(config) {
  const F = config.zones.wildwood;
  const M = config.zones.mountain;
  const PTHS = config.mountainPaths;
  const STREAMS = config.mountainStreams ?? [];
  const CLIFFS = config.mountainCliffs ?? [];

  function inForest(x, z) {
    const dx = x - F.x, dz = z - F.z;
    return dx * dx + dz * dz < F.margin * F.margin;
  }

  function inMountain(x, z) {
    const dx = x - M.x, dz = z - M.z;
    return dx * dx + dz * dz < M.margin * M.margin;
  }

  function segmentHit(x, z, ax, az, bx, bz, halfWidth, feather) {
    const sdx = bx - ax, sdz = bz - az;
    const sl2 = sdx * sdx + sdz * sdz;
    if (sl2 < 1) return null;
    const t = Math.max(0, Math.min(1, ((x - ax) * sdx + (z - az) * sdz) / sl2));
    const px = ax + t * sdx, pz = az + t * sdz;
    const dd = Math.hypot(x - px, z - pz);
    const mask = 1 - sstep(halfWidth, halfWidth + feather, dd);
    return mask > 0 ? { mask, t, dd } : null;
  }

  /**
   * Switchback influence at (x,z) → { mask: 0..1, h: corridor elevation },
   * blended across nearby segments of all routes.
   */
  function mtnPathInfo(x, z) {
    let maxMask = 0, wsum = 0, hacc = 0;
    for (const P of PTHS) {
      const pts = P.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0], az = pts[i][1];
        const bx = pts[i + 1][0], bz = pts[i + 1][1];
        const hit = segmentHit(x, z, ax, az, bx, bz, P.w * 0.5, P.w * 1.1);
        if (!hit) continue;
        const e = pts[i][2] + hit.t * (pts[i + 1][2] - pts[i][2]);
        wsum += hit.mask;
        hacc += hit.mask * e;
        if (hit.mask > maxMask) maxMask = hit.mask;
      }
    }
    return { mask: maxMask, h: wsum > 0 ? hacc / wsum : 0 };
  }

  /** Texture-only proximity to a switchback corridor. */
  function mtnPathMask(x, z) {
    return mtnPathInfo(x, z).mask;
  }

  /**
   * Narrow stream / runoff influence on the mountain. Streams are declarative
   * polylines in config so the terrain can carve gullies deterministically and
   * renderers can later add water ribbons without consuming RNG.
   */
  function mtnStreamInfo(x, z) {
    let maxMask = 0, wsum = 0, depthAcc = 0, levelAcc = 0;
    for (const S of STREAMS) {
      const pts = S.pts ?? [];
      const half = (S.w ?? 6) * 0.5;
      const feather = S.feather ?? (S.w ?? 6) * 0.85;
      const depth = S.depth ?? 1.2;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0], az = pts[i][1];
        const bx = pts[i + 1][0], bz = pts[i + 1][1];
        const hit = segmentHit(x, z, ax, az, bx, bz, half, feather);
        if (!hit) continue;
        const aLevel = pts[i][2] ?? 0;
        const bLevel = pts[i + 1][2] ?? aLevel;
        const level = aLevel + hit.t * (bLevel - aLevel);
        wsum += hit.mask;
        depthAcc += hit.mask * depth;
        levelAcc += hit.mask * level;
        if (hit.mask > maxMask) maxMask = hit.mask;
      }
    }
    return {
      mask: maxMask,
      depth: wsum > 0 ? depthAcc / wsum : 0,
      level: wsum > 0 ? levelAcc / wsum : 0,
    };
  }

  function mtnStreamMask(x, z) {
    return mtnStreamInfo(x, z).mask;
  }

  /**
   * Radial cliff-band mask. Bands are intentionally incomplete rings/shoulders:
   * they create readable unclimbable faces between plateaus without blocking the
   * authored switchback corridors that cut through them.
   */
  function mtnCliffAt(x, z) {
    let k = 0;
    for (const C of CLIFFS) {
      const cx = C.x ?? M.x, cz = C.z ?? M.z;
      const d = Math.hypot(x - cx, z - cz);
      const width = C.width ?? 12;
      let band = 1 - sstep(width, width * 2.15, Math.abs(d - C.r));
      if (band <= 0) continue;

      if (C.arc) {
        const a = Math.atan2(z - cz, x - cx);
        const mid = C.arc[0];
        const half = C.arc[1] * 0.5;
        const diff = Math.abs(Math.atan2(Math.sin(a - mid), Math.cos(a - mid)));
        band *= 1 - sstep(half, half + (C.arcFeather ?? 0.35), diff);
      }

      k = Math.max(k, band * (C.amount ?? 1));
    }
    return clamp01(k);
  }

  return {
    inForest,
    inMountain,
    mtnPathInfo,
    mtnPathMask,
    mtnStreamInfo,
    mtnStreamMask,
    mtnCliffAt,
  };
}
