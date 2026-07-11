# Terrain Source Assets

This directory is the local staging area for raw scanned or authored terrain PBR
maps before they are normalized into `public/assets/terrain/generated/`.

Raw source maps are intentionally ignored by git. Locked sources are reproduced
from acquisition metadata in `config/terrain-assets.json`; generated runtime maps
are also ignored and published as CI artifacts.

## Enabled-source workflow

Run:

```bash
npm run sync:terrain-assets
```

The sync command checks every enabled terrain set. Missing locked sources are
downloaded and extracted; existing local maps are reused. The command then
normalizes all enabled sets and regenerates the runtime manifest.

`npm run dev` and `npm run build` invoke this automatically through `predev` and
`prebuild`.

To verify an already synchronized checkout without downloading:

```bash
npm run sync:terrain-assets:check
```

## Manual candidate workflow

1. Run `npm run prepare:terrain-sources` to create candidate folders and
   `SOURCE.md` instructions.
2. For a locked source, run:

```bash
npm run fetch:terrain-source -- <set-id>
npm run check:terrain-source -- <set-id>
```

3. For a manually acquired source, place maps in the configured source folder.
4. Run `npm run sync:terrain-assets` and inspect the generated output.
5. Enable the candidate and assign it to a profile slot only after review.

## First enabled source

`overworld-meadow-grass-01` is locked to ambientCG `Ground037` and assigned to
the overworld grass slot. The source fetch uses the declared 2K JPG archive and
extracts:

- `albedo.jpg`
- `normal.jpg`
- `ao.jpg`
- `roughness.jpg`
- `height.jpg`

The normalization build converts those source maps into the runtime contract:
sRGB `basecolor.jpg`, linear `normal.png`, packed `orm.png`, and linear
`height.png`.
