import { calcExXP } from '../../utils/xp';

/**
 * Shape a save-to-plan entry the wizard can actually render and save.
 *
 * The wizard displays `sets × reps · weight + xp` per row and persists the
 * same fields. An entry carrying only a name therefore rendered as
 * "undefined×undefined +undefined XP" and then saved a flat 3×10, discarding
 * the exercise's own defaults. The cart path was fixed for this in the #260
 * review; the detail sheet and the quick-log sheet had the same defect.
 */
export function planEntry(ex, chosenClass, allExById) {
  const sets = ex.defaultSets != null ? ex.defaultSets : 3;
  const reps = ex.defaultReps != null ? ex.defaultReps : 10;
  return {
    exId: ex.id,
    exercise: ex.name,
    icon: ex.icon,
    sets,
    reps,
    weightLbs: ex.defaultWeightLbs || null,
    xp: calcExXP(ex.id, sets, reps, chosenClass, allExById),
    _idx: ex.id,
  };
}
