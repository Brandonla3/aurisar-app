import React, { memo, useEffect, useRef, useState } from 'react';
import { getMuscleColor, getTypeColor } from '../../utils/xp';
import { displayWt } from '../../utils/units';
import { getExerciseHistory } from '../../utils/exerciseHistory';
import { ExIcon } from '../../components/ExIcon';
import { S, R, FS, FG } from '../../utils/tokens';
import Sheet from '../../components/ui/Sheet';
import { planEntry } from './planEntry';
import { diffColor } from './difficulty';

/**
 * Exercise detail bottom sheet (Forge Glass).
 *
 * Previously rendered inline inside ExerciseLibraryTab, which meant no
 * background inert, no Escape dismiss, and no way to open it from another
 * tab. It now lives at the App root as a portal so any surface can open it
 * by setting `libDetailEx` â€” the Plans tab's â„¹ button used to open a second,
 * divergent image modal for the same data; that modal is gone and both
 * entry points land here.
 *
 * `siblings` is the list the sheet can page through (the current filtered
 * library list). When it contains the open exercise, left/right swipe and
 * the â†/â†’ keys move to the neighbouring exercise without closing the sheet.
 * Callers that have no meaningful list (e.g. Plans) just omit it.
 *
 * Content is split across About | Form | History subtabs; History derives
 * from profile.log on the fly (no persisted state).
 */

const SWIPE_THRESHOLD = 56; // px of horizontal travel before a page turn commits

const GLASS_BTN = {
  width: "100%",
  background: FG.glassBgSoft,
  border: `1px solid ${FG.glassBorder}`,
  color: "#b4ac9e",
  padding: "11px",
  borderRadius: R.xxl,
  fontWeight: "700",
  fontSize: FS.fs82,
  cursor: "pointer",
};

function pbText(pb, units) {
  if (!pb) return "â€”";
  // Legacy PB shape ({weight: 185}) predates calcExercisePBs' {type, value}.
  if (pb.weight != null) return displayWt(pb.weight, units) || String(pb.weight);
  if (pb.value == null) return "â€”";
  if (/Weight|1RM/i.test(pb.type || "")) return displayWt(pb.value, units) || String(pb.value);
  if (/Reps/i.test(pb.type || "")) return `${pb.value} reps`;
  if (/Pace|cardio/i.test(pb.type || "")) return `${parseFloat(Number(pb.value).toFixed(2))} min/mi`;
  return String(pb.value);
}

const ExerciseDetailSheet = memo(function ExerciseDetailSheet({
  ex,
  setLibDetailEx,
  siblings,
  profile,
  setProfile,
  setAddToWorkoutPicker,
  openSavePlanWizard,
  openQuickLog,
  isInCart, toggleCart, stagedCount = 0,
  allExById,
}) {
  const close = () => setLibDetailEx(null);

  // "enter-left" / "enter-right" drive the one-shot page-turn animation.
  const [turn, setTurn] = useState(null);
  const [subtab, setSubtab] = useState("about");
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
  // over â€” without a dependency array this detached and re-attached a
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
  // dialog rather than wherever the trigger left them. Keyed on open/closed,
  // not on the exercise: paging with Prev/Next changes ex.id, and refocusing
  // there yanked focus off the very button the user had just pressed.
  // Fresh opens also reset to the About subtab; paging keeps the active tab
  // so neighbouring exercises can be compared on the same dimension.
  const wasOpen = useRef(false);
  useEffect(() => {
    const open = ex != null;
    if (open && !wasOpen.current) {
      sheetRef.current?.focus();
      setSubtab("about");
    }
    wasOpen.current = open;
  }, [ex]);

  if (!ex) return null;

  const isFav = (profile.favoriteExercises || []).includes(ex.id);
  const pb = (profile.exercisePBs || {})[ex.id];
  const hasPB = !!pb;
  const staged = isInCart ? isInCart(ex.id) : false;
  const mgColor = getMuscleColor(ex.muscleGroup);
  const history = getExerciseHistory(profile.log, ex.id);

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
        color: target ? "#9a9488" : "rgba(138,132,120,.25)",
        fontSize: FS.fs82,
        cursor: target ? "pointer" : "default",
        padding: `${S.s4}px ${S.s8}px`,
        lineHeight: 1,
      }}
    >{label}</button>
  );

  const statChip = (label, value, gold) => (
    <div style={{
      flex: 1,
      padding: "8px 10px",
      borderRadius: R.xxl,
      background: gold ? "rgba(232,180,74,.08)" : FG.glassBgSoft,
      border: `1px solid ${gold ? "rgba(232,180,74,.22)" : FG.glassBorder}`,
    }}>
      <div style={{
        fontFamily: FG.fontSerif,
        fontSize: FS.fs44,
        letterSpacing: ".24em",
        textTransform: "uppercase",
        color: gold ? "rgba(232,180,74,.75)" : "rgba(228,222,211,.4)",
        marginBottom: 3,
      }}>{label}</div>
      <div style={{
        fontFamily: gold ? FG.fontSerif : FG.fontCond,
        fontSize: FS.xxl,
        fontWeight: 600,
        lineHeight: 1,
        color: gold ? FG.goldGlow : FG.ink,
      }}>{value}</div>
    </div>
  );

  const subtabBtn = (key, label) => {
    const on = subtab === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setSubtab(key)}
        aria-pressed={on}
        style={{
          flex: 1,
          height: 32,
          borderRadius: R.xl,
          cursor: "pointer",
          border: `1px solid ${on ? `color-mix(in srgb,${mgColor} 55%,rgba(255,255,255,.2))` : "transparent"}`,
          background: on ? `color-mix(in srgb,${mgColor} 22%,transparent)` : "transparent",
          color: on ? FG.inkTitle : "rgba(228,222,211,.5)",
          fontFamily: FG.fontCond,
          fontSize: FS.base,
          fontWeight: 600,
          letterSpacing: ".13em",
          textTransform: "uppercase",
        }}
      >{label}</button>
    );
  };

  // History chart geometry: weight when logged, else XP, scaled 14â†’54px.
  const histVals = history.map(h => (h.weightLbs != null ? h.weightLbs : h.xp));
  const histMax = Math.max(...histVals, 1);
  const histMin = Math.min(...histVals, histMax);
  const barH = v => {
    if (histMax === histMin) return 34;
    return Math.round(14 + ((v - histMin) / (histMax - histMin)) * 40);
  };
  const histWeights = history.filter(h => h.weightLbs != null);
  const trendDelta = histWeights.length >= 2
    ? histWeights[histWeights.length - 1].weightLbs - histWeights[0].weightLbs
    : null;
  const lastRow = history[history.length - 1] || null;

  return (
    <Sheet
      open
      onClose={close}
      layer={"detail"}
      ariaLabel={ex.name}
      tabIndex={-1}
      sheetRef={sheetRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onAnimationEnd={() => setTurn(null)}
      className={turn ? `sheet-${turn}` : ""}
    >
      <div>
        {/* Pager â€” only rendered when there is a list to page through. */}
        {(prev || next) && <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: S.s4
        }}>
          {pagerBtn("â€¹ Prev", prev, "prev", "Previous exercise")}
          <span style={{ fontSize: FS.fs60, color: "#969082", letterSpacing: ".06em" }}>
            {`${idx + 1} / ${siblings.length}`}
          </span>
          {pagerBtn("Next â€º", next, "next", "Next exercise")}
        </div>}

        {/* Hero â€” muscle-washed glass panel. */}
        <div style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 16,
          border: `1px solid ${FG.glassBorder}`,
          background: `linear-gradient(150deg, color-mix(in srgb,${mgColor} 38%,transparent), rgba(13,13,17,.35) 72%)`,
          padding: "16px 14px 12px",
          marginBottom: S.s10,
        }}>
          <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: mgColor, opacity: .9 }} />
          <div style={{
            position: "absolute",
            right: 6,
            top: "50%",
            transform: "translateY(-50%)",
            opacity: .22,
            pointerEvents: "none",
          }}><ExIcon ex={ex} size={"4.4rem"} color={getTypeColor(ex.category)} /></div>
          <div style={{ position: "relative", paddingRight: 72 }}>
            <div style={{ display: "flex", alignItems: "center", gap: S.s6, flexWrap: "wrap", marginBottom: 4 }}>
              <span style={{
                fontFamily: FG.fontCond,
                fontSize: "1.16rem",
                fontWeight: 600,
                letterSpacing: ".02em",
                textTransform: "uppercase",
                lineHeight: 1,
                color: FG.inkBright,
              }}>{ex.name}</span>
              {hasPB && <span style={{
                background: "rgba(232,180,74,.14)",
                border: "1px solid rgba(232,180,74,.3)",
                color: FG.goldSoft,
                fontSize: FS.sm,
                padding: "2px 8px",
                borderRadius: R.r4,
                fontWeight: "700"
              }}>{"ðŸ† PB"}</span>}
            </div>
            <div style={{ display: "flex", gap: S.s8, flexWrap: "wrap", alignItems: "baseline" }}>
              <span style={{
                fontFamily: FG.fontCond,
                fontSize: FS.sm,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: `color-mix(in srgb,${mgColor} 55%,#fff)`,
              }}>{ex.muscleGroup ? ex.muscleGroup.charAt(0).toUpperCase() + ex.muscleGroup.slice(1) : ""}</span>
              {ex.equipment && <span style={{ fontSize: FS.sm, color: "rgba(228,222,211,.5)", textTransform: "capitalize" }}>{"Â· " + ex.equipment}</span>}
              {ex.difficulty && <span style={{ fontSize: FS.sm, fontWeight: 700, color: diffColor(ex.difficulty) }}>{"Â· " + ex.difficulty}</span>}
            </div>
          </div>
        </div>

        {/* Stat chips â€” Base XP / Tier / Your PB. */}
        <div style={{ display: "flex", gap: S.s8, marginBottom: S.s10 }}>
          {statChip("Base XP", `${ex.baseXP}`, true)}
          {statChip("Tier", ex.difficulty || "â€”")}
          {statChip("Your PB", pbText(pb, profile.units))}
        </div>

        {/* About | Form | History */}
        <div style={{
          display: "flex",
          gap: 3,
          padding: 3,
          borderRadius: R.xxl,
          background: "rgba(255,255,255,.045)",
          border: `1px solid ${FG.glassBorder}`,
          marginBottom: S.s12,
        }}>
          {subtabBtn("about", "About")}
          {subtabBtn("form", "Form")}
          {subtabBtn("history", "History")}
        </div>

        {subtab === "about" && <div>
          {ex.desc ? <p style={{
            fontSize: FS.fs78,
            color: "rgba(228,222,211,.68)",
            lineHeight: 1.55,
            marginBottom: S.s12
          }}>{ex.desc}</p> : <div style={{
            fontSize: FS.lg,
            color: "#9a9488",
            fontStyle: "italic",
            marginBottom: S.s12
          }}>{"No description yet."}</div>}

          {ex.pbType && <div style={{
            background: FG.glassBgSoft,
            border: `1px solid ${FG.glassBorder}`,
            borderRadius: R.lg,
            padding: "8px 12px",
            marginBottom: S.s12,
            fontSize: FS.lg,
            color: "#9a9488"
          }}>
            <span style={{ color: "#b4ac9e", fontWeight: "700" }}>{"PB: "}</span>{ex.pbType}
            {ex.pbTier === "Leaderboard" && <span style={{
              marginLeft: S.s8,
              color: FG.goldSoft,
              fontSize: FS.fs65
            }}>{"ðŸ† Leaderboard"}</span>}
          </div>}
        </div>}

        {subtab === "form" && <div style={{ marginBottom: S.s12 }}>
          {Array.isArray(ex.tips) && ex.tips.length > 0 ? ex.tips.map((tip, i) => <div key={i} style={{
            display: "flex",
            gap: S.s10,
            padding: "10px 12px",
            borderRadius: R.xxl,
            background: FG.glassBgSoft,
            border: `1px solid ${FG.glassBorder}`,
            marginBottom: S.s6,
          }}>
            <span style={{
              flexShrink: 0,
              width: 20,
              height: 20,
              borderRadius: R.md,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FG.fontCond,
              fontSize: FS.sm,
              fontWeight: 600,
              color: "#0A0A0C",
              background: `color-mix(in srgb,${mgColor} 80%,#fff)`,
            }}>{i + 1}</span>
            <span style={{ fontSize: FS.lg, lineHeight: 1.5, color: "rgba(228,222,211,.7)" }}>{tip}</span>
          </div>) : <div style={{
            padding: "18px 12px",
            borderRadius: R.xxl,
            border: "1px dashed rgba(255,255,255,.15)",
            textAlign: "center",
            fontSize: FS.lg,
            color: "#9a9488",
            fontStyle: "italic",
          }}>{"No form guide for this exercise yet."}</div>}
        </div>}

        {subtab === "history" && <div style={{ marginBottom: S.s12 }}>
          {history.length === 0 ? <div style={{
            padding: "18px 12px",
            borderRadius: R.xxl,
            border: "1px dashed rgba(255,255,255,.15)",
            textAlign: "center",
            fontSize: FS.lg,
            color: "#9a9488",
            fontStyle: "italic",
          }}>{"No logged sessions yet â€” Configure below to forge the first."}</div> : <>
            <div style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 5,
              height: 96,
              padding: "10px 12px",
              borderRadius: 14,
              background: FG.glassBgSoft,
              border: `1px solid ${FG.glassBorder}`,
            }}>
              {history.map((h, i) => {
                const v = h.weightLbs != null ? h.weightLbs : h.xp;
                const isLast = i === history.length - 1;
                const day = h.dateKey ? new Date(h.dateKey + "T12:00:00").toLocaleDateString(undefined, { weekday: "narrow" }) : "Â·";
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, justifyContent: "flex-end", height: "100%" }}>
                    <span style={{ fontFamily: FG.fontCond, fontSize: FS.fs48, color: isLast ? FG.goldGlow : "rgba(228,222,211,.4)" }}>{v}</span>
                    <span style={{
                      width: "100%",
                      borderRadius: "3px 3px 1px 1px",
                      height: barH(v),
                      background: isLast ? "rgba(232,180,74,.85)" : `color-mix(in srgb,${mgColor} 65%,transparent)`,
                    }} />
                    <span style={{ fontFamily: FG.fontCond, fontSize: FS.fs44, letterSpacing: ".06em", color: "rgba(228,222,211,.3)" }}>{day}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: S.s8, marginTop: S.s8 }}>
              <div style={{ flex: 1, padding: "8px 10px", borderRadius: R.xxl, background: FG.glassBgSoft, border: `1px solid ${FG.glassBorder}` }}>
                <div style={{ fontFamily: FG.fontSerif, fontSize: FS.fs44, letterSpacing: ".24em", textTransform: "uppercase", color: "rgba(228,222,211,.4)", marginBottom: 3 }}>{"Last session"}</div>
                <div style={{ fontFamily: FG.fontCond, fontSize: FS.xl, fontWeight: 600, color: FG.ink, lineHeight: 1 }}>
                  {lastRow ? `${lastRow.sets}Ã—${lastRow.reps}${lastRow.weightLbs != null ? " Â· " + (displayWt(lastRow.weightLbs, profile.units) || "") : ""}` : "â€”"}
                </div>
              </div>
              <div style={{ flex: 1, padding: "8px 10px", borderRadius: R.xxl, background: "rgba(143,227,210,.07)", border: "1px solid rgba(143,227,210,.2)" }}>
                <div style={{ fontFamily: FG.fontSerif, fontSize: FS.fs44, letterSpacing: ".24em", textTransform: "uppercase", color: "rgba(143,227,210,.7)", marginBottom: 3 }}>{"Trend"}</div>
                <div style={{ fontFamily: FG.fontCond, fontSize: FS.xl, fontWeight: 600, color: FG.teal, lineHeight: 1 }}>
                  {trendDelta == null ? "â€”" : trendDelta === 0 ? "Holding steady" : `${trendDelta > 0 ? "â–² +" : "â–¼ "}${Math.abs(trendDelta)} lbs`}
                </div>
              </div>
            </div>
          </>}
        </div>}

        <button onClick={() => setProfile(p => ({
          ...p,
          favoriteExercises: (p.favoriteExercises || []).includes(ex.id)
            ? (p.favoriteExercises || []).filter(i => i !== ex.id)
            : [...(p.favoriteExercises || []), ex.id]
        }))} style={{
          ...GLASS_BTN,
          background: isFav ? "rgba(232,180,74,.12)" : FG.glassBgSoft,
          border: `1px solid ${isFav ? "rgba(232,180,74,.35)" : FG.glassBorder}`,
          color: isFav ? FG.goldSoft : "#b4ac9e",
        }}>{isFav ? "â­ Saved to Favorites" : "â˜† Save to Favorites"}</button>

        {/* Staging was reachable only from a list in select mode, so the sheet
            â€” the one place showing enough detail to actually decide â€” couldn't
            add to the basket it was deciding for. */}
        {ex.id !== "rest_day" && toggleCart && (
          <button
            type="button"
            aria-pressed={!!staged}
            onClick={() => toggleCart(ex.id)}
            style={{
              ...GLASS_BTN,
              marginTop: S.s8,
              background: staged ? "rgba(196,148,40,.16)" : FG.glassBgSoft,
              border: `1px solid ${staged ? "rgba(196,148,40,.42)" : FG.glassBorder}`,
              color: staged ? "#e8d08a" : "#b4ac9e",
            }}
          >{staged ? "âŠŸ Staged â€” tap to remove" : "âŠž Stage for later"}</button>
        )}
        {/* The tray sits at z-index 780 and the sheet at 9400, so staging from
            here updates a bar the user cannot see. Report the count inline
            rather than leaving the button's own state as the only signal. */}
        {ex.id !== "rest_day" && toggleCart && stagedCount > 0 && (
          <div role="status" style={{
            fontSize: FS.fs62,
            color: "#9a9488",
            textAlign: "center",
            marginTop: S.s4
          }}>{`In staging tray Â· ${stagedCount}`}</div>
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
            ...GLASS_BTN,
            flex: 1,
            width: "auto",
            padding: "10px",
            fontWeight: "600",
            fontSize: FS.lg,
            textAlign: "center",
          }}>{"ðŸ’ª Add to Workout"}</button>}

          <button onClick={() => {
            // Via the shared opener, which also seeds spwSelected â€” opening
            // the wizard without it left Save refusing with "Select at least
            // one exercise", or worse, silently reusing a previous run's
            // selection.
            openSavePlanWizard([planEntry(ex, profile.chosenClass, allExById)], ex.name, ex.name);
            close();
          }} style={{
            ...GLASS_BTN,
            flex: 1,
            width: "auto",
            padding: "10px",
            fontWeight: "600",
            fontSize: FS.lg,
            textAlign: "center",
          }}>{"ðŸ“‹ Add to Plan"}</button>
        </div>

        {/* Opens the quick-log sheet in place â€” the log form is a root portal
            with no tab dependency, so the user stays on whatever tab they
            came from and "â† Back" (origin-aware) returns to this sheet. */}
        <button onClick={() => {
          openQuickLog(ex.id, { origin: { type: "detail", ex } });
          close();
        }} style={{
          width: "100%",
          marginTop: S.s8,
          background: "linear-gradient(160deg,rgba(143,227,210,.28),rgba(143,227,210,.1))",
          border: "1px solid rgba(143,227,210,.42)",
          color: "#D6F7EF",
          padding: "12px",
          borderRadius: R.xxl,
          fontFamily: FG.fontCond,
          fontWeight: "600",
          fontSize: FS.xxl,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          cursor: "pointer",
          textAlign: "center"
        }}>{"âš™ Configure"}</button>
      </div>
    </Sheet>
  );
});

export default ExerciseDetailSheet;
