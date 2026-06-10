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
- [x] **Weather** — rain and lightning (`buildRain` / `updateWeather`),
  shooting stars at night (`updateShootingStar`). *(AshwoodWeather.js; the
  grass shader reads the published windStrength. Thunder SFX still skipped —
  no overworld audio system yet.)*
- [x] **Forest leaf wind sway** — material plugin in `ashwoodPropMeshes.js`
  injects world-space sway after the thin-instance matrix
  (`CUSTOM_VERTEX_UPDATE_WORLDPOS`), driven by the weather system's
  windStrength. *(The prototype's `updateTrees` tree-falling/fading is
  woodcutting gameplay — server-side, not ported.)*
- [ ] **Procedural bark/leaf textures** on props; **mountain rock/snow
  texture blending** on terrain.

## Wildlife

- [x] **Crows** — `buildCrows` / `updateCrows`. *(AshwoodWildlife.js)*
- [x] **Bats** (night, cave-adjacent) — `buildBats` / `updateBats`.
  *(AshwoodWildlife.js)*
- [x] **Rabbits / critters** — `buildCritters` / `updateCritters`.
  *(AshwoodWildlife.js)*

## World dressing

- [x] **Ruins** — `spawnRuin` ported as thin instances in
  `ashwoodPropMeshes.js` (walls, columns, archway, rubble).
- [x] **Cave entrances** — `spawnCave` ported (boulder horseshoe, void dome,
  stalagmites, crystals, glowing mushrooms, point light).

## Gameplay-adjacent (server/state decisions needed — not pure dressing)

- [ ] **Wildwood tree collision** — `worldgen/forest.js` already computes a
  collision radius `r` per mature/giant tree (0 = walk-through sapling) but
  nothing consumes it; players currently walk through trunks.
- [ ] **Player-built campfires** — `buildFire` / `updateFires` is a gameplay
  action in the prototype (F key, costs 3 wood: log pile + stones + flickering
  point light + ember particles). Needs inventory + multiplayer state, so it's
  a feature, not dressing. *(Earlier revisions of this list mislabeled this
  "hub campfires"; `buildPost` is the prototype's bloom post-processing
  pipeline — already covered by the existing DefaultRenderingPipeline — and
  there are no signposts in the reference.)*
- [ ] **Huntable fauna** — deer/boar (`spawnAnimal` / `updateAnimals`) carry
  hp/drops/health bars; these are server-side mob spawns in Aurisar's model,
  not client dressing.

## Pipeline

- [ ] **Baked-tile material parity** — embed the grass texture/normal map in
  baked GLBs so `USE_GLB_TILES` can flip on (see `docs/ASHWOOD_EXPORT.md`).

## Cleanups from the Phase 4 review

- [x] `ashwoodPropMeshes.js` — removed the no-op `leaf.useVertexColors`
  line (per-instance canopy tints render, as they always did), the dead
  `flat` parameter, and the unused `gold` material.
- [ ] Perf watch: `AshwoodGrass._rebuild()` evaluates ~10k cells per 0.6 m of
  player movement — stagger across frames if mobile profiling shows hitches.
- [ ] Perf watch: confirm the shadow generator render list doesn't grow with
  tile churn over long sessions (prop clones register as casters per tile).
