# Aurisar 3D World — Diagnostic & Improvement Roadmap

**Scope:** the 3D "Aurisar World" (`src/features/world/`) — rendering performance,
spatial/coordinate organization, the minimap + world map, and how to use the
`babylonjs-engine` and `threejs-*` skills to improve it.

**Status:** Batch 0 (world-layout cleanup) landed in this PR. Batches 1–4 below
are the sequenced roadmap. Every finding cites `file:line` evidence.

---

## 0. Engine reality check

The world runs **entirely on Babylon.js 9.17 (WebGL)**. `game/BabylonWorldScene.js`
(~2,900 lines, mounted by `WorldGame.jsx:450` and `devWorldViewer.js`) is the only
live renderer. Two dead stacks were shipping in the tree and are **removed in this PR**:

- **Three.js** — sole consumer `src/components/AvatarPreview3D.jsx` had zero
  importers; `three` was still bundled (a `vite.config.js` manualChunk).
- **A whole Phaser 2D world** — `game/AurisarWorldScene.js`, `PlayerSprite.js`,
  `OtherPlayerSprite.js`, `UIScene.js`, `constants.js` imported `phaser`, which was
  never even a dependency. Never mounted.

**Consequence for the skills question:** the `babylonjs-engine` skill is the *direct
implementation reference* (the actual engine). The `threejs-*` skills are *technique/
algorithm references* — their code is Three-specific, but the math, the ordering, and
especially the **validation methodology** transfer, and Babylon has an API equivalent
for nearly every one (see §5).

---

## 1. Performance

**The foundation is genuinely good** and should be preserved:
GPU-tier detection (`BabylonWorldScene.js:1166-1214`), DPR cap via
`setHardwareScalingLevel` (`:958-965`), an escalating WebGL-context-loss safe-mode that
sheds SSAO2 → CSM → shadows → resolution and decays back (`:826-833,1234-1326`), heavy
thin-instancing, shared materials, and frozen tile world-matrices (`tileLoader.js:61-62`).

Prioritized hotspots (target: **balanced desktop + mobile**):

| # | Finding | Evidence | Fix direction |
|---|---------|----------|---------------|
| **P1** | **Leaf-card explosion** — 150–210 alpha-tested `DOUBLESIDE` quads per broadleaf tree, up to 220 per Wildwood tree. The overworld scatter *requests* 880 trees (`scatter.treeCount`) but the generator actually places **~359** (rest rejected by biome/forest/mountain/exclusion); the dense Wildwood forest adds more, counted separately. Still the largest fill-rate/overdraw risk in the active ring; authors flagged "perf out of scope" twice. | `streaming/ashwoodPropMeshes.js:537,740,259-262`; `worldgen/forest.js`; realized counts via `scripts/verify_worldgen.mjs` | Cap cards by distance/tier; billboard-merge far canopies; add LOD (P2). `threejs-procedural-vegetation` |
| **P2** | **Declared-but-missing LOD** — config sets `lod_required:true` with full profiles (trees 60/180/450 m, grass 45/80 m, castle 300 m), but there is **zero** `addLODLevel`/`simplify` in code. | `config/world_build_config.json:78,159-175`; grep | Wire `mesh.addLODLevel()` per the config profiles; `babylonjs-engine` §Performance |
| **P3** | **Lake `MirrorTexture` = a full second scene render every frame** (high tier), on top of SSAO2 + 4-cascade CSM + 2 pipelines. This is the exact stack the safe-mode blames for context loss. | `streaming/ashwoodTileProvider.js:648-653`; `BabylonWorldScene.js:817-826` | Gate behind tier/distance; drop to a cheap planar/cubemap or SSR fallback |
| **P4** | **No global scene freeze toggles** — no `scene.freezeActiveMeshes()`, `material.freeze()`, or `blockMaterialDirtyMechanism`; props + avatars are never frozen, and the multi-octave terrain splat shader (FBM/ridged/triplanar/voronoi per fragment) is unfrozen. | `game/terrainMaterial.js:39-297`; grep | Freeze static materials/meshes; `scene.freezeActiveMeshes()` after load; `babylonjs-engine` §Scene Optimization |
| **P5** | **Per-mob material churn** — primitive mobs build 9–12 meshes with **fresh, uncached** `StandardMaterial`s, plus **2 new HP-bar materials per mob**, and every HP bar `lookAt(camera)` each frame. | `BabylonWorldScene.js:2596,2010,2020,1739` | Cache `_stdMat` by key; share HP-bar materials; use `billboardMode` instead of per-frame `lookAt` |
| **P6** | **Many per-frame observers** — ~15–25 `onBeforeRenderObservable` callbacks + up to 22 flickering dungeon point-light observers; each water material adds its own. | scene + subsystem files; `ashwoodTileProvider.js:675` | Consolidate into one tick dispatcher; throttle flicker |
| **P7** | **Overlapping camera-anchored domes** — sky dome (r 1200), volumetric-cloud raymarch dome (r 1150, 22 steps + 2 sun taps), and a possible `createDefaultSkybox(1500)` can coexist. | `game/AshwoodSky.js:214`, `AshwoodVolumetricClouds.js:34-113` | Ensure a single sky owner per tier; skip the cloud dome on low/mobile |

Reference context: shadows use `CascadedShadowGenerator(2048)` with 4 cascades on high
tier (`BabylonWorldScene.js:1490-1501`); terrain is `CreateGround` at 96 subdivisions =
**9,409 verts/tile** × 9 active tiles ≈ 85 k terrain verts (`ashwoodTileProvider.js:26`).

### Batch 2 status (implemented)

**Delivered** — verifiable, behaviour-preserving or tier-gated:

- **P1 — leaf-card fill.** Canopy quads are now single-sided: the material already
  draws both faces (`backFaceCulling=false` + `twoSidedLighting`), so the `DOUBLESIDE`
  geometry was doubling vertices *and* overdraw for no visual gain — ~halved on every
  tier. Plus a tier-scaled card budget (mobile 0.6×, low 0.8×, high unchanged), so
  mobile leaf fill drops ~⅔ overall. (`ashwoodPropMeshes.js`)
- **P5 — mob material churn.** `_stdMat` caches per type/family; the two HP-bar
  materials are shared; `_removeMob` no longer disposes the shared materials; the
  redundant per-frame HP-bar `lookAt` is gone (the planes already billboard).
- **P6 — observer count.** The per-torch (≤12) and per-magic-accent (≤10) flicker
  observers collapse into one shared loop observer (a `FlickerLights` registry that owns
  its own list + observer; matching the already-consolidated campfire / CastleLightPool
  patterns); the flicker maths is unchanged. Covered by `flickerLights.test.js`.

**Deferred** — real, but they need on-device GPU validation rather than a blind edit:

- **P7 — sky-dome overdraw** was attempted (skip the gradient dome when it looks
  invisible by day) but reverted after review: the gate keyed off `_cloudCover`, which is
  the FBM *threshold*, not the resulting `cloudA`, so even at the cutoff dense samples can
  still produce visible cloud/haze pixels — a boolean `setEnabled(false)` pops them, and
  the residual deck is an *intended* thin-haze layer when volumetric clouds are on. A safe
  version fades an explicit dome-opacity uniform to true zero (with hysteresis) or gates on
  measured output alpha — both need on-device tuning. The volumetric-cloud dome is already
  high-tier/opt-in gated.

- **P3 — the lake mirror is ALREADY tier-gated:** reflective water is built only when
  `qualityTier === 'high'` (`ashwoodTileProvider.js:82`); `water`/`streamWater` never
  mirror, so the core ask is met. A further *distance* skip (the half-res mirror still
  re-renders the whole scene each frame even when the player is far from the lake) is
  worthwhile but risks the reflection popping while the lake is still visible — a
  threshold to tune live.
- **P4 — freeze:** `material.freeze()` skips per-submesh CPU readiness checks but does
  **not** reduce a material's per-fragment cost, so it would not cut the heavy terrain
  splat shader — which is already tier-scaled (oct 6/4/3; triplanar/voronoi high-only,
  `terrainMaterial.js:12-16`). Blind freezing also risks recompile-timing regressions
  (e.g. dungeon torches added after a freeze failing to relight the floor).
  `scene.freezeActiveMeshes()` is unsafe here — a chase camera + tile streaming
  constantly change the active-mesh set.
- **P2 — per-instance tree LOD is not expressible** on the current thin-instance foliage
  (one mesh per prop-type per tile; `addLODLevel` keys off the whole mesh, not per
  instance), and the config's 60/180/450 m thresholds barely trigger inside the
  3×3 × 256 m active ring (everything loaded is within ~360 m). Grass already self-culls
  per blade at a tier radius (13–24 m), tighter than the config's 45/80 m. The P1 leaf
  work is the pragmatic substitute; true tree LOD wants the deferred streaming re-tile /
  billboard-impostor work (§7).

### Batch 3 status

Visual quality via the `threejs-*` technique skills, in bounded passes. There is no GPU
here to eyeball renders, so each change replaces a hack or omission with the technique the
skill prescribes — verifiable by the technique, not by taste. **Build/test success proves
the code path, not the art result.** A pass is *implemented* when it merges green and
*visually accepted* only once the acceptance matrix below has been run on the deploy preview
and its result recorded here — those are tracked separately on purpose (the historical
regressions in this subsystem have been subtle visual drifts, not build breaks).

**Visual acceptance matrix** (run on the deploy preview, per pass, before marking accepted):
morning / noon / golden hour / night × dry-clear / full wet-overcast × camera facing the sun,
side-on, away, and a full orbit × terrain-props / water / grass in the same frame × high / low
/ mobile tiers (volumetric-cloud toggle where available). Acceptance rejects: hue pumping
during camera movement, over-bright orange rain haze, water/grass seams, fog banding, and
sun/sky disagreement.

**Pass 1 (merged in #272 — visual acceptance pending):**

- **Lake body colour — Beer-Lambert depth absorption** (`threejs-water-optics`). The lake
  mixed its deep→shallow colour by *wave slope*, so it read as one flat teal. It now absorbs
  the shallow tint toward the deep tint exponentially along the baked vertical-depth proxy
  (`vShore`) — dark deep centre → bright shallow edge. Streams (no depth field) keep the
  legacy slope look via a `bodyDepthMix` uniform; ponds use a gentler `bodyAbsorbK`.
  (`ashwoodTileProvider.js`)
- **Selective mobile bloom** (`threejs-bloom`). The mobile/low `GlowLayer` has no threshold,
  so it bloomed *every* emissive — the mob HP-bar fill, NPC quest markers, and character
  nameplates all haloed like light sources. A `LightingManager.excludeFromGlow()` blocklist
  (no-op on desktop, where the layer is null) excludes those artefacts at their creation sites
  (HP-bar background + fill, NPC markers, and every `CharacterAvatar` nameplate — player,
  remote, and NPC); intended emitters (portal, castle windows, crystals, forge coal, and the
  night shooting-star streak) still bloom. Rain is a non-emissive `LinesMesh`, so it never
  glowed and needs no exclusion.

**Pass 2 (this PR — implemented, visual acceptance pending):**

- **Sun-directional aerial perspective** (`threejs-atmosphere-aerial-perspective`, analytic
  tier). The overworld haze was direction-agnostic while the sky dome already warms toward
  the sun — a soft version of the skill's "sky and terrain haze must not use different sun
  directions" failure. An analytic in-scattering tint on the single `scene.fogColor` write
  (`AshwoodSky._update`) now warms the haze when the camera faces the sun and cools it when
  facing away, sharing the sky's sun direction. Strongest at golden hour, gone at night.
  Every fog consumer — terrain/props (Babylon fog), water/grass (`vFogColor`) — inherits it
  from that one write, so it is world-wide and mutually consistent with no per-shader edits.
  Because `scene.fogColor` is one *global* colour, three guards keep it reading as aerial
  perspective rather than a camera-following filter: the weight is **weather-gated**
  (`sunVisibility` from `weather.wet` — an overcast sky that hides the sun makes the haze
  neutral, not amber), **asymmetric** (dominant warm toward-sun lobe, gentle cool away side),
  and **temporally eased** (the tint lags the camera ~0.5s, so a fast orbit can't pump the
  world between the two ends). The scattering maths lives in a pure `aerialPerspective.js`
  helper with unit coverage (toward-sun warmer, away bounded, night = baseline exactly,
  wet attenuates, degenerate vectors finite, channels in `[0,1]`).

**Deferred to a later pass** — real, but not bounded enough to ship blind:

- **Shared `AtmosphereState` contract.** The sky shader, global fog, water, and grass each
  read sun direction / fog colour / density through their own path today. A single source of
  truth (sun direction, sun-scatter colour, cloud/sun visibility, fog colour, density) they
  all consume would stop independently-tuned coefficients drifting apart — the right home for
  the aerial-perspective magic numbers once they settle on-device. Larger than a visual pass;
  its own refactor.
- **Dev-only Atmosphere-QA overlay** on `devWorldViewer.js`: freeze/set time, force
  dry/rain, toggle volumetric clouds, and read out sun elevation, cloud/sun visibility,
  facing weight, fog RGB/density, and tier — turning the acceptance matrix into reproducible
  states instead of subjective screenshots. Tooling, tracked with the `threejs-visual-validation`
  harness in Batch 3's remit.
- **Grass shadow-receiving.** Grass is a hand-written `ShaderMaterial` (`grassBlades.js`), and
  the world runs **two** shadow systems — a `CascadedShadowGenerator` (4 cascades) on high and
  a blur-ESM `ShadowGenerator` on low/mobile. Making a custom shader sample either means
  manually replicating the cascade-selection/split binding a `StandardMaterial` gets for free,
  which is fragile, Babylon-version-sensitive, and acne/swim-prone on dense, wind-displaced
  blades. Needs on-device iteration, not a blind edit.
- **High-tier `autoCalcDepthBounds`** (CSM cascade-sharpness nicety) — one line, but it adds a
  per-frame depth pass and interacts with the tuned `stabilizeCascades` setup; measure on
  device before enabling.

---

## 2. World layout — the coordinate problem

The world carried **four overlapping coordinate systems**. Two were live and unreconciled,
two were dead:

| System | Where | Extent | Status |
|--------|-------|--------|--------|
| Worldgen disc (live 3D) | `config/zone1_world.json` | radius **520 m**, content only ~±180 m | live |
| Tile-streaming grid | `config/world_build_config.json` | ±1000 m, 256 m × 8×8 = 64 tiles, 3×3 ring active | live |
| Phaser 2D grid | `game/constants.js` | 3200 px, 100×100 | **dead → removed** |
| Fitness-app SVG map | `src/data/constants.js` | separate feature | unrelated |

Consequences (evidence): the server's `1600` px origin is a fossil of the dead Phaser
world (`spacetimedb/src/index.ts:110`); nested unreconciled scales mean **~95 % of the
streamed area is empty** and everything east of `x=500` is force-flattened
(`worldgen/heightfield.js:58`); the streaming grid was off-by-48 (8×256=2048 vs a stated
2000). The **two world configs are genuinely different worlds** (different zone/lake
positions *and* scatter counts), yet the bake/verify scripts targeted `ashwood_world.json`
while the client renders `zone1_world.json` — so every baked GLB/heightmap described a
different world than the live game.

**The `content/` graph is the healthy part** — a typed TS content model with a
CI-validated `validateContent()` (`content/index.ts:71-211`): 11 classes, items,
formulas, and zone1 (9 mob types/12 camps, 7 NPCs, 14 quests, 9 POIs). The disorganization
was purely spatial/coordinate, not content.

**Spatial layout** is a coherent starter-zone hub-and-spokes: spawn at origin `(0,0)`
(`content/zones/manifest.ts:25`) → Oakrest hub → radial ring of level-2–6 camps → Castle
Ashwood dungeon (gate `112.5,20`) → north-pass gate `(0,170)` toward the unbuilt Zone 2.
The authored `biomes[].danger` gradient (0.15→1.0) exists but **nothing wires it to spawns**.

### Fixed in this PR (Batch 0)
- Deleted the dead Phaser + Three.js stacks.
- Repointed the tile + heightmap bake scripts and `verify_worldgen.mjs` to the live world
  (zone1) with a `--config` escape hatch; marked `ashwood_world.json` dev-only.
- Introduced **`src/features/world/worldSpace.js`** as the single client coordinate source
  of truth (`PX_PER_M`, the legacy `1600` origin, `toWorld`/`toStdb`, `mapBounds()`),
  imported by the scene and both 2D maps; the server mirrors it with a pointer comment.
- Fixed the off-by-48 (`world_bounds_m` max → 1048). The bounds are intentionally
  asymmetric (`-1000..+1048`): `min` stays −1000 so the origin tile `T_03_03` (and its baked
  asset) don't shift; only `max` is corrected to the grid's true `8×256 = 2048` extent.
  (`tileMath` never reads `max`, so this is descriptive; a client/server parity + tile-bounds
  test now locks it — `worldSpace.test.js`.)

### Deferred (see §7)
Normalizing the `1600` server origin to zero is a **live-data migration** and is out of
scope here; it stays encapsulated behind `toWorld`/`toStdb`. Re-tiling/shrinking the grid
buys little (only the 3×3 ring loads) and would churn tile IDs. Building Zone 2/3 and
wiring the danger gradient are content work.

---

## 3. Minimap & world map — why the character read wrong

Two canvas-2D maps share `mapRender.js`: the **minimap** (`TestingHud.jsx` — a misnomer;
it's the production minimap: top-right circular, player-centered) and the **World Map**
(`WorldMap.jsx` — full-screen modal). The plot math was correct; the character read wrong
because of coordinate-framing bugs:

- **World Map bounds blowout** — `combinedBounds()` inflated X to ~1420 to include the
  teleport-only dungeon interiors at world `x=1000/1300`, squishing the r=520 disc into the
  left ~54 % so the player always sat off-center beside a void. `WorldMap.jsx:24-35`.
  **→ Fixed:** now frames to `mapBounds(config.radius)` (the disc).
- **Minimap config mismatch** — the tile grid + yellow "world bounds" box were drawn from
  `world_build_config.json` (±1000, 256 m tiles) while the terrain/player came from the
  r=520 disc, so the box floated far outside the world. `TestingHud.jsx:26,253-313`.
  **→ Fixed:** dropped the streaming-grid overlays; draw the actual playable-disc edge.

Still open, and scheduled for **Batch 1**:

- **Silent no-marker while the avatar loads** — the minimap aborts its whole render when
  `getPose()` is null (`TestingHud.jsx:80`) and the World Map skips the marker
  (`WorldMap.jsx:96`), so during load / dungeon transitions there is no player dot and no
  cue. Add a "locating…" state.
- **Missing detail** — other players (`_remotePlayers` exists at `BabylonWorldScene.js:857`
  but there is no `getRemotes()` accessor), chests (`getChests()` exists at `:2667` but is
  never plotted), NPCs, POIs/waypoints, the castle, zone boundaries, and height/relief
  shading are all absent though the data exists.
- **Label fallbacks vs one real hardcode** — the lake and marker labels already use the
  config name with a fallback (`lake.name ?? 'Mirrormere'`, per-interior `d.name`), so the
  live lake already reads "Stillmere". The one genuine bug: `locationLabelAt`'s in-dungeon
  case returns `hollowDeep.name` for *any* dungeon (`mapRender.js:96`), so the header
  mislabels Frostspire Halls as the Hollow Crypt.

The scene already exposes the accessors a richer map needs: `getPose()` (`:2625`),
`getMobs()` (`:2642`), `getMapData()` (`:2658`), `getChests()` (`:2667`), `getLocation()`
(`:2673`) — Batch 1 adds `getRemotes()` and wires the rest through `drawMapMarkers`.

---

## 4. What this PR changed (Batch 0 summary)

Low-risk-first, one concern per commit:

1. Remove dead Phaser 2D stack.
2. Remove unused three.js dependency + dead `AvatarPreview3D`.
3. Point terrain bake scripts at the live world (zone1) with a `--config` flag.
4. Make `verify_worldgen` config-general, default to zone1 (probe points derived from
   config; plateau targets treated as design hints, not exact contracts — see note below).
5. Mark `ashwood_world.json` dev-only.
6. Add `worldSpace.js` as the single client coordinate source of truth.
7. Frame the World Map + minimap to the playable disc.
8. Fix the streaming grid's off-by-48 world bounds.

> **Note surfaced by (4):** running `verify_worldgen` against zone1 revealed that zone1's
> plateau data is looser than Ashwood's — the nominal summit shelf `(-285,-315)` target 122
> realizes only ~114, and the actual highest shelf is `(-250,-322)`; two shelves sit
> off-massif and are never carved. Not a code bug (targets blend with the dome + path
> carves; `mtnH` is 0 off-massif), but a **design-data quality** item for a future content pass.

---

## 5. Using the skills

**`babylonjs-engine`** is the direct reference. Its Performance Optimization section maps
1:1 onto Batch 2: `mesh.freezeWorldMatrix`/`material.freeze` (P4), instances/thin-instances
(P1), `mesh.addLODLevel`/`simplify` (P2), `SceneOptimizer`, and `setHardwareScalingLevel`
(already used). Its pitfalls (draw calls, disposal, main-thread blocking) match the mob/prop
churn in P5.

The **`threejs-*` skills are technique references** with direct Babylon equivalents — load
them for the *algorithm*, implement with Babylon APIs:

| Existing system | Skill | Babylon equivalent |
|---|---|---|
| Shadows (`_setupShadows`) | `threejs-shadow-systems` | `CascadedShadowGenerator`, texel snapping, update budgets |
| `AshwoodGrass` / `grassBlades` | `threejs-procedural-vegetation` | thin-instance GPU grass, rooted wind, LOD (P1) |
| `AshwoodVolumetricClouds` | `threejs-volumetric-clouds` | bounded raymarch, temporal reconstruction, quality tiers (P7) |
| `AshwoodSky` | `threejs-atmosphere-aerial-perspective` | Rayleigh/Mie + depth aerial perspective |
| color/output | `threejs-exposure-color-grading` | `ImageProcessingConfiguration` (single tone-map owner) |
| bloom/glow | `threejs-bloom` | `DefaultRenderingPipeline` bloom / `GlowLayer` |
| `AshwoodWeather` | `threejs-precipitation-surfaces` | coupled weather + surface wetness masks |
| lake (Stillmere) | `threejs-water-optics` | analytic waves + Fresnel + absorption (vs the P3 mirror) |
| chase camera | `threejs-camera-direction` | scale-aware chase rig, collision, floating origin |
| the audit itself | `threejs-visual-validation` | fixed-view diagnostics, seed sweeps, GPU budgets on `devWorldViewer.js` |

The single most valuable cross-cutting habit from the pack is
`threejs-visual-validation`: stand up a fixed-view, seeded, no-post baseline harness on top
of the existing `devWorldViewer.js` so every Batch-2/3 change has before/after evidence and
a GPU budget.

---

## 6. Prioritized roadmap

- **Batch 0 — World-layout cleanup.** ✅ This PR.
- **Batch 1 — Map & character.** `getRemotes()` accessor; always-show player with a
  "locating…" state; plot other players / chests / NPCs / POIs / castle / zone labels via
  `drawMapMarkers`; off-map edge markers for teleport dungeons; fix hardcoded names; optional
  height/relief shading in the bake.
- **Batch 2 — Performance.** *Delivered:* P1 leaf-card fill (single-sided + tier budget),
  P5 mob material cache + HP-bar billboarding, P6 dungeon-observer consolidation (with a
  `flickerLights.test.js` regression test). *Deferred (on-device validation):* P7 (sky-dome
  skip — reverted; the boolean toggle can pop the intended thin-haze), P3 (mirror already
  tier-gated; distance skip), P4 (selective material freeze), P2 (per-instance tree LOD needs
  the re-tile / impostor work). See §1 "Batch 2 status" for the rationale. Guided by
  `babylonjs-engine`.
- **Batch 3 — Visual quality via skills.** Apply the `threejs-*` techniques to the
  `Ashwood*` systems (grass, clouds, sky, water, shadows, color) with a single tone-map owner,
  in bounded passes, each visually accepted on the deploy preview before it's closed out.
  *Implemented:* Pass 1 — lake Beer-Lambert depth absorption + selective mobile bloom (merged
  #272); Pass 2 — sun-directional aerial perspective. *Next:* record the visual-acceptance
  matrix per pass; a shared `AtmosphereState` contract + dev Atmosphere-QA overlay; grass
  shadow-receiving; high-tier CSM `autoCalcDepthBounds`; re-validate the deferred Batch 2 perf
  items on-device. See §1 "Batch 3 status".
- **Batch 4 — Deferred / higher-risk.** Server `1600`-origin normalization (live data
  migration) + the `detectZone` 3200 px fossil; streaming re-tile; delete `ashwood_world.json`;
  wire the `danger` gradient to spawns; build Zone 2/3.

---

## 7. Deferred migration risk (explicit)

`WORLD_CENTER_PX = 1600` (`spacetimedb/src/index.ts:110`) is baked into **live stored
coordinates** — player spawn/respawn `(1600,1600)`, stored player x/y, mob `spawnX/Y`,
campfires — and into `detectZone`'s hardcoded 3200 px rectangles. Normalizing to a zero
origin means subtracting 1600 px from every persisted row plus a coordinated client + server
deploy. It stays encapsulated behind `toWorld`/`toStdb` (client) and `WORLD_CENTER_PX`
(server); both now point at `worldSpace.js`. **Do not migrate without a data plan.**
