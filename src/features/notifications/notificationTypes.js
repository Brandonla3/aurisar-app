// Display metadata for every outbox event_type (public.notifications).
// The server enqueues rows; this file decides how each one reads in the
// in-app toast and the inbox. Email rendering lives server-side in the
// drain's templates — keep the two in the same voice when editing.

export const NOTIF_META = {
  friend_level_up: {
    icon: "⬆️",
    format: p => `${p.playerName || "A friend"} reached Level ${p.newLevel}!`,
  },
  friend_request: {
    icon: "🤝",
    format: p => `${p.fromName || "Someone"} sent you a friend request`,
  },
  friend_accepted: {
    icon: "✅",
    format: p => `${p.friendName || "Someone"} accepted your friend request`,
  },
  shared_workout: {
    icon: "📋",
    format: p => `${p.fromName || "A friend"} shared “${p.workoutName || "a workout"}” with you`,
  },
  message_received: {
    icon: "💬",
    format: p => `New message from ${p.fromName || "a friend"}`,
  },
  workout_reminder: {
    icon: "⏰",
    format: p => p.text || "Time to train — your quest awaits!",
  },
  streak_at_risk: {
    icon: "🔥",
    format: p =>
      p.text ||
      (p.streak ? `Your ${p.streak}-day streak is at risk — check in today!` : "Your streak is at risk — check in today!"),
  },
  welcome: {
    icon: "🎉",
    format: () => "Welcome to Aurisar!",
  },
  security_alert: {
    icon: "🛡️",
    format: p => p.text || "A security event occurred on your account",
  },
};

export function formatNotification(row) {
  const meta = NOTIF_META[row.event_type];
  const payload = row.payload || {};
  if (!meta) return { icon: "🔔", text: "Something happened in Aurisar" };
  return { icon: meta.icon, text: meta.format(payload) };
}

// "3m ago" style relative time for inbox rows.
export function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
