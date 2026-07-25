/**
 * emit-world-chests.mjs — bake deterministic world chest positions/seeds.
 *
 * Source: createWorldgen(zone1_world.json) — same manifest every client builds.
 * Outputs:
 *   spacetimedb/src/manifests/world_chests.json
 *   src/features/world/content/world/chestManifest.generated.ts
 *
 *   npm run emit:world-chests
 *   npm run emit:world-chests:check
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CHECK = process.argv.includes('--check');

const zone1Config = JSON.parse(
  readFileSync(join(repoRoot, 'src/features/world/config/zone1_world.json'), 'utf8'),
);

const { createWorldgen } = await import('../src/features/world/worldgen/index.js');
const wg = createWorldgen(zone1Config);

// Ids are position-derived (worldgen/sites.js chestKey), NOT array indices.
// The old `id: index` meant any manifest edit that re-indexed the array —
// an added exclusion zone, a scatter tweak — silently remapped every player's
// persisted playerChestOpened history onto different chests. See
// worldgen/DETERMINISM.md § "Index-keyed data".
const chests = wg.sites.chests.map((c) => ({
  id: c.id,
  x: c.x,
  z: c.z,
  seed: c.seed,
}));

const ids = new Set(chests.map((c) => c.id));
if (ids.size !== chests.length) {
  console.error(`FATAL: chest id collision (${chests.length} chests, ${ids.size} distinct ids).`);
  process.exit(1);
}
if (chests.some((c) => !Number.isInteger(c.id) || c.id < 0 || c.id > 0xffffffff)) {
  console.error('FATAL: chest id outside u32 range (playerChestOpened.chestId is u32).');
  process.exit(1);
}

const json = JSON.stringify({ version: 1, chests }, null, 2) + '\n';

const JSON_PATH = join(repoRoot, 'spacetimedb/src/manifests/world_chests.json');
const TS_PATH = join(repoRoot, 'src/features/world/content/world/chestManifest.generated.ts');

const tsBody =
  '// GENERATED FILE — DO NOT EDIT.\n' +
  '// Source: scripts/emit_world_chests.mjs (zone1_world.json worldgen)\n' +
  '// Regenerate with: npm run emit:world-chests\n\n' +
  'export interface WorldChestDef {\n' +
  '  id: number;\n' +
  '  x: number;\n' +
  '  z: number;\n' +
  '  seed: number;\n' +
  '}\n\n' +
  `export const WORLD_CHESTS: WorldChestDef[] = ${JSON.stringify(chests, null, 2)};\n`;

function checkFile(path, expected) {
  if (!existsSync(path)) return false;
  return readFileSync(path, 'utf8') === expected;
}

if (CHECK) {
  const jsonOk = checkFile(JSON_PATH, json);
  const tsOk = checkFile(TS_PATH, tsBody);
  if (!jsonOk || !tsOk) {
    console.error('STALE: world chest manifest is out of date. Run: npm run emit:world-chests');
    process.exit(1);
  }
  console.log(`OK: ${chests.length} world chests`);
  process.exit(0);
}

mkdirSync(dirname(JSON_PATH), { recursive: true });
mkdirSync(dirname(TS_PATH), { recursive: true });
writeFileSync(JSON_PATH, json);
writeFileSync(TS_PATH, tsBody);
console.log(`Wrote ${chests.length} chests → manifests/world_chests.json + content/world/chestManifest.generated.ts`);
