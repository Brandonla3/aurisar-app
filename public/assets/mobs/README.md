# Mob GLB assets

Per-mob GLB files loaded at runtime by `MobAssetLibrary` (see
`src/features/world/game/MobAssetLibrary.js`) and instantiated in
`BabylonWorldScene._spawnMob` when a STDB `mob` row arrives.

## Manifest

The runtime asks `MobAssetLibrary.getContainer(row.mobType)` for each spawn.
`mobType` comes from the server (`spacetimedb/src/index.ts`). The mapping from
`mobType` → file lives in the `MANIFEST` constant of `MobAssetLibrary.js`.

Today:

| `mobType` | File              |
| --------- | ----------------- |
| `wolf`    | `wolf.glb`        |

A `mobType` with no manifest entry, or with a manifest entry whose file 404s,
falls back transparently to the primitive composite in `_spawnMob` (current
quadruped of boxes + cylinders).

## Export contract

GLB files in this directory must satisfy:

- **glTF 2.0 binary** (`.glb`).
- **+Y up, +Z forward.** The runtime parents `inst.rootNodes` to a `visual`
  TransformNode without rotation. The wolf walks toward `+Z` in local space.
- **Single scene** with one or more root nodes. All meshes contained in those
  roots — `instantiateModelsToScene` is invoked with `cloneMaterials: false`.
- **Standing on Y=0.** The mesh's lowest visible point should be at Y=0 (or
  slightly below for grounded feel); the root TransformNode is placed at the
  mob's world XZ with Y=0.
- **No bundled animations** in this slice. Animation support arrives with the
  AI/movement slice; until then, animation tracks (if present) are ignored.
- **Stay under 200KB** uncompressed for placeholder-scale mobs. The runtime
  loads every mob GLB once at boot (singleton cache).
- **Visible silhouette at 5 world units.** Camera is third-person; mobs should
  read as themselves at gameplay distance.

## Regenerating the placeholder

The committed `wolf.glb` is produced by:

```bash
npm run build:glb
```

That script (`scripts/build_glb_assets.mjs`) emits both `wolf.glb` and the
sample tile via `@gltf-transform/core`. Re-run after editing the script.

To replace the placeholder with a hand-authored mesh (Blender, Sketchfab,
Quaternius pack), just drop the .glb into this directory with the matching
filename. No code change required.
