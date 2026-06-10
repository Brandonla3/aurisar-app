/**
 * heightfield — the Ashwood analytic terrain function.
 *
 * Pure math ported from the prototype (public/reference/ashwood.html):
 *   lakeShape / lakeWaterDepthAt  (lines ~3527-3535)
 *   groundHeight                  (line  ~3536)
 *   mtnH                          (line  ~1352)
 *   surfaceY = groundHeight + mtnH
 *
 * No Babylon, no I/O. Every entity placement in the scene must use
 * surfaceY(x, z) — the server only knows 2D positions; height is a pure
 * client-side function of this module.
 */

import { sstep, smoother } from './rng.js';

export function createHeightfield(config, zones) {
  const L = config.lake;
  const M = config.zones.mountain;
  const FLTS = config.plateaus;
  const { mtnPathInfo } = zones;

  /** Carve the Mirrormere bowl into a base height h. */
  function lakeShape(x, z, h) {
    const d = Math.hypot(x - L.x, z - L.z);
    if (d >= L.bowlR + L.blend) return h;
    if (d <= L.bowlR) {
      return L.level + L.lip - L.depth * smoother(Math.min(1, (L.bowlR - d) / (L.bowlR * 0.6)));
    }
    const t = smoother((d - L.bowlR) / L.blend);
    return (L.level + L.lip) * (1 - t) + h * t;
  }

  /** Water depth above the lakebed at (x,z); 0 outside the lake bowl. */
  function lakeWaterDepthAt(x, z) {
    const d = Math.hypot(x - L.x, z - L.z);
    return d < L.bowlR + L.blend ? Math.max(0, L.level - groundHeight(x, z)) : 0;
  }

  /** Rolling base terrain (lake carved in). Flat east of x=500 (interiors). */
  function groundHeight(x, z) {
    if (x > 500) return 0;
    return lakeShape(
      x, z,
      Math.sin(x * 0.05) * Math.cos(z * 0.04) * 1.6 + Math.sin(x * 0.13 + z * 0.07) * 0.6 - 0.2
    );
  }

  /** Mountain massif height: broad smootherstep dome + ridges, with flat
   *  plateaus and walkable switchback corridors carved in. */
  function mtnH(x, z) {
    const dx = x - M.x, dz = z - M.z, d = Math.hypot(dx, dz);
    if (d >= M.r) return 0;
    const u = 1 - d / M.r;

    // gentle broad massif — walkable flanks, no needle peaks
    let h = M.peakH * 0.78 * smoother(u);

    // light ridge character, strongest on the flanks, calm near the top
    const flank = u * (1 - u) * 2;
    const ang = Math.atan2(dz, dx);
    h += flank * (
      Math.sin(ang * 3 + d * 0.02) * M.peakH * 0.05 +
      Math.sin(x * 0.02 + z * 0.017) * M.peakH * 0.04 +
      Math.sin(ang * 6 - 1.2) * M.peakH * 0.028
    );

    // carve flat plateaus — weighted blend so overlapping shelves ramp smoothly
    let pw = 0, pa = 0;
    for (const f of FLTS) {
      const fd = Math.hypot(x - f[0], z - f[1]);
      if (fd >= f[2] + f[3]) continue;
      const b = 1 - sstep(f[2], f[2] + f[3], fd);
      pw += b;
      pa += b * f[4];
    }
    if (pw > 0) {
      const w = pw > 1 ? 1 : pw;
      h = h * (1 - w) + (pa / pw) * w;
    }

    // carve wide walkable switchback corridors
    const pInfo = mtnPathInfo(x, z);
    if (pInfo.mask > 0) {
      const b = pInfo.mask * 0.6;
      h = h * (1 - b) + pInfo.h * b;
    }

    return h > 0 ? h : 0;
  }

  /** Final terrain height — THE placement function for everything. */
  function surfaceY(x, z) {
    return groundHeight(x, z) + mtnH(x, z);
  }

  return { lakeShape, lakeWaterDepthAt, groundHeight, mtnH, surfaceY };
}
