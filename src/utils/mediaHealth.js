// ─── Media self-quarantine ─────────────────────────────────────────────────────
// Shared verdict for "this device can't handle heavy ambient media". The first
// consumer is the Forge Glass backdrop video; future rich media (cinematics,
// preview loops) should reuse the same tombstone so one bad experience silences
// them all. Mirrors the world safe-mode ladder's philosophy: degrade once,
// persistently, per device — never re-jank on every visit.

const QUARANTINE_KEY = "aurisar.ambient.quarantine.v1";

export function isMediaQuarantined() {
  try {
    return !!localStorage.getItem(QUARANTINE_KEY);
  } catch {
    return false;
  }
}

export function quarantineMedia(reason) {
  try {
    localStorage.setItem(QUARANTINE_KEY, JSON.stringify({ at: new Date().toISOString(), reason }));
  } catch {
    /* storage unavailable — session-only degradation still happens via state */
  }
}

export function clearMediaQuarantine() {
  try {
    localStorage.removeItem(QUARANTINE_KEY);
  } catch {
    /* ignore */
  }
}

// Watches a <video> element's playback quality once, `delayMs` after mount.
// Calls onVerdict({ ok, dropped, total }); never throws. Returns a cleanup
// function. Devices whose browser lacks getVideoPlaybackQuality are left
// unjudged (no quarantine) — absence of evidence is not jank.
export function probeVideoHealth(videoEl, onVerdict, { delayMs = 10000, maxDroppedRatio = 0.25, minTotal = 40 } = {}) {
  if (!videoEl || typeof videoEl.getVideoPlaybackQuality !== "function") return () => {};
  const timer = setTimeout(() => {
    try {
      const q = videoEl.getVideoPlaybackQuality();
      const total = q.totalVideoFrames || 0;
      const dropped = q.droppedVideoFrames || 0;
      if (total >= minTotal) onVerdict({ ok: dropped / total <= maxDroppedRatio, dropped, total });
    } catch {
      /* verdict skipped */
    }
  }, delayMs);
  return () => clearTimeout(timer);
}
