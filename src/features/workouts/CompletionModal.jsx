import React, { memo } from 'react';
import { createPortal } from 'react-dom';
import { todayStr } from '../../utils/helpers';
import { calcExXP, getMuscleColor } from '../../utils/xp';
import { formatXP } from '../../utils/format';
import { S, FS } from '../../utils/tokens';

/**
 * Workout completion modal — extracted from the inline IIFE in App.jsx as part
 * of Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Rendered when completionModal is non-null. Lets the user choose whether to
 * log a completed workout (today or a past date) or schedule it for a future
 * date, then confirms and claims XP.
 * Uses createPortal to render into document.body.
 */

const CompletionModal = memo(function CompletionModal({
  // Modal trigger state
  completionModal,
  setCompletionModal,
  // Action / date selection state
  completionAction,
  setCompletionAction,
  completionDate,
  setCompletionDate,
  scheduleWoDate,
  setScheduleWoDate,
  // Data
  profile,
  allExById,
  // Callbacks
  confirmWorkoutComplete,
  scheduleWorkoutForDate,
  setStatsPromptModal,
}) {
  const wo = completionModal.workout;
  const xp = wo.exercises.reduce((s, ex) => s + calcExXP(ex.exId, ex.sets || 3, ex.reps || 10, profile.chosenClass, allExById), 0);
  const firstEx = wo.exercises.map(e => allExById[e.exId]).find(Boolean);
  const woMgColor = getMuscleColor(firstEx?.muscleGroup);
  const inPickMode = completionAction === "past";
  const inScheduleMode = completionAction === "schedule";
  const pickerValue = inPickMode && completionDate !== "pick" ? completionDate : "";

  function dismiss() {
    setCompletionModal(null);
    setCompletionAction("today");
    setScheduleWoDate("");
  }

  return createPortal(
    <div className={"completion-backdrop"} onClick={e => {
      if (e.target !== e.currentTarget) return;
      dismiss();
    }}>
      <div className={"completion-sheet"} role={"dialog"} aria-modal={"true"} aria-label={"Workout completion"} style={{ "--mg-color": woMgColor }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: S.s8 }}>
          {completionModal.fromStats && (
            <button className={"btn btn-ghost btn-sm"} style={{ padding: "4px 8px", fontSize: FS.fs75 }} onClick={() => {
              const prev = completionModal.fromStats;
              setCompletionModal(null);
              setCompletionAction("today");
              setScheduleWoDate("");
              setStatsPromptModal(prev);
            }}>{"← Back"}</button>
          )}
          <div className={"completion-wo-name"} style={{ fontSize: FS.fs90, flex: 1 }}>{"⚔ Complete Deed"}</div>
          <button className={"btn btn-ghost btn-sm"} onClick={dismiss}>{"✕"}</button>
        </div>

        {/* Workout card */}
        <div className={"completion-wo-card"}>
          <span className={"completion-wo-icon"}>{wo.icon}</span>
          <div>
            <div className={"completion-wo-name"}>{wo.name}</div>
            <div className={"completion-wo-sub"}>{wo.exercises.length}{" exercises · "}{formatXP(xp, { prefix: "⚡ " })}</div>
          </div>
        </div>

        {/* Options */}
        <div style={{ display: "flex", flexDirection: "column", gap: S.s8 }}>

          {/* Option 1 — Completed today */}
          <div className={`completion-option ${completionAction === "today" ? "sel" : ""}`} onClick={() => {
            setCompletionAction("today");
            setCompletionDate(todayStr());
          }}>
            <span className={"completion-option-icon"}>{"🔥"}</span>
            <div>
              <div className={"completion-option-title"}>{"Completed Today"}</div>
              <div className={"completion-option-sub"}>{new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</div>
            </div>
            <div style={{ marginLeft: "auto", width: 18, height: 18, border: "1.5px solid rgba(180,172,158,.08)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: FS.md, background: completionAction === "today" ? "rgba(180,172,158,.25)" : "transparent", color: completionAction === "today" ? "#1a1200" : "transparent", flexShrink: 0 }}>{"✓"}</div>
          </div>

          {/* Option 2 — Completed on a past day */}
          <div className={`completion-option ${inPickMode ? "sel" : ""}`} onClick={() => {
            setCompletionAction("past");
            setCompletionDate("");
          }}>
            <span className={"completion-option-icon"}>{"📋"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={"completion-option-title"}>{"Choose Completion Day"}</div>
              <div className={"completion-option-sub"}>{inPickMode && pickerValue ? new Date(pickerValue + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Log for a past date"}</div>
            </div>
            <div style={{ marginLeft: "auto", width: 18, height: 18, border: "1.5px solid rgba(180,172,158,.08)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: FS.md, background: inPickMode && pickerValue ? "rgba(180,172,158,.25)" : "transparent", color: inPickMode && pickerValue ? "#1a1200" : "transparent", flexShrink: 0 }}>{"✓"}</div>
          </div>
          {inPickMode && (
            <div style={{ paddingLeft: 8 }}>
              <input className={"inp"} type={"date"} max={todayStr()} value={pickerValue} onChange={e => setCompletionDate(e.target.value)} style={{ marginTop: S.s2 }} autoFocus={true} />
              {pickerValue && (
                <div style={{ fontSize: FS.fs65, color: "#b4ac9e", marginTop: S.s6 }}>
                  {"📅 "}{new Date(pickerValue + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                </div>
              )}
            </div>
          )}

          {/* Option 3 — Schedule for a future date */}
          <div className={`completion-option ${inScheduleMode ? "sel" : ""}`} onClick={() => {
            setCompletionAction("schedule");
            setScheduleWoDate("");
          }}>
            <span className={"completion-option-icon"}>{"📅"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={"completion-option-title"}>{"Schedule for Later"}</div>
              <div className={"completion-option-sub"}>{inScheduleMode && scheduleWoDate ? new Date(scheduleWoDate + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Add to calendar for a future date"}</div>
            </div>
            <div style={{ marginLeft: "auto", width: 18, height: 18, border: "1.5px solid rgba(180,172,158,.08)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: FS.md, background: inScheduleMode && scheduleWoDate ? "rgba(180,172,158,.25)" : "transparent", color: inScheduleMode && scheduleWoDate ? "#1a1200" : "transparent", flexShrink: 0 }}>{"✓"}</div>
          </div>
          {inScheduleMode && (
            <div style={{ paddingLeft: 8 }}>
              <input className={"inp"} type={"date"} min={(() => {
                const d = new Date();
                d.setDate(d.getDate() + 1);
                return d.toISOString().slice(0, 10);
              })()} value={scheduleWoDate} onChange={e => setScheduleWoDate(e.target.value)} style={{ marginTop: S.s2 }} autoFocus={true} />
              {scheduleWoDate && (
                <div style={{ fontSize: FS.fs65, color: "#b4ac9e", marginTop: S.s6 }}>
                  {"📅 "}{new Date(scheduleWoDate + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* XP preview — only for log actions */}
        {(completionAction === "today" || (inPickMode && pickerValue)) && (
          <div className={"completion-xp-preview"}>
            <div className={"completion-xp-preview-label"}>{"XP to be claimed"}</div>
            <div className={"completion-xp-preview-value"}>{"⚡ "}{xp.toLocaleString()}</div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: S.s8 }}>
          <button className={"btn btn-ghost btn-sm"} style={{ flex: 1 }} onClick={dismiss}>{"Cancel"}</button>
          {!inScheduleMode ? (
            <button className={"btn btn-cls"} style={{ flex: 2 }} disabled={inPickMode && !pickerValue} onClick={() => {
              if (completionModal.soloExCallback) {
                const dateStr = completionAction === "past" && completionDate && completionDate !== "pick" ? completionDate : todayStr();
                completionModal.soloExCallback(dateStr);
                setCompletionModal(null);
                setCompletionDate("");
                setCompletionAction("today");
                setScheduleWoDate("");
              } else {
                confirmWorkoutComplete();
              }
            }}>{"✓ Confirm & Claim XP"}</button>
          ) : (
            <button className={"btn btn-gold"} style={{ flex: 2 }} disabled={!scheduleWoDate} onClick={() => {
              if (completionModal.soloExScheduleCallback) {
                completionModal.soloExScheduleCallback(scheduleWoDate);
              } else {
                scheduleWorkoutForDate();
              }
            }}>{"📅 Schedule Workout"}</button>
          )}
        </div>

      </div>
    </div>,
    document.body
  );
});

export default CompletionModal;
