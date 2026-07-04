/**
 * sites — the deterministic global site manifest: where every tree, rock,
 * bush, ground-detail, ruin, cave, chest and pond in Ashwood stands.
 *
 * The prototype scattered these inside buildWorld() under a temporarily
 * seeded Math.random, which made the world deterministic but only for a
 * whole-world single pass. Tile streaming loads tiles in player-dependent
 * order, so instead we run this one cheap global pass (pure math, a few ms)
 * at scene init; tile providers then render the subset inside their bounds.
 * Every client computes the identical manifest from the seed — required for
 * multiplayer world parity.
 *
 * Placement rules are ported 1:1 from the prototype's buildWorld()
 * (lines ~2282-2343); the RNG draw order here is fixed and documented but
 * intentionally NOT a draw-for-draw mirror of the prototype (its spawn
 * functions interleave visual-variance draws we derive per-site instead).
 *
 * Each site carries a 32-bit `seed` so renderers can derive per-instance
 * visual variance (scale, tint, rotation) deterministically.
 */

import { randIn } from './rng.js';

export function generateSites(config, rng, wg) {
  const R = config.radius;
  const S = config.scatter;
  const { lakeWaterDepthAt, inForest, inMountain, biomeAt, biomeIdxAt } = wg;

  const siteSeed = () => (rng() * 4294967296) >>> 0;

  // Rejection-sample a point in the world disc, outside the lake water and
  // at least minFromCenter from the spawn hub. Mirrors prototype scatter().
  function scatter(minFromCenter) {
    let x, z, d;
    do {
      x = randIn(rng, -R, R);
      z = randIn(rng, -R, R);
      d = Math.hypot(x, z);
    } while (d < minFromCenter || d > R || lakeWaterDepthAt(x, z) > 0.05);
    return { x, z };
  }

  // Up to 8 tries for a point whose biome index is in pref; else last try.
  function scatterPref(pref, minR) {
    let last = null;
    for (let t = 0; t < 8; t++) {
      const p = scatter(minR || 4);
      if (pref.indexOf(biomeIdxAt(p.x, p.z)) >= 0) return p;
      last = p;
    }
    return last;
  }

  // ── trees: biome-weighted density and species; the Wildwood and the
  //    mountain dress themselves separately ──
  const trees = [];
  for (let i = 0; i < S.treeCount; i++) {
    const p = scatter(8);
    const bi = biomeAt(p.x, p.z);
    if (rng() < bi.treeSkip) continue;
    const kind = bi.trees[(rng() * bi.trees.length) | 0];
    if (inMountain(p.x, p.z) || inForest(p.x, p.z)) continue;
    trees.push({ x: p.x, z: p.z, kind, seed: siteSeed() });
  }

  // ── rocks: cluster in the highlands (rockSkip lowest there) ──
  const rocks = [];
  for (let i = 0; i < S.rockCount; i++) {
    const p = scatter(6);
    const bi = biomeAt(p.x, p.z);
    if (rng() < bi.rockSkip) continue;
    rocks.push({ x: p.x, z: p.z, seed: siteSeed() });
  }

  // ── bushes: sparse in barren biomes, none in the Wildwood ──
  const bushes = [];
  for (let i = 0; i < S.bushCount; i++) {
    const p = scatter(3);
    if (inForest(p.x, p.z)) continue;
    const bi = biomeAt(p.x, p.z);
    if (rng() < (1 - bi.grass) * 0.85) continue;
    bushes.push({ x: p.x, z: p.z, seed: siteSeed() });
  }

  // ── ground detail (ferns / mushrooms / flowers), biased by biome ──
  const details = [];
  for (let i = 0; i < S.detailCount; i++) {
    const p = scatter(3);
    const biIdx = biomeIdxAt(p.x, p.z);
    const bi = config.biomes[biIdx];
    if (bi.grass < 0.05 && rng() < 0.7) continue;
    details.push({ x: p.x, z: p.z, biome: biIdx, seed: siteSeed() });
  }

  // ── landmarks ──
  const ruins = [];
  for (let i = 0; i < S.ruinCount; i++) {
    const p = scatter(28);
    ruins.push({ x: p.x, z: p.z, seed: siteSeed() });
  }
  const caves = [];
  for (let i = 0; i < S.caveCount; i++) {
    const p = scatter(34);
    caves.push({ x: p.x, z: p.z, seed: siteSeed() });
  }
  const chests = [];
  for (let i = 0; i < S.chestCount; i++) {
    const p = scatter(10);
    chests.push({ x: p.x, z: p.z, seed: siteSeed() });
  }

  // ── ponds: prefer the Mire, never on the mountain ──
  const ponds = [];
  for (let i = 0; i < S.pondCount; i++) {
    const p = rng() < 0.5 ? scatterPref([3], 22) : scatter(22);
    const r = randIn(rng, S.pondRadius[0], S.pondRadius[1]);
    if (inMountain(p.x, p.z)) continue;
    ponds.push({ x: p.x, z: p.z, r, seed: siteSeed() });
  }

  // ── exclusion zones (post-filter) ──
  // Structures like Castle Ashwood claim their footprint AFTER all RNG
  // draws, so the append-only draw-order determinism contract is untouched
  // and every client filters the identical manifest identically.
  const sites = { trees, rocks, bushes, details, ruins, caves, chests, ponds };
  const exclusions = config.exclusions ?? [];
  if (exclusions.length) {
    const outside = (s) => exclusions.every(
      (e) => Math.hypot(s.x - e.x, s.z - e.z) > e.r
    );
    for (const key of Object.keys(sites)) {
      sites[key] = sites[key].filter(outside);
    }
  }
  return sites;
}

/** Sites whose (x,z) fall inside tile bounds {min:{x,z}, max:{x,z}}. */
export function sitesInBounds(list, bounds) {
  return list.filter(
    (s) =>
      s.x >= bounds.min.x && s.x < bounds.max.x &&
      s.z >= bounds.min.z && s.z < bounds.max.z
  );
}
