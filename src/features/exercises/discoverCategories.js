import { MUSCLE_META } from '../../data/constants';
import { EQUIP_OPTS, equipLabel, MUSCLE_OPTS } from './exerciseFilterOptions';

/**
 * The full pool of Library-home "discover" carousel categories, nested by
 * kind for the customize menu. Replaces the old hardcoded 5-row list in
 * useExerciseFilters — the home screen now shows whichever 3 of these the
 * user picked (profile.libDiscoverPicks), defaulting to DEFAULT_DISCOVER_PICKS.
 *
 * `match` is the row's exercise predicate. `onSeeAll` describes how "See
 * All →" should hand off to the filtered view: a facet-based category
 * (equipment/muscle) pre-applies that facet; a computed one (difficulty,
 * which has no facet in the filter system) just jumps to the filtered view
 * as-is, same as the old Beginner Friendly/Advanced Challenges rows did.
 */

const byBaseXP = (min, max) => ex => {
  const xp = ex.baseXP || 0;
  return xp >= min && xp < max;
};

export const DISCOVER_CATEGORY_GROUPS = [
  {
    group: "By Difficulty",
    categories: [
      { key: "diff:beginner", label: "Beginner Friendly", match: byBaseXP(0, 45) },
      { key: "diff:intermediate", label: "Intermediate", match: byBaseXP(45, 60) },
      { key: "diff:advanced", label: "Advanced Challenges", match: byBaseXP(60, Infinity) },
    ],
  },
  {
    group: "By Equipment",
    categories: EQUIP_OPTS.map(eq => ({
      key: `equip:${eq}`,
      label: eq === "bodyweight" ? "Bodyweight Only" : eq === "barbell" ? "Barbell Essentials" : `${equipLabel(eq)} Exercises`,
      match: ex => (ex.equipment || "bodyweight").toLowerCase().trim() === eq,
      seeAll: { kind: "equip", value: eq },
    })),
  },
  {
    group: "By Muscle",
    categories: MUSCLE_OPTS.filter(m => m !== "full_body").map(mg => ({
      key: `muscle:${mg}`,
      label: `${(MUSCLE_META[mg] && MUSCLE_META[mg].label) || mg} Focus`,
      match: ex => (ex.muscleGroup || "").toLowerCase().trim() === mg,
      seeAll: { kind: "muscle", value: mg },
    })),
  },
];

export const DISCOVER_CATEGORIES_BY_KEY = Object.fromEntries(
  DISCOVER_CATEGORY_GROUPS.flatMap(g => g.categories).map(c => [c.key, c])
);

// Mirrors exactly what used to show once Beginner Friendly was removed from
// the old hardcoded 5-row list: Advanced Challenges never actually clears
// the >=3-exercise bar on this catalog (baseXP tops out in the 50s), so
// defaulting to it would open every new profile on an empty slot.
export const DEFAULT_DISCOVER_PICKS = ["equip:bodyweight", "equip:dumbbell", "equip:barbell"];

export const DISCOVER_PICK_COUNT = 3;
