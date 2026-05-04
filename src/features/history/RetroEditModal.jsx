import React, { memo } from 'react';
import { createPortal } from 'react-dom';
import { uid } from '../../utils/helpers';
import { calcExXP } from '../../utils/xp';
import { S, FS, R } from '../../utils/tokens';

/**
 * Retro-edit modal — extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Rendered when retroEditModal is non-null. Lets the user correct sets/reps/
 * weight on a previously logged workout session and recalculate XP in place.
 * Uses createPortal to render into document.body.
 */

const RetroEditModal = memo(function RetroEditModal({
  // Modal trigger state
  retroEditModal,
  setRetroEditModal,
  // Data
  allExById,
  profile,
  // Callbacks
  setProfile,
  showToast,
}) {
  const rem = retroEditModal;

  return createPortal(
    <div className={"modal-backdrop"} onClick={() => setRetroEditModal(null)}>
      <div className={"modal-sheet"} onClick={e => e.stopPropagation()} style={{ borderRadius: R.r16, padding: S.s0, maxHeight: "85vh", overflowY: "auto" }}>
        <div className={"modal-body"}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: S.s12 }}>
            <div style={{ fontSize: FS.fs90, color: "#d4cec4", fontFamily: "'Inter',sans-serif", fontWeight: 600 }}>
              {"✎ Edit Completed "}{rem.sourceType === "plan" ? "Plan Session" : "Workout"}
            </div>
            <button className={"btn btn-ghost btn-sm"} onClick={() => setRetroEditModal(null)}>{"✕"}</button>
          </div>

          {/* Subtitle */}
          <div style={{ fontSize: FS.fs65, color: "#8a8478", marginBottom: S.s14, lineHeight: 1.5 }}>
            {rem.sourceName}{" · "}{rem.entries?.[0]?.date}{" · Editing will recalculate XP and update your log."}
          </div>

          {/* Exercise list — editable */}
          <div style={{ marginBottom: S.s12 }}>
            {rem.entries.map((e, i) => {
              const exData = allExById[e.exId];
              if (!exData) return null;
              return (
                <div key={i} style={{ background: "rgba(45,42,36,.18)", border: "1px solid rgba(45,42,36,.2)", borderRadius: R.lg, padding: "10px 12px", marginBottom: S.s6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: S.s8, marginBottom: S.s6 }}>
                    <span style={{ fontSize: "1rem" }}>{exData.icon}</span>
                    <span style={{ fontSize: FS.fs78, color: "#d4cec4", flex: 1, fontWeight: 600 }}>{exData.name}</span>
                    <button className={"btn btn-danger btn-xs"} onClick={() => {
                      setRetroEditModal(prev => ({ ...prev, entries: prev.entries.filter((_, j) => j !== i) }));
                    }}>{"✕"}</button>
                  </div>
                  <div style={{ display: "flex", gap: S.s6 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: FS.fs58, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Sets"}</label>
                      <input className={"inp"} type={"number"} min={"1"} max={"20"} value={e.sets || ""} style={{ padding: "4px 6px", fontSize: FS.lg }} onChange={ev => {
                        const v = ev.target.value;
                        setRetroEditModal(prev => ({ ...prev, entries: prev.entries.map((r, j) => j === i ? { ...r, sets: v } : r) }));
                      }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: FS.fs58, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Reps/Min"}</label>
                      <input className={"inp"} type={"number"} min={"1"} max={"300"} value={e.reps || ""} style={{ padding: "4px 6px", fontSize: FS.lg }} onChange={ev => {
                        const v = ev.target.value;
                        setRetroEditModal(prev => ({ ...prev, entries: prev.entries.map((r, j) => j === i ? { ...r, reps: v } : r) }));
                      }} />
                    </div>
                    {!["cardio", "flexibility"].includes(exData.category) && (
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: FS.fs58, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Weight"}</label>
                        <input className={"inp"} type={"number"} min={"0"} max={"2000"} value={e.weightLbs || ""} style={{ padding: "4px 6px", fontSize: FS.lg }} onChange={ev => {
                          const v = ev.target.value;
                          setRetroEditModal(prev => ({ ...prev, entries: prev.entries.map((r, j) => j === i ? { ...r, weightLbs: v || null } : r) }));
                        }} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: S.s8 }}>
            <button className={"btn btn-ghost btn-sm"} style={{ flex: 1 }} onClick={() => setRetroEditModal(null)}>{"Cancel"}</button>
            <button className={"btn btn-gold"} style={{ flex: 2 }} onClick={() => {
              const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              const newEntries = rem.entries.map((e, i) => {
                const updated = retroEditModal.entries[i];
                if (!updated) return null;
                const xp = calcExXP(updated.exId, parseInt(updated.sets) || 3, parseInt(updated.reps) || 10, profile.chosenClass, allExById);
                return { ...e, ...updated, xp, sets: parseInt(updated.sets) || e.sets, reps: parseInt(updated.reps) || e.reps };
              }).filter(Boolean);
              const updatedLog = profile.log.map(le => {
                const matchIdx = rem.entries.findIndex(re => re._idx === le._idx || (re.exId === le.exId && re.dateKey === le.dateKey && (re.sourceGroupId === le.sourceGroupId || re.sourcePlanId === le.sourcePlanId)));
                if (matchIdx < 0) return le;
                const ne = newEntries[matchIdx];
                return ne ? { ...le, ...ne } : le;
              });
              setProfile(p => ({ ...p, log: updatedLog }));
              setRetroEditModal(null);
              showToast("✓ Workout log updated!");
            }}>{"✓ Save Changes"}</button>
          </div>

        </div>
      </div>
    </div>,
    document.body
  );
});

export default RetroEditModal;
