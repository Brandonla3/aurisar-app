import React from "react";
import { sb } from "../utils/supabase";

// Maps the app's camelCase pref keys onto typed (event_type, channel) rows in
// public.notification_prefs (scripts/security/17-notifications.sql). The
// channel split is the part the old profiles.data jsonb blob couldn't express:
// friendExercise and reviewBattleStats gate in-app surfaces, the rest gate
// emails.
export const PREF_KEY_MAP = {
  sharedWorkout: { eventType: "shared_workout", channel: "email" },
  friendLevelUp: { eventType: "friend_level_up", channel: "email" },
  friendRequest: { eventType: "friend_request", channel: "email" },
  friendAccepted: { eventType: "friend_accepted", channel: "email" },
  messageReceived: { eventType: "message_received", channel: "email" },
  friendExercise: { eventType: "friend_exercise", channel: "in_app" },
  reviewBattleStats: { eventType: "review_battle_stats", channel: "in_app" },
};

// Must stay in sync with public.default_notification_pref() in migration 17 —
// the server is authoritative for email delivery; this copy only covers the
// signed-out/preview render before any rows load.
export const DEFAULT_NOTIF_PREFS = {
  sharedWorkout: true,
  friendLevelUp: true,
  friendRequest: true,
  friendAccepted: true,
  messageReceived: false,
  friendExercise: true,
  reviewBattleStats: true,
};

// Fully-resolved boolean map (defaults merged with the user's saved rows).
// Preview mode and signed-out sessions get defaults and never write.
export function useNotificationPrefs(authUser, isPreviewMode) {
  const [prefs, setPrefs] = React.useState(DEFAULT_NOTIF_PREFS);
  const prefsRef = React.useRef(prefs);
  React.useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  const userId = authUser ? authUser.id : null;

  React.useEffect(() => {
    if (!userId || isPreviewMode) {
      setPrefs(DEFAULT_NOTIF_PREFS);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await sb
          .from("notification_prefs")
          .select("event_type, channel, enabled")
          .eq("user_id", userId);
        if (error || cancelled || !data) return;
        const next = { ...DEFAULT_NOTIF_PREFS };
        for (const [key, map] of Object.entries(PREF_KEY_MAP)) {
          const row = data.find(
            r => r.event_type === map.eventType && r.channel === map.channel
          );
          if (row) next[key] = !!row.enabled;
        }
        setPrefs(next);
      } catch (e) {
        console.warn("notification_prefs load:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, isPreviewMode]);

  const setPref = React.useCallback(
    async (key, value) => {
      const map = PREF_KEY_MAP[key];
      if (!map) return;
      setPrefs(p => ({ ...p, [key]: value }));
      if (!userId || isPreviewMode) return;
      try {
        const { error } = await sb.from("notification_prefs").upsert(
          {
            user_id: userId,
            event_type: map.eventType,
            channel: map.channel,
            enabled: value,
          },
          { onConflict: "user_id,event_type,channel" }
        );
        if (error) console.warn("notification_prefs save:", error.message);
      } catch (e) {
        console.warn("notification_prefs save:", e);
      }
    },
    [userId, isPreviewMode]
  );

  const toggle = React.useCallback(
    key => setPref(key, !prefsRef.current[key]),
    [setPref]
  );

  return { prefs, toggle, setPref };
}
