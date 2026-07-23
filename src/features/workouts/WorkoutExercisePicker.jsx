import React, { memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { List } from 'react-window';
import { UI_COLORS } from '../../data/constants';
import { getMuscleColor, getTypeColor } from '../../utils/xp';
import { ExIcon } from '../../components/ExIcon';
import { S, R, FS } from '../../utils/tokens';
import ExerciseRow from '../exercises/ExerciseRow';
import FilterDropdown from '../exercises/FilterDropdown';
import {
  TYPE_OPTS, TYPE_LABELS, MUSCLE_OPTS, EQUIP_OPTS, muscleLabel, equipLabel,
} from '../exercises/exerciseFilterOptions';

/**
 * Workout exercise picker modal — extracted from the inline block in App.jsx
 * as part of Finding #6 (App.jsx decomposition) per docs/performance-audit.md
 * (PR #116).
 *
 * Single-pane UI: exercise search/filter list with multi-select Add.
 * Per-exercise configuration happens inline in the workout builder after add.
 * Uses createPortal to render into document.body.
 */

// Row adapter for the virtualised list. The row itself is the shared
// ExerciseRow — this only maps react-window's props onto it. The picker used
// to carry its own hand-written copy that had already drifted from the
// library's.
const WbExPickerRow = React.memo(function WbExPickerRow({
  ariaAttributes, index, style, exercises, selIds, onToggle
}) {
  const ex = exercises[index];
  if (!ex) return null;
  return (
    <div style={{ ...style, paddingTop: 4, paddingBottom: 4 }} {...ariaAttributes}>
      <ExerciseRow
        ex={ex}
        selected={selIds.has(ex.id)}
        selectable
        showCustomBadge
        onActivate={() => onToggle(ex.id)}
      />
    </div>
  );
});

// Same OR-within-a-facet, AND-across-facets rule the library list applies, so
// "filtered by chest" means the same thing on both surfaces.
function matchesFacets(e, mF, tF, eF) {
  if (e.id === "rest_day") return false;
  if (mF.size && !mF.has((e.muscleGroup || "").toLowerCase().trim())) return false;
  if (tF.size) {
    const ty = (e.exerciseType || "").toLowerCase();
    const ca = (e.category || "").toLowerCase();
    if (![...tF].some(t => ty.includes(t) || ca === t)) return false;
  }
  if (eF.size && !eF.has((e.equipment || "bodyweight").toLowerCase().trim())) return false;
  return true;
}

const toggleFilter = (setter, val) => setter(s => {
  const n = new Set(s);
  n.has(val) ? n.delete(val) : n.add(val);
  return n;
});

const WorkoutExercisePicker = memo(function WorkoutExercisePicker({
  // Filter state
  pickerSearch, setPickerSearch,
  pickerMuscle, setPickerMuscle,
  pickerTypeFilter, setPickerTypeFilter,
  pickerEquipFilter, setPickerEquipFilter,
  pickerOpenDrop, setPickerOpenDrop,
  // Selection state
  pickerSelected,
  // Exercise data
  allExercises,
  // Action callbacks
  closePicker,
  openExEditor,
  pickerToggleEx,
  commitPickerToWorkout,
}) {
  const closeDrops = () => setPickerOpenDrop(null);

  const q = pickerSearch.toLowerCase().trim();
  const matches = (e, mF, tF, eF) =>
    matchesFacets(e, mF, tF, eF) && (!q || e.name.toLowerCase().includes(q));

  // A facet never constrains itself, so each count answers "how many results
  // would this option leave", given the search and the other two facets.
  const facetCounts = useMemo(() => {
    const muscle = new Map(), type = new Map(), equip = new Map();
    const bump = (m, k) => k && m.set(k, (m.get(k) || 0) + 1);
    for (const e of allExercises) {
      if (matches(e, new Set(), pickerTypeFilter, pickerEquipFilter)) {
        bump(muscle, (e.muscleGroup || "").toLowerCase().trim());
      }
      if (matches(e, pickerMuscle, new Set(), pickerEquipFilter)) {
        const tags = new Set((e.exerciseType || "").toLowerCase().split(",").map(x => x.trim()).filter(Boolean));
        const ca = (e.category || "").toLowerCase();
        if (ca) tags.add(ca);
        for (const t of tags) bump(type, t);
      }
      if (matches(e, pickerMuscle, pickerTypeFilter, new Set())) {
        bump(equip, (e.equipment || "bodyweight").toLowerCase().trim());
      }
    }
    return { muscle, type, equip };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allExercises, q, pickerMuscle, pickerTypeFilter, pickerEquipFilter]);

  return createPortal(
    <div className={"ex-picker-backdrop"} onClick={e => {
      e.stopPropagation();
      closePicker();
    }}>
      <div className={"ex-picker-sheet"} onClick={e => e.stopPropagation()} style={{ maxHeight: "85vh" }}>
        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: S.s10 }}>
          <div style={{ fontFamily: "'Inter',sans-serif", fontSize: FS.lg, fontWeight: 600, color: "#8a8478" }}>
            {"Add to Workout"}
            {pickerSelected.length > 0 && (
              <span style={{ color: "#b4ac9e", marginLeft: S.s6 }}>{pickerSelected.length + " selected"}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: S.s6 }}>
            {pickerSelected.length > 0 && (
              <button className={"btn btn-gold btn-xs"} onClick={commitPickerToWorkout}>{"＋ Add " + pickerSelected.length}</button>
            )}
            <button className={"btn btn-ghost btn-xs"} onClick={() => { closePicker(); openExEditor("create", null); }}>{"✦ New Custom"}</button>
            <button className={"btn btn-ghost btn-sm"} onClick={closePicker}>{"✕"}</button>
          </div>
        </div>

        {/* ── Search bar ── */}
        <div style={{ marginBottom: S.s8 }}>
          <input
            className={"inp"}
            style={{ width: "100%", padding: "8px 12px", fontSize: FS.fs82 }}
            placeholder={"Search exercises…"}
            value={pickerSearch}
            onChange={e => setPickerSearch(e.target.value)}
            autoFocus={true}
          />
        </div>

        {/* ── Filter dropdowns ──
            Three hand-rolled single-select panels used to live here: ~100
            lines of div-with-onClick, no roles, no keyboard path, no counts,
            duplicating what the library tab already had in an accessible
            form. They are the shared FilterDropdown now, which also brings
            multi-select and faceted counts in line with the library. */}
        <div style={{ position: "relative", marginBottom: S.s10 }}>
          {pickerOpenDrop && <div aria-hidden={"true"} onClick={closeDrops} style={{ position: "fixed", inset: 0, zIndex: 19 }} />}
          <div style={{ display: "flex", gap: S.s8 }}>
            <FilterDropdown
              id="wb-muscle"
              label="Muscle"
              shortLabel="Muscle"
              options={MUSCLE_OPTS}
              optionLabel={muscleLabel}
              selected={pickerMuscle}
              counts={facetCounts.muscle}
              onToggle={v => toggleFilter(setPickerMuscle, v)}
              open={pickerOpenDrop === "wb-muscle"}
              setOpen={setPickerOpenDrop}
              accent="#7A8F8B"
              optionAccent={getMuscleColor}
              panelBorder="rgba(122,143,139,.25)"
            />
            <FilterDropdown
              id="wb-type"
              label="Type"
              shortLabel="Type"
              options={TYPE_OPTS}
              optionLabel={v => TYPE_LABELS[v]}
              selected={pickerTypeFilter}
              counts={facetCounts.type}
              onToggle={v => toggleFilter(setPickerTypeFilter, v)}
              open={pickerOpenDrop === "wb-type"}
              setOpen={setPickerOpenDrop}
              accent="#C4A044"
              optionAccent={getTypeColor}
              panelBorder="rgba(180,172,158,.07)"
            />
            <FilterDropdown
              id="wb-equip"
              label="Equipment"
              shortLabel="Equip"
              options={EQUIP_OPTS}
              optionLabel={equipLabel}
              selected={pickerEquipFilter}
              counts={facetCounts.equip}
              onToggle={v => toggleFilter(setPickerEquipFilter, v)}
              open={pickerOpenDrop === "wb-equip"}
              setOpen={setPickerOpenDrop}
              accent={UI_COLORS.accent}
              panelBorder="rgba(196,148,40,0.25)"
            />
          </div>
        </div>

        {/* ── Exercise list (virtualized) ── */}
        {(() => {
          const filtered = allExercises.filter(e => matches(e, pickerMuscle, pickerTypeFilter, pickerEquipFilter));

          if (filtered.length === 0) return <div className={"empty"} style={{ padding: "20px 0" }}>{"No exercises found."}</div>;
          const selIds = new Set(pickerSelected.map(e => e.exId));
          return (
            <>
              <div style={{ fontSize: FS.fs62, color: "#8a8478", marginBottom: S.s6, textAlign: "right" }}>
                {filtered.length + " match" + (filtered.length !== 1 ? "es" : "")}
              </div>
              <List
                rowCount={filtered.length}
                rowHeight={60}
                rowComponent={WbExPickerRow}
                rowProps={{ exercises: filtered, selIds, onToggle: pickerToggleEx }}
                style={{ height: 'min(60vh, 480px)', width: '100%' }}
              />
            </>
          );
        })()}
      </div>
    </div>,
    document.body
  );
});

export default WorkoutExercisePicker;
