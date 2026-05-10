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

// World bounds in STDB px. Derived from world_build_config — see header.
const WORLD_HALF_PX = 32000;        // 1000 world units * 32 px/unit
const WORLD_CENTER_PX = 1600;       // legacy origin offset (matches client STDB_CENTER)
const PLAYER_HALF_PX = 32;          // 1 world unit player half-width
const WORLD_MIN_PX = WORLD_CENTER_PX - WORLD_HALF_PX + PLAYER_HALF_PX; // -30368
const WORLD_MAX_PX = WORLD_CENTER_PX + WORLD_HALF_PX - PLAYER_HALF_PX; // 33568

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
