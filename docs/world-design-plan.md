# Aurisar World — Design & Content Improvement Program (Zones, Layout, Assets, Characters)

**Status:** approved 2026-07-24. Batch A landed with the PR that added this doc; each
subsequent batch records its landing PR here, world-diagnostic style. Landed: Batch A
(#275), Batch B (#277). Batch C is split into **C1** (visible gear + combat feel + audio —
world-only, this PR) and **C2** (the fitness-XP perk bridge + template unlocks — touches the
fitness core, follows separately) to keep the high-risk XP-path change isolated and
reviewable.

## Context

Aurisar is a fitness app (React/Vite + Supabase) with an embedded 3D MMO RPG world
(Babylon.js 9.17 WebGL client + SpacetimeDB authoritative server). Design law: **XP comes
only from real workouts** (`GAME_XP_ENABLED=false`); the game world provides **gear** via
quests, dungeons, chests, and vendors, and gear is meant to boost workout XP
(`ItemDef.fitnessPerks`) and game stats. `docs/world-diagnostic.md` carries the technical
roadmap (perf/coordinates); this plan is the missing **design/content layer**: zone layout,
biome identity, POI pacing, dungeon depth, character/creature life, visible gear, audio,
and the asset pipeline to feed it all.

Produced by: 3-agent codebase exploration → 3-lens design panel (world/level design,
characters/creatures, pipeline/integration) → synthesis → adversarial critique (18
findings, all folded in below). All file references verified against the repo.

### Program decisions (locked with the product owner)
1. **Art**: Hybrid — keep procedural terrain/sky/water/grass; curated CC0 glTF packs for
   buildings/props/characters through a real import/optimization pipeline.
2. **Characters**: rigged modular GLB avatars with **visible equipped gear** — build on the
   existing MPFB+Mixamo system, don't replace it.
3. **Scope**: Zone 1 depth-first. Zone 2/3 and economy/P2P trading are later phases.
   Dungeon work in scope where it serves Zone-1 depth and the gear loop.
4. **Scale**: hub/camps designed for ~50–100 concurrent; no netcode rewrite.
5. **Confirmed additions**: fitnessPerks + quest template-unlock wiring in Batch C; a
   minimal CC0 audio slice (~1–2 MB) with Batch C; the one-time chest reset ("chests
   restocked") in Batch D is accepted.

### Verified current state (compressed)

- **World**: one real zone (Zone 1, r=520 m disc, content ~±180 m + Frostspire mountain arm
  to peak 138 m at (−285,−315) — **~40 % of authored terrain has zero gameplay**). Terrain
  100 % runtime-procedural (`worldgen/heightfield.js surfaceY`, append-only RNG determinism
  contract). 5 biomes seed-shuffled Voronoi, **not aligned to namesake POIs**; `danger`
  gradient wired to nothing. Only Castle Ashwood is a real dungeon (procedural from
  `castle/castlePlan.js`, 5 floors/37 rooms, server instancing). **Hollow Crypt and
  Frostspire Halls are labels with no interiors** (crypt portal at (0,−37), *south* of hub,
  no trail to it). Nature props: procedural thin-instances from the seed manifest.
  Settlement: ~34 CC0 GLBs hand-placed via `content/zones/zone1/props.ts` +
  `systems/PropsSystem.js`, **no collision**. Positions authored in 3 unreconciled places
  (worldgen config / content graph / castle plan) with documented drift. An unlabeled
  duplicate overworld Gorrak sits at (92,−92) granting no quest credit. The graveyard
  respawn point has no visuals at all.
- **Characters**: players/NPCs are Mixamo-rigged MPFB GLBs, Idle/Walk cross-fade only —
  Run/Jump clips ship unused; **no attack animation**. **Mobs are static** (7 of 8 mob GLBs
  ship full clip sets that `_buildMobVisualFromGlb` discards; no facing; `wolf.glb` is a
  15 KB clipless placeholder; `tribal.glb` for bandits is a flying creature). **Gear is
  invisible**: `setGear()` + Blender auto-skin pipeline exist, zero gear GLBs exist,
  content `EquipSlot` ≠ avatar `GEAR_SLOTS`, nothing bridges server equip → avatar.
- **Systems**: quests/chests/loot/vendors/dungeon-instancing/combat all work
  server-authoritatively. Stubbed: `fitnessPerks` unread, `gameStats` unread (flat
  `MELEE_DAMAGE=25`), quest `templateUnlockIds` advertised in UI but never granted, no
  rare/epic items. **A brand-new user's first-session shape was wrong** — the only
  ungated quest was an 8-kill loop 55–70 m out, and worldLevel derives purely from
  fitness XP so every `minLevel: 2+` quest stays locked until real workouts land
  (fixed in Batch A by `q_first_blood`). **Zero audio exists.**
  SpacetimeDB subscriptions are unfiltered `SELECT *` and movement syncs at 20 Hz —
  O(N²) row fan-out at scale.

## Design pillars

1. **"Painted Realism"** — one art direction anchored by the MPFB humans: realistic
   silhouettes, low-mid-poly kit geometry, no flat-faceted shading on organic forms,
   muted 16-swatch palette (albedo sat ≤0.60), roughness 0.7–0.95. Enforced by offline
   pipeline treatment presets at import (never a runtime pass, never an outline shader).
   One owning doc: `docs/ART_DIRECTION.md`.
2. **Life before land** — highest payoff-per-line is zero-download: wire the animations
   already on disk before touching terrain. The program's spine is the gear loop closing:
   *earn gear → see it on you and others → feel it in workout XP*.
3. **One reshuffle, then frozen ground** — exactly one deliberate worldgen RNG reshuffle
   (Batch D: biome anchors + road corridors, `meta.version` 3→4, chest regen + stated
   one-time reset, GOLDEN regenerated once). Everything else CONFIG-SAFE, append-only, or
   independent derived streams (`mulberry32(hashCombine(seed, category))`).
4. **Generate + `--check` is how truth is shared** — coordinate drift dies via a generated
   landmarks module (the house pattern's 4th use: content mirror, castle manifest, chests),
   reducing editable copies of shared positions from 3 to 1.
5. **Promote, don't populate; every byte budgeted** — the empty 180–520 m band is fixed by
   naming/routing content the deterministic manifest *already generates*. Download ledger:
   14 MB → ~9 MB (re-optimization) → **≤18 MB at program end** (cap 30 MB;
   first-interactive ≤8 MB mobile after lazy loading).

## Phased batches

Two parallel tracks. **Track 1 (character/render): A → B → C.** **Track 2 (world): D → E →
F → G → H.** Dependencies (critique-corrected): E depends on **A, B, D**; F on **B, D**;
G/H on their predecessors. Every batch leaves the world shippable. Effort: S <1 d, M 1–3 d,
L 1–2 wk.

**Batch 0 (with the first PR):** commit this plan as `docs/world-design-plan.md` so the
repo carries it, world-diagnostic style.

### Batch A — Mob & Avatar Life + program groundwork (zero download) — M
Files: `game/BabylonWorldScene.js`, `game/CharacterAvatar.js`, new `game/AnimationController.js`,
new `game/MobAnimator.js`, `game/avatarSchema.js`, `game/MobAssetLibrary.js`,
`systems/NpcSystem.js`, `content/zones/zone1/{quests,mobs}.ts`, `.github/workflows/ci.yml`.

- **Groundwork (critique fixes):** add `verify:worldgen` GOLDEN check to `ci.yml` (it
  existed but *nothing ran it*; extended with a site-position digest so count-preserving
  reshuffles fail too); establish the named 2–3 real-device benchmark matrix
  (mid-tier Android + iPhone; fixed hub/castle-approach/Gallows capture stations) rerun in
  every batch's acceptance; **first-5-minutes fix** — landed as `q_first_blood`, an
  additive L1 3-wolf quest at the nearest (north-road) camp; both it and `q_wolves` are
  offered by Marshal Halwin at L1 by design. The notice-board breadcrumb prop stays in
  Batch E. Acceptance: account creation → first quest turn-in ≤5 min.
- New `AnimationController.js`: clip-manifest resolution (replaces the idle/walk regex
  pair), frame-rate-independent exponential blending (τ≈120 ms), one-shots with
  time-tagged events. Consumers: CharacterAvatar, MobAnimator, NpcSystem.
- New `MobAnimator.js` + code-side `MOB_CLIPS` table: stop discarding
  `inst.animationGroups` (`_buildMobVisualFromGlb`); position smoothing (mobs currently
  teleport), velocity-derived facing, locomotion state, hp-drop → hit one-shot,
  proximity → attack loop. **Death play-out lives in the `onMobDelete`/`_removeMob` path**
  (server *deletes* the row on kill — play clip, defer `dispose()` ~1.2 s, tolerate
  respawn onInsert), not `applyMobUpdate`'s dead-branch.
- Procedural fallback life (~60 lines): facing, idle bob, hit flinch via `overlayColor`
  (never tint shared `_stdMat`), fall-over death — covers primitives + placeholder wolf.
- Run locomotion for players (speed from planar displacement, idle/walk/run blend,
  `speedRatio` stride match — Run clips already ship in all three base bodies).
- Shared distance-gating helper (pause anim >45 m, half-rate 25–60 m, per-tier animating-
  skeleton caps, mobile ≤12 nearest-first) — reused for remotes in Batch E.
- Combat feel (no-new-clip half): yaw-snap to target on attack; 150–200 ms hp-bar drain
  lerp. NPC authored appearances table (`NPC_APPEARANCES` in NpcSystem).

Acceptance: every GLB mob idles/walks/attacks/dies with facing, no teleporting; primitives
bob/flinch/fall; players run; new-user first quest ≤5 min; device matrix frame-time flat at
hub on mobile tier; zero download delta.

### Batch B — Pipeline core, re-optimization, manifests — M+M
Files: new `scripts/assets_pipeline.mjs`, `config/asset-packs.json`, `config/asset-budgets.json`,
generated `public/assets/manifest/*.manifest.json`, `game/babylonDecoders.js`,
`docs/ART_DIRECTION.md`, `ci.yml`, `devWorldViewer.js` (`?hud=assets`).

- gltf-transform pipeline (prune/dedup/flatten/join-static/weld/resample/quantize +
  opt-in meshopt; self-hosted decoder; **KTX2 deferred** until texture payload >5 MB,
  Draco rejected); treatment presets `kit_default` / `creature_rigged` / `gear_skinned`.
- Re-run all ~70 existing GLBs (`skeleton_minion` 2.0 MB→<400 KB; crates ~1.2 MB→~150 KB).
  **Keep `lantern_wall.glb`** (repurposed as an NPC hand prop in C — critique fix).
- Path reconciliation: content `glbKey` resolves via generated manifests; delete
  `MobAssetLibrary.MANIFEST` + key→file halves of `PropsSystem`/`AssetLibrary`; fix
  `/assets/creatures/` doc-comments; `validateContent()` rule: every `glbKey` resolves.
- CI validators: manifest integrity, per-class tri/byte/texture budgets, license records
  (generated ATTRIBUTION section), **rig/clip contract** (MPFB bone names; required clip
  names per creature), NullEngine boot smoke test. `check:assets` lands in `ci.yml`.
- `docs/ART_DIRECTION.md` + palette swatches + turntable screenshot gate.

Acceptance: pixel-identical world; `public/assets` ≈9 MB; CI fails on missing/over-budget/
clip-contract-violating assets.

### Batch C — The gear-loop payoff: attack, visible weapons, perks, audio — L
Files: new `scripts/build_player_anims.mjs`, `game/gearVisuals.js` (new), `avatarSchema.js`
(`EQUIP_TO_GEAR` map), `game/CharacterAvatar.js` (`TODO(weapons)` at ~:708),
`WorldGame.jsx`, `useSpacetimeWorld.js`, `hud/GearPanel.jsx`, `src/utils/xp.js`,
`src/state/useWorkoutCompletion.js`, `content/items/*`, new `game/AudioSystem.js`,
`spacetimedb/src/inventory/helpers.ts` (template unlocks).

- Player attack set: retarget-by-bone-name merge (Quaternius UAL CC0 primary, 1-clip spike
  first; Mixamo fallback documented) of Attack_1H_Slash/Attack_Unarmed/Hit_React/Death
  into all three base bodies (+0.9 MB). Swing plays instantly alongside `onCastAbility`
  (server stays authoritative); contact frame ~0.3 s ≈ STDB round-trip.
- Gear bridge: `EQUIP_TO_GEAR` slot mapping; `gearVisuals.js` (itemId → modelKey/tint/
  socket + rarity table + `CLASS_TINTS`); forward `onEquippedUpsert/Delete` →
  `scene.applyEquipUpdate/Remove`; pending-equip queue replayed after avatar rebuild;
  implement the rigid weapon branch in `setGear` (bone-socket to RightHand, horns pattern).
- Weapon intake through the B pipeline: 9 mainHand models (~0.45 MB) + GearPanel/
  AvatarPreview entries. Mob fixes: real animated wolf (most-seen mob), humanoid bandit
  recast (~+0.5–0.7 MB). Class identity layer 1: `CLASS_TINTS` (11 classes). NPC hand
  props: lantern (kept), small hammer/rod intake (budgeted, not "0 MB").
- **fitnessPerks wiring**: aggregate equipped `fitnessPerks` client-side
  (`useServerInventory` × `ITEMS`); **pass perks as an explicit argument applied only at
  workout-logging call sites** (`calcExXP` is also the plan/preview estimator — critique
  fix); hard ≤1.35 stacking cap, unit-tested. **Template-unlock grants** at quest turn-in
  (same trust envelope). Both mirror the existing `syncProgress` client-trust posture;
  server-side hardening noted as later phase.
- **Audio slice** (~1–2 MB CC0): swing/hit/loot/UI/footsteps + wind bed; `AudioSystem.js`
  on Babylon's audio engine; per-biome ambient beds arrive with F's biome kits.

Acceptance: equip a sword → visible in hand to you and nearby players within one row
update; Space = audible swing landing with the hp drain; logged workout with
`wolfsbane_blade` shows +3 % strength-category XP, capped when stacked; previews
unaffected; quest turn-in grants its advertised training plan; wolves are animated wolves.

### Batch D — Coordinate truth + the one reshuffle — M (parallel to B/C; gates E–H)
Files: `config/zone1_world.json` (v3→4), `worldgen/biomes.js`, `worldgen/forest.js`,
new `scripts/emit_zone1_landmarks.mjs`, generated `content/zones/zone1/landmarks.generated.ts`,
`scripts/emit_world_chests.mjs`, `content/zones/zone1/*.ts`, `validateContent()`, `ci.yml`.

- **Everything reshuffle-class lands here, once**: authored `biomeAnchors` (12 anchors —
  named biomes verifiably contain namesake POIs), **all road corridors** (castle road,
  crypt road south to (0,−37), north-pass road as a `forest.js` path — trails are
  render-only and forest edits reshuffle stage-3 draws, so they must ride this cut;
  critique blocker #2), hub-plateau/exclusion resize. `meta.version` 3→4; GOLDEN
  regenerated once per documented procedure + biome-raster/realized-position dump.
- **Chest-ID stability (critique blocker #1)**: switch chest ids to position/seed-derived
  keys during this migration window (exclusion edits can never re-index again); CI-assert
  id→(x,z,seed) stability. One-time `playerChestOpened` reset, announced as "chests
  restocked" (user-approved).
- Landmarks emitter: `anchors` section in `zone1_world.json` → generated
  `landmarks.generated.ts`; migrate consumers (waypoints/npcs/mobs camp centers/props/
  dungeon entrances); castlePlan cross-check assert; resolve Stillmere (−92,88 vs −88,82)
  once; **delete `meta.notes` position prose**. Emitter also exports promoted
  ruin/cave realized positions (consumed in F — prevents re-creating drift).
- Danger↔spawn CI rule (`|mobLevel − (1+danger×6)| ≤ 2`) **plus the camp/danger retune
  task to make it pass** (camps move via LANDMARKS; critique fix #15).

Acceptance: Gloomweb POI provably inside Gloomweb biome (raster dump); roads exist in the
manifest; danger rule green; all shared positions single-authored; chest keys stable under
a test exclusion; `verify:worldgen` + all `--check` gates green.

### Batch E — Readability: roads, hub at 50–100 CCU, edges, maps, server load — M/L
Files: `zone1_world.json` (plateaus/exclusions — now chest-safe), `content/zones/zone1/{props,npcs}.ts`,
`systems/PropsSystem.js`, new `systems/propColliders.js`, `BabylonWorldScene.js`,
`useSpacetimeWorld.js`, `TestingHud.jsx`/`WorldMap.jsx`/`mapRender.js`, `spacetimedb/src/index.ts`.

- Road dressing (roads carved in D): signposts, 5 waystone shrines (find-quest targets,
  future fast-travel seam), Zone-2 tease gatehouse at the north pass.
- Hub relayout for 25–40 concurrent occupants: plateau r26→34; zoned layout (≥12 m NPC
  spacing, 6 m road throats): arrivals plaza + notice board S, quest court NE, market
  lane W, chapel precinct SW, smithy N. **Graveyard build-out** at (−12,−14) — legible
  die→respawn→re-quest flow.
- Sightlines/vistas: Tuskfield crest castle-reveal plateau, Old Watchtower (45,45)
  plateau+prop (the zone "postcard"), Mourner's Rest h4→7, spawn→Frostspire corridor.
  World edge: 3 E/SE ridge plateaus (all x<480; x>500 is force-flattened), r495 soft
  push-back + r460 fog lift (client-only).
- **Prop collision**: `propColliders.js` — analytic oriented rects/circles/fence capsules
  from authored footprints (castle-nav house style; engine mesh collision was already
  tried and removed), 16 m hash grid, `resolveMove` slide; settlement freeze pass.
- Crowd tech (one work item): nameplate cap (nearest 20), remote piece-drop >30 m,
  Batch A animation tiers applied to `_remotePlayers`. **Server-load work (critique #6,
  must precede H): WHERE-filtered subscriptions (at minimum `dungeon_instance_id`
  scoping; fallback coarser table scoping if the deployed STDB lacks filtered SQL),
  reduced move-send rate, headless-bot load-test milestone.**
- **Absorb world-diagnostic Batch 1 (critique #12)**: `getRemotes()` accessor,
  always-show-player "locating…" state, plot remotes/chests/NPCs/POIs/castle via
  `drawMapMarkers`, fix the `locationLabelAt` any-dungeon→Hollow-Crypt mislabel.

Acceptance: road to every named destination; respawn flow readable without the map; no
walking through the inn (doorways pass); minimap/world-map show the new POIs + remotes;
simulated 40-avatar crowd + bot load test hold budgets on device matrix.

### Batch F — Biome identity, danger feel, curve fixes, lazy loading — L
Files: `content/zones/zone1/{props,mobs,quests,waypoints}.ts`, `ashwoodPropMeshes.js`,
`AshwoodSky/Grass/Wildlife.js`, `mapRender.js`, `AssetLibrary.js`, `MobAssetLibrary.js`,
`world_build_config.json` (`lod_profiles.props`).

- Biome identity kits (≤3.5 MB, pipeline-validated): 5 signature landmarks (Greyjaw
  Glade, cairn road, Broodmother Hollow dressing, gallows ring + cracked bell, hub
  farmland); per-site-seed prop variants (zero new global draws). Per-biome ambient audio
  beds land here.
- Wilds promotion: name 3–4 realized ruins/caves **via the D landmarks emitter** (not
  hand-copied coords) as waypoints + one find-quest each — the 25 chests gain gravity.
- Danger consumers: fog density/grass desaturation/wildlife swap keyed off
  `biomeAt(player).danger`; map skull-tint.
- Curve fixes: rares Rutfang + Chitter-Queen; **replace duplicate overworld Gorrak** with
  "Serah the Knife" + castle-gate rumor breadcrumb (safe: `q_ringleader` counts only
  `ca_boss`). **Rule (critique #13): never edit a live quest's objectives — version the
  quest id** (index-based `countsJson` misaligns otherwise).
- Prop LOD + hard distance culling (first `addLODLevel` in the codebase, tier-scaled,
  lands with the influx it protects). Lazy loading: critical/deferred `AssetLibrary`
  split, `MobAssetLibrary.ensure(mobType)` on first spawn; first-interactive ≤8 MB.
  Wildwood trunk collision (site-manifest circles into E's hash grid — backlog payoff).

Acceptance: blindfold drop → biome identified in 5 s; danger felt before fatal; no
duplicate boss; first-interactive ≤8 MB mobile; LOD pops invisible at gameplay distance.

### Batch G — Frostspire expedition + skinned armor — L+L
- Expedition (40 % of terrain gains gameplay): Guide Toma + Lower Gate camp (−155,−138),
  3-quest chain (Lower Gate → Switchbacks → Summit Cairn) shaped as 15–20 min legs,
  frost-wolf + ridge spawns, guaranteed summit chest (**appended** authored entry — no
  reshuffle), sealed Frostspire door at the summit shelf as the physical Zone-2-era tease.
  Positions via LANDMARKS.
- Gear Phase B (armor): `gear_skinned` treatment driving `04_import_armor.py` headless;
  5 chest pieces + gloves (≤6 k tris each), legs/boots as retints of existing clothing;
  clothing-hide rule in `setGear` (disable underlying slot to prevent clipping);
  uncommon brass-trim rarity treatment. +1.5 MB. Drops wired into expedition loot.

Acceptance: 3 solo-completable session-sized legs; summit vista + door tease; equipping
chain_vest visibly replaces the tunic on you and remotes, no clipping (screenshot matrix
per piece — the PR #163 regression class).

### Batch H — Dungeon depth + rare/epic ladder — L+M
- Castle pass (`castlePlan.js`, CONFIG-SAFE): bandit-dressing breadcrumbs to the treasury,
  per-floor light accents, 5 floor chests + treasury great-chest, 4 pillar navBlockers in
  the boss arena (aoePulse counterplay).
- **The Hollow Crypt** (dungeon #2): new `castle/cryptPlan.js` (same plan schema; builders/
  nav emitters reused), ~12 rooms + ossuary half-level, kobold/undead halves, Gravecaller
  boss; entrance at the existing (0,−37) portal; uncommon-guaranteed boss loot (first
  head/offHand items) + 3 interior chests. **Named work item (critique #8): per-dungeonId
  server refactor** — `enterDungeon`/`leaveDungeon`/nav/`surfaceAt`/exit-hotspot are
  castle-hardcoded today; parameterize by dungeon id (reducer work, not netcode).
- Rare/epic ladder: 6 rare + 4 epic ItemDefs (perks rare 1.04–1.06, epic 1.06–1.10 under
  the ≤1.35 cap); ladder: overworld (common/uncommon) → Crypt L3–4 (uncommon-guaranteed)
  → Castle floors/boss (rare) → **boss-wing re-entry capstone shaped to ≤20 min sessions**
  (instances die when empty — no full-clear-spanning epics). Phase C visuals: helmets
  (head-bone attach), shield (LeftForeArm), trinket = rarity FX only; rare emissive trim +
  epic motes (hard caps: 1 emissive + 1 particle system per avatar, off on mobile).
- Remove the phantom Frostspire Halls advertisement **at its real home**
  (`zone1_world.json interiors` + `WorldMap.jsx` prose; preserve `interiors.hollowDeep`
  lookup used by `locationLabelAt`).

Acceptance: L3 player has a 15–20 min dungeon with guaranteed uncommon; treasury fight has
cover; a rare glows on its owner in the hub; no advertised-but-fake content remains.

### Later phases (noted, per scope lock)
Zone 2 behind the north pass; Frostspire Halls interior; economy/P2P trading; VAT crowds;
tree impostors (stays in world-diagnostic Batch 4); KTX2 (gated on texture payload);
server-side perk validation hardening; baked-tile parity.

## Cut list (deliberate)
Jump mechanic (no mechanic exists — clip stays baked); upper-body attack masking;
VAT/BakedVertexAnimation; KTX2 now / Draco ever; weapon sheathing; server danger-weighted
spawn tables (CI rule gives the guarantee free); tightening the world radius (reshuffle-
class; the band is fixed by promotion); outline/toon cohesion pass (fill-rate + fights the
atmosphere); runtime material normalization as a standing pass (baked offline instead);
engine mesh collision for props (tried and removed once); `meta.notes` position prose
(deleted in D, never maintained again); live-data migrations beyond the single stated
chest reset (1600 px origin untouched per world-diagnostic §7).

## Risk register (top lines)
- **Stray reshuffle**: GOLDEN gate enters CI in Batch A (it exists but is unwired today);
  determinism classes (CONFIG-SAFE / append-only / derived-stream / RESHUFFLE) documented
  in `worldgen/` in Batch D; new scatter only via derived streams.
- **Skeletal CPU at 50–100 CCU**: remote MPFB avatars dominate, not mobs — A's gating
  helper + E's caps + device matrix every batch.
- **Fill rate**: no new alpha-card foliage anywhere in the plan; prop LOD lands in F
  before the prop influx completes.
- **Art cohesion**: pipeline treatment presets + turntable-next-to-base-body gate.
- **Retarget quality**: 1-clip spike before committing the Quaternius set.
- **Server fan-out**: E's filtered subscriptions + move-rate + bot load test precede H's
  second dungeon; STDB filtered-SQL support unverified → fallback is coarser scoping.
- **Download ledger**: 14→~9 (B)→~10.9+audio (C)→~14.4 (E/F)→~15.9 (G)→~16.6 (H) ≈
  ≤18 MB vs 30 MB cap; CI-enforced from B.
- **Schedule**: the two late L-rocks (Crypt, Frostspire) are severable — A–F each ship
  complete player-facing value without them.

## Verification
- **Per batch**: `npm test` (vitest incl. `validateContent()` integrity), `npm run
  verify:worldgen` (GOLDEN), all `--check` emit gates, `check:assets` (from B),
  NullEngine boot smoke test; visual QA on `world-viewer.html` / `devWorldViewer.js`
  (`?hud=assets`, fixed capture stations) + the world-diagnostic acceptance-matrix habit
  (time-of-day × weather × camera × tier); real-device matrix (2–3 named devices) from A.
- **Loop-level (C)**: equip weapon → visible on self + remote within one row update;
  workout log with perk gear shows capped multiplier; template unlock granted at turn-in.
- **World-level (D–F)**: biome raster dump proves POI/biome alignment; danger CI rule;
  chest-key stability test; first-interactive payload measurement; 40-bot load test (E).
- **First-session (A onward)**: fresh account → first quest turn-in ≤5 min.

## Critical files
`src/features/world/game/BabylonWorldScene.js` · `game/CharacterAvatar.js` (new:
`AnimationController.js`, `MobAnimator.js`, `gearVisuals.js`, `AudioSystem.js`) ·
`src/features/world/config/zone1_world.json` · `worldgen/{sites,biomes,forest}.js` ·
`content/zones/zone1/*` (+ generated `landmarks.generated.ts`) · `castle/castlePlan.js`
(template for `cryptPlan.js`) · `systems/{PropsSystem,NpcSystem}.js` (new:
`propColliders.js`) · new `scripts/{assets_pipeline,emit_zone1_landmarks,build_player_anims}.mjs` ·
`scripts/emit_world_chests.mjs` · `src/utils/xp.js` · `useSpacetimeWorld.js` ·
`spacetimedb/src/index.ts` · `.github/workflows/ci.yml` · new `docs/ART_DIRECTION.md`.
