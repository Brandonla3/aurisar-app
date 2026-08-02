# Terrain Source Assets

This directory is the local staging area for raw scanned or authored terrain PBR
maps before they are normalized into `public/assets/terrain/generated/`.

Raw source maps are intentionally ignored by git. Locked sources are reproduced
from acquisition metadata in `config/terrain-assets.json`. The generated runtime
maps in `public/assets/terrain/generated/` ARE committed, together with
`config/terrain-assets.lock.json`, so clean checkouts (Netlify, CI) build fully
offline — the build path never downloads from third-party hosts (see the
regression guard in `scripts/sync_terrain_assets.mjs`).

## Enabled-source workflow

`npm run dev` and `npm run build` run `npm run sync:terrain-assets`
automatically through `predev` and `prebuild`. The sync is offline: it verifies
the committed outputs against the lockfile and no-ops when they are current.

To change terrain content (edit `config/terrain-assets.json`, enable a set,
bump a source archive), fetch sources explicitly, rebuild, and commit:

```bash
npm run fetch:terrain-source -- <set-id>
npm run sync:terrain-assets
```

The sync rebuilds from the local sources, refreshes the lockfile, and tells you
to commit the regenerated outputs. It never downloads — if sources are missing
it fails with the exact fetch command to run.

To verify a checkout (the same offline gate CI runs):

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
