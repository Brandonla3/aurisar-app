import React, { memo } from 'react';
import { UI_COLORS, NO_SETS_EX_IDS, RUNNING_EX_ID, HR_ZONES } from '../../data/constants';
import { calcExXP, getMuscleColor, hrRange } from '../../utils/xp';
import { isMetric, kgToLbs, lbsToKg, kmToMi, miToKm, weightLabel, distLabel, pctToSlider, sliderToPct } from '../../utils/units';
import { normalizeHHMM, combineHHMMSec } from '../../utils/time';
import { ExIcon } from '../../components/ExIcon';
import { S, R, FS } from '../../utils/tokens';

/**
 * Single-exercise quick-log modal — extracted from the inline IIFE in
 * App.jsx as part of Finding #6 (App.jsx decomposition) per
 * docs/performance-audit.md (PR #116).
 *
 * Rendered when selEx is non-null (an exercise ID is selected for logging).
 * All state and callbacks come in as props; no internal hooks.
 */

const QuickLogModal = memo(function QuickLogModal({
  // Selected exercise
  selEx,
  setSelEx,
  // Exercise data
  allExById,
  // Profile
  profile,
  // Log form state
  sets, setSets,
  reps, setReps,
  exWeight, setExWeight,
  exHHMM, setExHHMM,
  exSec, setExSec,
  distanceVal, setDistanceVal,
  hrZone, setHrZone,
  exIncline, setExIncline,
  exSpeed, setExSpeed,
  quickRows, setQuickRows,
  weightPct, setWeightPct,
  pendingSoloRemoveId, setPendingSoloRemoveId,
  // Action callbacks
  logExercise,
  openExEditor,
  setLibDetailEx,
  setAddToWorkoutPicker,
  setSavePlanWizard,
  setSpwSelected,
  setSpwName,
  setSpwIcon,
  setSpwDate,
  setSpwMode,
  setSpwTargetPlanId,
}) {
  const ex = allExById[selEx];
  if (!ex) return null;

  const metric = isMetric(profile.units);
  const isCardio = ex.category === "cardio";
  const isFlex = ex.category === "flexibility";
  const showWeight = !isCardio && !isFlex;
  const showHR = isCardio;
  const showDist = isCardio;
  const noSets = NO_SETS_EX_IDS.has(ex.id);
  const isRunning = ex.id === RUNNING_EX_ID;
  const isTreadmill = ex.hasTreadmill || false;
  const age = profile.age || 30;

  const rawW = parseFloat(exWeight || 0);
  const wLbs = metric ? parseFloat(kgToLbs(rawW) || 0) : rawW;
  const effW = wLbs;
  const wUnit = weightLabel(profile.units);
  const dUnit = distLabel(profile.units);

  const rawDist = parseFloat(distanceVal || 0);
  const distMi = rawDist > 0 ? metric ? parseFloat(kmToMi(rawDist)) : rawDist : 0;

  const pbPaceMi = profile.runningPB || null;
  const pbDisp = pbPaceMi
    ? metric ? `${(pbPaceMi / 1.60934).toFixed(2)} min/km` : `${pbPaceMi.toFixed(2)} min/mi`
    : null;
  const exPB4 = (profile.exercisePBs || {})[ex.id] || null;
  const pbWeightDisp = v => (metric ? parseFloat(lbsToKg(v)).toFixed(1) : v) + (metric ? " kg" : " lbs");
  const exPBDisp4 = exPB4
    ? exPB4.type === "Cardio Pace" ? metric ? (exPB4.value / 1.60934).toFixed(2) + " min/km" : exPB4.value.toFixed(2) + " min/mi"
    : exPB4.type === "Assisted Weight" ? "1RM: " + pbWeightDisp(exPB4.value) + " (Assisted)"
    : exPB4.type === "Max Reps Per 1 Set" ? exPB4.value + " reps"
    : exPB4.type === "Longest Hold" || exPB4.type === "Fastest Time" ? parseFloat(exPB4.value.toFixed(2)) + " min"
    : exPB4.type === "Heaviest Weight" ? pbWeightDisp(exPB4.value)
    : "1RM: " + pbWeightDisp(exPB4.value)
    : null;

  const durationMin = parseFloat(reps || 0);
  const runPace = isRunning && distMi > 0 && durationMin > 0 ? durationMin / distMi : null;
  const runBoostPct = runPace ? runPace <= 8 ? 20 : 5 : 0;

  const estXP = (() => {
    const sv = noSets ? 1 : parseInt(sets) || 0;
    const rv = isCardio || isFlex
      ? Math.max(1, Math.floor(combineHHMMSec(exHHMM, exSec) / 60) || parseInt(reps) || 1)
      : parseInt(reps) || 0;
    const extraCount = quickRows.length;
    const hrZ = showHR ? hrZone : null;
    const baseXP = calcExXP(ex.id, sv, rv, profile.chosenClass, allExById, distMi || null, effW || null, hrZ, extraCount);
    const rowsXP = quickRows.reduce((s, row) => {
      const rs = noSets ? 1 : parseInt(row.sets) || sv;
      const rr = isCardio || isFlex
        ? Math.max(1, Math.floor(combineHHMMSec(row.hhmm || "", row.sec || "") / 60)) || rv
        : parseInt(row.reps) || rv;
      return s + calcExXP(ex.id, rs, rr, profile.chosenClass, allExById, parseFloat(row.dist) || distMi || null, effW || null, hrZ, extraCount);
    }, 0);
    return (baseXP + rowsXP).toLocaleString();
  })();

  const dismiss = () => {
    setSelEx(null);
    setExHHMM("");
    setExSec("");
    setQuickRows([]);
    setPendingSoloRemoveId(null);
  };

  try {
    return (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.78)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
        onClick={dismiss}
      >
        <div
          className={"sheet-slide-up"}
          style={{ width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(160deg,#0c0c0a,#0c0c0a)", border: "1px solid rgba(180,172,158,.06)", borderRadius: "18px 18px 0 0", padding: "0 0 24px" }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: S.s8 }}>
              <button className={"btn btn-ghost btn-sm"} style={{ padding: "4px 8px", fontSize: FS.fs75 }} onClick={() => {
                dismiss();
                setLibDetailEx(ex);
              }}>{"← Back"}</button>
              <div style={{ fontSize: FS.fs95, color: "#d4cec4", fontFamily: "'Inter',sans-serif", fontWeight: 600 }}>{ex.icon}{" "}{ex.name}</div>
            </div>
            <button className={"btn btn-ghost btn-sm"} onClick={dismiss}>{"✕"}</button>
          </div>

          <div style={{ padding: "0 14px" }}>
            <div className={"log-form"}>
              {/* Rest day */}
              {ex.id === "rest_day" && (
                <div style={{ textAlign: "center", padding: "18px 0", color: "#8a8478", fontSize: FS.fs78, fontStyle: "italic" }}>{"🛌 Rest day — no stats to track. Recover well!"}</div>
              )}

              {/* Top row: Sets/Reps or Duration+Sec+Dist + Weight */}
              {ex.id !== "rest_day" && (
                <div style={{ display: "flex", gap: S.s6, marginBottom: S.s8, alignItems: "flex-end" }}>
                  {!noSets && !(isCardio || isFlex) && (
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: FS.sm, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Sets"}</label>
                      <input className={"inp"} style={{ padding: "6px 8px", textAlign: "center" }} type={"number"} min={"0"} max={"20"} value={sets} onChange={e => setSets(e.target.value)} placeholder={""} />
                    </div>
                  )}
                  {isCardio || isFlex ? (
                    <>
                      <div style={{ flex: 2 }}>
                        <label style={{ fontSize: FS.sm, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Duration (HH:MM)"}</label>
                        <input className={"inp"} style={{ padding: "6px 8px", textAlign: "center" }} type={"text"} inputMode={"numeric"} value={exHHMM} onChange={e => setExHHMM(e.target.value)} onBlur={e => {
                          const norm = normalizeHHMM(e.target.value);
                          setExHHMM(norm);
                          const sec = combineHHMMSec(norm, exSec);
                          if (sec) setReps(String(Math.max(1, Math.floor(sec / 60))));
                        }} placeholder={"00:00"} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: FS.sm, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Seconds"}</label>
                        <input className={"inp"} style={{ padding: "6px 8px", textAlign: "center" }} type={"number"} min={"0"} max={"59"} value={exSec} onChange={e => {
                          setExSec(e.target.value);
                          const sec = combineHHMMSec(exHHMM, e.target.value);
                          if (sec) setReps(String(Math.max(1, Math.floor(sec / 60))));
                        }} placeholder={"00"} />
                      </div>
                      {showDist && (
                        <div style={{ flex: 1.5 }}>
                          <label style={{ fontSize: FS.sm, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Dist ("}{dUnit}{")"}</label>
                          <input className={"inp"} style={{ padding: "6px 8px", textAlign: "center" }} type={"number"} min={"0"} max={"200"} step={"0.1"} value={distanceVal} onChange={e => setDistanceVal(e.target.value)} placeholder={"0.0"} />
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: FS.sm, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Reps"}</label>
                        <input className={"inp"} style={{ padding: "6px 8px", textAlign: "center" }} type={"number"} min={"0"} max={"200"} value={reps} onChange={e => setReps(e.target.value)} placeholder={""} />
                      </div>
                      {showWeight && (
                        <div style={{ flex: 1.5 }}>
                          <label style={{ fontSize: FS.sm, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Weight ("}{wUnit}{")"}</label>
                          <input className={"inp"} style={{ padding: "6px 8px", textAlign: "center" }} type={"number"} min={"0"} max={"2000"} step={metric ? "0.5" : "2.5"} value={exWeight} onChange={e => setExWeight(e.target.value)} placeholder={metric ? "60" : "135"} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Extra rows */}
              {ex.id !== "rest_day" && (
                <div style={{ marginBottom: S.s8 }}>
                  {quickRows.map((row, ri) => (
                    <div key={ri} style={{ display: "flex", gap: S.s4, marginBottom: S.s4, padding: "6px 8px", background: "rgba(45,42,36,.18)", borderRadius: R.md, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: FS.sm, color: "#a09080", flexShrink: 0, minWidth: 18 }}>{isCardio || isFlex ? `I${ri + 2}` : `S${ri + 2}`}</span>
                      {isCardio || isFlex ? (
                        <>
                          <input className={"inp"} style={{ flex: 1.5, minWidth: 52, padding: "4px 8px", fontSize: FS.lg }} type={"text"} inputMode={"numeric"} placeholder={"HH:MM"} defaultValue={row.hhmm || ""} onBlur={e => { const rr = [...quickRows]; rr[ri] = { ...rr[ri], hhmm: normalizeHHMM(e.target.value) }; setQuickRows(rr); }} />
                          <input className={"inp"} style={{ flex: 0.8, minWidth: 36, padding: "4px 8px", fontSize: FS.lg }} type={"number"} min={"0"} max={"59"} placeholder={"Sec"} defaultValue={row.sec || ""} onBlur={e => { const rr = [...quickRows]; rr[ri] = { ...rr[ri], sec: e.target.value }; setQuickRows(rr); }} />
                          <input className={"inp"} style={{ flex: 1, minWidth: 40, padding: "4px 8px", fontSize: FS.lg }} type={"text"} inputMode={"decimal"} placeholder={dUnit} defaultValue={row.dist || ""} onBlur={e => { const rr = [...quickRows]; rr[ri] = { ...rr[ri], dist: e.target.value }; setQuickRows(rr); }} />
                          {isTreadmill && <input className={"inp"} style={{ flex: 0.8, minWidth: 34, padding: "4px 8px", fontSize: FS.lg }} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"Inc"} defaultValue={row.incline || ""} onBlur={e => { const rr = [...quickRows]; rr[ri] = { ...rr[ri], incline: e.target.value }; setQuickRows(rr); }} />}
                          {isTreadmill && <input className={"inp"} style={{ flex: 0.8, minWidth: 34, padding: "4px 8px", fontSize: FS.lg }} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"Spd"} defaultValue={row.speed || ""} onBlur={e => { const rr = [...quickRows]; rr[ri] = { ...rr[ri], speed: e.target.value }; setQuickRows(rr); }} />}
                        </>
                      ) : (
                        <>
                          {!noSets && <input className={"inp"} style={{ flex: 1, minWidth: 40, padding: "4px 8px", fontSize: FS.lg }} type={"number"} min={"1"} max={"20"} placeholder={"Sets"} defaultValue={row.sets || ""} onBlur={e => { const rr = [...quickRows]; rr[ri] = { ...rr[ri], sets: e.target.value }; setQuickRows(rr); }} />}
                          <input className={"inp"} style={{ flex: 1, minWidth: 40, padding: "4px 8px", fontSize: FS.lg }} type={"number"} min={"1"} max={"200"} placeholder={"Reps"} defaultValue={row.reps || ""} onBlur={e => { const rr = [...quickRows]; rr[ri] = { ...rr[ri], reps: e.target.value }; setQuickRows(rr); }} />
                          {showWeight && <input className={"inp"} style={{ flex: 1, minWidth: 40, padding: "4px 8px", fontSize: FS.lg }} type={"number"} min={"0"} placeholder={wUnit} defaultValue={row.weightLbs || ""} onBlur={e => { const rr = [...quickRows]; rr[ri] = { ...rr[ri], weightLbs: e.target.value }; setQuickRows(rr); }} />}
                        </>
                      )}
                      <button className={"btn btn-danger btn-xs"} style={{ padding: "2px 6px", flexShrink: 0 }} onClick={() => setQuickRows(quickRows.filter((_, j) => j !== ri))}>{"✕"}</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Distance bonus info */}
              {ex.id !== "rest_day" && showDist && rawDist > 0 && (
                <div style={{ fontSize: FS.fs62, color: "#8a8478", marginBottom: S.s6, marginTop: S.sNeg4 }}>
                  {metric ? `${rawDist} km = ${parseFloat(kmToMi(rawDist)).toFixed(2)} mi` : `${rawDist} mi = ${parseFloat(miToKm(rawDist)).toFixed(2)} km`}
                  <span style={{ color: "#e67e22", marginLeft: S.s6 }}>{"+"}{Math.round(Math.min(distMi * 0.05, 0.5) * 100)}{"% dist bonus"}</span>
                </div>
              )}

              {/* Treadmill: Incline + Speed */}
              {ex.id !== "rest_day" && isTreadmill && (
                <div style={{ display: "flex", gap: S.s8, marginBottom: S.s10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: FS.sm, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Incline (0.5–15)"}</label>
                    <input className={"inp"} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"—"} value={exIncline || ""} onChange={e => setExIncline(e.target.value ? parseFloat(e.target.value) : null)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: FS.sm, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Speed (0.5–15)"}</label>
                    <input className={"inp"} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"—"} value={exSpeed || ""} onChange={e => setExSpeed(e.target.value ? parseFloat(e.target.value) : null)} />
                  </div>
                </div>
              )}

              {/* Add Row button */}
              {ex.id !== "rest_day" && (isCardio || isFlex || showWeight) && (
                <button className={"btn btn-ghost btn-xs"} style={{ width: "100%", marginBottom: S.s8, fontSize: FS.sm, color: "#8a8478", borderStyle: "dashed" }} onClick={() => setQuickRows([...quickRows, isCardio || isFlex ? { hhmm: "", sec: "", dist: "", incline: "", speed: "" } : { sets: sets || "", reps: reps || "", weightLbs: exWeight || "" }])}>
                  {"＋ Add Row ("}{isCardio || isFlex ? "e.g. interval" : "progressive weight/sets"}{")"}
                </button>
              )}

              {/* Weight Intensity slider */}
              {ex.id !== "rest_day" && showWeight && (
                <div style={{ marginBottom: S.s12 }}>
                  <div className={"intensity-row"}>
                    <label style={{ marginBottom: S.s0, flex: 1 }}>{"Weight Intensity"}</label>
                    <span className={"intensity-val"}>{weightPct}{"%"}</span>
                  </div>
                  <input type={"range"} className={"pct-slider"} min={"0"} max={"100"} step={"5"} value={pctToSlider(weightPct)} onChange={e => {
                    const newPct = sliderToPct(Number(e.target.value));
                    const curW = parseFloat(exWeight);
                    if (curW && weightPct > 0) {
                      const scaled = Math.round(curW * newPct / weightPct * 100) / 100;
                      setExWeight(String(scaled));
                    }
                    setWeightPct(newPct);
                  }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: FS.fs58, color: "#8a8478", marginTop: S.s2 }}>
                    <span>{"50% Deload"}</span><span>{"100% Normal"}</span><span>{"200% Max"}</span>
                  </div>
                </div>
              )}

              {/* HR Zone */}
              {ex.id !== "rest_day" && showHR && (
                <div style={{ marginBottom: S.s12 }}>
                  <label>{"Avg Heart Rate Zone "}{profile.age ? `(Age ${profile.age})` : ""}</label>
                  <div className={"hr-zone-row"}>
                    {HR_ZONES.map(z => {
                      const range = hrRange(age, z);
                      const sel = hrZone === z.z;
                      return (
                        <div key={z.z} className={`hr-zone-btn ${sel ? "sel" : ""}`} style={{ "--zc": z.color, borderColor: sel ? z.color : "rgba(45,42,36,.2)", background: sel ? `${z.color}22` : "rgba(45,42,36,.12)" }} onClick={() => setHrZone(sel ? null : z.z)}>
                          <span className={"hz-name"} style={{ color: sel ? z.color : "#8a8478" }}>{"Z"}{z.z}{" "}{z.name}</span>
                          <span className={"hz-bpm"} style={{ color: sel ? z.color : "#8a8478" }}>{range.lo}{"–"}{range.hi}</span>
                        </div>
                      );
                    })}
                  </div>
                  {hrZone && <div style={{ fontSize: FS.md, color: "#8a8478", fontStyle: "italic", marginTop: S.s6 }}>{HR_ZONES[hrZone - 1].desc}</div>}
                </div>
              )}

              {/* Personal Best */}
              {ex.id !== "rest_day" && (isRunning && pbDisp || exPBDisp4) && (
                <div style={{ fontSize: FS.fs68, color: "#b4ac9e", marginBottom: S.s8, display: "flex", alignItems: "center", gap: S.s6 }}>
                  <span>{"🏆"}</span>
                  <span>{"Current PB: "}{isRunning && pbDisp ? pbDisp : exPBDisp4}</span>
                </div>
              )}

              {/* XP estimate */}
              {ex.id !== "rest_day" && (
                <div style={{ marginBottom: S.s8, fontSize: FS.md, color: "#8a8478", fontStyle: "italic" }}>
                  {"Est. XP: "}<span style={{ color: "#b4ac9e", fontFamily: "'Inter',sans-serif" }}>{estXP}</span>
                  {showHR && hrZone && <span style={{ color: "#e67e22", marginLeft: S.s6 }}>{"Z"}{hrZone}{" +"}{(hrZone - 1) * 4}{"% XP"}</span>}
                  {showWeight && effW > 0 && <span style={{ color: UI_COLORS.success, marginLeft: S.s6 }}>{"+"}{Math.round(Math.min(effW / 500, 0.3) * 100)}{"% wt bonus"}</span>}
                  {runBoostPct > 0 && <span style={{ color: UI_COLORS.warning, marginLeft: S.s6 }}>{"⚡ +"}{runBoostPct}{"% pace bonus"}</span>}
                </div>
              )}

              {/* Primary action row */}
              <div style={{ display: "flex", gap: S.s6, marginBottom: S.s8 }}>
                <button className={"btn btn-glass-yellow"} style={{ flex: 2, fontSize: FS.sm, padding: "8px 10px" }} onClick={logExercise}>{"✓ Complete / Schedule"}</button>
                {ex.id !== "rest_day" && (
                  <button className={"btn btn-ghost btn-sm"} style={{ flex: 1, fontSize: FS.sm, padding: "8px 6px" }} onClick={() => {
                    ex.custom ? openExEditor("edit", ex) : openExEditor("copy", ex);
                    setSelEx(null);
                  }}>{ex.custom ? "✎ Edit" : "📋 Copy"}</button>
                )}
              </div>

              {/* Secondary actions */}
              <div style={{ display: "flex", gap: S.s6 }}>
                {ex.id !== "rest_day" && (
                  <button className={"btn btn-ghost btn-sm"} style={{ flex: 1, fontSize: FS.fs58, padding: "6px 8px", borderColor: "rgba(45,42,36,.3)", color: "#8a8478" }} onClick={() => {
                    const exEntry = {
                      exId: ex.id,
                      sets: parseInt(sets) || 0,
                      reps: parseInt(reps) || 0,
                      weightLbs: wLbs || null,
                      durationMin: null,
                      weightPct,
                      distanceMi: distMi || null,
                      hrZone: hrZone || null
                    };
                    setAddToWorkoutPicker({ exercises: [exEntry] });
                    setSelEx(null);
                  }}>{"➕ Add to Workout"}</button>
                )}
                <button className={"btn btn-ghost btn-sm"} style={{ flex: 1, fontSize: FS.fs58, padding: "6px 8px", borderColor: "rgba(45,42,36,.3)", color: "#8a8478" }} onClick={() => {
                  setSpwSelected([ex.id]);
                  setSavePlanWizard({ entries: [{ exId: ex.id, exercise: ex.name, icon: ex.icon, _idx: ex.id }], label: ex.name });
                  setSpwName(ex.name);
                  setSpwIcon(ex.icon || "📋");
                  setSpwDate("");
                  setSpwMode("new");
                  setSpwTargetPlanId(null);
                  setSelEx(null);
                }}>{"📋 Add to Plan"}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  } catch (e) {
    console.error("Quick-log render error:", e);
    return null;
  }
});

export default QuickLogModal;
