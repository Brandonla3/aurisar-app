// Pure helpers for the Messages tab. No React, no Supabase — everything here
// is unit-testable (src/features/social/__tests__/messageUtils.test.js).
//
// Message view-model shape (matches the get_channel_messages RPC rows):
//   { id, sender_id, sender_name, message_type, content, edited_at,
//     is_mine, created_at, pending?, failed? }

const GROUP_GAP_MS = 5 * 60 * 1000;

function ts(msg) {
  return new Date(msg.created_at).getTime();
}

function sortByCreatedAt(list) {
  return [...list].sort((a, b) => ts(a) - ts(b));
}

/** Convert a raw realtime INSERT row from public.messages into the view model. */
export function normalizeIncomingRow(row, myId, activeChannel) {
  const isMine = row.sender_id === myId;
  return {
    id: row.id,
    sender_id: row.sender_id,
    sender_name: isMine ? "You" : (activeChannel?.other_user?.player_name || "Unknown"),
    message_type: row.message_type || "text",
    content: row.content,
    edited_at: row.edited_at || null,
    is_mine: isMine,
    created_at: row.created_at,
  };
}

/** Local echo appended immediately on send, before the RPC round-trip. */
export function buildOptimisticMessage(content, myId, now = Date.now()) {
  return {
    id: "tmp-" + now + "-" + Math.random().toString(36).slice(2, 8),
    sender_id: myId,
    sender_name: "You",
    message_type: "text",
    content,
    edited_at: null,
    is_mine: true,
    created_at: new Date(now).toISOString(),
    pending: true,
  };
}

/**
 * Merge an incoming realtime message into the list: dedupe by id, reconcile
 * against a matching optimistic row (own messages echo back via realtime),
 * keep the list sorted by created_at.
 */
export function mergeIncomingMessage(list, incoming) {
  if (!incoming || incoming.id == null) return list;
  if (list.some(m => m.id === incoming.id)) return list;
  let next = list;
  if (incoming.is_mine) {
    // Reconcile only against a *pending* echo, never a failed one: a failed
    // row is a message whose send errored, so an incoming echo with the same
    // text must belong to a different (successful) send. Matching failed rows
    // here would silently erase the "tap to retry" bubble and, once its own
    // RPC resolved, produce two rows with the same server id.
    //
    // Only strip when *exactly one* pending row matches the content. With two
    // identical pending sends we can't tell which echo this is, so we leave
    // both — dedupe-by-id above plus resolveOptimistic's already-delivered
    // guard collapse the duplicate once each RPC returns.
    const matches = [];
    for (let i = 0; i < next.length; i++) {
      if (next[i].pending && next[i].content === incoming.content) matches.push(i);
    }
    if (matches.length === 1) {
      const idx = matches[0];
      next = [...next.slice(0, idx), ...next.slice(idx + 1)];
    }
  }
  return sortByCreatedAt([...next, incoming]);
}

/**
 * Merge a freshly fetched message window with rows already in state — optimistic
 * sends or realtime messages that arrived while the fetch was in flight — so a
 * channel load never drops a message received mid-fetch. Deduped by id (server
 * rows win on collision), sorted by created_at.
 */
export function mergeSnapshot(current, snapshot) {
  const byId = new Map();
  for (const m of current) byId.set(m.id, m);
  for (const m of snapshot) byId.set(m.id, m);
  return sortByCreatedAt([...byId.values()]);
}

/** Mark an optimistic row confirmed once send_message returns the real id. */
export function resolveOptimistic(list, tmpId, realId) {
  // If the realtime echo already delivered this id (it can beat the RPC's own
  // HTTP response), drop the optimistic row instead of rewriting it to a
  // duplicate id.
  if (realId != null && list.some(m => m.id === realId)) {
    return list.filter(m => m.id !== tmpId);
  }
  return list.map(m => {
    if (m.id !== tmpId) return m;
    const copy = { ...m, id: realId ?? m.id };
    delete copy.pending;
    delete copy.failed;
    return copy;
  });
}

/** Mark an optimistic row failed so the UI can offer retry. */
export function failOptimistic(list, tmpId) {
  return list.map(m => {
    if (m.id !== tmpId) return m;
    const copy = { ...m, failed: true };
    delete copy.pending;
    return copy;
  });
}

export function removeMessage(list, id) {
  return list.filter(m => m.id !== id);
}

function dayLabel(date, now) {
  const d = new Date(date);
  const n = new Date(now);
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(n) - startOf(d)) / 86400000);
  if (dayDiff <= 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== n.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}

/**
 * Annotate messages for rendering:
 *   _daySep     — "Today" / "Yesterday" / "Mar 12" before the first message of a day
 *   _showSender — sender label on the first message of a group (others' messages)
 *   _showTime   — timestamp under the last message of a group
 * A group = consecutive messages from one sender within 5 minutes.
 */
export function groupMessages(list, now = Date.now()) {
  return list.map((m, i) => {
    const prev = list[i - 1];
    const next = list[i + 1];
    const isSystem = m.message_type === "system" || m.message_type === "event";
    const newDay = !prev || dayLabel(prev.created_at, now) !== dayLabel(m.created_at, now);
    const startsGroup = !prev || prev.sender_id !== m.sender_id || ts(m) - ts(prev) > GROUP_GAP_MS || newDay;
    const endsGroup = !next || next.sender_id !== m.sender_id || ts(next) - ts(m) > GROUP_GAP_MS;
    return {
      ...m,
      _daySep: newDay ? dayLabel(m.created_at, now) : null,
      _showSender: !isSystem && !m.is_mine && startsGroup,
      _showTime: !isSystem && (endsGroup || !!m.failed || !!m.pending),
    };
  });
}

/**
 * Apply an incoming message (for a channel that is NOT open) to the
 * conversation list: bump preview + unread, resort by activity.
 * Returns null when the channel isn't in the list yet — the caller should
 * refetch conversations in that case.
 */
export function applyIncomingToConversations(convos, row) {
  const idx = convos.findIndex(c => c.channel_id === row.channel_id);
  if (idx === -1) return null;
  const conv = convos[idx];
  const updated = {
    ...conv,
    last_message: {
      content: row.content,
      sender_id: row.sender_id,
      message_type: row.message_type || "text",
      created_at: row.created_at,
    },
    unread_count: (conv.unread_count || 0) + 1,
    last_activity: row.created_at,
  };
  const rest = convos.filter((_, i) => i !== idx);
  return [updated, ...rest];
}

/** Bump the preview for a message the user just sent in the open channel. */
export function applyLocalSendToConversations(convos, channelId, content, myId, now = Date.now()) {
  const idx = convos.findIndex(c => c.channel_id === channelId);
  if (idx === -1) return convos;
  const conv = convos[idx];
  const updated = {
    ...conv,
    last_message: {
      content,
      sender_id: myId,
      message_type: "text",
      created_at: new Date(now).toISOString(),
    },
    last_activity: new Date(now).toISOString(),
  };
  const rest = convos.filter((_, i) => i !== idx);
  return [updated, ...rest];
}

/** Zero out a conversation's unread badge (when the user opens it). */
export function clearConversationUnread(convos, channelId) {
  return convos.map(c => (c.channel_id === channelId ? { ...c, unread_count: 0 } : c));
}
