import React from "react";
import { subscribeToasts, getToasts, dismissToast } from "./toastStore";

// Renders the toast queue bottom-center. Status toasts are polite; error
// toasts use role="alert" so screen readers announce them immediately.
export default function ToastHost() {
  const toasts = React.useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (toasts.length === 0) return null;
  return (
    <div className={"toast-stack"}>
      {toasts.map(t => (
        <div
          key={t.id}
          className={"toast" + (t.type === "error" ? " toast-error" : "")}
          role={t.type === "error" ? "alert" : "status"}
          aria-live={t.type === "error" ? "assertive" : "polite"}
          aria-atomic={"true"}
          onClick={() => dismissToast(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
