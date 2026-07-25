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
 * The single award-time seam every XP-granting log path routes through, so the
 * gear boost is applied and recorded identically everywhere (completion flow,
 * quick-log, solo-log, plan-day). Given the honest pre-gear XP for one exercise
 * — class/travel/region bonuses already folded in — returns the fields to
 * persist on the log entry:
 *   { xp, perkMult, baseXp? }
 * When no perk applies, xp === preGearXp, perkMult === 1, and baseXp is omitted
 * so a non-boosted entry stays byte-identical to before this feature. When a
 * perk applies, baseXp carries the pre-gear figure so a later server recompute
 * can verify/strip the boost (invariant: xp === round(baseXp × perkMult)).
 * @param {number} preGearXp honest XP before the gear factor
 * @param {object} perks aggregated perk table (profile.equipPerks)
 * @param {{exId?:string, category?:string, muscleGroup?:string}} ex
 * @returns {{xp:number, perkMult:number, baseXp?:number}}
 */
export function perkAward(preGearXp, perks, ex) {
  const m = perkMultiplier(perks, ex);
  if (m === 1) return { xp: preGearXp, perkMult: 1 };
  return { xp: Math.round(preGearXp * m), perkMult: m, baseXp: preGearXp };
}

/**
 * Edit-time recompute: re-apply the multiplier that was STORED on a log entry
 * when it was first logged, to a freshly-recomputed base XP. Editing an
 * entry's sets/reps must preserve the gear boost that was active that day —
 * not silently strip it (a surprise XP drop) nor re-read today's loadout
 * (which would rewrite history). Clamped to the same cap; a missing/≤1 stored
 * factor is a no-op, so non-perk entries are untouched.
 * @param {number} baseXp freshly-recomputed calcExXP for the edited entry
 * @param {number|undefined} storedPerkMult entry.perkMult from when it was logged
 */
export function applyStoredPerk(baseXp, storedPerkMult) {
  const pm = storedPerkMult;
  if (typeof pm !== 'number' || !Number.isFinite(pm) || pm <= 1) return baseXp;
  return Math.round(baseXp * Math.min(pm, PERK_CAP));
}
