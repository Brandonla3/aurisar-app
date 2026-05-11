/**
 * copy_gameplay_to_public.mjs — mirror tile gameplay JSON to public/.
 *
 * The SpacetimeDB module is the source of truth for per-tile gameplay
 * data (spawns, encounter zones, waypoints, POIs). It bundles each
 * `spacetimedb/src/gameplay/T_##_##.json` into the WASM at compile time.
 *
 * This script copies those files verbatim to
 * `public/assets/tiles/T_##_##_gameplay.json` so external tooling can
 * fetch them at the URL declared by `buildTileIndex`'s
 * `urlFor.gameplay(id)` contract. The runtime client doesn't read them
 * yet (slice 5b is server-driven seeding), but the URL contract stays
 * honored — slice 5c+ will likely add a client-side consumer.
 *
 * Re-run with: npm run build:gameplay
 *
 * Idempotent: re-running with no source changes is a no-op (same bytes
 * written).
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = join(repoRoot, 'spacetimedb', 'src', 'gameplay');
const dstDir = join(repoRoot, 'public', 'assets', 'tiles');

mkdirSync(dstDir, { recursive: true });

// Match the export-pipeline naming from world_build_config:
//   spacetimedb/src/gameplay/T_03_03.json  →  public/assets/tiles/T_03_03_gameplay.json
const files = readdirSync(srcDir).filter((f) => f.endsWith('.json'));
let copied = 0;
for (const f of files) {
  const srcPath = join(srcDir, f);
  if (!statSync(srcPath).isFile()) continue;
  const tileId = basename(f, '.json');             // 'T_03_03'
  const dstPath = join(dstDir, `${tileId}_gameplay.json`);
  const bytes = readFileSync(srcPath);
  writeFileSync(dstPath, bytes);
  copied++;
  console.log(`  ${tileId}.json → ${dstPath.replace(repoRoot, '.')}`);
}

console.log(`Done. Copied ${copied} tile gameplay file${copied === 1 ? '' : 's'}.`);
