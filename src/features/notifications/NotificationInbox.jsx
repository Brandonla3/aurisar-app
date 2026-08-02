import React from "react";
import Sheet from "../../components/ui/Sheet";
import { formatNotification, timeAgo } from "./notificationTypes";

// The bell's inbox — a paginated view of the user's notifications outbox
// rows. Realtime keeps it fresh while open (useNotifications prepends new
// rows); offline users finally see what the vanishing toasts missed.
export default function NotificationInbox({
  open,
  onClose,
  items,
  unreadCount,
  onMarkAllRead,
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
      {(!items || items.length === 0) ? (
        <div className={"notif-inbox-empty"}>
          {"No alerts yet. Friend activity, level-ups and reminders land here."}
        </div>
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
