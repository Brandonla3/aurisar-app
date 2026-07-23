import React, { memo, useState } from 'react';
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

// Favourites render in pages rather than all at once — the list is unbounded
// and every row does a lookup + colour derivation.
const FAV_PAGE = 20;

const MyWorkoutsSubTab = memo(function MyWorkoutsSubTab({
  // Profile data
  profile,
  setProfile,
  // Exercise data
  allExById,
  // Favorite-select multi-select state
  favSelectMode,
  setFavSelectMode,
  isInCart,
  toggleCart,
  // Sub-tab / detail navigation
  setLibDetailEx,
  // Exercise editor actions
  openExEditor,
  deleteCustomEx,
}) {
  const [favVisibleCount, setFavVisibleCount] = useState(FAV_PAGE);
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
                // Exits select mode only — see ExerciseLibraryTab: the cart is
                // persistent, so Cancel must not discard it.
                setFavSelectMode(!favSelectMode);
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

        {/* The three-destination action bar moved to the staging tray at the
            App root, so a selection started here survives leaving this list. */}

        {(profile.favoriteExercises || []).length === 0 ? (
          <div className={"empty"} style={{ padding: "16px 0" }}>
            {"No favorites yet — tap ⭐ on any exercise."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: S.s6 }}>
            {(profile.favoriteExercises || []).slice(0, favVisibleCount).map(exId => {
              const ex = allExById[exId];
              if (!ex) return null;
              const hasPB = !!(profile.exercisePBs || {})[ex.id];
              const isSel = isInCart(exId);
              return (
                <div
                  key={exId}
                  className={"stretch-row"}
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
                      <button
                        type="button"
                        className={"picker-ex-main"}
                        aria-pressed={favSelectMode ? isSel : undefined}
                        aria-label={favSelectMode ? `Stage ${ex.name}` : `Open ${ex.name}`}
                        onClick={() => (favSelectMode ? toggleCart(exId) : setLibDetailEx(ex))}
                        style={{ fontSize: FS.fs83, fontWeight: 600, color: "#d4cec4", letterSpacing: ".01em" }}
                      >{ex.name}</button>
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
                        aria-pressed={true}
                        aria-label={`Remove ${ex.name} from favourites`}
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
            {/* The list used to hard-slice at 20 with no indication, so
                favourite #21 onwards simply vanished. */}
            {(profile.favoriteExercises || []).length > favVisibleCount && (
              <button
                type="button"
                onClick={() => setFavVisibleCount(c => c + FAV_PAGE)}
                style={{
                  background: "rgba(45,42,36,.2)",
                  border: "1px solid rgba(180,172,158,.08)",
                  color: "#b4ac9e",
                  padding: "9px",
                  borderRadius: R.lg,
                  fontSize: FS.md,
                  cursor: "pointer",
                  marginTop: S.s2
                }}
              >{`Show more (${favVisibleCount} of ${(profile.favoriteExercises || []).length})`}</button>
            )}
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
                  className={"stretch-row"}
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
                      <button
                        type="button"
                        className={"picker-ex-main"}
                        aria-label={`Open ${ex.name}`}
                        onClick={() => setLibDetailEx(ex)}
                        style={{ fontSize: FS.fs83, fontWeight: 600, color: "#d4cec4", letterSpacing: ".01em" }}
                      >{ex.name}</button>
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
                      aria-label={`Edit ${ex.name}`}>{"✎ edit"}</button>
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
                      aria-label={`Delete ${ex.name}`}>{"🗑"}</button>
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
                      aria-pressed={isFav}
                      aria-label={isFav ? `Remove ${ex.name} from favourites` : `Add ${ex.name} to favourites`}>{isFav ? "⭐" : "☆"}</button>
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
