import React, { memo, useMemo, useState } from 'react';
import { UI_COLORS, NO_SETS_EX_IDS, RUNNING_EX_ID } from '../../data/constants';
import { calcExXP } from '../../utils/xp';
import { planQuickLogRows } from '../../utils/quickLogRows';
import { isMetric, kgToLbs, lbsToKg, kmToMi, miToKm, weightLabel, distLabel, displayPace } from '../../utils/units';
import { S, R, FS, FG } from '../../utils/tokens';
import Sheet from '../../components/ui/Sheet';
import SetsEditor from '../../components/ui/SetsEditor';
import WeightRuler from '../../components/ui/WeightRuler';
import { entryTime } from './logEntryTime';
import { planEntry } from './planEntry';

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
  setPendingSoloRemoveId,
  // Where the sheet was opened from. {type:"detail", ex} adds a "← Back"
  // that returns to the detail sheet; any other origin gets no Back button,
  // so dismissal is exactly X / backdrop / Escape.
  quickLogOrigin,
  setQuickLogOrigin,
  // Action callbacks
  logExercise,
  openExEditor,
  setLibDetailEx,
  setAddToWorkoutPicker,
  openSavePlanWizard,
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
    // A Set Forge completion can span multiple rows sharing one
    // sourceGroupId (the primary plus any progressive extras); Repeat needs
    // the WHOLE session, not just whichever row .find() landed on. entry is
    // guaranteed to be the group's primary row — it's the newest logged row
    // for this exercise, and a batch's primary is always written before its
    // own extras. Legacy rows without a sourceGroupId are their own
    // one-row session, same conservative fallback History/Repeat Last use.
    const groupRows = entry.sourceGroupId
      ? (profile.log || []).filter(e => e.sourceGroupId === entry.sourceGroupId)
      : [entry];
    const extraGroupRows = groupRows.slice(1);
    return { entry, extraGroupRows, days, stale: days != null && days > GHOST_STALE_DAYS };
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

  // Which set row the +weight chips target: 0 = primary, n = extra row n.
  // Focus in any of a row's inputs claims it (SetsEditor's onRowFocus).
  const [activeRow, setActiveRow] = useState(0);

  if (!ex) return null;

  const metric = isMetric(profile.units);
  const isCardio = ex.category === "cardio";
  const isFlex = ex.category === "flexibility";
  const showWeight = !isCardio && !isFlex;
  // Forge Glass: the Heart Rate Zone picker left the Set Forge. hrZone stays
  // in the data model (and logs as null) so nothing downstream breaks.
  const showHR = false;
  const showDist = isCardio;
  const noSets = NO_SETS_EX_IDS.has(ex.id);
  const isRunning = ex.id === RUNNING_EX_ID;
  const age = profile.age || 30;

  const rawW = parseFloat(exWeight || 0);
  const wLbs = metric ? parseFloat(kgToLbs(rawW) || 0) : rawW;
  const effW = wLbs;
  const wUnit = weightLabel(profile.units);
  const dUnit = distLabel(profile.units);

  const rawDist = parseFloat(distanceVal || 0);
  const distMi = rawDist > 0 ? metric ? parseFloat(kmToMi(rawDist)) : rawDist : 0;

  const pbPaceMi = profile.runningPB || null;
  const pbDisp = displayPace(pbPaceMi, profile.units);
  const exPB4 = (profile.exercisePBs || {})[ex.id] || null;
  const pbWeightDisp = v => (metric ? parseFloat(lbsToKg(v)).toFixed(1) : v) + (metric ? " kg" : " lbs");
  const exPBDisp4 = exPB4
    ? exPB4.type === "Cardio Pace" ? displayPace(exPB4.value, profile.units)
    : exPB4.type === "Assisted Weight" ? "1RM: " + pbWeightDisp(exPB4.value) + " (Assisted)"
    : exPB4.type === "Max Reps Per 1 Set" ? exPB4.value + " reps"
    : exPB4.type === "Longest Hold" || exPB4.type === "Fastest Time" ? parseFloat(exPB4.value.toFixed(2)) + " min"
    : exPB4.type === "Heaviest Weight" ? pbWeightDisp(exPB4.value)
    : "1RM: " + pbWeightDisp(exPB4.value)
    : null;

  const durationMin = parseFloat(reps || 0);
  const runPace = isRunning && distMi > 0 && durationMin > 0 ? durationMin / distMi : null;
  const runBoostPct = runPace ? runPace <= 8 ? 20 : 5 : 0;

  // One planner for the estimate AND the logged entries (utils/quickLogRows) —
  // what this card projects is what logExercise writes, by construction.
  const rowPlan = planQuickLogRows({
    exId: ex.id,
    category: ex.category,
    noSets,
    chosenClass: profile.chosenClass,
    allExById,
    sets, reps, exWeight, exHHMM, exSec, distanceVal, quickRows,
    metric,
    hrZone: showHR ? hrZone : null,
  });
  const estXPNum = rowPlan.totalXP;
  const estXP = estXPNum.toLocaleString();

  // Fill every field from the ghost in one tap.
  const repeatLast = () => {
    const g = ghost && ghost.entry;
    if (!g) return;
    if (g.sets != null) setSets(String(g.sets));
    if (g.reps != null) setReps(String(g.reps));
    if (g.weightLbs != null) setExWeight(String(metric ? parseFloat(lbsToKg(g.weightLbs)).toFixed(1) : g.weightLbs));
    if (g.weightPct != null) setWeightPct(g.weightPct);
    if (g.distanceMi != null) setDistanceVal(String(metric ? parseFloat(miToKm(g.distanceMi)).toFixed(2) : g.distanceMi));
    if (isCardio || isFlex) {
      const mins = parseInt(g.reps) || 0;
      setExHHMM(`${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);
      setExSec("");
    }
    // Restore any progressive extra rows the last session had, converting
    // canonical storage back to the display units the Set Forge edits in.
    // This used to unconditionally clear quickRows, so repeating a pyramid
    // silently dropped every row but the first.
    const extras = (ghost.extraGroupRows || []).map(r => {
      if (isCardio || isFlex) {
        const mins = parseInt(r.reps) || 0;
        return {
          hhmm: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`,
          sec: "",
          dist: r.distanceMi != null ? String(metric ? parseFloat(miToKm(r.distanceMi)).toFixed(2) : r.distanceMi) : "",
        };
      }
      return {
        sets: r.sets != null ? String(r.sets) : "",
        reps: r.reps != null ? String(r.reps) : "",
        weightLbs: r.weightLbs != null ? String(metric ? parseFloat(lbsToKg(r.weightLbs)).toFixed(1) : r.weightLbs) : "",
      };
    });
    setQuickRows(extras);
  };

  // Pull the compatible parts of the previous exercise across — load and
  // effort settings, not sets/reps, which are specific to the movement.
  const applyCarryover = () => {
    const c = carryover && carryover.entry;
    if (!c) return;
    if (c.weightLbs != null) setExWeight(String(metric ? parseFloat(lbsToKg(c.weightLbs)).toFixed(1) : c.weightLbs));
    if (c.weightPct != null) setWeightPct(c.weightPct);
  };

  // The +weight chips: one tap adds a plate-step to the active row's typed
  // weight (display units — kg users get kg steps). Pre-intensity, additive.
  const chipSteps = metric ? [2.5, 5, 7.5] : [5, 10, 15];
  const effActiveRow = Math.min(activeRow, quickRows.length);
  const bumpWeight = inc => {
    if (effActiveRow === 0) {
      const cur = parseFloat(exWeight) || 0;
      setExWeight(String(Math.round((cur + inc) * 100) / 100));
    } else {
      const i = effActiveRow - 1;
      const next = [...quickRows];
      const cur = parseFloat(next[i] && next[i].weightLbs) || 0;
      next[i] = { ...next[i], weightLbs: String(Math.round((cur + inc) * 100) / 100) };
      setQuickRows(next);
    }
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

  // ── SetsEditor adapter ──────────────────────────────────────────────────
  // The quick log predates the entry-object shape: each field is its own
  // useState, weight/distance are stored in DISPLAY units (converted at
  // submit inside logExercise), and extra-row distance is keyed `dist`.
  // SetsEditor's display valueMode + distKey cover those differences; the
  // adapter just fans onField out to the per-field setters. `durationSec`
  // patches are intentionally dropped — the submit path derives seconds from
  // exHHMM/exSec itself.
  const seValue = {
    sets, reps, weightLbs: exWeight,
    _durHHMM: exHHMM === "" ? undefined : exHHMM,
    _durSecRaw: exSec === "" ? undefined : exSec,
    distanceMi: distanceVal, hrZone,
    incline: exIncline, speed: exSpeed,
    extraRows: quickRows,
  };
  const seField = (field, val) => {
    if (field === "sets") setSets(val);
    else if (field === "reps") setReps(String(val));
    else if (field === "weightLbs") setExWeight(val || "");
    else if (field === "_durHHMM") setExHHMM(val ?? "");
    else if (field === "_durSecRaw") setExSec(val ?? "");
    else if (field === "distanceMi") setDistanceVal(val || "");
    else if (field === "hrZone") setHrZone(val);
    else if (field === "incline") setExIncline(val);
    else if (field === "speed") setExSpeed(val);
    else if (field === "extraRows") setQuickRows(val);
  };

  const dismiss = () => {
    setSelEx(null);
    setExHHMM("");
    setExSec("");
    setQuickRows([]);
    setPendingSoloRemoveId(null);
    if (setQuickLogOrigin) setQuickLogOrigin(null);
  };

  const fromDetail = quickLogOrigin && quickLogOrigin.type === "detail";
  const backToDetail = () => {
    const origin = quickLogOrigin.ex;
    dismiss();
    setLibDetailEx(origin);
  };

  return (
    <Sheet
      open
      onClose={dismiss}
      layer={"modal"}
      title={`${ex.icon || ""} ${ex.name}`.trim()}
      ariaLabel={ex.name}
      headerLeft={fromDetail ? (
        <button className={"btn btn-ghost btn-sm"} style={{ padding: "4px 8px", fontSize: FS.fs75, flexShrink: 0 }} onClick={backToDetail}>{"← Back"}</button>
      ) : null}
    >
      <div>
            <div className={"log-form"}>
              {/* Rest day */}
              {ex.id === "rest_day" && (
                <div style={{ textAlign: "center", padding: "18px 0", color: "#8a8478", fontSize: FS.fs78, fontStyle: "italic" }}>{"🛌 Rest day — no stats to track. Recover well!"}</div>
              )}

              {/* Projected XP — the gold card. Same estimate + beat animation
                  as the old Est. XP line, on the design's earned-gold chassis. */}
              {ex.id !== "rest_day" && (
                <div className={"sf-xp-card"}>
                  <span className={"sf-xp-sweep"} aria-hidden={"true"} />
                  <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: S.s10 }}>
                    <div>
                      <div style={{ fontFamily: FG.fontSerif, fontSize: FS.fs44, letterSpacing: ".3em", textTransform: "uppercase", color: "rgba(240,200,104,.85)", marginBottom: 4 }}>{"Projected XP"}</div>
                      <div
                        key={beat || "flat"}
                        className={beat ? "ql-xp-beat" : undefined}
                        onAnimationEnd={() => setBeat(null)}
                        style={{ fontFamily: FG.fontSerif, fontSize: "1.55rem", fontWeight: 600, lineHeight: .9, color: "#F5D486", textShadow: "0 0 26px rgba(240,200,104,.35)" }}
                      >{estXP}</div>
                    </div>
                    <div style={{ flex: 1, textAlign: "right", paddingBottom: 2, fontSize: FS.fs58 }}>
                      {beat && ghostXP != null && <span className={"ql-beat-tag"}>{`▲ ${(estXPNum - ghostXP).toLocaleString()} over last time`}</span>}
                      {showWeight && effW > 0 && <span style={{ color: UI_COLORS.success, marginLeft: S.s6 }}>{"+"}{Math.round(Math.min(effW / 500, 0.3) * 100)}{"% wt bonus"}</span>}
                      {runBoostPct > 0 && <span style={{ color: UI_COLORS.warning, marginLeft: S.s6 }}>{"⚡ +"}{runBoostPct}{"% pace bonus"}</span>}
                      {quickRows.length > 0 && <span style={{ color: "rgba(228,222,211,.45)", marginLeft: S.s6 }}>{`${quickRows.length + 1} sets`}</span>}
                    </div>
                  </div>
                </div>
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

              {/* ── Set Forge ── one SetsEditor across builder / live / quick
                  log; per-set rows are the shared extraRows mechanism, now
                  enabled here. Focus claims a row for the +weight chips. */}
              {ex.id !== "rest_day" && (
                <div style={{ display: "flex", alignItems: "center", gap: S.s8, margin: `${S.s2}px 0 ${S.s6}px` }}>
                  <span style={{ fontFamily: FG.fontCond, fontSize: FS.base, fontWeight: 600, letterSpacing: ".19em", textTransform: "uppercase", color: FG.ink }}>{"Set Forge"}</span>
                  <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg,rgba(255,255,255,.13),transparent)" }} />
                  {effActiveRow > 0 && <span style={{ fontFamily: FG.fontCond, fontSize: FS.fs55, letterSpacing: ".12em", textTransform: "uppercase", color: "rgba(228,222,211,.45)" }}>{`Editing S${effActiveRow + 1}`}</span>}
                </div>
              )}
              {ex.id !== "rest_day" && (
                <SetsEditor
                  exD={ex}
                  value={seValue}
                  onField={seField}
                  units={profile.units}
                  age={age}
                  variant={"quicklog"}
                  valueMode={"display"}
                  distKey={"dist"}
                  showPaceBonus={false}
                  allowExtraRows={true}
                  onPrimaryBlur={checkBeat}
                  onRowFocus={setActiveRow}
                  activeRow={effActiveRow}
                />
              )}

              {/* Plate chips — bump the active row's weight without typing */}
              {ex.id !== "rest_day" && showWeight && (
                <div style={{ display: "flex", alignItems: "center", gap: S.s6, marginBottom: S.s10 }}>
                  {chipSteps.map(step => (
                    <button
                      key={step}
                      type={"button"}
                      className={"sf-chip"}
                      onClick={() => bumpWeight(step)}
                    >{`+${step} ${wUnit}`}</button>
                  ))}
                  <span style={{ marginLeft: "auto", fontSize: FS.fs55, color: "rgba(228,222,211,.4)", fontFamily: FG.fontCond, letterSpacing: ".08em", textTransform: "uppercase" }}>
                    {`→ S${effActiveRow + 1}`}
                  </span>
                </div>
              )}

              {/* Distance bonus info */}
              {ex.id !== "rest_day" && showDist && rawDist > 0 && (
                <div style={{ fontSize: FS.fs62, color: "#8a8478", marginBottom: S.s6, marginTop: S.sNeg4 }}>
                  {metric ? `${rawDist} km = ${parseFloat(kmToMi(rawDist)).toFixed(2)} mi` : `${rawDist} mi = ${parseFloat(miToKm(rawDist)).toFixed(2)} km`}
                  <span style={{ color: "#e67e22", marginLeft: S.s6 }}>{"+"}{Math.round(Math.min(distMi * 0.05, 0.5) * 100)}{"% dist bonus"}</span>
                </div>
              )}

              {/* Weight Intensity — same 50–200% rescale mechanic, now a
                  Forge Glass drag/scrub ruler (WeightRuler keeps a hidden
                  range input for keyboard & AT). */}
              {ex.id !== "rest_day" && showWeight && (
                <div style={{ marginBottom: S.s12 }}>
                  <div className={"intensity-row"}>
                    <label style={{ marginBottom: S.s0, flex: 1 }}>{"Weight Intensity"}</label>
                    <span className={"intensity-val"}>{weightPct}{"%"}</span>
                  </div>
                  <WeightRuler
                    pct={weightPct}
                    onPctChange={newPct => {
                      const curW = parseFloat(exWeight);
                      if (curW && weightPct > 0) {
                        const scaled = Math.round(curW * newPct / weightPct * 100) / 100;
                        setExWeight(String(scaled));
                      }
                      setWeightPct(newPct);
                    }}
                    onTapStep={dir => {
                      // Plate-step nudge on the typed weight (intensity % untouched).
                      const step = metric ? 1.25 : 2.5;
                      const cur = parseFloat(exWeight) || 0;
                      setExWeight(String(Math.max(0, Math.round((cur + dir * step) * 100) / 100)));
                    }}
                    stepLabel={metric ? "±1.25 kg" : "±2.5 lbs"}
                  />
                </div>
              )}

              {/* Personal Best */}
              {ex.id !== "rest_day" && (isRunning && pbDisp || exPBDisp4) && (
                <div style={{ fontSize: FS.fs68, color: "#b4ac9e", marginBottom: S.s8, display: "flex", alignItems: "center", gap: S.s6 }}>
                  <span>{"🏆"}</span>
                  <span>{"Current PB: "}{isRunning && pbDisp ? pbDisp : exPBDisp4}</span>
                </div>
              )}

              {/* Primary action row — Copy retired with Forge Glass; custom
                  exercises keep their ✎ Edit entry point. */}
              <div style={{ display: "flex", gap: S.s6, marginBottom: S.s8 }}>
                <button className={"btn btn-glass-yellow"} style={{ flex: 2, fontSize: FS.sm, padding: "8px 10px" }} onClick={logExercise}>{"✓ Complete / Schedule"}</button>
                {ex.id !== "rest_day" && ex.custom && (
                  <button className={"btn btn-ghost btn-sm"} style={{ flex: 1, fontSize: FS.sm, padding: "8px 6px" }} onClick={() => {
                    openExEditor("edit", ex);
                    dismiss();
                  }}>{"✎ Edit"}</button>
                )}
              </div>

              {/* Secondary actions */}
              <div style={{ display: "flex", gap: S.s6 }}>
                {ex.id !== "rest_day" && (
                  <button className={"btn btn-ghost btn-sm"} style={{ flex: 1, fontSize: FS.fs58, padding: "6px 8px", borderColor: "rgba(45,42,36,.3)", color: "#8a8478" }} onClick={() => {
                    // rowPlan is the same planner logExercise() writes from —
                    // reusing it here (instead of re-deriving sets/reps from
                    // raw state) is what carries a timed duration and any
                    // Set Forge extra rows into the workout, rather than
                    // silently dropping them.
                    const [primaryRow, ...extraPlanRows] = rowPlan.rows;
                    const exEntry = {
                      exId: ex.id,
                      sets: primaryRow.sets,
                      reps: primaryRow.reps,
                      weightLbs: primaryRow.weightLbs,
                      durationMin: null,
                      weightPct,
                      distanceMi: primaryRow.distanceMi,
                      hrZone: hrZone || null,
                      ...(extraPlanRows.length ? {
                        extraRows: extraPlanRows.map(r => ({
                          sets: r.sets, reps: r.reps, weightLbs: r.weightLbs, distanceMi: r.distanceMi,
                        })),
                      } : {}),
                    };
                    setAddToWorkoutPicker({ exercises: [exEntry] });
                    dismiss();
                  }}>{"➕ Add to Workout"}</button>
                )}
                <button className={"btn btn-ghost btn-sm"} style={{ flex: 1, fontSize: FS.fs58, padding: "6px 8px", borderColor: "rgba(45,42,36,.3)", color: "#8a8478" }} onClick={() => {
                  // Shared opener seeds spwSelected for every entry point.
                  openSavePlanWizard([planEntry(ex, profile.chosenClass, allExById)], ex.name, ex.name);
                  dismiss();
                }}>{"📋 Add to Plan"}</button>
              </div>
            </div>
      </div>
    </Sheet>
  );
});

export default QuickLogModal;
