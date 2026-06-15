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
- [x] **Player-built campfires** — `buildFire` / `updateFires` ported as a
  full multiplayer feature: `campfire` table + `buildCampfire` reducer +
  scheduled burnout server-side; F key client-side; every client renders
  every burning fire (log pile, stone ring, coals, embers, flickering
  light). **No wood cost yet** — the prototype charged 3 wood; add the cost
  in `buildCampfire` when an inventory system lands. Burn time 3 min,
  10 s build cooldown, 3 fires per player (oldest snuffed). *(`buildPost`
  is the prototype's bloom post-processing pipeline — already covered by
  the existing DefaultRenderingPipeline — and there are no signposts in
  the reference.)*
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

## Tree branch structure (follow-up to PR #216)

PR #216 replaced the solid icosphere canopies with alpha-cutout **leaf cards**
(`src/features/world/streaming/ashwoodPropMeshes.js`): a dense, outer-shell
ellipsoid of textured quads over a bare trunk, outward-facing with AO vertex
tint. It reads as a full leaf mass but lacks the internal **twiggy branch
structure** of a real broadleaf (see the hazelnut reference). This item adds it.

**Where it lives:** `ashwoodPropMeshes.js`
- `buildPropTemplates(scene, opts)` — shared templates + materials (`bark`,
  `leafCardMat`).
- `buildTileProps(...)` — per-tile thin instances. Broadleaf = `acc.trunk` +
  `acc.leafCard`; Wildwood forest = `acc.fTrunk` + `acc.leafCard`.
- `Acc.push(px,py,pz, rx,ry,rz, sx,sy,sz, col)` → one thin instance;
  `acc.X.realize(name, template, scene, container, castShadow)` → one draw call.
- **Determinism is load-bearing:** every per-tree value comes from
  `mulberry32(t.seed)`. Per the ground rules above, new RNG draws must be an
  **append-only stage** in a fixed order, or clients desync.

**Steps:**
- [ ] **Template + accumulator** — add `T.branch` (tapered unit-length cylinder
  along +Y, ~6 sides) using the existing `bark` material so it inherits the
  bark texture; add `acc.branch = new Acc()` + a guarded `realize` (cast shadows).
- [ ] **Arbitrary-direction helper** — `Acc.push` takes Euler angles, awkward for
  arbitrary branch directions. Add `Acc.pushDir(px,py,pz, dir, length, radius,
  col)` composing the matrix from `BABYLON.Quaternion.FromUnitVectorsToRef(
  Vector3.Up(), dir, q)`.
- [ ] **Generate branches (broadleaf + forest)** — from the upper third of the
  trunk, emit 4–6 primary branches (direction outward + upward, length ~60–80%
  into the canopy ellipsoid), cylinder placed at the branch midpoint. Optional
  one level of thinner/shorter secondary twigs. Let tips poke slightly past the
  leaf shell so they read through the gaps.
- [ ] **Anchor leaf cards to branch tips (the realism multiplier)** — replace the
  pure-ellipsoid scatter with Gaussian leaf-card clusters around stored branch-tip
  positions, so leaves grow *from* branches while keeping the dense outer shell.
- [ ] **Bake mode** — branches are plain geometry + bark, so GLB-safe and may
  render in both the live and bake paths (bark falls back to vertex-color brown
  in bake). Leaf-card anchoring only applies where `templates.leafCard` exists;
  the bake / no-art fallback keeps today's blob recipe.

**Tuning knobs to expose:** primary-branch count, secondary-twig toggle/count,
radius taper, tip overshoot beyond the leaf shell, leaf-cluster spread.

**Verify:** `npm run build` + `npm run lint`; visually at Menu → ☀️ Noon on the
preview (overworld broadleafs *and* Wildwood forest, plus a from-below view —
branches should read through the canopy without looking like bare sticks).

**Out of scope:** pines (cones) and dead trees (bare branches) — separate
systems; only revisit with a needle texture. Performance is not a concern this
round (still one thin-instance draw call per template per tile). The day/night
**Time of day · testing** control (Menu) added in #216 is the tool for
evaluating lighting-sensitive passes like this.
