# Terrain Source Assets

This directory is the local staging area for raw scanned or authored terrain PBR maps before they are normalized into `public/assets/terrain/generated/`.

Raw source maps are intentionally ignored by git because they can be large and may be replaced frequently during art direction. Commit only this README, candidate metadata in `config/terrain-assets.json`, and the generated runtime outputs once a set is approved.

## Workflow

1. Run `npm run prepare:terrain-sources` to create candidate folders and `SOURCE.md` instructions.
2. For a locked downloadable source set, run:

```bash
npm run fetch:terrain-source -- overworld-meadow-grass-01
npm run check:terrain-source -- overworld-meadow-grass-01
```

3. For manually acquired sources, drop maps into each generated candidate folder using the exact filenames listed in that folder's `SOURCE.md`.
4. Run `npm run build:terrain-assets`.
5. Inspect the generated files under `public/assets/terrain/generated/<set-id>/`.
6. Set the selected candidate to `enabled: true` and assign it to the correct profile slot only after visual QA.

## First locked source

`overworld-meadow-grass-01` is locked to ambientCG `Ground037` as the first grass/organic overworld baseline. The fetch script downloads the declared 2K JPG package, extracts only the required maps, and renames them into the standard terrain pipeline filenames.

The set remains disabled until the generated runtime output is inspected and approved.

## Expected map names

The current terrain pipeline expects:

- `albedo.jpg`
- `normal.png`
- `ao.jpg`
- `roughness.jpg`
- `height.png` when the source material includes usable displacement or parallax data

The build step repacks those maps into the runtime contract: sRGB basecolor, linear normal, packed ORM, and optional height.
