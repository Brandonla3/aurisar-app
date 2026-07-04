/**
 * emit-castle-manifest.mjs — export Castle Ashwood layout + collision metadata.
 *
 * Source of truth: src/features/world/castle/castlePlan.js
 * Outputs:
 *   public/assets/castle/castle_ashwood.json
 *   spacetimedb/src/manifests/castle_ashwood.json
 *   spacetimedb/src/castle/navGrids.ts (server nav validation bitmaps)
 *
 *   npm run emit:castle
 *   npm run emit:castle:check
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CASTLE_PLAN, LOCAL_BOUNDS, LEVELS, NAV_CELL, PLAYER_R, PLAYER_SKIN,
  WALL_T, STEP_UP, PLAN_SCALE, EXTERIOR, SHELL_COLLISION, INTERIOR_ANCHOR, STAIRS,
} from '../src/features/world/castle/castlePlan.js';
import { STEP_DOWN, buildNav } from '../src/features/world/castle/castleNav.js';
import { stampNavBlockers } from '../src/features/world/castle/castleNavBlockers.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CHECK = process.argv.includes('--check');

const JSON_PATHS = [
  join(repoRoot, 'public', 'assets', 'castle', 'castle_ashwood.json'),
  join(repoRoot, 'spacetimedb', 'src', 'manifests', 'castle_ashwood.json'),
];
const NAV_GRIDS_TS = join(repoRoot, 'spacetimedb', 'src', 'castle', 'navGrids.ts');
const DUNGEON_SPAWNS_TS = join(repoRoot, 'src', 'features', 'world', 'content', 'dungeons', 'castleAshwood.generated.ts');

const nav = buildNav(INTERIOR_ANCHOR);
stampNavBlockers(nav);
const navLevels = nav.grids.map((grid, level) => ({
  level,
  encoding: 'uint16-le-base64',
  data: Buffer.from(grid.buffer, grid.byteOffset, grid.byteLength).toString('base64'),
}));

const manifest = {
  meta: {
    id: 'castle_ashwood',
    version: '1.0.0',
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
      cols: nav.cols,
      rows: nav.rows,
      levels: LEVELS.length,
      encoding: 'uint16-le-base64',
      bitmapSource: 'spacetimedb/src/castle/navGrids.ts',
    },
  },
};

const payload = `${JSON.stringify(manifest, null, 2)}\n`;

const navGridsTs = `// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/castle/castlePlan.js + castleNav.js + nav blockers
// Regenerate with: npm run emit:castle

export const CASTLE_NAV_META = {
  anchor: ${JSON.stringify(INTERIOR_ANCHOR)},
  bounds: ${JSON.stringify(LOCAL_BOUNDS)},
  navCellM: ${NAV_CELL},
  cols: ${nav.cols},
  rows: ${nav.rows},
  levelCount: ${LEVELS.length},
} as const;

export const CASTLE_NAV_BITMAPS_B64: readonly string[] = [
${navLevels.map((l) => `  '${l.data}', // level ${l.level}`).join('\n')}
];

export const CASTLE_LEVELS = ${JSON.stringify(LEVELS, null, 2)} as const;

export const CASTLE_STAIRS = ${JSON.stringify(STAIRS, null, 2)} as const;

export const CASTLE_STEP_UP = ${STEP_UP};
export const CASTLE_STEP_DOWN = ${STEP_DOWN};
`;

const dungeonSpawnsTs = `// GENERATED FILE — DO NOT EDIT.
// Regenerate with: npm run emit:castle

export const CASTLE_ASHWOOD_ENTRY = ${JSON.stringify(CASTLE_PLAN.entry, null, 2)} as const;

export const CASTLE_ASHWOOD_SPAWNS = ${JSON.stringify(CASTLE_PLAN.spawnMarkers, null, 2)} as const;
`;

function writeOrCheck(path, content, label) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === content) return false;
  if (CHECK) {
    console.error(`STALE: ${label}`);
    return true;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`  wrote  ${label}`);
  return false;
}

let stale = false;
for (const outPath of JSON_PATHS) {
  stale = writeOrCheck(outPath, payload, outPath.replace(repoRoot + '/', '')) || stale;
}
stale = writeOrCheck(NAV_GRIDS_TS, navGridsTs, NAV_GRIDS_TS.replace(repoRoot + '/', '')) || stale;
stale = writeOrCheck(DUNGEON_SPAWNS_TS, dungeonSpawnsTs, DUNGEON_SPAWNS_TS.replace(repoRoot + '/', '')) || stale;

if (CHECK && stale) {
  console.error('\nCastle manifest out of date — run `npm run emit:castle` and commit.');
  process.exit(1);
}
if (CHECK) console.log('Castle manifest up to date.');
