import React from "react";
import { sb } from "../../utils/supabase";
import { formatNotification } from "./notificationTypes";
import { toResult, unavailable, empty, STATUS } from "../../utils/fetchResult";

// In-app projection of the public.notifications outbox
// (scripts/security/17-notifications.sql): loads the recent inbox page,
// subscribes to realtime INSERTs (RLS scopes rows to the recipient), pops a
// toast for genuinely-new arrivals, and tracks unread state via read_at.
//
// Pre-migration safe: if the table doesn't exist yet the load errors are
// swallowed and the inbox just stays empty.
const PAGE_SIZE = 50;
const RETRY_MS = 4000;

export default function useNotifications({ authUser, isPreviewMode, showToast }) {
  const [items, setItems] = React.useState([]);
  // The discriminated read state. Previously a failed load was swallowed and
  // the inbox rendered as "no notifications" — indistinguishable from a
  // genuinely empty inbox, which is exactly how this feature could have sat
  // permanently broken without anyone noticing.
  const [state, setState] = React.useState(empty());
  // Counted server-side, not derived from `items`: the list is capped to the
  // newest PAGE_SIZE rows, so unread rows older than that window would be
  // invisible to a client-side tally and the badge would under-report.
  const [unreadCount, setUnreadCount] = React.useState(0);
  const userId = authUser ? authUser.id : null;
  const active = !!userId && !isPreviewMode;

  // Keep the toast emitter in a ref so resubscribing isn't tied to its identity.
  const showToastRef = React.useRef(showToast);
  React.useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const loadUnreadCount = React.useCallback(async () => {
    if (!active) return;
    try {
      const { count, error } = await sb
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", userId)
        .is("read_at", null);
      if (!error && typeof count === "number") setUnreadCount(count);
    } catch (e) {
      console.warn("notifications unread count:", e);
    }
  }, [active, userId]);

  const loadItems = React.useCallback(async () => {
    if (!active) return;
    let result;
    try {
      result = toResult(
        await sb
          .from("notifications")
          .select("id, actor_id, event_type, payload, created_at, read_at")
          .eq("recipient_id", userId)
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE),
        { surface: "notifications.inbox" }
      );
    } catch (e) {
      // A thrown error is still a result, not a reason to render nothing.
      result = unavailable(e, { surface: "notifications.inbox" });
    }
    setState(result);
    if (result.status === STATUS.OK) setItems(result.rows);
    else if (result.status === STATUS.EMPTY) setItems([]);
    // On `unavailable` the previously-loaded items are deliberately kept:
    // stale-but-real data plus a visible warning beats blanking the list.
    if (result.status === STATUS.UNAVAILABLE) {
      console.warn(
        `[notifications] inbox unavailable kind=${result.kind} code=${result.code || "?"}`
      );
    }
  }, [active, userId]);

  React.useEffect(() => {
    if (!active) {
      setItems([]);
      setUnreadCount(0);
      // Signed out / preview: a genuinely empty inbox, not a broken one.
      setState(empty());
      return;
    }
    loadItems();
    loadUnreadCount();
  }, [active, loadItems, loadUnreadCount]);

  React.useEffect(() => {
    if (!active) return undefined;
    let disposed = false;
    let channel = null;
    let retryTimer = null;

    const handleInsert = row => {
      if (!row) return;
      // Realtime is at-least-once: the same INSERT can be redelivered on
      // reconnect. Toast only when the row is genuinely new, or the user sees
      // the same notification pop twice.
      let isNew = false;
      setItems(prev => {
        if (prev.some(i => i.id === row.id)) return prev;
        isNew = true;
        return [row, ...prev].slice(0, PAGE_SIZE);
      });
      if (isNew) {
        if (!row.read_at) setUnreadCount(c => c + 1);
        const { icon, text } = formatNotification(row);
        showToastRef.current(`${icon} ${text}`);
      }
    };

    // Mirrors useMessages: resubscribe with backoff on channel errors and
    // refetch on tab-refocus, so a dropped socket (common when a mobile tab is
    // backgrounded) doesn't silently end live notifications until a reload.
    const subscribe = () => {
      if (disposed) return;
      channel = sb
        .channel("notifications-inbox")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `recipient_id=eq.${userId}`,
          },
          payload => handleInsert(payload.new)
        )
        .subscribe(status => {
          if (disposed) return;
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            sb.removeChannel(channel);
            channel = null;
            retryTimer = setTimeout(subscribe, RETRY_MS);
          }
        });
    };
    subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        loadItems();
        loadUnreadCount();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) sb.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, userId, loadItems, loadUnreadCount]);

  const markAllRead = React.useCallback(async () => {
    if (!active) return;
    const now = new Date().toISOString();
    // Bound the write to rows that existed when the user clicked. An unbounded
    // "all unread" UPDATE would also swallow a notification that arrived
    // mid-flight, marking read something the user never saw.
    const cutoff = items.length
      ? items.reduce((max, i) => (i.created_at > max ? i.created_at : max), items[0].created_at)
      : now;
    setItems(prev =>
      prev.map(i => (i.read_at || i.created_at > cutoff ? i : { ...i, read_at: now }))
    );
    try {
      // Clients hold UPDATE on read_at only (column grant in migration 17);
      // RLS limits the write to the caller's own rows.
      const { error } = await sb
        .from("notifications")
        .update({ read_at: now })
        .eq("recipient_id", userId)
        .is("read_at", null)
        .lte("created_at", cutoff);
      if (error) console.warn("notifications markAllRead:", error.message);
    } catch (e) {
      console.warn("notifications markAllRead:", e);
    }
    // Re-derive from the server so anything that arrived mid-flight is counted.
    loadUnreadCount();
  }, [active, userId, items, loadUnreadCount]);

  return { items, unreadCount, markAllRead, state };
}
