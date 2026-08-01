import React, { memo } from 'react';
import { S, R, FS } from '../../utils/tokens';
import Sheet from '../../components/ui/Sheet';
import { MUSCLE_OPTS, muscleLabel } from './exerciseFilterOptions';
import { isMetric, lbsToKg, kgToLbs, miToKm, kmToMi, weightLabel, distLabel, pctToSlider, sliderToPct } from '../../utils/units';
import { getMuscleColor, hrRange } from '../../utils/xp';
import { HR_ZONES } from '../../data/constants';

/**
 * Exercise editor modal â€” extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Supports three modes: "create" | "edit" | "copy".
 * Uses createPortal to render into document.body.
 */

const EX_ICON_LIST = ["ðŸ‹ï¸", "ðŸ’ª", "âš¡", "ðŸ¦¾", "ðŸªƒ", "ðŸƒ", "ðŸš´", "ðŸ”¥", "â­•", "ðŸ§˜", "ðŸ¤¸", "ðŸ§±", "ðŸª", "ðŸŠ", "ðŸ”»", "ðŸ¦µ", "ðŸš¶", "ðŸ§—", "ðŸŽ¯", "ðŸŒï¸", "â›¹ï¸", "ðŸ¤¼", "ðŸ‡", "ðŸ¥Š", "ðŸ¤º", "ðŸ‹", "ðŸ¦¶", "ðŸ«€", "ðŸ§ ", "ðŸ›Œ", "ðŸ’¤", "ðŸŒ™", "â˜•", "ðŸ§Š", "ðŸ–ï¸"];

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
  const ed = exEditorDraft;
  const setEd = patch => setExEditorDraft(d => ({ ...d, ...patch }));
  const isCardioED = ed.category === "cardio";
  const isFlexED = ed.category === "flexibility";
  const hasWeightED = !isCardioED && !isFlexED;
  const metric = isMetric(profile.units);
  const wUnit = weightLabel(profile.units);
  const dUnit = distLabel(profile.units);
  const age = profile.age || 30;
  const title = exEditorMode === "edit" ? "âœŽ Edit Technique" : exEditorMode === "copy" ? "âŽ˜ Copy Technique" : "âš” Forge Technique";
  return <Sheet open onClose={() => setExEditorOpen(false)} layer={"editor"} title={title} titleFont={"cinzel"} ariaLabel={title} className={"ex-editor-sheet"} style={{
        "--mg-color": getMuscleColor(ed.muscleGroup || "chest")
      }}><div className={"ex-editor-body"}><div className={"ex-editor-subtitle"}>{exEditorMode === "edit" ? "Sharpen your custom technique" : "Forge a new technique for your grimoire"}</div>{exEditorMode !== "edit" && <div className={"field"}><label>{"Start from existing exercise (optional)"}</label><select className={"inp"} style={{
                appearance: "auto",
                cursor: "pointer"
              }} onChange={e => {
                if (!e.target.value) return;
                const base = allExById[e.target.value];
                if (base) setExEditorDraft(newExDraft(base));
              }} defaultValue={""}><option value={""}>{"â€” Start from scratch â€”"}</option>{["strength", "cardio", "flexibility", "endurance"].map(cat => <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>{allExercises.filter(ex => ex.category === cat).map(ex => <option key={ex.id} value={ex.id}>{ex.icon}{" "}{ex.name}</option>)}</optgroup>)}</select></div>

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
                }}>{ed.icon || "ðŸ’ª"}</div></div></div>

            {
              /* Icon grid */
            }<div role={"group"} aria-label={"Choose an icon"} style={{
              display: "flex",
              flexWrap: "wrap",
              gap: S.s4,
              marginBottom: S.s4
            }}>{EX_ICON_LIST.map(ic => <button type={"button"} key={ic} aria-label={`Icon ${ic}`} aria-pressed={ed.icon === ic} onClick={() => setEd({
                icon: ic
              })} style={{
                width: 44,
                height: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.15rem",
                cursor: "pointer",
                borderRadius: R.r7,
                border: `1px solid ${ed.icon === ic ? "rgba(180,172,158,.2)" : "rgba(74,69,59,.22)"}`,
                background: ed.icon === ic ? "rgba(74,69,59,.25)" : "rgba(74,69,59,.12)",
                transition: "all .15s",
                padding: 0
              }}>{ic}</button>)}</div>

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
              }}>{MUSCLE_OPTS.map(mg => <button key={mg} className={`btn btn-sm ${ed.muscleGroup === mg ? "btn-gold" : "btn-ghost"}`} style={{
                  fontSize: FS.fs54,
                  padding: "4px 8px"
                }} onClick={() => setEd({
                  muscleGroup: mg
                })}>{muscleLabel(mg)}</button>)}</div></div>

            {
              /* Base XP */
            }<div className={"field"}><label>{"Base XP per session "}<span style={{
                  fontSize: FS.sm,
                  color: "#9a9488",
                  fontStyle: "italic"
                }}>{"â€” typical: 20â€“80"}</span></label><input className={"inp"} type={"number"} min={"1"} max={"500"} value={ed.baseXP || 40} onChange={e => setEd({
                baseXP: parseInt(e.target.value) || 1
              })} /></div>

            {
              /* â”€â”€ Default Workout Values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
            }<div className={"ex-editor-section"}><div className={"ex-editor-section-title"}>{"Default Values When Logging"}</div><div style={{
                fontSize: FS.fs63,
                color: "#9a9488",
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
                /* Weight â€” strength/endurance only */
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
                    color: "#9a9488",
                    marginTop: S.s2
                  }}><span>{"50% Deload"}</span><span>{"100% Normal"}</span><span>{"200% Max"}</span></div></div></>

              /* Distance â€” cardio only */}{isCardioED && <div className={"field"}><label>{"Default Distance ("}{dUnit}{")"}</label><input className={"inp"} type={"number"} min={"0"} max={"200"} step={"0.1"} value={ed.defaultDistanceMi ? metric ? miToKm(ed.defaultDistanceMi) : ed.defaultDistanceMi : ""} onChange={e => {
                  const v = e.target.value;
                  const mi = v && metric ? kmToMi(v) : v;
                  setEd({
                    defaultDistanceMi: mi || ""
                  });
                }} placeholder={metric ? "5.0" : "3.1"} /></div>

              /* HR Zone â€” cardio only */}{isCardioED && <div className={"field"}><label>{"Default Heart Rate Zone "}{profile.age ? `(Age ${profile.age})` : ""}</label><div className={"hr-zone-row"}>{HR_ZONES.map(z => {
                    const range = hrRange(age, z);
                    const sel = (ed.defaultHrZone || null) === z.z;
                    return <button type={"button"} key={z.z} aria-pressed={sel} className={`hr-zone-btn ${sel ? "sel" : ""}`} style={{
                      "--zc": z.color,
                      borderColor: sel ? z.color : "rgba(74,69,59,.2)",
                      background: sel ? `${z.color}22` : "rgba(74,69,59,.12)"
                    }} onClick={() => setEd({
                      defaultHrZone: sel ? null : z.z
                    })}><span className={"hz-name"} style={{
                        color: sel ? z.color : "#9a9488"
                      }}>{"Z"}{z.z}{" "}{z.name}</span><span className={"hz-bpm"} style={{
                        color: sel ? z.color : "#9a9488"
                      }}>{range.lo}{"â€“"}{range.hi}</span></button>;
                  })}</div>{!profile.age && <div style={{
                  fontSize: FS.sm,
                  color: "#9a9488",
                  marginTop: S.s4
                }}>{"Set your age in Profile for accurate BPM ranges"}</div>}</div>}</div>

            {
              /* â”€â”€ Exercise Details (optional) â”€â”€â”€â”€â”€â”€â”€ */
            }<div className={"ex-editor-section-title"} style={{
              marginTop: S.s4
            }}>{"âœ¦ Exercise Details (optional)"}</div>

            {
              /* Muscles */
            }<div className={"field"}><label>{"Target Muscles"}</label><input className={"inp"} value={ed.muscles || ""} onChange={e => setEd({
                muscles: e.target.value
              })} placeholder={"e.g. Chest Â· Front Deltoids Â· Triceps"} /></div>

            {
              /* Description */
            }<div className={"field"}><label>{"Description"}</label><textarea className={"inp"} rows={3} value={ed.desc || ""} onChange={e => setEd({
                desc: e.target.value
              })} placeholder={"How to perform this exercise, key cuesâ€¦"} style={{
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
              }} placeholder={`Tip ${ti + 1}â€¦`} />)}</div>

            {
              /* â”€â”€ Action Buttons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
            }<div className={"div"} /><div style={{
              display: "flex",
              gap: S.s8
            }}><button className={"btn btn-ghost btn-sm"} style={{
                flex: 1
              }} onClick={() => setExEditorOpen(false)}>{"Cancel"}</button><button className={"btn btn-gold"} style={{
                flex: 2
              }} onClick={saveExEditor}>{exEditorMode === "edit" ? "âœ¦ Save Changes" : "âš” Forge Technique"}</button></div>{exEditorMode === "edit" && <button className={"btn btn-ghost btn-sm"} style={{
              width: "100%",
              marginTop: S.s6
            }} onClick={() => openExEditor("copy", ed)}>{"âŽ˜ Duplicate as New Exercise"}</button>}{exEditorMode === "edit" && <button className={"btn btn-danger"} style={{
              width: "100%",
              marginTop: S.s8,
              padding: "10px",
              fontSize: FS.fs78
            }} onClick={() => deleteCustomEx(ed.id)}>{"ðŸ—‘ Delete Exercise"}</button>}</div></Sheet>;
});

export default ExerciseEditorModal;
