import { calcExXP } from './xp';
import { kgToLbs, kmToMi } from './units';
import { combineHHMMSec } from './time';

// ─── Quick-log row planner ─────────────────────────────────────────────────────
// THE single source of set-row math for the quick log ("Set Forge"). The modal's
// Projected-XP figure and logExercise's written entries both consume this plan,
// so what the user sees is what gets logged — by construction, not by parity
// discipline. Inputs are the RAW quick-log form fields (display units, string
// state); output rows carry canonical record values (lbs/mi) plus the per-row
// pre-bonus XP (class multiplier included via calcExXP; travel/region/gear are
// logging-time seams applied by the caller).
//
// XP rules are the estimator's historical contract:
//   • every row (primary and extra) is priced with the PRIMARY weight —
//     the weight bonus saturates and extras inherit the working load
//   • extraCount (number of extra rows) is passed to every calcExXP call
//   • an extra row's blank sets/reps inherit the primary values
//   • extra-row distance falls back to the primary distance for pricing
export function planQuickLogRows({
  exId,
  category,
  noSets,
  chosenClass,
  allExById,
  sets,
  reps,
  exWeight,
  exHHMM,
  exSec,
  distanceVal,
  quickRows,
  metric,
  hrZone = null,
}) {
  const timed = category === 'cardio' || category === 'flexibility';
  const rowsIn = quickRows || [];
  const extraCount = rowsIn.length;

  const sv = noSets ? 1 : parseInt(sets) || 0;
  const rv = timed
    ? Math.max(1, Math.floor(combineHHMMSec(exHHMM || '', exSec || '') / 60) || parseInt(reps) || 1)
    : parseInt(reps) || 0;

  const rawW = parseFloat(exWeight || 0);
  const effW = metric ? parseFloat(kgToLbs(rawW) || 0) : rawW;

  const rawDist = parseFloat(distanceVal || 0);
  const distMi = rawDist > 0 ? (metric ? parseFloat(kmToMi(rawDist)) : rawDist) : null;

  const toLbs = v => {
    const n = parseFloat(v);
    if (!n) return null;
    return metric ? parseFloat(kgToLbs(n)) : n;
  };
  const toMi = v => {
    const n = parseFloat(v);
    if (!(n > 0)) return null;
    return metric ? parseFloat(kmToMi(n)) : n;
  };

  const rows = [
    {
      primary: true,
      sets: sv,
      reps: rv,
      weightLbs: effW || null,
      distanceMi: distMi,
      xp: calcExXP(exId, sv, rv, chosenClass, allExById, distMi || null, effW || null, hrZone, extraCount),
    },
    ...rowsIn.map(row => {
      const rs = noSets ? 1 : parseInt(row.sets) || sv;
      const rr = timed
        ? Math.max(1, Math.floor(combineHHMMSec(row.hhmm || '', row.sec || '') / 60)) || rv
        : parseInt(row.reps) || rv;
      const rowDistMi = toMi(row.dist);
      return {
        primary: false,
        sets: rs,
        reps: rr,
        weightLbs: toLbs(row.weightLbs),
        distanceMi: rowDistMi,
        xp: calcExXP(exId, rs, rr, chosenClass, allExById, rowDistMi || distMi || null, effW || null, hrZone, extraCount),
      };
    }),
  ];

  return {
    rows,
    extraCount,
    totalXP: rows.reduce((s, r) => s + r.xp, 0),
    sv,
    rv,
    effW,
    distMi,
  };
}
