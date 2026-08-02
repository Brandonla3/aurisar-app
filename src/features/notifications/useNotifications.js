import React from "react";
import { sb } from "../../utils/supabase";
import { formatNotification } from "./notificationTypes";

// In-app projection of the public.notifications outbox
// (scripts/security/17-notifications.sql): loads the recent inbox page,
// subscribes to realtime INSERTs (RLS scopes rows to the recipient), pops a
// toast for new arrivals, and tracks unread state via read_at.
//
// Pre-migration safe: if the table doesn't exist yet the load errors are
// swallowed and the inbox just stays empty.
const PAGE_SIZE = 50;

export default function useNotifications({ authUser, isPreviewMode, showToast }) {
  const [items, setItems] = React.useState([]);
  const userId = authUser ? authUser.id : null;

  React.useEffect(() => {
    if (!userId || isPreviewMode) {
      setItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await sb
          .from("notifications")
          .select("id, actor_id, event_type, payload, created_at, read_at")
          .eq("recipient_id", userId)
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE);
        if (!error && !cancelled && data) setItems(data);
      } catch (e) {
        console.warn("notifications load:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, isPreviewMode]);

  React.useEffect(() => {
    if (!userId || isPreviewMode) return;
    const channel = sb
      .channel("notifications-inbox")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        payload => {
          const row = payload.new;
          if (!row) return;
          setItems(prev =>
            prev.some(i => i.id === row.id) ? prev : [row, ...prev].slice(0, PAGE_SIZE)
          );
          const { icon, text } = formatNotification(row);
          showToast(`${icon} ${text}`);
        }
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [userId, isPreviewMode, showToast]);

  const unreadCount = React.useMemo(
    () => items.reduce((n, i) => n + (i.read_at ? 0 : 1), 0),
    [items]
  );

  const markAllRead = React.useCallback(async () => {
    if (!userId || isPreviewMode) return;
    const now = new Date().toISOString();
    setItems(prev => prev.map(i => (i.read_at ? i : { ...i, read_at: now })));
    try {
      // Clients hold UPDATE on read_at only (column grant in migration 17);
      // RLS limits the write to the caller's own rows.
      const { error } = await sb
        .from("notifications")
        .update({ read_at: now })
        .eq("recipient_id", userId)
        .is("read_at", null);
      if (error) console.warn("notifications markAllRead:", error.message);
    } catch (e) {
      console.warn("notifications markAllRead:", e);
    }
  }, [userId, isPreviewMode]);

  return { items, unreadCount, markAllRead };
}
