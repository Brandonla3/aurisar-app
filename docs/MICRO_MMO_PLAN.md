# Aurisar Micro-MMO — Plan & Progress

Porting the **concept** of [world-of-claudecraft](https://github.com/levy-street/world-of-claudecraft)
(MIT — a WoW-Classic-style micro-MMO: zones, NPCs, quests, classes, loot,
parties, dungeons) into Aurisar's existing Babylon.js 3D world on
SpacetimeDB. Story/names/art are working placeholders the owner rewrites;
systems and layout are the deliverable.

*Last updated: 2026-06-12 · Active PR: #219 (P1) · Merged: #218 (P0)*

---

## Locked decisions

1. **End-state = full micro-MMO**: quests/NPCs/dialogue, XP/leveling, all
   ability kits, loot/equipment, vendors, parties, trading, dueling,
   instanced dungeons. Built so content is easy to iterate on.
2. **Copy Claudecraft zones VERBATIM** as working placeholders — NPC
   names, quest text, positions, camps, props. Never invent substitutes.
   Zone 1 = their Eastbrook Vale (done). Zone 2/3 = their Mirefen Marsh /
   Thornpeak Heights (P5), same extraction method.
3. **XP comes ONLY from the fitness app.** `GAME_XP_ENABLED = false` in
   `src/features/world/content/formulas/xp.ts` gates every in-game XP
   path (built + tested, but off). World level =
   `xpToLevel(fitnessXp − fitnessXpBaseline)`; the baseline column enables
   the go-live "everyone restarts at level 1" reset (a data stamp, not a
   migration).
4. **Game rewards = equipment + workout-template unlocks + copper.**
   Equipment is dual-effect: in-world combat stats AND fitness perks
   (XP multipliers per exercise/muscleGroup/category) flowing to the
   fitness app via a Supabase mirror (`player_loadouts` /
   `account_inventory`, reserved in `world_build_config.json`). Future:
   fitness quests grant in-game equipment (grant rows + `claimedGrant`
   dedup table, designed in plan §2b).
5. **Zone level bands cap at 35**: zone 1 ≈ 1–7 (their band), zone 2/3
   land in P5 up to ~35. Players can reach fitness level 100.
6. **Classes**: all 9 Claudecraft kits mapped onto Aurisar's 11 classes
   (approved): warrior→Warrior, gladiator→Paladin, warden→Hunter,
   phantom→Rogue, tempest→Shaman, warlord→Priest-as-battle-leader,
   druid→Druid, oracle→Mage, alchemist→Warlock; titan/striker = derived
   tank/brawler variants. Display names come ONLY from
   `CLASSES[key].name` in `src/data/exercises.js` — renames are one edit.
7. **SpacetimeDB only** (module `aurisar-world`, maincloud). No second
   backend, no offline sim. CI publishes the module on main pushes.
8. **Mobile-lite**: explore/talk/non-combat quests on mobile; combat
   desktop-first. Avatar customize + CharacterTurntable review fully
   mobile.
9. **Art**: Claudecraft's CC0 assets as placeholders
   (`public/assets/ATTRIBUTION.md`); swap-in-place by filename is the
   contract for the custom Blender/Unreal art pass.
10. **The main/test character renders as the bare base-body GLB.**
    Default hair/clothing applies only to explicit configs (NPCs, saved
    player appearances).

Full original plan: `C:\Users\brand\.claude\plans\i-need-you-to-shiny-quokka.md`

---

## Architecture cornerstones

- **Canonical content** lives in `src/features/world/content/` (typed TS
  data: zones/npcs/quests/mobs/items/abilities/formulas).
  `npm run sync:content` mirrors it verbatim into
  `spacetimedb/src/content/` (GENERATED headers; `sync:content:check` is
  a CI gate). Edit content → sync → publish module + deploy client.
- **Server truth** = `spacetimedb/src/index.ts`: append-only `.default()`
  column migrations on hot tables; new features = new tables + reducers;
  interval scheduled tables (4 Hz mob AI). Coordinates: 1 m = 32 STDB px,
  origin px(1600,1600), world ±1000 m.
- **Deploy order every phase**: publish module → `spacetime generate`
  bindings → deploy client. New-table subscriptions ride separate
  subscription builders so stale module/client pairs degrade gracefully
  (campfire precedent).
- **Client systems** live in `src/features/world/systems/` (NpcSystem,
  PropsSystem), HUD in `src/features/world/hud/`, hooks in
  `src/features/world/hooks/`.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| P0 | Content package + sync bridge + vitest + MANIFEST dedupe | ✅ merged (PR #218) |
| P1 | Eastbrook Vale map/town, NPCs, dialogue, quest system, CharacterTurntable | ✅ in PR #219 |
| P2 | Progression bridge: `playerProgress` + `syncProgress(fitnessXp)`, baseline reset, copper/template rewards, Supabase mirror v1 | ⬜ next |
| P3 | Combat core (`playerCombat`/effects/casts + tick gating, `castAbilityV2`, hotbar/targeting/fx) + all 11 class kits | ⬜ |
| P4 | Server inventory/loot/equipment/vendors; fitness perks live; collect-objective quests activate (q_boars, q_spiders, q_supplies, Aldric chain) | ⬜ |
| P5 | Zones 2–3 (copy Mirefen Marsh + Thornpeak Heights), zone travel, per-zone bounds/graveyards | ⬜ |
| P6 | Parties, trading, dueling | ⬜ |
| P7 | Hollow Crypt dungeon (instances via `instance_id`), q_sexton/q_hollow activate | ⬜ |
| P8 | Procedural WebAudio, authored icons, mobile perf, meshopt compression, chat cleanup | ⬜ |

## What's in PR #219 (branch `claude/p1-zone1-quests`)

**Server** (`spacetimedb/src/index.ts`):
- `playerQuest` table + `acceptQuest` / `abandonQuest` / `turnInQuest` /
  `reachWaypoint` reducers (range-validated ≤6 m against content NPC
  positions; once-only with prereq chains; readiness recomputed from
  counts — stored state is a cache).
- Kill-credit hook in `castAbility`'s kill path.
- Mob seeding switched from tile JSON to content `SPAWNS`/`MOBS`
  (self-heal pass retires old rows on first `seedWorld` after publish);
  mob AI generalized to per-`MobDef` stats; `setPlayerInfo` class
  allow-list = the 11 real Aurisar classes.

**Zone 1 = Eastbrook Vale, copied 1:1** from their `zone1.ts`:
- 7 NPCs verbatim (Marshal Redbrook, Trader Wilkes, Apothecary Lin,
  Brother Aldric, Smith Haldren, Fisherman Brandt, Foreman Odell).
- 9-mob roster (forest_wolf … old_greyjaw, gorrak) at their 12 exact
  camp coordinates; CC0 creature GLBs as stand-ins + family-shaped
  primitive fallbacks.
- Kill-objective questline active now: q_wolves → q_greyjaw / q_bandits
  → q_ringleader, q_murlocs, q_mine, q_bones (verbatim text/rewards).
  Collect + dungeon quests staged in comments (P4/P7).
- Geography in `src/features/world/config/zone1_world.json`: hub plateau
  r26 at origin, graveyard (−12,−14), Mirror Lake (−92,88), their 6 road
  polylines, their 8 POIs. (Their Three.js terrain renderer can't be
  transplanted — our heightfield reproduces their geography; everything
  ON it is their data.)
- **PropsSystem** (`systems/PropsSystem.js`) builds the town from their
  verbatim placement data (`content/zones/zone1/props.ts`): houses, inn,
  chapel + bell tower, well, market stalls + smithy clutter, fences,
  bonfires, bandit tents/crates, murloc mud huts, Fallen Chapel ruin
  ring, Copper Dig mine entrance, Mirror Lake dock. 34 CC0 prop GLBs in
  `public/assets/props/` (+7 creatures in `public/assets/mobs/`),
  attribution in `public/assets/ATTRIBUTION.md`.

**Client UX**: NpcSystem (distinct clothed NPCs, !/? markers,
tap/E Talk prompt), DialoguePanel (mobile bottom sheet), QuestLogPanel
(L / 📜 button), QuestTracker HUD, waypoint auto-report,
CharacterTurntable on the Character tab (mobile review surface).

**Fixes landed along the way**:
- Boar/bandit invisible-mob bug (Codex review) → every mob type has a
  primitive fallback.
- **Pre-existing main bug**: clothing GLBs were exported with a 90° X
  rotation unapplied to vertex data → all garments skinned into a
  crumpled pile at the feet ("naked clones"). Healed at runtime in
  `CharacterAvatar._normalizePieceOrientation` (+ robust name-based bone
  relink `_bindInstanceToRig`). Re-exported assets pass through untouched.
- Unconfigured avatars = bare base-body GLB (decision #10).

## Known limitations / gotchas (carry into next session)

- **Quest accepting only works after merge** — the PR's Netlify preview
  runs the new client against the pre-P1 prod module. Post-merge, CI
  republishes; first `seedWorld` migrates mobs to the Eastbrook camps.
- Local dev: `spacetime` CLI v2.5 IS installed
  (`%USERPROFILE%\AppData\Local\SpacetimeDB`). Regenerate bindings from
  `spacetimedb/`: `spacetime generate --lang typescript --module-path .
  --out-dir ../src/features/world/module_bindings`.
- Dev preview without an account: landing → LOG IN → "👁 Preview Mode" →
  PIN `1234`. No `.env` needed for `npm run dev`.
- Repo-wide `npm run lint` fails on pre-existing errors (netlify
  functions, App.jsx, `catch (_)` house pattern) — only keep NEW files
  clean.
- The legacy "Hollow Crypt" portal still sits ~38 m south of the hub
  (pre-existing `_buildDungeonEntrance`); P7 relocates dungeons under the
  Fallen Chapel.
- No LoS / tree collision yet (accepted; backlog), `chat_message`
  unbounded (P8 cleanup), inventory still localStorage until P4.
- Their coordinate frame was carried 1:1 (their +x=west vs ours = map
  mirror) — relative layout is identical; do the same for zones 2/3.

## Next up: P2 — progression bridge

`playerProgress` table (level, gameXp unused-while-flagged, copper,
fitnessXpBaseline, discoveredZonesMask) + `syncProgress(fitnessXp,
statsJson)` reducer (monotonic clamp, level from the shared curve);
quest turn-ins grant copper + template unlocks (`playerUnlock` table);
Supabase mirror v1 writes on login/checkpoint/logout. Level on
nameplates/HUD. See plan §2b for the trust model and reverse-bridge
design.
