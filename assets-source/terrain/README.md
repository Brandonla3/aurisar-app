# Terrain Source Assets

This directory is the local staging area for raw scanned or authored terrain PBR maps before they are normalized into `public/assets/terrain/generated/`.

Raw source maps are intentionally ignored by git because they can be large and may be replaced frequently during art direction. Commit only this README, candidate metadata in `config/terrain-assets.json`, and the generated runtime outputs once a set is approved.

## Workflow

1. Run `npm run prepare:terrain-sources`.
2. Drop source maps into each generated candidate folder using the exact filenames listed in that folder's `SOURCE.md`.
3. Run `npm run build:terrain-assets`.
4. Inspect the generated files under `public/assets/terrain/generated/<set-id>/`.
5. Set the selected candidate to `enabled: true` and assign it to the correct profile slot only after visual QA.

## Expected map names

The current terrain pipeline expects:

- `albedo.jpg`
- `normal.png`
- `ao.jpg`
- `roughness.jpg`
- `height.png` when the source material includes usable displacement or parallax data

The build step repacks those maps into the runtime contract: sRGB basecolor, linear normal, packed ORM, and optional height.
