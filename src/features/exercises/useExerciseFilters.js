import { useMemo } from 'react';
import { MUSCLE_META } from '../../data/constants';
import { getMuscleColor } from '../../utils/xp';

/**
 * Memoized derivations for the exercise library + grimoire grid.
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

export const LIB_ALL_MUSCLE_OPTS = ["chest", "back", "shoulder", "bicep", "tricep", "legs", "glutes", "abs", "calves", "forearm", "full_body", "cardio"];
export const LIB_ALL_EQUIP_OPTS = ["barbell", "dumbbell", "kettlebell", "cable", "machine", "bodyweight", "band"];

// Pure filter — checks all three filter sets (OR within each, AND across).
function libMatchesFilters(ex, tF, mF, eF) {
  if (tF.size > 0) {
    const types = (ex.exerciseType || "").toLowerCase();
    const cat = (ex.category || "").toLowerCase();
    if (![...tF].some(t => types.includes(t) || cat === t)) return false;
  }
  if (mF.size > 0) {
    const mg = (ex.muscleGroup || "").toLowerCase().trim();
    if (!mF.has(mg)) return false;
  }
  if (eF.size > 0) {
    const eq = (ex.equipment || "bodyweight").toLowerCase().trim();
    if (!eF.has(eq)) return false;
  }
  return true;
}

export function useExerciseFilters({
  allExercises,
  _exReady,
  // grimoire grid
  exSearch,
  exCatFilters,
  exMuscleFilter,
  showFavsOnly,
  favoriteExercises,
  // library tab
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
      return libMatchesFilters(ex, libTypeFilters, libMuscleFilters, libEquipFilters);
    });
  }, [allExercises, libSearchDebounced, libTypeFilters, libMuscleFilters, libEquipFilters]);

  // Cascading availability — which muscles/equip/types are still selectable
  // given the OTHER filters. Each excludes its own filter set.
  const libAvailableMuscles = useMemo(() => new Set(
    allExercises.filter(ex => libMatchesFilters(ex, libTypeFilters, new Set(), libEquipFilters))
      .map(ex => (ex.muscleGroup || "").toLowerCase().trim()).filter(Boolean)
  ), [allExercises, libTypeFilters, libEquipFilters]);
  const libAvailableEquip = useMemo(() => new Set(
    allExercises.filter(ex => libMatchesFilters(ex, libTypeFilters, libMuscleFilters, new Set()))
      .map(ex => (ex.equipment || "bodyweight").toLowerCase().trim()).filter(Boolean)
  ), [allExercises, libTypeFilters, libMuscleFilters]);
  const libAvailableTypes = useMemo(() => new Set(
    allExercises.filter(ex => libMatchesFilters(ex, new Set(), libMuscleFilters, libEquipFilters))
      .flatMap(ex => {
        const types = (ex.exerciseType || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
        const cat = (ex.category || "").toLowerCase();
        return cat ? [...types, cat] : types;
      })
  ), [allExercises, libMuscleFilters, libEquipFilters]);

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

  // Library home view — discover rows. Each row was an independent
  // allExercises.filter() pass per render; now they're cached together.
  const libDiscoverRows = useMemo(() => {
    const rows = [
      { label: "Beginner Friendly", exercises: allExercises.filter(ex => (ex.baseXP || 0) < 45).slice(0, 15) },
      { label: "Advanced Challenges", exercises: allExercises.filter(ex => (ex.baseXP || 0) >= 60).slice(0, 15) },
    ];
    if (_exReady) {
      rows.push(
        { label: "Bodyweight Only", exercises: allExercises.filter(ex => (ex.equipment || "bodyweight").toLowerCase() === "bodyweight").slice(0, 15) },
        { label: "Dumbbell Exercises", exercises: allExercises.filter(ex => (ex.equipment || "").toLowerCase() === "dumbbell").slice(0, 15) },
        { label: "Barbell Essentials", exercises: allExercises.filter(ex => (ex.equipment || "").toLowerCase() === "barbell").slice(0, 15) },
      );
    }
    return rows;
  }, [allExercises, _exReady]);

  // Grimoire grid — separate filter state from the library tab.
  const grimoireFiltered = useMemo(() => {
    const q = exSearch.toLowerCase().trim();
    const favs = favoriteExercises || [];
    return allExercises.filter(ex =>
      (exCatFilters.size === 0 || exCatFilters.has(ex.category) || ex.secondaryCategory && exCatFilters.has(ex.secondaryCategory)) &&
      (exMuscleFilter === "All" || ex.muscleGroup === exMuscleFilter) &&
      (!showFavsOnly || favs.includes(ex.id)) &&
      (q === "" || ex.name.toLowerCase().includes(q))
    );
  }, [allExercises, exCatFilters, exMuscleFilter, showFavsOnly, favoriteExercises, exSearch]);

  return {
    grimoireFiltered,
    libFiltered,
    libAvailableMuscles,
    libAvailableEquip,
    libAvailableTypes,
    libMuscleCountsByGroup,
    libMuscleCardData,
    libDiscoverRows,
    libMuscleOpts,
    libEquipOpts,
  };
}
