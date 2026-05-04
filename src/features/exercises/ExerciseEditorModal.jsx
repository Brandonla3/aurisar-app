import React, { memo } from 'react';
import { createPortal } from 'react-dom';
import { S, R, FS } from '../../utils/tokens';
import { isMetric, lbsToKg, kgToLbs, miToKm, kmToMi, weightLabel, distLabel, pctToSlider, sliderToPct } from '../../utils/units';
import { getMuscleColor, hrRange } from '../../utils/xp';
import { HR_ZONES } from '../../data/constants';

/**
 * Exercise editor modal — extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Supports three modes: "create" | "edit" | "copy".
 * Uses createPortal to render into document.body.
 */

const EX_ICON_LIST = ["🏋️", "💪", "⚡", "🦾", "🪃", "🏃", "🚴", "🔥", "⭕", "🧘", "🤸", "🧱", "🪝", "🏊", "🔻", "🦵", "🚶", "🧗", "🎯", "🏌️", "⛹️", "🤼", "🏇", "🥊", "🤺", "🏋", "🦶", "🫀", "🧠", "🛌", "💤", "🌙", "☕", "🧊", "🏖️"];

const ExerciseEditorModal = memo(function ExerciseEditorModal({
  // Draft state
  exEditorDraft,
  setExEditorDraft,
  // Modal control
  setExEditorOpen,
  exEditorMode,
  // Exercise lists (for "Start from existing" picker)
  allExById,
  allExercises,
  // Profile (units + age only used)
  profile,
  // Action callbacks
  saveExEditor,
  openExEditor,
  deleteCustomEx,
  newExDraft,
}) {
  if (!exEditorDraft) return null;
  try {
    const ed = exEditorDraft;
    const setEd = patch => setExEditorDraft(d => ({ ...d, ...patch }));
    const isCardioED = ed.category === "cardio";
    const isFlexED = ed.category === "flexibility";
    const hasWeightED = !isCardioED && !isFlexED;
    const metric = isMetric(profile.units);
    const wUnit = weightLabel(profile.units);
    const dUnit = distLabel(profile.units);
    const age = profile.age || 30;
    return createPortal(<div className={"ex-editor-backdrop"} onClick={() => setExEditorOpen(false)}><div className={"ex-editor-sheet"} onClick={e => e.stopPropagation()} style={{
        "--mg-color": getMuscleColor(ed.muscleGroup || "chest")
      }}><div className={"ex-editor-hdr"}><div><div className={"ex-editor-title"}>{exEditorMode === "edit" ? "✎ Edit Technique" : exEditorMode === "copy" ? "⎘ Copy Technique" : "⚔ Forge Technique"}</div><div className={"ex-editor-subtitle"}>{exEditorMode === "edit" ? "Sharpen your custom technique" : "Forge a new technique for your grimoire"}</div></div><button className={"btn btn-ghost btn-sm"} onClick={() => setExEditorOpen(false)}>{"✕"}</button></div><div className={"ex-editor-body"}>{exEditorMode !== "edit" && <div className={"field"}><label>{"Start from existing exercise (optional)"}</label><select className={"inp"} style={{
                appearance: "auto",
                cursor: "pointer"
              }} onChange={e => {
                if (!e.target.value) return;
                const base = allExById[e.target.value];
                if (base) setExEditorDraft(newExDraft(base));
              }} defaultValue={""}><option value={""}>{"— Start from scratch —"}</option>{["strength", "cardio", "flexibility", "endurance"].map(cat => <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>{allExercises.filter(ex => ex.category === cat).map(ex => <option key={ex.id} value={ex.id}>{ex.icon}{" "}{ex.name}</option>)}</optgroup>)}</select></div>

            /* Name + Icon row */}<div style={{
              display: "flex",
              gap: S.s8
            }}><div className={"field"} style={{
                flex: 1
              }}><label>{"Exercise Name"}</label><input className={"inp"} value={ed.name || ""} onChange={e => setEd({
                  name: e.target.value
                })} placeholder={"e.g. Cable Fly"} /></div><div className={"field"} style={{
                width: 70
              }}><label>{"Icon"}</label><div className={"inp"} style={{
                  textAlign: "center",
                  fontSize: "1.4rem",
                  padding: "5px 0",
                  cursor: "default"
                }}>{ed.icon || "💪"}</div></div></div>

            {
              /* Icon grid */
            }<div style={{
              display: "flex",
              flexWrap: "wrap",
              gap: S.s6,
              marginBottom: S.s4
            }}>{EX_ICON_LIST.map(ic => <div key={ic} onClick={() => setEd({
                icon: ic
              })} style={{
                width: 34,
                height: 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.15rem",
                cursor: "pointer",
                borderRadius: R.r7,
                border: `1px solid ${ed.icon === ic ? "rgba(180,172,158,.2)" : "rgba(45,42,36,.22)"}`,
                background: ed.icon === ic ? "rgba(45,42,36,.25)" : "rgba(45,42,36,.12)",
                transition: "all .15s"
              }}>{ic}</div>)}</div>

            {
              /* Category */
            }<div className={"field"}><label>{"Category"}</label><div style={{
                display: "flex",
                gap: S.s6
              }}>{["strength", "cardio", "flexibility", "endurance"].map(cat => <button key={cat} className={`btn btn-sm ${ed.category === cat ? "btn-gold" : "btn-ghost"}`} style={{
                  flex: 1,
                  textTransform: "capitalize",
                  fontSize: FS.fs58,
                  padding: "6px 2px"
                }} onClick={() => setEd({
                  category: cat
                })}>{cat}</button>)}</div></div>

            {
              /* Muscle Group */
            }<div className={"field"}><label>{"Muscle Group"}</label><div style={{
                display: "flex",
                gap: S.s4,
                flexWrap: "wrap"
              }}>{["chest", "back", "shoulder", "bicep", "tricep", "forearm", "legs", "glutes", "calves", "abs"].map(mg => <button key={mg} className={`btn btn-sm ${ed.muscleGroup === mg ? "btn-gold" : "btn-ghost"}`} style={{
                  textTransform: "capitalize",
                  fontSize: FS.fs54,
                  padding: "4px 8px"
                }} onClick={() => setEd({
                  muscleGroup: mg
                })}>{mg}</button>)}</div></div>

            {
              /* Base XP */
            }<div className={"field"}><label>{"Base XP per session "}<span style={{
                  fontSize: FS.sm,
                  color: "#8a8478",
                  fontStyle: "italic"
                }}>{"— typical: 20–80"}</span></label><input className={"inp"} type={"number"} min={"1"} max={"500"} value={ed.baseXP || 40} onChange={e => setEd({
                baseXP: parseInt(e.target.value) || 1
              })} /></div>

            {
              /* ── Default Workout Values ───────────────── */
            }<div className={"ex-editor-section"}><div className={"ex-editor-section-title"}>{"Default Values When Logging"}</div><div style={{
                fontSize: FS.fs63,
                color: "#8a8478",
                marginTop: S.sNeg6,
                fontStyle: "italic"
              }}>{"Pre-filled each time you log this exercise"}</div>

              {
                /* Sets + Reps/Duration */
              }<div className={"r2"}><div className={"field"}><label>{"Default Sets"}</label><input className={"inp"} type={"number"} min={"0"} max={"20"} value={ed.defaultSets != null ? ed.defaultSets : ""} placeholder={"0"} onChange={e => {
                    const v = e.target.value;
                    setEd({
                      defaultSets: v === "" ? null : parseInt(v)
                    });
                  }} /></div><div className={"field"}><label>{"Default "}{isCardioED || isFlexED ? "Duration (min)" : "Reps"}</label><input className={"inp"} type={"number"} min={"0"} max={"300"} value={ed.defaultReps != null ? ed.defaultReps : ""} placeholder={"0"} onChange={e => {
                    const v = e.target.value;
                    setEd({
                      defaultReps: v === "" ? null : parseInt(v)
                    });
                  }} /></div></div>

              {
                /* Weight — strength/endurance only */
              }{hasWeightED && <><div className={"r2"}><div className={"field"}><label>{"Default Base Weight ("}{wUnit}{")"}</label><input className={"inp"} type={"number"} min={"0"} max={"2000"} step={metric ? "0.5" : "2.5"} value={ed.defaultWeightLbs ? metric ? lbsToKg(ed.defaultWeightLbs) : ed.defaultWeightLbs : ""} onChange={e => {
                      const v = e.target.value;
                      const lbs = v && metric ? kgToLbs(v) : v;
                      setEd({
                        defaultWeightLbs: lbs || ""
                      });
                    }} placeholder={metric ? "60" : "135"} /></div><div className={"field"}><label>{"Default Intensity %"}</label><input className={"inp"} type={"number"} min={"50"} max={"200"} step={"5"} value={ed.defaultWeightPct || 100} onChange={e => setEd({
                      defaultWeightPct: parseInt(e.target.value) || 100
                    })} /></div></div><div><input type={"range"} className={"pct-slider"} min={"0"} max={"100"} step={"5"} value={pctToSlider(ed.defaultWeightPct || 100)} onChange={e => setEd({
                    defaultWeightPct: sliderToPct(Number(e.target.value))
                  })} /><div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: FS.fs56,
                    color: "#8a8478",
                    marginTop: S.s2
                  }}><span>{"50% Deload"}</span><span>{"100% Normal"}</span><span>{"200% Max"}</span></div></div></>

              /* Distance — cardio only */}{isCardioED && <div className={"field"}><label>{"Default Distance ("}{dUnit}{")"}</label><input className={"inp"} type={"number"} min={"0"} max={"200"} step={"0.1"} value={ed.defaultDistanceMi ? metric ? miToKm(ed.defaultDistanceMi) : ed.defaultDistanceMi : ""} onChange={e => {
                  const v = e.target.value;
                  const mi = v && metric ? kmToMi(v) : v;
                  setEd({
                    defaultDistanceMi: mi || ""
                  });
                }} placeholder={metric ? "5.0" : "3.1"} /></div>

              /* HR Zone — cardio only */}{isCardioED && <div className={"field"}><label>{"Default Heart Rate Zone "}{profile.age ? `(Age ${profile.age})` : ""}</label><div className={"hr-zone-row"}>{HR_ZONES.map(z => {
                    const range = hrRange(age, z);
                    const sel = (ed.defaultHrZone || null) === z.z;
                    return <div key={z.z} className={`hr-zone-btn ${sel ? "sel" : ""}`} style={{
                      "--zc": z.color,
                      borderColor: sel ? z.color : "rgba(45,42,36,.2)",
                      background: sel ? `${z.color}22` : "rgba(45,42,36,.12)"
                    }} onClick={() => setEd({
                      defaultHrZone: sel ? null : z.z
                    })}><span className={"hz-name"} style={{
                        color: sel ? z.color : "#8a8478"
                      }}>{"Z"}{z.z}{" "}{z.name}</span><span className={"hz-bpm"} style={{
                        color: sel ? z.color : "#8a8478"
                      }}>{range.lo}{"–"}{range.hi}</span></div>;
                  })}</div>{!profile.age && <div style={{
                  fontSize: FS.sm,
                  color: "#8a8478",
                  marginTop: S.s4
                }}>{"Set your age in Profile for accurate BPM ranges"}</div>}</div>}</div>

            {
              /* ── Exercise Details (optional) ─────── */
            }<div className={"ex-editor-section-title"} style={{
              marginTop: S.s4
            }}>{"✦ Exercise Details (optional)"}</div>

            {
              /* Muscles */
            }<div className={"field"}><label>{"Target Muscles"}</label><input className={"inp"} value={ed.muscles || ""} onChange={e => setEd({
                muscles: e.target.value
              })} placeholder={"e.g. Chest · Front Deltoids · Triceps"} /></div>

            {
              /* Description */
            }<div className={"field"}><label>{"Description"}</label><textarea className={"inp"} rows={3} value={ed.desc || ""} onChange={e => setEd({
                desc: e.target.value
              })} placeholder={"How to perform this exercise, key cues…"} style={{
                resize: "vertical",
                minHeight: 70,
                fontFamily: "'Inter',sans-serif",
                lineHeight: 1.5
              }} /></div>

            {
              /* Tips */
            }<div className={"field"}><label>{"Form Tips (up to 3)"}</label>{[0, 1, 2].map(ti => <input key={ti} className={"inp"} style={{
                marginBottom: S.s6
              }} value={(ed.tips || ["", "", ""])[ti] || ""} onChange={e => {
                const t = [...(ed.tips || ["", "", ""])];
                t[ti] = e.target.value;
                setEd({
                  tips: t
                });
              }} placeholder={`Tip ${ti + 1}…`} />)}</div>

            {
              /* ── Action Buttons ─────────────────── */
            }<div className={"div"} /><div style={{
              display: "flex",
              gap: S.s8
            }}><button className={"btn btn-ghost btn-sm"} style={{
                flex: 1
              }} onClick={() => setExEditorOpen(false)}>{"Cancel"}</button><button className={"btn btn-gold"} style={{
                flex: 2
              }} onClick={saveExEditor}>{exEditorMode === "edit" ? "✦ Save Changes" : "⚔ Forge Technique"}</button></div>{exEditorMode === "edit" && <button className={"btn btn-ghost btn-sm"} style={{
              width: "100%",
              marginTop: S.s6
            }} onClick={() => openExEditor("copy", ed)}>{"⎘ Duplicate as New Exercise"}</button>}{exEditorMode === "edit" && <button className={"btn btn-danger"} style={{
              width: "100%",
              marginTop: S.s8,
              padding: "10px",
              fontSize: FS.fs78
            }} onClick={() => deleteCustomEx(ed.id)}>{"🗑 Delete Exercise"}</button>}</div></div></div>, document.body);
  } catch (e) {
    console.error("Exercise editor render error:", e);
    return null;
  }
});

export default ExerciseEditorModal;
