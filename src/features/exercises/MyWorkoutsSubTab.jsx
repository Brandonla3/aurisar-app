import React, { memo } from 'react';
import { UI_COLORS } from '../../data/constants';
import { getMuscleColor, getTypeColor } from '../../utils/xp';
import { ExIcon } from '../../components/ExIcon';
import { S, R, FS } from '../../utils/tokens';

/**
 * My Workouts sub-tab (Favorites + Custom Exercises) — extracted from the
 * inline block in App.jsx as part of Finding #6 (App.jsx decomposition)
 * per docs/performance-audit.md (PR #116).
 *
 * Rendered when exSubTab === "myworkouts" inside the Exercises tab.
 * Pure presentational; all state and setters are threaded in as props.
 */

const MyWorkoutsSubTab = memo(function MyWorkoutsSubTab({
  // Profile data
  profile,
  setProfile,
  // Exercise data
  allExById,
  // Favorite-select multi-select state
  favSelectMode,
  setFavSelectMode,
  favSelected,
  setFavSelected,
  // Sub-tab / detail navigation
  setExSubTab,
  setLibDetailEx,
  setActiveTab,
  // Workout builder state (for "⚡ New Workout" action)
  setWbExercises,
  setWbName,
  setWbIcon,
  setWbDesc,
  setWbEditId,
  setWbIsOneOff,
  setWorkoutView,
  // Pickers / wizards
  setAddToWorkoutPicker,
  setSavePlanWizard,
  setSpwName,
  setSpwIcon,
  setSpwDate,
  setSpwMode,
  setSpwTargetPlanId,
  // Exercise editor actions
  openExEditor,
  deleteCustomEx,
}) {
  return (
    <div>
      {/* ── Favorites ─────────────────────────────────── */}
      <div style={{ marginBottom: S.s14 }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: S.s10
        }}>
          <div style={{
            fontSize: FS.fs65,
            color: "#8a8478",
            textTransform: "uppercase",
            letterSpacing: ".1em"
          }}>{"Favorite Exercises"}</div>
          {(profile.favoriteExercises || []).length > 0 && (
            <button
              onClick={() => {
                setFavSelectMode(!favSelectMode);
                setFavSelected(new Set());
              }}
              style={{
                background: favSelectMode ? "rgba(45,42,36,.3)" : "transparent",
                border: "1px solid " + (favSelectMode ? "rgba(180,172,158,.15)" : "rgba(180,172,158,.06)"),
                color: favSelectMode ? "#d4cec4" : "#8a8478",
                fontSize: FS.sm,
                padding: "4px 10px",
                borderRadius: R.md,
                cursor: "pointer"
              }}
            >
              {favSelectMode ? "✕ Cancel" : "☐ Select"}
            </button>
          )}
        </div>

        {/* Multi-select action bar */}
        {favSelectMode && favSelected.size > 0 && (
          <div style={{
            background: "rgba(45,42,36,.2)",
            border: "1px solid rgba(180,172,158,.06)",
            borderRadius: R.r10,
            padding: "10px 14px",
            marginBottom: S.s10,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: S.s8
          }}>
            <span style={{ fontSize: FS.lg, color: "#b4ac9e", fontWeight: "700" }}>
              {favSelected.size + " selected"}
            </span>
            <div style={{ display: "flex", gap: S.s8, justifyContent: "center" }}>
              <button
                onClick={() => {
                  const ids = [...favSelected];
                  const exs = ids.map(id => {
                    const e = allExById[id];
                    return {
                      exId: id,
                      sets: e && e.defaultSets != null ? e.defaultSets : 3,
                      reps: e && e.defaultReps != null ? e.defaultReps : 10,
                      weightLbs: null,
                      durationMin: e && e.defaultDurationMin || null,
                      weightPct: 100,
                      distanceMi: null,
                      hrZone: null
                    };
                  });
                  setAddToWorkoutPicker({ exercises: exs });
                  setFavSelectMode(false);
                  setFavSelected(new Set());
                }}
                style={{
                  background: "rgba(45,42,36,.22)",
                  border: "1px solid rgba(180,172,158,.08)",
                  color: "#b4ac9e",
                  padding: "6px 12px",
                  borderRadius: R.lg,
                  fontSize: FS.md,
                  fontWeight: "700",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  textAlign: "center"
                }}
              >{"➕ Existing"}</button>
              <button
                onClick={() => {
                  const ids = [...favSelected];
                  const exs = ids.map(id => {
                    const e = allExById[id];
                    return {
                      exId: id,
                      sets: e && e.defaultSets != null ? e.defaultSets : 3,
                      reps: e && e.defaultReps != null ? e.defaultReps : 10,
                      weightLbs: null,
                      durationMin: e && e.defaultDurationMin || null,
                      weightPct: 100,
                      distanceMi: null,
                      hrZone: null
                    };
                  });
                  setWbExercises(exs);
                  setWbName("");
                  setWbIcon("💪");
                  setWbDesc("");
                  setWbEditId(null);
                  setWbIsOneOff(false);
                  setWorkoutView("builder");
                  setActiveTab("workouts");
                  setFavSelectMode(false);
                  setFavSelected(new Set());
                }}
                style={{
                  background: "linear-gradient(135deg,#5b2d8e,#7b1fa2)",
                  border: "none",
                  color: "#fff",
                  padding: "6px 12px",
                  borderRadius: R.lg,
                  fontSize: FS.md,
                  fontWeight: "700",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  textAlign: "center"
                }}
              >{"⚡ New Workout"}</button>
              <button
                onClick={() => {
                  const ids = [...favSelected];
                  setSavePlanWizard({
                    entries: ids.map(id => ({
                      exId: id,
                      exercise: allExById[id] && allExById[id].name,
                      icon: allExById[id] && allExById[id].icon,
                      _idx: id
                    })),
                    label: "Selected Favorites"
                  });
                  setSpwName("Selected Favorites");
                  setSpwIcon("📋");
                  setSpwDate("");
                  setSpwMode("new");
                  setSpwTargetPlanId(null);
                  setFavSelectMode(false);
                  setFavSelected(new Set());
                }}
                style={{
                  background: "rgba(45,42,36,.26)",
                  border: "1px solid rgba(180,172,158,.08)",
                  color: "#b4ac9e",
                  padding: "6px 12px",
                  borderRadius: R.lg,
                  fontSize: FS.md,
                  fontWeight: "700",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  textAlign: "center"
                }}
              >{"📋 Plan"}</button>
            </div>
          </div>
        )}

        {(profile.favoriteExercises || []).length === 0 ? (
          <div className={"empty"} style={{ padding: "16px 0" }}>
            {"No favorites yet — tap ⭐ on any exercise."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: S.s6 }}>
            {(profile.favoriteExercises || []).slice(0, 20).map(exId => {
              const ex = allExById[exId];
              if (!ex) return null;
              const hasPB = !!(profile.exercisePBs || {})[ex.id];
              const diffLabel = ex.difficulty || (ex.baseXP >= 60 ? "Advanced" : ex.baseXP >= 45 ? "Intermediate" : "Beginner");
              const diffColor = diffLabel === "Advanced" ? "#7A2838" : diffLabel === "Beginner" ? "#5A8A58" : "#A8843C";
              const isSel = favSelected.has(exId);
              return (
                <div
                  key={exId}
                  onClick={() => {
                    if (favSelectMode) {
                      setFavSelected(s => {
                        const n = new Set(s);
                        if (n.has(exId)) n.delete(exId); else n.add(exId);
                        return n;
                      });
                    } else {
                      setLibDetailEx(ex);
                      setExSubTab("library");
                    }
                  }}
                  style={{
                    background: isSel ? "rgba(45,42,36,.3)" : "linear-gradient(145deg,rgba(45,42,36,.35),rgba(32,30,26,.2))",
                    border: "1px solid " + (isSel ? "rgba(180,172,158,.2)" : "rgba(180,172,158,.05)"),
                    borderRadius: R.r10,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: S.s12,
                    cursor: "pointer",
                    boxShadow: isSel ? "0 0 0 1.5px rgba(180,172,158,.2)" : "none",
                    transition: "all .15s"
                  }}
                >
                  {favSelectMode && (
                    <div style={{
                      width: 22,
                      height: 22,
                      borderRadius: R.r5,
                      flexShrink: 0,
                      border: "1.5px solid " + (isSel ? "rgba(180,172,158,.3)" : "rgba(180,172,158,.08)"),
                      background: isSel ? "rgba(45,42,36,.35)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}>
                      {isSel && <span style={{ color: "#b4ac9e", fontSize: FS.fs65 }}>{"✓"}</span>}
                    </div>
                  )}
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: R.lg,
                    flexShrink: 0,
                    background: "rgba(45,42,36,.15)",
                    border: "1px solid rgba(180,172,158,.05)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}>
                    <ExIcon ex={ex} size={"1rem"} color={"#b4ac9e"} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: S.s6,
                      flexWrap: "wrap",
                      marginBottom: S.s4
                    }}>
                      <span style={{ fontSize: FS.fs83, fontWeight: 600, color: "#d4cec4", letterSpacing: ".01em" }}>
                        {ex.name}
                      </span>
                      {hasPB && <span style={{ fontSize: FS.sm }}>{"🏆"}</span>}
                    </div>
                    <div style={{ fontSize: FS.fs62, fontStyle: "italic", lineHeight: 1.4 }}>
                      {ex.category && (
                        <span style={{ color: getTypeColor(ex.category) }}>
                          {ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}
                        </span>
                      )}
                      {ex.category && ex.muscleGroup && <span style={{ color: "#8a8478" }}>{" · "}</span>}
                      {ex.muscleGroup && (
                        <span style={{ color: getMuscleColor(ex.muscleGroup) }}>
                          {ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1)}
                        </span>
                      )}
                    </div>
                  </div>
                  {!favSelectMode && (
                    <div style={{
                      flexShrink: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: S.s6
                    }}>
                      <span style={{ fontSize: FS.fs66, fontWeight: 700, color: "#b4ac9e", letterSpacing: ".02em" }}>
                        {ex.baseXP + " XP"}
                      </span>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setProfile(p => ({
                            ...p,
                            favoriteExercises: (p.favoriteExercises || []).filter(i => i !== exId)
                          }));
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#b4ac9e",
                          fontSize: FS.fs90,
                          cursor: "pointer",
                          padding: S.s0,
                          lineHeight: 1
                        }}
                      >{"⭐"}</button>
                    </div>
                  )}
                  {favSelectMode && (
                    <div style={{ flexShrink: 0 }}>
                      <span style={{ fontSize: FS.fs66, fontWeight: 700, color: "#b4ac9e" }}>
                        {ex.baseXP + " XP"}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Custom Exercises ───────────────────────────── */}
      <div style={{ marginTop: S.s8 }}>
        <div style={{
          fontSize: FS.fs65,
          color: "#8a8478",
          textTransform: "uppercase",
          letterSpacing: ".1em",
          marginBottom: S.s10
        }}>{"Custom Exercises"}</div>
        {(profile.customExercises || []).length === 0 ? (
          <div className={"empty"} style={{ padding: "12px 0" }}>{"No custom exercises yet."}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: S.s6 }}>
            {(profile.customExercises || []).map(ex => {
              const hasPB = !!(profile.exercisePBs || {})[ex.id];
              const isFav = (profile.favoriteExercises || []).includes(ex.id);
              const diffLabel = ex.difficulty || (ex.baseXP >= 60 ? "Advanced" : ex.baseXP >= 45 ? "Intermediate" : "Beginner");
              const diffColor = diffLabel === "Advanced" ? "#7A2838" : diffLabel === "Beginner" ? "#5A8A58" : "#A8843C";
              return (
                <div
                  key={ex.id}
                  onClick={() => {
                    setLibDetailEx(ex);
                    setExSubTab("library");
                  }}
                  style={{
                    background: "linear-gradient(145deg,rgba(45,42,36,.35),rgba(32,30,26,.2))",
                    border: "1px solid rgba(180,172,158,.05)",
                    borderRadius: R.r10,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: S.s12,
                    cursor: "pointer",
                    transition: "all .18s"
                  }}
                >
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: R.lg,
                    flexShrink: 0,
                    background: "rgba(45,42,36,.15)",
                    border: "1px solid rgba(180,172,158,.05)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}>
                    <ExIcon ex={ex} size={"1rem"} color={"#b4ac9e"} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: S.s6,
                      flexWrap: "wrap",
                      marginBottom: S.s4
                    }}>
                      <span style={{ fontSize: FS.fs83, fontWeight: 600, color: "#d4cec4", letterSpacing: ".01em" }}>
                        {ex.name}
                      </span>
                      <span className={"custom-ex-badge"} style={{ marginLeft: S.s2 }}>{"custom"}</span>
                      {hasPB && <span style={{ fontSize: FS.sm }}>{"🏆"}</span>}
                    </div>
                    <div style={{ fontSize: FS.fs62, fontStyle: "italic", lineHeight: 1.4 }}>
                      {ex.category && (
                        <span style={{ color: getTypeColor(ex.category) }}>
                          {ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}
                        </span>
                      )}
                      {ex.category && ex.muscleGroup && <span style={{ color: "#8a8478" }}>{" · "}</span>}
                      {ex.muscleGroup && (
                        <span style={{ color: getMuscleColor(ex.muscleGroup) }}>
                          {ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: S.s6 }}>
                    <span style={{ fontSize: FS.fs66, fontWeight: 700, color: "#b4ac9e", letterSpacing: ".02em" }}>
                      {ex.baseXP + " XP"}
                    </span>
                    {diffLabel && (
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "2px 8px",
                        borderRadius: R.r4,
                        fontSize: FS.fs58,
                        fontWeight: 700,
                        letterSpacing: ".05em",
                        color: diffColor,
                        background: diffLabel === "Advanced" ? "#2e1515" : diffLabel === "Beginner" ? "#1a2e1a" : "#2e2010"
                      }}>{diffLabel}</span>
                    )}
                    <div style={{ display: "flex", gap: S.s6, alignItems: "center" }}>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          openExEditor("edit", ex);
                        }}
                        style={{
                          background: "rgba(45,42,36,.25)",
                          border: "1px solid rgba(180,172,158,.08)",
                          color: "#8a8478",
                          fontSize: FS.fs55,
                          cursor: "pointer",
                          padding: "4px 8px",
                          borderRadius: R.r5,
                          fontFamily: "'Barlow',sans-serif"
                        }}
                      >{"✎ edit"}</button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          deleteCustomEx(ex.id);
                        }}
                        style={{
                          background: "rgba(46,20,20,.3)",
                          border: "1px solid rgba(231,76,60,.15)",
                          color: UI_COLORS.danger,
                          fontSize: FS.fs55,
                          cursor: "pointer",
                          padding: "4px 8px",
                          borderRadius: R.r5
                        }}
                      >{"🗑"}</button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setProfile(p => ({
                            ...p,
                            favoriteExercises: isFav
                              ? (p.favoriteExercises || []).filter(i => i !== ex.id)
                              : [...(p.favoriteExercises || []), ex.id]
                          }));
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: isFav ? "#d4cec4" : "#8a8478",
                          fontSize: FS.fs90,
                          cursor: "pointer",
                          padding: S.s0,
                          lineHeight: 1
                        }}
                      >{isFav ? "⭐" : "☆"}</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <button
          onClick={() => openExEditor("create", null)}
          style={{
            marginTop: S.s10,
            width: "100%",
            background: "transparent",
            border: "1px dashed rgba(180,172,158,.08)",
            color: "#b4ac9e",
            borderRadius: R.xl,
            padding: "10px",
            fontSize: FS.fs78,
            cursor: "pointer"
          }}
        >{"＋ Create Custom Exercise"}</button>
      </div>
    </div>
  );
});

export default MyWorkoutsSubTab;
