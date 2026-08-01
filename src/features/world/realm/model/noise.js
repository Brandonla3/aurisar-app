/**
 * noise — deterministic 2D value noise and the fractal stacks built on it.
 *
 * PURE. Everything here is a function of (x, z, seed). No state, no Date.now,
 * no Math.random: the same coordinates always give the same terrain, which is
 * the entire multiplayer contract — every client AND the server must agree on
 * the ground without ever exchanging it.
 *
 * Value noise rather than Perlin/simplex on purpose: it needs only a lattice
 * hash and a smoothstep blend, which keeps `surfaceY` cheap enough to call
 * per-vertex at generation time AND per-frame for collision, and it has no
 * patent/implementation-subtlety folklore attached. The visual difference is
 * irrelevant once octaves and domain warp are stacked on top.
 */

/**
 * Deterministic lattice hash → [0, 1). Same idea as the worldgen rng family.
 *
 * Every multiply goes through Math.imul. The first version used a plain `*`
 * with a 61-bit constant, and for realistic seeds (~2e7) the product reached
 * ~2^85 — where a double's ulp exceeds 2^32, so the ix/iz terms were entirely
 * absorbed by rounding and the "noise" became a constant. Terrain rendered as
 * a featureless plane for the real seed while the small-seed unit grid looked
 * perfectly healthy. imul keeps every intermediate in int32, where addition
 * and ToInt32 are exact.
 */
export function hash2(ix, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  // >>> 0 maps to uint32; divide maps to [0, 1).
  return (h >>> 0) / 4294967296;
}

/** Quintic fade — C2-continuous, so lattice lines never show as normal creases. */
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** Single octave of 2D value noise → [-1, 1]. */
export function valueNoise2(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;

  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);

  const u = fade(fx);
  const v = fade(fz);
  return (lerp(lerp(a, b, u), lerp(c, d, u), v) - 0.5) * 2;
}

/**
 * Fractal Brownian motion → [-1, 1]. Rolling hills and large-scale undulation.
 * Each octave doubles frequency and halves amplitude; `norm` keeps the output
 * range independent of octave count so tuning octaves does not rescale the world.
 */
export function fbm2(x, z, { octaves = 4, seed = 0, lacunarity = 2, gain = 0.5 } = {}) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    // Per-octave seed offset: otherwise every octave samples the SAME lattice
    // at doubled frequency and the self-similarity reads as visible ghosting.
    sum += valueNoise2(x * freq, z * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/**
 * Ridged multifractal → [0, 1]. Sharp mountain crests: fold the noise around
 * zero and invert, so values near 0 become knife-edge ridges near 1.
 */
export function ridged2(x, z, { octaves = 4, seed = 0, lacunarity = 2, gain = 0.5 } = {}) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise2(x * freq, z * freq, seed + i * 2027));
    // Square sharpens the crest; multiplying by amp keeps octaves subordinate.
    sum += n * n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/**
 * Domain warp: displace the sample point by low-frequency noise before
 * sampling. This is what turns straight noise features into winding, organic
 * ones — ravines that meander instead of running along lattice axes.
 */
export function warp2(x, z, { seed = 0, amplitude = 1, frequency = 1 } = {}) {
  const wx = fbm2(x * frequency + 31.7, z * frequency + 11.3, { octaves: 2, seed: seed + 7331 });
  const wz = fbm2(x * frequency - 17.9, z * frequency + 57.1, { octaves: 2, seed: seed + 1337 });
  return { x: x + wx * amplitude, z: z + wz * amplitude };
}
