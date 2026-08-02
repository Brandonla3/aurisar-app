import React from "react";
import Sheet from "../../components/ui/Sheet";
import { formatNotification, timeAgo } from "./notificationTypes";
import { isBroken, isUnreachable, isLoading, STATUS } from "../../utils/fetchResult";

// The bell's inbox — a paginated view of the user's notifications outbox
// rows. Realtime keeps it fresh while open (useNotifications prepends new
// rows); offline users finally see what the vanishing toasts missed.
export default function NotificationInbox({
  open,
  onClose,
  items,
  unreadCount,
  onMarkAllRead,
  state,
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      layer={"modal"}
      placement={"bottom"}
      title={"🔔 Alerts"}
      ariaLabel={"Notifications inbox"}
      headerRight={
        unreadCount > 0 ? (
          <button className={"btn btn-ghost btn-sm"} onClick={onMarkAllRead}>
            {"Mark all read"}
          </button>
        ) : null
      }
    >
      {/* Distinct drawings for distinct states. "Nothing to show" and "I could
          not ask" must never be the same pixels — that equivalence is why this
          very inbox could have stayed permanently broken while looking fine.
          The failure banners render ABOVE the list rather than replacing it, so
          previously-loaded rows stay visible with a warning instead of the
          screen going blank on a refresh that happens to fail. */}
      {isBroken(state) && (
        <div className={"notif-inbox-broken"} role={"alert"}>
          <div className={"notif-inbox-broken-title"}>{"⚠ Alerts aren’t working"}</div>
          <div className={"notif-inbox-broken-body"}>
            {"This isn’t an empty inbox — the app couldn’t read your alerts at all. "}
            {"Nothing you do will fix it; it needs a developer."}
            {items && items.length > 0 && " Anything below was loaded earlier and may be out of date."}
          </div>
          <div className={"notif-inbox-broken-code"}>
            {(state.surface || "notifications") + " · " + (state.kind || "error") +
              (state.code ? " · " + state.code : "")}
          </div>
        </div>
      )}
      {isUnreachable(state) && (
        <div className={"notif-inbox-stale"}>
          {"Can’t reach the server right now. Your alerts are fine — this should "}
          {"sort itself out when the connection comes back."}
          {items && items.length > 0 && " Showing what was loaded earlier."}
        </div>
      )}

      {isLoading(state) && (!items || items.length === 0) ? (
        <div className={"notif-inbox-empty"}>{"Checking for alerts…"}</div>
      ) : (!items || items.length === 0) ? (
        // Only claim "nothing here" once a read has actually settled cleanly.
        state?.status === STATUS.EMPTY ? (
          <div className={"notif-inbox-empty"}>
            {"No alerts yet. Friend activity, level-ups and reminders land here."}
            {state.checkedAt && (
              <div className={"notif-inbox-checked"}>
                {"Checked " + timeAgo(state.checkedAt)}
              </div>
            )}
          </div>
        ) : null
      ) : (
        <div className={"notif-inbox-list"}>
          {items.map(row => {
            const { icon, text } = formatNotification(row);
            return (
              <div
                key={row.id}
                className={"notif-inbox-row" + (row.read_at ? "" : " notif-inbox-row-unread")}
              >
                <span className={"notif-inbox-icon"}>{icon}</span>
                <div className={"notif-inbox-body"}>
                  <div className={"notif-inbox-text"}>{text}</div>
                  <div className={"notif-inbox-time"}>{timeAgo(row.created_at)}</div>
                </div>
                {!row.read_at && <span className={"notif-inbox-dot"} aria-label={"Unread"} />}
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
