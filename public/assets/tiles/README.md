# Tile GLB assets

Per-tile GLB files loaded at runtime by `GlbTileProvider` (see
`src/features/world/streaming/glbTileProvider.js`) and managed via
`TileLoader` based on player position.

## Naming convention

From `world_build_config.export_pipeline.per_tile_outputs`:

```
tile_<ID>_render.glb       — visual mesh (this directory)
tile_<ID>_collision.glb    — collision-only mesh (future slice; not used yet)
tile_<ID>_gameplay.json    — spawns/POIs/waypoints (validated, not yet wired)
```

The `<ID>` is the tile coordinate string `T_##_##` (zero-padded column then
row). The center tile of the 8×8 grid is `T_03_03` and sits on world origin.

The runtime URL is `/assets/tiles/T_##_##_render.glb` (no `tile_` prefix in
the filename in practice — see `buildTileIndex` `urlFor.render` in
`BabylonWorldScene._setupTileStreaming`).

## Fallback behavior

Tiles whose `.glb` is absent (or 404s) fall back transparently to
`ProceduralTileProvider`, which deterministically generates grass + trees +
rocks from `tile_id`. The fallback uses the **same RNG seed** as
`scripts/build_glb_assets.mjs` so a missing tile's trees sit in identical
positions to its neighbors' procedural trees — no visible seams at boundaries
between authored and procedural tiles.

Wrapper class: `FallbackTileProvider` (`src/features/world/streaming/fallbackTileProvider.js`).

## Export contract

GLB files in this directory must satisfy:

- **glTF 2.0 binary** (`.glb`).
- **Local-space origin = tile center.** `TileLoader` does NOT translate the
  loaded geometry. Place geometry such that the tile's center (`tileBounds(id).center`)
  in world coords coincides with the GLB's local origin (0, 0, 0).
- **Within tile bounds.** Geometry should stay inside the 256m × 256m tile
  AABB. Tiles outside the active streaming ring are unloaded; geometry that
  bleeds across boundaries will pop when neighbors load/unload.
- **+Y up.** Ground sits at Y≈0. Trees, rocks, structures extend +Y.
- **Mobile-friendly poly count.** Per `world_build_config.performance.poly_budget_hint`,
  full world target is ~16k tris. With 9 active tiles (3×3 ring), budget
  ~1.5k tris per tile.
- **No textures yet** for the Slice-2 placeholder pipeline. Single PBR
  materials with baseColorFactor only. A texture+atlas pass arrives with the
  Blender-authoring slice.

## Regenerating the placeholder

The committed `T_03_03_render.glb` is produced by:

```bash
npm run build:glb
```

That script (`scripts/build_glb_assets.mjs`) emits the sample tile alongside
the wolf. Re-run after editing the script.

To author the full 8×8 set, drop GLBs named `T_<col>_<row>_render.glb` into
this directory. No code change — `FallbackTileProvider` picks them up on next
streaming pass.
