/**
 * forest — the Wildwood: hidden paths, clearings, and the dense instanced
 * tree/undergrowth layout. Ported from the prototype's buildForest()
 * (public/reference/ashwood.html lines ~1639-1759).
 *
 * Pure math. Site generation consumes the shared seeded RNG as stage 3 of
 * the determinism contract (after biome seeds and the overworld site
 * manifest) — append-only, so stages 1-2 reproduce exactly as before.
 *
 * Tree archetypes: 0 = sapling, 1 = mature, 2 = giant. Mature+ trees are
 * collision solids in the prototype; we keep the radius for later use.
 */

import { randIn } from './rng.js';

const TREE_CAP = 1100;
const BRUSH_CAP = 1000;

export function buildForestLayout(config) {
  const F = config.zones.wildwood;
  const FX = F.x, FZ = F.z, FR = F.r;

  // hidden paths (cleared corridors, half-width 6) + open clearings
  const paths = [
    [[FX - FR * 0.92, FZ + FR * 0.05], [FX - 70, FZ + 55], [FX - 5, FZ + 80], [FX + 65, FZ + 35], [FX + 40, FZ - 45], [FX - 25, FZ - 90]],
    [[FX + FR * 0.9, FZ - FR * 0.15], [FX + 55, FZ + 15], [FX - 15, FZ + 5], [FX - 80, FZ - 35]],
  ];
  const clearings = [
    [FX, FZ, 20], [FX - 72, FZ + 52, 15], [FX + 62, FZ - 42, 17],
    [FX + 12, FZ + 78, 13], [FX - 28, FZ - 82, 14],
  ];

  function isOpen(x, z) {
    for (const c of clearings) {
      if (Math.hypot(x - c[0], z - c[1]) < c[2]) return true;
    }
    for (const pa of paths) {
      for (let i = 0; i < pa.length - 1; i++) {
        const ax = pa[i][0], az = pa[i][1], bx = pa[i + 1][0], bz = pa[i + 1][1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        if (l2 < 1) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        if (Math.hypot(x - (ax + t * dx), z - (az + t * dz)) < 6) return true;
      }
    }
    return false;
  }

  return { paths, clearings, isOpen };
}

/** Stage-3 RNG consumer: dense Wildwood trees + undergrowth sites. */
export function generateForestSites(config, rng, wg, layout) {
  const F = config.zones.wildwood;
  const R = config.radius;

  const trees = [];
  let tries = 0;
  while (trees.length < TREE_CAP && tries < TREE_CAP * 7) {
    tries++;
    const a = rng() * 6.283;
    const rr = Math.sqrt(rng()) * F.r;
    const x = F.x + Math.cos(a) * rr;
    const z = F.z + Math.sin(a) * rr;
    if (x * x + z * z > R * R) continue;
    if (layout.isOpen(x, z)) continue;
    // archetype mix: 42% saplings, 46% mature, 12% giants
    const roll = rng();
    const arch = roll < 0.42 ? 0 : rng() < 0.8 ? 1 : 2;
    const bh = arch === 0 ? 6 + rng() * 5 : arch === 1 ? 9 + rng() * 8 : 13 + rng() * 12;
    const tw = arch === 0 ? 0.5 + rng() * 0.35 : arch === 1 ? 0.65 + rng() * 0.4 : 0.85 + rng() * 0.6;
    trees.push({
      x, z, arch, h: bh, w: tw,
      lean: (rng() - 0.5) * 0.07,
      yaw: rng() * 6.28,
      seed: (rng() * 4294967296) >>> 0,
      r: arch >= 1 ? tw * 0.9 + 0.35 : 0,   // collision radius (0 = walk-through sapling)
    });
  }

  const brush = [];
  let btr = 0;
  while (brush.length < BRUSH_CAP && btr < BRUSH_CAP * 6) {
    btr++;
    const a = rng() * 6.283;
    const rr = Math.sqrt(rng()) * F.r;
    const x = F.x + Math.cos(a) * rr;
    const z = F.z + Math.sin(a) * rr;
    if (layout.isOpen(x, z)) continue;
    brush.push({ x, z, sc: 0.7 + rng() * 1.6, seed: (rng() * 4294967296) >>> 0 });
  }

  // fallen logs in clearings (70% chance each)
  const logs = [];
  for (const c of layout.clearings) {
    if (rng() < 0.7) {
      logs.push({
        x: c[0] + randIn(rng, -c[2] * 0.4, c[2] * 0.4),
        z: c[1] + randIn(rng, -c[2] * 0.4, c[2] * 0.4),
        len: randIn(rng, 4, 7),
        yaw: rng() * 6.28,
      });
    }
  }

  // Namespaced keys — the overworld manifest already owns `trees`.
  return { forestTrees: trees, forestBrush: brush, forestLogs: logs };
}
