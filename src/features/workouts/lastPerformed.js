import { entryTime } from '../exercises/logEntryTime';

/**
 * "What did I do last time?" — an index over the workout log, keyed by
 * exercise, used to prefill the builder.
 *
 * Building a nine-exercise workout used to cost a picker round-trip plus
 * three typed numbers per exercise, from zero, every time — even for a
 * bench press you have logged forty times at the same weight. The numbers
 * were already in `profile.log`; nothing was reading them.
 *
 * ── Why not just take the first match in the array ──────────────────────
 * `profile.log` is *mostly* newest-first, because every writer prepends
 * (useWorkoutCompletion, the App.jsx log paths, PlansTabContainer). It is not
 * reliably so:
 *   • HistoryTab restores a deleted entry with [...log, restored] — appended.
 *   • An entry can be logged against a PAST date and is still prepended.
 * So array position means "most recently written", not "most recently
 * performed". Recency comes from entryTime(), which already exists for
 * exactly this reason and handles entries predating the `loggedAt` field.
 *
 * ── Cost ────────────────────────────────────────────────────────────────
 * One pass, same cost class as calcExercisePBs, memoised on `profile.log`
 * identity. Since every write replaces that array, it recomputes once per
 * log write rather than once per render.
 */
export function buildLastPerformedIndex(log) {
  const index = new Map();
  for (const e of log || []) {
    if (!e || !e.exId) continue;
    const at = entryTime(e);
    if (!Number.isFinite(at)) continue;
    const prev = index.get(e.exId);
    if (!prev || at > prev.at) index.set(e.exId, { at, entry: e });
  }
  return index;
}

// Three weeks. Past this, bodyweight and strength have usually moved enough
// that silently reusing the old numbers would be putting words in the user's
// mouth — so the row still prefills, but it says how old the figures are and
// offers one tap to clear them.
export const STALE_AFTER_MS = 21 * 86400000;

const DAY = 86400000;

/**
 * The prefill for one exercise, or null when there is no usable history.
 *
 * Returning null rather than a zero-filled object is deliberate: the caller
 * must be able to tell "we know what you did" from "we are guessing", so it
 * can render a real value versus a placeholder. Fabricated numbers that look
 * like recalled ones are worse than an empty field.
 */
export function lastPerformed(index, exId, now = Date.now()) {
  const hit = index && index.get(exId);
  if (!hit) return null;

  const e = hit.entry;
  const sets = parseInt(e.sets, 10);
  const reps = parseInt(e.reps, 10);
  // An entry with no usable sets/reps (a pure cardio row, say) has nothing to
  // prefill a sets/reps grid with, so it counts as no history at all.
  if (!Number.isFinite(sets) || !Number.isFinite(reps) || sets <= 0 || reps <= 0) return null;

  const weight = parseFloat(e.weightLbs);
  const ageMs = Math.max(0, now - hit.at);

  return {
    sets: String(sets),
    reps: String(reps),
    weightLbs: Number.isFinite(weight) && weight > 0 ? String(weight) : '',
    at: hit.at,
    ageDays: Math.floor(ageMs / DAY),
    stale: ageMs > STALE_AFTER_MS,
  };
}

/** "today" / "yesterday" / "5d ago" / "3w ago" — for the row's provenance line. */
export function agoLabel(ageDays) {
  if (!Number.isFinite(ageDays)) return '';
  if (ageDays <= 0) return 'today';
  if (ageDays === 1) return 'yesterday';
  if (ageDays < 21) return `${ageDays}d ago`;
  if (ageDays < 365) return `${Math.round(ageDays / 7)}w ago`;
  return `${Math.round(ageDays / 365)}y ago`;
}
