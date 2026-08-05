/**
 * vegDensity — where vegetation wants to grow, as ONE definition with TWO
 * emitters (the skyModel.js pattern, honestly scoped).
 *
 * PURE. `canopyDensityJs` drives real tree PLACEMENT (model/propPlacement);
 * `emitCanopyDensityBsl` paints the far-tier terrain TINT (beyond the mid
 * ring no tree instances exist — the terrain shader tints distant pixels
 * from this same curve, so a dense-tinted far hill is the same hill that
 * grows real trees on approach).
 *
 * Scope of the identity, stated precisely: the BAND terms — the forest-belt
 * curve over the mountain mask, the vale clearing, the slope cutoff — share
 * CANOPY_DENSITY_DEF constants byte-for-byte via toFixed, exactly like the
 * sky gradient. The GROVE-scale clumping noise does NOT match: JS uses the
 * gameplay-deterministic imul-based fbm2 (which float shader code cannot
 * reproduce), the shader uses its established cosmetic value noise. That is
 * the same cosmetic-noise carve-out terrainShaderLib.js already documents —
 * at 160m+ through EXP2 fog, band agreement is what the eye can check;
 * a grove boundary 20m off is beneath perception. No gameplay decision may
 * ever read the shader's version.
 *
 * The mountain-band breakpoints reference DEFAULT_TERRAIN's own numbers, so
 * the tint's forest belt sits exactly where the height field grows its
 * mountains — one source for where the world changes character.
 */

import { fbm2 } from './noise.js';
import { DEFAULT_TERRAIN } from './terrainField.js';

export const CANOPY_DENSITY_DEF = Object.freeze({
  /** Forest-belt curve over mountainMask: rises past `beltIn`, peaks, falls
   *  to `beltHighFloor` by mask 1 (sparse hardy pines on the high crags). */
  beltIn: 0.05,
  beltPeak: 0.45,
  beltOut: 0.95,
  beltHighFloor: 0.25,
  /** Meadow baseline density where the belt term is zero. */
  meadowBase: 0.18,
  /** Vale clearing: trees thin toward spawn by this factor at full mask. */
  valeClear: 0.85,
  /** Trees reject slopes steeper than this (0 flat .. 1 vertical). */
  slopeMax: 0.55,
  /** Grove clumping noise: frequency and the band that reads as "grove". */
  groveFreq: 0.035,
  groveLo: 0.38,
  groveHi: 0.62,
});

const smoothstep = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/** The belt curve alone — shared shape between JS and BSL. */
function beltCurve(mountainMask, d) {
  const rise = smoothstep(d.beltIn, d.beltPeak, mountainMask);
  const fall = smoothstep(d.beltPeak, d.beltOut, mountainMask);
  return rise * (1 - fall * (1 - d.beltHighFloor));
}

/**
 * Canopy density in [0, 1] at a point. `layers` are terrainField scalars
 * ({ mountainMask, valeMask }); slope and channel rejection happen in the
 * placement pass (they need exact field reads placement already pays for on
 * accepted candidates only).
 */
export function canopyDensityJs(x, z, { mountainMask, valeMask }, seed = DEFAULT_TERRAIN.seed) {
  const d = CANOPY_DENSITY_DEF;
  const belt = beltCurve(mountainMask, d);
  const base = d.meadowBase * (1 - belt) + belt;
  const grove = smoothstep(
    d.groveLo, d.groveHi,
    fbm2(x * d.groveFreq, z * d.groveFreq, { octaves: 3, seed: seed + 977 }) * 0.5 + 0.5,
  );
  return base * grove * (1 - valeMask * d.valeClear);
}

const f = (n) => n.toFixed(4);

/**
 * BSL body for `float realmCanopyDensity(vec2 xz, float slopeApprox)`.
 * Band terms carry CANOPY_DENSITY_DEF and DEFAULT_TERRAIN constants
 * stamped byte-for-byte; grove clumping uses the shader's cosmetic
 * realmVnoise (declared in terrainShaderLib's helpers, which the caller
 * must include). Slope enters as an approximation from the interpolated
 * normal — a soft fade toward slopeMax, not the placement pass's hard
 * reject, because a fragment can't reject, only dim.
 */
export function emitCanopyDensityBsl(terrainConfig = DEFAULT_TERRAIN) {
  // Takes the terrain config as a parameter (review catch): baking
  // DEFAULT_TERRAIN unconditionally meant the first zone config overriding
  // mountainStartM would silently desynchronize the far tint from actual
  // tree placement — the exact identity this module exists to guarantee.
  // Today's one caller passes nothing (the spike world IS default terrain);
  // a zone system must thread its config through.
  const d = CANOPY_DENSITY_DEF;
  const t = terrainConfig;
  return `
    float r = length(xz);
    float mountainMask = smoothstep(${f(t.mountainStartM)}, ${f(t.mountainFullM)}, r);
    float valeMask = 1.0 - smoothstep(${f(t.valeRadiusM)}, ${f(t.valeRadiusM + t.valeFalloffM)}, r);
    float rise = smoothstep(${f(d.beltIn)}, ${f(d.beltPeak)}, mountainMask);
    float fall = smoothstep(${f(d.beltPeak)}, ${f(d.beltOut)}, mountainMask);
    float belt = rise * (1.0 - fall * ${f(1 - d.beltHighFloor)});
    float base = ${f(d.meadowBase)} * (1.0 - belt) + belt;
    float grove = smoothstep(${f(d.groveLo)}, ${f(d.groveHi)}, realmVnoise(xz * ${f(d.groveFreq)}));
    float slopeFade = 1.0 - smoothstep(${f(d.slopeMax * 0.7)}, ${f(d.slopeMax)}, slopeApprox);
    return base * grove * (1.0 - valeMask * ${f(d.valeClear)}) * slopeFade;`;
}
