import React, { memo } from 'react';
import { createPortal } from 'react-dom';
import { S, R, FS } from '../../utils/tokens';
import { isMetric, lbsToKg, kgToLbs, miToKm, kmToMi, weightLabel, distLabel } from '../../utils/units';
import { calcExXP } from '../../utils/xp';
import { HR_ZONES, UI_COLORS } from '../../data/constants';

/**
 * Log-entry edit modal — extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Rendered when logEditModal is non-null. Lets the user patch sets/reps/weight/
 * distance/HR zone and shows a live XP diff before saving.
 * Uses createPortal to render into document.body.
 */

const LogEntryEditModal = memo(function LogEntryEditModal({
  // Modal trigger state
  logEditModal,
  setLogEditModal,
  // Draft entry
  logEditDraft,
  setLogEditDraft,
  // Data
  allExById,
  profile,
  // Callbacks
  saveLogEdit,
  deleteLogEntryByIdx,
}) {
  const d = logEditDraft;
  const setD = patch => setLogEditDraft(prev => ({ ...prev, ...patch }));

  const exData = allExById[d.exId];
  const isCardio = exData ? exData.category === "cardio" : false;
  const isFlex   = exData ? exData.category === "flexibility" : false;
  const showWeight = !isCardio && !isFlex;
  const showDist   = isCardio;
  const showZone   = isCardio;

  const metric = isMetric(profile.units);
  const wUnit  = weightLabel(profile.units);
  const dUnit  = distLabel(profile.units);

  function calcEntryXP(entry) {
    const ex = allExById[entry.exId];
    if (!ex) return entry.xp;
    const rv = parseInt(entry.reps) || 1;
    const sv = parseInt(entry.sets) || 1;
    const effectiveW = parseFloat(entry.weightLbs) || 0;
    const distMi = entry.distanceMi || null;
    const isC = ex.category === "cardio";
    return calcExXP(ex.id, sv, rv, profile.chosenClass, allExById, distMi, effectiveW || null, isC ? entry.hrZone || null : null);
  }

  const previewXP = calcEntryXP(d);
  const xpDiff = previewXP - (profile.log?.[logEditModal.idx]?.xp || 0);

  return createPortal(
    <div className={"ledit-backdrop"} onClick={() => setLogEditModal(null)}>
      <div className={"ledit-sheet"} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "'Inter',sans-serif", fontSize: FS.fs88, color: "#d4cec4" }}>
              {"✎ Edit Log Entry"}
            </div>
            <div style={{ fontSize: FS.fs65, color: "#8a8478", marginTop: S.s2 }}>
              {d.icon}{" "}{d.exercise}
            </div>
          </div>
          <button className={"btn btn-ghost btn-sm"} onClick={() => setLogEditModal(null)}>{"✕"}</button>
        </div>

        {/* Source info */}
        {(d.sourcePlanName || d.sourceWorkoutName) && (
          <div style={{ fontSize: FS.fs65, color: "#8a8478", fontStyle: "italic", padding: "6px 10px", background: "rgba(45,42,36,.12)", borderRadius: R.r7, border: "1px solid rgba(45,42,36,.2)" }}>
            {d.sourcePlanName && <span>{"📋 From plan: "}<b style={{ color: "#b4ac9e" }}>{d.sourcePlanName}</b></span>}
            {d.sourceWorkoutName && <span>{"💪 From workout: "}<b style={{ color: UI_COLORS.accent }}>{d.sourceWorkoutName}</b></span>}
          </div>
        )}

        {/* Date */}
        <div className={"field"}>
          <label>{"Date"}</label>
          <input className={"inp"} type={"date"} value={d.dateKey || ""} onChange={e => {
            const v = e.target.value;
            const disp = v ? new Date(v + "T12:00:00").toLocaleDateString() : d.date;
            setD({ dateKey: v, date: disp });
          }} />
        </div>

        {/* Sets + Reps/Duration */}
        <div className={"r2"}>
          <div className={"field"}>
            <label>{"Sets"}</label>
            <input className={"inp"} type={"number"} min={"1"} max={"99"} value={d.sets || 1}
              onChange={e => setD({ sets: parseInt(e.target.value) || 1 })} />
          </div>
          <div className={"field"}>
            <label>{isCardio || isFlex ? "Duration (min)" : "Reps"}</label>
            <input className={"inp"} type={"number"} min={"1"} max={"999"} value={d.reps || 1}
              onChange={e => setD({ reps: parseInt(e.target.value) || 1 })} />
          </div>
        </div>

        {/* Weight */}
        {showWeight && (
          <div className={"field"}>
            <label>{"Weight ("}{wUnit}{")"}</label>
            <input className={"inp"} type={"number"} min={"0"} step={"2.5"}
              value={d.weightLbs ? metric ? lbsToKg(d.weightLbs) : d.weightLbs : ""}
              placeholder={"0"}
              onChange={e => {
                const v = parseFloat(e.target.value) || null;
                setD({ weightLbs: v ? metric ? parseFloat(kgToLbs(v)) : v : null });
              }} />
          </div>
        )}

        {/* Distance */}
        {showDist && (
          <div className={"field"}>
            <label>{"Distance ("}{dUnit}{")"}</label>
            <input className={"inp"} type={"number"} min={"0"} step={"0.1"}
              value={d.distanceMi ? metric ? miToKm(d.distanceMi) : d.distanceMi : ""}
              placeholder={"0"}
              onChange={e => {
                const v = parseFloat(e.target.value) || null;
                setD({ distanceMi: v ? metric ? parseFloat(kmToMi(v)) : v : null });
              }} />
          </div>
        )}

        {/* HR Zone */}
        {showZone && (
          <div className={"field"}>
            <label>{"HR Zone"}</label>
            <div className={"hr-zone-row"}>
              {HR_ZONES.map((z, zi) => {
                const zn = zi + 1;
                return (
                  <div key={zn} className={`hr-zone-btn ${d.hrZone === zn ? "sel" : ""}`}
                    style={{ "--zc": z.color, borderColor: d.hrZone === zn ? z.color : "rgba(45,42,36,.2)" }}
                    onClick={() => setD({ hrZone: d.hrZone === zn ? null : zn })}>
                    <span className={"hz-name"} style={{ color: z.color }}>{"Z"}{zn}</span>
                    <span className={"hz-bpm"}>{z.short}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* XP preview */}
        <div style={{ background: "rgba(45,42,36,.16)", border: "1px solid rgba(180,172,158,.06)", borderRadius: R.xl, padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: FS.md, color: "#8a8478" }}>{"New XP for this entry"}</div>
          <div style={{ display: "flex", alignItems: "center", gap: S.s8 }}>
            {xpDiff !== 0 && (
              <div style={{ fontSize: FS.md, color: xpDiff > 0 ? UI_COLORS.success : UI_COLORS.danger }}>
                {xpDiff > 0 ? "+" : ""}{xpDiff}{" XP"}
              </div>
            )}
            <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "1rem", color: "#b4ac9e" }}>
              {"⚡ "}{previewXP}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: S.s8 }}>
          <button className={"btn btn-danger btn-sm"} style={{ flex: 0, padding: "8px 12px" }}
            onClick={() => {
              setLogEditModal(null);
              deleteLogEntryByIdx(logEditModal.idx);
            }}>{"🗑"}</button>
          <button className={"btn btn-ghost btn-sm"} style={{ flex: 1 }}
            onClick={() => setLogEditModal(null)}>{"Cancel"}</button>
          <button className={"btn btn-gold"} style={{ flex: 2 }}
            onClick={saveLogEdit}>{"✦ Save Changes"}</button>
        </div>

      </div>
    </div>,
    document.body
  );
});

export default LogEntryEditModal;
