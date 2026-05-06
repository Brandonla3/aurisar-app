import React, { memo } from 'react';
import { ExIcon } from '../../components/ExIcon';
import { getMuscleColor, getTypeColor, calcExXP, hrRange } from '../../utils/xp';
import { lbsToKg, kgToLbs, miToKm, kmToMi, isMetric, weightLabel, distLabel, displayWt } from '../../utils/units';
import { formatXP } from '../../utils/format';
import { uid, todayStr } from '../../utils/helpers';
import { normalizeHHMM, secToHHMMSplit, combineHHMMSec } from '../../utils/time';
import { S, R, FS } from '../../utils/tokens';
import { UI_COLORS, MUSCLE_COLORS, WORKOUT_TEMPLATES, NO_SETS_EX_IDS, RUNNING_EX_ID, HR_ZONES } from '../../data/constants';

/**
 * Workouts tab — extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Contains four views: list, recipes (templates), detail, builder.
 *
 * Co-located sub-components / helpers:
 *   WbExCard             — memoized exercise row in the workout builder
 *   getWorkoutMgColor    — derive card accent from dominant muscle group
 *   getRecipeMgColor     — derive card accent from recipe category
 *   updateWbEx           — typed field updater (closure over setWbExercises)
 *   renderWbExFields     — inline field group for a single exercise row
 *   renderSsAccordionSection — collapsible accordion section inside a superset card
 */

// ── Module-level constants (hoisted from App.jsx) ──
const RECIPE_CATS = [...new Set([...WORKOUT_TEMPLATES.map(t => t.category).filter(Boolean), ...WORKOUT_TEMPLATES.map(t => t.equipment).filter(Boolean)])].sort();
const EQUIP_ICONS = {
  Gym: "🏋️",
  "Home Gym": "🏠",
  Bodyweight: "🤸"
};
const RECIPE_CAT_COLORS = {
  "Push": "#8B5A2B",
  "Pull": "#2E4D38",
  "Legs": "#5C5C2E",
  "Full Body": "#2C4564",
  "Upper Body": "#6B2A2A",
  "Lower Body": "#5C5C2E",
  "Chest": "#8B5A2B",
  "Back": "#2E4D38",
  "Shoulders": "#3D343F",
  "Arms": "#4A5560",
  "Glutes": "#4F4318",
  "Core": "#2A4347",
  "Abs": "#2A4347",
  "Cardio": "#2C4564",
  "HIIT": "#6B2A2A",
  "Endurance": "#494C56",
  "Flexibility": "#3D343F",
  "Yoga": "#3D343F",
  "Mobility": "#3D343F",
  "Gym": "#4F4318",
  "Home Gym": "#8B5A2B",
  "Bodyweight": "#2E4D38"
};
function getRecipeMgColor(tpl) {
  if (!tpl) return "#B0A090";
  return RECIPE_CAT_COLORS[tpl.category] || RECIPE_CAT_COLORS[tpl.equipment] || "#B0A090";
}
function getWorkoutMgColor(wo, exById, mgColors) {
  if (!wo || !wo.exercises) return "#B0A090";
  const counts = {};
  for (const ex of wo.exercises) {
    const exD = exById[ex.exId];
    if (!exD) continue;
    const mg = (exD.muscleGroup || "").toLowerCase().trim();
    if (!mg) continue;
    counts[mg] = (counts[mg] || 0) + 1;
  }
  let top = null, topN = 0;
  for (const k in counts) {
    if (counts[k] > topN) { top = k; topN = counts[k]; }
  }
  return top && mgColors[top] || "#B0A090";
}

const WbExCard = React.memo(function WbExCard({
  ex,
  i,
  exD,
  collapsed,
  profile,
  allExById,
  metric,
  wUnit,
  setWbExercises,
  setCollapsedWbEx,
  setSsChecked,
  ssChecked,
  exCount,
  openExEditor
}) {
  function updateField(field, val) {
    setWbExercises(exs => exs.map((e, j) => j !== i ? e : {
      ...e,
      [field]: val
    }));
  }
  function removeEx() {
    setWbExercises(exs => {
      const updated = exs.map((e, j) => {
        if (j === i) return null;
        if (e.supersetWith === i) return {
          ...e,
          supersetWith: null
        };
        if (e.supersetWith != null && e.supersetWith > i) return {
          ...e,
          supersetWith: e.supersetWith - 1
        };
        return e;
      }).filter(Boolean);
      return updated;
    });
  }
  function toggleCollapse() {
    setCollapsedWbEx(s => ({
      ...s,
      [i]: !s[i]
    }));
  }
  function reorder(toIdx) {
    if (i === toIdx) return;
    setWbExercises(exs => {
      const arr = [...exs];
      const [moved] = arr.splice(i, 1);
      arr.splice(toIdx, 0, moved);
      const indexMap = {};
      const temp = exs.map((_, idx) => idx);
      const [movedIdx] = temp.splice(i, 1);
      temp.splice(toIdx, 0, movedIdx);
      temp.forEach((oldIdx, newIdx) => {
        indexMap[oldIdx] = newIdx;
      });
      return arr.map(e => {
        if (e.supersetWith != null && indexMap[e.supersetWith] != null) return {
          ...e,
          supersetWith: indexMap[e.supersetWith]
        };
        return e;
      });
    });
  }
  const isC = exD.category === "cardio";
  const isF = exD.category === "flexibility";
  const showW = !isC && !isF;
  const showHR = isC;
  const isTreadmill = exD.hasTreadmill || false;
  const noSetsEx = NO_SETS_EX_IDS.has(exD.id);
  const isRunningEx = exD.id === RUNNING_EX_ID;
  const age = profile.age || 30;
  const dispW = ex.weightLbs ? metric ? lbsToKg(ex.weightLbs) : ex.weightLbs : "";
  const dispDist = ex.distanceMi ? metric ? String(parseFloat(miToKm(ex.distanceMi)).toFixed(2)) : String(ex.distanceMi) : "";
  const pbPaceMi = profile.runningPB || null;
  const pbDisp = pbPaceMi ? metric ? parseFloat((pbPaceMi * 1.60934).toFixed(2)) + " min/km" : parseFloat(pbPaceMi.toFixed(2)) + " min/mi" : null;
  const exPB = (profile.exercisePBs || {})[exD.id] || null;
  const exPBDisp = exPB ? exPB.type === "cardio" ? metric ? parseFloat((exPB.value * 1.60934).toFixed(2)) + " min/km" : parseFloat(exPB.value.toFixed(2)) + " min/mi" : exPB.type === "assisted" ? "🏆 1RM: " + exPB.value + (metric ? " kg" : " lbs") + " (Assisted)" : "🏆 1RM: " + exPB.value + (metric ? " kg" : " lbs") : null;
  const durationMin = parseFloat(ex.reps || 0);
  const distMiVal = ex.distanceMi ? parseFloat(ex.distanceMi) : 0;
  const runPace = isRunningEx && distMiVal > 0 && durationMin > 0 ? durationMin / distMiVal : null;
  const runBoostPct = runPace ? runPace <= 8 ? 20 : 5 : 0;
  const mgColor = getMuscleColor(exD.muscleGroup);
  return <><div className={"wb-ex-hdr"} onClick={() => toggleCollapse()}><div style={{
        display: "flex",
        flexDirection: "column",
        gap: S.s2,
        flexShrink: 0
      }}><button type={"button"} aria-label={`Move ${exD.name} up`} title={"Move up"} className={"btn btn-ghost btn-xs"} style={{
          padding: "2px 6px",
          fontSize: FS.fs65,
          lineHeight: 1,
          minWidth: 0,
          opacity: i === 0 ? .3 : 1
        }} disabled={i === 0} onClick={e => {
          e.stopPropagation();
          reorder(i - 1);
        }}>{"▲"}</button><button type={"button"} aria-label={`Move ${exD.name} down`} title={"Move down"} className={"btn btn-ghost btn-xs"} style={{
          padding: "2px 6px",
          fontSize: FS.fs65,
          lineHeight: 1,
          minWidth: 0,
          opacity: i === exCount - 1 ? .3 : 1
        }} disabled={i === exCount - 1} onClick={e => {
          e.stopPropagation();
          reorder(i + 1);
        }}>{"▼"}</button></div>{ex.supersetWith == null && exCount >= 2 && <div style={{
        display: "flex",
        alignItems: "center",
        gap: S.s4,
        cursor: "pointer",
        flexShrink: 0
      }} title={"Select for superset"} onClick={e => {
        e.stopPropagation();
        setSsChecked(prev => {
          const n = new Set(prev);
          if (n.has(i)) n.delete(i);else {
            if (n.size >= 2) {
              const oldest = [...n][0];
              n.delete(oldest);
            }
            n.add(i);
          }
          return n;
        });
      }}><div className={`ss-cb ${ssChecked.has(i) ? "on" : ""}`} /><span style={{
          fontSize: FS.fs55,
          color: ssChecked.has(i) ? "#b0b8c0" : "#8a8f96",
          fontWeight: 600,
          letterSpacing: ".03em",
          userSelect: "none"
        }}>{"Superset"}</span></div>}<span aria-hidden={"true"} style={{
        cursor: "grab",
        color: "#8a8478",
        fontSize: FS.fs90,
        flexShrink: 0
      }}>{"⠿"}</span><div className={"builder-ex-orb"} style={{
        "--mg-color": mgColor
      }}><ExIcon ex={exD} size={".95rem"} color={"#d4cec4"} /></div><div className={"builder-ex-name-styled"}>{exD.name}{exD.custom && <span className={"custom-ex-badge"} style={{
          marginLeft: S.s4
        }}>{"custom"}</span>}{exD.custom && <button className={"btn btn-ghost btn-xs"} style={{
          marginLeft: S.s6,
          fontSize: FS.fs55,
          padding: "2px 6px"
        }} onClick={e => {
          e.stopPropagation();
          openExEditor("edit", exD);
        }}>{"✎ edit"}</button>}</div>{ex.supersetWith && <span className={"ss-badge"}>{"SS"}</span>}{(isRunningEx && pbDisp || exPBDisp) && <span style={{
        fontSize: FS.fs58,
        color: "#b4ac9e",
        flexShrink: 0
      }}>{"🏆 "}{isRunningEx && pbDisp ? pbDisp : exPBDisp}</span>}{collapsed && exD.id !== "rest_day" && <span style={{
        fontSize: FS.sm,
        color: "#8a8478"
      }}>{noSetsEx ? "" : ex.sets + "×"}{ex.reps}{ex.weightLbs ? ` · ${displayWt(ex.weightLbs, profile.units)}` : ""}</span>}<span style={{
        fontSize: FS.fs63,
        color: "#b4ac9e",
        flexShrink: 0
      }}>{(() => {
          const extraCount = (ex.extraRows || []).length;
          const b = calcExXP(ex.exId, noSetsEx ? 1 : ex.sets, ex.reps, profile.chosenClass, allExById, distMiVal || null, null, null, extraCount);
          const r = (ex.extraRows || []).reduce((s, row) => s + calcExXP(ex.exId, parseInt(row.sets) || parseInt(ex.sets) || 3, parseInt(row.reps) || parseInt(ex.reps) || 10, profile.chosenClass, allExById, null, null, null, extraCount), 0);
          return formatXP(b + r, {
            signed: true
          });
        })()}{runBoostPct > 0 && <span style={{
          color: UI_COLORS.warning,
          marginLeft: S.s2
        }}>{"⚡"}</span>}</span><span style={{
        fontSize: FS.sm,
        color: "#8a8478",
        transition: "transform .2s",
        transform: collapsed ? "rotate(0deg)" : "rotate(180deg)",
        flexShrink: 0,
        lineHeight: 1
      }}>{"▼"}</span><button type={"button"} aria-label={`Remove ${exD.name}`} title={"Remove"} className={"btn btn-danger btn-xs"} onClick={e => {
        e.stopPropagation();
        removeEx();
      }}>{"✕"}</button></div>{!collapsed && exD.id !== "rest_day" && <div className={"wb-ex-body"}><div style={{
        display: "flex",
        gap: S.s8,
        marginBottom: S.s6
      }}>{!noSetsEx && <div style={{
          flex: 1
        }}><label style={{
            fontSize: FS.sm,
            color: "#b0a898",
            marginBottom: S.s4,
            display: "block"
          }}>{"Sets"}</label><input className={"wb-ex-inp"} style={{
            width: "100%",
            padding: "6px 8px"
          }} type={"text"} inputMode={"decimal"} value={ex.sets === 0 || ex.sets === "" ? "" : ex.sets || ""} onChange={e => updateField("sets", e.target.value)} /></div>}{isC || isF ? <><div style={{
            flex: 1.6,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Duration (HH:MM)"}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "4px 6px"
            }} type={"text"} inputMode={"numeric"} value={ex._durHHMM !== undefined ? ex._durHHMM : ex.durationSec ? secToHHMMSplit(ex.durationSec).hhmm : ex.reps ? "00:" + String(ex.reps).padStart(2, "0") : ""} onChange={e => updateField("_durHHMM", e.target.value)} onBlur={e => {
              const hhmm = normalizeHHMM(e.target.value);
              updateField("_durHHMM", hhmm || undefined);
              const sec = combineHHMMSec(hhmm, ex._durSecRaw || ex.durationSec ? secToHHMMSplit(ex.durationSec || 0).sec : "");
              updateField("durationSec", sec);
              if (sec) updateField("reps", Math.max(1, Math.floor(sec / 60)));
            }} placeholder={"00:00"} /></div><div style={{
            flex: 0.9,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Sec"}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "4px 6px",
              textAlign: "center"
            }} type={"number"} min={"0"} max={"59"} value={ex._durSecRaw !== undefined ? String(ex._durSecRaw).padStart(2, "0") : ex.durationSec ? String(secToHHMMSplit(ex.durationSec).sec).padStart(2, "0") : ""} onChange={e => {
              const v = e.target.value;
              updateField("_durSecRaw", v);
              const hhmm = ex._durHHMM || (ex.durationSec ? secToHHMMSplit(ex.durationSec).hhmm : "");
              const sec = combineHHMMSec(hhmm, v);
              updateField("durationSec", sec);
              if (sec) updateField("reps", Math.max(1, Math.floor(sec / 60)));
            }} placeholder={"00"} /></div><div style={{
            flex: 1.4,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Dist ("}{metric ? "km" : "mi"}{")"}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "4px 6px"
            }} type={"text"} inputMode={"decimal"} value={dispDist} placeholder={"0"} onChange={e => {
              const v = e.target.value;
              const mi = v && metric ? kmToMi(v) : v;
              updateField("distanceMi", mi || null);
            }} /></div></> : <><div style={{
            flex: 1,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Reps"}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "4px 6px"
            }} type={"text"} inputMode={"decimal"} value={ex.reps === 0 || ex.reps === "" ? "" : ex.reps || ""} onChange={e => updateField("reps", e.target.value)} /></div>{showW && <div style={{
            flex: 1.2,
            minWidth: 0
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{wUnit}</label><input className={"wb-ex-inp"} style={{
              width: "100%",
              padding: "4px 6px"
            }} type={"text"} inputMode={"decimal"} step={metric ? "0.5" : "2.5"} value={dispW} placeholder={"—"} onChange={e => {
              const v = e.target.value;
              const lbs = v && metric ? kgToLbs(v) : v;
              updateField("weightLbs", lbs || null);
            }} /></div>}</>}</div>{isRunningEx && runBoostPct > 0 && <div style={{
        fontSize: FS.fs65,
        color: UI_COLORS.warning,
        marginBottom: S.s6
      }}>{"⚡ +"}{runBoostPct}{"% pace bonus"}{runBoostPct === 20 ? " (sub-8 mi!)" : ""}</div>}{isTreadmill && <div style={{
        marginBottom: S.s6
      }}><div style={{
          display: "flex",
          gap: S.s8
        }}><div style={{
            flex: 1
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Incline "}<span style={{
                opacity: .6,
                fontSize: FS.fs55
              }}>{"(0.5–15)"}</span></label><input className={"inp"} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"—"} value={ex.incline || ""} onChange={e => updateField("incline", e.target.value ? parseFloat(e.target.value) : null)} /></div><div style={{
            flex: 1
          }}><label style={{
              fontSize: FS.sm,
              color: "#b0a898",
              marginBottom: S.s4,
              display: "block"
            }}>{"Speed "}<span style={{
                opacity: .6,
                fontSize: FS.fs55
              }}>{"(0.5–15)"}</span></label><input className={"inp"} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"—"} value={ex.speed || ""} onChange={e => updateField("speed", e.target.value ? parseFloat(e.target.value) : null)} /></div></div></div>}{(ex.extraRows || []).map((row, ri) => <div key={ri} style={{
        display: "flex",
        gap: S.s4,
        marginTop: S.s4,
        padding: "6px 8px",
        background: "rgba(45,42,36,.18)",
        borderRadius: R.md,
        alignItems: "center",
        flexWrap: "wrap"
      }}><span style={{
          fontSize: FS.fs58,
          color: "#9a8a78",
          flexShrink: 0,
          minWidth: 18
        }}>{isC || isF ? `I${ri + 2}` : `S${ri + 2}`}</span>{isC || isF ? <><input className={"wb-ex-inp"} style={{
            flex: 1.5,
            minWidth: 52,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"numeric"} placeholder={"HH:MM"} defaultValue={row.hhmm || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              hhmm: normalizeHHMM(e.target.value)
            };
            updateField("extraRows", rr);
          }} /><input className={"wb-ex-inp"} style={{
            flex: 0.8,
            minWidth: 34,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"number"} min={"0"} max={"59"} placeholder={"Sec"} defaultValue={row.sec || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              sec: e.target.value
            };
            updateField("extraRows", rr);
          }} /><input className={"wb-ex-inp"} style={{
            flex: 1,
            minWidth: 38,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"decimal"} placeholder={metric ? "km" : "mi"} defaultValue={row.distanceMi || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              distanceMi: e.target.value
            };
            updateField("extraRows", rr);
          }} />{isTreadmill && <input className={"wb-ex-inp"} style={{
            flex: 0.8,
            minWidth: 34,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"Inc"} defaultValue={row.incline || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              incline: e.target.value
            };
            updateField("extraRows", rr);
          }} />}{isTreadmill && <input className={"wb-ex-inp"} style={{
            flex: 0.8,
            minWidth: 34,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"Spd"} defaultValue={row.speed || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              speed: e.target.value
            };
            updateField("extraRows", rr);
          }} />}</> : <>{!noSetsEx && <input className={"wb-ex-inp"} style={{
            flex: 1,
            minWidth: 40,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"decimal"} placeholder={"Sets"} defaultValue={row.sets || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              sets: e.target.value
            };
            updateField("extraRows", rr);
          }} />}<input className={"wb-ex-inp"} style={{
            flex: 1,
            minWidth: 40,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"decimal"} placeholder={"Reps"} defaultValue={row.reps || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              reps: e.target.value
            };
            updateField("extraRows", rr);
          }} />{showW && <input className={"wb-ex-inp"} style={{
            flex: 1,
            minWidth: 38,
            padding: "4px 6px",
            fontSize: FS.md
          }} type={"text"} inputMode={"decimal"} placeholder={wUnit} defaultValue={row.weightLbs || ""} onBlur={e => {
            const rr = [...(ex.extraRows || [])];
            rr[ri] = {
              ...rr[ri],
              weightLbs: e.target.value || null
            };
            updateField("extraRows", rr);
          }} />}</>}<button className={"btn btn-danger btn-xs"} style={{
          padding: "2px 6px",
          flexShrink: 0
        }} onClick={() => {
          const rr = (ex.extraRows || []).filter((_, j) => j !== ri);
          updateField("extraRows", rr);
        }}>{"✕"}</button></div>)}<button className={"btn btn-ghost btn-xs"} style={{
        width: "100%",
        marginTop: S.s4,
        marginBottom: S.s8,
        fontSize: FS.sm,
        color: "#8a8478",
        borderStyle: "dashed"
      }} onClick={() => {
        const rr = [...(ex.extraRows || []), isC || isF ? {
          hhmm: "",
          sec: "",
          distanceMi: "",
          incline: "",
          speed: ""
        } : {
          sets: ex.sets || "",
          reps: ex.reps || "",
          weightLbs: ex.weightLbs || ""
        }];
        updateField("extraRows", rr);
      }}>{"＋ Add Row (e.g. "}{isC || isF ? "interval" : "progressive weight"}{")"}</button>{showHR && <div><label style={{
          fontSize: FS.sm,
          color: "#b0a898",
          marginBottom: S.s4,
          display: "block"
        }}>{"Avg Heart Rate Zone "}<span style={{
            opacity: .6,
            fontSize: FS.fs55
          }}>{"(optional)"}</span></label><div className={"hr-zone-row"}>{HR_ZONES.map(z => {
            const sel = ex.hrZone === z.z;
            const range = hrRange(age, z);
            return <div key={z.z} className={`hr-zone-btn ${sel ? "sel" : ""}`} style={{
              "--zc": z.color,
              borderColor: sel ? z.color : "rgba(45,42,36,.2)",
              background: sel ? `${z.color}22` : "rgba(45,42,36,.12)"
            }} onClick={() => updateField("hrZone", sel ? null : z.z)}><span className={"hz-name"} style={{
                color: sel ? z.color : "#8a8478"
              }}>{"Z"}{z.z}{" "}{z.name}</span><span className={"hz-bpm"} style={{
                color: sel ? z.color : "#8a8478"
              }}>{range.lo}{"–"}{range.hi}</span></div>;
          })}</div>{ex.hrZone && <div style={{
          fontSize: FS.fs65,
          color: "#8a8478",
          fontStyle: "italic",
          marginTop: S.s4
        }}>{HR_ZONES[ex.hrZone - 1].desc}</div>}</div>}</div>}</>;
});

const WorkoutsTab = memo(function WorkoutsTab({
  // View state
  workoutView, setWorkoutView,
  workoutSubTab, setWorkoutSubTab,
  // Label filter
  woLabelFilters, setWoLabelFilters,
  woLabelDropOpen, setWoLabelDropOpen,
  newLabelInput, setNewLabelInput,
  // Active workout
  activeWorkout, setActiveWorkout,
  collapsedWo, setCollapsedWo,
  // Live workout tracker
  liveWorkout, startLiveWorkout,
  // Profile
  profile, setProfile,
  // Recipe view
  recipeFilter, setRecipeFilter,
  recipeCatDrop, setRecipeCatDrop,
  expandedRecipeDesc, setExpandedRecipeDesc,
  expandedRecipeEx, setExpandedRecipeEx,
  // Builder state
  wbName, setWbName,
  wbIcon, setWbIcon,
  wbDesc, setWbDesc,
  wbExercises, setWbExercises,
  wbEditId, setWbEditId,
  wbIsOneOff, setWbIsOneOff,
  wbLabels, setWbLabels,
  wbDuration, setWbDuration,
  wbDurSec, setWbDurSec,
  wbActiveCal, setWbActiveCal,
  wbTotalCal, setWbTotalCal,
  wbCopySource, setWbCopySource,
  wbIconPickerOpen, setWbIconPickerOpen,
  wbExPickerOpen, setWbExPickerOpen,
  wbTotalXP,
  collapsedWbEx, setCollapsedWbEx,
  ssChecked, setSsChecked,
  ssAccordion, setSsAccordion,
  dragWbExIdx, setDragWbExIdx,
  // Callbacks (defined in App)
  initWorkoutBuilder,
  copyWorkout,
  openStatsPromptIfNeeded,
  setCompletionModal,
  setCompletionDate,
  setCompletionAction,
  setConfirmDelete,
  setSelEx,
  setPendingSoloRemoveId,
  quickLogSoloEx,
  openScheduleEx,
  setAddToWorkoutPicker,
  openExEditor,
  setAddToPlanPicker,
  deleteWorkout,
  reorderSupersetPair,
  reorderWbEx,
  saveBuiltWorkout,
  saveAsNewWorkout,
  daysUntil,
  showToast,
  // Computed
  allExById,
}) {
  function updateWbEx(idx, field, val) {
    setWbExercises(exs => exs.map((e, i) => i === idx ? { ...e, [field]: val } : e));
  }
function renderWbExFields(ex, idx, exD) {
  const _isC = exD.category === "cardio";
  const _isF = exD.category === "flexibility";
  const _showW = !_isC && !_isF;
  const _noSets = NO_SETS_EX_IDS.has(exD.id);
  const _isRunning = exD.id === RUNNING_EX_ID;
  const _isTread = exD.hasTreadmill || false;
  const _metric = isMetric(profile.units);
  const _wUnit = weightLabel(profile.units);
  const _dUnit = distLabel(profile.units);
  const _age = profile.age || 30;
  const _distMiVal = ex.distanceMi ? parseFloat(ex.distanceMi) : 0;
  const _durMin = parseFloat(ex.reps || 0);
  const _runPace = _isRunning && _distMiVal > 0 && _durMin > 0 ? _durMin / _distMiVal : null;
  const _runBoost = _runPace ? _runPace <= 8 ? 20 : 5 : 0;
  const _dispW = ex.weightLbs ? _metric ? lbsToKg(ex.weightLbs) : ex.weightLbs : "";
  const _dispDist = ex.distanceMi ? _metric ? String(parseFloat(miToKm(ex.distanceMi)).toFixed(2)) : String(ex.distanceMi) : "";
  return <><div style={{
      display: "flex",
      gap: S.s8,
      marginBottom: S.s6
    }}>{!_noSets && <div style={{
        flex: 1
      }}><label style={{
          fontSize: FS.sm,
          color: "#b0a898",
          marginBottom: S.s4,
          display: "block"
        }}>{"Sets"}</label><input className={"wb-ex-inp"} style={{
          width: "100%",
          padding: "6px 8px"
        }} type={"text"} inputMode={"decimal"} value={ex.sets === 0 || ex.sets === "" ? "" : ex.sets || ""} onChange={e => updateWbEx(idx, "sets", e.target.value)} /></div>}{_isC || _isF ? <><div style={{
          flex: 1.6,
          minWidth: 0
        }}><label style={{
            fontSize: FS.sm,
            color: "#b0a898",
            marginBottom: S.s4,
            display: "block"
          }}>{"Duration (HH:MM)"}</label><input className={"wb-ex-inp"} style={{
            width: "100%",
            padding: "4px 6px"
          }} type={"text"} inputMode={"numeric"} value={ex._durHHMM !== undefined ? ex._durHHMM : ex.durationSec ? secToHHMMSplit(ex.durationSec).hhmm : ex.reps ? "00:" + String(ex.reps).padStart(2, "0") : ""} onChange={e => updateWbEx(idx, "_durHHMM", e.target.value)} onBlur={e => {
            const h = normalizeHHMM(e.target.value);
            updateWbEx(idx, "_durHHMM", h || undefined);
            const s = combineHHMMSec(h, ex._durSecRaw || ex.durationSec ? secToHHMMSplit(ex.durationSec || 0).sec : "");
            updateWbEx(idx, "durationSec", s);
            if (s) updateWbEx(idx, "reps", Math.max(1, Math.floor(s / 60)));
          }} placeholder={"00:00"} /></div><div style={{
          flex: 0.9,
          minWidth: 0
        }}><label style={{
            fontSize: FS.sm,
            color: "#b0a898",
            marginBottom: S.s4,
            display: "block"
          }}>{"Sec"}</label><input className={"wb-ex-inp"} style={{
            width: "100%",
            padding: "4px 6px",
            textAlign: "center"
          }} type={"number"} min={"0"} max={"59"} value={ex._durSecRaw !== undefined ? String(ex._durSecRaw).padStart(2, "0") : ex.durationSec ? String(secToHHMMSplit(ex.durationSec).sec).padStart(2, "0") : ""} onChange={e => {
            const v = e.target.value;
            updateWbEx(idx, "_durSecRaw", v);
            const h2 = ex._durHHMM || (ex.durationSec ? secToHHMMSplit(ex.durationSec).hhmm : "");
            const s2 = combineHHMMSec(h2, v);
            updateWbEx(idx, "durationSec", s2);
            if (s2) updateWbEx(idx, "reps", Math.max(1, Math.floor(s2 / 60)));
          }} placeholder={"00"} /></div><div style={{
          flex: 1.4,
          minWidth: 0
        }}><label style={{
            fontSize: FS.sm,
            color: "#b0a898",
            marginBottom: S.s4,
            display: "block"
          }}>{"Dist ("}{_dUnit}{")"}</label><input className={"wb-ex-inp"} style={{
            width: "100%",
            padding: "4px 6px"
          }} type={"text"} inputMode={"decimal"} value={_dispDist} onChange={e => {
            const v = e.target.value;
            const mi = v && _metric ? kmToMi(v) : v;
            updateWbEx(idx, "distanceMi", mi || null);
          }} placeholder={"0"} /></div></> : <><div style={{
          flex: 1,
          minWidth: 0
        }}><label style={{
            fontSize: FS.sm,
            color: "#b0a898",
            marginBottom: S.s4,
            display: "block"
          }}>{"Reps"}</label><input className={"wb-ex-inp"} style={{
            width: "100%",
            padding: "6px 8px"
          }} type={"text"} inputMode={"decimal"} value={ex.reps === 0 || ex.reps === "" ? "" : ex.reps || ""} onChange={e => updateWbEx(idx, "reps", e.target.value)} /></div>{_showW && <div style={{
          flex: 1.2,
          minWidth: 0
        }}><label style={{
            fontSize: FS.sm,
            color: "#b0a898",
            marginBottom: S.s4,
            display: "block"
          }}>{"Weight ("}{_wUnit}{")"}</label><input className={"wb-ex-inp"} style={{
            width: "100%",
            padding: "6px 8px"
          }} type={"text"} inputMode={"decimal"} value={_dispW} onChange={e => {
            const v = e.target.value;
            const lbs = v && _metric ? kgToLbs(v) : v;
            updateWbEx(idx, "weightLbs", lbs || null);
          }} placeholder={"—"} /></div>}</>}</div>{_isRunning && _runBoost > 0 && <div style={{
      fontSize: FS.fs58,
      color: UI_COLORS.warning,
      marginBottom: S.s4
    }}>{"⚡ Pace bonus: +"}{_runBoost}{"% XP"}</div>}{_isTread && <div style={{
      marginBottom: S.s6
    }}><div style={{
        display: "flex",
        gap: S.s8
      }}><div style={{
          flex: 1
        }}><label style={{
            fontSize: FS.sm,
            color: "#b0a898",
            marginBottom: S.s4,
            display: "block"
          }}>{"Incline (0.5–15)"}</label><input className={"inp"} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"—"} style={{
            width: "100%",
            padding: "4px 6px"
          }} value={ex.incline || ""} onChange={e => updateWbEx(idx, "incline", e.target.value ? parseFloat(e.target.value) : null)} /></div><div style={{
          flex: 1
        }}><label style={{
            fontSize: FS.sm,
            color: "#b0a898",
            marginBottom: S.s4,
            display: "block"
          }}>{"Speed (0.5–15)"}</label><input className={"inp"} type={"number"} min={"0.5"} max={"15"} step={"0.5"} placeholder={"—"} style={{
            width: "100%",
            padding: "4px 6px"
          }} value={ex.speed || ""} onChange={e => updateWbEx(idx, "speed", e.target.value ? parseFloat(e.target.value) : null)} /></div></div></div>}{(ex.extraRows || []).map((row, ri) => <div key={ri} style={{
      display: "flex",
      gap: S.s4,
      marginTop: S.s4,
      padding: "6px 8px",
      background: "rgba(45,42,36,.18)",
      borderRadius: R.md,
      alignItems: "center",
      flexWrap: "wrap"
    }}><span style={{
        fontSize: FS.fs52,
        color: "#9a8a78",
        flexShrink: 0,
        minWidth: 16
      }}>{_isC || _isF ? `I${ri + 2}` : `S${ri + 2}`}</span>{_isC || _isF ? <><input className={"wb-ex-inp"} style={{
          flex: 1.5,
          minWidth: 52,
          padding: "4px 6px",
          fontSize: FS.md
        }} type={"text"} inputMode={"numeric"} placeholder={"HH:MM"} value={row.hhmm || ""} onChange={e => {
          const rr = [...(ex.extraRows || [])];
          rr[ri] = {
            ...rr[ri],
            hhmm: e.target.value
          };
          updateWbEx(idx, "extraRows", rr);
        }} onBlur={e => {
          const rr = [...(ex.extraRows || [])];
          rr[ri] = {
            ...rr[ri],
            hhmm: normalizeHHMM(e.target.value)
          };
          updateWbEx(idx, "extraRows", rr);
        }} /><input className={"wb-ex-inp"} style={{
          flex: 0.7,
          minWidth: 36,
          padding: "4px 6px",
          fontSize: FS.md
        }} type={"number"} min={"0"} max={"59"} placeholder={"Sec"} value={row.sec || ""} onChange={e => {
          const rr = [...(ex.extraRows || [])];
          rr[ri] = {
            ...rr[ri],
            sec: e.target.value
          };
          updateWbEx(idx, "extraRows", rr);
        }} /><input className={"wb-ex-inp"} style={{
          flex: 1,
          minWidth: 40,
          padding: "4px 6px",
          fontSize: FS.md
        }} type={"text"} inputMode={"decimal"} placeholder={_dUnit} value={row.distanceMi || ""} onChange={e => {
          const rr = [...(ex.extraRows || [])];
          rr[ri] = {
            ...rr[ri],
            distanceMi: e.target.value
          };
          updateWbEx(idx, "extraRows", rr);
        }} /></> : <><input className={"wb-ex-inp"} style={{
          flex: 1,
          minWidth: 40,
          padding: "4px 6px",
          fontSize: FS.md
        }} type={"text"} inputMode={"decimal"} placeholder={"Sets"} value={row.sets || ""} onChange={e => {
          const rr = [...(ex.extraRows || [])];
          rr[ri] = {
            ...rr[ri],
            sets: e.target.value
          };
          updateWbEx(idx, "extraRows", rr);
        }} /><input className={"wb-ex-inp"} style={{
          flex: 1,
          minWidth: 40,
          padding: "4px 6px",
          fontSize: FS.md
        }} type={"text"} inputMode={"decimal"} placeholder={"Reps"} value={row.reps || ""} onChange={e => {
          const rr = [...(ex.extraRows || [])];
          rr[ri] = {
            ...rr[ri],
            reps: e.target.value
          };
          updateWbEx(idx, "extraRows", rr);
        }} /><input className={"wb-ex-inp"} style={{
          flex: 1,
          minWidth: 40,
          padding: "4px 6px",
          fontSize: FS.md
        }} type={"text"} inputMode={"decimal"} placeholder={_wUnit} value={row.weightLbs || ""} onChange={e => {
          const rr = [...(ex.extraRows || [])];
          rr[ri] = {
            ...rr[ri],
            weightLbs: e.target.value
          };
          updateWbEx(idx, "extraRows", rr);
        }} /></>}<button className={"btn btn-danger btn-xs"} style={{
        padding: "2px 4px",
        flexShrink: 0
      }} onClick={() => {
        const rr = (ex.extraRows || []).filter((_, j) => j !== ri);
        updateWbEx(idx, "extraRows", rr);
      }}>{"✕"}</button></div>)}<button className={"btn btn-ghost btn-xs"} style={{
      width: "100%",
      marginTop: S.s4,
      marginBottom: S.s4,
      fontSize: FS.sm,
      color: "#8a8478",
      borderStyle: "dashed"
    }} onClick={() => {
      const rr = [...(ex.extraRows || []), _isC || _isF ? {
        hhmm: "",
        sec: "",
        distanceMi: ""
      } : {
        sets: ex.sets || "",
        reps: ex.reps || "",
        weightLbs: ex.weightLbs || ""
      }];
      updateWbEx(idx, "extraRows", rr);
    }}>{"＋ Add Row (e.g. "}{_isC || _isF ? "interval" : "progressive weight"}{")"}</button></>;
}
function renderSsAccordionSection(ex, idx, exD, label, sectionKey) {
  const collapsed = !!ssAccordion[sectionKey];
  const _noSets = NO_SETS_EX_IDS.has(exD.id);
  const _isC = exD.category === "cardio";
  const _isF = exD.category === "flexibility";
  const _metric = isMetric(profile.units);
  const _wUnit = weightLabel(profile.units);
  const _distMiVal = ex.distanceMi ? parseFloat(ex.distanceMi) : 0;
  const _durMin = parseFloat(ex.reps || 0);
  const _isRunning = exD.id === RUNNING_EX_ID;
  const _runPace = _isRunning && _distMiVal > 0 && _durMin > 0 ? _durMin / _distMiVal : null;
  const _runBoost = _runPace ? _runPace <= 8 ? 20 : 5 : 0;
  const xpVal = (() => {
    const extraCount = (ex.extraRows || []).length;
    const b = calcExXP(ex.exId, _noSets ? 1 : ex.sets, ex.reps, profile.chosenClass, allExById, _distMiVal || null, ex.weightLbs || null, null, extraCount);
    const r = (ex.extraRows || []).reduce((s, row) => s + calcExXP(ex.exId, parseInt(row.sets) || parseInt(ex.sets) || 3, parseInt(row.reps) || parseInt(ex.reps) || 10, profile.chosenClass, allExById, null, ex.weightLbs || null, null, extraCount), 0);
    return b + r;
  })();
  const summaryText = (_noSets ? "" : ex.sets + "×") + ex.reps + (ex.weightLbs ? ` · ${displayWt(ex.weightLbs, profile.units)}` : "");
  return <div className={"ss-section"}><div className={"ss-section-hdr"} onClick={() => setSsAccordion(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }))}><div className={"ab-badge"}>{label}</div><div style={{
        width: 28,
        height: 28,
        borderRadius: R.md,
        flexShrink: 0,
        background: "rgba(45,42,36,.15)",
        border: "1px solid rgba(180,172,158,.05)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: FS.fs80
      }}>{exD.icon}</div><span style={{
        fontFamily: "'Cinzel',serif",
        fontSize: FS.fs66,
        color: "#d8caba",
        letterSpacing: ".02em",
        flex: 1,
        minWidth: 0
      }}>{exD.name}</span>{collapsed && <span style={{
        fontSize: FS.fs55,
        color: "#8a8478"
      }}>{summaryText}</span>}<span style={{
        fontSize: FS.sm,
        fontWeight: 700,
        color: "#b4ac9e",
        flexShrink: 0
      }}>{"+" + xpVal}</span><span style={{
        fontSize: FS.sm,
        color: "#8a8478",
        transition: "transform .2s",
        transform: collapsed ? "rotate(0deg)" : "rotate(180deg)"
      }}>{"▼"}</span></div>{!collapsed && <div className={"ss-section-body"}>{renderWbExFields(ex, idx, exD)}</div>}</div>;
}
const metric = isMetric(profile.units);
const wUnit = weightLabel(profile.units);
const allW = profile.workouts || [];
const calcWorkoutXP = wo => (wo.exercises || []).reduce((s, ex) => {
  const extraCount = (ex.extraRows || []).length;
  const base = calcExXP(ex.exId, ex.sets || 3, ex.reps || 10, profile.chosenClass, allExById, null, null, null, extraCount);
  const rowsXP = (ex.extraRows || []).reduce((rs, row) => rs + calcExXP(ex.exId, parseInt(row.sets) || parseInt(ex.sets) || 3, parseInt(row.reps) || parseInt(ex.reps) || 10, profile.chosenClass, allExById, null, null, null, extraCount), 0);
  return s + base + rowsXP;
}, 0);

// ── LIST ───────────────────────────────
if (workoutView === "list") return <><div className={"wo-sticky-filters"}><div style={{
      marginBottom: S.s8
    }}><div className={"rpg-sec-header rpg-sec-header-center"}><div className={"rpg-sec-line rpg-sec-line-l"} /><span className={"rpg-sec-title"}>{"✦ Arsenal ✦"}<span className={"info-icon"} style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: "1px solid rgba(180,172,158,.15)",
            fontSize: FS.fs48,
            fontWeight: 700,
            color: "#8a8478",
            fontStyle: "normal",
            marginLeft: S.s6,
            verticalAlign: "middle",
            cursor: "pointer",
            position: "relative"
          }}>{"?"}<span className={"info-tooltip"}>{"Pre-defined groups of exercises. Build once, reuse anytime in plans or as one-off sessions."}</span></span></span><div className={"rpg-sec-line rpg-sec-line-r"} /></div></div>
    {
      /* Subtabs */
    }<div className={"log-subtab-bar"} style={{
      marginBottom: S.s0
    }}>{[["reusable", "⚔ Re-Usable"], ["oneoff", "⚡ One-Off"]].map(([t, l]) => <button key={t} className={`log-subtab-btn ${workoutSubTab === t ? "on" : ""}`} onClick={() => setWorkoutSubTab(t)}>{l}</button>)}</div></div>
  {
    /* Label filter dropdown */
  }{(profile.workoutLabels || []).length > 0 && <div style={{
    display: "flex",
    gap: S.s8,
    marginBottom: S.s10,
    position: "relative"
  }}>{woLabelDropOpen && <div onClick={() => setWoLabelDropOpen(false)} style={{
      position: "fixed",
      inset: 0,
      zIndex: 19
    }} />}<div style={{
      position: "relative",
      zIndex: 20
    }}><button onClick={() => setWoLabelDropOpen(!woLabelDropOpen)} style={{
        padding: "8px 28px 8px 10px",
        borderRadius: R.xl,
        border: "1px solid " + (woLabelFilters.size > 0 ? "#C4A044" : "rgba(45,42,36,.3)"),
        background: "rgba(14,14,12,.95)",
        color: woLabelFilters.size > 0 ? "#C4A044" : "#8a8478",
        fontSize: FS.lg,
        textAlign: "left",
        cursor: "pointer",
        position: "relative"
      }}>{woLabelFilters.size > 0 ? "Labels (" + woLabelFilters.size + ")" : "Labels"}<span style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%) rotate(" + (woLabelDropOpen ? "180deg" : "0deg") + ")",
          color: woLabelFilters.size > 0 ? "#C4A044" : "#8a8478",
          fontSize: FS.sm,
          transition: "transform .15s",
          lineHeight: 1
        }}>{"▼"}</span></button>{woLabelDropOpen && <div style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        left: 0,
        minWidth: 180,
        background: "rgba(16,14,10,.95)",
        border: "1px solid rgba(180,172,158,.07)",
        borderRadius: R.xl,
        padding: "6px 4px",
        zIndex: 21,
        boxShadow: "0 8px 24px rgba(0,0,0,.6)"
      }}>{(profile.workoutLabels || []).map(l => {
          const sel = woLabelFilters.has(l);
          return <div key={l} onClick={() => setWoLabelFilters(s => {
            const n = new Set(s);
            n.has(l) ? n.delete(l) : n.add(l);
            return n;
          })} style={{
            display: "flex",
            alignItems: "center",
            gap: S.s8,
            padding: "6px 10px",
            borderRadius: R.md,
            cursor: "pointer",
            background: sel ? "rgba(196,160,68,.12)" : "transparent"
          }}><div style={{
              width: 14,
              height: 14,
              borderRadius: R.r3,
              flexShrink: 0,
              border: "1.5px solid " + (sel ? "#C4A044" : "rgba(180,172,158,.08)"),
              background: sel ? "rgba(196,160,68,.25)" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>{sel && <span style={{
                fontSize: FS.sm,
                color: "#C4A044",
                lineHeight: 1
              }}>{"✓"}</span>}</div><span style={{
              fontSize: FS.lg,
              color: sel ? "#C4A044" : "#b4ac9e",
              whiteSpace: "nowrap"
            }}>{l}</span></div>;
        })}<div className={"wo-label-new-row"}><input className={"wo-label-new-inp"} value={newLabelInput} onChange={e => setNewLabelInput(e.target.value)} onClick={e => e.stopPropagation()} onKeyDown={e => {
            if (e.key === "Enter" && newLabelInput.trim()) {
              const lbl = newLabelInput.trim();
              if (!(profile.workoutLabels || []).some(x => x.toLowerCase() === lbl.toLowerCase())) {
                setProfile(p => ({
                  ...p,
                  workoutLabels: [...(p.workoutLabels || []), lbl]
                }));
              }
              setNewLabelInput("");
            }
          }} placeholder={"+ New label…"} /><button className={"btn btn-ghost btn-xs"} style={{
            padding: "2px 6px",
            fontSize: FS.sm
          }} onClick={e => {
            e.stopPropagation();
            const lbl = newLabelInput.trim();
            if (!lbl) return;
            if (!(profile.workoutLabels || []).some(x => x.toLowerCase() === lbl.toLowerCase())) {
              setProfile(p => ({
                ...p,
                workoutLabels: [...(p.workoutLabels || []), lbl]
              }));
            }
            setNewLabelInput("");
          }}>{"+"}</button></div></div>}</div>{woLabelFilters.size > 0 && <button className={"btn btn-ghost btn-xs"} style={{
      fontSize: FS.sm,
      color: "#8a8478",
      alignSelf: "center"
    }} onClick={() => setWoLabelFilters(new Set())}>{"Clear"}</button>}</div>}{workoutSubTab === "reusable" && <><div style={{
      display: "flex",
      gap: S.s8,
      marginBottom: S.s14
    }}><button className={"btn btn-gold btn-sm"} onClick={() => initWorkoutBuilder(null)}>{"＋ New Workout"}</button><button className={"btn btn-ghost btn-sm"} onClick={() => setWorkoutView("recipes")}>{"📋 Recipes"}</button></div>{(() => {
      const reusableWo = allW.filter(w => !w.oneOff);
      const filtered = reusableWo.filter(w => woLabelFilters.size === 0 || (w.labels || []).some(l => woLabelFilters.has(l)));
      if (reusableWo.length === 0) return <div className={"empty"}>{"No reusable workouts yet."}<br />{"Create your first custom workout or start from a template."}</div>;
      if (filtered.length === 0 && woLabelFilters.size > 0) return <div className={"empty"}>{"No workouts match the selected labels."}</div>;
      return null;
    })()}{allW.filter(w => !w.oneOff).filter(w => woLabelFilters.size === 0 || (w.labels || []).some(l => woLabelFilters.has(l))).map(wo => {
      const exCount = wo.exercises.length;
      const xp = calcWorkoutXP(wo);
      const woMgColor = getWorkoutMgColor(wo, allExById, MUSCLE_COLORS);
      return <div key={wo.id} className={"workout-card"} style={{
        "--mg-color": woMgColor
      }}><div className={"workout-card-top"} style={{
          cursor: "pointer"
        }} onClick={() => {
          setActiveWorkout(wo);
          setWorkoutView("detail");
        }}><div className={"workout-icon"}>{wo.icon}</div><div style={{
            flex: 1,
            minWidth: 0
          }}><div className={"workout-name"}>{wo.name}</div><div className={"workout-meta"}><span className={"workout-tag"}>{exCount}{" exercise"}{exCount !== 1 ? "s" : ""}</span><span className={"workout-tag"}>{formatXP(xp, {
                  prefix: "⚡ "
                })}</span>{(wo.labels || []).map(l => <span key={l} className={"wo-label-chip"} style={{
                pointerEvents: "none",
                marginLeft: S.s2
              }}>{l}</span>)}</div></div><button className={`track-toggle-btn${liveWorkout?.workoutId === wo.id ? " on" : ""}`} onClick={e => { e.stopPropagation(); startLiveWorkout(wo); }}>{"▶ Track"}</button></div></div>;
    })}</>}{workoutSubTab === "oneoff" && <>{(() => {
      const _now = new Date();
      const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
      const grouped = {};
      (profile.scheduledWorkouts || []).forEach(sw => {
        if (!sw.sourceWorkoutId) return;
        if (sw.scheduledDate < today) return;
        const key = sw.sourceWorkoutId;
        if (!grouped[key]) grouped[key] = {
          id: sw.sourceWorkoutId,
          name: sw.sourceWorkoutName,
          icon: sw.sourceWorkoutIcon || "⚡",
          date: sw.scheduledDate,
          items: []
        };
        grouped[key].items.push(sw);
      });
      const scheduled = Object.values(grouped).filter(g => {
        if (woLabelFilters.size === 0) return true;
        const wo = (profile.workouts || []).find(w => w.id === g.id);
        return (wo && wo.labels || []).some(l => woLabelFilters.has(l));
      }).sort((a, b) => a.date.localeCompare(b.date));
      const hasSoloExs = (profile.scheduledWorkouts || []).some(sw => !sw.sourceWorkoutId && sw.exId && sw.scheduledDate >= today);
      if (scheduled.length === 0 && !hasSoloExs && woLabelFilters.size === 0) return <div className={"empty"}>{"No upcoming one-off workouts."}<br />{"Select exercises and tap ⚡ One-Off Workout to schedule one."}</div>;
      if (scheduled.length === 0 && !hasSoloExs && woLabelFilters.size > 0) return <div className={"empty"}>{"No one-off workouts match the selected labels."}</div>;
      if (scheduled.length === 0) return null;
      return scheduled.map(g => {
        const days = daysUntil(g.date);
        const badgeCls = days === 0 ? "badge-today" : days <= 3 ? "badge-soon" : "badge-future";
        const badgeTxt = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d away`;
        const wo = (profile.workouts || []).find(w => w.id === g.id) || {
          id: g.id,
          name: g.name,
          icon: g.icon,
          desc: "",
          exercises: g.items.map(sw => ({
            exId: sw.exId,
            sets: 3,
            reps: 10,
            weightLbs: null,
            weightPct: 100,
            distanceMi: null,
            hrZone: null
          })),
          oneOff: true,
          durationMin: null,
          activeCal: null,
          totalCal: null
        };
        const xp = calcWorkoutXP(wo);
        const woMgColor = getWorkoutMgColor(wo, allExById, MUSCLE_COLORS);
        return <div key={g.id} className={"workout-card"} style={{
          "--mg-color": woMgColor
        }}><div className={"workout-card-top"} style={{
            cursor: "pointer"
          }} onClick={() => {
            setActiveWorkout(wo);
            setWorkoutView("detail");
          }}><div className={"workout-icon"}>{g.icon}</div><div style={{
              flex: 1,
              minWidth: 0
            }}><div className={"workout-name"}>{g.name}</div><div className={"workout-meta"}><span className={"workout-tag"}>{g.items.length}{" exercise"}{g.items.length !== 1 ? "s" : ""}</span><span className={"workout-tag"}>{formatXP(xp, {
                    prefix: "⚡ "
                  })}</span><span className={`upcoming-badge ${badgeCls}`} style={{
                  marginLeft: S.s4
                }}>{badgeTxt}</span>{(wo.labels || []).map(l => <span key={l} className={"wo-label-chip"} style={{
                  pointerEvents: "none",
                  marginLeft: S.s2
                }}>{l}</span>)}</div></div><button className={`track-toggle-btn${liveWorkout?.workoutId === wo.id ? " on" : ""}`} onClick={e => { e.stopPropagation(); startLiveWorkout(wo); }}>{"▶ Track"}</button></div>
          {
            /* Action row */
          }<div style={{
            display: "flex",
            gap: S.s6,
            marginTop: S.s6,
            paddingTop: 6,
            borderTop: "1px solid rgba(180,172,158,.04)"
          }}><button className={"btn btn-ghost btn-xs"} style={{
              fontSize: FS.fs62,
              color: "#8a8478"
            }} onClick={() => {
              const reusable = {
                ...wo,
                oneOff: false,
                createdAt: wo.createdAt || todayStr()
              };
              setProfile(p => ({
                ...p,
                workouts: (p.workouts || []).map(w => w.id === wo.id ? reusable : w).concat((p.workouts || []).find(w => w.id === wo.id) ? [] : [reusable]),
                scheduledWorkouts: (p.scheduledWorkouts || []).filter(sw => sw.sourceWorkoutId !== g.id)
              }));
              setWorkoutSubTab("reusable");
              showToast(`\uD83D\uDCAA "${wo.name}" added to Re-Usable Workouts!`);
            }}>{"💪 Make Reusable"}</button><div style={{
              flex: 1
            }} /><button className={"btn btn-gold btn-sm"} onClick={() => {
              openStatsPromptIfNeeded(wo, (woWithStats, _sr) => {
                setCompletionModal({
                  workout: {
                    ...woWithStats,
                    oneOff: true
                  },
                  fromStats: _sr
                });
                setCompletionDate(todayStr());
                setCompletionAction("today");
              });
            }}>{"✓ Complete"}</button></div></div>;
      });
    })()}{(() => {
      const _now2 = new Date();
      const today = `${_now2.getFullYear()}-${String(_now2.getMonth() + 1).padStart(2, '0')}-${String(_now2.getDate()).padStart(2, '0')}`;
      const soloExs = (profile.scheduledWorkouts || []).filter(sw => !sw.sourceWorkoutId && sw.exId && sw.scheduledDate >= today).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
      if (soloExs.length === 0) return null;
      return <><div className={"wo-section-hdr"}><span className={"wo-section-hdr-text"}>{"Solo Exercises"}</span></div>{soloExs.map(sw => {
          const ex = allExById[sw.exId];
          if (!ex) return null;
          const days = daysUntil(sw.scheduledDate);
          const badgeCls = days === 0 ? "badge-today" : days <= 3 ? "badge-soon" : "badge-future";
          const badgeTxt = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d away`;
          const soloMg = (ex.muscleGroup || "").toLowerCase().trim();
          const soloMgColor = MUSCLE_COLORS[soloMg] || "#B0A090";
          return <div key={sw.id} className={"workout-card"} style={{
            "--mg-color": soloMgColor
          }}><div className={"workout-card-top"}><div className={"workout-icon"}>{ex.icon}</div><div style={{
                flex: 1,
                minWidth: 0
              }}><div className={"workout-name"}>{ex.name}</div><div className={"workout-meta"}><span className={`upcoming-badge ${badgeCls}`} style={{
                    marginLeft: S.s4
                  }}>{badgeTxt}</span></div>{sw.notes && <div className={"workout-desc"} style={{
                  marginTop: S.s4
                }}>{sw.notes}</div>}</div><div style={{
                display: "flex",
                gap: S.s4,
                flexShrink: 0,
                alignItems: "center"
              }}><button className={"btn btn-ghost btn-sm"} style={{
                  fontSize: FS.fs65,
                  color: "#b4ac9e",
                  padding: "4px 6px"
                }} onClick={e => {
                  e.stopPropagation();
                  setSelEx(sw.exId);
                  setPendingSoloRemoveId(sw.id);
                }}>{"✎"}</button><button className={"btn btn-ghost btn-sm"} style={{
                  color: UI_COLORS.danger
                }} onClick={() => {
                  setProfile(p => ({
                    ...p,
                    scheduledWorkouts: (p.scheduledWorkouts || []).filter(s => s.id !== sw.id)
                  }));
                  showToast("Scheduled exercise removed.");
                }}>{"✕"}</button></div></div><div style={{
              display: "flex",
              gap: S.s6,
              marginTop: S.s6,
              paddingTop: 6,
              borderTop: "1px solid rgba(180,172,158,.04)"
            }}><button className={"btn btn-gold btn-sm"} style={{
                flex: 1
              }} onClick={() => quickLogSoloEx(sw)}>{"⚡ Quick Log"}</button><button className={"btn btn-ghost btn-sm"} style={{
                flex: 1,
                fontSize: FS.fs58,
                borderColor: "rgba(180,172,158,.15)",
                color: "#b4ac9e"
              }} onClick={e => {
                e.stopPropagation();
                openScheduleEx(sw.exId, sw.id);
              }}>{"📅 Reschedule"}</button><button className={"btn btn-ghost btn-sm"} style={{
                flex: 1,
                fontSize: FS.fs58,
                borderColor: "rgba(45,42,36,.3)",
                color: "#8a8478"
              }} onClick={() => {
                const ex2 = allExById[sw.exId];
                if (!ex2) return;
                const exEntry = {
                  exId: ex2.id,
                  sets: ex2.defaultSets || 3,
                  reps: ex2.defaultReps || 10,
                  weightLbs: null,
                  durationMin: null,
                  weightPct: 100,
                  distanceMi: null,
                  hrZone: null
                };
                setAddToWorkoutPicker({
                  exercises: [exEntry]
                });
              }}>{"➕ Add to Workout"}</button></div></div>;
        })}</>;
    })()}</>}</>;

// ── TEMPLATES ──────────────────────────
if (workoutView === "recipes") {
  const filteredTpls = recipeFilter.size === 0 ? WORKOUT_TEMPLATES : WORKOUT_TEMPLATES.filter(t => recipeFilter.has(t.category) || recipeFilter.has(t.equipment));
  return <><div className={"wo-sticky-filters"}><div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: S.s8
      }}><button className={"btn btn-ghost btn-sm"} onClick={() => setWorkoutView("list")}>{"← Back"}</button><div className={"sec"} style={{
          margin: 0,
          border: "none",
          padding: S.s0
        }}>{"Workout Recipes"}</div><div /></div>
      {
        /* Category multi-select dropdown */
      }<div style={{
        display: "flex",
        gap: S.s8,
        marginBottom: S.s0,
        position: "relative"
      }}>{recipeCatDrop && <div onClick={() => setRecipeCatDrop(false)} style={{
          position: "fixed",
          inset: 0,
          zIndex: 19
        }} />}<div style={{
          position: "relative",
          zIndex: 20
        }}><button onClick={() => setRecipeCatDrop(!recipeCatDrop)} style={{
            padding: "8px 28px 8px 10px",
            borderRadius: R.xl,
            border: "1px solid " + (recipeFilter.size > 0 ? "#C4A044" : "rgba(45,42,36,.3)"),
            background: "rgba(14,14,12,.95)",
            color: recipeFilter.size > 0 ? "#C4A044" : "#8a8478",
            fontSize: FS.lg,
            textAlign: "left",
            cursor: "pointer",
            position: "relative"
          }}>{recipeFilter.size > 0 ? "Category (" + recipeFilter.size + ")" : "Category"}<span style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%) rotate(" + (recipeCatDrop ? "180deg" : "0deg") + ")",
              color: recipeFilter.size > 0 ? "#C4A044" : "#8a8478",
              fontSize: FS.sm,
              transition: "transform .15s",
              lineHeight: 1
            }}>{"▼"}</span></button>{recipeCatDrop && <div style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: 200,
            maxHeight: 280,
            overflowY: "auto",
            background: "rgba(16,14,10,.95)",
            border: "1px solid rgba(180,172,158,.07)",
            borderRadius: R.xl,
            padding: "6px 4px",
            zIndex: 21,
            boxShadow: "0 8px 24px rgba(0,0,0,.6)"
          }}>{RECIPE_CATS.filter(c => c !== "All").map(cat => {
              const sel = recipeFilter.has(cat);
              return <div key={cat} onClick={() => setRecipeFilter(s => {
                const n = new Set(s);
                n.has(cat) ? n.delete(cat) : n.add(cat);
                return n;
              })} style={{
                display: "flex",
                alignItems: "center",
                gap: S.s8,
                padding: "6px 10px",
                borderRadius: R.md,
                cursor: "pointer",
                background: sel ? "rgba(196,160,68,.12)" : "transparent"
              }}><div style={{
                  width: 14,
                  height: 14,
                  borderRadius: R.r3,
                  flexShrink: 0,
                  border: "1.5px solid " + (sel ? "#C4A044" : "rgba(180,172,158,.08)"),
                  background: sel ? "rgba(196,160,68,.25)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}>{sel && <span style={{
                    fontSize: FS.sm,
                    color: "#C4A044",
                    lineHeight: 1
                  }}>{"✓"}</span>}</div><span style={{
                  fontSize: FS.lg,
                  color: sel ? "#C4A044" : "#b4ac9e",
                  whiteSpace: "nowrap"
                }}>{cat}</span></div>;
            })}</div>}</div>{recipeFilter.size > 0 && <button className={"btn btn-ghost btn-xs"} style={{
          fontSize: FS.sm,
          color: "#8a8478",
          alignSelf: "center"
        }} onClick={() => setRecipeFilter(new Set())}>{"Clear"}</button>}</div></div>{filteredTpls.length === 0 && <div className={"empty"}>{"No recipes match the selected categories."}</div>}{filteredTpls.map(tpl => {
      const xp = tpl.exercises.reduce((t, ex) => t + calcExXP(ex.exId, ex.sets, ex.reps, profile.chosenClass, allExById), 0);
      const descExpanded = expandedRecipeDesc.has(tpl.id);
      const tplMgColor = getRecipeMgColor(tpl);
      const diffCls = tpl.difficulty ? `wo-diff-pill wo-diff-${tpl.difficulty.toLowerCase()}` : null;
      return <div key={tpl.id} className={"workout-card"} style={{
        marginBottom: S.s12,
        "--mg-color": tplMgColor
      }}><div className={"workout-card-top"}><div className={"workout-icon"}>{tpl.icon}</div><div style={{
            flex: 1,
            minWidth: 0
          }}><div className={"workout-name"}>{tpl.name}</div><div className={"workout-meta"}>{tpl.category && <span className={"wo-cat-pill"}>{tpl.category}</span>}{tpl.difficulty && <span className={diffCls}>{tpl.difficulty}</span>}<span className={"workout-tag"}>{tpl.exercises.length}{" ex"}</span><span className={"workout-tag"}>{formatXP(xp, {
                  prefix: "⚡ "
                })}</span>{tpl.durationMin && <span className={"workout-tag"}>{"⏱ "}{tpl.durationMin}{"min"}</span>}{tpl.equipment && <span className={"workout-tag"}>{EQUIP_ICONS[tpl.equipment] || ""}{" "}{tpl.equipment}</span>}</div></div></div>
        {
          /* Collapsible Description */
        }{tpl.desc && <div style={{
          position: "relative",
          marginBottom: descExpanded ? 10 : 4,
          marginTop: S.s6
        }}><div className={descExpanded ? "" : "recipe-desc-collapsed"} style={{
            fontSize: FS.lg,
            color: "#8a8478",
            fontStyle: "italic",
            lineHeight: 1.5,
            whiteSpace: "pre-line",
            paddingRight: 20
          }}>{tpl.desc}</div><span className={`ex-collapse-btn ${descExpanded ? "open" : ""}`} style={{
            position: "absolute",
            top: 0,
            right: 0,
            fontSize: FS.md,
            padding: "0 4px",
            cursor: "pointer"
          }} onClick={() => setExpandedRecipeDesc(s => {
            const n = new Set(s);
            n.has(tpl.id) ? n.delete(tpl.id) : n.add(tpl.id);
            return n;
          })}>{"▼"}</span></div>
        /* Exercise breakdown — collapsible, collapsed by default */}<div style={{
          background: "rgba(45,42,36,.12)",
          border: "1px solid rgba(45,42,36,.18)",
          borderRadius: R.lg,
          padding: "8px 12px",
          marginBottom: S.s12,
          cursor: "pointer"
        }} onClick={() => setExpandedRecipeEx(s => {
          const n = new Set(s);
          n.has(tpl.id) ? n.delete(tpl.id) : n.add(tpl.id);
          return n;
        })}><div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}><span style={{
              fontSize: FS.fs68,
              color: "#8a8478"
            }}>{tpl.exercises.length}{" exercises"}</span><span className={`ex-collapse-btn ${expandedRecipeEx.has(tpl.id) ? "open" : ""}`} style={{
              fontSize: FS.fs65
            }}>{"▼"}</span></div>{expandedRecipeEx.has(tpl.id) && <div style={{
            marginTop: S.s8
          }}>{(() => {
              const rendered = new Set();
              return tpl.exercises.map((ex, i) => {
                if (rendered.has(i)) return null;
                const exD = allExById[ex.exId];
                if (!exD) return null;
                const noSets = NO_SETS_EX_IDS.has(ex.exId);
                // Check for superset pair
                if (ex.supersetWith != null && !rendered.has(ex.supersetWith)) {
                  const j = ex.supersetWith;
                  const exB = tpl.exercises[j];
                  const exDB = allExById[exB?.exId];
                  if (exDB) {
                    rendered.add(i);
                    rendered.add(j);
                    const noSetsB = NO_SETS_EX_IDS.has(exB.exId);
                    return <div key={i} className={"recipe-ss-group"} style={{
                      borderLeft: "2px solid #C4A044",
                      paddingLeft: 8,
                      marginBottom: S.s6,
                      marginTop: i > 0 ? 6 : 0
                    }}><div style={{
                        fontSize: FS.fs58,
                        color: "#C4A044",
                        fontWeight: 600,
                        marginBottom: S.s4,
                        textTransform: "uppercase",
                        letterSpacing: ".5px"
                      }}>{"🔗 Superset"}</div><div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: S.s8,
                        padding: "3px 0"
                      }}><span style={{
                          fontSize: FS.fs90,
                          flexShrink: 0
                        }}>{exD.icon}</span><span style={{
                          fontSize: FS.fs75,
                          color: "#d4cec4",
                          flex: 1
                        }}>{exD.name}</span><span style={{
                          fontSize: FS.fs68,
                          color: "#8a8478"
                        }}>{noSets ? `${ex.reps} min` : `${ex.sets} × ${ex.reps}`}</span></div><div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: S.s8,
                        padding: "3px 0"
                      }}><span style={{
                          fontSize: FS.fs90,
                          flexShrink: 0
                        }}>{exDB.icon}</span><span style={{
                          fontSize: FS.fs75,
                          color: "#d4cec4",
                          flex: 1
                        }}>{exDB.name}</span><span style={{
                          fontSize: FS.fs68,
                          color: "#8a8478"
                        }}>{noSetsB ? `${exB.reps} min` : `${exB.sets} × ${exB.reps}`}</span></div></div>;
                  }
                }
                rendered.add(i);
                return <div key={i} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: S.s8,
                  padding: "4px 0",
                  borderBottom: i < tpl.exercises.length - 1 ? "1px solid rgba(45,42,36,.15)" : ""
                }}><span style={{
                    fontSize: FS.fs90,
                    flexShrink: 0
                  }}>{exD.icon}</span><span style={{
                    fontSize: FS.fs75,
                    color: "#d4cec4",
                    flex: 1
                  }}>{exD.name}</span><span style={{
                    fontSize: FS.fs68,
                    color: "#8a8478"
                  }}>{noSets ? `${ex.distanceMi ? ex.distanceMi + "mi · " : ""}${ex.reps} min` : `${ex.sets} × ${ex.reps}`}</span></div>;
              });
            })()}</div>}</div><div style={{
          display: "flex",
          gap: S.s8
        }}><button className={"btn btn-gold btn-sm"} style={{
            flex: 1
          }} onClick={() => {
            const wo = {
              id: uid(),
              name: tpl.name,
              icon: tpl.icon,
              desc: tpl.desc,
              exercises: tpl.exercises.map(e => ({
                ...e
              })),
              createdAt: new Date().toLocaleDateString()
            };
            setProfile(pr => ({
              ...pr,
              workouts: [...(pr.workouts || []), wo]
            }));
            setActiveWorkout(wo);
            setWorkoutView("detail");
            showToast(`${tpl.icon} ${tpl.name} added to your workouts!`);
          }}>{"＋ Add to My Workouts"}</button><button className={"btn btn-ghost btn-sm"} style={{
            flex: 1
          }} onClick={() => {
            setWbName(tpl.name);
            setWbIcon(tpl.icon);
            setWbDesc(tpl.desc);
            setWbExercises(tpl.exercises.map(e => ({
              ...e
            })));
            setWbEditId(null);
            setWorkoutView("builder");
          }}>{"✎ Customize First"}</button></div></div>;
    })}</>;
}

// ── DETAIL ─────────────────────────────
if (workoutView === "detail" && activeWorkout) {
  const wo = activeWorkout;
  const xp = calcWorkoutXP(wo);
  return <><div style={{
      display: "flex",
      alignItems: "center",
      gap: S.s8,
      marginBottom: S.s12
    }}><button className={"btn btn-ghost btn-sm"} onClick={() => {
        setWorkoutView("list");
        setActiveWorkout(null);
      }}>{"← Back"}</button><div className={"sec"} style={{
        margin: 0,
        border: "none",
        padding: S.s0,
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }}>{wo.icon}{" "}{wo.name}</div><div style={{
        display: "flex",
        gap: S.s6,
        flexShrink: 0
      }}><button className={"btn btn-ghost btn-sm"} title={"Copy workout"} onClick={() => copyWorkout(wo)}>{"⎘ Copy"}</button><button className={"btn btn-ghost btn-sm"} onClick={() => initWorkoutBuilder(wo)}>{"✎ Edit"}</button></div></div>{wo.desc && <div style={{
      fontSize: FS.fs75,
      color: "#8a8478",
      fontStyle: "italic",
      marginBottom: S.s10
    }}>{wo.desc}</div>}<div style={{
      display: "flex",
      gap: S.s8,
      marginBottom: S.s14,
      flexWrap: "wrap"
    }}><div className={"xp-projection"} style={{
        flex: 1,
        minWidth: 160,
        margin: 0
      }}><div><div className={"xp-proj-label"}>{"Total Projected XP"}</div><div className={"xp-proj-detail"}>{wo.exercises.length}{" exercises"}</div></div><div className={"xp-proj-value"}>{"⚡ "}{xp.toLocaleString()}</div></div></div><div className={"sec"} style={{
      marginBottom: S.s8
    }}>{"Exercises"}</div>{wo.exercises.map((ex, i) => {
      const exD = allExById[ex.exId];
      if (!exD) return null;
      const isC = exD.category === "cardio";
      const isF = exD.category === "flexibility";
      const showW = !isC && !isF;
      const exMgColor = getMuscleColor(exD.muscleGroup);
      return <div key={i} className={"workout-detail-ex"} style={{
        "--mg-color": exMgColor
      }}><div className={"workout-detail-ex-orb"}><ExIcon ex={exD} size={".95rem"} color={"#d4cec4"} /></div><div style={{
          flex: 1,
          minWidth: 0
        }}><div className={"workout-detail-ex-name"}>{exD.name}{exD.custom && <span className={"custom-ex-badge"} style={{
              marginLeft: S.s6
            }}>{"custom"}</span>}</div>{ex.exId !== "rest_day" && <div className={"workout-detail-ex-meta"}>{ex.sets}{"×"}{ex.reps}{isC || isF ? " min" : ""}{showW && ex.weightLbs ? <span style={{
              color: "#8a8478",
              marginLeft: S.s6
            }}>{metric ? lbsToKg(ex.weightLbs) + " kg" : ex.weightLbs + " lbs"}</span> : ""}</div>}</div><div style={{
          display: "flex",
          alignItems: "center",
          gap: S.s8
        }}>{exD.custom && <button className={"btn btn-ghost btn-xs"} title={"Edit custom exercise"} onClick={() => openExEditor("edit", exD)}>{"✎"}</button>}<div className={"workout-detail-ex-xp"}>{"+"}{calcExXP(ex.exId, ex.sets || 3, ex.reps || 10, profile.chosenClass, allExById)}{" XP"}</div></div></div>;
    })}<div className={"div"} /><div style={{
      display: "flex",
      gap: S.s8,
      flexWrap: "wrap"
    }}><button className={"btn btn-glass-yellow"} style={{
        flex: 2,
        fontSize: FS.sm
      }} onClick={() => {
        openStatsPromptIfNeeded(wo, (woWithStats, _sr) => {
          setCompletionModal({
            workout: woWithStats,
            fromStats: _sr
          });
          setCompletionDate(todayStr());
          setCompletionAction("today");
        });
      }}>{"✓ Mark Complete or Schedule"}</button><button className={"btn btn-gold btn-sm"} style={{
        flex: 1
      }} onClick={() => setAddToPlanPicker({
        workout: wo
      })}>{"📋 Add to Plan"}</button><button className={"btn btn-danger btn-sm"} style={{
        flex: 0,
        paddingLeft: 10,
        paddingRight: 10
      }} onClick={() => deleteWorkout(wo.id)}>{"🗑"}</button></div></>;
}

// ── BUILDER ────────────────────────────
if (workoutView === "builder") return <><div className={"builder-nav-hdr"}><button className={"btn btn-ghost btn-sm"} onClick={() => {
      setWorkoutView("list");
      setWbCopySource(null);
      setWbIsOneOff(false);
      setWbEditId(null);
      setWbDuration("");
      setWbDurSec("");
      setWbActiveCal("");
      setWbTotalCal("");
      setWbLabels([]);
      setNewLabelInput("");
    }}>{"← Cancel"}</button><div style={{
      flex: 1,
      minWidth: 0
    }}><div className={"builder-nav-title"}>{wbIsOneOff ? wbEditId ? "✎ Edit One-Off" : "⚡ New One-Off Workout" : wbEditId ? "✎ Edit Workout" : wbCopySource ? "⎘ Copy Workout" : "⚔ New Workout"}</div>{wbCopySource && <div className={"builder-nav-sub"}>{"Forging from: "}{wbCopySource}</div>}</div></div>
  {
    /* Combined Identity + Labels + Session Stats panel */
  }<div className={"wb-section"}><div className={"field"}><label>{"Name "}<span className={"req-star"}>{"*"}</span></label><div className={"wb-identity-row"}><div className={"wb-icon-btn"} title={"Change icon"} onClick={() => setWbIconPickerOpen(v => !v)}>{wbIcon}<span className={"wb-icon-btn-caret"}>{"▾"}</span></div><input className={"inp"} value={wbName} onChange={e => setWbName(e.target.value)} placeholder={"e.g. Morning Push Day…"} /></div></div>{wbIconPickerOpen && <div className={"wb-icon-picker"}>{["💪","🏋️","🔥","⚔️","🏃","🚴","🧘","⚡","🎯","🛡️","🏆","🌟","💥","🗡️","🥊","🤸","🏊","🎽","🦵","🦾","🏅","🥇","⛹️","🤼","🧗","🤾","🎿","🏄","⛷️","🚣","🏹","🏇","🌿","🫀","🦴","💨","🌊","🏔️","🌄","🐉","🦅","🔱","☀️","🌙","🌪️","💫","🎖️","⚒️","🧱","🥋"].map(ic => <div key={ic} className={`icon-opt ${wbIcon === ic ? "sel" : ""}`} onClick={() => { setWbIcon(ic); setWbIconPickerOpen(false); }}>{ic}</div>)}</div>}<div className={"field"} style={{marginTop: S.s8}}><label>{"Description "}<span style={{color:"#8a8478",fontWeight:"normal",textTransform:"none"}}>{"(optional)"}</span></label><input className={"inp"} value={wbDesc} onChange={e => setWbDesc(e.target.value)} placeholder={"e.g. Upper body strength focus…"} /></div><div className={"wb-section-divider"} /><div className={"wb-sub-hdr"}><span className={"wb-sub-hdr-icon"}>{"❖"}</span>{"Labels"}<span style={{color:"#8a8478",fontWeight:"normal",letterSpacing:".05em",marginLeft:S.s6,textTransform:"none"}}>{"(optional)"}</span></div><div style={{display:"flex",gap:S.s6,flexWrap:"wrap",alignItems:"center"}}>{(profile.workoutLabels || []).map(l => <span key={l} className={"wo-label-chip" + (wbLabels.includes(l) ? " sel" : "")} onClick={() => setWbLabels(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l])}>{l}</span>)}<span style={{display:"inline-flex",alignItems:"center",gap:S.s4}}><input className={"wo-label-new-inp"} value={newLabelInput} onChange={e => setNewLabelInput(e.target.value)} onKeyDown={e => {
          if (e.key === "Enter" && newLabelInput.trim()) {
            const lbl = newLabelInput.trim();
            if (!(profile.workoutLabels || []).some(x => x.toLowerCase() === lbl.toLowerCase())) {
              setProfile(p => ({
                ...p,
                workoutLabels: [...(p.workoutLabels || []), lbl]
              }));
            }
            if (!wbLabels.includes(lbl)) setWbLabels(prev => [...prev, lbl]);
            setNewLabelInput("");
          }
        }} placeholder={"+ New label…"} style={{width: 100}} /><button className={"btn btn-ghost btn-xs"} style={{padding:"2px 6px",fontSize:FS.sm}} onClick={() => {
          const lbl = newLabelInput.trim();
          if (!lbl) return;
          if (!(profile.workoutLabels || []).some(x => x.toLowerCase() === lbl.toLowerCase())) {
            setProfile(p => ({
              ...p,
              workoutLabels: [...(p.workoutLabels || []), lbl]
            }));
          }
          if (!wbLabels.includes(lbl)) setWbLabels(prev => [...prev, lbl]);
          setNewLabelInput("");
        }}>{"+"}</button></span></div><div className={"wb-section-divider"} /><div className={"wb-sub-hdr"}><span className={"wb-sub-hdr-icon"}>{"⏱"}</span>{"Session Stats"}<span style={{color:"#8a8478",fontWeight:"normal",letterSpacing:".05em",marginLeft:S.s6,textTransform:"none"}}>{"(optional)"}</span></div><div className={"wb-stats-row"}><div className={"field"} style={{flex:2,marginBottom:S.s0}}><label>{"Duration"}</label><input className={"inp"} type={"text"} inputMode={"numeric"} value={wbDuration} onChange={e => setWbDuration(e.target.value)} onBlur={e => {
        const val = e.target.value.trim();
        if (!val) { setWbDuration(""); setWbDurSec(""); return; }
        const hms = val.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
        if (hms) {
          const h = Number(hms[1]), m = Number(hms[2]), s = Number(hms[3]);
          const ss = Math.min(s, 59);
          setWbDuration(`${String(h + Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}:${String(ss).padStart(2,"0")}`);
          setWbDurSec("");
        } else {
          setWbDuration(normalizeHHMM(val));
          setWbDurSec("");
        }
      }} placeholder={"HH:MM or HH:MM:SS"} style={{textAlign:"center"}} /><div className={"wb-dur-hint"}>{"90 = 1h30m · include :SS for seconds"}</div></div><div className={"field"} style={{flex:1.3,marginBottom:S.s0}}><label>{"Active Cal"}</label><input className={"inp"} type={"number"} min={"0"} max={"9999"} value={wbActiveCal} onChange={e => setWbActiveCal(e.target.value)} placeholder={"320"} /></div><div className={"field"} style={{flex:1.3,marginBottom:S.s0}}><label>{"Total Cal"}</label><input className={"inp"} type={"number"} min={"0"} max={"9999"} value={wbTotalCal} onChange={e => setWbTotalCal(e.target.value)} placeholder={"450"} /></div></div></div>
  {
    /* Exercise list */
  }<div className={"wo-section-hdr"} style={{
    marginTop: S.s18,
    marginBottom: S.s10
  }}><span className={"wo-section-hdr-text"}>{"⚔ Techniques"}</span></div><div style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: S.s8
  }}><label>{"("}{wbExercises.length}{" exercise"}{wbExercises.length !== 1 ? "s" : ""}{")"}{wbExercises.length > 0 && <span style={{
        marginLeft: S.s8,
        fontSize: FS.fs65,
        color: "#b4ac9e",
        fontFamily: "'Inter',sans-serif"
      }}>{"⚡ "}{formatXP(wbTotalXP)}{" total"}</span>}</label><div style={{
      display: "flex",
      gap: S.s6
    }}><button className={"btn btn-ghost btn-xs"} onClick={() => setWbExPickerOpen(true)}>{"＋ Add Exercise"}</button><button className={"btn btn-ghost btn-xs"} onClick={() => openExEditor("create", null)}>{"⚔ Forge Custom"}</button></div></div>{wbExercises.length === 0 && <div className={"empty"} style={{
    padding: "16px 0"
  }}>{"No techniques yet. Add from the arsenal or forge a custom one."}</div>}{(() => {
    const minSsChecked = ssChecked.size > 0 ? Math.min(...ssChecked) : -1;
    return wbExercises.map((ex, i) => {
      const exD = allExById[ex.exId];
      if (!exD) return null;
      const isC = exD.category === "cardio";
      const isF = exD.category === "flexibility";
      const showW = !isC && !isF;
      const showSsConnector = false; // replaced by group card
      // If this row is the SECOND in a pair (its anchor points back to i), skip — rendered by anchor
      const isSecondInPair = wbExercises.some((x, xi) => x.supersetWith != null && x.supersetWith === i && xi < i);
      if (isSecondInPair) return null;
      // If this row is the FIRST in a pair, we'll render a Group Card wrapper
      const partnerIdx = ex.supersetWith != null ? ex.supersetWith : null;
      const partnerEx = partnerIdx != null ? wbExercises[partnerIdx] : null;
      const partnerExD = partnerEx ? allExById[partnerEx.exId] || null : null;
      const showDist = isC;
      const showHR = isC;
      const isTreadmill = exD.hasTreadmill || false;
      const noSetsEx = NO_SETS_EX_IDS.has(exD.id);
      const isRunningEx = exD.id === RUNNING_EX_ID;
      const age = profile.age || 30;
      const dispW = ex.weightLbs ? metric ? lbsToKg(ex.weightLbs) : ex.weightLbs : "";
      const dispDist = ex.distanceMi ? metric ? String(parseFloat(miToKm(ex.distanceMi)).toFixed(2)) : String(ex.distanceMi) : "";
      const pbPaceMi = profile.runningPB || null;
      const pbDisp = pbPaceMi ? metric ? parseFloat((pbPaceMi * 1.60934).toFixed(2)) + " min/km" : parseFloat(pbPaceMi.toFixed(2)) + " min/mi" : null;
      const exPB = (profile.exercisePBs || {})[exD.id] || null;
      const exPBDisp = exPB ? exPB.type === "cardio" ? metric ? parseFloat((exPB.value * 1.60934).toFixed(2)) + " min/km" : parseFloat(exPB.value.toFixed(2)) + " min/mi" : exPB.type === "assisted" ? "🏆 1RM: " + exPB.value + (metric ? " kg" : " lbs") + " (Assisted)" : "🏆 1RM: " + exPB.value + (metric ? " kg" : " lbs") : null;
      const durationMin = parseFloat(ex.reps || 0);
      const distMiVal = ex.distanceMi ? parseFloat(ex.distanceMi) : 0;
      const runPace = isRunningEx && distMiVal > 0 && durationMin > 0 ? durationMin / distMiVal : null;
      const runBoostPct = runPace ? runPace <= 8 ? 20 : 5 : 0;
      const catColor = getTypeColor(exD.category);
      const mgColor = getMuscleColor(exD.muscleGroup);
      /* ── ACCORDION SUPERSET CARD — replaces both solo rows when paired ── */
      if (partnerIdx != null && partnerExD) {
        const totalXP = calcExXP(ex.exId, ex.sets || 3, ex.reps || 10, profile.chosenClass, allExById) + calcExXP(partnerEx.exId, partnerEx.sets || 3, partnerEx.reps || 10, profile.chosenClass, allExById);
        return <div key={i} className={"ss-accordion"}><div className={"ss-accordion-hdr"}><div style={{
              display: "flex",
              flexDirection: "column",
              gap: S.s2,
              flexShrink: 0
            }}><button className={"btn btn-ghost btn-xs"} style={{
                padding: "2px 6px",
                fontSize: FS.fs65,
                lineHeight: 1,
                minWidth: 0,
                opacity: Math.min(i, partnerIdx) === 0 ? .3 : 1
              }} onClick={e => {
                e.stopPropagation();
                reorderSupersetPair(i, partnerIdx, "up");
              }}>{"▲"}</button><button className={"btn btn-ghost btn-xs"} style={{
                padding: "2px 6px",
                fontSize: FS.fs65,
                lineHeight: 1,
                minWidth: 0,
                opacity: Math.max(i, partnerIdx) >= wbExercises.length - 1 ? .3 : 1
              }} onClick={e => {
                e.stopPropagation();
                reorderSupersetPair(i, partnerIdx, "down");
              }}>{"▼"}</button></div><span className={"ss-accordion-hdr-title"}>{"🔗 Superset"}</span><span className={"ss-accordion-xp"}>{formatXP(totalXP) + " total"}</span><button className={"ss-accordion-ungroup"} onClick={() => setWbExercises(exs => exs.map((x, xi) => xi === i ? {
              ...x,
              supersetWith: null
            } : xi === partnerIdx ? {
              ...x,
              supersetWith: null
            } : x))}>{"✕ Ungroup"}</button></div>{renderSsAccordionSection(ex, i, exD, "A", i + "_a")}{renderSsAccordionSection(partnerEx, partnerIdx, partnerExD, "B", i + "_b")}</div>;
      }
      return <>{i === minSsChecked && ssChecked.size > 0 && <div className={"ss-action-bar"}><span className={"ss-action-text"}>{ssChecked.size + " exercise" + (ssChecked.size !== 1 ? "s" : "") + " selected"}</span>{ssChecked.size === 2 && <button className={"ss-action-btn"} onClick={() => {
            const [a, b] = [...ssChecked];
            setWbExercises(exs => exs.map((x, xi) => xi === a ? {
              ...x,
              supersetWith: b
            } : xi === b ? {
              ...x,
              supersetWith: a
            } : x));
            setSsChecked(new Set());
          }}>{"🔗 Group as Superset"}</button>}<button className={"ss-action-cancel"} onClick={() => setSsChecked(new Set())}>{"✕"}</button></div>}<div className={`wb-ex-row ${dragWbExIdx === i ? "dragging" : ""}`} style={{
          opacity: dragWbExIdx === i ? 0.5 : 1,
          flexDirection: "column",
          alignItems: "stretch",
          gap: S.s0,
          "--cat-color": catColor,
          "--mg-color": mgColor
        }} draggable={true} onDragStart={e => {
          e.dataTransfer.effectAllowed = "move";
          setDragWbExIdx(i);
        }} onDragOver={e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }} onDrop={e => {
          e.preventDefault();
          reorderWbEx(dragWbExIdx, i);
          setDragWbExIdx(null);
        }} onDragEnd={() => setDragWbExIdx(null)}><WbExCard ex={ex} i={i} exD={exD} collapsed={!!collapsedWbEx[i]} profile={profile} allExById={allExById} metric={metric} wUnit={wUnit} setWbExercises={setWbExercises} setCollapsedWbEx={setCollapsedWbEx} setSsChecked={setSsChecked} ssChecked={ssChecked} exCount={wbExercises.length} openExEditor={openExEditor} /></div></>;
    });
  })()}<div className={"div"} />{wbIsOneOff ? wbEditId ?
  // Editing an existing scheduled one-off — save changes in place
  <button className={"btn btn-gold"} style={{
    width: "100%"
  }} onClick={() => {
    if (!wbName.trim()) {
      showToast("Name your workout first!");
      return;
    }
    if (wbExercises.length === 0) {
      showToast("Add at least one exercise.");
      return;
    }
    const updated = {
      id: wbEditId,
      name: wbName.trim(),
      icon: wbIcon,
      desc: wbDesc.trim(),
      exercises: wbExercises,
      createdAt: todayStr(),
      oneOff: true,
      labels: wbLabels
    };
    setProfile(p => ({
      ...p,
      // Update the saved workout object
      workouts: (p.workouts || []).find(w => w.id === wbEditId) ? (p.workouts || []).map(w => w.id === wbEditId ? updated : w) : [...(p.workouts || []), updated],
      // Sync the name/icon on all matching scheduledWorkouts
      scheduledWorkouts: (p.scheduledWorkouts || []).map(sw => sw.sourceWorkoutId === wbEditId ? {
        ...sw,
        sourceWorkoutName: updated.name,
        sourceWorkoutIcon: updated.icon
      } : sw)
    }));
    setWorkoutView("list");
    setWbEditId(null);
    setWbIsOneOff(false);
    showToast(`⚡ "${updated.name}" updated!`);
  }}>{"💾 Save Changes"}</button> :
  // New one-off — proceed through stats prompt then to log/schedule
  <button className={"btn btn-gold"} style={{
    width: "100%"
  }} onClick={() => {
    if (!wbName.trim()) {
      showToast("Name your workout first!");
      return;
    }
    if (wbExercises.length === 0) {
      showToast("Add at least one exercise.");
      return;
    }
    const dur = combineHHMMSec(wbDuration, wbDurSec) || null;
    const wo = {
      id: uid(),
      name: wbName.trim(),
      icon: wbIcon,
      desc: wbDesc.trim(),
      exercises: wbExercises,
      createdAt: todayStr(),
      oneOff: true,
      durationMin: dur || null,
      activeCal: wbActiveCal || null,
      totalCal: wbTotalCal || null,
      labels: wbLabels
    };
    openStatsPromptIfNeeded(wo, (woWithStats, _sr) => {
      setCompletionModal({
        workout: woWithStats,
        fromStats: _sr
      });
      setCompletionDate(todayStr());
      setCompletionAction("today");
    });
    setWorkoutView("list");
  }}>{"Next: Log or Schedule →"}</button> : wbEditId ? <div style={{
    display: "flex",
    gap: S.s8
  }}><button className={"btn btn-gold"} style={{
      flex: 1
    }} onClick={saveBuiltWorkout}>{"💾 Update Workout"}</button><button className={"btn btn-ghost"} style={{
      flex: 1
    }} onClick={saveAsNewWorkout}>{"📋 Save As New"}</button></div> : <div style={{
    display: "flex",
    gap: S.s8,
    width: "100%"
  }}><button className={"btn btn-gold"} style={{
      flex: 1
    }} onClick={saveBuiltWorkout}>{"💾 Save Workout"}</button><button className={"btn btn-gold"} style={{
      flex: 1,
      background: "linear-gradient(135deg,#8B7425,#A89030)"
    }} onClick={() => {
      if (!wbName.trim()) {
        showToast("Name your workout first!");
        return;
      }
      if (wbExercises.length === 0) {
        showToast("Add at least one exercise.");
        return;
      }
      const dur = combineHHMMSec(wbDuration, wbDurSec) || null;
      const wo = {
        id: uid(),
        name: wbName.trim(),
        icon: wbIcon,
        desc: wbDesc.trim(),
        exercises: wbExercises,
        createdAt: todayStr(),
        oneOff: true,
        durationMin: dur || null,
        activeCal: wbActiveCal || null,
        totalCal: wbTotalCal || null,
        labels: wbLabels
      };
      openStatsPromptIfNeeded(wo, (woWithStats, _sr) => {
        setCompletionModal({
          workout: woWithStats,
          fromStats: _sr
        });
        setCompletionDate(todayStr());
        setCompletionAction("today");
      });
      setWorkoutView("list");
    }}>{"✓ Complete / Schedule"}</button></div>}</>;
return null;
});

export default WorkoutsTab;
