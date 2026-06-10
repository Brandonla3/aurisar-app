/**
 * zones — Wildwood / mountain membership tests and switchback-path fields.
 *
 * Pure math ported from the Ashwood prototype (public/reference/ashwood.html,
 * lines ~1288-1350). No Babylon, no I/O.
 */

import { sstep } from './rng.js';

export function createZones(config) {
  const F = config.zones.wildwood;
  const M = config.zones.mountain;
  const PTHS = config.mountainPaths;

  function inForest(x, z) {
    const dx = x - F.x, dz = z - F.z;
    return dx * dx + dz * dz < F.margin * F.margin;
  }

  function inMountain(x, z) {
    const dx = x - M.x, dz = z - M.z;
    return dx * dx + dz * dz < M.margin * M.margin;
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
        const sdx = bx - ax, sdz = bz - az;
        const sl2 = sdx * sdx + sdz * sdz;
        if (sl2 < 1) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * sdx + (z - az) * sdz) / sl2));
        const dd = Math.hypot(x - (ax + t * sdx), z - (az + t * sdz));
        const m = 1 - sstep(P.w * 0.5, P.w * 0.5 + P.w * 1.1, dd);
        if (m > 0) {
          const e = pts[i][2] + t * (pts[i + 1][2] - pts[i][2]);
          wsum += m;
          hacc += m * e;
          if (m > maxMask) maxMask = m;
        }
      }
    }
    return { mask: maxMask, h: wsum > 0 ? hacc / wsum : 0 };
  }

  /** Texture-only proximity to a switchback corridor. */
  function mtnPathMask(x, z) {
    return mtnPathInfo(x, z).mask;
  }

  return { inForest, inMountain, mtnPathInfo, mtnPathMask };
}
