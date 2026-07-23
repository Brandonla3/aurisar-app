import { useEffect, useRef } from 'react';

// Ordered stack of active modals, bottom-most first, top-most last. Each entry
// is { token, getEl }. Two things are derived from this stack:
//   1. Escape only closes the TOP-most modal (one press = one layer), so a
//      ConfirmSheet stacked over an editor closes just the confirm.
//   2. Every modal's container except the top-most is made `inert`, so
//      keyboard focus (Tab/Shift-Tab) and the a11y tree can't reach a sheet
//      sitting behind a confirm. Modals portal to <body> as siblings of
//      #root, so inert-ing #root alone (below) does NOT cover a lower modal —
//      it needs inert-ing directly.
const modalStack = [];

// ── Pure stacking semantics (exported for unit tests; no DOM) ──────────────
// Only the top-most modal handles Escape, so one press closes one layer.
export function isTopModal(stack, token) {
  return stack.length > 0 && stack[stack.length - 1].token === token;
}
// Every modal except the top-most is inert (covered layers can't take focus).
export function inertFlags(stack) {
  return stack.map((_, i) => i !== stack.length - 1);
}

// Re-apply inert across the whole stack. #root is inert whenever any modal is
// open; each modal container is inert unless it is the frontmost layer.
function applyStackInert() {
  const root = document.getElementById('root');
  if (root) {
    if (modalStack.length > 0) root.setAttribute('inert', '');
    else root.removeAttribute('inert');
  }
  const flags = inertFlags(modalStack);
  for (let i = 0; i < modalStack.length; i++) {
    const el = modalStack[i].getEl();
    if (!el) continue;
    if (flags[i]) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }
}

/**
 * Modal accessibility lifecycle.
 *
 * When `active` becomes true, this hook:
 *   1. Saves the currently-focused element so it can be restored on close.
 *   2. Pushes this modal onto the shared stack and re-applies inert: #root and
 *      every covered lower modal become non-interactive and hidden from the
 *      a11y tree; only the frontmost modal stays interactive. `inert` is the
 *      modern (2022+) browser primitive that replaces hand-rolled focus traps.
 *   3. Adds a global Escape handler that calls `onClose` — but only when this
 *      modal is the top-most one on the stack.
 *
 * On unmount / when `active` becomes false: removes this modal from the stack,
 * re-applies inert (restoring the new top-most / clearing #root when the last
 * modal closes), and restores focus to the element that had it before.
 *
 * `containerRef` (optional) is a ref to this modal's outermost portal element
 * (the backdrop). It is what lets a lower modal be inert-ed while covered.
 * Callers that don't pass it still stack correctly for Escape and #root inert;
 * they just won't inert themselves when a newer modal covers them.
 *
 * Browser support: `inert` is Chrome 102+, Safari 15.5+, Firefox 112+ (>99%
 * by 2026). The API surface (active, onClose, containerRef) stays stable if we
 * ever swap to a focus-trap library.
 */
export function useModalLifecycle(active, onClose, containerRef) {
  // Pin onClose into a ref so we don't re-run the whole effect every render
  // when callers pass a fresh inline arrow each time.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const containerRefRef = useRef(containerRef);
  useEffect(() => { containerRefRef.current = containerRef; }, [containerRef]);

  useEffect(() => {
    if (!active) return undefined;

    const previousFocus = document.activeElement;

    // Unique token identifying this modal instance; getEl resolves the current
    // container element lazily (the ref is populated during commit, before
    // this effect runs).
    const token = {};
    const entry = { token, getEl: () => (containerRefRef.current ? containerRefRef.current.current : null) };
    modalStack.push(entry);
    applyStackInert();

    const onKey = (e) => {
      // Only the top-most modal responds, so a single Escape closes just the
      // frontmost layer (e.g. a ConfirmSheet over a live Sheet closes only the
      // confirm and leaves the background editor's input intact).
      if (e.key === 'Escape' && onCloseRef.current && isTopModal(modalStack, token)) {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      const idx = modalStack.indexOf(entry);
      if (idx !== -1) modalStack.splice(idx, 1);
      applyStackInert();
      document.removeEventListener('keydown', onKey);
      // Defer focus restore so any unmount effects on the modal's own
      // descendants finish first (e.g., select onBlur). Otherwise the restored
      // focus can be immediately stolen by a stale handler.
      if (previousFocus instanceof HTMLElement) {
        setTimeout(() => {
          // Only restore if focus is still on body (i.e., nothing else has
          // claimed it). Otherwise a downstream effect may have intentionally
          // moved focus elsewhere.
          if (document.activeElement === document.body) {
            previousFocus.focus();
          }
        }, 0);
      }
    };
  }, [active]);
}
