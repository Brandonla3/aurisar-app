import React, { memo } from 'react';
import { createPortal } from 'react-dom';
import { List } from 'react-window';
import { UI_COLORS } from '../../data/constants';
import { getMuscleColor, getTypeColor } from '../../utils/xp';
import { ExIcon } from '../../components/ExIcon';
import { S, R, FS } from '../../utils/tokens';

/**
 * Workout exercise picker modal — extracted from the inline block in App.jsx
 * as part of Finding #6 (App.jsx decomposition) per docs/performance-audit.md
 * (PR #116).
 *
 * Single-pane UI: exercise search/filter list with multi-select Add.
 * Per-exercise configuration happens inline in the workout builder after add.
 * Uses createPortal to render into document.body.
 */

// ── Row component for the virtualized exercise list ──────────────────────────
// Moved from module scope of App.jsx.
const WbExPickerRow = React.memo(function WbExPickerRow({
  ariaAttributes,
  index,
  style,
  exercises,
  selIds,
  onToggle
}) {
  const ex = exercises[index];
  if (!ex) return null;
  const sel = selIds.has(ex.id);
  const diffLabel = ex.difficulty || (ex.baseXP >= 60 ? "Advanced" : ex.baseXP >= 45 ? "Intermediate" : "Beginner");
  const diffColor = diffLabel === "Advanced" ? "#7A2838" : diffLabel === "Beginner" ? "#5A8A58" : "#A8843C";
  const diffBg = diffLabel === "Advanced" ? "#2e1515" : diffLabel === "Beginner" ? "#1a2e1a" : "#2e2010";
  const exMgColor = getMuscleColor(ex.muscleGroup);
  return (
    <div style={{ ...style, paddingTop: 4, paddingBottom: 4 }} {...ariaAttributes}>
      <div className={"picker-ex-row" + (sel ? " sel" : "")} onClick={() => onToggle(ex.id)} style={{ "--mg-color": exMgColor }}>
        <div className="picker-ex-orb"><ExIcon ex={ex} size=".95rem" color="#d4cec4" /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: FS.fs80, fontWeight: 600, color: "#d4cec4", marginBottom: S.s2 }}>
            {ex.name}{ex.custom && <span className="custom-ex-badge" style={{ marginLeft: S.s4 }}>custom</span>}
          </div>
          <div style={{ fontSize: FS.sm, fontStyle: "italic" }}>
            {ex.category && <span style={{ color: getTypeColor(ex.category) }}>{ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}</span>}
            {ex.category && ex.muscleGroup && <span style={{ color: "#8a8478" }}>{" · "}</span>}
            {ex.muscleGroup && <span style={{ color: getMuscleColor(ex.muscleGroup) }}>{ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1)}</span>}
          </div>
        </div>
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: S.s4 }}>
          <span style={{ fontSize: FS.fs63, fontWeight: 700, color: "#b4ac9e" }}>{ex.baseXP + " XP"}</span>
          <span style={{ fontSize: FS.fs56, fontWeight: 700, color: diffColor, background: diffBg, padding: "2px 6px", borderRadius: R.r3, letterSpacing: ".04em" }}>{diffLabel}</span>
        </div>
      </div>
    </div>
  );
});

// ── Filter option constants (module-level to avoid re-creation per render) ───
const PTYPE_LABELS = {
  strength: "⚔️ Strength",
  cardio: "🏃 Cardio",
  flexibility: "🧘 Flex",
  yoga: "🧘 Yoga",
  stretching: "🌿 Stretch",
  plyometric: "⚡ Plyo",
  calisthenics: "🤸 Cali"
};
const PTYPE_OPTS = Object.keys(PTYPE_LABELS);
const PEQUIP_OPTS = ["barbell", "dumbbell", "kettlebell", "cable", "machine", "bodyweight", "band"];
const PMUSCLE_OPTS = ["chest", "back", "shoulder", "bicep", "tricep", "legs", "glutes", "abs", "calves", "forearm", "cardio"];

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
  allExById,
  // Action callbacks
  closePicker,
  openExEditor,
  pickerToggleEx,
  commitPickerToWorkout,
}) {
  const closeDrops = () => setPickerOpenDrop(null);

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

        {/* ── Filter dropdowns ── */}
        <div style={{ position: "relative", marginBottom: S.s10 }}>
          {pickerOpenDrop && <div onClick={closeDrops} style={{ position: "fixed", inset: 0, zIndex: 19 }} />}
          <div style={{ display: "flex", gap: S.s8 }}>
            {/* Muscle */}
            <div style={{ position: "relative", flex: 1, zIndex: 20 }}>
              <button
                onClick={() => setPickerOpenDrop(d => d === "muscle" ? null : "muscle")}
                style={{
                  width: "100%", padding: "6px 24px 6px 8px", borderRadius: R.lg,
                  border: "1px solid " + (pickerMuscle !== "All" ? "#b4ac9e" : "rgba(45,42,36,.3)"),
                  background: "rgba(14,14,12,.95)",
                  color: pickerMuscle !== "All" ? "#b4ac9e" : "#8a8478",
                  fontSize: FS.fs68, textAlign: "left", cursor: "pointer", position: "relative"
                }}
              >
                {pickerMuscle === "All" ? "Muscle" : pickerMuscle.charAt(0).toUpperCase() + pickerMuscle.slice(1)}
                <span style={{
                  position: "absolute", right: 7, top: "50%",
                  transform: "translateY(-50%) rotate(" + (pickerOpenDrop === "muscle" ? "180deg" : "0deg") + ")",
                  fontSize: FS.fs55, color: pickerMuscle !== "All" ? "#b4ac9e" : "#8a8478", transition: "transform .15s"
                }}>{"▼"}</span>
              </button>
              {pickerOpenDrop === "muscle" && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: "100%",
                  background: "rgba(16,14,10,.95)", border: "1px solid rgba(180,172,158,.06)",
                  borderRadius: R.lg, padding: "6px 4px", zIndex: 21, boxShadow: "0 8px 24px rgba(0,0,0,.7)"
                }}>
                  <div onClick={() => { setPickerMuscle("All"); closeDrops(); }} style={{ padding: "6px 10px", fontSize: FS.lg, cursor: "pointer", borderRadius: R.r5, color: pickerMuscle === "All" ? "#b4ac9e" : "#8a8478", background: pickerMuscle === "All" ? "rgba(45,42,36,.2)" : "transparent" }}>{"All Muscles"}</div>
                  {PMUSCLE_OPTS.map(m => (
                    <div key={m} onClick={() => { setPickerMuscle(m); closeDrops(); }} style={{ padding: "6px 10px", fontSize: FS.lg, cursor: "pointer", borderRadius: R.r5, color: pickerMuscle === m ? getMuscleColor(m) : "#8a8478", background: pickerMuscle === m ? "rgba(45,42,36,.2)" : "transparent", textTransform: "capitalize" }}>{m}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Type */}
            <div style={{ position: "relative", flex: 1, zIndex: 20 }}>
              <button
                onClick={() => setPickerOpenDrop(d => d === "type" ? null : "type")}
                style={{
                  width: "100%", padding: "6px 24px 6px 8px", borderRadius: R.lg,
                  border: "1px solid " + (pickerTypeFilter !== "all" ? "#d4cec4" : "rgba(45,42,36,.3)"),
                  background: "rgba(14,14,12,.95)",
                  color: pickerTypeFilter !== "all" ? "#d4cec4" : "#8a8478",
                  fontSize: FS.fs68, textAlign: "left", cursor: "pointer", position: "relative"
                }}
              >
                {pickerTypeFilter === "all" ? "Type" : PTYPE_LABELS[pickerTypeFilter] || pickerTypeFilter}
                <span style={{
                  position: "absolute", right: 7, top: "50%",
                  transform: "translateY(-50%) rotate(" + (pickerOpenDrop === "type" ? "180deg" : "0deg") + ")",
                  fontSize: FS.fs55, color: pickerTypeFilter !== "all" ? "#d4cec4" : "#8a8478", transition: "transform .15s"
                }}>{"▼"}</span>
              </button>
              {pickerOpenDrop === "type" && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: "100%",
                  background: "rgba(16,14,10,.95)", border: "1px solid rgba(180,172,158,.06)",
                  borderRadius: R.lg, padding: "6px 4px", zIndex: 21, boxShadow: "0 8px 24px rgba(0,0,0,.7)"
                }}>
                  <div onClick={() => { setPickerTypeFilter("all"); closeDrops(); }} style={{ padding: "6px 10px", fontSize: FS.lg, cursor: "pointer", borderRadius: R.r5, color: pickerTypeFilter === "all" ? "#d4cec4" : "#8a8478", background: pickerTypeFilter === "all" ? "rgba(45,42,36,.2)" : "transparent" }}>{"All Types"}</div>
                  {PTYPE_OPTS.map(t => (
                    <div key={t} onClick={() => { setPickerTypeFilter(t); closeDrops(); }} style={{ padding: "6px 10px", fontSize: FS.lg, cursor: "pointer", borderRadius: R.r5, color: pickerTypeFilter === t ? getTypeColor(t) : "#8a8478", background: pickerTypeFilter === t ? "rgba(45,42,36,.2)" : "transparent" }}>{PTYPE_LABELS[t]}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Equipment */}
            <div style={{ position: "relative", flex: 1, zIndex: 20 }}>
              <button
                onClick={() => setPickerOpenDrop(d => d === "equip" ? null : "equip")}
                style={{
                  width: "100%", padding: "6px 24px 6px 8px", borderRadius: R.lg,
                  border: "1px solid " + (pickerEquipFilter !== "all" ? UI_COLORS.accent : "rgba(45,42,36,.3)"),
                  background: "rgba(14,14,12,.95)",
                  color: pickerEquipFilter !== "all" ? UI_COLORS.accent : "#8a8478",
                  fontSize: FS.fs68, textAlign: "left", cursor: "pointer", position: "relative"
                }}
              >
                {pickerEquipFilter === "all" ? "Equipment" : pickerEquipFilter.charAt(0).toUpperCase() + pickerEquipFilter.slice(1)}
                <span style={{
                  position: "absolute", right: 7, top: "50%",
                  transform: "translateY(-50%) rotate(" + (pickerOpenDrop === "equip" ? "180deg" : "0deg") + ")",
                  fontSize: FS.fs55, color: pickerEquipFilter !== "all" ? UI_COLORS.accent : "#8a8478", transition: "transform .15s"
                }}>{"▼"}</span>
              </button>
              {pickerOpenDrop === "equip" && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: "100%",
                  background: "rgba(16,14,10,.95)", border: "1px solid rgba(180,172,158,.06)",
                  borderRadius: R.lg, padding: "6px 4px", zIndex: 21, boxShadow: "0 8px 24px rgba(0,0,0,.7)"
                }}>
                  <div onClick={() => { setPickerEquipFilter("all"); closeDrops(); }} style={{ padding: "6px 10px", fontSize: FS.lg, cursor: "pointer", borderRadius: R.r5, color: pickerEquipFilter === "all" ? UI_COLORS.accent : "#8a8478", background: pickerEquipFilter === "all" ? "rgba(196,148,40,0.12)" : "transparent" }}>{"All Equipment"}</div>
                  {PEQUIP_OPTS.map(e => (
                    <div key={e} onClick={() => { setPickerEquipFilter(e); closeDrops(); }} style={{ padding: "6px 10px", fontSize: FS.lg, cursor: "pointer", borderRadius: R.r5, color: pickerEquipFilter === e ? UI_COLORS.accent : "#8a8478", background: pickerEquipFilter === e ? "rgba(196,148,40,0.12)" : "transparent", textTransform: "capitalize" }}>{e}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Exercise list (virtualized) ── */}
        {(() => {
          const q = pickerSearch.toLowerCase().trim();
          const filtered = allExercises.filter(e => {
            if (e.id === "rest_day") return false;
            if (pickerMuscle !== "All" && e.muscleGroup !== pickerMuscle) return false;
            if (pickerTypeFilter !== "all") {
              const ty = (e.exerciseType || "").toLowerCase(), ca = (e.category || "").toLowerCase();
              if (!ty.includes(pickerTypeFilter) && ca !== pickerTypeFilter) return false;
            }
            if (pickerEquipFilter !== "all" && (e.equipment || "bodyweight").toLowerCase() !== pickerEquipFilter) return false;
            if (q && !e.name.toLowerCase().includes(q)) return false;
            return true;
          });
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
