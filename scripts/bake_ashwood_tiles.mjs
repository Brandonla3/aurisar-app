/**
 * bake_ashwood_tiles — exports Ashwood terrain tiles as GLB files.
 *
 *   node scripts/bake_ashwood_tiles.mjs                 # all tiles touching the world disc
 *   node scripts/bake_ashwood_tiles.mjs --tiles T_03_03,T_03_04
 *   node scripts/bake_ashwood_tiles.mjs --all           # the full 8×8 grid
 *   node scripts/bake_ashwood_tiles.mjs --out /tmp/tiles
 *
 * Runs the SAME AshwoodTileProvider the client streams from (bake mode:
 * vertex-color materials, no textures/shaders) under a headless Babylon
 * NullEngine, then serializes each tile to glTF-Binary via GLTF2Export.
 *
 * The output GLBs are the Blender/Unreal editing masters AND drop-in
 * replacements for the runtime tiles at public/assets/tiles/ (see
 * docs/ASHWOOD_EXPORT.md). Geometry is identical to the runtime procedural
 * tiles by construction — both paths run the same worldgen + provider code.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import BABYLON from 'babylonjs';
globalThis.BABYLON = BABYLON; // provider + serializers consume the global
// UMD interop: named ESM destructuring misses the CJS exports here; the
// serializer also registers itself onto the BABYLON global.
const serializers = await import('babylonjs-serializers');
const GLTF2Export = serializers.GLTF2Export ?? BABYLON.GLTF2Export;

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
// Which world to bake. Defaults to the LIVE world (zone1_world.json); pass
// --config <path> (repo-root-relative) to bake a different one, e.g. the
// ashwood_world.json dev world for regression exports.
const configPath = argValue('--config') ?? 'src/features/world/config/zone1_world.json';

const worldBuildConfig = JSON.parse(
  readFileSync(join(root, 'src/features/world/config/world_build_config.json'), 'utf8'));
const worldConfig = JSON.parse(readFileSync(join(root, configPath), 'utf8'));

const { createWorldgen } = await import('../src/features/world/worldgen/index.js');
const { AshwoodTileProvider } = await import('../src/features/world/streaming/ashwoodTileProvider.js');
const { streamingParams, formatTileId, tileBounds } =
  await import('../src/features/world/streaming/tileMath.js');

const outDir = argValue('--out') ?? join(root, 'public/assets/tiles');
const params = streamingParams(worldBuildConfig);

function discTiles() {
  // Tiles whose AABB touches the playable world disc (radius from config).
  const r = worldConfig.radius;
  const ids = [];
  for (let row = 0; row < params.rows; row++) {
    for (let col = 0; col < params.cols; col++) {
      const id = formatTileId(col, row);
      const b = tileBounds(id, params);
      const cx = Math.max(b.min.x, Math.min(b.max.x, 0));
      const cz = Math.max(b.min.z, Math.min(b.max.z, 0));
      void cx; void cz;
      // closest point of AABB to origin
      const px = Math.max(b.min.x, Math.min(b.max.x, 0));
      const pz = Math.max(b.min.z, Math.min(b.max.z, 0));
      if (Math.hypot(px, pz) <= r) ids.push(id);
    }
  }
  return ids;
}

let tileIds;
if (argValue('--tiles')) tileIds = argValue('--tiles').split(',').map(s => s.trim());
else if (args.includes('--all')) {
  tileIds = [];
  for (let row = 0; row < params.rows; row++)
    for (let col = 0; col < params.cols; col++) tileIds.push(formatTileId(col, row));
} else tileIds = discTiles();

// ── bake ────────────────────────────────────────────────────────────────────
const engine = new BABYLON.NullEngine();
const worldgen = createWorldgen(worldConfig);

mkdirSync(outDir, { recursive: true });

let totalBytes = 0;
for (const id of tileIds) {
  const scene = new BABYLON.Scene(engine);
  // Fresh provider per tile so shared materials live in the right scene.
  const provider = new AshwoodTileProvider(worldBuildConfig, worldgen, { bake: true });
  const bounds = tileBounds(id, params);
  const meta = { id, min: bounds.min, max: bounds.max, center: bounds.center };

  const container = provider.load(meta, scene);
  container.addAllToScene();

  const glb = await GLTF2Export.GLBAsync(scene, `${id}_render`);
  const file = Object.keys(glb.glTFFiles).find(f => f.endsWith('.glb'));
  const data = glb.glTFFiles[file];
  const buf = Buffer.from(
    data instanceof ArrayBuffer ? data : await data.arrayBuffer());

  const outPath = join(outDir, `${id}_render.glb`);
  writeFileSync(outPath, buf);
  totalBytes += buf.length;
  console.log(`  baked ${id}_render.glb  ${(buf.length / 1024).toFixed(0)} KB`);

  scene.dispose();
}

engine.dispose();
console.log(`\n${tileIds.length} tile(s) → ${outDir}  (${(totalBytes / 1048576).toFixed(1)} MB total)`);
