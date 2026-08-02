// ─── Repeat Last derivation ────────────────────────────────────────────────────
// Rebuilds the user's most recent completed workout session from the log so the
// orb's "Repeat Last" can clone it as a live session. No new persisted state:
// workout completions already stamp every row with sourceGroupId (one batch id
// per confirmWorkoutComplete) plus sourceWorkoutId/Name/Icon, and a batch's
// rows sit contiguously in the newest-first log — primary row first, extra
// (progressive-weight) rows after, per exercise, in workout order.
//
// Fallback for legacy entries that predate sourceGroupId: same workout id on
// the same dateKey approximates the session. Solo quick logs never carry
// source* fields and are deliberately not "sessions".

function buildFromRows(rows, head) {
  const byEx = new Map();
  for (const r of rows) {
    if (!r || !r.exId) continue;
    if (!byEx.has(r.exId)) byEx.set(r.exId, []);
    byEx.get(r.exId).push({
      sets: parseInt(r.sets) || 3,
      reps: parseInt(r.reps) || 10,
      weightLbs: r.weightLbs != null ? r.weightLbs : null,
      // Every dimension a completion can persist (workout completions write
      // distanceMi/hrZone; solo Set Forge rows write distanceMi/seconds via
      // sourceDurationSec on the primary) carried through — this used to
      // hard-code distance/zone to null and drop seconds outright, so
      // repeating a run, cardio interval, or timed workout silently
      // produced a different prescription and a different XP total.
      distanceMi: r.distanceMi != null ? r.distanceMi : null,
      hrZone: r.hrZone != null ? r.hrZone : null,
      seconds: r.seconds != null ? r.seconds : null,
    });
  }
  const exercises = [];
  for (const [exId, exRows] of byEx.entries()) {
    const [primary, ...extras] = exRows;
    exercises.push({
      exId,
      sets: primary.sets,
      reps: primary.reps,
      weightLbs: primary.weightLbs,
      weightPct: 100,
      distanceMi: primary.distanceMi,
      hrZone: primary.hrZone,
      seconds: primary.seconds,
      ...(extras.length ? { extraRows: extras } : {}),
    });
  }
  if (exercises.length === 0) return null;
  return {
    workout: {
      id: head.sourceWorkoutId || "repeat-last",
      name: head.sourceWorkoutName || "Last Session",
      icon: head.sourceWorkoutIcon || "↺",
      desc: "",
      exercises,
      oneOff: true,
      durationMin: null,
      activeCal: null,
      totalCal: null,
    },
    completedOn: head.dateKey || null,
  };
}

// log is newest-first (entries are prepended on completion).
export function deriveLastSession(log) {
  for (const e of log || []) {
    if (!e) continue;
    if (e.sourceGroupId) {
      return buildFromRows(
        (log || []).filter(x => x && x.sourceGroupId === e.sourceGroupId),
        e
      );
    }
    if (e.sourceWorkoutId) {
      // Legacy rows predate sourceGroupId, so workoutId+dateKey is the best
      // available proxy for "one completion" — but two SEPARATE completions
      // of the same workout on the same day would also match that pair,
      // fabricating a merged session with duplicated exercises folded into
      // extraRows. Every row within one real completion shares the exact
      // `time` stamp (confirmWorkoutComplete computes it once, outside the
      // per-row map), so require it too; two completions logged in the same
      // day but different minutes now correctly stay separate.
      return buildFromRows(
        (log || []).filter(x => x && x.sourceWorkoutId === e.sourceWorkoutId && x.dateKey === e.dateKey && x.time === e.time),
        e
      );
    }
  }
  return null;
}
