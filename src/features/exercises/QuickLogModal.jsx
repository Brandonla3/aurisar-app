import React, { memo, useMemo, useState } from 'react';
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

// A ghost older than this is shown faded — chasing a number you set six weeks
// ago is rarely the right target, so the UI stops pushing it.
const GHOST_STALE_DAYS = 14;
// Two entries logged within this window are treated as the same gym session,
// which is what makes carrying a weight across exercises reasonable.
const CARRYOVER_WINDOW_MS = 2 * 60 * 1000;

const entryTime = e => {
  const t = e && (e.loggedAt || e.dateKey) ? new Date(e.loggedAt || e.dateKey).getTime() : NaN;
  return Number.isFinite(t) ? t : NaN;
};

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

  // ── Ghost of your last performance ──────────────────────────────────────
  // The form used to open blank every time, so a set you have done fifty
  // times still meant retyping it, and there was nothing to push against.
  // These are read-only derivations from data already in `profile` — no new
  // persisted state.
  const ghost = useMemo(() => {
    if (!ex) return null;
    const entry = (profile.log || []).find(e => e.exId === ex.id);
    if (!entry) return null;
    const t = entryTime(entry);
    const days = Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : null;
    return { entry, days, stale: days != null && days > GHOST_STALE_DAYS };
  }, [profile.log, ex]);

  // Cross-dock carryover: the exercise logged moments ago in the same session
  // that shares muscle group or equipment. Its load is a far better starting
  // point than an empty field.
  const carryover = useMemo(() => {
    if (!ex) return null;
    const prev = (profile.log || [])[0];
    if (!prev || prev.exId === ex.id) return null;
    const t = entryTime(prev);
    if (!Number.isFinite(t) || Date.now() - t > CARRYOVER_WINDOW_MS) return null;
    const prevEx = allExById[prev.exId];
    if (!prevEx) return null;
    const sameMuscle = prevEx.muscleGroup && prevEx.muscleGroup === ex.muscleGroup;
    const sameKit = prevEx.equipment && prevEx.equipment === ex.equipment;
    if (!sameMuscle && !sameKit) return null;
    return { entry: prev, from: prevEx.name };
  }, [profile.log, allExById, ex]);

  // "beat" is evaluated on blur against derived XP rather than per keystroke
  // against raw fields — typing "1" on the way to "15" briefly looks like a
  // regression, and sets/reps/weight are coupled anyway, so a single quality
  // number is the only comparison that agrees with what the app rewards.
  const [beat, setBeat] = useState(null); // null | "ghost" | "pb"

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

  const estXPNum = (() => {
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
    return baseXP + rowsXP;
  })();
  const estXP = estXPNum.toLocaleString();

  // Fill every field from the ghost in one tap.
  const repeatLast = () => {
    const g = ghost && ghost.entry;
    if (!g) return;
    if (g.sets != null) setSets(String(g.sets));
    if (g.reps != null) setReps(String(g.reps));
    if (g.weightLbs != null) setExWeight(String(metric ? parseFloat(lbsToKg(g.weightLbs)).toFixed(1) : g.weightLbs));
    if (g.weightPct != null) setWeightPct(g.weightPct);
    if (g.hrZone != null) setHrZone(g.hrZone);
    if (g.distanceMi != null) setDistanceVal(String(metric ? parseFloat(miToKm(g.distanceMi)).toFixed(2) : g.distanceMi));
    if (isCardio || isFlex) {
      const mins = parseInt(g.reps) || 0;
      setExHHMM(`${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);
      setExSec("");
    }
    setQuickRows([]);
  };

  // Pull the compatible parts of the previous exercise across — load and
  // effort settings, not sets/reps, which are specific to the movement.
  const applyCarryover = () => {
    const c = carryover && carryover.entry;
    if (!c) return;
    if (c.weightLbs != null) setExWeight(String(metric ? parseFloat(lbsToKg(c.weightLbs)).toFixed(1) : c.weightLbs));
    if (c.weightPct != null) setWeightPct(c.weightPct);
    if (c.hrZone != null) setHrZone(c.hrZone);
  };

  // One compact line rather than a ghost value beside every input — the sheet
  // is already dense, and the numbers only mean anything together.
  const ghostSummary = (() => {
    const g = ghost && ghost.entry;
    if (!g) return "";
    const parts = [];
    if (isCardio || isFlex) {
      if (g.reps) parts.push(`${g.reps} min`);
      if (g.distanceMi) parts.push(`${metric ? parseFloat(miToKm(g.distanceMi)).toFixed(2) : g.distanceMi} ${dUnit}`);
      if (g.hrZone) parts.push(`Z${g.hrZone}`);
    } else {
      if (g.sets && g.reps) parts.push(`${g.sets} × ${g.reps}`);
      else if (g.reps) parts.push(`${g.reps} reps`);
      if (g.weightLbs) parts.push(`${metric ? parseFloat(lbsToKg(g.weightLbs)).toFixed(1) : g.weightLbs} ${wUnit}`);
    }
    if (Number.isFinite(g.xp)) parts.push(`${g.xp.toLocaleString()} XP`);
    return parts.join(" · ");
  })();

  // The XP stored on a log entry is the *earned* figure — class multiplier,
  // streak and quest bonuses already applied — so it is not comparable with
  // the raw estimate shown here. Re-run the ghost's numbers through the same
  // calcExXP the estimate uses so both sides measure the same thing.
  //
  // Note the weight bonus in calcExXP saturates at 30% (reached around
  // 150 lbs), so above that a heavier lift at equal reps scores the same and
  // will not register as beating the ghost. That is the existing XP curve,
  // not a quirk of this comparison.
  const ghostXP = (() => {
    const g = ghost && ghost.entry;
    if (!g) return null;
    const sv = noSets ? 1 : parseInt(g.sets) || 0;
    const rv = parseInt(g.reps) || 0;
    if (!rv) return null;
    return calcExXP(ex.id, sv, rv, profile.chosenClass, allExById, g.distanceMi || null, g.weightLbs || null, g.hrZone || null, 0);
  })();

  const checkBeat = () => {
    if (ghostXP == null || estXPNum <= 0) { setBeat(null); return; }
    setBeat(estXPNum > ghostXP ? "ghost" : null);
  };

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

              {/* Ghost bar — what you did last time, and one tap to match it */}
              {ex.id !== "rest_day" && ghost && (
                <div className={`ql-ghost-bar${ghost.stale ? " ql-ghost-stale" : ""}`}>
                  <span className={"ql-ghost-label"}>{"Last time"}</span>
                  <span className={"ql-ghost-vals"}>{ghostSummary}</span>
                  <span className={"ql-ghost-when"}>
                    {ghost.days == null ? "" : ghost.days === 0 ? "today" : ghost.days === 1 ? "yesterday" : `${ghost.days}d ago`}
                  </span>
                  <button type="button" className={"ql-ghost-repeat"} onClick={repeatLast}>{"⟲ Repeat"}</button>
                </div>
              )}

              {/* Carryover — same session, same muscle or kit, load already known */}
              {ex.id !== "rest_day" && carryover && (
                <div className={"ql-ghost-bar ql-carryover-bar"}>
                  <span className={"ql-ghost-label"}>{"Carry over"}</span>
                  <span className={"ql-ghost-vals"}>{`from ${carryover.from}`}</span>
                  <button type="button" className={"ql-ghost-repeat"} onClick={applyCarryover}>{"↳ Use load"}</button>
                </div>
              )}

              {/* Top row: Sets/Reps or Duration+Sec+Dist + Weight */}
              {ex.id !== "rest_day" && (
                <div style={{ display: "flex", gap: S.s6, marginBottom: S.s8, alignItems: "flex-end" }}>
                  {!noSets && !(isCardio || isFlex) && (
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: FS.sm, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Sets"}</label>
                      <input className={"inp"} style={{ padding: "6px 8px", textAlign: "center" }} type={"number"} min={"0"} max={"20"} value={sets} onChange={e => setSets(e.target.value)} onBlur={checkBeat} placeholder={""} />
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
                          <input className={"inp"} style={{ padding: "6px 8px", textAlign: "center" }} type={"number"} min={"0"} max={"200"} step={"0.1"} value={distanceVal} onChange={e => setDistanceVal(e.target.value)} onBlur={checkBeat} placeholder={"0.0"} />
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: FS.sm, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Reps"}</label>
                        <input className={"inp"} style={{ padding: "6px 8px", textAlign: "center" }} type={"number"} min={"0"} max={"200"} value={reps} onChange={e => setReps(e.target.value)} onBlur={checkBeat} placeholder={""} />
                      </div>
                      {showWeight && (
                        <div style={{ flex: 1.5 }}>
                          <label style={{ fontSize: FS.sm, color: "#b0a898", display: "block", marginBottom: S.s4 }}>{"Weight ("}{wUnit}{")"}</label>
                          <input className={"inp"} style={{ padding: "6px 8px", textAlign: "center" }} type={"number"} min={"0"} max={"2000"} step={metric ? "0.5" : "2.5"} value={exWeight} onChange={e => setExWeight(e.target.value)} onBlur={checkBeat} placeholder={metric ? "60" : "135"} />
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
                  {"Est. XP: "}<span
                    key={beat || "flat"}
                    className={beat ? "ql-xp-beat" : undefined}
                    onAnimationEnd={() => setBeat(null)}
                    style={{ color: beat ? "#e8d08a" : "#b4ac9e", fontFamily: "'Inter',sans-serif" }}
                  >{estXP}</span>
                  {beat && ghostXP != null && <span className={"ql-beat-tag"}>{`▲ ${(estXPNum - ghostXP).toLocaleString()} over last time`}</span>}
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
