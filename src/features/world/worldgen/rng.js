/**
 * rng — deterministic random helpers shared by all worldgen modules.
 *
 * No Babylon, no I/O. Safe to run in Node and unit-test.
 *
 * Determinism contract: every client (and the future Blender/Unreal export
 * pipeline) must produce the identical Ashwood world from ashwood_world.json
 * alone. All worldgen randomness flows through mulberry32 seeded from the
 * config; Math.random must never appear in this directory.
 */

// Mulberry32 — same generator the Ashwood prototype swapped in for its
// buildWorld() pass, and the same one proceduralTileProvider.js uses.
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** rand(a, b) over a supplied generator — mirrors the prototype's rand(). */
export function randIn(rng, a, b) {
  return a + rng() * (b - a);
}

/**
 * Stateless 2D hash in [0,1) — the prototype's hash2(). Used for grass
 * placement and texture noise; deterministic by construction.
 */
export function hash2(a, b) {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Smoothstep between edges e0..e1 — the prototype's _sstep(). */
export function sstep(e0, e1, x) {
  const t = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
}

/** Quintic smootherstep of t clamped to [0,1] — the prototype's _smoother(). */
export function smoother(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * t * (t * (t * 6 - 15) + 10);
}
