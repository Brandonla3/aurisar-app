/**
 * The filter vocabulary, in one place.
 *
 * These lists existed three times: `LIB_ALL_MUSCLE_OPTS` / `LIB_ALL_EQUIP_OPTS`
 * in useExerciseFilters, `TYPE_OPTS` / `TYPE_LABELS` in ExerciseLibraryTab, and
 * `PMUSCLE_OPTS` / `PTYPE_LABELS` / `PEQUIP_OPTS` in WorkoutExercisePicker —
 * and they had already drifted. The picker's muscle list was missing
 * `full_body`, and its type list was missing functional, isometric, warmup and
 * cooldown, so the same exercise was reachable from the library and invisible
 * from the workout builder depending on how you filtered.
 *
 * Anything that filters exercises imports from here.
 */

// Type labels double as the option list — order is display order.
export const TYPE_LABELS = {
  strength: "⚔️ Strength",
  cardio: "🏃 Cardio",
  flexibility: "🧘 Flexibility",
  yoga: "🧘 Yoga",
  stretching: "🌿 Stretch",
  plyometric: "⚡ Plyo",
  calisthenics: "🤸 Cali",
  functional: "🔧 Functional",
  isometric: "🧱 Isometric",
  warmup: "🌅 Warmup",
  cooldown: "🌙 Cooldown",
};
export const TYPE_OPTS = Object.keys(TYPE_LABELS);

export const MUSCLE_OPTS = [
  "chest", "back", "shoulder", "bicep", "tricep", "legs",
  "glutes", "abs", "calves", "forearm", "full_body", "cardio",
];

export const EQUIP_OPTS = [
  "barbell", "dumbbell", "kettlebell", "cable", "machine", "bodyweight", "band",
];

/** "full_body" → "Full body". Shared so the two lists label identically. */
export const muscleLabel = m => {
  const s = m.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
