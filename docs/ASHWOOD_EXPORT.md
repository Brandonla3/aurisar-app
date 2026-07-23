# Ashwood Export Pipeline (Blender / Unreal bridge)

The Ashwood world is defined entirely by **pure math + one JSON file** — no
hand-authored terrain meshes. That makes every artifact below reproducible
from source, on any engine.

## Source of truth

| What | Where |
|---|---|
| Declarative geography (seed, zones, lake, switchback paths, plateaus, trails, biomes, scatter densities) | `src/features/world/config/ashwood_world.json` |
| The formulas (heightfield, biome IDW, trail field, site manifest) | `src/features/world/worldgen/` — engine-free ES modules, Node-runnable |
| Invariant checks | `node scripts/verify_worldgen.mjs` |

Units everywhere: **1 unit = 1 meter** (= 32 SpacetimeDB px). World origin =
Babylon `(0,0)` = tile-grid center. The playable disc has radius 520 m inside
a ±1008 m streamed tile world.

## Artifacts

All bake scripts default to the **live world** (`zone1_world.json`) and derive
their output name/dir from it; pass `--config <path>` to bake another world
(e.g. the `ashwood_world.json` dev world). Heightmaps and alternate-config
tiles land in `export/<slug>/` (gitignored — derived, not committed); only the
live zone1 tile bake writes the production `public/assets/tiles/`. Regenerate
at will; the config seed guarantees identical output.

### 1. Terrain tiles → GLB (`npm run bake:tiles`)

```
node scripts/bake_ashwood_tiles.mjs                  # live zone1 → public/assets/tiles
node scripts/bake_ashwood_tiles.mjs --tiles T_03_03  # specific tiles
node scripts/bake_ashwood_tiles.mjs --all            # full 8×8 grid
node scripts/bake_ashwood_tiles.mjs --config src/features/world/config/ashwood_world.json
                                                     # dev world → export/ashwood/tiles
```

- Runs the **same `AshwoodTileProvider` the client streams from** under a
  headless Babylon NullEngine — baked geometry is identical to runtime
  geometry by construction.
- Per tile: 256×256 m displaced grid (97×97 verts), seam-free analytic
  normals, biome/trail/lakebed colors as `COLOR_0`, world placement baked
  into the node translation. Water surfaces included as flat discs.
- **Blender:** import glTF → vertex colors arrive as the `Color` attribute.
  UVs are pruned by the exporter (no texture references in bake materials);
  for world-aligned texturing add a planar UV from X/Z: `uv = (x, z) / 28.44`
  (the runtime's grass period — 9 repeats per 256 m tile).
- **Runtime streaming:** drop baked GLBs into `public/assets/tiles/` and set
  `USE_GLB_TILES = true` in `BabylonWorldScene.js` to stream them instead of
  generating live. Note the baked material is vertex-color PBR — the live
  grass texture/normal map is not embedded yet, so the default stays
  procedural until baked materials reach visual parity.

### 2. Heightmap → 16-bit PNG (`npm run bake:heightmap`)

```
node scripts/bake_ashwood_heightmap.mjs              # live zone1 → export/zone1/zone1_heightmap_2017.png
node scripts/bake_ashwood_heightmap.mjs --size 1009  # quick preview
node scripts/bake_ashwood_heightmap.mjs --config src/features/world/config/ashwood_world.json
```

- 16-bit grayscale PNG (UE-recommended 2017 resolution), north up,
  pixel (0,0) = world NW corner.
- The `.json` sidecar holds the exact value→meters mapping plus computed
  **Unreal Landscape import settings** (`zScale`, `xyScale`, vertical offset).
- Blender: use as a Displace texture on a 2016×2016 m grid; strength =
  `maxMeters − minMeters`, mid level = `−minMeters / (max − min)`.

### 3. World data → JSON

`ashwood_world.json` is already the portable export (the prototype's
`exportWorldJSON()` output, extended). Re-implementing the world in UE/Blender
procedurally means porting the few small functions in `worldgen/` — each file
header cites the formula source lines in `public/reference/ashwood.html`.

## Determinism contract

Everything derives from `seed` (20240611) via mulberry32. The RNG draw order
is: biome seeds first (mirrors the prototype exactly — macro biome layout is
canon), then the site manifest (`worldgen/sites.js`). Changing the seed, the
draw order, or any formula is a **world-breaking change** for multiplayer
clients and must regenerate all baked artifacts together.
