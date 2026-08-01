/**
 * terrainField — THE height function. surfaceY(x, z) and its derivatives.
 *
 * PURE and deterministic in (x, z, config). This one function is the terrain:
 * the mesh generator tessellates it, the collision probe walks it, the player
 * stands on it, and (in P12) the server validates against it. Client and
 * server agree on the ground BY CONSTRUCTION because there is nothing to sync —
 * both just call this.
 *
 * Composition, painted with three brushes over a base:
 *   base    rolling FBM hills — the readable, walkable ground floor
 *   ridges  ridged multifractal, masked to a mountain band and domain-warped
 *           so crests meander (WoW/LotR silhouette, not lattice lines)
 *   ravine  a warped noise channel folded into a valley cut — winding, deep,
 *           with walkable floor
 *   vale    a gentle radial flattening near the spawn so new players stand on
 *           friendly ground instead of a cliff face
 *
 * Every knob lives in DEFAULT_TERRAIN so a zone config can replace the numbers
 * without touching the math.
 */

import { fbm2, ridged2, warp2 } from './noise.js';

export const DEFAULT_TERRAIN = Object.freeze({
  seed: 20260801,

  /** Rolling base. */
  baseAmplitudeM: 6,
  baseFrequency: 1 / 90,
  baseOctaves: 4,

  /** Mountain band: ridges fade in beyond this radius from origin. */
  mountainStartM: 160,
  mountainFullM: 420,
  mountainAmplitudeM: 55,
  mountainFrequency: 1 / 220,
  mountainOctaves: 5,
  mountainWarpM: 60,

  /** Ravine channel. */
  ravineDepthM: 14,
  ravineFrequency: 1 / 260,
  ravineWidth: 0.08,
  ravineWarpM: 90,

  /** Spawn vale: flatten within this radius. */
  valeRadiusM: 40,
  valeFalloffM: 55,
});

const smoothstep = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

export function createTerrainField(config = DEFAULT_TERRAIN) {
  const c = { ...DEFAULT_TERRAIN, ...config };

  function surfaceY(x, z) {
    const r = Math.hypot(x, z);

    // Base rolling hills.
    let y = fbm2(x * c.baseFrequency, z * c.baseFrequency, {
      octaves: c.baseOctaves, seed: c.seed,
    }) * c.baseAmplitudeM;

    // Mountains: ridged noise on a warped domain, fading in with distance so
    // the world reads as "vale ringed by crags" — dramatic horizon, safe center.
    const mountainMask = smoothstep(c.mountainStartM, c.mountainFullM, r);
    if (mountainMask > 0) {
      const w = warp2(x, z, { seed: c.seed + 101, amplitude: c.mountainWarpM, frequency: c.mountainFrequency });
      const ridge = ridged2(w.x * c.mountainFrequency, w.z * c.mountainFrequency, {
        octaves: c.mountainOctaves, seed: c.seed + 211,
      });
      y += ridge * c.mountainAmplitudeM * mountainMask;
    }

    // Ravines: a warped channel where noise crosses zero. |n| < width means
    // "in the channel"; the fold gives a V profile with a flat-ish floor.
    const rw = warp2(x, z, { seed: c.seed + 307, amplitude: c.ravineWarpM, frequency: c.ravineFrequency });
    const rn = fbm2(rw.x * c.ravineFrequency, rw.z * c.ravineFrequency, {
      octaves: 3, seed: c.seed + 401,
    });
    const channel = 1 - smoothstep(0, c.ravineWidth, Math.abs(rn));
    // Ravines do not cut the spawn vale or the high crags (rivers do not run
    // along ridgelines); mask by the inverse of the mountain mask.
    y -= channel * c.ravineDepthM * (1 - mountainMask);

    // Spawn vale: pull toward 0 near origin so arrival ground is gentle.
    const valeMask = 1 - smoothstep(c.valeRadiusM, c.valeRadiusM + c.valeFalloffM, r);
    y *= 1 - valeMask * 0.85;

    return y;
  }

  /**
   * Analytic-by-differencing normal. `eps` at 0.35m matches the finest mesh
   * step closely enough that lighting agrees with silhouette.
   */
  function normalAt(x, z, eps = 0.35) {
    const hL = surfaceY(x - eps, z);
    const hR = surfaceY(x + eps, z);
    const hD = surfaceY(x, z - eps);
    const hU = surfaceY(x, z + eps);
    // Cross product of the two tangents, unrolled.
    const nx = hL - hR;
    const nz = hD - hU;
    const ny = 2 * eps;
    const inv = 1 / Math.hypot(nx, ny, nz);
    return { x: nx * inv, y: ny * inv, z: nz * inv };
  }

  /** 0 = flat, 1 = vertical. What movement and vegetation density branch on. */
  function slopeAt(x, z) {
    return 1 - normalAt(x, z).y;
  }

  return { surfaceY, normalAt, slopeAt, config: c };
}
