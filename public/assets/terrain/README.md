# Terrain Asset Pipeline

This directory is the runtime destination for scanned or authored terrain PBR
materials. The live terrain remains fully procedural until a texture set is
enabled in `config/terrain-assets.json`, so missing art never blocks the world.

## Runtime contract

Each enabled set is normalized to:

```text
public/assets/terrain/generated/<set-id>/
  basecolor.jpg   # sRGB
  normal.png      # linear tangent-space normal
  orm.png         # linear: R=AO, G=roughness, B=metalness
  height.png      # optional linear height
```

`manifest.json` maps those files to the five terrain slots used by the splat
shader: `grass`, `dirt`, `sand`, `rock`, and `field`.

## Adding a scanned material

1. Place the source maps in a stable project-controlled location.
2. Add a set to `config/terrain-assets.json`.
3. Record the author, license name, and original source URL.
4. Enable the set and assign it to one or more terrain profiles.
5. Run:

```bash
npm run build:terrain-assets
npm run check:terrain-assets
npm run build
```

Example set:

```json
{
  "sets": {
    "forest-loam-01": {
      "enabled": true,
      "role": "dirt",
      "sourceDir": "assets-source/terrain/forest-loam-01",
      "resolution": 2048,
      "tileMeters": 3.5,
      "maps": {
        "albedo": "albedo.jpg",
        "normal": "normal.png",
        "ao": "ao.jpg",
        "roughness": "roughness.jpg",
        "height": "height.png"
      },
      "license": {
        "name": "CC0 1.0",
        "author": "Creator name",
        "sourceUrl": "https://original-source.example/material"
      }
    }
  }
}
```

## Art direction targets

The first approved library should cover:

- **Overworld:** short meadow grass, packed trail dirt, river gravel, weathered
  rock, and dry field litter.
- **Mountain:** alpine turf, cold fractured rock, scree, and exposed soil.
- **Forest:** moss, damp loam, leaf litter, roots, and mossy stone.
- **Castle:** compacted earth, crushed gravel, worn masonry, and mud.
- **Dungeon:** damp stone, rubble, mineral staining, and puddled grime.

Prefer seamless 2K source maps for general terrain. Reserve 4K assets for close
hero patches, decals, or unique landmarks rather than every streamed tile.

## Current phase boundary

This first step establishes deterministic processing, licensing metadata, the
runtime manifest, and a scene-owned texture cache. The next commits will:

1. select and ingest the first approved CC0/scanned texture sets;
2. add optional KTX2 variants;
3. bind texture sets into `terrainMaterial.js` with procedural fallback;
4. introduce near-camera height/parallax detail without changing collision.
