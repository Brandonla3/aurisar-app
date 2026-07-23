import React, { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UI_COLORS } from '../../data/constants';
import { getMuscleColor, getTypeColor } from '../../utils/xp';
import { ExIcon } from '../../components/ExIcon';
import { S, R, FS } from '../../utils/tokens';
import { useModalLifecycle } from '../../utils/useModalLifecycle';
import { planEntry } from './planEntry';

/**
 * Exercise detail bottom sheet.
 *
 * Previously rendered inline inside ExerciseLibraryTab, which meant no
 * background inert, no Escape dismiss, and no way to open it from another
 * tab. It now lives at the App root as a portal so any surface can open it
 * by setting `libDetailEx` — the Plans tab's ℹ button used to open a second,
 * divergent image modal for the same data; that modal is gone and both
 * entry points land here.
 *
 * `siblings` is the list the sheet can page through (the current filtered
 * library list). When it contains the open exercise, left/right swipe and
 * the ←/→ keys move to the neighbouring exercise without closing the sheet.
 * Callers that have no meaningful list (e.g. Plans) just omit it.
 */

const SWIPE_THRESHOLD = 56; // px of horizontal travel before a page turn commits

const ExerciseDetailSheet = memo(function ExerciseDetailSheet({
  ex,
  setLibDetailEx,
  siblings,
  profile,
  setProfile,
  setActiveTab,
  setAddToWorkoutPicker,
  openSavePlanWizard,
  setSelEx, setSets, setReps, setExWeight, setWeightPct,
  setHrZone, setDistanceVal, setExHHMM, setExSec, setQuickRows,
  isInCart, toggleCart, stagedCount = 0,
  allExById,
}) {
  const close = () => setLibDetailEx(null);
  useModalLifecycle(ex != null, close);

  // "enter-left" / "enter-right" drive the one-shot page-turn animation.
  const [turn, setTurn] = useState(null);
  const touchStart = useRef(null);
  const sheetRef = useRef(null);

  const idx = ex && siblings ? siblings.findIndex(s => s.id === ex.id) : -1;
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && siblings && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  const goTo = (target, dir) => {
    if (!target) return;
    setTurn(dir === 'next' ? 'enter-right' : 'enter-left');
    setLibDetailEx(target);
  };

  // Arrow keys page through siblings. Escape is already handled by
  // useModalLifecycle. Keyed on the three ids the handler actually closes
  // over — without a dependency array this detached and re-attached a
  // document-level listener on every render of the sheet.
  useEffect(() => {
    if (!ex) return undefined;
    const onKey = e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(next, 'next'); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(prev, 'prev'); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex && ex.id, prev && prev.id, next && next.id]);

  // Move focus into the sheet on open so a keyboard user lands inside the
  // dialog rather than wherever the trigger left them.
  useEffect(() => {
    if (ex) sheetRef.current?.focus();
  }, [ex && ex.id]);

  if (!ex) return null;

  const isFav = (profile.favoriteExercises || []).includes(ex.id);
  const hasPB = !!(profile.exercisePBs || {})[ex.id];
  const staged = isInCart ? isInCart(ex.id) : false;

  const onTouchStart = e => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = e => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Ignore mostly-vertical drags so scrolling the sheet never pages it.
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
    goTo(dx < 0 ? next : prev, dx < 0 ? 'next' : 'prev');
  };

  const pagerBtn = (label, target, dir, ariaLabel) => (
    <button
      type="button"
      onClick={() => goTo(target, dir)}
      disabled={!target}
      aria-label={ariaLabel}
      style={{
        background: "transparent",
        border: "none",
        color: target ? "#8a8478" : "rgba(138,132,120,.25)",
        fontSize: FS.fs82,
        cursor: target ? "pointer" : "default",
        padding: `${S.s4}px ${S.s8}px`,
        lineHeight: 1,
      }}
    >{label}</button>
  );

  return createPortal(
    <div
      role="presentation"
      // Dismiss only when the backdrop itself is hit, so the sheet no longer
      // needs its own stopPropagation handler (which made the dialog a
      // non-interactive element carrying a mouse listener).
      onClick={e => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.85)",
        zIndex: 9400,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        paddingBottom: "var(--bottom-nav-h)"
      }}
    >
      <div
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={ex.name}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onAnimationEnd={() => setTurn(null)}
        className={`sheet-slide-up ${turn ? `sheet-${turn}` : ""}`}
        style={{
          background: "linear-gradient(160deg,rgba(18,16,12,.92),rgba(12,12,10,.95))",
          border: "1px solid rgba(180,172,158,.06)",
          borderRadius: "16px 16px 0 0",
          width: "100%",
          maxWidth: 520,
          maxHeight: "calc(90vh - var(--bottom-nav-h))",
          overflowY: "auto",
          padding: "20px 18px 32px",
          // Focused programmatically on open; the ring would read as an error.
          outline: "none"
        }}
      >
        <div style={{
          width: 36,
          height: 4,
          background: "rgba(45,42,36,.3)",
          borderRadius: R.r2,
          margin: "0 auto 16px"
        }} />

        {/* Pager — only rendered when there is a list to page through. */}
        {(prev || next) && <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: S.s4
        }}>
          {pagerBtn("‹ Prev", prev, "prev", "Previous exercise")}
          <span style={{ fontSize: FS.fs60, color: "#5f5a52", letterSpacing: ".06em" }}>
            {`${idx + 1} / ${siblings.length}`}
          </span>
          {pagerBtn("Next ›", next, "next", "Next exercise")}
        </div>}

        <div style={{
          height: 90,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: S.s12
        }}><ExIcon ex={ex} size={"3.5rem"} color={getTypeColor(ex.category)} /></div>

        <div style={{ marginBottom: S.s10 }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: S.s8,
            flexWrap: "wrap",
            marginBottom: S.s4
          }}>
            <span style={{ fontSize: "1rem", fontWeight: "700", color: "#e8e0d0" }}>{ex.name}</span>
            {hasPB && <span style={{
              background: "rgba(180,172,158,.1)",
              color: "#b4ac9e",
              fontSize: FS.sm,
              padding: "2px 8px",
              borderRadius: R.r4,
              fontWeight: "700"
            }}>{"🏆 PB"}</span>}
          </div>
          <div style={{ display: "flex", gap: S.s8, flexWrap: "wrap" }}>
            <span style={{
              fontSize: FS.md,
              color: getMuscleColor(ex.muscleGroup),
              fontStyle: "italic"
            }}>{ex.muscleGroup ? ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1) : ""}</span>
            {ex.equipment && <span style={{
              fontSize: FS.md,
              color: "#8a8478",
              fontStyle: "italic"
            }}>{"· " + ex.equipment}</span>}
            {ex.difficulty && <span style={{
              fontSize: FS.md,
              fontWeight: 700,
              color: ex.difficulty === "Advanced" ? "#7A2838" : ex.difficulty === "Beginner" ? "#5A8A58" : "#A8843C"
            }}>{"· " + ex.difficulty}</span>}
            <span style={{
              fontSize: FS.md,
              color: "#b4ac9e",
              fontWeight: "700"
            }}>{"· " + ex.baseXP + " XP"}</span>
          </div>
        </div>

        {ex.desc && <p style={{
          fontSize: FS.fs78,
          color: "#8a8478",
          lineHeight: 1.55,
          marginBottom: S.s12
        }}>{ex.desc}</p>}

        {Array.isArray(ex.tips) && ex.tips.length > 0 && <div style={{ marginBottom: S.s12 }}>
          <div style={{
            fontFamily: "'Inter',sans-serif",
            fontSize: FS.sm,
            color: "#8a8478",
            letterSpacing: ".13em",
            textTransform: "uppercase",
            marginBottom: S.s6
          }}>{"Form Tips"}</div>
          {ex.tips.map((tip, i) => <div key={i} style={{
            display: "flex",
            alignItems: "flex-start",
            gap: S.s6,
            fontSize: FS.lg,
            color: "#8a8478",
            lineHeight: 1.45,
            marginBottom: S.s4
          }}><span style={{ color: getMuscleColor(ex.muscleGroup), flexShrink: 0 }}>{"▸"}</span>{tip}</div>)}
        </div>}

        {ex.pbType && <div style={{
          background: "rgba(45,42,36,.16)",
          border: "1px solid rgba(180,172,158,.05)",
          borderRadius: R.lg,
          padding: "8px 12px",
          marginBottom: S.s12,
          fontSize: FS.lg,
          color: "#8a8478"
        }}>
          <span style={{ color: "#b4ac9e", fontWeight: "700" }}>{"PB: "}</span>{ex.pbType}
          {ex.pbTier === "Leaderboard" && <span style={{
            marginLeft: S.s8,
            color: "#b4ac9e",
            fontSize: FS.fs65
          }}>{"🏆 Leaderboard"}</span>}
        </div>}

        <button onClick={() => setProfile(p => ({
          ...p,
          favoriteExercises: (p.favoriteExercises || []).includes(ex.id)
            ? (p.favoriteExercises || []).filter(i => i !== ex.id)
            : [...(p.favoriteExercises || []), ex.id]
        }))} style={{
          width: "100%",
          background: "rgba(45,42,36,.2)",
          border: "1px solid rgba(180,172,158,.06)",
          color: "#b4ac9e",
          padding: "11px",
          borderRadius: R.xl,
          fontWeight: "700",
          fontSize: FS.fs82,
          cursor: "pointer"
        }}>{isFav ? "⭐ Saved to Favorites" : "☆ Save to Favorites"}</button>

        {/* Staging was reachable only from a list in select mode, so the sheet
            — the one place showing enough detail to actually decide — couldn't
            add to the basket it was deciding for. */}
        {ex.id !== "rest_day" && toggleCart && (
          <button
            type="button"
            aria-pressed={!!staged}
            onClick={() => toggleCart(ex.id)}
            style={{
              width: "100%",
              marginTop: S.s8,
              background: staged ? "rgba(196,148,40,.16)" : "rgba(45,42,36,.2)",
              border: `1px solid ${staged ? "rgba(196,148,40,.42)" : "rgba(180,172,158,.06)"}`,
              color: staged ? "#e8d08a" : "#b4ac9e",
              padding: "11px",
              borderRadius: R.xl,
              fontWeight: "700",
              fontSize: FS.fs82,
              cursor: "pointer"
            }}
          >{staged ? "⊟ Staged — tap to remove" : "⊞ Stage for later"}</button>
        )}
        {/* The tray sits at z-index 780 and the sheet at 9400, so staging from
            here updates a bar the user cannot see. Report the count inline
            rather than leaving the button's own state as the only signal. */}
        {ex.id !== "rest_day" && toggleCart && stagedCount > 0 && (
          <div role="status" style={{
            fontSize: FS.fs62,
            color: "#8a8478",
            textAlign: "center",
            marginTop: S.s4
          }}>{`In staging tray · ${stagedCount}`}</div>
        )}

        <div style={{ display: "flex", gap: S.s8, marginTop: S.s8 }}>
          {ex.id !== "rest_day" && <button onClick={() => {
            setAddToWorkoutPicker({
              exercises: [{
                exId: ex.id,
                sets: ex.defaultSets != null ? ex.defaultSets : 3,
                reps: ex.defaultReps != null ? ex.defaultReps : 10,
                weightLbs: null,
                durationMin: null,
                weightPct: 100,
                distanceMi: null,
                hrZone: null
              }]
            });
            close();
          }} style={{
            flex: 1,
            background: "rgba(45,42,36,.2)",
            border: "1px solid rgba(180,172,158,.06)",
            color: "#b4ac9e",
            padding: "10px",
            borderRadius: R.xl,
            fontWeight: "600",
            fontSize: FS.lg,
            cursor: "pointer",
            textAlign: "center"
          }}>{"💪 Add to Workout"}</button>}

          <button onClick={() => {
            // Via the shared opener, which also seeds spwSelected — opening
            // the wizard without it left Save refusing with "Select at least
            // one exercise", or worse, silently reusing a previous run's
            // selection.
            openSavePlanWizard([planEntry(ex, profile.chosenClass, allExById)], ex.name, ex.name);
            close();
          }} style={{
            flex: 1,
            background: "rgba(45,42,36,.2)",
            border: "1px solid rgba(180,172,158,.06)",
            color: "#b4ac9e",
            padding: "10px",
            borderRadius: R.xl,
            fontWeight: "600",
            fontSize: FS.lg,
            cursor: "pointer",
            textAlign: "center"
          }}>{"📋 Add to Plan"}</button>
        </div>

        <button onClick={() => {
          setSelEx(ex.id);
          setSets("");
          setReps("");
          setExWeight("");
          setWeightPct(100);
          setDistanceVal("");
          setHrZone(null);
          setExHHMM("");
          setExSec("");
          setQuickRows([]);
          close();
          setActiveTab("workout");
        }} style={{
          width: "100%",
          marginTop: S.s8,
          background: "linear-gradient(135deg,rgba(26,82,118,.25),rgba(41,128,185,.15))",
          border: "1px solid rgba(41,128,185,.3)",
          color: UI_COLORS.info,
          padding: "11px",
          borderRadius: R.xl,
          fontWeight: "700",
          fontSize: FS.fs82,
          cursor: "pointer",
          textAlign: "center"
        }}>{"⚙ Configure"}</button>
      </div>
    </div>,
    document.body
  );
});

export default ExerciseDetailSheet;
