import { useEffect } from 'react';

/**
 * Remember where a scroll container was left, and put it back on return.
 *
 * The exercise library paginates ~1,500 rows. Scrolling 300 rows deep, hopping
 * to another sub-tab to check something, and coming back used to dump you at
 * the top with the pagination reset — the work of finding your place was
 * thrown away every time. This keeps the offset in sessionStorage (per key)
 * so it survives tab switches within the session but not a fresh visit.
 *
 * Which element actually scrolls depends on viewport size: on desktop the app
 * scrolls its `.scroll-area` pane, on mobile the document itself does. Rather
 * than hard-code either, `resolveScroller` walks up from the anchor and takes
 * the first ancestor with real overflow, falling back to the document.
 */

function resolveScroller(preferredSelector) {
  const preferred = preferredSelector && document.querySelector(preferredSelector);
  if (preferred && preferred.scrollHeight > preferred.clientHeight + 4) return preferred;

  let el = preferred?.parentElement || null;
  while (el && el !== document.documentElement) {
    if (el.scrollHeight > el.clientHeight + 4) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return el;
    }
    el = el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

const getTop = el => (el === document.scrollingElement || el === document.documentElement)
  ? window.scrollY
  : el.scrollTop;

const setTop = (el, v) => {
  if (el === document.scrollingElement || el === document.documentElement) window.scrollTo(0, v);
  else el.scrollTop = v;
};

// Timers rather than requestAnimationFrame throughout: rAF is suspended while
// the document is hidden, which would strand a restore queued during a
// background render and silently drop saves.
const SAVE_THROTTLE_MS = 120;
// A single deferred restore isn't enough — images, the Supabase catalog merge
// and the reveal animations all change the content height after first paint,
// so an early scrollTo clamps to whatever the page is tall enough for. Retry
// until the offset actually takes or we run out of attempts.
const RESTORE_ATTEMPTS = [40, 120, 260, 500];

export function useScrollRestore(key, preferredSelector = '.scroll-area') {
  useEffect(() => {
    const el = resolveScroller(preferredSelector);
    const isDoc = el === document.scrollingElement || el === document.documentElement;
    const target = isDoc ? window : el;

    const storageKey = `aurisar-scroll:${key}`;
    let saved = 0;
    try { saved = parseInt(sessionStorage.getItem(storageKey) || '0', 10) || 0; } catch { /* private mode */ }

    // A user scroll during the restore window means they've taken over —
    // stop fighting them for control of the viewport.
    let restoring = saved > 0;
    const timers = [];

    if (restoring) {
      for (const delay of RESTORE_ATTEMPTS) {
        timers.push(setTimeout(() => {
          if (!restoring) return;
          if (Math.abs(getTop(el) - saved) < 2) { restoring = false; return; }
          setTop(el, saved);
        }, delay));
      }
      timers.push(setTimeout(() => { restoring = false; }, RESTORE_ATTEMPTS[RESTORE_ATTEMPTS.length - 1] + 50));
    }

    let throttle = null;
    const onScroll = () => {
      if (throttle) return;
      throttle = setTimeout(() => {
        throttle = null;
        // Don't persist the transient offsets produced by our own restore.
        if (restoring) return;
        try { sessionStorage.setItem(storageKey, String(getTop(el))); } catch { /* ignore */ }
      }, SAVE_THROTTLE_MS);
    };
    target.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      target.removeEventListener('scroll', onScroll);
      timers.forEach(clearTimeout);
      if (throttle) clearTimeout(throttle);
    };
  }, [key, preferredSelector]);
}
