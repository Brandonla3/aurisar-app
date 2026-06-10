# Ashwood World — Remaining Items Backlog

Canonical list of Ashwood features still to port, plus cleanups from the
Phase 4 review ([PR #213](https://github.com/Brandonla3/aurisar-app/pull/213)).
Phases 0–5 of the original plan are merged; everything below was deliberately
deferred. Reference implementations live in `public/reference/ashwood.html`
(function names cited per item).

Ground rules for every item:

- **Determinism:** anything placement-relevant must derive from the canon
  seed / site manifest (see `docs/ASHWOOD_EXPORT.md`). New RNG consumption
  must be append-only stages after the existing ones (biome seeds → overworld
  manifest → forest). Client-local cosmetics (particles, wildlife motion) may
  use `Math.random`.
- **Draw calls:** scattered geometry goes through thin instances of shared
  templates (`ashwoodPropMeshes.js` has the pattern, including the
  `makeGeometryUnique()` and `world0..3` footgun fixes).
- **Bake pipeline:** static props added to the tile providers flow into
  `npm run bake:tiles` automatically; keep it that way.

## Visual / atmosphere

- [ ] **Cloud impostors or shader-dome clouds** — plain billboard planes read
  as dark walls under the tone-mapped pipeline (the disabled starting point
  is `AshwoodAtmosphere._buildClouds`). Reference: `buildClouds` /
  `updateClouds` (~line 1012).
- [ ] **Weather** — rain and lightning (`buildRain` / `updateWeather`),
  shooting stars at night (`updateShootingStar`).
- [ ] **Forest leaf wind sway** — `updateTrees` in the reference; likely a
  vertex-shader variant of the grass sway applied to canopy templates.
- [ ] **Procedural bark/leaf textures** on props; **mountain rock/snow
  texture blending** on terrain.

## Wildlife

- [ ] **Crows** — `buildCrows` / `updateCrows`.
- [ ] **Bats** (night, cave-adjacent) — `buildBats` / `updateBats`.
- [ ] **Rabbits / critters** — `buildCritters` / `spawnAnimal` /
  `updateAnimals` / `updateCritters`.

## World dressing

- [ ] **Ruins** — sites already exist in the manifest (`worldgen/sites.js`);
  meshes not built. Reference: `spawnRuin`.
- [ ] **Cave entrances** — same situation. Reference: `spawnCave`.
- [ ] **Hub campfires and signposts** — `buildFire` / `buildPost` /
  `updateFires`; not yet ported at all.

## Gameplay-adjacent

- [ ] **Wildwood tree collision** — `worldgen/forest.js` already computes a
  collision radius `r` per mature/giant tree (0 = walk-through sapling) but
  nothing consumes it; players currently walk through trunks.

## Pipeline

- [ ] **Baked-tile material parity** — embed the grass texture/normal map in
  baked GLBs so `USE_GLB_TILES` can flip on (see `docs/ASHWOOD_EXPORT.md`).

## Cleanups from the Phase 4 review

- [ ] `ashwoodPropMeshes.js:75` — `leaf.useVertexColors = false` is a no-op
  (`useVertexColors` is a mesh property, not a `StandardMaterial` one);
  per-instance broadleaf canopy tints currently *do* render. Move the flag to
  the template mesh if uniform canopies were intended, otherwise delete it.
- [ ] `ashwoodPropMeshes.js` — the `mat()` helper's `flat` parameter does
  nothing; the `gold` material is created then `void`-ed (wire it up with
  chest dressing or drop it).
- [ ] Perf watch: `AshwoodGrass._rebuild()` evaluates ~10k cells per 0.6 m of
  player movement — stagger across frames if mobile profiling shows hitches.
- [ ] Perf watch: confirm the shadow generator render list doesn't grow with
  tile churn over long sessions (prop clones register as casters per tile).
