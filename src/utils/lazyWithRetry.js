import React from 'react';

// Recovers from React.lazy chunk-load failures that happen when a user's
// already-loaded index.html references a chunk hash that no longer exists
// (e.g. after a fresh deploy renamed the file). The browser fetches the
// stale URL, gets Netlify's SPA-fallback index.html, and rejects the
// dynamic import with a MIME-type error.
//
// On the first chunk error in a session, we force a full reload so the
// browser picks up the new index.html with the current chunk hashes. A
// timestamp in sessionStorage guards against an infinite reload loop if
// the chunk is genuinely broken — after RETRY_WINDOW_MS the timestamp
// ages out and we'll try again on a subsequent navigation.

const RETRY_KEY = 'aurisar:chunkRetryAt';
const RETRY_WINDOW_MS = 10_000;

export function isChunkLoadError(err) {
  if (!err) return false;
  if (err.name === 'ChunkLoadError') return true;
  const msg = String(err.message || err);
  return /Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|not a valid JavaScript MIME type|module script failed|Unable to load module|was rejected because/i.test(msg);
}

function recentlyRetried() {
  try {
    const t = Number(sessionStorage.getItem(RETRY_KEY));
    return Number.isFinite(t) && Date.now() - t < RETRY_WINDOW_MS;
  } catch {
    return false;
  }
}

function markRetry() {
  try {
    sessionStorage.setItem(RETRY_KEY, String(Date.now()));
  } catch {
    /* private mode / storage disabled — proceed without the guard */
  }
}

export function lazyWithRetry(importer) {
  return React.lazy(() =>
    importer().catch(err => {
      if (isChunkLoadError(err) && !recentlyRetried() && typeof window !== 'undefined') {
        console.warn('[Aurisar] stale chunk — reloading once:', err?.message);
        markRetry();
        window.location.reload();
        // Never resolve so Suspense keeps showing its fallback until the
        // reload navigates away — avoids a flash of the ErrorBoundary card.
        return new Promise(() => {});
      }
      throw err;
    })
  );
}
