import { C } from '../../utils/tokens';

/**
 * Exercise difficulty colors — one home. These hexes were triplicated as a
 * map in ExerciseRow and as inline ternaries in ExerciseDetailSheet and
 * MyWorkoutsSubTab, which is exactly how the app's other option lists
 * drifted (see matchesFacets.js). Unknown/missing difficulty renders as
 * Intermediate, matching every prior call site.
 */
export const DIFF_FG = {
  Advanced: C.diffAdvanced,
  Beginner: C.diffBeginner,
  Intermediate: C.diffIntermediate,
};

export const DIFF_BG = {
  Advanced: C.diffBgAdvanced,
  Beginner: C.diffBgBeginner,
  Intermediate: C.diffBgIntermediate,
};

export const diffColor = difficulty => DIFF_FG[difficulty] || DIFF_FG.Intermediate;
export const diffBg = difficulty => DIFF_BG[difficulty] || DIFF_BG.Intermediate;
