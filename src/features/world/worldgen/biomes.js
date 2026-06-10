/**
 * biomes — Voronoi-seeded biome regions with inverse-distance-weighted
 * color/fog blending. Ported from the prototype (lines ~2100-2132).
 *
 * The seed placement mirrors the prototype's buildBiomeSeeds() RNG draw
 * order exactly, so with the canon seed the macro biome layout (where the
 * Meadow/Old-growth/Highlands/Mire/Ashlands fall) is IDENTICAL to the
 * reference world the prototype generates.
 *
 * Pure math. Colors are plain {r,g,b} mutable objects (engine-free).
 */

import { randIn } from './rng.js';

function hexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return {
    r: ((v >> 16) & 255) / 255,
    g: ((v >> 8) & 255) / 255,
    b: (v & 255) / 255,
  };
}

/**
 * @param {object}   config  ashwood_world.json
 * @param {function} rng     seeded generator — consumed in the prototype's
 *                           exact draw order; call this FIRST on a fresh
 *                           mulberry32(seed) to reproduce the canon layout.
 */
export function createBiomes(config, rng) {
  const BIOMES = config.biomes.map((b) => ({
    ...b,
    fogRgb: hexToRgb(b.fog),
  }));

  // ── seed placement (exact mirror of prototype buildBiomeSeeds) ──
  const seeds = [{ x: 0, z: 0, b: 0 }]; // gentle meadow around the spawn
  const ring = config.biomeRing.slice();
  for (let i = ring.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = ring[i]; ring[i] = ring[j]; ring[j] = t;
  }
  const R = config.radius;
  const base = rng() * 6.28;
  for (let i = 0; i < ring.length; i++) {
    const a = base + (i / ring.length) * 6.28 + randIn(rng, -0.25, 0.25);
    const rr = R * randIn(rng, 0.42, 0.92);
    seeds.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, b: ring[i] });
  }

  function biomeIdxAt(x, z) {
    let bd = 1e12, bi = 0;
    for (const s of seeds) {
      const d = (x - s.x) * (x - s.x) + (z - s.z) * (z - s.z);
      if (d < bd) { bd = d; bi = s.b; }
    }
    return bi;
  }

  function biomeAt(x, z) {
    return BIOMES[biomeIdxAt(x, z)];
  }

  // inverse-distance-weighted blend across all seeds → smooth transitions
  function idw(x, z, sample, out) {
    let w = 0, r = 0, g = 0, b = 0;
    for (const s of seeds) {
      const dx = x - s.x, dz = z - s.z;
      const d = dx * dx + dz * dz + 1;
      const ww = 1 / (d * d);
      const c = sample(s.b);
      w += ww; r += c.r * ww; g += c.g * ww; b += c.b * ww;
    }
    out.r = r / w; out.g = g / w; out.b = b / w;
    return out;
  }

  const _ground = config.biomes.map((b) => ({ r: b.ground[0], g: b.ground[1], b: b.ground[2] }));

  /** Blended ground albedo at (x,z) → writes into out {r,g,b}. */
  function biomeColorAt(x, z, out) {
    return idw(x, z, (bi) => _ground[bi], out);
  }

  /** Blended fog color at (x,z) → writes into out {r,g,b}. */
  function biomeFogAt(x, z, out) {
    return idw(x, z, (bi) => BIOMES[bi].fogRgb, out);
  }

  return { BIOMES, biomeSeeds: seeds, biomeIdxAt, biomeAt, biomeColorAt, biomeFogAt };
}
