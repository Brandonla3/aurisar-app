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
import { tileGameplay, type SpawnPoint } from './gameplay/index.js';

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
const WOLF_MOVE_SPEED_PX_PER_S  = 3 * PX_PER_M;       // 3 m/s (slower than player so they're outrunnable)
const WOLF_MOVE_STEP_PX         = WOLF_MOVE_SPEED_PX_PER_S * AI_TICK_DT_SEC;  // 24 px / tick
const WOLF_MELEE_RANGE_PX       = 2 * PX_PER_M;       // 2 m bite range
const WOLF_ATTACK_DAMAGE        = 10;
const WOLF_ATTACK_CD_MICROS     = 1_500_000n;         // 1.5 s between bites → 6.67 dps
const SEED_WOLF_HP              = 100;
const SEED_WOLF_AGGRO_M         = 18;                 // default if JSON omits
const SEED_WOLF_LEASH_M         = 35;                 // default if JSON omits
const SEED_WOLF_RESPAWN_SEC     = 25;                 // default if JSON omits

const PLAYER_MAX_HP             = 100;
const PLAYER_RESPAWN_MICROS     = 5_000_000n;         // 5 s death timer before snap to origin

// ── Spawn-point index for O(1) respawn lookups ───────────────────────────────
//
// `respawnMob` needs the original spawn point's world position + radii. Each
// mob row stores its spawn metadata directly (spawnX/Y, aggro/leash, respawnSec)
// so the AI tick is self-contained, but on respawn we need the *spawn point's*
// values again to insert a fresh row. We build a map from `${net_id}_${i}` →
// {spawnPoint, instanceIndex} at module load. Cost: ~10 entries, microseconds.

interface SpawnEntry {
  spawn:         SpawnPoint;
  instanceIndex: number;
}
const spawnByNetId = new Map<string, SpawnEntry>();
for (const tile of tileGameplay) {
  for (const spawn of tile.spawns) {
    for (let i = 0; i < spawn.max_alive; i++) {
      spawnByNetId.set(`${spawn.net_id}_${i}`, { spawn, instanceIndex: i });
    }
  }
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
  spawnNetId:  t.string(),     // payload — which spawn point net_id (suffixed: e.g. SPAWN_..._NW_0)
});

const playerRespawnQueueRow = t.row('PlayerRespawnQueueRow', {
  id:          t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  identity:    t.identity(),   // payload — which player to revive
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

    // Validate inputs
    const safeName = username.trim().slice(0, 32) || 'Adventurer';
    const safeClass = ['warrior', 'mage', 'archer', 'rogue'].includes(classType)
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
  },
  (ctx, { x, y, direction, isMoving }) => {
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

    // Zone detection based on position
    const zoneId = detectZone(clampedX, clampedY);

    ctx.db.player.identity.update({
      ...existing,
      x: clampedX,
      y: clampedY,
      direction: direction % 4, // only 0-3 valid
      isMoving,
      zoneId,
    });
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
// COMBAT (slice 5a / 5c)
// ─────────────────────────────────────────────────────────────────────────────

const MELEE_RANGE_PX        = 96;             // 3 world units = 96 STDB px
const MELEE_DAMAGE          = 25;             // 4 swings kills a 100-HP wolf
const MELEE_COOLDOWN_MICROS = 300_000n;       // 300 ms between swings; client throttles at 350 ms so legit input has headroom

/**
 * Idempotently seed mobs from the bundled per-tile gameplay manifest.
 * Called by the client on connect; safe to call repeatedly — each spawn
 * is keyed by a unique `spawnNetId` and we skip any net_id that already
 * has a row (alive or dead), so re-seeding after a server-side wipe
 * works cleanly.
 *
 * Each manifest spawn point produces `max_alive` mob rows. The instance
 * index is suffixed onto the source `net_id` (e.g.
 * `SPAWN_MOB_WOLF_NEAR_NW_0`, `_1`) to keep each row uniquely
 * addressable while still letting tile-author logic group them.
 *
 * Slice 5c also bootstraps the AI tick schedule here if it's empty —
 * the live maincloud module was published before `init` existed, so
 * we lazy-initialize on first re-seed. Safe to call multiple times
 * (we count rows before inserting).
 */
export const seedWorld = spacetimedb.reducer({}, (ctx) => {
  // Bootstrap the AI tick scheduler if missing. Calling this from seedWorld
  // means the first post-publish `seedWorld` invocation also kicks off AI.
  if (ctx.db.mobAiTickSchedule.count() === 0n) {
    ctx.db.mobAiTickSchedule.insert({
      id: 0n,    // auto-inc replaces this
      scheduledAt: ScheduleAt.interval(AI_TICK_MICROS),
    });
  }

  // Pre-compute the set of already-seeded netIds. Iter is O(N) but the
  // table is tiny — at slice 5b scale, the few tens of rows here cost
  // microseconds.
  const seeded = new Set<string>();
  for (const row of ctx.db.mob.iter()) seeded.add(row.spawnNetId);

  let inserted = 0;
  for (const tile of tileGameplay) {
    for (const spawn of tile.spawns) {
      for (let i = 0; i < spawn.max_alive; i++) {
        const netId = `${spawn.net_id}_${i}`;
        if (seeded.has(netId)) continue;
        insertMobFromSpawn(ctx, spawn, netId, inserted);
        seeded.add(netId);
        inserted++;
      }
    }
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

    const newHp = mob.hp - MELEE_DAMAGE;
    if (newHp <= 0) {
      // Kill: delete the row (client sees onDelete → mob disappears) and
      // schedule a respawn after the spawn point's respawnSec.
      const respawnAt = nowMicros + BigInt(mob.respawnSec) * 1_000_000n;
      ctx.db.mobRespawnQueue.insert({
        id: 0n,    // auto-inc replaces this
        scheduledAt: ScheduleAt.time(respawnAt),
        spawnNetId: mob.spawnNetId,
      });
      ctx.db.mob.mobId.delete(mobId);
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
    const livePlayers: Array<{ identity: any; x: number; y: number }> = [];
    for (const p of ctx.db.player.iter()) {
      if (!p.online) continue;
      if (p.hp <= 0) continue;
      if (p.deadUntil > now) continue;
      livePlayers.push({ identity: p.identity, x: p.x, y: p.y });
    }

    for (const mob of ctx.db.mob.iter()) {
      if (mob.hp <= 0) continue;
      // Only wolves have AI for now — keeps future mob types inert until
      // they get their own behavior.
      if (mob.mobType !== 'wolf') continue;

      // 1. Leash check — if past leash radius, return home regardless of aggro.
      const homeDx = mob.x - mob.spawnX;
      const homeDy = mob.y - mob.spawnY;
      const homeDistSq = homeDx * homeDx + homeDy * homeDy;
      const leashSq   = mob.leashRadiusPx * mob.leashRadiusPx;

      let newState = mob.state;
      let nextX = mob.x;
      let nextY = mob.y;
      let nextLastAttackAt = mob.lastAttackAt;

      if (mob.state === 'returning' || homeDistSq > leashSq) {
        // Walk straight back to spawn point. Continue in 'returning' until
        // we're close enough to snap home.
        const stepArrived = stepToward(mob.x, mob.y, mob.spawnX, mob.spawnY, WOLF_MOVE_STEP_PX);
        nextX = stepArrived.x;
        nextY = stepArrived.y;
        if (stepArrived.arrived) {
          newState = 'alive';
        } else {
          newState = 'returning';
        }
      } else {
        // 2. Find nearest live player within aggro.
        const aggroSq = mob.aggroRadiusPx * mob.aggroRadiusPx;
        let nearest: { x: number; y: number; identity: any } | null = null;
        let nearestDistSq = aggroSq;
        for (const p of livePlayers) {
          const dx = p.x - mob.x;
          const dy = p.y - mob.y;
          const dsq = dx * dx + dy * dy;
          if (dsq <= nearestDistSq) {
            nearest = p;
            nearestDistSq = dsq;
          }
        }

        if (nearest) {
          // Chase. Step toward the target.
          const meleeSq = WOLF_MELEE_RANGE_PX * WOLF_MELEE_RANGE_PX;
          if (nearestDistSq <= meleeSq) {
            // In bite range — try to land a hit instead of moving.
            if (now - mob.lastAttackAt >= WOLF_ATTACK_CD_MICROS) {
              applyWolfBite(ctx, nearest.identity, now);
              nextLastAttackAt = now;
            }
            // Don't step — we're already in melee.
          } else {
            const step = stepToward(mob.x, mob.y, nearest.x, nearest.y, WOLF_MOVE_STEP_PX);
            nextX = step.x;
            nextY = step.y;
          }
          newState = 'alive';
        } else {
          // No one in aggro — hold position.
          newState = 'alive';
        }
      }

      // Only emit an update if something actually changed. Skipping no-ops
      // avoids needless WebSocket churn for idle mobs.
      if (nextX !== mob.x || nextY !== mob.y || newState !== mob.state ||
          nextLastAttackAt !== mob.lastAttackAt) {
        ctx.db.mob.mobId.update({
          ...mob,
          x: nextX,
          y: nextY,
          state: newState,
          lastAttackAt: nextLastAttackAt,
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
    const entry = spawnByNetId.get(spawnNetId);
    if (!entry) return; // spawn point removed from manifest; drop respawn

    // Defensive: if a mob with this spawnNetId already exists (e.g. seedWorld
    // ran in parallel), don't double-insert.
    for (const m of ctx.db.mob.iter()) {
      if (m.spawnNetId === spawnNetId) return;
    }

    insertMobFromSpawn(ctx, entry.spawn, spawnNetId, 0);
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

/**
 * Apply a wolf bite to a player by identity. Handles lethal damage by
 * setting hp=0, scheduling respawn, and stamping deadUntil.
 *
 * Idempotent if called twice in the same tick for the same target — second
 * call sees hp<=0 and returns early.
 */
function applyWolfBite(ctx: any, targetIdentity: any, nowMicros: bigint): void {
  const player = ctx.db.player.identity.find(targetIdentity);
  if (!player) return;
  if (player.hp <= 0) return; // already dead

  const newHp = player.hp - WOLF_ATTACK_DAMAGE;
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

/**
 * Build a fresh mob row from a SpawnPoint definition and insert it.
 * Used by both `seedWorld` (initial spawn) and `respawnMob` (post-death).
 *
 * `instanceCounter` is added to the timestamp to keep `mobId` unique across
 * multiple inserts in the same reducer call (microsSinceUnixEpoch shares
 * the same value for every insert inside one reducer).
 */
function insertMobFromSpawn(
  ctx: any,
  spawn: SpawnPoint,
  netId: string,
  instanceCounter: number,
): void {
  // Gameplay JSON positions are absolute world meters. STDB px =
  // worldUnits * 32 + WORLD_CENTER_PX. position.y is vertical (Babylon Y)
  // and is ignored — mobs walk on the ground plane; position.z maps to
  // mob.y (the world's Z axis on the ground plane).
  const xPx = Math.round(spawn.position.x * PX_PER_M + WORLD_CENTER_PX);
  const yPx = Math.round(spawn.position.z * PX_PER_M + WORLD_CENTER_PX);

  const aggroPx = (spawn.aggro_radius_m ?? SEED_WOLF_AGGRO_M) * PX_PER_M;
  const leashPx = (spawn.leash_radius_m ?? SEED_WOLF_LEASH_M) * PX_PER_M;
  const respawnSec = spawn.respawn_sec ?? SEED_WOLF_RESPAWN_SEC;

  ctx.db.mob.insert({
    mobId:         ctx.timestamp.microsSinceUnixEpoch + BigInt(instanceCounter),
    mobType:       spawn.mob_type,
    x:             xPx,
    y:             yPx,
    hp:            SEED_WOLF_HP,
    maxHp:         SEED_WOLF_HP,
    state:         'alive',
    spawnNetId:    netId,
    spawnX:        xPx,
    spawnY:        yPx,
    aggroRadiusPx: aggroPx,
    leashRadiusPx: leashPx,
    respawnSec,
    lastAttackAt:  0n,
  });
}
