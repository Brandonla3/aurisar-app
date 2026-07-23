/**
 * What "filtered by X" means, in one place.
 *
 * Three surfaces filter the same catalog — the library tab, the workout
 * builder picker, and the plan wizard — and each had grown its own copy of
 * this predicate plus its own option lists. They drifted, repeatedly and
 * invisibly: the builder picker was missing `full_body` and four exercise
 * types, the equipment facet was missing three values, and the plan wizard
 * was missing `tricep` and `full_body` — 188 exercises it could not filter to.
 *
 * The rule: OR within a facet (chest OR back), AND across facets (chest AND
 * barbell). An empty facet means "no constraint", not "nothing matches".
 */

/** True if the exercise satisfies all three facet sets. */
export function matchesFacets(ex, muscleSet, typeSet, equipSet) {
  if (!ex || ex.id === "rest_day") return false;

  if (muscleSet && muscleSet.size) {
    if (!muscleSet.has((ex.muscleGroup || "").toLowerCase().trim())) return false;
  }
  if (typeSet && typeSet.size) {
    const types = (ex.exerciseType || "").toLowerCase();
    const cat = (ex.category || "").toLowerCase();
    if (![...typeSet].some(t => types.includes(t) || cat === t)) return false;
  }
  if (equipSet && equipSet.size) {
    if (!equipSet.has((ex.equipment || "bodyweight").toLowerCase().trim())) return false;
  }
  return true;
}

/** Case-insensitive substring match on the exercise name. */
export const matchesSearch = (ex, query) => {
  const q = (query || "").toLowerCase().trim();
  return !q || (ex.name || "").toLowerCase().includes(q);
};

/** The two combined — what every list actually wants. */
export const matchesAll = (ex, query, muscleSet, typeSet, equipSet) =>
  matchesFacets(ex, muscleSet, typeSet, equipSet) && matchesSearch(ex, query);

/**
 * Per-option result counts for one facet, given the search and the *other*
 * facets. A facet never constrains itself — that is what makes multi-select
 * within a facet read as OR — so the count answers "how many results would
 * this option leave", which is what lets a dropdown grey out the choices that
 * would empty the list.
 *
 * `keysOf` returns the facet values an exercise contributes to; an exercise
 * can carry several type tags, so it returns an array.
 */
export function facetCounts(exercises, keysOf, predicate) {
  const counts = new Map();
  for (const ex of exercises) {
    if (!predicate(ex)) continue;
    for (const key of keysOf(ex)) {
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

/**
 * The "no constraint" facet, for callers computing a facet's own counts.
 * Module-scope so its identity is stable across renders — a `new Set()` built
 * inside a component would be a fresh dependency on every pass.
 */
export const NO_FACET = Object.freeze(new Set());

/** Facet key extractors, so callers don't re-derive them inconsistently. */
export const muscleKeys = ex => [(ex.muscleGroup || "").toLowerCase().trim()];
export const equipKeys = ex => [(ex.equipment || "bodyweight").toLowerCase().trim()];
export const typeKeys = ex => {
  const tags = new Set(
    (ex.exerciseType || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean)
  );
  const cat = (ex.category || "").toLowerCase();
  if (cat) tags.add(cat);
  return [...tags];
};
