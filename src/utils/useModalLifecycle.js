import { useEffect, useRef } from 'react';

// Module-level counter so nested modals stack correctly. The DOM `inert`
// attribute is binary — either set or not — so simply removing it on close
// of an inner modal would also re-enable the background while an outer
// modal is still open. Counting active modals fixes that.
let activeCount = 0;

/**
 * Modal accessibility lifecycle.
 *
 * When `active` becomes true, this hook:
 *   1. Saves the currently-focused element so it can be restored on close.
 *   2. Sets the `inert` attribute on the application root (#root). With
 *      `inert`, every focusable element inside the root becomes unfocusable
 *      and is hidden from the accessibility tree — Tab can't escape into
 *      the background, screen readers don't read it, and pointer events
 *      don't fire. This is the modern (2022+) browser primitive that
 *      replaces hand-rolled focus traps for our case.
 *   3. Adds a global Escape-key handler that calls `onClose`.
 *
 * On unmount / when `active` becomes false:
 *   - Decrements the global counter and clears `inert` only when the last
 *     modal closes (so an inner modal closing doesn't re-enable background
 *     while its outer modal is still open).
 *   - Restores focus to whichever element had it before this modal opened.
 *
 * Browser support note: `inert` is supported in Chrome 102+, Safari 15.5+,
 * Firefox 112+. By 2026 baseline that's >99% of users. If we ever need to
 * back-port to older browsers, we'd swap to a focus-trap-react wrapper at
 * the same call sites — the API surface (active + onClose) stays the same.
 *
 * Why this approach over focus-trap-react:
 *   - Zero bundle (~5kB gz saved)
 *   - Same screen-reader semantics as `aria-hidden` on background
 *   - Simpler nesting story (counter, no library state machine)
 *   - Tab from last element in modal goes to browser chrome rather than
 *     cycling — most users prefer non-cycling behavior, WCAG doesn't
 *     require cycling
 */
export function useModalLifecycle(active, onClose) {
  // Pin onClose into a ref so we don't need to add it to the effect deps
  // (avoids re-running the whole effect every render when callers pass a
  // fresh inline arrow each time).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!active) return;

    // Modals across this codebase render via createPortal(..., document.body)
    // so they end up as DOM siblings of <div id="root"> (the React mount
    // point). Marking #root inert therefore disables the entire background
    // app without affecting the open modal(s).
    const root = document.getElementById('root');
    const previousFocus = document.activeElement;

    activeCount += 1;
    if (activeCount === 1 && root) {
      root.setAttribute('inert', '');
    }

    const onKey = (e) => {
      if (e.key === 'Escape' && onCloseRef.current) {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      activeCount = Math.max(0, activeCount - 1);
      if (activeCount === 0 && root) {
        root.removeAttribute('inert');
      }
      document.removeEventListener('keydown', onKey);
      // Defer focus restore so any unmount effects on the modal's own
      // descendants finish first (e.g., select onBlur). Otherwise the
      // restored focus can be immediately stolen by a stale handler.
      if (previousFocus instanceof HTMLElement) {
        setTimeout(() => {
          // Only restore if focus is still on body (i.e., nothing else
          // has claimed it). Otherwise a downstream effect may have
          // intentionally moved focus elsewhere.
          if (document.activeElement === document.body) {
            previousFocus.focus();
          }
        }, 0);
      }
    };
  }, [active]);
}
