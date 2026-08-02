# Terrain Asset Pipeline

This directory is the runtime destination for scanned or authored terrain PBR
materials. Enabled source sets are fetched and normalized before development and
production builds; the procedural terrain shader remains the rendering fallback
until texture sampling is wired into `terrainMaterial.js`.

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

Generated texture binaries are deterministic build products and are COMMITTED
to git together with `config/terrain-assets.lock.json` (config digest plus
SHA-256 of the manifest and every output file). Clean checkouts therefore build
fully offline; a 2026-08-02 Netlify deploy died on a transient ambientCG fetch,
so the build path must never depend on third-party hosts again (see the
regression guard in `scripts/sync_terrain_assets.mjs`).

## Standard commands

```bash
npm run sync:terrain-assets
npm run sync:terrain-assets:check
npm run dev
npm run build
```

`npm run dev` and `npm run build` invoke the terrain sync automatically through
`predev` and `prebuild`.

The sync step is offline:

1. reads enabled sets from `config/terrain-assets.json`;
2. verifies the committed outputs + manifest against
   `config/terrain-assets.lock.json`;
3. when current: no-op (the normal dev/CI/deploy path);
4. when stale with local sources present: renormalizes through
   `build_terrain_assets.mjs`, regenerates the manifest, refreshes the lock;
5. when stale without sources: fails and prints the explicit
   `npm run fetch:terrain-source -- <set-id>` command — it never downloads.

Check mode is the offline freshness gate CI runs:

```bash
npm run sync:terrain-assets:check
```

## Adding a scanned material

1. Add a candidate set to `config/terrain-assets.json` with `enabled: false`.
2. Record role, source directory, source filenames, author, license, original
   source URL, acquisition status, and download metadata when available.
3. Run `npm run prepare:terrain-sources` to generate local source folders and
   per-set `SOURCE.md` instructions.
4. For a locked downloadable set, run:

```bash
npm run fetch:terrain-source -- <set-id>
npm run check:terrain-source -- <set-id>
```

5. For manually acquired sources, place maps in the configured source directory.
6. Run `npm run sync:terrain-assets` and inspect the generated output.
7. Enable the candidate and assign it to a profile slot only after review.

Candidate metadata is validated even while disabled, but disabled candidates are
not fetched, normalized, or included in the runtime manifest.

## Current material status

The overworld candidate library contains:

- `overworld-meadow-grass-01` → `grass`
- `overworld-packed-dirt-01` → `dirt`
- `overworld-river-gravel-01` → `sand`
- `overworld-weathered-rock-01` → `rock`
- `overworld-dry-field-litter-01` → `field`

`overworld-meadow-grass-01` is the first enabled set. It is locked to ambientCG
`Ground037`, fetched as the 2K JPG archive, normalized into base color, normal,
ORM and height maps, and assigned to `profiles.overworld.grass`.

The remaining four candidates stay disabled until exact source assets are locked
and reviewed.

## Art direction targets

- **Overworld:** short meadow grass, packed trail dirt, river gravel, weathered
  rock, and dry field litter.
- **Mountain:** alpine turf, cold fractured rock, scree, and exposed soil.
- **Forest:** moss, damp loam, leaf litter, roots, and mossy stone.
- **Castle:** compacted earth, crushed gravel, worn masonry, and mud.
- **Dungeon:** damp stone, rubble, mineral staining, and puddled grime.

Prefer seamless 2K source maps for streamed terrain. Reserve 4K assets for close
hero patches, decals, or unique landmarks.

## Next phase boundary

The next PR should connect `TerrainAssetLibrary` to `terrainMaterial.js` and use
the enabled overworld grass set through world-space sampling, while retaining the
procedural albedo and relief path when the manifest or textures cannot load.
KTX2 variants and near-camera parallax follow after that integration is stable.
