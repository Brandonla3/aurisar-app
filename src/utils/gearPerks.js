/**
 * gearPerks — the fitness↔gear bridge math (Batch C2).
 *
 * Equipped world gear carries `fitnessPerks` (ItemDef.fitnessPerks): small
 * multipliers keyed by exercise id / muscleGroup / category. This module turns
 * a set of equipped items into an aggregated perk table and, at workout-logging
 * time, into a per-exercise XP multiplier — the "gear boosts your workouts"
 * mechanic that has been schematized but inert.
 *
 * Design (see docs/world-design-plan.md, Batch C):
 * - Aggregation and the multiplier are PURE and here (unit-tested); the world
 *   aggregates the player's equipped items and mirrors the result onto the
 *   Supabase profile (`profile.equipPerks`), and the fitness side applies it
 *   only at the workout-LOGGING seam — never inside calcExXP, which is also the
 *   plan/preview estimator (applying it there would inflate previews).
 * - Multiple items with the same key STACK multiplicatively (more gear = more
 *   boost), but the combined multiplier for any single exercise is hard-capped
 *   at PERK_CAP so gear can never dominate the honest workout XP.
 * - Same client-trust envelope as the existing fitnessXp sync; a server-side
 *   recompute is a later hardening item, not this change.
 */

/** Max combined gear multiplier applied to any one exercise's XP (+35%). */
export const PERK_CAP = 1.35;

const BUCKETS = ['exercises', 'muscleGroups', 'categories'];

/**
 * Merge the `fitnessPerks` of a list of equipped ItemDefs into one table.
 * Same-key factors multiply (stack). Ignores items without perks.
 * @param {Array<{fitnessPerks?: object}>} items
 * @returns {{exercises:object, muscleGroups:object, categories:object}}
 */
export function aggregateFitnessPerks(items) {
  const out = { exercises: {}, muscleGroups: {}, categories: {} };
  for (const item of items ?? []) {
    const perks = item?.fitnessPerks;
    if (!perks) continue;
    for (const bucket of BUCKETS) {
      const src = perks[bucket];
      if (!src) continue;
      for (const [key, mult] of Object.entries(src)) {
        // Gear only ever BOOSTS: reject non-finite, ≤0, and sub-1 factors so a
        // data-entry typo (0.85 vs 1.085) can never reduce honest workout XP.
        if (typeof mult !== 'number' || !Number.isFinite(mult) || mult < 1) continue;
        out[bucket][key] = (out[bucket][key] ?? 1) * mult;
      }
    }
  }
  return out;
}

/** True if a perk table has any entries (cheap guard before doing work). */
export function hasAnyPerks(perks) {
  if (!perks) return false;
  return BUCKETS.some((b) => perks[b] && Object.keys(perks[b]).length > 0);
}

/**
 * The combined gear XP multiplier for ONE exercise. Stacks the matching
 * exercise-id, muscleGroup and category factors, then clamps to PERK_CAP.
 * Returns 1 when there are no perks (the common case) so callers can multiply
 * unconditionally.
 * @param {object} perks aggregated table (from aggregateFitnessPerks / profile.equipPerks)
 * @param {{exId?:string, category?:string, muscleGroup?:string}} ex
 * @param {number} [cap=PERK_CAP]
 */
export function perkMultiplier(perks, ex, cap = PERK_CAP) {
  if (!perks || !ex) return 1;
  let f = 1;
  if (ex.exId && perks.exercises)          f *= perks.exercises[ex.exId] ?? 1;
  if (ex.muscleGroup && perks.muscleGroups) f *= perks.muscleGroups[ex.muscleGroup] ?? 1;
  if (ex.category && perks.categories)      f *= perks.categories[ex.category] ?? 1;
  // Clamp to [1, cap]: gear boosts, never reduces (floor 1), and never
  // dominates (ceiling PERK_CAP). Degenerate/NaN → 1.
  if (!Number.isFinite(f) || f < 1) return 1;
  return Math.min(f, cap);
}

/**
 * Award-time helper: the honest base XP multiplied by the gear factor for one
 * exercise, rounded. The single seam every XP-granting log path should use so
 * the boost is consistent (completion flow, quick-log, plan-day, edits).
 * @param {number} baseXp result of calcExXP (no perk)
 * @param {object} perks  aggregated perk table (profile.equipPerks)
 * @param {{exId?:string, category?:string, muscleGroup?:string}} ex
 */
export function applyPerk(baseXp, perks, ex) {
  const m = perkMultiplier(perks, ex);
  return m !== 1 ? Math.round(baseXp * m) : baseXp;
}
