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

  // Optional settlement pad: a radial flatten so a large rigid structure
  // (the starter village GLB) sits on level ground. Flat inside `r`,
  // smoother-blended back into the rolling terrain by `blendR`. The pad
  // height is the rolling terrain sampled at the pad center, so the flatten
  // is exactly "freeze the terrain at this spot".
  const PAD = config.settlementPad ?? null;
  const padH = PAD ? rollingH(PAD.x, PAD.z) : 0;

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

  /** Sandy-shore factor at (x,z): 1 on the beach strip hugging the lake
   *  waterline, fading to 0 by ~1.1m above water level, so the band follows
   *  the real shore contour (wide on gentle banks, narrow on steep ones).
   *  Also 1 below the waterline — the renderer's silt tint overrides where
   *  there is actual water, leaving sand visible through the shallows.
   *  A radial fade caps the band on very flat banks (the bowl's blend ring
   *  can sit barely above water level for 15m+, which would otherwise read
   *  as a desert, not a beach). */
  function lakeShoreAt(x, z) {
    const d = Math.hypot(x - L.x, z - L.z);
    if (d >= L.bowlR + 10) return 0;
    return (1 - sstep(0.35, 1.1, groundHeight(x, z) - L.level))
         * (1 - sstep(L.bowlR + 4, L.bowlR + 10, d));
  }

  /** Rolling base terrain formula (no lake, no pad). */
  function rollingH(x, z) {
    return Math.sin(x * 0.05) * Math.cos(z * 0.04) * 1.6 + Math.sin(x * 0.13 + z * 0.07) * 0.6 - 0.2;
  }

  /** Rolling base terrain (settlement pad + lake carved in). Flat east of
   *  x=500 (interiors). */
  function groundHeight(x, z) {
    if (x > 500) return 0;
    let h = rollingH(x, z);
    if (PAD) {
      const d = Math.hypot(x - PAD.x, z - PAD.z);
      if (d < PAD.blendR) {
        const t = d <= PAD.r ? 1 : 1 - smoother((d - PAD.r) / (PAD.blendR - PAD.r));
        h = h * (1 - t) + padH * t;
      }
    }
    return lakeShape(x, z, h);
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

  return { lakeShape, lakeWaterDepthAt, lakeShoreAt, groundHeight, mtnH, surfaceY };
}
