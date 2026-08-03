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
 *
 * A caveat on "agree by construction", recorded for P12: the guarantee is
 * bit-exact within one JS engine, and near-exact across engines. surfaceY uses
 * Math.hypot and the noise stack uses only +,*,floor (exact), but IEEE does not
 * pin transcendental/hypot results across runtimes. The server therefore must
 * NOT compare positions for equality against its own surfaceY — it validates
 * with tolerances (the moveRules speed-budget pattern), exactly as the Ashwood
 * moveGuard did. If bit-exactness ever matters, replace Math.hypot with
 * sqrt(x*x+z*z) and pin the server runtime; until then, tolerance is the
 * contract.
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

  /**
   * The three shared layer scalars, computed once so surfaceY and
   * shadeProxyAt (below) never evaluate the same noise twice. `mountainMask`
   * and `channel` are also the exact terms surfaceY already blended with —
   * shadeProxyAt reads the SAME values surfaceY produced this call, not a
   * second, possibly-drifted sample of "the same" noise.
   */
  function computeLayers(x, z) {
    const r = Math.hypot(x, z);

    const mountainMask = smoothstep(c.mountainStartM, c.mountainFullM, r);
    let ridge = 0;
    if (mountainMask > 0) {
      const w = warp2(x, z, { seed: c.seed + 101, amplitude: c.mountainWarpM, frequency: c.mountainFrequency });
      ridge = ridged2(w.x * c.mountainFrequency, w.z * c.mountainFrequency, {
        octaves: c.mountainOctaves, seed: c.seed + 211,
      });
    }

    // Ravines: a warped channel where noise crosses zero. |n| < width means
    // "in the channel"; the fold gives a V profile with a flat-ish floor.
    const rw = warp2(x, z, { seed: c.seed + 307, amplitude: c.ravineWarpM, frequency: c.ravineFrequency });
    const rn = fbm2(rw.x * c.ravineFrequency, rw.z * c.ravineFrequency, {
      octaves: 3, seed: c.seed + 401,
    });
    const channel = 1 - smoothstep(0, c.ravineWidth, Math.abs(rn));

    // Spawn vale: how strongly (x, z) sits in the flattened arrival ground.
    // Shared because shadeProxyAt needs to know "no ravine cut reads here"
    // for exactly the same footprint surfaceY flattens, not a second guess.
    const valeMask = 1 - smoothstep(c.valeRadiusM, c.valeRadiusM + c.valeFalloffM, r);

    return {
      r, mountainMask, ridge, channel, valeMask,
    };
  }

  function surfaceY(x, z) {
    const {
      mountainMask, ridge, channel, valeMask,
    } = computeLayers(x, z);

    // Base rolling hills.
    let y = fbm2(x * c.baseFrequency, z * c.baseFrequency, {
      octaves: c.baseOctaves, seed: c.seed,
    }) * c.baseAmplitudeM;

    // Mountains: ridged noise on a warped domain, fading in with distance so
    // the world reads as "vale ringed by crags" — dramatic horizon, safe center.
    y += ridge * c.mountainAmplitudeM * mountainMask;

    // Ravines do not cut the spawn vale or the high crags (rivers do not run
    // along ridgelines); mask by the inverse of the mountain mask.
    y -= channel * c.ravineDepthM * (1 - mountainMask);

    // Spawn vale: pull toward 0 near origin so arrival ground is gentle.
    y *= 1 - valeMask * 0.85;

    return y;
  }

  /**
   * A direction-agnostic "how structurally recessed is this patch" proxy in
   * [0, 1], baked once per vertex at chunk-gen time and painted as a self-
   * shadow tint. This is NOT occlusion: it has no idea what geometry sits
   * between (x, z) and the sun, so it cannot tell you a specific valley is in
   * a specific mountain's shadow right now. What it can do cheaply (zero new
   * noise evaluations — `computeLayers` is shared with surfaceY) is darken
   * the two kinds of terrain that read as "recessed" at any sun angle: ravine
   * floors (`channel`) and the lee troughs between ridge crests
   * (`1 - ridge`, masked to the mountain band so open rolling hills are never
   * darkened by a term that only means something in the crags). Ridge crests
   * themselves (`ridge` near 1) stay bright — exposed rock, not a cavity.
   *
   * `channel` is masked by `(1 - valeMask)` for the same reason surfaceY's
   * OWN height never shows a ravine cut in the spawn vale: without it, a
   * point could have a numerically high channel value — suppressed from
   * affecting HEIGHT by the vale multiplier, so no cut is visible there —
   * while still painting a dark, unexplained ravine tint right at spawn.
   */
  function shadeProxyAt(x, z) {
    const {
      mountainMask, ridge, channel, valeMask,
    } = computeLayers(x, z);
    const ridgeLee = (1 - ridge) * mountainMask;
    const channelRecess = channel * (1 - mountainMask) * (1 - valeMask);
    return Math.min(Math.max(channelRecess * 0.7 + ridgeLee * 0.6, 0), 1);
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

  return {
    surfaceY, normalAt, slopeAt, shadeProxyAt, config: c,
  };
}
