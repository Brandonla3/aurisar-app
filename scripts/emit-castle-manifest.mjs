/**
 * emit-castle-manifest.mjs — export Castle Ashwood layout + collision metadata.
 *
 * Source of truth: src/features/world/castle/castlePlan.js
 * Outputs:
 *   public/assets/castle/castle_ashwood.json       (client / runtime fetch)
 *   spacetimedb/src/manifests/castle_ashwood.json  (server seeder)
 *
 *   npm run emit:castle
 *   npm run emit:castle:check   # CI guard — exit 1 if stale
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CASTLE_PLAN, LOCAL_BOUNDS, LEVELS, NAV_CELL, PLAYER_R, PLAYER_SKIN,
  WALL_T, STEP_UP, PLAN_SCALE, EXTERIOR, SHELL_COLLISION, INTERIOR_ANCHOR,
} from '../src/features/world/castle/castlePlan.js';
import { STEP_DOWN } from '../src/features/world/castle/castleNav.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CHECK = process.argv.includes('--check');

const OUT_PATHS = [
  join(repoRoot, 'public', 'assets', 'castle', 'castle_ashwood.json'),
  join(repoRoot, 'spacetimedb', 'src', 'manifests', 'castle_ashwood.json'),
];

const manifest = {
  meta: {
    id: 'castle_ashwood',
    version: '1.0.0',
    generated_utc: new Date().toISOString(),
    source: 'src/features/world/castle/castlePlan.js',
    runtime: 'procedural',
  },
  layout: {
    name: CASTLE_PLAN.name,
    planScale: PLAN_SCALE,
    interiorAnchor: INTERIOR_ANCHOR,
    bounds: LOCAL_BOUNDS,
    levels: LEVELS,
    rooms: CASTLE_PLAN.rooms,
    doors: CASTLE_PLAN.doors,
    stairs: CASTLE_PLAN.stairs,
    voids: CASTLE_PLAN.voids,
    entry: CASTLE_PLAN.entry,
    materialSpec: CASTLE_PLAN.materialSpec,
    spawnMarkers: CASTLE_PLAN.spawnMarkers,
  },
  collision: {
    navCellM: NAV_CELL,
    playerRadiusM: PLAYER_R,
    playerSkinM: PLAYER_SKIN,
    wallThicknessM: WALL_T,
    stepUpM: STEP_UP,
    stepDownM: STEP_DOWN,
    interiorBounds: LOCAL_BOUNDS,
    shell: {
      site: EXTERIOR.site,
      halfW: EXTERIOR.halfW,
      halfD: EXTERIOR.halfD,
      towerR: EXTERIOR.towerR,
      gateTurretR: EXTERIOR.gateTurretR,
      gateTurretProtrude: EXTERIOR.gateTurretProtrude,
      marginM: SHELL_COLLISION.marginM,
      cameraSkinM: SHELL_COLLISION.cameraSkinM,
    },
    navGrid: {
      cols: Math.ceil((LOCAL_BOUNDS.x1 - LOCAL_BOUNDS.x0) / NAV_CELL),
      rows: Math.ceil((LOCAL_BOUNDS.z1 - LOCAL_BOUNDS.z0) / NAV_CELL),
      levels: LEVELS.length,
    },
  },
};

const payload = `${JSON.stringify(manifest, null, 2)}\n`;
let stale = false;

for (const outPath of OUT_PATHS) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
  if (current === payload) continue;
  if (CHECK) {
    stale = true;
    console.error(`STALE: ${outPath.replace(repoRoot + '/', '')}`);
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, payload);
    console.log(`  wrote  ${outPath.replace(repoRoot + '/', '')}`);
  }
}

if (CHECK && stale) {
  console.error('\nCastle manifest out of date — run `npm run emit:castle` and commit.');
  process.exit(1);
}
if (CHECK) console.log('Castle manifest up to date.');
