import { useMemo } from 'react';
import { MUSCLE_META } from '../../data/constants';
import { getMuscleColor } from '../../utils/xp';
import { MUSCLE_OPTS, EQUIP_OPTS } from './exerciseFilterOptions';
import { matchesFacets, matchesAll, facetCounts, muscleKeys, typeKeys, equipKeys, NO_FACET } from './matchesFacets';
import { DISCOVER_CATEGORY_GROUPS, DISCOVER_CATEGORIES_BY_KEY } from './discoverCategories';

/**
 * Memoized derivations for the exercise library tab.
 *
 * Lifted from inline IIFE computations in App.jsx (Finding #5 of the perf
 * audit, see docs/performance-audit.md). The 1500+ exercise list was being
 * scanned multiple times per render — including unrelated re-renders driven
 * by xpFlash, toast, friendExBanner, etc. Each useMemo lists the actual
 * deps so the heavy work only runs when those change.
 *
 * Lives under src/features/exercises/ to start the audit's recommended
 * features/ tree. The library tab UI extraction (ExerciseLibraryTab.jsx)
 * will land here in a follow-up PR.
 *
 * Deps come in as a single options object so the call site can read like
 * the previous useUiState destructure pattern. Each dep is a primitive or
 * a Set/array referenced by identity; React's useMemo handles invalidation.
 */

// Re-exported for the call sites that already imported them from here.
export const LIB_ALL_MUSCLE_OPTS = MUSCLE_OPTS;
export const LIB_ALL_EQUIP_OPTS = EQUIP_OPTS;

// Training recency buckets, in days since the muscle group was last worked.
// "cold" is the fog: never trained, or long enough ago that it no longer
// counts toward anything.
const MUSCLE_HEAT = [
  { state: 'hot', maxDays: 3 },
  { state: 'warm', maxDays: 7 },
  { state: 'fading', maxDays: 14 },
];
const MUSCLE_VOLUME_WINDOW_DAYS = 14;

export function useExerciseFilters({
  allExercises,
  _exReady,
  exerciseLog,
  discoverPicks,
  libSearchDebounced,
  libTypeFilters,
  libMuscleFilters,
  libEquipFilters,
}) {

  // Single-pass per-muscle count index. Replaces the 12 separate
  // allExercises.filter passes the old MUSCLE_CARD_DATA did per render.
  const libMuscleCountsByGroup = useMemo(() => {
    const counts = new Map();
    for (const ex of allExercises) {
      const mg = (ex.muscleGroup || "").toLowerCase().trim();
      if (!mg) continue;
      counts.set(mg, (counts.get(mg) || 0) + 1);
    }
    return counts;
  }, [allExercises]);

  const libMuscleCardData = useMemo(() => LIB_ALL_MUSCLE_OPTS.filter(m => m !== "full_body").map(mg => {
    const meta = MUSCLE_META[mg] || {
      emoji: "💪",
      label: mg.charAt(0).toUpperCase() + mg.slice(1),
      icon: "game-icons:weight-lifting-up"
    };
    return {
      mg,
      label: meta.label,
      emoji: meta.emoji,
      icon: meta.icon,
      count: libMuscleCountsByGroup.get(mg) || 0,
      color: getMuscleColor(mg)
    };
  }).filter(d => d.count > 0), [libMuscleCountsByGroup]);

  // Library tab — main filtered list (search + type + muscle + equip).
  const libFiltered = useMemo(() => {
    const q2 = libSearchDebounced.toLowerCase().trim();
    return allExercises.filter(ex => {
      if (q2 && !ex.name.toLowerCase().includes(q2)) return false;
      return matchesFacets(ex, libMuscleFilters, libTypeFilters, libEquipFilters);
    });
  }, [allExercises, libSearchDebounced, libTypeFilters, libMuscleFilters, libEquipFilters]);

  // Faceted counts — for each dimension, how many exercises each option would
  // yield given the search and the OTHER two dimensions (a facet never
  // constrains itself, which is what makes multi-select within a dimension
  // read as OR). Counting instead of just testing presence lets the dropdown
  // show "Barbell 212" and grey out the options that would empty the list,
  // so a zero-result filter combination is visible before it's committed
  // rather than after.
  //
  // Each pass is a single walk over allExercises, same cost as the presence-
  // only Sets these replaced. The Sets are derived from the count maps so
  // existing callers keep working.
  // Each pass is a single walk; the shared facetCounts/keys helpers keep the
  // definition of "what counts as this facet" identical across the library,
  // the workout builder and the plan wizard.
  const libMuscleCounts = useMemo(
    () => facetCounts(allExercises, muscleKeys, ex => matchesAll(ex, libSearchDebounced, NO_FACET, libTypeFilters, libEquipFilters)),
    [allExercises, libSearchDebounced, libTypeFilters, libEquipFilters]
  );
  const libEquipCounts = useMemo(
    () => facetCounts(allExercises, equipKeys, ex => matchesAll(ex, libSearchDebounced, libMuscleFilters, libTypeFilters, NO_FACET)),
    [allExercises, libSearchDebounced, libMuscleFilters, libTypeFilters]
  );
  const libTypeCounts = useMemo(
    () => facetCounts(allExercises, typeKeys, ex => matchesAll(ex, libSearchDebounced, libMuscleFilters, NO_FACET, libEquipFilters)),
    [allExercises, libSearchDebounced, libMuscleFilters, libEquipFilters]
  );

  // Cascading availability — kept as Sets for callers that only need a yes/no.
  const libAvailableMuscles = useMemo(() => new Set(libMuscleCounts.keys()), [libMuscleCounts]);
  const libAvailableEquip = useMemo(() => new Set(libEquipCounts.keys()), [libEquipCounts]);
  const libAvailableTypes = useMemo(() => new Set(libTypeCounts.keys()), [libTypeCounts]);

  // Visible filter pill sets — kept selectable if either available given
  // current other filters, OR already in the user's selection.
  const libMuscleOpts = useMemo(() =>
    LIB_ALL_MUSCLE_OPTS.filter(m => libAvailableMuscles.has(m) || libMuscleFilters.has(m)),
    [libAvailableMuscles, libMuscleFilters]
  );
  const libEquipOpts = useMemo(() =>
    LIB_ALL_EQUIP_OPTS.filter(e => libAvailableEquip.has(e) || libEquipFilters.has(e)),
    [libAvailableEquip, libEquipFilters]
  );

  // Per-muscle training heat — how recently and how hard each group was
  // worked. "What should I train today?" is currently a question you answer
  // from memory; this turns it into something the tab can show. Consumed by
  // the torch strip on the home view, and the data layer an anatomy map
  // would sit on.
  const libMuscleMapData = useMemo(() => {
    const now = Date.now();
    const byGroup = new Map(); // mg -> { lastMs, sets }
    const windowMs = MUSCLE_VOLUME_WINDOW_DAYS * 86400000;

    for (const entry of exerciseLog || []) {
      const ex = allExercises.find(e => e.id === entry.exId);
      const mg = (ex && ex.muscleGroup || '').toLowerCase().trim();
      if (!mg) continue;
      const t = entry.dateKey ? new Date(entry.dateKey).getTime() : NaN;
      if (!Number.isFinite(t)) continue;
      const rec = byGroup.get(mg) || { lastMs: 0, sets: 0 };
      if (t > rec.lastMs) rec.lastMs = t;
      if (now - t <= windowMs) rec.sets += parseInt(entry.sets) || 1;
      byGroup.set(mg, rec);
    }

    const peak = Math.max(1, ...[...byGroup.values()].map(v => v.sets));

    return LIB_ALL_MUSCLE_OPTS.filter(m => m !== 'full_body').map(mg => {
      const meta = MUSCLE_META[mg] || { emoji: '💪', label: mg.charAt(0).toUpperCase() + mg.slice(1) };
      const rec = byGroup.get(mg);
      const days = rec ? Math.max(0, Math.floor((now - rec.lastMs) / 86400000)) : null;
      const bucket = days == null ? null : MUSCLE_HEAT.find(b => days <= b.maxDays);
      return {
        mg,
        label: meta.label,
        emoji: meta.emoji,
        color: getMuscleColor(mg),
        daysSinceTrained: days,
        // 0..1, relative to the busiest group — an absolute set count means
        // nothing without knowing the rest of the week.
        volume: rec ? Math.min(1, rec.sets / peak) : 0,
        state: bucket ? bucket.state : 'cold',
      };
    // Coldest first: the whole point is surfacing what you have been avoiding.
    }).sort((a, b) => (b.daysSinceTrained ?? Infinity) - (a.daysSinceTrained ?? Infinity));
  }, [exerciseLog, allExercises]);

  // Library home view — discover rows, driven by the user's 3 picked
  // categories (profile.libDiscoverPicks) rather than a hardcoded list, so
  // the customize menu can swap what shows without touching this hook.
  // Equipment/muscle categories need the Supabase merge to have landed
  // (_exReady) before their counts mean anything; a pick made before then
  // just yields an empty row, same as the old gated rows did.
  const libDiscoverRows = useMemo(() => {
    if (!_exReady) return [];
    return (discoverPicks || [])
      .map(key => DISCOVER_CATEGORIES_BY_KEY[key])
      .filter(Boolean)
      .map(cat => ({
        key: cat.key,
        label: cat.label,
        seeAll: cat.seeAll || null,
        exercises: allExercises.filter(cat.match).slice(0, 15),
      }));
  }, [allExercises, _exReady, discoverPicks]);

  // Every candidate category's count against the current catalog, for the
  // customize menu to show alongside each option — computed once per
  // catalog change rather than per dropdown open.
  const libDiscoverCategoryCounts = useMemo(() => {
    const counts = new Map();
    if (!_exReady) return counts;
    for (const group of DISCOVER_CATEGORY_GROUPS) {
      for (const cat of group.categories) {
        let n = 0;
        for (const ex of allExercises) if (cat.match(ex)) n++;
        counts.set(cat.key, n);
      }
    }
    return counts;
  }, [allExercises, _exReady]);

  return {
    libFiltered,
    libAvailableMuscles,
    libAvailableEquip,
    libAvailableTypes,
    libMuscleCounts,
    libEquipCounts,
    libTypeCounts,
    libMuscleCountsByGroup,
    libMuscleCardData,
    libMuscleMapData,
    libDiscoverRows,
    libDiscoverCategoryCounts,
    libMuscleOpts,
    libEquipOpts,
  };
}
