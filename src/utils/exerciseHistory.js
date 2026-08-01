// Per-exercise history derived from the newest-first profile.log. Each logged
// row (primary or progressive extra) is one instance; the detail sheet's
// History subtab charts the most recent `limit`, oldest → newest.
export function getExerciseHistory(log, exId, limit = 8) {
  const rows = [];
  for (const e of log || []) {
    if (!e || e.exId !== exId) continue;
    rows.push({
      dateKey: e.dateKey || null,
      sets: parseInt(e.sets) || 0,
      reps: parseInt(e.reps) || 0,
      weightLbs: e.weightLbs != null ? e.weightLbs : null,
      xp: e.xp || 0,
    });
    if (rows.length >= limit) break;
  }
  rows.reverse();
  return rows;
}
