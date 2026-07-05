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

import { sstep, smoother, hash2 } from './rng.js';

export function createHeightfield(config, zones) {
  const L = config.lake;
  const M = config.zones.mountain;
  const FLTS = config.plateaus;
  const { mtnPathInfo, mtnStreamInfo, mtnCliffAt } = zones;

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

  /** Rolling base terrain (lake carved in). Flat east of x=500 (interiors). */
  function groundHeight(x, z) {
    if (x > 500) return 0;
    return lakeShape(
      x, z,
      Math.sin(x * 0.05) * Math.cos(z * 0.04) * 1.6 + Math.sin(x * 0.13 + z * 0.07) * 0.6 - 0.2
    );
  }

  function plateauInfo(x, z) {
    let pw = 0, pa = 0, maxMask = 0;
    for (const f of FLTS) {
      const fd = Math.hypot(x - f[0], z - f[1]);
      if (fd >= f[2] + f[3]) continue;
      const b = 1 - sstep(f[2], f[2] + f[3], fd);
      pw += b;
      pa += b * f[4];
      if (b > maxMask) maxMask = b;
    }
    return { mask: maxMask, weight: pw, h: pw > 0 ? pa / pw : 0 };
  }

  /** Mountain massif height: broad dome + ridges, with flat plateaus,
   *  unclimbable cliff shoulders, stream gullies, and walkable switchback
   *  corridors carved in. */
  function mtnH(x, z) {
    const dx = x - M.x, dz = z - M.z, d = Math.hypot(dx, dz);
    if (d >= M.r) return 0;
    const u = 1 - d / M.r;

    // Larger massif: readable from far away, but still with walkable lower flanks.
    let h = M.peakH * (0.66 * smoother(u) + 0.16 * sstep(0.08, 0.92, u));

    // Layered ridge character. Angular bands make the silhouette rocky rather
    // than perfectly conical; high-frequency hash mottling breaks flat slopes.
    const flank = u * (1 - u) * 2;
    const ang = Math.atan2(dz, dx);
    h += flank * (
      Math.sin(ang * 3.0 + d * 0.022) * M.peakH * 0.060 +
      Math.sin(x * 0.026 + z * 0.018) * M.peakH * 0.044 +
      Math.sin(ang * 7.0 - d * 0.010) * M.peakH * 0.034
    );

    const talus = sstep(0.12, 0.38, u) * (1 - sstep(0.76, 0.96, u));
    h += talus * (hash2(x * 0.075, z * 0.075) - 0.48) * M.peakH * 0.040;
    h += talus * (hash2(x * 0.145 + 7.1, z * 0.145 - 3.4) - 0.50) * M.peakH * 0.018;

    // Cliff shoulders: steep faces between authored shelves. The path carve
    // below cuts traversable notches through these bands.
    const cliff = mtnCliffAt?.(x, z) ?? 0;
    if (cliff > 0) {
      h += cliff * M.peakH * (0.10 + 0.035 * hash2(x * 0.11, z * 0.11));
    }

    // Carve flat plateaus — weighted blend so overlapping shelves ramp smoothly.
    const p = plateauInfo(x, z);
    if (p.weight > 0) {
      const w = p.weight > 1 ? 1 : p.weight;
      h = h * (1 - w) + p.h * w;
    }

    // Carve wide walkable switchback corridors. Stronger than the old 60% blend
    // so the authored grades read as usable trail cuts through the rocky mass.
    const pInfo = mtnPathInfo(x, z);
    if (pInfo.mask > 0) {
      const b = pInfo.mask * 0.76;
      h = h * (1 - b) + pInfo.h * b;
    }

    // Carve mountain streams/runoff last so they visibly cut through shelves and
    // across trail beds as shallow wet gullies.
    const sInfo = mtnStreamInfo?.(x, z) ?? { mask: 0, depth: 0 };
    if (sInfo.mask > 0) {
      h -= sInfo.depth * sInfo.mask * (0.65 + 0.35 * hash2(x * 0.22, z * 0.22));
    }

    return h > 0 ? h : 0;
  }

  /** Final terrain height — THE placement function for everything. */
  function surfaceY(x, z) {
    return groundHeight(x, z) + mtnH(x, z);
  }

  function slopeAt(x, z, sample = 2.4) {
    const dhdx = (surfaceY(x + sample, z) - surfaceY(x - sample, z)) / (2 * sample);
    const dhdz = (surfaceY(x, z + sample) - surfaceY(x, z - sample)) / (2 * sample);
    return Math.hypot(dhdx, dhdz);
  }

  /**
   * Terrain mobility hint for consumers that need actual no-climb gameplay.
   * Current terrain rendering only samples surfaceY, but movement/camera systems
   * can use this to reject traversal across cliff bands while allowing authored
   * switchback corridors and plateau shelves.
   */
  function terrainMobilityAt(x, z) {
    if (!zones.inMountain(x, z)) {
      return { climbable: true, slope: slopeAt(x, z), path: 0, plateau: 0, stream: 0, cliff: 0 };
    }
    const pInfo = mtnPathInfo(x, z);
    const stream = mtnStreamInfo?.(x, z) ?? { mask: 0 };
    const cliff = mtnCliffAt?.(x, z) ?? 0;
    const plateau = plateauInfo(x, z).mask;
    const slope = slopeAt(x, z);
    const protectedRoute = pInfo.mask > 0.18 || plateau > 0.35;
    return {
      climbable: protectedRoute || (slope < 0.78 && cliff < 0.45),
      slope,
      path: pInfo.mask,
      plateau,
      stream: stream.mask,
      cliff,
    };
  }

  return {
    lakeShape,
    lakeWaterDepthAt,
    lakeShoreAt,
    groundHeight,
    mtnH,
    surfaceY,
    slopeAt,
    terrainMobilityAt,
  };
}
