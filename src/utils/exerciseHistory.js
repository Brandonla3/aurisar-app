// Per-exercise history derived from the newest-first profile.log. One
// completed Set Forge submission (primary + any progressive extra rows) is
// one SESSION, not one point per row — a multi-row pyramid must not fill
// several History bars for a single workout. Rows are grouped by
// sourceGroupId (the receipt every completion now stamps its rows with);
// the session's displayed sets/reps/weight come from its primary (first
// encountered, since the log is newest-first and a batch's primary row is
// always written first) row, and its XP is the group's total. Legacy rows
// that predate sourceGroupId — or any row logged without one — are treated
// as their own one-row session, matching Repeat Last's own conservative
// fallback for the same gap.
export function getExerciseHistory(log, exId, limit = 8) {
  const rows = [];
  const seenGroups = new Set();
  for (const e of log || []) {
    if (!e || e.exId !== exId) continue;
    if (e.sourceGroupId) {
      if (seenGroups.has(e.sourceGroupId)) continue;
      seenGroups.add(e.sourceGroupId);
      const groupXP = (log || []).reduce((s, x) => (x && x.sourceGroupId === e.sourceGroupId ? s + (x.xp || 0) : s), 0);
      rows.push({
        dateKey: e.dateKey || null,
        sets: parseInt(e.sets) || 0,
        reps: parseInt(e.reps) || 0,
        weightLbs: e.weightLbs != null ? e.weightLbs : null,
        xp: groupXP,
      });
    } else {
      rows.push({
        dateKey: e.dateKey || null,
        sets: parseInt(e.sets) || 0,
        reps: parseInt(e.reps) || 0,
        weightLbs: e.weightLbs != null ? e.weightLbs : null,
        xp: e.xp || 0,
      });
    }
    if (rows.length >= limit) break;
  }
  rows.reverse();
  return rows;
}
