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
  tier. Plus a tier-scaled card budget (mobile 0.6×, low 0.8×, high unchanged — tightened
  again in Batch 2c to 0.45×/0.6×), so mobile leaf fill drops ~⅔ overall.
  (`ashwoodPropMeshes.js`)
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
  > **Superseded — this entry undersold the finding.** "The core ask is met" was wrong:
  > tier-gating bounds *which devices* pay, not *when*, and the distance skip filed here as a
  > nice-to-have was the whole cost. The mirror re-rendered the entire scene every frame at
  > any distance **and inside interiors that contain no water**. Fixed in Batch 2b below.
- **P4 — freeze:** `material.freeze()` skips per-submesh CPU readiness checks but does
  **not** reduce a material's per-fragment cost, so it would not cut the heavy terrain
  splat shader — which is already tier-scaled (oct 6/4/3; triplanar/voronoi high-only,
  `terrainMaterial.js:12-16`). Blind freezing also risks recompile-timing regressions
  (e.g. dungeon torches added after a freeze failing to relight the floor).
  `scene.freezeActiveMeshes()` is unsafe here — a chase camera + tile streaming
  constantly change the active-mesh set.
  > **Narrowed, not superseded — this entry was right to reject "blind."** The terrain
  > shader and `freezeActiveMeshes()` calls stand as written. But "blind" isn't the only
  > option: every grass material and every prop material that never receives a texture
  > (confirmed material-by-material, not assumed) freezes safely with zero recompile-timing
  > risk. Done in Batch 2c below, with the exact same "dungeon torches" failure mode named
  > here as the reason the textured foliage materials are deliberately excluded.
- **P2 — per-instance tree LOD is not expressible** on the current thin-instance foliage
  (one mesh per prop-type per tile; `addLODLevel` keys off the whole mesh, not per
  instance), and the config's 60/180/450 m thresholds barely trigger inside the
  3×3 × 256 m active ring (everything loaded is within ~360 m). Grass already self-culls
  per blade at a tier radius (13–24 m), tighter than the config's 45/80 m. The P1 leaf
  work is the pragmatic substitute; true tree LOD wants the deferred streaming re-tile /
  billboard-impostor work (§7).
  > Still accurate — per-instance LOD remains out of reach without the re-tile. Batch 2c
  > pushes further on the P1 substitute instead (tighter `leafScale`, plus closing a gap
  > this analysis didn't cover: ground-detail density had no tier scaling at all).

### Batch 2b status — the desktop/mobile inversion

Filed from a player report: **"I can barely run the game on my desktop. It runs fine on my
phone."** That reads as a paradox and isn't one. The tier resolver (`BabylonWorldScene.js`
`_resolveQualityTier`) sends every touch device to `mobile` and every desktop whose GPU
string doesn't match a short blacklist to `high`, and the gap between those two renderers is
roughly 5–15× of per-frame work:

| Per frame | `mobile` | `high` |
|---|---|---|
| Full scene geometry passes | 2 (shadow map + main) | **6** (4 CSM cascades + water mirror + main) |
| Full-screen post passes | GlowLayer | HDR pipeline + SSAO2 + blur + grain |
| Terrain shader | 3 octaves | 6 octaves + triplanar + detail normals |
| Render resolution | device DPR, small canvas | up to **1.5× DPR** on a desktop monitor |

That gap is intended. What was missing is that nothing bounded it — four defects let a weak
desktop start on the maximal stack and stay there:

- **The lake mirror rendered every frame, everywhere, forever.** P3 above was recorded as
  "already tier-gated", and it is — but it was *ungated within the tier*, which is the part
  that costs. The `MirrorTexture` is pushed into `scene.customRenderTargets`
  (`ashwoodTileProvider.js`) with `renderList = null` and no `refreshRate`; Babylon renders
  that array unconditionally each frame without checking whether the mesh sampling it is
  visible, on screen, or loaded. Nothing ever read `metadata.ashwood.waterMirror` back. So
  the high tier paid a **second full scene render** standing on the far side of the map, and
  inside Castle Ashwood where there is no water. Now distance-gated with hysteresis and held
  outright in interiors (`game/waterMirrorGate.js`, pure + unit-tested; driven by the scene's
  frame-budget governor). Note the invariant: `refreshRate`'s setter calls
  `resetRefreshCounter()`, whose "render at least once" rule forces a render on the next
  frame — so the rate must only ever be written **on change**, or the gate renders every
  frame anyway.
- **The engine never asked for the discrete GPU.** `_createEngine` passed no
  `powerPreference`, so WebGL's `'default'` applies — which on any switchable-graphics
  machine hands out the **integrated** GPU. Worse, it is self-concealing: the renderer string
  then reports the iGPU, so the tier sniff is reasoning about the wrong device. Now
  `'high-performance'` on desktop (not mobile — one GPU there, and it is a battery request),
  and deliberately not on the fallback retry path.
- **The GPU blacklist has a hole.** `/intel.*\b(uhd|hd)\s*graphics/` misses AMD Vega/680M
  iGPUs, keeps Iris Xe on `high` by choice, and — the common case — reads `unknown` when the
  browser **masks** the renderer string, falling through to the heaviest stack. Unfixable by
  extending the regex; addressed instead by giving the player an override (below).
- **Slowness never triggered a downgrade.** The safe-mode ladder only fires on WebGL
  *context loss*, and its one framerate check is `fps < 1` — "the GPU has stopped". A machine
  holding 12 fps is stable by that definition. `game/perfWatchdog.js` adds the missing signal
  (pure state machine, unit-tested): sustained sub-25 fps for 8 s, with a load grace period
  and backgrounded-tab suppression, both because a false positive silently downgrades someone
  who was fine. It sheds **in-session and without a reload** — reflections + SSAO + clouds,
  then render resolution — because the context-loss ladder reloads only since a lost context
  already took the world away, while a low framerate has not. It persists `safeLevel` so the
  next load starts lighter (where the tier is chosen at construction and can drop what cannot
  be torn down live), and suppresses the stability decay, which exists to walk back *one-off*
  stalls and this is not one.

Plus the thing that made all four invisible: **there were no graphics settings.** Menu →
Graphics now exposes quality (Auto/High/Balanced/Low, reloads — the tier decides what gets
*built*), a live water-reflections toggle, the existing volumetric-clouds toggle, and a
tier/GPU readout so a bad guess is legible rather than inferred. A preference replaces the
GPU sniff but deliberately does **not** outrank `safeLevel`: letting it would let a player pin
themselves to a configuration that cannot boot. `resetGraphicsQuality()` is the escape hatch.

**Still open:** the DPR cap itself (1.5 on desktop) is untuned — it is a real cost on a 1440p
or 4K monitor with three-plus full-screen passes, but lowering it blind trades sharpness for
frames on machines that may not need the trade. It wants the measured `?qa=1` GPU frame-time
readout on a real monitor, not a blind edit.

### Batch 2c status — closing out P1 and P4

Follow-up from the reporter's own hardware (`Intel(R) UHD Graphics (0x9A60)` — the tier
sniff correctly placed it on `low`, and it still ran 11-16 fps sustained even after the
governor's automatic shedding kicked in), plus a direct ask to go after leaf/grass cost
specifically since they were named as the dominant lag source independent of any one
machine. Two real levers, both previously deferred:

- **P4 — material freeze, scoped to what's actually safe.** The prior entry rejected
  `material.freeze()` broadly (it doesn't touch the terrain shader's per-fragment cost) and
  `scene.freezeActiveMeshes()` outright (chase camera + streaming). Narrower ask this time:
  every grass material (`grassBlades.js createGrassMaterial` — the AshwoodGrass field AND
  the tuft/fern understory share this one helper) plus the flat-color prop materials that
  never receive a texture in `ashwoodPropMeshes.js` (`leaf`, `rockM`, `wood`, `green`,
  `fLeafM`, `stone`, `boulderM`, the stalagmite/crystal/mushroom/cave-void materials).
  Deliberately NOT frozen: `bark`, `fTrunkM`, `pine`, `bushM`, and — the highest-value
  target — `leafCardMat`. All five assign a texture asynchronously
  (`applyOptionalTexture` / the leaf-card image-decode pipeline), and this Babylon version's
  `Material.isReady()` has a frozen fast path (confirmed by reading the shipped source, not
  guessed) that trusts the FIRST successful ready-check forever after, ignoring any later
  dirty flag — freezing before that async texture settles risks it never taking effect,
  the exact class of bug this doc already recorded once on the terrain material. The two
  scene-global per-frame uniform plugins (`GrassWindPlugin`, `LeafSwayPlugin`) are safe
  under freeze regardless, by construction: their values (wind clock, weather) are identical
  for every mesh sharing a frozen material in a given frame, so a cached/skipped rebind can't
  go stale. Covered by `grassBlades.test.js` (frozen + still pushes wind uniforms across
  real NullEngine render frames) and the new `ashwoodPropMeshes.test.js` (exact frozen/
  not-frozen material set).
- **P1 — leaf-card budget pushed further, plus a gap the tier scaling never reached.**
  `leafScale` (mobile/low canopy card count) tightened from 0.6/0.8 to 0.45/0.6 — a real,
  visible density cut on those two tiers specifically; high/desktop unchanged. Separately:
  ground-detail density (fern/tuft/flower understory) had **no tier scaling at all** before
  this — every biome detail rendered at full count on every device. Two sources, both now
  tier-scaled the same way leaf cards are: the sparse `s.details` manifest list (a `hash2`
  skip roll independent of the detail's own `mulberry32(d.seed)` stream, so which details
  survive is deterministic per seed without perturbing a surviving detail's own
  pick/scale/tint) and the denser per-tile procedural 260-candidate scatter (a straight
  loop-bound cut, since that `rng` is scoped to its own block). Covered by
  `ashwoodPropMeshes.test.js`, which pins both mechanisms against the real per-tier counts
  (`mobile: 0.55`, `low: 0.7`, `high: 1`) — not just the constants, the actual realized
  thin-instance counts out of `buildTileProps`.

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

**Pass 2 (merged in #273 — visual acceptance pending):**

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

**Pass 3 (merged in #274 — visual acceptance pending):** the atmosphere infrastructure the #273 review asked for.

- **Shared `AtmosphereState` contract** (`atmosphereState.js`). The sky dome, global fog,
  grass, and water each derived the sun direction independently (`sun = -key.direction`, three
  copies) — the drift the review flagged. `AshwoodSky._update` is now the sole writer of a
  single state bag at `scene.metadata.ashwood.atmosphere` (sun direction computed once as a
  unit ground→sun vector, plus sun visibility, fog colour/density, day/dusk/night, and the
  eased aerial facing weight); the grass, water, and volumetric-cloud binds read
  `atmosphere.sunDir` instead of recomputing it, falling back to the key light before the first
  overworld frame. `sunDir` is a live reference (a scratch mutated in place); `fogColor` is
  re-pointed each publish, since `LightingManager._blendProfiles` reassigns `scene.fogColor` to
  a new `Color3` on zone transitions and a captured reference would otherwise orphan. The shared
  `sunVisibilityFromWet` now backs both the fog tint and the state. Covered by
  `atmosphereState.test.js`.
- **Dev-only Atmosphere-QA overlay** on `devWorldViewer.js` (`?qa=1`, opt-in so it never
  enters the headless screenshot harness). Freeze/scrub the time of day, force weather
  wetness against the random cycle, toggle volumetric clouds, and read out sun elevation, sun
  visibility, aerial facing weight, fog RGB/density, and tier straight from the AtmosphereState
  — turning the acceptance matrix into reproducible states instead of subjective screenshots.

**Pass 4 (this PR — implemented, visual acceptance pending):** grass shadow-receiving.

- **Grass shadow-receiving** (`grassBlades.js`, `threejs-shadow-systems`). The grass was a
  hand-written `ShaderMaterial`, so `receiveShadows` did nothing for it — it couldn't sample the
  scene's shadows without hand-rolling cascade selection for the `CascadedShadowGenerator` (high)
  and blur-ESM `ShadowGenerator` (low/mobile), which is fragile and acne-prone on dense
  wind-displaced blades. Instead the grass is now a **`StandardMaterial` + a core
  `MaterialPluginBase`** (`GrassWindPlugin`): the plugin injects the world-space wind arc-bend
  (vertex, `CUSTOM_VERTEX_UPDATE_WORLDPOS`) and the root→tip darkening (fragment), while
  StandardMaterial owns lighting, **shadow receiving** (both generators, correct-by-construction),
  and built-in fog. The per-blade tint rides the thin-instance color buffer; its alpha is a wind
  seed, not opacity, so the material forces opaque via `needAlphaBlending` **and** pins the
  fragment output alpha to 1 in a late hook (so the seed can't leak into prepass/compositing
  alpha). Both the player-following field (`AshwoodGrass`) and the per-tile tuft/fern understory
  (`ashwoodPropMeshes`) set `receiveShadows = true`, so shadows don't stop at the field/understory
  boundary. A shared per-scene wind clock is ref-counted and torn down when the last grass
  material disposes. Covered by `grassBlades.test.js` (a headless NullEngine suite: plugin
  registration, opaque-alpha contract, thin-instance render, clock disposal). This is a
  **lighting-model change** (StandardMaterial vs the old custom wrapped diffuse), so it needs
  on-device visual acceptance and may take a tuning round — the JS/plugin layer is verified
  headless, but GLSL/appearance can only be seen on a GPU.
- **Deploy-preview review surface.** `world-viewer.html` (the standalone renderer + `?qa=1`
  atmosphere overlay) is now a Vite build input on Netlify **deploy-preview / branch** builds
  (gated on `CONTEXT`), so rendering PRs have a real-GPU review surface, while it stays excluded
  from production.

**Pass 5 (this PR — implemented, cost-measurement enabled):** high-tier CSM `autoCalcDepthBounds`.

- **`autoCalcDepthBounds`** on the high-tier `CascadedShadowGenerator` fits the cascade split
  range to the camera's actual near/far depth instead of the full `[near, shadowMaxZ]` span, so
  texels concentrate where geometry is → sharper contact shadows under the character. It is
  **capability-gated** (high tier only — the devices already running the 2048 CSM + SSAO2 stack)
  and works with `stabilizeCascades` (the anti-swim snapping stays; only the depth range
  tightens). The #276 review's concern was the per-frame camera-depth reducer it activates, so
  its cost is (a) reduced via `autoCalcDepthBoundsRefreshRate = 4` (refit every 4th frame — the
  range drifts slowly, a smooth chase cam doesn't need per-frame refits), and (b) made
  **measurable**: the `?qa=1` viewer overlay adds a runtime `autoCalcDepthBounds` toggle beside a
  real **GPU frame-time** readout (`EngineInstrumentation`, not just FPS), so the on/off cost can
  be checked against a threshold and the feature flipped off (or the refresh rate raised) in one
  line if it doesn't pay for itself. Watch for near/far pumping as large props (the castle) enter
  and leave view during the check.

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
  #272); Pass 2 — sun-directional aerial perspective (merged #273); Pass 3 — shared
  `AtmosphereState` contract + dev Atmosphere-QA overlay (merged #274); Pass 4 — grass
  shadow-receiving, field + understory (StandardMaterial + plugin, merged #276); Pass 5 —
  high-tier CSM `autoCalcDepthBounds` (capability-gated, refresh-throttled, `?qa=1` frame-time
  measurement). *Next:* record the visual-acceptance matrix per pass; re-validate the deferred
  Batch 2 perf items on-device. See §1 "Batch 3 status".
- **Batch 2b — The desktop/mobile inversion.** ✅ Filed from a player report: *"I can
  barely run the game on my desktop. It runs fine on my phone."* Not a paradox — the two
  devices run different renderers, and the desktop one had no floor under it. See §1
  "Batch 2b status".
- **Batch 2c — Closing out P1 and P4.** ✅ Follow-up from the reporter's own hardware plus
  a direct ask to go after leaf/grass cost specifically. Freeze every material that's
  actually safe to freeze (grass, flat-color props — not the textured foliage the P4 entry
  already flagged as risky); tighten `leafScale` further on low/mobile; tier-scale
  ground-detail density, which had no scaling at all before. See §1 "Batch 2c status".
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
