/**
 * worldgen — the Ashwood world as pure math.
 *
 * Single entry point: createWorldgen(config) builds the complete,
 * deterministic world model from ashwood_world.json — heightfield, zones,
 * biomes, trails and the global site manifest. No Babylon, no I/O; runs in
 * Node (scripts/verify_worldgen.mjs) and in every client identically.
 *
 * RNG draw order is part of the determinism contract:
 *   1. biome seeds  (exact mirror of the prototype's buildBiomeSeeds, so the
 *      canon seed reproduces the reference world's macro biome layout)
 *   2. site manifest (fixed order documented in sites.js)
 *   3. Wildwood forest sites (forest.js)
 * Stages are append-only: never insert draws before or between them.
 */

import { mulberry32, hash2, sstep, smoother } from './rng.js';
import { createZones } from './zones.js';
import { createHeightfield } from './heightfield.js';
import { createBiomes } from './biomes.js';
import { createTrails } from './trails.js';
import { generateSites, sitesInBounds } from './sites.js';
import { buildForestLayout, generateForestSites } from './forest.js';

export { mulberry32, hash2, sstep, smoother, sitesInBounds };

export function createWorldgen(config) {
  const zones = createZones(config);
  const height = createHeightfield(config, zones);
  const trails = createTrails(config);

  const rng = mulberry32(config.seed);
  const biomes = createBiomes(config, rng);

  const wg = {
    config,
    ...zones,
    ...height,
    ...trails,
    ...biomes,
  };

  wg.forest = buildForestLayout(config);
  wg.sites = generateSites(config, rng, wg);
  Object.assign(wg.sites, generateForestSites(config, rng, wg, wg.forest));
  return wg;
}
