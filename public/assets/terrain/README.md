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

1. Add a candidate set to `config/terrain-assets.json` with `enabled: false`.
2. Record role, source directory, expected map filenames, author, license name,
   original source URL, and acquisition notes.
3. Run `npm run prepare:terrain-sources` to generate local source folders and
   per-set `SOURCE.md` checklists under `assets-source/terrain/`.
4. For a locked downloadable set, run:

```bash
npm run fetch:terrain-source -- <set-id>
npm run check:terrain-source -- <set-id>
```

5. For manually acquired sources, drop the raw source maps into the generated
   source folder using the exact configured filenames.
6. Run:

```bash
npm run build:terrain-assets
npm run check:terrain-assets
npm run build
```

7. Visually inspect the generated outputs. Only then set `enabled: true` and
   assign the set to a terrain profile slot.

Candidate sets are validated even while disabled, but disabled sets are not
included in the runtime manifest and do not require local source maps yet.

## Current selected candidates

PR #250 started the overworld library with five disabled candidate slots:

- `overworld-meadow-grass-01` → `grass`
- `overworld-packed-dirt-01` → `dirt`
- `overworld-river-gravel-01` → `sand`
- `overworld-weathered-rock-01` → `rock`
- `overworld-dry-field-litter-01` → `field`

PR #251 locks `overworld-meadow-grass-01` to ambientCG `Ground037` and adds a
repeatable fetch/extract workflow for that first source archive. The set remains
disabled until the generated runtime maps are inspected and approved.

Raw scanned texture binaries are large, ignored in `assets-source/terrain/`, and
should only be committed after normalization if they are approved as runtime
outputs.

## Example set

```json
{
  "sets": {
    "forest-loam-01": {
      "enabled": false,
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
      },
      "acquisition": {
        "provider": "Provider name",
        "licenseUrl": "https://original-source.example/license",
        "status": "selected-awaiting-binaries",
        "notes": "Why this material fits the target terrain slot.",
        "download": {
          "url": "https://original-source.example/material.zip",
          "format": "2K-JPG.zip",
          "maps": {
            "albedo": "Source_Color.jpg",
            "normal": "Source_NormalGL.jpg",
            "ao": "Source_AmbientOcclusion.jpg",
            "roughness": "Source_Roughness.jpg",
            "height": "Source_Displacement.jpg"
          }
        }
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

This phase selects and prepares the first scanned-material candidates. Later
commits will enable approved runtime outputs, add optional KTX2 variants, bind
texture sets into `terrainMaterial.js` with procedural fallback, and introduce
near-camera height/parallax detail without changing collision.
