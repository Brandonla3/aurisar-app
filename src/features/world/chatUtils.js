// Pure helpers for the in-world chat log. No React, no SpacetimeDB —
// unit-testable (src/features/world/__tests__/chatUtils.test.js).
//
// chat_message rows come from the generated binding: id (u64/BigInt),
// senderId (Identity), senderName, text, sentAt (u64 micros/BigInt),
// msgType ('world' | 'proximity' | 'emote'), x, y (sender position at send).

/** Stable hex string for a SpacetimeDB Identity (matches repo convention). */
export function idHex(id) {
  if (id == null) return null;
  return typeof id.toHexString === 'function' ? id.toHexString() : String(id);
}

/**
 * Whether an incoming chat row should flag the "unseen" dot on the closed
 * chat button. Never flag the local player's own echo (submitChat closes the
 * chat immediately, so your own row arrives with the chat already closed).
 */
export function shouldFlagUnseen(row, myIdHex, chatOpen) {
  if (chatOpen) return false;
  if (!row) return false;
  return idHex(row.senderId) !== myIdHex;
}

// Proximity-chat radius in SpacetimeDB px (chat_message x/y are server px).
// 400 px = 12.5 m at 32 px/m — the range a 'proximity' message carries.
// (Relocated here from the removed dead-Phaser game/constants.js.)
export const PROXIMITY_RADIUS = 400;

/**
 * Should this message be shown to a player standing at myPos?
 * - 'world' and 'emote' messages are always visible.
 * - 'proximity' messages only within `radius` of the sender's position.
 * - Missing position data (either side) fails open: show the message rather
 *   than silently dropping chat on a data gap.
 */
export function isChatVisible(msg, myPos, radius) {
  if (!msg) return false;
  if (msg.msgType !== 'proximity') return true;
  if (!myPos || !Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return true;
  const dx = msg.x - myPos.x;
  const dy = msg.y - myPos.y;
  return dx * dx + dy * dy <= radius * radius;
}

function cmpSentAt(a, b) {
  const av = a.sentAt ?? 0n;
  const bv = b.sentAt ?? 0n;
  return av < bv ? -1 : av > bv ? 1 : 0;
}

/**
 * Insert an incoming chat row: drop pre-join history (SpacetimeDB replays
 * all existing subscription rows as inserts on connect), dedupe by id, keep
 * sorted by sentAt, cap the buffer.
 */
export function insertChatMessage(list, msg, { cap = 60, joinCutoffMs = null } = {}) {
  if (!msg) return list;
  if (joinCutoffMs != null && msg.sentAt != null && msg.sentAt < joinCutoffMs) return list;
  if (msg.id != null && list.some(m => m.id === msg.id)) return list;
  const next = [...list, msg].sort(cmpSentAt);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * Millisecond cutoff (BigInt) for "now minus windowMs". The server stores
 * chatMessage.sentAt in ms (spacetimedb/src/index.ts: `sentAt: nowMicros / 1000n`),
 * so this must be ms too — comparing against microseconds would drop every row.
 */
export function joinCutoffMs(nowMs, windowMs = 60000) {
  return BigInt(Math.max(0, nowMs - windowMs));
}
