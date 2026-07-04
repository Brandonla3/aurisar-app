/**
 * Aurisar World — SpacetimeDB Server Module
 *
 * This module is the authoritative server for the Aurisar 2D multiplayer world.
 * It stores all player positions, handles movement validation, and manages chat.
 *
 * Deploy:  spacetime publish --server mainnet aurisar-world
 * Regen:   spacetime generate --lang typescript --out-dir ../src/features/world/module_bindings
 *
 * Coordinate system (must stay in sync with the client):
 *   STDB px → world units:   (px - 1600) / 32     (client toWorld)
 *   world units → STDB px:   units * 32 + 1600    (client toStdb)
 *   Spawn at STDB (1600, 1600) = world origin.
 *
 * World bounds match world_build_config.tiling_streaming.world_bounds_m
 * (canonical: src/features/world/config/world_build_config.json):
 *   world_bounds_m: ±1000 world units (2km × 2km playable area)
 *   In STDB px:      1600 ± 32000 → [-30400, 33600]
 *   With 32 px (= 1 world unit) player half-width buffer: clamp to
 *   [-30368, 33568] on both axes.
 */

import { schema, table, t } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import {
  CLASS_IDS,
  MOBS,
  NPCS,
  QUESTS,
  SPAWNS,
  WAYPOINTS,
  ZONES_BY_ID,
} from './content/index.js';
import type { MobDef, QuestDef, QuestObjective, SpawnDef } from './content/types.js';
import { worldLevelFromFitnessXp } from './content/formulas/xp.js';
import {
  DUNGEONS_BY_ID,
  DUNGEON_EXIT_RANGE_PX,
  DUNGEON_GATE_RANGE_PX,
  DUNGEON_MAX_PLAYERS,
  castleExitHotspotPx,
  castleSpawnPx,
  distSqPx,
  dungeonSpawnByNetId,
  interiorLocalToPx,
  zoneEntranceToPx,
  dungeonSpawnFloorYM,
  type DungeonSpawnEntry,
} from './dungeon/helpers.js';
import {
  bossAoeRadiusPx,
  bossDamageMult,
  bossEnraged,
  getBossMechanicsForMob,
  shouldBossAoePulse,
} from './dungeon/bossMechanics.js';
import {
  castleInteriorResolveMove,
  castleInteriorSurfaceAt,
  isInCastleInterior,
  pxToWorldM,
  sameInteriorFloor,
  worldMToPx,
} from './castle/validate.js';
import { CASTLE_LEVELS } from './castle/navGrids.js';

// World bounds in STDB px. Derived from world_build_config — see header.
const WORLD_HALF_PX = 32000;        // 1000 world units * 32 px/unit
const WORLD_CENTER_PX = 1600;       // legacy origin offset (matches client STDB_CENTER)
const PLAYER_HALF_PX = 32;          // 1 world unit player half-width
const WORLD_MIN_PX = WORLD_CENTER_PX - WORLD_HALF_PX + PLAYER_HALF_PX; // -30368
const WORLD_MAX_PX = WORLD_CENTER_PX + WORLD_HALF_PX - PLAYER_HALF_PX; // 33568

// ── Slice 5c combat / AI constants ───────────────────────────────────────────
//
// 1 world meter = 32 STDB px. All radii / speeds below are derived from
// gameplay-level numbers (m, s) at module load so the units stay readable.

const PX_PER_M                  = 32;
const AI_TICK_MICROS            = 250_000n;   // 4 Hz mob AI tick
const AI_TICK_DT_SEC            = 0.25;
const WOLF_MELEE_RANGE_PX       = 2 * PX_PER_M;       // 2 m melee range (all mob types, until P3)
// Legacy column defaults — the mob table's ADD COLUMN defaults were
// published with these values; they must not change (migration contract).
// Live stats now come from the content package per mobType.
const SEED_WOLF_AGGRO_M         = 18;
const SEED_WOLF_LEASH_M         = 35;
const SEED_WOLF_RESPAWN_SEC     = 25;

const PLAYER_MAX_HP             = 100;
const PLAYER_RESPAWN_MICROS     = 5_000_000n;         // 5 s death timer before snap to origin

// ── P1 quests / NPCs ─────────────────────────────────────────────────────────
const INTERACT_RANGE_PX         = 6 * PX_PER_M;       // talk/accept/turn-in must be within 6 m of the NPC
const QUEST_STATE_ACTIVE        = 0;
const QUEST_STATE_READY         = 1;
const QUEST_STATE_DONE          = 2;

// ── Campfires ────────────────────────────────────────────────────────────────
//
// Players can build a campfire in front of them (prototype buildFire ~3008).
// Fires are shared world state: every client renders every burning fire.
// No wood cost yet — the prototype charged 3 wood, but there's no inventory
// system; when one lands, add the cost check here.

const CAMPFIRE_BURN_MICROS      = 180_000_000n;       // fires burn for 3 minutes
const CAMPFIRE_COOLDOWN_MICROS  = 10_000_000n;        // min 10 s between builds per player
const CAMPFIRE_MAX_PER_PLAYER   = 3;                  // oldest is snuffed when exceeded
const CAMPFIRE_PLACE_RANGE_PX   = 3 * PX_PER_M;       // must be placed within 3 m of the builder

// ── Spawn-point index for O(1) respawn lookups ───────────────────────────────
//
// `respawnMob` needs the original spawn point's world position + radii. Each
// mob row stores its spawn metadata directly (spawnX/Y, aggro/leash, respawnSec)
// so the AI tick is self-contained, but on respawn we need the *spawn point's*
// values again to insert a fresh row.
//
// P1: the seeding source is the shared content package (SPAWNS + MOBS in
// src/content/, mirrored from src/features/world/content/) — tile-JSON spawns
// (gameplay/) are retired; seedWorld's self-heal pass deletes their live rows
// because their netIds no longer appear in this map.

interface SpawnEntry {
  spawn:         SpawnDef;
  mobDef:        MobDef;
  instanceIndex: number;
}
const spawnByNetId = new Map<string, SpawnEntry>();
for (const spawn of SPAWNS) {
  const mobDef = MOBS[spawn.mobType];
  if (!mobDef) continue; // validateContent() catches this at authoring time
  for (let i = 0; i < spawn.count; i++) {
    spawnByNetId.set(`${spawn.netId}_${i}`, { spawn, mobDef, instanceIndex: i });
  }
}

/**
 * Content positions are zone-local meters; zones share one STDB px plane
 * offset by their manifest originOffsetM (zone 1 = origin for now).
 */
function contentPosToPx(zoneId: number, pos: { x: number; z: number }): { x: number; y: number } {
  const zone = ZONES_BY_ID[zoneId];
  const ox = zone ? zone.originOffsetM.x : 0;
  const oz = zone ? zone.originOffsetM.z : 0;
  return {
    x: Math.round((pos.x + ox) * PX_PER_M + WORLD_CENTER_PX),
    y: Math.round((pos.z + oz) * PX_PER_M + WORLD_CENTER_PX),
  };
}

/**
 * Deterministic scatter for the i-th instance of a spawn family — a
 * golden-angle ring inside the camp radius. No RNG (reducers must stay
 * deterministic), but instances spread instead of stacking on one point.
 */
function spawnInstanceOffsetM(i: number, radiusM: number): { dx: number; dz: number } {
  const angle = i * 2.399963; // golden angle in radians
  const r = radiusM * (0.35 + 0.65 * ((i % 5) / 5));
  return { dx: Math.cos(angle) * r, dz: Math.sin(angle) * r };
}

// ── Scheduled-table row builders ─────────────────────────────────────────────
//
// SpacetimeDB requires that a scheduled reducer's single positional argument
// reference the *same* row product type as the table that fires it. We
// declare each row's shape via `t.row(...)` once here, then pass the SAME
// builder to both the `table()` definition and the reducer's params object.
// Without this, the build emits:
//   "Scheduled reducer X expected to have type (0: &N), but has type (col1, col2, ...)"

const mobAiTickScheduleRow = t.row('MobAiTickScheduleRow', {
  id:          t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

const mobRespawnQueueRow = t.row('MobRespawnQueueRow', {
  id:          t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  spawnNetId:  t.string(),
  dungeonInstanceId: t.u64().default(0n),
});

const playerRespawnQueueRow = t.row('PlayerRespawnQueueRow', {
  id:          t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  identity:    t.identity(),   // payload — which player to revive
});

const campfireExpireQueueRow = t.row('CampfireExpireQueueRow', {
  id:          t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  campfireId:  t.u64(),        // payload — which fire burns out
});

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

const spacetimedb = schema({

  /**
   * One row per connected (or previously connected) player.
   * Identity is the SpacetimeDB connection key — unique per client.
   */
  player: table(
    { public: true },
    {
      // Original columns — order MUST match the deployed maincloud schema.
      // SpacetimeDB treats column reordering on a live table as a manual
      // migration. New columns get appended below with .default(...) so
      // existing rows backfill non-destructively.
      identity:     t.identity().primaryKey(),  // primary key — SpacetimeDB connection identity
      username:     t.string(),     // display name from Aurisar profile
      classType:    t.string(),     // 'warrior' | 'mage' | 'archer' | 'rogue'
      avatarColor:  t.string(),     // hex color string for the player marker
      x:            t.f32(),        // world X position (pixels)
      y:            t.f32(),        // world Y position (pixels)
      direction:    t.u8(),         // 0=down 1=up 2=left 3=right
      isMoving:     t.bool(),       // for animation state
      zoneId:       t.u8(),         // 0=hub 1=training 2=plaza
      online:       t.bool(),       // true while connection is active
      // Appended columns — declared after the originals so the live table
      // gets ADD COLUMN semantics, not a manual reorder migration.
      avatarConfig: t.string().default(''),       // JSON-encoded AvatarConfig; default '' on backfill — client re-syncs via setPlayerInfo on next login
      lastChatAt:   t.u64().default(0n),          // micros since unix epoch of last sendChat — default 0n behaves correctly with the > 0n rate-limit guard
      lastAttackAt: t.u64().default(0n),          // micros since unix epoch of last castAbility — server-enforced melee cooldown (see castAbility reducer)
      // ── Slice 5c additions (must stay at end) ──
      hp:           t.i32().default(PLAYER_MAX_HP),   // current HP; 0 = dead
      maxHp:        t.i32().default(PLAYER_MAX_HP),   // max HP for HP-bar normalization
      deadUntil:    t.u64().default(0n),              // 0 = alive; otherwise micros-since-epoch when respawn fires
      dungeonInstanceId: t.u64().default(0n),        // 0 = overworld; else active dungeon instance
      floorYM:      t.f32().default(0),              // castle interior vertical meters (world Y)
    }
  ),

  /**
   * World / proximity chat messages.
   * Clients subscribe to all, but filter proximity client-side (< 400px distance).
   */
  chatMessage: table(
    { public: true },
    {
      id:          t.u64(),        // auto-incremented via timestamp
      senderId:    t.identity(),   // who sent it
      senderName:  t.string(),     // denormalized username for easy display
      text:        t.string(),     // message body (max 280 chars enforced below)
      sentAt:      t.u64(),        // Unix ms timestamp
      msgType:     t.string(),     // 'world' | 'proximity' | 'emote'
      x:           t.f32(),        // sender position at send time (proximity filter)
      y:           t.f32(),
    }
  ),

  /**
   * Server-authoritative mob entities.
   *
   * mob_id uses the same timestamp-as-unique-id pattern as chatMessage.
   * Position is in STDB px (same coord system as player).
   * hp/maxHp are i32 so damage math can briefly go negative before being
   * clamped — UI treats hp<=0 as dead.
   *
   * Slice 5c additions store per-mob AI state directly on the row so
   * `tickMobAI` doesn't need to join against tileGameplay every tick.
   */
  mob: table(
    { public: true },
    {
      mobId:       t.u64().primaryKey(),
      mobType:     t.string(),     // 'wolf' for now
      x:           t.f32(),
      y:           t.f32(),
      hp:          t.i32(),
      maxHp:       t.i32(),
      state:       t.string(),     // 'alive' | 'returning' (we delete on death, no 'dead' state)
      spawnNetId:  t.string(),     // matches tile_gameplay net_id when seeded from JSON; '' when hardcoded
      // ── Slice 5c additions (must stay at end) ──
      spawnX:        t.f32().default(0),         // home position X (STDB px) — leash anchor
      spawnY:        t.f32().default(0),         // home position Y (STDB px)
      aggroRadiusPx: t.f32().default(SEED_WOLF_AGGRO_M * PX_PER_M),     // 576 default (18 m × 32)
      leashRadiusPx: t.f32().default(SEED_WOLF_LEASH_M * PX_PER_M),     // 1120 default (35 m × 32)
      respawnSec:    t.u32().default(SEED_WOLF_RESPAWN_SEC),            // delay between death and respawn insert
      lastAttackAt:  t.u64().default(0n),                               // micros since epoch of last bite (cooldown enforcement)
      dungeonInstanceId: t.u64().default(0n),                            // 0 = overworld mob; else instance-scoped
      floorYM:       t.f32().default(0),                                 // interior world Y (m); 0 = overworld
      spawnedAt:     t.u64().default(0n),                                // boss spawn micros (instance bosses)
      lastAoeAt:     t.u64().default(0n),                                // last aoePulse micros
      enraged:       t.bool().default(false),                            // enrage multiplier active
    }
  ),

  /**
   * Slice 5c — scheduled tables.
   *
   * SpacetimeDB v2.2.0 fires the bound reducer for each row at `scheduledAt`.
   * If `scheduledAt` is an Interval, the row stays in the table and re-fires
   * forever. If it's a Time, the row fires once and is deleted.
   *
   * All three are private (default — no `public: true`) since they are
   * server-only bookkeeping; clients never need to see them.
   *
   * Scheduled-reducer contract: the bound reducer takes a SINGLE positional
   * arg of the table's row type (the SpacetimeDB Rust-side validator emits
   * "expected (0: &N)" if you spread the columns). We use `t.row(...)`
   * builders defined above so the table and reducer share one product type.
   */
  mobAiTickSchedule: table(
    { scheduled: (): any => tickMobAI },
    mobAiTickScheduleRow,
  ),

  mobRespawnQueue: table(
    { scheduled: (): any => respawnMob },
    mobRespawnQueueRow,
  ),

  playerRespawnQueue: table(
    { scheduled: (): any => respawnPlayer },
    playerRespawnQueueRow,
  ),

  /**
   * Player-built campfires — shared world dressing with a burn timer.
   * Clients render every row (log pile + stones + flame light) and remove
   * it when the scheduled expiry deletes the row.
   */
  campfire: table(
    { public: true },
    {
      campfireId: t.u64().primaryKey(),
      ownerId:    t.identity(),    // who built it
      ownerName:  t.string(),      // denormalized for "X's campfire" UI
      x:          t.f32(),         // STDB px (same coord system as player)
      y:          t.f32(),
      litAt:      t.u64(),         // micros since epoch — also the per-player build cooldown anchor
      expiresAt:  t.u64(),         // micros since epoch when expireCampfire fires
    }
  ),

  campfireExpireQueue: table(
    { scheduled: (): any => expireCampfire },
    campfireExpireQueueRow,
  ),

  /**
   * P1 — per-player quest progress. One row per (player, quest) pair from
   * acceptance onward; rows persist after completion so prerequisites and
   * once-only acceptance can be checked.
   *
   * state: 0 = active, 1 = ready (objectives met, awaiting turn-in),
   *        2 = done (turned in).
   * countsJson: JSON array parallel to the QuestDef.objectives array,
   *        e.g. '[3,0]'. Kill counts increment in castAbility's kill path;
   *        find objectives flip 0→1 in reachWaypoint.
   *
   * Public: clients subscribe and filter to their own identity (same
   * trust posture as the player table at this scale). Lookups iterate —
   * row count stays tiny (players × quests in a zone).
   */
  playerQuest: table(
    { public: true },
    {
      id:         t.u64().primaryKey().autoInc(),
      owner:      t.identity(),
      questId:    t.string(),
      state:      t.u8(),
      countsJson: t.string(),
      acceptedAt: t.u64(),
    }
  ),

  /**
   * Active dungeon instances (Castle Ashwood v2). Mobs and players reference
   * instanceId; rows are deleted when the last member leaves.
   */
  dungeonInstance: table(
    { public: true },
    {
      instanceId: t.u64().primaryKey().autoInc(),
      dungeonId:  t.string(),
      createdAt:  t.u64(),
    }
  ),

  /**
   * P2 — fitness XP mirror for world level gating. The client calls
   * syncProgress on connect; levels derive from the shared xp curve.
   */
  playerProgress: table(
    { public: true },
    {
      identity:            t.identity().primaryKey(),
      fitnessXp:           t.u64().default(0n),
      fitnessXpBaseline:   t.u64().default(0n),
      worldLevel:          t.u32().default(1),
    }
  ),

});

export default spacetimedb;

// ─────────────────────────────────────────────────────────────────────────────
// REDUCERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called once when a player enters the world.
 * Sets their display name and class — links their Aurisar identity to the session.
 */
export const setPlayerInfo = spacetimedb.reducer(
  {
    username:     t.string(),
    classType:    t.string(),
    avatarColor:  t.string(),
    avatarConfig: t.string(),
  },
  (ctx, { username, classType, avatarColor, avatarConfig }) => {
    const identity = ctx.sender;

    // Validate inputs. Class ids come from the shared content package —
    // the same 11 Aurisar classes the fitness app defines.
    const safeName = username.trim().slice(0, 32) || 'Adventurer';
    const safeClass = (CLASS_IDS as string[]).includes(classType)
      ? classType
      : 'warrior';
    const safeAvatarConfig = avatarConfig.length <= 4096 ? avatarConfig : '';

    const existing = ctx.db.player.identity.find(identity);
    if (existing) {
      // Preserve existing HP / death state — re-login while dead leaves them
      // dead; the queued respawn reducer will still fire at the original
      // deadline. Re-login while alive keeps current HP.
      ctx.db.player.identity.update({
        ...existing,
        username: safeName,
        classType: safeClass,
        avatarColor,
        avatarConfig: safeAvatarConfig,
        online: true,
      });
    } else {
      // Spawn in the hub zone center
      ctx.db.player.insert({
        identity,
        username: safeName,
        classType: safeClass,
        avatarColor,
        avatarConfig,
        x: 1600,
        y: 1600,
        direction: 0,
        isMoving: false,
        zoneId: 0,
        online: true,
        lastChatAt: 0n,
        lastAttackAt: 0n,
        hp: PLAYER_MAX_HP,
        maxHp: PLAYER_MAX_HP,
        deadUntil: 0n,
        dungeonInstanceId: 0n,
        floorYM: 0,
      });
    }
  }
);

/**
 * Sync fitness XP from the Aurisar profile into world level (P2).
 * fitnessXp must be monotonic; worldLevel is derived server-side.
 */
export const syncProgress = spacetimedb.reducer(
  {
    fitnessXp:         t.u64(),
    fitnessXpBaseline: t.u64(),
  },
  (ctx, { fitnessXp, fitnessXpBaseline }) => {
    const xp = Number(fitnessXp);
    const baseline = Number(fitnessXpBaseline);
    if (!Number.isFinite(xp) || xp < 0) return;
    if (!Number.isFinite(baseline) || baseline < 0) return;

    const level = worldLevelFromFitnessXp(xp, baseline);
    const existing = ctx.db.playerProgress.identity.find(ctx.sender);
    if (existing) {
      if (fitnessXp < existing.fitnessXp) return;
      ctx.db.playerProgress.identity.update({
        ...existing,
        fitnessXp,
        fitnessXpBaseline,
        worldLevel: level,
      });
    } else {
      ctx.db.playerProgress.insert({
        identity: ctx.sender,
        fitnessXp,
        fitnessXpBaseline,
        worldLevel: level,
      });
    }
  }
);

/**
 * Update the calling player's full avatar customization config.
 * Called after the user saves changes in AvatarCreator.
 */
export const setAvatarConfig = spacetimedb.reducer(
  { avatarConfig: t.string() },
  (ctx, { avatarConfig }) => {
    if (avatarConfig.length > 4096) throw new Error('avatarConfig too large');
    const existing = ctx.db.player.identity.find(ctx.sender);
    if (!existing) return;
    ctx.db.player.identity.update({ ...existing, avatarConfig });
  }
);

/**
 * Called on every movement tick from the client (~20 times/sec while moving).
 * Server validates position is within world bounds before updating.
 *
 * Slice 5c: dead players cannot move. Their `playerRespawnQueue` row will
 * teleport them to origin when the timer fires.
 */
export const movePlayer = spacetimedb.reducer(
  {
    x:         t.f32(),
    y:         t.f32(),
    direction: t.u8(),
    isMoving:  t.bool(),
    floorYM:   t.f32(),
  },
  (ctx, { x, y, direction, isMoving, floorYM }) => {
    const identity = ctx.sender;
    const existing = ctx.db.player.identity.find(identity);
    if (!existing) return; // player hasn't called setPlayerInfo yet

    // Reject moves while dead — server pins the corpse until respawnPlayer fires.
    if (existing.hp <= 0 || existing.deadUntil > ctx.timestamp.microsSinceUnixEpoch) {
      return;
    }

    // World bounds: 64000x64000 px (2km x 2km world), with 32px player half-width buffer.
    // See header for derivation from world_build_config.tiling_streaming.
    const clampedX = Math.max(WORLD_MIN_PX, Math.min(WORLD_MAX_PX, x));
    const clampedY = Math.max(WORLD_MIN_PX, Math.min(WORLD_MAX_PX, y));

    // Castle Ashwood interior: reject moves into nav-blocked columns (walls,
    // furniture footprints baked into emitted nav bitmaps). Outside the
    // interior footprint this returns null and we fall through to normal px clamp.
    const worldXM = pxToWorldM(clampedX);
    const worldZM = pxToWorldM(clampedY);
    let nextFloorYM = existing.floorYM;

    if (isInCastleInterior(worldXM, worldZM) || existing.dungeonInstanceId > 0n) {
      const refY = floorYM > 0 ? floorYM : (existing.floorYM > 0 ? existing.floorYM : CASTLE_LEVELS[1].y);
      const surface = castleInteriorSurfaceAt(worldXM, worldZM, refY);
      if (!surface) return;
      nextFloorYM = surface.y;
    } else if (existing.floorYM !== 0) {
      nextFloorYM = 0;
    }

    // Zone detection based on position
    const zoneId = detectZone(clampedX, clampedY);

    ctx.db.player.identity.update({
      ...existing,
      x: clampedX,
      y: clampedY,
      direction: direction % 4, // only 0-3 valid
      isMoving,
      zoneId,
      floorYM: nextFloorYM,
    });
  }
);

/**
 * Server-authoritative castle / dungeon entry. Validates gate proximity,
 * assigns or creates a ≤5-player instance, teleports to the interior spawn,
 * and seeds instance mobs on first creation.
 *
 * minLevel gating via playerProgress (syncProgress on connect).
 */
export const enterDungeon = spacetimedb.reducer(
  { dungeonId: t.string() },
  (ctx, { dungeonId }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) return;
    const now = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > now) return;
    if (player.dungeonInstanceId > 0n) return;

    const dungeon = DUNGEONS_BY_ID[dungeonId];
    if (!dungeon) return;

    if (getPlayerLevel(ctx, ctx.sender) < dungeon.minLevel) return;

    const gatePx = zoneEntranceToPx(dungeon);
    if (distSqPx(player.x, player.y, gatePx.x, gatePx.y) > DUNGEON_GATE_RANGE_PX * DUNGEON_GATE_RANGE_PX) {
      return;
    }

    let instanceId = findOpenDungeonInstance(ctx, dungeonId);
    let created = false;
    if (!instanceId) {
      const row = ctx.db.dungeonInstance.insert({
        instanceId: 0n,
        dungeonId,
        createdAt: now,
      });
      instanceId = row.instanceId;
      created = true;
    }

    const spawnPx = dungeonId === 'castle_ashwood' ? castleSpawnPx() : gatePx;
    ctx.db.player.identity.update({
      ...player,
      x: spawnPx.x,
      y: spawnPx.y,
      isMoving: false,
      zoneId: detectZone(spawnPx.x, spawnPx.y),
      dungeonInstanceId: instanceId,
      floorYM: CASTLE_LEVELS[1].y,
    });

    if (created) seedDungeonInstanceMobs(ctx, instanceId, dungeonId);
  }
);

/**
 * Leave the active dungeon instance. Requires proximity to the interior
 * exit hotspot; teleports to the overworld gate and cleans up empty instances.
 */
export const leaveDungeon = spacetimedb.reducer(
  {},
  (ctx) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player || player.dungeonInstanceId === 0n) return;

    const instance = ctx.db.dungeonInstance.instanceId.find(player.dungeonInstanceId);
    if (!instance) {
      ctx.db.player.identity.update({ ...player, dungeonInstanceId: 0n });
      return;
    }

    const exitPx = castleExitHotspotPx();
    if (distSqPx(player.x, player.y, exitPx.x, exitPx.y) > DUNGEON_EXIT_RANGE_PX * DUNGEON_EXIT_RANGE_PX) {
      return;
    }

    const dungeon = DUNGEONS_BY_ID[instance.dungeonId];
    const gatePx = dungeon ? zoneEntranceToPx(dungeon) : { x: WORLD_CENTER_PX, y: WORLD_CENTER_PX };
    const leavingInstance = player.dungeonInstanceId;

    ctx.db.player.identity.update({
      ...player,
      x: gatePx.x,
      y: gatePx.y,
      isMoving: false,
      zoneId: detectZone(gatePx.x, gatePx.y),
      dungeonInstanceId: 0n,
      floorYM: 0,
    });

    cleanupDungeonInstanceIfEmpty(ctx, leavingInstance);
  }
);

/**
 * Send a chat message (world or proximity).
 * Rate limited: max 1 message per second per sender (enforced server-side
 * via player.lastChatAt — a malicious client cannot spam past this).
 */
const CHAT_COOLDOWN_MICROS = 1_000_000n; // 1 second

export const sendChat = spacetimedb.reducer(
  {
    text:    t.string(),
    msgType: t.string(),
  },
  (ctx, { text, msgType }) => {
    const identity = ctx.sender;
    const player = ctx.db.player.identity.find(identity);
    if (!player) return;

    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.lastChatAt > 0n && nowMicros - player.lastChatAt < CHAT_COOLDOWN_MICROS) {
      return; // dropped: sender is over the 1 msg/sec rate limit
    }

    const safeText = text.trim().slice(0, 280);
    if (!safeText) return;

    const safeMsgType = ['world', 'proximity', 'emote'].includes(msgType)
      ? msgType
      : 'world';

    ctx.db.chatMessage.insert({
      id: nowMicros,
      senderId: identity,
      senderName: player.username,
      text: safeText,
      sentAt: nowMicros / 1000n, // ms
      msgType: safeMsgType,
      x: player.x,
      y: player.y,
    });

    ctx.db.player.identity.update({ ...player, lastChatAt: nowMicros });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// CAMPFIRES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a campfire at (x, y) STDB px. The client places it ~2.2 m in front
 * of the avatar; the server only trusts that it's within arm's reach.
 *
 * Guards:
 *   • dead players can't build
 *   • placement must be within CAMPFIRE_PLACE_RANGE_PX of the builder
 *   • per-player cooldown, anchored on the player's newest fire's litAt
 *     (no player-table column needed: a fire always outlives the cooldown
 *     window since CAMPFIRE_BURN >> CAMPFIRE_COOLDOWN)
 *   • per-player cap — building past it snuffs the oldest fire (its queued
 *     expiry then no-ops on the missing row)
 *
 * No wood cost until an inventory system exists (prototype charged 3 wood).
 */
export const buildCampfire = spacetimedb.reducer(
  {
    x: t.f32(),
    y: t.f32(),
  },
  (ctx, { x, y }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) return;

    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return; // dead can't build

    // Must be placed within reach of where the server thinks the player is.
    const dx = x - player.x;
    const dy = y - player.y;
    if (dx * dx + dy * dy > CAMPFIRE_PLACE_RANGE_PX * CAMPFIRE_PLACE_RANGE_PX) return;

    const fx = Math.max(WORLD_MIN_PX, Math.min(WORLD_MAX_PX, x));
    const fy = Math.max(WORLD_MIN_PX, Math.min(WORLD_MAX_PX, y));

    // Scan the caller's fires once for both the cooldown and the cap.
    let count = 0;
    let newestLitAt = 0n;
    let oldest: { campfireId: bigint; litAt: bigint } | null = null;
    for (const f of ctx.db.campfire.iter()) {
      if (!f.ownerId.isEqual(player.identity)) continue;
      count++;
      if (f.litAt > newestLitAt) newestLitAt = f.litAt;
      if (oldest === null || f.litAt < oldest.litAt) {
        oldest = { campfireId: f.campfireId, litAt: f.litAt };
      }
    }
    if (newestLitAt > 0n && nowMicros - newestLitAt < CAMPFIRE_COOLDOWN_MICROS) {
      return; // dropped: over the build cadence
    }
    if (count >= CAMPFIRE_MAX_PER_PLAYER && oldest) {
      ctx.db.campfire.campfireId.delete(oldest.campfireId);
    }

    const expiresAt = nowMicros + CAMPFIRE_BURN_MICROS;
    const campfireId = nowMicros;
    ctx.db.campfire.insert({
      campfireId,
      ownerId: player.identity,
      ownerName: player.username,
      x: fx,
      y: fy,
      litAt: nowMicros,
      expiresAt,
    });
    ctx.db.campfireExpireQueue.insert({
      id: 0n,    // auto-inc replaces this
      scheduledAt: ScheduleAt.time(expiresAt),
      campfireId,
    });
  }
);

/**
 * Scheduled campfire burnout. Fires once at expiresAt; deleting an
 * already-snuffed fire (cap eviction) is a silent no-op.
 */
export const expireCampfire = spacetimedb.reducer(
  {
    schedule: campfireExpireQueueRow,
  },
  (ctx, { schedule }) => {
    const fire = ctx.db.campfire.campfireId.find(schedule.campfireId);
    if (!fire) return;
    ctx.db.campfire.campfireId.delete(schedule.campfireId);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// COMBAT (slice 5a / 5c)
// ─────────────────────────────────────────────────────────────────────────────

const MELEE_RANGE_PX        = 96;             // 3 world units = 96 STDB px
const MELEE_DAMAGE          = 25;             // 4 swings kills a 100-HP wolf
const MELEE_COOLDOWN_MICROS = 300_000n;       // 300 ms between swings; client throttles at 350 ms so legit input has headroom

/**
 * Idempotently seed mobs from the bundled per-tile gameplay manifest, and
 * self-heal any stale rows left over from older module versions.
 *
 * Called by the client on connect; safe to call repeatedly. Three passes:
 *
 *   1. Bootstrap the AI tick scheduler if it doesn't exist yet. The live
 *      maincloud module was published before `init` lifecycles, so we
 *      lazy-init here.
 *
 *   2. Self-heal pass over existing mob rows. After the slice 5c schema
 *      migration, rows that existed pre-migration have spawn_x/spawn_y/
 *      aggro/leash/respawn_sec backfilled to ADD COLUMN defaults — the
 *      AI tick would treat that as "leash anchor is world origin," which
 *      is wrong for any wolf not actually spawned there. We fix in code:
 *        • If a row's spawn_net_id isn't in the current manifest (e.g.
 *          slice-5a's `SLICE5A_HARDCODED_WOLF`), delete it. It belongs
 *          to a retired spawn definition.
 *        • If a row's spawn_net_id IS in the manifest but its spawnX/Y
 *          are zero (the ADD COLUMN default sentinel), update it in
 *          place with the manifest's real coords and radii.
 *      This pass keeps `seedWorld` the single source of truth for the
 *      mob table's shape and avoids needing manual `DELETE FROM mob`
 *      after schema-changing publishes.
 *
 *   3. Insert any manifest spawn points that aren't represented yet.
 *      Net IDs are suffixed by instance index (e.g.
 *      `SPAWN_MOB_WOLF_NEAR_NW_0`, `_1`) so each row stays unique.
 */
export const seedWorld = spacetimedb.reducer({}, (ctx) => {
  // 1. Bootstrap the AI tick scheduler if missing.
  if (ctx.db.mobAiTickSchedule.count() === 0n) {
    ctx.db.mobAiTickSchedule.insert({
      id: 0n,    // auto-inc replaces this
      scheduledAt: ScheduleAt.interval(AI_TICK_MICROS),
    });
  }

  // 2. Self-heal pass — drop rows whose spawn definition no longer exists.
  //    This is also the migration path away from the retired tile-JSON
  //    spawns: their netIds aren't in the content-built spawnByNetId map,
  //    so their live rows get deleted here and content spawns take over.
  const seeded = new Set<string>();
  const toDelete: bigint[] = [];
  for (const m of ctx.db.mob.iter()) {
    if (m.dungeonInstanceId > 0n) continue;
    const entry = spawnByNetId.get(m.spawnNetId);
    if (!entry) {
      toDelete.push(m.mobId);
      continue;
    }
    seeded.add(m.spawnNetId);
  }
  for (const mobId of toDelete) {
    ctx.db.mob.mobId.delete(mobId);
  }

  // 3. Insert any content spawn instances not already represented.
  let inserted = 0;
  for (const [netId, entry] of spawnByNetId) {
    if (seeded.has(netId)) continue;
    insertMobFromSpawn(ctx, entry, netId, inserted);
    seeded.add(netId);
    inserted++;
  }
});

/**
 * Server-authoritative melee attack. Client passes a target mob_id; the
 * server validates the caller is within range and the mob is alive before
 * applying damage.
 *
 * Slice 5c: on kill, the mob row is deleted and a respawnQueue entry is
 * inserted scheduled `respawnSec` seconds out. The client sees the mob
 * disappear via onDelete; the respawn reducer inserts a fresh row that
 * triggers onInsert (clean spawn animation path).
 *
 * Dead players cannot attack (preserves "you died" lockout).
 */
export const castAbility = spacetimedb.reducer(
  {
    mobId: t.u64(),
  },
  (ctx, { mobId }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) return; // not authenticated yet

    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;

    // Dead players can't swing.
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;

    // Server-enforced cooldown. The client throttles at 350ms for UX, but
    // a modified client could spam reducer calls without this guard — that
    // would let them instakill mobs while still passing the range check.
    // We also record the swing on accepted-but-missed calls (out of range,
    // dead mob) to neutralise DoS via spammed-miss probing.
    if (player.lastAttackAt > 0n && nowMicros - player.lastAttackAt < MELEE_COOLDOWN_MICROS) {
      return; // dropped: caller is over the melee cadence
    }
    ctx.db.player.identity.update({ ...player, lastAttackAt: nowMicros });

    const mob = ctx.db.mob.mobId.find(mobId);
    if (!mob) return;
    if (mob.hp <= 0) return;

    // Range check — squared euclidean to avoid sqrt; monotonic so the
    // comparison is equivalent to comparing actual distances.
    const dx = player.x - mob.x;
    const dy = player.y - mob.y;
    if (dx * dx + dy * dy > MELEE_RANGE_PX * MELEE_RANGE_PX) return;

    // Instance + floor gating for dungeon mobs.
    if (mob.dungeonInstanceId !== player.dungeonInstanceId) return;
    if (mob.dungeonInstanceId > 0n && !sameInteriorFloor(mob.floorYM, player.floorYM)) return;

    const newHp = mob.hp - MELEE_DAMAGE;
    if (newHp <= 0) {
      // Kill: delete the row (client sees onDelete → mob disappears) and
      // schedule a respawn after the spawn point's respawnSec.
      const respawnAt = nowMicros + BigInt(mob.respawnSec) * 1_000_000n;
      ctx.db.mobRespawnQueue.insert({
        id: 0n,    // auto-inc replaces this
        scheduledAt: ScheduleAt.time(respawnAt),
        spawnNetId: mob.spawnNetId,
        dungeonInstanceId: mob.dungeonInstanceId,
      });
      ctx.db.mob.mobId.delete(mobId);
      // P1 quest hook: kill credit goes to whoever lands the killing blow
      // (tap rights / party sharing arrive with P3/P6).
      creditKillToQuests(ctx, player.identity, mob);
    } else {
      ctx.db.mob.mobId.update({ ...mob, hp: newHp });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// MOB AI (slice 5c)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AI tick — runs every 250 ms (4 Hz). One pass over all mobs:
 *   • If leashed past leashRadius from spawn → state='returning', step home;
 *     on home arrival snap to spawn and clear state.
 *   • Else find nearest alive online player within aggroRadius:
 *       - If found: step toward them (up to WOLF_MOVE_STEP_PX). If within
 *         melee range and off cooldown, damage them.
 *       - If not found: stand still.
 *
 * Tick math:
 *   At slice 5c scale: ~10 mobs × ~5 online players = ~50 inner iterations.
 *   Trivial. We iterate `player` in the inner loop rather than building a
 *   spatial index — adding one would be premature given the scale.
 *
 * Damage flow:
 *   Wolf bite damages the targeted player directly inside this reducer.
 *   On lethal damage we set hp=0 + deadUntil=now+5s and schedule
 *   playerRespawn for 5s out. The client's `applyPlayerUpdate` callback
 *   sees hp<=0 → renders the death overlay; movePlayer is gated on
 *   hp>0 server-side so the player can't move while dead.
 */
export const tickMobAI = spacetimedb.reducer(
  {
    // Scheduled-table reducers receive a SINGLE positional arg of the
    // table's row type. We reference the shared row builder so the
    // module-load schema validation accepts the binding.
    schedule: mobAiTickScheduleRow,
  },
  (ctx, _args) => {
    const now = ctx.timestamp.microsSinceUnixEpoch;

    // Snapshot online alive players. We do this once per tick rather than
    // per-mob to avoid re-iterating the player table for each wolf.
    const livePlayers: Array<{
      identity: any; x: number; y: number;
      dungeonInstanceId: bigint; floorYM: number;
    }> = [];
    for (const p of ctx.db.player.iter()) {
      if (!p.online) continue;
      if (p.hp <= 0) continue;
      if (p.deadUntil > now) continue;
      livePlayers.push({
        identity: p.identity,
        x: p.x,
        y: p.y,
        dungeonInstanceId: p.dungeonInstanceId,
        floorYM: p.floorYM,
      });
    }

    for (const mob of ctx.db.mob.iter()) {
      if (mob.hp <= 0) continue;
      // Per-type stats come from the shared content package. Unknown types
      // (content removed between publishes) stay inert until self-healed.
      const mobDef = MOBS[mob.mobType];
      if (!mobDef) continue;
      const moveStepPx = mobDef.moveSpeedMps * PX_PER_M * AI_TICK_DT_SEC;
      const attackCdMicros = BigInt(Math.round(mobDef.attackSpeedSec * 1_000_000));
      // Deterministic mid-roll damage until P3's seeded combat rolls land.
      const attackDamage = Math.round((mobDef.dmgMin + mobDef.dmgMax) / 2);

      // 1. Leash check — if past leash radius, return home regardless of aggro.
      const homeDx = mob.x - mob.spawnX;
      const homeDy = mob.y - mob.spawnY;
      const homeDistSq = homeDx * homeDx + homeDy * homeDy;
      const leashSq   = mob.leashRadiusPx * mob.leashRadiusPx;

      let newState = mob.state;
      let nextX = mob.x;
      let nextY = mob.y;
      let nextFloorYM = mob.floorYM;
      let nextLastAttackAt = mob.lastAttackAt;
      let nextSpawnedAt = mob.spawnedAt;
      let nextLastAoeAt = mob.lastAoeAt;
      let nextEnraged = mob.enraged;

      const bossMech = getBossMechanicsForMob(ctx, mob);
      if (bossMech && nextSpawnedAt === 0n) nextSpawnedAt = now;
      if (bossMech) {
        nextEnraged = bossEnraged(bossMech, nextSpawnedAt, now, nextEnraged);
        if (shouldBossAoePulse(bossMech, nextLastAoeAt, now)) {
          const aoeSq = bossAoeRadiusPx(bossMech) ** 2;
          const aoeDmg = bossMech.aoePulse?.damage ?? 0;
          for (const p of livePlayers) {
            if (!isValidMobTarget(mob, p, nextFloorYM)) continue;
            const dx = p.x - mob.x;
            const dy = p.y - mob.y;
            if (dx * dx + dy * dy <= aoeSq) {
              applyMobHit(ctx, p.identity, now, aoeDmg);
            }
          }
          nextLastAoeAt = now;
        }
      }
      const dmgMult = bossMech ? bossDamageMult(bossMech, nextEnraged) : 1;
      const effectiveDamage = Math.round(attackDamage * dmgMult);

      const inDungeon = mob.dungeonInstanceId > 0n;
      if (inDungeon && nextFloorYM === 0) {
        nextFloorYM = resolveMobFloorYM(mob.x, mob.y, 0);
      }

      const stepMob = (fromX: number, fromY: number, toX: number, toY: number) => {
        if (inDungeon) {
          return mobInteriorStepPx(fromX, fromY, toX, toY, moveStepPx, nextFloorYM);
        }
        const step = stepToward(fromX, fromY, toX, toY, moveStepPx);
        return { x: step.x, y: step.y, floorYM: nextFloorYM, arrived: step.arrived };
      };

      if (mob.state === 'returning' || homeDistSq > leashSq) {
        const stepArrived = stepMob(mob.x, mob.y, mob.spawnX, mob.spawnY);
        nextX = stepArrived.x;
        nextY = stepArrived.y;
        nextFloorYM = stepArrived.floorYM;
        if (stepArrived.arrived) {
          newState = 'alive';
        } else {
          newState = 'returning';
        }
      } else {
        const aggroSq = mob.aggroRadiusPx * mob.aggroRadiusPx;
        let nearest: typeof livePlayers[number] | null = null;
        let nearestDistSq = aggroSq;
        for (const p of livePlayers) {
          if (!isValidMobTarget(mob, p, nextFloorYM)) continue;
          const dx = p.x - mob.x;
          const dy = p.y - mob.y;
          const dsq = dx * dx + dy * dy;
          if (dsq <= nearestDistSq) {
            nearest = p;
            nearestDistSq = dsq;
          }
        }

        if (nearest) {
          const meleeSq = WOLF_MELEE_RANGE_PX * WOLF_MELEE_RANGE_PX;
          const sameFloor = sameInteriorFloor(nextFloorYM, nearest.floorYM);
          if (nearestDistSq <= meleeSq && sameFloor) {
            if (now - mob.lastAttackAt >= attackCdMicros) {
              applyMobHit(ctx, nearest.identity, now, effectiveDamage);
              nextLastAttackAt = now;
            }
          } else {
            const step = stepMob(mob.x, mob.y, nearest.x, nearest.y);
            nextX = step.x;
            nextY = step.y;
            nextFloorYM = step.floorYM;
          }
          newState = 'alive';
        } else {
          newState = 'alive';
        }
      }

      if (nextX !== mob.x || nextY !== mob.y || newState !== mob.state ||
          nextLastAttackAt !== mob.lastAttackAt || nextFloorYM !== mob.floorYM ||
          nextSpawnedAt !== mob.spawnedAt || nextLastAoeAt !== mob.lastAoeAt ||
          nextEnraged !== mob.enraged) {
        ctx.db.mob.mobId.update({
          ...mob,
          x: nextX,
          y: nextY,
          floorYM: nextFloorYM,
          state: newState,
          lastAttackAt: nextLastAttackAt,
          spawnedAt: nextSpawnedAt,
          lastAoeAt: nextLastAoeAt,
          enraged: nextEnraged,
        });
      }
    }
  }
);

/**
 * Scheduled mob respawn. Fires once at `scheduledAt`; the row is auto-deleted
 * by SpacetimeDB after the reducer returns (Time variant).
 *
 * Looks up the spawn-point metadata via the module-load `spawnByNetId` map
 * and inserts a fresh mob row. If the spawn point no longer exists in the
 * manifest (e.g. tile JSON was edited to remove a spawn between publish and
 * respawn fire), the respawn is silently dropped.
 */
export const respawnMob = spacetimedb.reducer(
  {
    schedule: mobRespawnQueueRow,
  },
  (ctx, { schedule }) => {
    const spawnNetId = schedule.spawnNetId;
    const dungeonInst = schedule.dungeonInstanceId;

    if (dungeonInst > 0n) {
      if (!ctx.db.dungeonInstance.instanceId.find(dungeonInst)) return;
      const entry = dungeonSpawnByNetId.get(spawnNetId);
      if (!entry) return;
      for (const m of ctx.db.mob.iter()) {
        if (m.spawnNetId === spawnNetId && m.dungeonInstanceId === dungeonInst) return;
      }
      insertMobFromDungeonSpawn(ctx, entry, spawnNetId, dungeonInst, 0);
      return;
    }

    const entry = spawnByNetId.get(spawnNetId);
    if (!entry) return; // spawn point removed from manifest; drop respawn

    // Defensive: if a mob with this spawnNetId already exists (e.g. seedWorld
    // ran in parallel), don't double-insert.
    for (const m of ctx.db.mob.iter()) {
      if (m.spawnNetId === spawnNetId) return;
    }

    insertMobFromSpawn(ctx, entry, spawnNetId, 0);
  }
);

/**
 * Scheduled player respawn. Snaps the player to world origin with full HP
 * and clears deadUntil so they can move again.
 *
 * If the player disconnected during their death timer, we still process the
 * respawn — they come back alive at origin the next time they log in. This
 * matches typical MMO behavior (you don't stay dead because you alt-F4'd).
 */
export const respawnPlayer = spacetimedb.reducer(
  {
    schedule: playerRespawnQueueRow,
  },
  (ctx, { schedule }) => {
    const p = ctx.db.player.identity.find(schedule.identity);
    if (!p) return;

    ctx.db.player.identity.update({
      ...p,
      x: WORLD_CENTER_PX,
      y: WORLD_CENTER_PX,
      direction: 0,
      isMoving: false,
      zoneId: detectZone(WORLD_CENTER_PX, WORLD_CENTER_PX),
      hp: p.maxHp > 0 ? p.maxHp : PLAYER_MAX_HP,
      deadUntil: 0n,
      dungeonInstanceId: 0n,
      floorYM: 0,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE REDUCERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called automatically when a client WebSocket connects.
 * Marks the player online if they have a row (returning player).
 */
export const clientConnected = spacetimedb.clientConnected((ctx) => {
  const existing = ctx.db.player.identity.find(ctx.sender);
  if (existing) {
    ctx.db.player.identity.update({ ...existing, online: true });
  }
  // If no row exists, setPlayerInfo will create one.
  // Mob seeding is handled by the client invoking seedWorld() once on connect.
});

/**
 * Called automatically when a client disconnects.
 * Marks the player offline — their row persists so they can return.
 */
export const clientDisconnected = spacetimedb.clientDisconnected((ctx) => {
  const existing = ctx.db.player.identity.find(ctx.sender);
  if (existing) {
    ctx.db.player.identity.update({
      ...existing,
      online: false,
      isMoving: false,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the zone ID for a given world position.
 *
 * Original gameplay zones occupy the inner 3200×3200 px area (their fixed
 * STDB px ranges). The surrounding 2km × 2km world is all Wilderness — that
 * is where the castle-approach biome lives and where future zones can attach.
 *
 *   Zone 0 — The Aurisar Hub:     (1200-2000, 1200-2000)
 *   Zone 1 — Training Grounds:    (0-1200, 0-1200)
 *   Zone 2 — Leaderboard Plaza:   (2000-3200, 2000-3200)
 *   Zone 3 — Wilderness:          everywhere else, including all new bounds
 */
function detectZone(x: number, y: number): number {
  if (x >= 1200 && x <= 2000 && y >= 1200 && y <= 2000) return 0; // Hub
  if (x >= 0 && x <= 1200 && y >= 0 && y <= 1200) return 1;       // Training
  if (x >= 2000 && x <= 3200 && y >= 2000 && y <= 3200) return 2; // Plaza
  return 3; // Wilderness
}

function getPlayerLevel(ctx: any, identity: any): number {
  const row = ctx.db.playerProgress.identity.find(identity);
  return row?.worldLevel ?? 1;
}

function killObjectiveMatches(
  ctx: any,
  obj: QuestObjective,
  mob: { mobType: string; spawnNetId: string; dungeonInstanceId: bigint },
): boolean {
  if (obj.type !== 'kill' || obj.mobType !== mob.mobType) return false;
  if (obj.spawnNetIdPrefix && !mob.spawnNetId.startsWith(obj.spawnNetIdPrefix)) return false;
  if (obj.dungeonId) {
    if (mob.dungeonInstanceId === 0n) return false;
    const inst = ctx.db.dungeonInstance.instanceId.find(mob.dungeonInstanceId);
    if (!inst || inst.dungeonId !== obj.dungeonId) return false;
  }
  return true;
}

/**
 * Move from `(x, y)` toward `(tx, ty)` by at most `maxStep` px.
 * Returns the new position and whether we landed on the target.
 */
function stepToward(x: number, y: number, tx: number, ty: number, maxStep: number)
  : { x: number; y: number; arrived: boolean } {
  const dx = tx - x;
  const dy = ty - y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= maxStep) {
    return { x: tx, y: ty, arrived: true };
  }
  const k = maxStep / dist;
  return { x: x + dx * k, y: y + dy * k, arrived: false };
}

function isValidMobTarget(
  mob: { dungeonInstanceId: bigint; floorYM: number },
  player: { dungeonInstanceId: bigint; floorYM: number },
  mobFloorYM: number,
): boolean {
  if (player.dungeonInstanceId !== mob.dungeonInstanceId) return false;
  if (mob.dungeonInstanceId > 0n && !sameInteriorFloor(mobFloorYM, player.floorYM)) return false;
  return true;
}

/** Resolve mob floor Y from px position when floorYM was unset (migration backfill). */
function resolveMobFloorYM(pxX: number, pxY: number, fallback: number): number {
  const wx = pxToWorldM(pxX);
  const wz = pxToWorldM(pxY);
  for (const lv of CASTLE_LEVELS) {
    const s = castleInteriorSurfaceAt(wx, wz, lv.y);
    if (s) return s.y;
  }
  return fallback;
}

function mobInteriorStepPx(
  fromX: number, fromY: number, toX: number, toY: number,
  maxStepPx: number, floorYM: number,
): { x: number; y: number; floorYM: number; arrived: boolean } {
  const step = stepToward(fromX, fromY, toX, toY, maxStepPx);
  const prevWX = pxToWorldM(fromX);
  const prevWZ = pxToWorldM(fromY);
  const nextWX = pxToWorldM(step.x);
  const nextWZ = pxToWorldM(step.y);
  const resolved = castleInteriorResolveMove(prevWX, prevWZ, nextWX, nextWZ, floorYM);
  return {
    x: worldMToPx(resolved.x),
    y: worldMToPx(resolved.z),
    floorYM: resolved.floorYM,
    arrived: step.arrived && resolved.surface != null,
  };
}

/**
 * Apply a mob melee hit to a player by identity. Handles lethal damage by
 * setting hp=0, scheduling respawn, and stamping deadUntil.
 *
 * Idempotent if called twice in the same tick for the same target — second
 * call sees hp<=0 and returns early.
 */
function applyMobHit(ctx: any, targetIdentity: any, nowMicros: bigint, damage: number): void {
  const player = ctx.db.player.identity.find(targetIdentity);
  if (!player) return;
  if (player.hp <= 0) return; // already dead

  const newHp = player.hp - damage;
  if (newHp <= 0) {
    const respawnAt = nowMicros + PLAYER_RESPAWN_MICROS;
    ctx.db.player.identity.update({
      ...player,
      hp: 0,
      deadUntil: respawnAt,
      isMoving: false,
    });
    ctx.db.playerRespawnQueue.insert({
      id: 0n,    // auto-inc replaces this
      scheduledAt: ScheduleAt.time(respawnAt),
      identity: targetIdentity,
    });
  } else {
    ctx.db.player.identity.update({ ...player, hp: newHp });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// QUESTS (P1)
// ─────────────────────────────────────────────────────────────────────────────
//
// Quest/NPC/waypoint *definitions* live in the bundled content package
// (src/content/, mirrored from src/features/world/content/). Only per-player
// progress is table state. Rewards (copper/items/template unlocks) are
// granted at turn-in starting in P2/P4 — in P1 a turn-in just completes the
// quest; gameXp is gated off by GAME_XP_ENABLED in the content formulas.

function findQuestRow(ctx: any, identity: any, questId: string): any | null {
  for (const q of ctx.db.playerQuest.iter()) {
    if (q.questId === questId && q.owner.isEqual(identity)) return q;
  }
  return null;
}

function objectiveTarget(obj: QuestDef['objectives'][number]): number {
  return obj.type === 'find' ? 1 : obj.count;
}

function parseCounts(json: string, len: number): number[] {
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr) && arr.length === len) {
      return arr.map((n) => Math.max(0, Number(n) || 0));
    }
  } catch {
    // malformed row — treat as fresh progress
  }
  return new Array(len).fill(0);
}

function questIsReady(quest: QuestDef, counts: number[]): boolean {
  return quest.objectives.every((obj, i) => (counts[i] ?? 0) >= objectiveTarget(obj));
}

function playerInRangeOfNpc(player: { x: number; y: number }, npcId: string): boolean {
  const npc = NPCS[npcId];
  if (!npc) return false;
  const px = contentPosToPx(npc.zoneId, npc.pos);
  const dx = player.x - px.x;
  const dy = player.y - px.y;
  return dx * dx + dy * dy <= INTERACT_RANGE_PX * INTERACT_RANGE_PX;
}

/**
 * Accept a quest from its giver NPC. Quests are once-only: any existing
 * row (active, ready, or done) blocks re-acceptance. minLevel enforced
 * via playerProgress.worldLevel.
 */
export const acceptQuest = spacetimedb.reducer(
  { questId: t.string() },
  (ctx, { questId }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) return;
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;

    const quest: QuestDef | undefined = QUESTS[questId];
    if (!quest) return;
    if (findQuestRow(ctx, ctx.sender, questId)) return; // already taken/done

    if (quest.requiresQuestId) {
      const prereq = findQuestRow(ctx, ctx.sender, quest.requiresQuestId);
      if (!prereq || prereq.state !== QUEST_STATE_DONE) return;
    }
    if (quest.minLevel && getPlayerLevel(ctx, ctx.sender) < quest.minLevel) return;
    if (!playerInRangeOfNpc(player, quest.giverNpcId)) return;

    ctx.db.playerQuest.insert({
      id: 0n, // auto-inc replaces this
      owner: ctx.sender,
      questId,
      state: QUEST_STATE_ACTIVE,
      countsJson: JSON.stringify(new Array(quest.objectives.length).fill(0)),
      acceptedAt: nowMicros,
    });
  }
);

/** Abandon an in-progress quest (done quests are immutable history). */
export const abandonQuest = spacetimedb.reducer(
  { questId: t.string() },
  (ctx, { questId }) => {
    const row = findQuestRow(ctx, ctx.sender, questId);
    if (!row || row.state === QUEST_STATE_DONE) return;
    ctx.db.playerQuest.id.delete(row.id);
  }
);

/**
 * Turn in a ready quest at its turn-in NPC. Progress is recomputed from
 * counts server-side — the stored `ready` state is a cache, not trusted.
 */
export const turnInQuest = spacetimedb.reducer(
  { questId: t.string() },
  (ctx, { questId }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) return;
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;

    const quest: QuestDef | undefined = QUESTS[questId];
    if (!quest) return;
    const row = findQuestRow(ctx, ctx.sender, questId);
    if (!row || row.state === QUEST_STATE_DONE) return;

    const counts = parseCounts(row.countsJson, quest.objectives.length);
    if (!questIsReady(quest, counts)) return;
    if (!playerInRangeOfNpc(player, quest.turnInNpcId)) return;

    // P2 grants copper/template unlocks here; P4 grants items. gameXp is
    // gated by GAME_XP_ENABLED (off) per the fitness-only-XP decision.
    ctx.db.playerQuest.id.update({ ...row, state: QUEST_STATE_DONE });
  }
);

/**
 * Complete a 'find' objective: the client reports arrival, the server
 * validates the player actually stands inside the waypoint radius (+2 m
 * tolerance for interpolation slop).
 */
export const reachWaypoint = spacetimedb.reducer(
  { questId: t.string(), objectiveIdx: t.u32() },
  (ctx, { questId, objectiveIdx }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) return;
    const nowMicros = ctx.timestamp.microsSinceUnixEpoch;
    if (player.hp <= 0 || player.deadUntil > nowMicros) return;

    const quest: QuestDef | undefined = QUESTS[questId];
    if (!quest) return;
    const obj = quest.objectives[objectiveIdx];
    if (!obj || obj.type !== 'find') return;

    const row = findQuestRow(ctx, ctx.sender, questId);
    if (!row || row.state !== QUEST_STATE_ACTIVE) return;

    const wp = WAYPOINTS[obj.targetId];
    if (!wp) return;
    const px = contentPosToPx(wp.zoneId, wp.pos);
    const rangePx = (wp.radiusM + 2) * PX_PER_M;
    const dx = player.x - px.x;
    const dy = player.y - px.y;
    if (dx * dx + dy * dy > rangePx * rangePx) return;

    const counts = parseCounts(row.countsJson, quest.objectives.length);
    if (counts[objectiveIdx] >= 1) return; // already found
    counts[objectiveIdx] = 1;

    ctx.db.playerQuest.id.update({
      ...row,
      countsJson: JSON.stringify(counts),
      state: questIsReady(quest, counts) ? QUEST_STATE_READY : QUEST_STATE_ACTIVE,
    });
  }
);

/**
 * Kill-credit hook, called from castAbility's kill path. Increments every
 * matching kill objective on the killer's active quests and promotes rows
 * to 'ready' when all objectives are met.
 */
function creditKillToQuests(
  ctx: any,
  identity: any,
  mob: { mobType: string; spawnNetId: string; dungeonInstanceId: bigint },
): void {
  for (const row of ctx.db.playerQuest.iter()) {
    if (row.state !== QUEST_STATE_ACTIVE) continue;
    if (!row.owner.isEqual(identity)) continue;
    const quest: QuestDef | undefined = QUESTS[row.questId];
    if (!quest) continue;

    const counts = parseCounts(row.countsJson, quest.objectives.length);
    let changed = false;
    quest.objectives.forEach((obj, i) => {
      if (killObjectiveMatches(ctx, obj, mob) && counts[i] < objectiveTarget(obj)) {
        counts[i]++;
        changed = true;
      }
    });
    if (!changed) continue;

    ctx.db.playerQuest.id.update({
      ...row,
      countsJson: JSON.stringify(counts),
      state: questIsReady(quest, counts) ? QUEST_STATE_READY : QUEST_STATE_ACTIVE,
    });
  }
}

/**
 * Build a fresh mob row from a content SpawnEntry and insert it.
 * Used by both `seedWorld` (initial spawn) and `respawnMob` (post-death).
 *
 * `instanceCounter` is added to the timestamp to keep `mobId` unique across
 * multiple inserts in the same reducer call (microsSinceUnixEpoch shares
 * the same value for every insert inside one reducer).
 */
function insertMobFromSpawn(
  ctx: any,
  entry: SpawnEntry,
  netId: string,
  instanceCounter: number,
): void {
  const { spawn, mobDef, instanceIndex } = entry;
  const offset = spawnInstanceOffsetM(instanceIndex, spawn.radiusM);
  const px = contentPosToPx(spawn.zoneId, {
    x: spawn.pos.x + offset.dx,
    z: spawn.pos.z + offset.dz,
  });

  ctx.db.mob.insert({
    mobId:         ctx.timestamp.microsSinceUnixEpoch + BigInt(instanceCounter),
    mobType:       spawn.mobType,
    x:             px.x,
    y:             px.y,
    hp:            mobDef.maxHp,
    maxHp:         mobDef.maxHp,
    state:         'alive',
    spawnNetId:    netId,
    spawnX:        px.x,
    spawnY:        px.y,
    aggroRadiusPx: mobDef.aggroRadiusM * PX_PER_M,
    leashRadiusPx: mobDef.leashRadiusM * PX_PER_M,
    respawnSec:    mobDef.respawnSec,
    lastAttackAt:  0n,
    dungeonInstanceId: 0n,
  });
}

function insertMobFromDungeonSpawn(
  ctx: any,
  entry: DungeonSpawnEntry,
  netId: string,
  instanceId: bigint,
  instanceCounter: number,
): void {
  const { spawn, mobDef, instanceIndex } = entry;
  const offset = spawnInstanceOffsetM(instanceIndex, spawn.radiusM);
  const px = interiorLocalToPx({
    x: spawn.pos.x + offset.dx,
    z: spawn.pos.z + offset.dz,
  });

  const inst = ctx.db.dungeonInstance.instanceId.find(instanceId);
  const dungeon = inst ? DUNGEONS_BY_ID[inst.dungeonId] : undefined;
  const isBoss = dungeon && spawn.mobType === dungeon.bossMobType;
  const nowMicros = ctx.timestamp.microsSinceUnixEpoch;

  ctx.db.mob.insert({
    mobId:         nowMicros + BigInt(instanceCounter),
    mobType:       spawn.mobType,
    x:             px.x,
    y:             px.y,
    hp:            mobDef.maxHp,
    maxHp:         mobDef.maxHp,
    state:         'alive',
    spawnNetId:    netId,
    spawnX:        px.x,
    spawnY:        px.y,
    aggroRadiusPx: mobDef.aggroRadiusM * PX_PER_M,
    leashRadiusPx: mobDef.leashRadiusM * PX_PER_M,
    respawnSec:    mobDef.respawnSec,
    lastAttackAt:  0n,
    dungeonInstanceId: instanceId,
    floorYM:       dungeonSpawnFloorYM(spawn.netId),
    spawnedAt:     isBoss ? nowMicros : 0n,
    lastAoeAt:     0n,
    enraged:       false,
  });
}

function countInstanceMembers(ctx: any, instanceId: bigint): number {
  let n = 0;
  for (const p of ctx.db.player.iter()) {
    if (p.dungeonInstanceId === instanceId) n++;
  }
  return n;
}

function findOpenDungeonInstance(ctx: any, dungeonId: string): bigint | null {
  for (const inst of ctx.db.dungeonInstance.iter()) {
    if (inst.dungeonId !== dungeonId) continue;
    if (countInstanceMembers(ctx, inst.instanceId) < DUNGEON_MAX_PLAYERS) {
      return inst.instanceId;
    }
  }
  return null;
}

function seedDungeonInstanceMobs(ctx: any, instanceId: bigint, dungeonId: string): void {
  const dungeon = DUNGEONS_BY_ID[dungeonId];
  if (!dungeon) return;
  let counter = 0;
  for (const spawn of dungeon.spawns) {
    for (let i = 0; i < spawn.count; i++) {
      const netId = `${spawn.netId}_${i}`;
      const entry = dungeonSpawnByNetId.get(netId);
      if (!entry) continue;
      insertMobFromDungeonSpawn(ctx, entry, netId, instanceId, counter++);
    }
  }
}

function cleanupDungeonInstanceIfEmpty(ctx: any, instanceId: bigint): void {
  if (countInstanceMembers(ctx, instanceId) > 0) return;
  for (const m of ctx.db.mob.iter()) {
    if (m.dungeonInstanceId === instanceId) ctx.db.mob.mobId.delete(m.mobId);
  }
  ctx.db.dungeonInstance.instanceId.delete(instanceId);
}
