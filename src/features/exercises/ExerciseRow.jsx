import React, { memo } from 'react';
import { getMuscleColor, getTypeColor } from '../../utils/xp';
import { ExIcon } from '../../components/ExIcon';
import { S, R, FS } from '../../utils/tokens';
import { muscleLabel, equipLabel } from './exerciseFilterOptions';

/**
 * The exercise list row, shared by the library tab and the workout-builder
 * picker.
 *
 * These were two hand-written copies that had already drifted — the library
 * showed equipment and a favourite star, the picker a "custom" badge — and
 * both were a plain `<div>` with an `onClick`, so the entire exercise list was
 * unreachable by keyboard and announced as nothing in particular.
 *
 * Accessibility approach: the row stays a layout container and the primary
 * action is a real `<button>` wrapping the name, stretched over the whole row
 * by an absolutely-positioned `::after`. That gives correct semantics and a
 * focus ring without nesting the favourite button inside another button (which
 * is invalid, and hides the inner control from assistive tech), and without
 * changing a single box in the layout — the overlay is out of flow.
 */

// Prefer the stored difficulty, fall back to XP tiers. Was duplicated verbatim
// in both call sites.
function difficultyOf(ex) {
  return ex.difficulty || (ex.baseXP >= 60 ? "Advanced" : ex.baseXP >= 45 ? "Intermediate" : "Beginner");
}
const DIFF_FG = { Advanced: "#7A2838", Beginner: "#5A8A58", Intermediate: "#A8843C" };
const DIFF_BG = { Advanced: "#2e1515", Beginner: "#1a2e1a", Intermediate: "#2e2010" };

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const ExerciseRow = memo(function ExerciseRow({
  ex,
  onActivate,
  selected = false,
  // Selection semantics: when the row toggles membership rather than opening
  // something, it reports pressed state instead of acting as a plain button.
  selectable = false,
  // Optional trimmings — the two call sites want different subsets.
  showEquipment = false,
  showPB = false,
  showCustomBadge = false,
  isFav,
  onToggleFav,
  // react-window hands the virtualised picker a positioning style plus its own
  // aria wiring; the library list passes a scroll-reveal ref instead.
  style,
  rowRef,
  className = "",
  ...rest
}) {
  const diffLabel = difficultyOf(ex);
  const mg = getMuscleColor(ex.muscleGroup);

  // What a screen reader hears instead of an undifferentiated "button". The
  // trophy is aria-hidden, so the personal best has to be said here or it is
  // invisible to anyone not looking at the icon.
  const label = [
    ex.name,
    showPB ? 'personal best' : null,
    ex.category && cap(ex.category),
    ex.muscleGroup && muscleLabel(ex.muscleGroup),
    showEquipment && ex.equipment && ex.equipment !== "bodyweight" ? equipLabel(ex.equipment) : null,
    `${ex.baseXP} XP`,
    diffLabel,
  ].filter(Boolean).join(', ');

  return (
    <div
      ref={rowRef}
      className={`picker-ex-row stretch-row${selected ? " sel" : ""}${className ? " " + className : ""}`}
      style={{ ...style, "--mg-color": mg }}
      {...rest}
    >
      <div className={"picker-ex-orb"}><ExIcon ex={ex} size={"1rem"} color={"#d4cec4"} /></div>

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
            aria-label={label}
            aria-pressed={selectable ? selected : undefined}
            onClick={onActivate}
            style={{
              fontSize: FS.fs83,
              fontWeight: 600,
              color: "#d4cec4",
              letterSpacing: ".01em"
            }}
          >{ex.name}</button>
          {showPB && <span aria-hidden="true" style={{ fontSize: FS.sm }}>{"🏆"}</span>}
          {showCustomBadge && ex.custom && (
            <span className={"custom-ex-badge"} style={{ marginLeft: S.s4 }}>{"custom"}</span>
          )}
        </div>

        <div aria-hidden="true" style={{ fontSize: FS.fs62, fontStyle: "italic", lineHeight: 1.4 }}>
          {ex.category && <span style={{ color: getTypeColor(ex.category) }}>{cap(ex.category)}</span>}
          {ex.category && ex.muscleGroup && <span style={{ color: "#8a8478" }}>{" · "}</span>}
          {ex.muscleGroup && <span style={{ color: mg }}>{muscleLabel(ex.muscleGroup)}</span>}
          {showEquipment && ex.equipment && ex.equipment !== "bodyweight" && <>
            <span style={{ color: "#8a8478" }}>{" · "}</span>
            <span style={{ color: "#8a8478" }}>{equipLabel(ex.equipment)}</span>
          </>}
        </div>
      </div>

      <div style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: S.s6
      }}>
        <span aria-hidden="true" style={{
          fontSize: FS.fs66,
          fontWeight: 700,
          color: "#b4ac9e",
          letterSpacing: ".02em"
        }}>{ex.baseXP + " XP"}</span>

        <span aria-hidden="true" style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "2px 8px",
          borderRadius: R.r4,
          fontSize: FS.fs58,
          fontWeight: 700,
          letterSpacing: ".05em",
          color: DIFF_FG[diffLabel] || DIFF_FG.Intermediate,
          background: DIFF_BG[diffLabel] || DIFF_BG.Intermediate
        }}>{diffLabel}</span>

        {onToggleFav && (
          <button
            type="button"
            className={"picker-ex-fav"}
            aria-pressed={!!isFav}
            aria-label={isFav ? `Remove ${ex.name} from favourites` : `Add ${ex.name} to favourites`}
            onClick={e => { e.stopPropagation(); onToggleFav(ex.id); }}
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
        )}
      </div>
    </div>
  );
});

export default ExerciseRow;
