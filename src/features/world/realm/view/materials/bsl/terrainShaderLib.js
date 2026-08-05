/**
 * terrainShaderLib — the BSL sources the terrain material is painted with.
 *
 * Plain strings + factory functions returning configured RealmFnBlock
 * instances. Written once in BabylonSL, transpiled per backend at build time.
 *
 * IMPORTANT SCOPE NOTE: this noise is COSMETIC. It varies albedo, never
 * geometry. The gameplay surface is model/terrainField.js (JS, deterministic,
 * shared with the future server); shader noise only has to look good, so it
 * uses the cheap classic sin-dot hash rather than reproducing hash2 — the two
 * never need to agree, and no gameplay decision may ever read a shader value.
 *
 * BSL constraints honoured here: no ternaries (branchless mix/step instead),
 * GLSL-style declarations, helper functions above the entry function.
 */

import { RealmFnBlock } from './RealmFnBlock.js';
import { emitCanopyDensityBsl } from '../../../model/vegDensity.js';
import { TIER_BANDS_M } from '../../../model/propLod.js';

/** Shared value-noise helpers: hash → bilinear value noise, quintic fade. */
const NOISE_HELPERS = `
float realmHash21(vec2 p)
{
    float h = dot(p, vec2(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

float realmVnoise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = realmHash21(i);
    float b = realmHash21(i + vec2(1.0, 0.0));
    float c = realmHash21(i + vec2(0.0, 1.0));
    float d = realmHash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

/**
 * 4-octave FBM → [0, 1]. Fixed octave count: a uniform-driven loop bound would
 * defeat WGSL loop unrolling and buy nothing — tier scaling happens by choosing
 * a different block, not a runtime knob.
 */
export function createFbmBlock(name = 'realmFbm') {
  return new RealmFnBlock(name, {
    fnName: 'realmFbm4',
    params: [{ name: 'p', type: 'vec2' }],
    returnType: 'float',
    helpers: NOISE_HELPERS,
    body: `
    float sum = 0.0;
    float amp = 0.5;
    vec2 q = p;
    for (int i = 0; i < 4; i++)
    {
        sum = sum + realmVnoise(q) * amp;
        q = q * 2.03;
        amp = amp * 0.5;
    }
    return sum;`,
  });
}

/**
 * Painterly macro-variation: two FBM samples at different scales, remapped to
 * a soft [0,1] mask. One block instead of a graph of arithmetic blocks — the
 * NME graph stays readable when the interesting math lives in one place.
 */
export function createMacroVariationBlock(name = 'realmMacro') {
  return new RealmFnBlock(name, {
    fnName: 'realmMacroVar',
    params: [{ name: 'p', type: 'vec2' }],
    returnType: 'float',
    helpers: NOISE_HELPERS,
    body: `
    float broad = realmVnoise(p * 0.35);
    float fine = realmVnoise(p * 1.7);
    float v = broad * 0.7 + fine * 0.3;
    return smoothstep(0.25, 0.75, v);`,
  });
}

/**
 * The full terrain paint, as ONE fragment-stage function: slope/height splat
 * of four procedural layers plus macro variation and a subtle height tint.
 *
 * Inputs are world position + world normal; output is the lit-ready albedo.
 * Doing the whole blend in BSL rather than ~30 stock blocks is a deliberate
 * trade: the graph carries transforms/lighting/fog (where stock blocks earn
 * their keep), the painting lives here where it reads as one paragraph.
 */
export function createTerrainPaintBlock(name = 'realmPaint', palette = TERRAIN_PALETTE) {
  const v3 = (c) => `vec3(${c.map((n) => n.toFixed(4)).join(', ')})`;
  // The drop-shipped far tier: beyond the mid LOD band no tree INSTANCES
  // exist at all — distant forest is painted INTO the terrain from the same
  // vegDensity curve the placer reads (band constants shared byte-for-byte;
  // see model/vegDensity.js for the honest scope of that identity). The
  // band start is pinned to the prop tiers' own midMaxM, so tint begins
  // exactly where instances end. Canopy tint derives from the palette
  // (deep-shadowed grassLow), not a free new color — a palette retune moves
  // the far forest with it.
  const FAR_START = TIER_BANDS_M.midMaxM;
  const FAR_FULL = TIER_BANDS_M.midMaxM + 100;
  return new RealmFnBlock(name, {
    fnName: 'realmTerrainPaint',
    params: [
      { name: 'wpos', type: 'vec3' },
      { name: 'wnrm', type: 'vec3' },
      { name: 'campos', type: 'vec3' },
    ],
    returnType: 'vec3',
    helpers: `${NOISE_HELPERS}
float realmCanopyDensity(vec2 xz, float slopeApprox)
{${emitCanopyDensityBsl()}
}`,
    body: `
    vec2 xz = wpos.xz;
    float slope = 1.0 - clamp(wnrm.y, 0.0, 1.0);
    float height = wpos.y;

    float macro = smoothstep(0.25, 0.75, realmVnoise(xz * 0.02) * 0.7 + realmVnoise(xz * 0.11) * 0.3);
    float detail = 0.0;
    float amp = 0.5;
    vec2 q = xz * 0.35;
    for (int i = 0; i < 4; i++)
    {
        detail = detail + realmVnoise(q) * amp;
        q = q * 2.03;
        amp = amp * 0.5;
    }

    vec3 grass = mix(${v3(palette.grassLow)}, ${v3(palette.grassHigh)}, macro);
    vec3 dirt  = ${v3(palette.dirt)};
    vec3 rock  = mix(${v3(palette.rockLow)}, ${v3(palette.rockHigh)}, detail);
    vec3 snow  = ${v3(palette.snow)};

    vec3 c = mix(grass, dirt, smoothstep(0.30, 0.62, detail) * 0.55);
    c = mix(c, rock, smoothstep(0.22, 0.42, slope));
    c = mix(c, snow, smoothstep(30.0, 40.0, height) * (1.0 - smoothstep(0.45, 0.7, slope)));

    float farBand = smoothstep(${FAR_START.toFixed(1)}, ${FAR_FULL.toFixed(1)}, length(xz - campos.xz));
    float veg = realmCanopyDensity(xz, slope);
    vec3 canopyTint = ${v3(palette.grassLow)} * 0.55;
    c = mix(c, canopyTint, farBand * veg * 0.6);

    float tonal = 0.88 + detail * 0.24;
    return c * tonal;`,
  });
}

/**
 * The stylized palette — higher chroma than the Painted Realism bar it
 * replaces, hand-painted-look value ranges. Exported so tests and the future
 * art bible reference one set of numbers.
 */
export const TERRAIN_PALETTE = Object.freeze({
  grassLow: [0.263, 0.416, 0.224], // deep meadow green
  grassHigh: [0.451, 0.529, 0.243], // sun-struck grass
  dirt: [0.412, 0.322, 0.212], // warm loam
  rockLow: [0.357, 0.353, 0.373], // cool granite
  rockHigh: [0.522, 0.494, 0.478], // weathered face
  snow: [0.878, 0.894, 0.925], // blue-white cap
});
