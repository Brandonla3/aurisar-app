// The one toast pipe. App.jsx, AdminPage and feature modules all emit through
// showToast(); <ToastHost/> renders the queue. Replaces the three independent
// single-slot implementations (App.jsx setToast, AdminPage local state — the
// 3D world's in-canvas toast stays separate by design).
//
// Legacy-compatible signature: showToast(msg), showToast(msg, 4000) and
// showToast(msg, { duration, type: 'error' }) all work, so the ~60 existing
// call sites that receive showToast as a prop keep working unchanged.

let toasts = [];
const listeners = new Set();
const timers = new Map();
let nextId = 1;

const MAX_VISIBLE = 4;

function emit() {
  for (const l of listeners) l(toasts);
}

export function showToast(message, opts) {
  if (!message) return;
  const o = typeof opts === "number" ? { duration: opts } : opts || {};
  const id = nextId++;
  const toast = {
    id,
    message,
    type: o.type === "error" ? "error" : "status",
    duration: o.duration || 4000,
  };
  const evicted = toasts.length >= MAX_VISIBLE ? toasts[0] : null;
  toasts = [...toasts, toast].slice(-MAX_VISIBLE);
  if (evicted) {
    clearTimeout(timers.get(evicted.id));
    timers.delete(evicted.id);
  }
  timers.set(id, setTimeout(() => dismissToast(id), toast.duration));
  emit();
}

export function dismissToast(id) {
  if (!toasts.some(t => t.id === id)) return;
  clearTimeout(timers.get(id));
  timers.delete(id);
  toasts = toasts.filter(t => t.id !== id);
  emit();
}

export function subscribeToasts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getToasts() {
  return toasts;
}

// Test hook: reset module state between cases.
export function _clearToasts() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  toasts = [];
  emit();
}
