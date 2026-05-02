import React, { useState, useReducer, useMemo, useCallback, useTransition, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { List } from 'react-window';
import { useModalLifecycle } from '../utils/useModalLifecycle';
import { calcExXP, calcDayXP, getMuscleColor, getTypeColor, hrRange } from '../utils/xp';
import { isMetric, weightLabel, distLabel, lbsToKg, kgToLbs, miToKm, kmToMi } from '../utils/units';
import { normalizeHHMM, combineHHMMSec, secToHHMMSplit } from '../utils/time';
import { _optionalChain, uid, clone } from '../utils/helpers';
import { bDaysReducer, initBDays, A } from './planWizardReducer';
import { NO_SETS_EX_IDS, RUNNING_EX_ID, HR_ZONES, UI_COLORS } from '../data/constants';
import { FS, R, S } from '../utils/tokens';
import { CLASSES } from '../data/exercises';
import { ExIcon } from './ExIcon';

const ICONS = ["⚔️","🏹","🧘","🛡️","🔥","💪","🏋️","⚡","🏃","🚴","🌅","🌙","🏔️","🗡️","🧗","🎯"];

function formatScheduledDate(dateStr) {
  if(!dateStr) return "";
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});
  } catch(e) { return dateStr; }
}

function debounce(fn, ms) { let id; return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); }; }

// ── Virtualized picker row (item 4: react-window) ──────────────────────────
// Module-level so the component identity is stable across PlanWizard renders;
// react-window only re-renders rows when `rowProps` change.
const PICKER_ROW_NAME_STYLE  = { fontFamily: "'Cinzel',serif", fontSize: FS.fs80, fontWeight: 600, color: "#d4cec4", marginBottom: S.s2, letterSpacing: ".01em" };
const PICKER_ROW_META_STYLE  = { fontSize: FS.fs60, fontStyle: "italic" };
const PICKER_ROW_RIGHT_COL   = { flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: S.s4 };
const PICKER_ROW_XP_STYLE    = { fontFamily: "'Cinzel',serif", fontSize: FS.fs63, fontWeight: 700, color: "#d4cec4", letterSpacing: ".04em" };
const PICKER_ROW_NAME_INNER  = { flex: 1, minWidth: 0 };

const PickerRow = React.memo(function PickerRow({ ariaAttributes, index, style, exercises, selIds, onToggle }) {
  const ex = exercises[index];
  if (!ex) return null;
  const sel = selIds.has(ex.id);
  const diffLabel = ex.difficulty || (ex.baseXP >= 60 ? "Advanced" : ex.baseXP >= 45 ? "Intermediate" : "Beginner");
  const diffColor = diffLabel === "Advanced" ? "#7A2838" : diffLabel === "Beginner" ? "#5A8A58" : "#A8843C";
  const diffBg    = diffLabel === "Advanced" ? "#2e1515" : diffLabel === "Beginner" ? "#1a2e1a" : "#2e2010";
  const exMgColor = getMuscleColor(ex.muscleGroup);
  // The outer wrapper gets react-window's positioning style and the listitem
  // ARIA. The inner div is the visually-styled .picker-ex-row from CSS.
  // 4px top + 4px bottom padding bakes the inter-row gap into the slot
  // (the gap-based flex column was 6px gap; 8px here is close enough and
  // simpler than a wrapper margin).
  return (
    <div style={{...style, paddingTop:4, paddingBottom:4}} {...ariaAttributes}>
      <div className={"picker-ex-row" + (sel ? " sel" : "")} style={{"--mg-color":exMgColor}} onClick={() => onToggle(ex.id)}>
        <div className="picker-ex-orb"><ExIcon ex={ex} size=".95rem" color="#d4cec4" /></div>
        <div style={PICKER_ROW_NAME_INNER}>
          <div style={PICKER_ROW_NAME_STYLE}>
            {ex.name}{ex.custom && <span className="custom-ex-badge" style={{marginLeft:S.s4}}>custom</span>}
          </div>
          <div style={PICKER_ROW_META_STYLE}>
            {ex.category && <span style={{color:getTypeColor(ex.category)}}>{ex.category.charAt(0).toUpperCase()+ex.category.slice(1)}</span>}
            {ex.category && ex.muscleGroup && <span style={{color:"#8a8478"}}>{" · "}</span>}
            {ex.muscleGroup && <span style={{color:exMgColor}}>{ex.muscleGroup.charAt(0).toUpperCase()+ex.muscleGroup.slice(1)}</span>}
          </div>
        </div>
        <div style={PICKER_ROW_RIGHT_COL}>
          <span style={PICKER_ROW_XP_STYLE}>{ex.baseXP + " XP"}</span>
          <span style={{fontSize:FS.fs56, fontWeight:700, color:diffColor, background:diffBg, padding:"2px 6px", borderRadius:R.r3, letterSpacing:".04em"}}>{diffLabel}</span>
        </div>
      </div>
    </div>
  );
});

const PlanExCard = React.memo(function PlanExCard({ ex, i, exData, bDayIdx, xp, collapsed, profile, allExById, dispatch, setCollapsedPlanEx, ssCheckedPlan, setSsCheckedPlan, planExCount, onOpenExEditor }) {
  function updateField(field, val) { React.startTransition(()=>{ dispatch({ type: A.UPDATE_EX_FIELD, dayIdx: bDayIdx, exIdx: i, field, val }); }); }
  function updateFieldBatch(fields) { React.startTransition(()=>{ dispatch({ type: A.UPDATE_EX_FIELD_BATCH, dayIdx: bDayIdx, exIdx: i, fields }); }); }
  function updateFieldNow(field, val) { dispatch({ type: A.UPDATE_EX_FIELD, dayIdx: bDayIdx, exIdx: i, field, val }); }
  function removeEx() { React.startTransition(()=>{ dispatch({ type: A.REMOVE_EX, dayIdx: bDayIdx, exIdx: i }); }); }
  function toggleCollapse() { setCollapsedPlanEx(s=>({...s,[`${bDayIdx}_${i}`]:!s[`${bDayIdx}_${i}`]})); }
  function moveUp() { React.startTransition(()=>{ dispatch({ type: A.MOVE_EX, dayIdx: bDayIdx, fromIdx: i, toIdx: i - 1 }); }); }
  function moveDown() { React.startTransition(()=>{ dispatch({ type: A.MOVE_EX, dayIdx: bDayIdx, fromIdx: i, toIdx: i + 1 }); }); }

  // Stable id base for htmlFor/id pairing (jsx-a11y/label-has-associated-control)
  const cardId = useId();

  const isCardioEx = exData.category==="cardio";
  const isFlexEx   = exData.category==="flexibility";
  const hasWeight  = !isCardioEx && !isFlexEx;
  const hasDur     = isCardioEx || isFlexEx;
  const noSetsEx   = NO_SETS_EX_IDS.has(exData.id);
  const isRunningEx= exData.id===RUNNING_EX_ID;
  const bWUnit     = weightLabel(profile.units);
  const bMetric    = isMetric(profile.units);
  const dispW = ex.weightLbs != null && ex.weightLbs !== "" ? (bMetric ? lbsToKg(ex.weightLbs) : String(ex.weightLbs)) : "";
  const dispReps = ex.reps;
  const dispDist = ex.distanceMi ? (bMetric ? String(parseFloat(miToKm(ex.distanceMi)).toFixed(2)) : String(ex.distanceMi)) : "";
  const age = profile.age || 30;
  const pbPaceMi=profile.runningPB||null;
  const pbDisp=pbPaceMi?(bMetric?parseFloat((pbPaceMi*1.60934).toFixed(2))+" min/km":parseFloat(pbPaceMi.toFixed(2))+" min/mi"):null;
  const exPB3=(profile.exercisePBs||{})[exData.id]||null;
  const exPBDisp3=exPB3?(exPB3.type==="cardio"?(bMetric?parseFloat((exPB3.value*1.60934).toFixed(2))+" min/km":parseFloat(exPB3.value.toFixed(2))+" min/mi"):(exPB3.type==="assisted"?"1RM: "+exPB3.value+(bMetric?" kg":" lbs")+" (Assisted)":"1RM: "+exPB3.value+(bMetric?" kg":" lbs"))):null;
  const durationMin=parseFloat(ex.reps||0);
  const distMiVal=ex.distanceMi?parseFloat(ex.distanceMi):0;
  const runPace=(isRunningEx&&distMiVal>0&&durationMin>0)?durationMin/distMiVal:null;
  const runBoostPct=runPace?(runPace<=8?20:5):0;
  const catColorPlan=getTypeColor(exData.category);

  return (
    <div className="builder-ex-row" style={{flexDirection:"column",alignItems:"stretch",gap:S.s0,"--cat-color":catColorPlan}}>
      {/* Header row */}
      <div className="wb-ex-hdr" style={{display:"flex",alignItems:"center",gap:S.s4,marginBottom:collapsed?0:8,cursor:"pointer"}} onClick={toggleCollapse}>
        <div style={{display:"flex",flexDirection:"column",gap:S.s2,flexShrink:0}}>
          <button className="btn btn-ghost btn-xs" style={{padding:"2px 6px",fontSize:FS.fs65,lineHeight:1,minWidth:0,opacity:i===0?.3:1}} disabled={i===0} onClick={e=>{e.stopPropagation();moveUp();}}>{"▲"}</button>
          <button className="btn btn-ghost btn-xs" style={{padding:"2px 6px",fontSize:FS.fs65,lineHeight:1,minWidth:0,opacity:i===planExCount-1?.3:1}} disabled={i===planExCount-1} onClick={e=>{e.stopPropagation();moveDown();}}>{"▼"}</button>
        </div>
        {ex.supersetWith==null && planExCount>=2 && (
          <div
            style={{display:"flex",alignItems:"center",gap:S.s4,cursor:"pointer",flexShrink:0}}
            title="Select for superset"
            onClick={e=>{e.stopPropagation();setSsCheckedPlan(prev=>{const n=new Set(prev);if(n.has(i))n.delete(i);else{if(n.size>=2){const oldest=[...n][0];n.delete(oldest);}n.add(i);}return n;});}}
          >
            <div className={`ss-cb ${ssCheckedPlan.has(i)?"on":""}`} />
            <span style={{fontSize:FS.fs55,color:ssCheckedPlan.has(i)?"#b0b8c0":"#8a8f96",fontWeight:600,letterSpacing:".03em",userSelect:"none"}}>Superset</span>
          </div>
        )}
        {exData.custom && <div className="ex-edit-btn" style={{position:"static",marginRight:S.s2}} onClick={e=>{e.stopPropagation();onOpenExEditor("edit",exData);}}>{"✎"}</div>}
        <div className="builder-ex-orb" style={{"--cat-color":catColorPlan}}>{exData.icon}</div>
        <span className="builder-ex-name-styled" style={{flex:1}}>{exData.name}</span>
        {(isRunningEx&&pbDisp||exPBDisp3) && <span style={{fontSize:FS.fs58,color:"#b4ac9e",flexShrink:0}}>{"🏆 "}{isRunningEx&&pbDisp?pbDisp:exPBDisp3}</span>}
        {collapsed && exData.id!=="rest_day" && <span style={{fontSize:FS.fs60,color:"#8a8478"}}>{noSetsEx?"":ex.sets+"×"}{ex.reps}{ex.weightLbs?` · ${bMetric?lbsToKg(ex.weightLbs):ex.weightLbs}${bWUnit}`:""}</span>}
        <span style={{fontSize:FS.fs63,color:"#b4ac9e",minWidth:36,textAlign:"right"}}>{"+"+(xp||0).toLocaleString()}</span>
        <span style={{fontSize:FS.fs60,color:"#8a8478",transition:"transform .2s",transform:collapsed?"rotate(0deg)":"rotate(180deg)",flexShrink:0,lineHeight:1}}>{"▼"}</span>
        <button className="btn btn-danger btn-xs" style={{marginLeft:S.s2}} onClick={e=>{e.stopPropagation();removeEx();}}>{"✕"}</button>
      </div>
      {!collapsed && exData.id!=="rest_day" && (
        <>
          {/* Top row: Sets+Reps+Weight or Duration+Sec+Dist */}
          <div style={{display:"flex",gap:S.s6,marginBottom:S.s6}}>
            {!noSetsEx && !hasDur && (
              <div style={{flex:1,minWidth:0}}>
                <label htmlFor={`${cardId}-sets`} style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>Sets</label>
                <input id={`${cardId}-sets`} className="builder-ex-input" style={{width:"100%"}} type="text" inputMode="decimal"
                  defaultValue={ex.sets===0||ex.sets===""?"":ex.sets} onBlur={e=>updateField("sets",e.target.value)} />
              </div>
            )}
            {hasDur ? (
              <>
                <div style={{flex:1.6,minWidth:0}}>
                  <label htmlFor={`${cardId}-dur`} style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>Duration</label>
                  <input id={`${cardId}-dur`} className="builder-ex-input" style={{width:"100%"}} type="text" inputMode="numeric"
                    defaultValue={ex._durHHMM!==undefined ? ex._durHHMM : (ex.durationSec ? secToHHMMSplit(ex.durationSec).hhmm : ex.reps?"00:"+String(ex.reps).padStart(2,"0"):"")}
                    onBlur={e=>{
                      const norm=normalizeHHMM(e.target.value);
                      const sec=combineHHMMSec(norm,ex._durSec||"");
                      const batch={_durHHMM:norm||undefined,durationSec:sec};
                      if(sec) batch.reps=Math.max(1,Math.floor(sec/60));
                      if(sec) batch.durationMin=sec/60;
                      updateFieldBatch(batch);
                    }}
                    placeholder="00:00" />
                </div>
                <div style={{flex:0.8,minWidth:0}}>
                  <label htmlFor={`${cardId}-sec`} style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>Sec</label>
                  <input id={`${cardId}-sec`} className="builder-ex-input" style={{width:"100%",textAlign:"center"}} type="number" min="0" max="59"
                    defaultValue={ex._durSec!==undefined ? String(ex._durSec).padStart(2,"0") : (ex.durationSec ? String(secToHHMMSplit(ex.durationSec).sec).padStart(2,"0") : "")}
                    onBlur={e=>{
                      const v=e.target.value;
                      const sec=combineHHMMSec(ex._durHHMM||"",v);
                      const batch={_durSec:v,durationSec:sec};
                      if(sec) batch.reps=Math.max(1,Math.floor(sec/60));
                      updateFieldBatch(batch);
                    }}
                    placeholder="00" />
                </div>
                <div style={{flex:1.2,minWidth:0}}>
                  <label style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>Dist ({bMetric?"km":"mi"})</label>
                  <input className="builder-ex-input" style={{width:"100%"}} type="text" inputMode="decimal"
                    defaultValue={dispDist} placeholder="0"
                    onBlur={e=>{const v=e.target.value;const mi=v&&bMetric?kmToMi(v):v;updateField("distanceMi",mi||null);}} />
                </div>
              </>
            ) : (
              <>
                <div style={{flex:1,minWidth:0}}>
                  <label htmlFor={`${cardId}-reps`} style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>Reps</label>
                  <input id={`${cardId}-reps`} className="builder-ex-input" style={{width:"100%"}} type="text" inputMode="decimal"
                    defaultValue={dispReps===0||dispReps===""?"":dispReps} onBlur={e=>updateField("reps",e.target.value)} />
                </div>
                {hasWeight && (
                  <div style={{flex:1.2,minWidth:0}}>
                    <label style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>{bWUnit}</label>
                    <input className="builder-ex-input" style={{width:"100%"}} type="text" inputMode="decimal" step={bMetric?"0.5":"2.5"}
                      defaultValue={dispW} placeholder={"—"}
                      onBlur={e=>{const v=e.target.value;const lbs=v&&bMetric?kgToLbs(v):v;updateField("weightLbs",lbs||null);}} />
                  </div>
                )}
              </>
            )}
          </div>
          {isRunningEx && runBoostPct>0 && (
            <div style={{fontSize:FS.fs65,color:UI_COLORS.warning,marginBottom:S.s6}}>{"⚡ +"}{runBoostPct}{"% pace bonus"}{runBoostPct===20?" (sub-8 mi!)":""}</div>
          )}
          {/* Treadmill controls */}
          {hasDur && exData.hasTreadmill && (
            <div style={{marginBottom:S.s6}}>
              <div style={{display:"flex",gap:S.s8}}>
                <div style={{flex:1}}>
                  <label style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>Incline <span style={{opacity:.6,fontSize:FS.fs55}}>{"(0.5–15)"}</span></label>
                  <input className="builder-ex-input" style={{width:"100%"}} type="number" min="0.5" max="15" step="0.5" placeholder={"—"} defaultValue={ex.incline||""} onBlur={e=>updateField("incline",e.target.value?parseFloat(e.target.value):null)} />
                </div>
                <div style={{flex:1}}>
                  <label style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>Speed <span style={{opacity:.6,fontSize:FS.fs55}}>{"(0.5–15)"}</span></label>
                  <input className="builder-ex-input" style={{width:"100%"}} type="number" min="0.5" max="15" step="0.5" placeholder={"—"} defaultValue={ex.speed||""} onBlur={e=>updateField("speed",e.target.value?parseFloat(e.target.value):null)} />
                </div>
              </div>
            </div>
          )}
          {/* Extra interval/set rows */}
          {(ex.extraRows||[]).map((row,ri)=>(
            <div key={ri} style={{display:"flex",gap:S.s4,marginTop:S.s4,padding:"6px 8px",background:"rgba(45,42,36,.18)",borderRadius:R.r6,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:FS.fs58,color:"#9a8a78",flexShrink:0,minWidth:18}}>{hasDur?`I${ri+2}`:`S${ri+2}`}</span>
              {!hasDur && !noSetsEx && <input className="builder-ex-input" style={{flex:1,minWidth:40,fontSize:FS.fs70}} type="text" inputMode="decimal" placeholder="Sets" defaultValue={row.sets||""} onBlur={e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],sets:e.target.value};updateField("extraRows",rr);}} />}
              <input className="builder-ex-input" style={{flex:1.5,minWidth:52,fontSize:FS.fs70}} type="text" inputMode="numeric" placeholder="HH:MM"
                defaultValue={row.hhmm||""}
                onBlur={e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],hhmm:normalizeHHMM(e.target.value)};updateField("extraRows",rr);}} />
              <input className="builder-ex-input" style={{flex:0.8,minWidth:34,fontSize:FS.fs70}} type="number" min="0" max="59" placeholder="Sec" defaultValue={row.sec||""} onBlur={e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],sec:e.target.value};updateField("extraRows",rr);}} />
              {hasDur && <input className="builder-ex-input" style={{flex:1,minWidth:38,fontSize:FS.fs70}} type="text" inputMode="decimal" placeholder={bMetric?"km":"mi"} defaultValue={row.distanceMi||""} onBlur={e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],distanceMi:e.target.value};updateField("extraRows",rr);}} />}
              {hasDur && exData.hasTreadmill && <input className="builder-ex-input" style={{flex:0.8,minWidth:34,fontSize:FS.fs70}} type="number" min="0.5" max="15" step="0.5" placeholder="Inc" defaultValue={row.incline||""} onBlur={e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],incline:e.target.value};updateField("extraRows",rr);}} />}
              {hasDur && exData.hasTreadmill && <input className="builder-ex-input" style={{flex:0.8,minWidth:34,fontSize:FS.fs70}} type="number" min="0.5" max="15" step="0.5" placeholder="Spd" defaultValue={row.speed||""} onBlur={e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],speed:e.target.value};updateField("extraRows",rr);}} />}
              {hasWeight && <input className="builder-ex-input" style={{flex:1,minWidth:38,fontSize:FS.fs70}} type="text" inputMode="decimal" placeholder={bWUnit} defaultValue={row.weightLbs||""} onBlur={e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],weightLbs:e.target.value||null};updateField("extraRows",rr);}} />}
              <button className="btn btn-danger btn-xs" style={{padding:"2px 6px",flexShrink:0}} onClick={()=>{const rr=(ex.extraRows||[]).filter((_,j)=>j!==ri);updateFieldNow("extraRows",rr);}}>{"✕"}</button>
            </div>
          ))}
          <button className="btn btn-ghost btn-xs" style={{width:"100%",marginTop:S.s4,marginBottom:S.s8,fontSize:FS.fs60,color:"#8a8478",borderStyle:"dashed"}}
            onClick={()=>{const rr=[...(ex.extraRows||[]),hasDur?{hhmm:"",sec:"",distanceMi:"",incline:"",speed:""}:{sets:ex.sets||"",reps:ex.reps||"",weightLbs:ex.weightLbs||""}];updateFieldNow("extraRows",rr);}}>{"＋ Add Row (e.g. "}{hasDur?"interval":"progressive weight"}{")"}</button>
          {/* Avg HR Zone -- last for cardio */}
          {hasDur && (
            <div role="group" aria-labelledby={`${cardId}-hr`}>
              {/* Not a <label> — the HR zones below are a custom widget, not a single form control */}
              <div id={`${cardId}-hr`} style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>Avg Heart Rate Zone <span style={{opacity:.6,fontSize:FS.fs55}}>(optional)</span></div>
              <div className="hr-zone-row">
                {HR_ZONES.map(z=>{
                  const sel=ex.hrZone===z.z;
                  const range=hrRange(age,z);
                  return (
                    <div key={z.z} className={`hr-zone-btn ${sel?"sel":""}`}
                      style={{"--zc":z.color,borderColor:sel?z.color:"rgba(45,42,36,.2)",background:sel?`${z.color}22`:"rgba(45,42,36,.12)"}}
                      onClick={()=>updateField("hrZone",sel?null:z.z)}>
                      <span className="hz-name" style={{color:sel?z.color:"#8a8478"}}>{"Z"}{z.z}{" "}{z.name}</span>
                      <span className="hz-bpm" style={{color:sel?z.color:"#8a8478"}}>{range.lo}{"–"}{range.hi}</span>
                    </div>
                  );
                })}
              </div>
              {ex.hrZone && <div style={{fontSize:FS.fs65,color:"#8a8478",fontStyle:"italic",marginTop:S.s4}}>{HR_ZONES[ex.hrZone-1].desc}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
});

function PlanWizard(props) {
  const { editPlan, templatePlan, profile, allExercises, allExById, onSave, onClose, onCompleteDayStart, onStartPlanWorkout, onDeletePlan, onSchedulePlan, onOpenExEditor, showToast } = props;

  // Stable id base for htmlFor/id pairing (jsx-a11y/label-has-associated-control)
  const formId = useId();

  const [isPending, startTransition] = useTransition();

  // ── Plan metadata state ──
  const [bEditId, setBEditId] = useState(() => {
    if(editPlan) return editPlan.id;
    if(templatePlan && templatePlan.customize && templatePlan.custom) return templatePlan.id;
    return null;
  });
  const [bName, setBName] = useState(() => {
    if(editPlan) return editPlan.name;
    if(templatePlan) return (templatePlan.customize && !templatePlan.custom) ? `${templatePlan.name} (Custom)` : templatePlan.name;
    return "";
  });
  const [bLevel, setBLevel] = useState(() => {
    if(editPlan) return editPlan.level || "";
    if(templatePlan) return templatePlan.level || "";
    return "";
  });
  const [bType, setBType] = useState(() => {
    if(editPlan) return editPlan.type || "week";
    if(templatePlan) return templatePlan.type || "week";
    return "week";
  });
  const [bDurCount, setBDurCount] = useState(() => {
    if(editPlan) return editPlan.durCount || 1;
    if(templatePlan) return templatePlan.durCount || 1;
    return 1;
  });
  const [bStartDate, setBStartDate] = useState(() => {
    if(editPlan) return editPlan.startDate || "";
    if(templatePlan) return templatePlan.startDate || "";
    return "";
  });
  const [bEndDate, setBEndDate] = useState(() => {
    if(editPlan) return editPlan.endDate || "";
    if(templatePlan) return templatePlan.endDate || "";
    return "";
  });
  const [bIcon, setBIcon] = useState(() => {
    if(editPlan) return editPlan.icon || "⚔️";
    if(templatePlan) return templatePlan.icon || "⚔️";
    return "⚔️";
  });
  const [bDays, dispatch] = useReducer(bDaysReducer, { editPlan, templatePlan }, initBDays);
  const [bDayIdx, setBDayIdx] = useState(0);

  // ── Wizard/UI state ──
  const [wizardWeekIdx, setWizardWeekIdx] = useState(0);
  const [collapsedWeeks, setCollapsedWeeks] = useState({});
  const [planWizardOpen, setPlanWizardOpen] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [collapsedPlanEx, setCollapsedPlanEx] = useState({});
  const [ssAccordion, setSsAccordion] = useState({});
  const [ssCheckedPlan, setSsCheckedPlan] = useState(()=>new Set());

  // ── Picker state ──
  const [exPickerOpen, setExPickerOpen] = useState(false);
  const [bWoPickerOpen, setBWoPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const debouncedSetSearch = useRef(debounce(v => setPickerSearch(v), 200)).current;
  const pickerSearchRef = useRef(null);
  const [pickerMuscle, setPickerMuscle] = useState("All");
  const [pickerMuscleOpen, setPickerMuscleOpen] = useState(false);
  const [pickerTypeFilter, setPickerTypeFilter] = useState("all");
  const [pickerEquipFilter, setPickerEquipFilter] = useState("all");
  const [pickerOpenDrop, setPickerOpenDrop] = useState(null);
  const [pickerSelected, setPickerSelected] = useState([]);
  const [pickerConfigOpen, setPickerConfigOpen] = useState(false);

  // ── Body overflow effect ──
  useEffect(() => {
    if(planWizardOpen) { document.body.style.overflow = 'hidden'; }
    else { document.body.style.overflow = ''; }
    return () => { document.body.style.overflow = ''; };
  }, [planWizardOpen]);

  // ── Modal accessibility lifecycle (item 3 of post-Sprint-3 a11y plan) ──
  // Three nested modals in this component: the plan wizard itself, the
  // workout picker, and the exercise picker. Each gets inert / ESC / focus
  // restoration via useModalLifecycle. The exercise picker's close handler
  // delegates to the existing closePicker() function (which also resets
  // the search/filter/selection state on dismiss).
  useModalLifecycle(planWizardOpen, () => setPlanWizardOpen(false));
  useModalLifecycle(bWoPickerOpen, () => setBWoPickerOpen(false));
  useModalLifecycle(exPickerOpen, () => closePicker());

  // ── Class multiplier helper ──
  const clsKey = profile.chosenClass;
  const getMult = (ex) => clsKey ? (_optionalChain([CLASSES, 'access', _ => _[clsKey], 'optionalAccess', _2 => _2.bonuses, 'access', _3 => _3[ex.category]])||1) : 1;

  // ── useMemos ──
  const builderXP = useMemo(()=>bDays.reduce((t,d)=>t+d.exercises.reduce((s,ex)=>{
    const base=calcExXP(ex.exId,ex.sets,ex.reps,profile.chosenClass,allExById);
    const rowsXP=(ex.extraRows||[]).reduce((rs,row)=>rs+calcExXP(ex.exId,parseInt(row.sets)||parseInt(ex.sets)||3,parseInt(row.reps)||parseInt(ex.reps)||10,profile.chosenClass,allExById),0);
    return s+base+rowsXP;
  },0),0),[bDays,profile.chosenClass,allExById]);

  const wizardDayXPs = useMemo(()=>bDays.map(d=>calcDayXP(d,profile.chosenClass,allExById)),[bDays,profile.chosenClass,allExById]);

  const wizardExXPs = useMemo(()=>{
    const day = bDays[bDayIdx]; if(!day) return [];
    return day.exercises.map(ex=>{
      const noSets = NO_SETS_EX_IDS.has(ex.exId);
      const base = calcExXP(ex.exId,noSets?1:ex.sets,ex.reps,profile.chosenClass,allExById,ex.distanceMi||null);
      const rowsXP = (ex.extraRows||[]).reduce((s,row)=>s+calcExXP(ex.exId,parseInt(row.sets)||parseInt(ex.sets)||3,parseInt(row.reps)||parseInt(ex.reps)||10,profile.chosenClass,allExById),0);
      const _exD=allExById[ex.exId];const _isCardio=_exD&&_exD.category==="cardio";
      return (_isCardio&&(ex.extraRows||[]).length>0) ? Math.round((base+rowsXP)*1.25) : (base+rowsXP);
    });
  },[bDays,bDayIdx,profile.chosenClass,allExById]);

  const filteredExercises = useMemo(()=>{
    const q=pickerSearch.toLowerCase().trim();
    return allExercises.filter(e=>{
      if(pickerMuscle!=="All"&&e.muscleGroup!==pickerMuscle) return false;
      if(pickerTypeFilter!=="all"){const ty=(e.exerciseType||"").toLowerCase(),ca=(e.category||"").toLowerCase();if(!ty.includes(pickerTypeFilter)&&ca!==pickerTypeFilter) return false;}
      if(pickerEquipFilter!=="all"&&(e.equipment||"bodyweight").toLowerCase()!==pickerEquipFilter) return false;
      if(q&&!e.name.toLowerCase().includes(q)) return false;
      return true;
    });
  },[pickerSearch,pickerMuscle,pickerTypeFilter,pickerEquipFilter,allExercises]);

  // ── Functions ──
  function togglePlanEx(dayIdx,exIdx){ const k=`${dayIdx}_${exIdx}`; setCollapsedPlanEx(s=>({...s,[k]:!s[k]})); }
  function toggleWeek(wk){ setCollapsedWeeks(s=>({...s,[wk]:!s[wk]})); }

  function addDayToBuilder(){ startTransition(()=>{ dispatch({ type: A.ADD_DAY }); setBDayIdx(bDays.length); }); }
  function removeDayFromBuilder(idx){ startTransition(()=>{ dispatch({ type: A.REMOVE_DAY, dayIdx: idx }); setBDayIdx(Math.min(bDayIdx, bDays.length - 2)); }); }
  function reorderDay(fromIdx,toIdx){ if(fromIdx===toIdx) return; startTransition(()=>{ dispatch({ type: A.MOVE_DAY, fromIdx, toIdx }); setBDayIdx(toIdx); }); }

  function duplicateWeek(weekIdx){
    const start=weekIdx*7; const end=Math.min(start+7,bDays.length);
    const weekDays=bDays.slice(start,end);
    const base=bDays.length;
    const copies=weekDays.map((d,i)=>({...d,label:`Day ${base+i+1}`,exercises:d.exercises.map(e=>({...e}))}));
    startTransition(()=>{ dispatch({ type: A.ADD_DAYS, days: copies }); });
    showToast(`Week ${weekIdx+1} duplicated!`);
  }

  function reorderWeek(fromWeek,toWeek){
    if(fromWeek===toWeek) return;
    startTransition(()=>{ dispatch({ type: A.REORDER_WEEKS, fromWeek, toWeek }); setBDayIdx(toWeek*7); });
  }

  function reorderPlanEx(dayIdx,fromIdx,toIdx){ if(fromIdx===toIdx) return; startTransition(()=>{ dispatch({ type: A.MOVE_EX, dayIdx, fromIdx, toIdx }); }); }

  function addExToDay(exId){ const exd=allExById[exId]||{}; startTransition(()=>{ dispatch({ type: A.ADD_EXERCISES, dayIdx: bDayIdx, exercises: [{exId,sets:(exd.defaultSets!=null?exd.defaultSets:3),reps:(exd.defaultReps!=null?exd.defaultReps:10),weightLbs:exd.defaultWeightLbs||null,durationMin:exd.defaultDurationMin||null,distanceMi:exd.defaultDistanceMi||null,hrZone:exd.defaultHrZone||null,weightPct:exd.defaultWeightPct||100}] }); }); setExPickerOpen(false); }

  function removeExFromDay(di,ei){ startTransition(()=>{ dispatch({ type: A.REMOVE_EX, dayIdx: di, exIdx: ei }); }); }

  function updateExInDay(di,ei,field,val){ startTransition(()=>{ dispatch({ type: A.UPDATE_EX_FIELD, dayIdx: di, exIdx: ei, field, val }); }); }
  // Direct (non-deferred) version for add/delete row — gives instant visual feedback
  function updateExInDayNow(di,ei,field,val){ dispatch({ type: A.UPDATE_EX_FIELD, dayIdx: di, exIdx: ei, field, val }); }

  function updateExInDayBatch(di,ei,fields){ startTransition(()=>{ dispatch({ type: A.UPDATE_EX_FIELD_BATCH, dayIdx: di, exIdx: ei, fields }); }); }

  function updateDayLabel(idx,val){ startTransition(()=>{ dispatch({ type: A.UPDATE_DAY_LABEL, dayIdx: idx, val }); }); }

  function planGroupSuperset(dayIdx, idxA, idxB) {
    startTransition(()=>{ dispatch({ type: A.GROUP_SUPERSET, dayIdx, idxA, idxB }); });
    setSsCheckedPlan(new Set());
  }

  function planUngroupSuperset(dayIdx, idxA, idxB) {
    startTransition(()=>{ dispatch({ type: A.UNGROUP_SUPERSET, dayIdx, idxA, idxB }); });
  }

  function renderPlanSsSection(ex, dayIdx, exIdx, exData, label, sectionKey) {
    const collapsed = !!ssAccordion[sectionKey];
    const _noSets = NO_SETS_EX_IDS.has(exData.id);
    const _isC = exData.category==="cardio"; const _isF = exData.category==="flexibility";
    const _hasDur = _isC||_isF; const _hasW = !_isC&&!_isF;
    const _m = isMetric(profile.units); const _wU = weightLabel(profile.units); const _dU = distLabel(profile.units);
    const xpVal = wizardExXPs[exIdx]||0;
    const summaryText = (_noSets?"":ex.sets+"×") + ex.reps + (ex.weightLbs?` · ${_m?lbsToKg(ex.weightLbs):ex.weightLbs}${_wU}`:"");
    return (
      <div className="ss-section">
        <div className="ss-section-hdr" onClick={()=>setSsAccordion(p=>({...p,[sectionKey]:!p[sectionKey]}))}>
          <div className="ab-badge">{label}</div>
          <div style={{width:28,height:28,borderRadius:R.r6,flexShrink:0,background:"rgba(45,42,36,.15)",border:"1px solid rgba(180,172,158,.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:FS.fs80}}>{exData.icon}</div>
          <span style={{fontFamily:"'Cinzel',serif",fontSize:FS.fs66,color:"#d8caba",letterSpacing:".02em",flex:1,minWidth:0}}>{exData.name}</span>
          {collapsed && exData.id!=="rest_day" && <span style={{fontSize:FS.fs55,color:"#8a8478"}}>{summaryText}</span>}
          <span style={{fontSize:FS.fs60,fontWeight:700,color:"#b4ac9e",flexShrink:0}}>{"+"+xpVal}</span>
          <span style={{fontSize:FS.fs60,color:"#8a8478",transition:"transform .2s",transform:collapsed?"rotate(0deg)":"rotate(180deg)"}}>{"▼"}</span>
        </div>
        {!collapsed && exData.id!=="rest_day" && (
          <div className="ss-section-body">
            <div style={{display:"flex",gap:S.s6,marginBottom:S.s6}}>
              {!_noSets && !_hasDur && (
                <div style={{flex:1,minWidth:0}}>
                  <label htmlFor={`${sectionKey}-sets`} style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>Sets</label>
                  <input id={`${sectionKey}-sets`} className="builder-ex-input" style={{width:"100%"}} type="text" inputMode="decimal"
                    defaultValue={ex.sets===0||ex.sets===""?"":ex.sets} onBlur={e=>updateExInDay(dayIdx,exIdx,"sets",e.target.value)} />
                </div>
              )}
              {_hasDur ? (
                <>
                  <div style={{flex:1.6,minWidth:0}}>
                    <label htmlFor={`${sectionKey}-dur`} style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>Duration</label>
                    <input id={`${sectionKey}-dur`} className="builder-ex-input" style={{width:"100%"}} type="text" inputMode="numeric"
                      defaultValue={ex._durHHMM!==undefined?ex._durHHMM:(ex.durationSec?secToHHMMSplit(ex.durationSec).hhmm:ex.reps?"00:"+String(ex.reps).padStart(2,"0"):"")}
                      onBlur={e=>{const n=normalizeHHMM(e.target.value);const s=combineHHMMSec(n,ex._durSec||"");const batch={_durHHMM:n||undefined,durationSec:s};if(s){batch.reps=Math.max(1,Math.floor(s/60));batch.durationMin=s/60;}updateExInDayBatch(dayIdx,exIdx,batch);}}
                      placeholder="00:00" />
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <label htmlFor={`${sectionKey}-dist`} style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>Dist ({_dU})</label>
                    <input id={`${sectionKey}-dist`} className="builder-ex-input" style={{width:"100%"}} type="text" inputMode="decimal"
                      defaultValue={ex.distanceMi?(_m?String(parseFloat(miToKm(ex.distanceMi)).toFixed(2)):String(ex.distanceMi)):""}
                      onBlur={e=>{const v=e.target.value;const mi=v&&_m?kmToMi(v):v;updateExInDay(dayIdx,exIdx,"distanceMi",mi||null);}}
                      placeholder="0" />
                  </div>
                </>
              ) : (
                <>
                  <div style={{flex:1,minWidth:0}}>
                    <label htmlFor={`${sectionKey}-reps`} style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>Reps</label>
                    <input id={`${sectionKey}-reps`} className="builder-ex-input" style={{width:"100%"}} type="text" inputMode="decimal"
                      defaultValue={ex.reps===0||ex.reps===""?"":ex.reps} onBlur={e=>updateExInDay(dayIdx,exIdx,"reps",e.target.value)} />
                  </div>
                  {_hasW && (
                    <div style={{flex:1.2,minWidth:0}}>
                      <label htmlFor={`${sectionKey}-weight`} style={{fontSize:FS.fs60,color:"#b0a898",marginBottom:S.s4,display:"block"}}>Weight ({_wU})</label>
                      <input id={`${sectionKey}-weight`} className="builder-ex-input" style={{width:"100%"}} type="text" inputMode="decimal"
                        defaultValue={ex.weightLbs!=null&&ex.weightLbs!==""?(_m?lbsToKg(ex.weightLbs):String(ex.weightLbs)):""}
                        onBlur={e=>{const v=e.target.value;const lbs=v&&_m?kgToLbs(v):v;updateExInDay(dayIdx,exIdx,"weightLbs",lbs||null);}}
                        placeholder={"—"} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  function saveBuiltPlan(){
    if(!bName.trim()){showToast("Give your plan a name!");return;}
    const durLabel = bDurCount===1 ? bType : `${bDurCount} ${bType}s`;
    const planData = {
      id: bEditId || uid(),
      name: bName,
      level: bLevel || null,
      icon: bIcon,
      type: bType,
      durCount: bDurCount,
      startDate: bStartDate || null,
      endDate: bEndDate || null,
      scheduledDate: bStartDate || null,
      description: `Custom ${durLabel} plan`,
      bestFor: [],
      days: clone(bDays),
      custom: true,
      isEdit: !!bEditId,
    };
    if (!bEditId) {
      planData.createdAt = new Date().toLocaleDateString();
    }
    onSave(planData);
  }

  function closePicker() {
    setExPickerOpen(false);
    setPickerSearch(""); if(pickerSearchRef.current) pickerSearchRef.current.value=""; setPickerMuscle("All"); setPickerMuscleOpen(false); setPickerTypeFilter("all"); setPickerEquipFilter("all"); setPickerOpenDrop(null);
    setPickerSelected([]); setPickerConfigOpen(false);
  }

  const pickerToggleEx = useCallback((exId) => {
    setPickerSelected(prev => {
      const exists = prev.find(e=>e.exId===exId);
      if(exists) return prev.filter(e=>e.exId!==exId);
      return [...prev, {exId, sets:"3", reps:"10", weightLbs:"", weightPct:100, durationMin:"", distanceMi:"", hrZone:null}];
    });
  }, []);

  // Stable selection set + rowProps so memoized PickerRow only re-renders when
  // the user toggles selection or the filter changes.
  const pickerSelIds = useMemo(() => new Set(pickerSelected.map(e=>e.exId)), [pickerSelected]);
  const pickerRowProps = useMemo(
    () => ({ exercises: filteredExercises, selIds: pickerSelIds, onToggle: pickerToggleEx }),
    [filteredExercises, pickerSelIds, pickerToggleEx]
  );

  // PlanExCard reads only these four fields from `profile`. Memoizing a slim
  // object keeps the memo'd card stable across unrelated profile updates
  // (gold, name, avatar, plans, etc.).
  const planExCardProfile = useMemo(
    () => ({
      units: profile.units,
      age: profile.age,
      runningPB: profile.runningPB,
      exercisePBs: profile.exercisePBs,
    }),
    [profile.units, profile.age, profile.runningPB, profile.exercisePBs]
  );

  function pickerUpdateEx(exId, field, val) {
    setPickerSelected(prev=>prev.map(e=>e.exId===exId?{...e,[field]:val}:e));
  }

  function commitPickerToPlan() {
    if(pickerSelected.length===0) return;
    const exercises = pickerSelected.map(e=>({exId:e.exId,sets:e.sets||"",reps:e.reps||"",weightLbs:e.weightLbs||null,durationMin:e.durationMin||null,distanceMi:e.distanceMi||null,hrZone:e.hrZone||null,weightPct:e.weightPct||100}));
    startTransition(()=>{ dispatch({ type: A.ADD_EXERCISES, dayIdx: bDayIdx, exercises }); });
    closePicker();
  }

  // ══════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════
  return (
    <>
      {/* ── 1. BUILDER OVERVIEW FORM ── */}
      {!planWizardOpen && (
        <div className="builder-nav-hdr">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{"← Back"}</button>
          <div className="builder-nav-title">{bEditId ? "✎ Overview" : "📜 New Plan"}</div>
        </div>
      )}
      {!planWizardOpen && (
        <div className="builder-wrap">
          <div className="field"><label htmlFor={`${formId}-name`}>Plan Name</label><input id={`${formId}-name`} className="inp" value={bName} onChange={e=>setBName(e.target.value)} placeholder={"Name your plan…"} /></div>
          <div className="field">
            <label htmlFor={`${formId}-level-0`}>Level <span style={{fontSize:FS.fs55,opacity:.6}}>(optional)</span></label>
            <div style={{display:"flex",gap:S.s6}}>
              {["Beginner","Intermediate","Expert"].map((lvl,lvlIdx)=>(
                <button key={lvl} id={lvlIdx===0?`${formId}-level-0`:undefined} className="btn btn-ghost btn-xs"
                  style={{flex:1,fontSize:FS.fs62,
                    border:bLevel===lvl?`1px solid ${lvl==="Beginner"?"#5A8A58":lvl==="Intermediate"?"#A8843C":"#7A2838"}`:"",
                    color:bLevel===lvl?(lvl==="Beginner"?"#5A8A58":lvl==="Intermediate"?"#A8843C":"#7A2838"):"",
                    background:bLevel===lvl?"rgba(45,42,36,.15)":""}}
                  onClick={()=>setBLevel(bLevel===lvl?"":lvl)}>
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          {/* Duration Type + Count */}
          <div className="field">
            <label htmlFor={`${formId}-dur-count`}>Duration</label>
            <div className="dur-row">
              <select id={`${formId}-dur-count`} className="dur-count-sel" value={bDurCount}
                onChange={e=>{
                  const newCount=parseInt(e.target.value);
                  setBDurCount(newCount);
                  const totalDays=bType==="day"?newCount:bType==="week"?newCount*7:bType==="month"?newCount*28:newCount*52*7;
                  if(totalDays>7&&totalDays>bDays.length){
                    const extra=Array.from({length:totalDays-bDays.length},(_,i)=>({label:`Day ${bDays.length+i+1}`,exercises:[]}));
                    startTransition(()=>{ dispatch({ type: A.ADD_DAYS, days: extra }); });
                  }
                  if(bStartDate){
                    const d=new Date(bStartDate+"T12:00:00");
                    if(bType==="day") d.setDate(d.getDate()+newCount-1);
                    else if(bType==="week") d.setDate(d.getDate()+newCount*7-1);
                    else if(bType==="month") d.setMonth(d.getMonth()+newCount);
                    else d.setFullYear(d.getFullYear()+newCount);
                    setBEndDate(d.toISOString().slice(0,10));
                  }
                }}>
                {(()=>{
                  const max = bType==="day"?31:bType==="week"?52:bType==="month"?12:3;
                  return Array.from({length:max},(_,i)=>i+1).map(n=>(
                    <option key={n} value={n}>{n}</option>
                  ));
                })()}
              </select>
              <select className="dur-type-sel" value={bType}
                onChange={e=>{
                  const t=e.target.value;
                  setBType(t);
                  const max=t==="day"?31:t==="week"?52:t==="month"?12:3;
                  const newCount=Math.min(bDurCount,max);
                  setBDurCount(newCount);
                  const totalDays=t==="day"?newCount:t==="week"?newCount*7:t==="month"?newCount*28:newCount*52*7;
                  if(totalDays>7&&totalDays>bDays.length){
                    const extra=Array.from({length:totalDays-bDays.length},(_,i)=>({label:`Day ${bDays.length+i+1}`,exercises:[]}));
                    startTransition(()=>{ dispatch({ type: A.ADD_DAYS, days: extra }); });
                  }
                  if(bStartDate){
                    const d=new Date(bStartDate+"T12:00:00");
                    if(t==="day") d.setDate(d.getDate()+newCount-1);
                    else if(t==="week") d.setDate(d.getDate()+newCount*7-1);
                    else if(t==="month") d.setMonth(d.getMonth()+newCount);
                    else d.setFullYear(d.getFullYear()+newCount);
                    setBEndDate(d.toISOString().slice(0,10));
                  }
                }}>
                <option value="day">Day{bDurCount>1?"s":""}</option>
                <option value="week">Week{bDurCount>1?"s":""}</option>
                <option value="month">Month{bDurCount>1?"s":""}</option>
                <option value="year">Year{bDurCount>1?"s":""}</option>
              </select>
            </div>
            <div style={{fontSize:FS.fs62,color:"#8a8478",marginTop:S.s4,fontStyle:"italic"}}>
              {bDurCount===1?"Single "+bType+" plan":`${bDurCount}-${bType} program`}
            </div>
          </div>

          {/* Start / End Dates */}
          <div className="plan-date-row">
            <div className="field">
              <label htmlFor={`${formId}-start-date`}>Start Date <span style={{fontSize:FS.fs55,opacity:.6}}>(optional)</span></label>
              <input id={`${formId}-start-date`} className="inp" type="date" value={bStartDate}
                onChange={e=>{
                  setBStartDate(e.target.value);
                  if(e.target.value && !bEndDate) {
                    const d = new Date(e.target.value+"T12:00:00");
                    if(bType==="day")   d.setDate(d.getDate()+bDurCount-1);
                    else if(bType==="week")  d.setDate(d.getDate()+bDurCount*7-1);
                    else if(bType==="month") d.setMonth(d.getMonth()+bDurCount);
                    else                d.setFullYear(d.getFullYear()+bDurCount);
                    setBEndDate(d.toISOString().slice(0,10));
                  }
                  if(bEndDate && e.target.value && bEndDate < e.target.value) setBEndDate("");
                }} />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-end-date`}>End Date <span style={{fontSize:FS.fs55,opacity:.6}}>(optional)</span></label>
              <input id={`${formId}-end-date`} className="inp" type="date" value={bEndDate}
                min={(()=>{
                  if(!bStartDate) return undefined;
                  const d = new Date(bStartDate+"T12:00:00");
                  if(bType==="day")   d.setDate(d.getDate()+bDurCount-1);
                  else if(bType==="week")  d.setDate(d.getDate()+bDurCount*7-1);
                  else if(bType==="month") d.setMonth(d.getMonth()+bDurCount);
                  else                d.setFullYear(d.getFullYear()+bDurCount);
                  return d.toISOString().slice(0,10);
                })()}
                onChange={e=>{
                  if(!bStartDate){ setBEndDate(e.target.value); return; }
                  const d = new Date(bStartDate+"T12:00:00");
                  if(bType==="day")   d.setDate(d.getDate()+bDurCount-1);
                  else if(bType==="week")  d.setDate(d.getDate()+bDurCount*7-1);
                  else if(bType==="month") d.setMonth(d.getMonth()+bDurCount);
                  else                d.setFullYear(d.getFullYear()+bDurCount);
                  const minEnd = d.toISOString().slice(0,10);
                  if(e.target.value < minEnd){
                    setBEndDate(minEnd);
                  } else {
                    setBEndDate(e.target.value);
                  }
                }} />
            </div>
          </div>
          {bStartDate && bEndDate && (
            <div style={{fontSize:FS.fs65,color:"#b4ac9e",marginTop:S.sNeg8,marginBottom:S.s4,fontStyle:"italic"}}>{"📅 "}{(()=>{
              const s=new Date(bStartDate+"T12:00:00");
              const e=new Date(bEndDate+"T12:00:00");
              const days=Math.round((e-s)/(1000*60*60*24))+1;
              return s.toLocaleDateString([],{month:"short",day:"numeric"})+" → "+e.toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"})+" ("+days+" day"+(days!==1?"s":"")+")"
            })()}</div>
          )}
          <div className="field" role="group" aria-labelledby={`${formId}-icon`}>
            {/* Not a <label> — the icon options below are a custom radio group of
                 non-input elements, so a labelable association isn't possible.
                 Keeping the same visual style via the .field-label class. */}
            <span id={`${formId}-icon`} className="field-label">Icon</span>
            <div className="icon-row">{ICONS.map(ic=><div key={ic} className={`icon-opt ${bIcon===ic?"sel":""}`} onClick={()=>setBIcon(ic)}>{ic}</div>)}</div>
          </div>
          <div className="xp-projection">
            <div><div className="xp-proj-label">Projected Total XP</div><div className="xp-proj-detail">{bDays.filter(d=>d.exercises.length>0).length}{" active days · "}{bDays.reduce((t,d)=>t+d.exercises.length,0)}{" exercises"}</div></div>
            <div className="xp-proj-value">{"⚡ "}{builderXP.toLocaleString()}</div>
          </div>
          <button className="btn btn-gold btn-plan-action"
            onClick={()=>{setPlanWizardOpen(true);setWizardWeekIdx(0);}}>
            {bEditId ? "✎ Edit Plan" : "⚔ Create Plan"}
          </button>
          <div style={{fontSize:FS.fs58,color:"#8a8478",textAlign:"center",marginTop:S.s6,fontStyle:"italic"}}>
            {bEditId ? "Open the plan wizard to edit days and exercises" : "Open the plan wizard to add days and exercises"}
          </div>
          {/* Action buttons -- only for existing plans in user's collection */}
          {bEditId && (()=>{
            const plan = (profile.plans||[]).find(p=>p.id===bEditId);
            if(!plan) return null;
            return (
              <>
                <div className="div" style={{margin:"8px 0"}} />
                <div style={{display:"flex",gap:S.s8}}>
                  <button className={`plan-sched-btn ${plan.scheduledDate?"plan-sched-active":""}`}
                    style={{flex:1,padding:"8px 12px",textAlign:"center"}}
                    onClick={()=>onSchedulePlan(plan)}>
                    {plan.scheduledDate?"📅 "+formatScheduledDate(plan.scheduledDate):"📅 Schedule"}
                  </button>
                  {plan.custom && <button className="btn btn-danger btn-sm" style={{flex:1}} onClick={()=>{onDeletePlan(plan.id);onClose();}}>{"🗑 Delete"}</button>}
                </div>
                {plan.custom && <button className="btn btn-glass" style={{width:"100%",marginTop:S.s8}} onClick={()=>onStartPlanWorkout(plan)}>{"📋 Mark Plan Complete"}</button>}
              </>
            );
          })()}
        </div>
      )}

      {/* ── 2. PLAN WIZARD FULL-SCREEN OVERLAY ── */}
      {planWizardOpen && createPortal(
        <div className="plan-wizard-backdrop" onClick={e=>e.stopPropagation()}>
          <div className="plan-wizard-inner">
            {/* Wizard Header */}
            <div className="plan-wizard-hdr">
              <button className="btn btn-ghost btn-sm" onClick={()=>setPlanWizardOpen(false)}>{"← Back"}</button>
              <div className="plan-wizard-hdr-title">
                <span className="plan-wizard-hdr-icon">{bIcon}</span>
                {" "}{bName||"Untitled Plan"}
              </div>
              <button className="btn btn-gold btn-sm" onClick={()=>{saveBuiltPlan();setPlanWizardOpen(false);}}>{"💾 Save"}</button>
            </div>

            {/* Week tabs (only for multi-week plans) */}
            {bDays.length > 7 && (()=>{
              const weekCount = Math.ceil(bDays.length / 7);
              return (
                <div className="wizard-week-tabs">
                  {Array.from({length:weekCount},(_,wk)=>{
                    const weekDays = bDays.slice(wk*7, wk*7+7);
                    const weekXP = weekDays.reduce((t,d,di)=>t+(wizardDayXPs[wk*7+di]||0),0);
                    const activeDays = weekDays.filter(d=>d.exercises.length>0).length;
                    return (
                      <div key={wk}
                        className={`wizard-week-tab ${wizardWeekIdx===wk?"on":""}`}
                        onClick={()=>{setWizardWeekIdx(wk);setBDayIdx(wk*7);}}>
                        <span>{"Week "}{wk+1}</span>
                        <span className="wk-days">{activeDays}{"/"}{weekDays.length}{" active"}</span>
                        <span className="wk-xp">{"⚡"}{weekXP.toLocaleString()}</span>
                      </div>
                    );
                  })}
                  <div className="wizard-week-tab" style={{color:"#b4ac9e",borderStyle:"dashed",borderColor:"rgba(180,172,158,.12)"}}
                    onClick={()=>{
                      const newDays = Array.from({length:7},(_,i)=>({label:`Day ${bDays.length+i+1}`,exercises:[]}));
                      startTransition(()=>{ dispatch({ type: A.ADD_DAYS, days: newDays }); });
                      setWizardWeekIdx(Math.ceil((bDays.length+7)/7)-1);
                    }}>{"＋ Week"}</div>
                </div>
              );
            })()}

            {/* Day tabs for the current week (or all days if single-week) */}
            {(()=>{
              const multiWeek = bDays.length > 7;
              const weekStart = multiWeek ? wizardWeekIdx * 7 : 0;
              const weekDays = multiWeek ? bDays.slice(weekStart, weekStart+7) : bDays;
              return (
                <div className="wizard-day-tabs">
                  {weekDays.map((d,wi)=>{
                    const globalIdx = weekStart + wi;
                    const dayXP = wizardDayXPs[globalIdx]||0;
                    const hasExercises = d.exercises.length > 0;
                    return (
                      <div key={globalIdx}
                        className={`wizard-day-tab ${bDayIdx===globalIdx?"on":""}`}
                        onClick={()=>setBDayIdx(globalIdx)}>
                        {reorderMode && weekDays.length>1 && (
                          <span style={{display:"flex",flexDirection:"column",gap:S.s0,flexShrink:0}}>
                            <button className="btn btn-ghost btn-xs" style={{padding:"2px 4px",fontSize:FS.fs50,lineHeight:1,minWidth:0,opacity:wi===0?.3:1}} disabled={wi===0} onClick={e=>{e.stopPropagation();reorderDay(globalIdx,globalIdx-1);}}>{"◀"}</button>
                            <button className="btn btn-ghost btn-xs" style={{padding:"2px 4px",fontSize:FS.fs50,lineHeight:1,minWidth:0,opacity:wi===weekDays.length-1?.3:1}} disabled={wi===weekDays.length-1} onClick={e=>{e.stopPropagation();reorderDay(globalIdx,globalIdx+1);}}>{"▶"}</button>
                          </span>
                        )}
                        <span>{d.label||`Day ${globalIdx+1}`}</span>
                        {hasExercises
                          ? <span className="day-xp-mini">{"⚡"}{dayXP}</span>
                          : <span className="day-rest-badge">REST</span>}
                      </div>
                    );
                  })}
                  <div className="wizard-day-tab" style={{color:"#b4ac9e",borderStyle:"dashed",borderColor:"rgba(180,172,158,.12)",minWidth:52}}
                    onClick={addDayToBuilder}>{"＋"}</div>
                  {weekDays.length>1 && <div className={`wizard-day-tab ${reorderMode?"on":""}`} style={{minWidth:52,fontSize:FS.fs52,cursor:"pointer",borderColor:reorderMode?"rgba(180,172,158,.15)":"rgba(180,172,158,.06)"}}
                    onClick={()=>setReorderMode(r=>!r)}>{reorderMode?"✓ Done":"⇄ Reorder"}</div>}
                </div>
              );
            })()}

            {/* Multi-week: duplicate week + week XP info */}
            {bDays.length > 7 && (
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:S.s8}}>
                <span style={{fontSize:FS.fs62,color:"#8a8478"}}>
                  {"Week "}{wizardWeekIdx+1}{" · "}
                  {(()=>{const wDays=bDays.slice(wizardWeekIdx*7,wizardWeekIdx*7+7);return wDays.filter(d=>d.exercises.length>0).length;})()}{" active days"}
                </span>
                <button className="btn btn-ghost btn-xs" style={{fontSize:FS.fs58}}
                  onClick={()=>duplicateWeek(wizardWeekIdx)}>{"⎘ Duplicate Week"}</button>
              </div>
            )}

            {/* Selected day editor */}
            <div className="wizard-day-editor">
              <div className="wizard-day-hdr">
                <input key={"dlbl_"+bDayIdx} className="inp" defaultValue={_optionalChain([bDays, 'access', _4 => _4[bDayIdx], 'optionalAccess', _5 => _5.label])||""} onBlur={e=>updateDayLabel(bDayIdx,e.target.value)} placeholder={"Day label…"} style={{flex:1,padding:"8px 12px",fontSize:FS.fs82}} />
                <span style={{fontSize:FS.fs72,color:"#b4ac9e",fontFamily:"'Inter',sans-serif",whiteSpace:"nowrap"}}>{"⚡ "}{wizardDayXPs[bDayIdx]||0}</span>
                {bDays.length>1 && <button className="btn btn-danger btn-xs" style={{marginLeft:S.s6,padding:"4px 8px",fontSize:FS.fs60}} onClick={()=>removeDayFromBuilder(bDayIdx)}>{"🗑 Delete Day"}</button>}
              </div>
              {/* Optional day-level stats */}
              <div key={"dstats_"+bDayIdx} className="wizard-day-stats">
                <input className="inp" type="text" inputMode="numeric" placeholder="Duration HH:MM"
                  style={{flex:1.5,fontSize:FS.fs68,padding:"6px 10px"}}
                  defaultValue={_optionalChain([bDays, 'access', _6 => _6[bDayIdx], 'optionalAccess', _7 => _7._durHHMM])!==undefined ? bDays[bDayIdx]._durHHMM : (_optionalChain([bDays, 'access', _8 => _8[bDayIdx], 'optionalAccess', _9 => _9.durationSec]) ? secToHHMMSplit(bDays[bDayIdx].durationSec).hhmm : "")}
                  onBlur={e=>{const norm=normalizeHHMM(e.target.value);const sec=combineHHMMSec(norm,_optionalChain([bDays, 'access', _10 => _10[bDayIdx], 'optionalAccess', _11 => _11._durSec])||"");startTransition(()=>{ dispatch({ type: A.UPDATE_DAY_FIELD, dayIdx: bDayIdx, fields: {durationSec:sec,_durHHMM:sec?norm:undefined,durationMin:sec?sec/60:null} }); });}} />
                <input className="inp" type="number" min="0" max="59" placeholder="Sec (0-59)"
                  style={{flex:0.8,fontSize:FS.fs68,padding:"6px 10px"}}
                  defaultValue={_optionalChain([bDays, 'access', _12 => _12[bDayIdx], 'optionalAccess', _13 => _13._durSec])||""}
                  onBlur={e=>{const sec=combineHHMMSec(_optionalChain([bDays, 'access', _14 => _14[bDayIdx], 'optionalAccess', _15 => _15._durHHMM])||"",e.target.value);startTransition(()=>{ dispatch({ type: A.UPDATE_DAY_FIELD, dayIdx: bDayIdx, fields: {durationSec:sec,_durSec:undefined,durationMin:sec?sec/60:null} }); });}} />
                <input className="inp" type="number" min="0" max="9999" placeholder="Active Cal"
                  style={{flex:1,fontSize:FS.fs68,padding:"6px 10px"}}
                  defaultValue={_optionalChain([bDays, 'access', _16 => _16[bDayIdx], 'optionalAccess', _17 => _17.activeCal])||""}
                  onBlur={e=>startTransition(()=>{ dispatch({ type: A.UPDATE_DAY_FIELD, dayIdx: bDayIdx, fields: {activeCal:e.target.value||null} }); })} />
                <input className="inp" type="number" min="0" max="9999" placeholder="Total Cal"
                  style={{flex:1,fontSize:FS.fs68,padding:"6px 10px"}}
                  defaultValue={_optionalChain([bDays, 'access', _18 => _18[bDayIdx], 'optionalAccess', _19 => _19.totalCal])||""}
                  onBlur={e=>startTransition(()=>{ dispatch({ type: A.UPDATE_DAY_FIELD, dayIdx: bDayIdx, fields: {totalCal:e.target.value||null} }); })} />
              </div>
              <div style={{display:"flex",gap:S.s6,marginBottom:S.s8}}>
                <button className="btn btn-ghost btn-sm" style={{flex:1}} onClick={()=>setExPickerOpen(true)}>{"＋ Add Exercise"}</button>
                <button className="btn btn-ghost btn-sm" style={{flex:1}} onClick={()=>setBWoPickerOpen(true)}>{"💪 Add Workout"}</button>
              </div>
              {(()=>{const minSsCheckedPlan = ssCheckedPlan.size>0 ? Math.min(...ssCheckedPlan) : -1; return (_optionalChain([bDays, 'access', _20 => _20[bDayIdx], 'optionalAccess', _21 => _21.exercises])||[]).map((ex,i)=>{
                const exData=allExById[ex.exId]; if(!exData) return null;
                /* Plan superset: skip second in pair */
                const planExs = (_optionalChain([bDays, 'access', _20b => _20b[bDayIdx], 'optionalAccess', _21b => _21b.exercises])||[]);
                const isPlanSecond = planExs.some((x,xi) => x.supersetWith != null && x.supersetWith === i && xi < i);
                if (isPlanSecond) return null;
                const planPartnerIdx = ex.supersetWith != null ? ex.supersetWith : null;
                const planPartnerEx = planPartnerIdx != null ? planExs[planPartnerIdx] : null;
                const planPartnerExD = planPartnerEx ? (allExById[planPartnerEx.exId]||null) : null;
                /* Render accordion card for superset pairs */
                if (planPartnerIdx != null && planPartnerExD) {
                  const xpA = wizardExXPs[i]||0;
                  const xpB = wizardExXPs[planPartnerIdx]||0;
                  return (
                    <div key={i} className="ss-accordion">
                      <div className="ss-accordion-hdr">
                        <div style={{display:"flex",flexDirection:"column",gap:S.s2,flexShrink:0}}>
                          <button className="btn btn-ghost btn-xs" style={{padding:"2px 6px",fontSize:FS.fs65,lineHeight:1,minWidth:0,opacity:Math.min(i,planPartnerIdx)===0?.3:1}}
                            onClick={e=>{e.stopPropagation();
                              const minI=Math.min(i,planPartnerIdx);
                              if(minI<=0) return;
                              startTransition(()=>{ dispatch({ type: A.MOVE_SUPERSET_UP, dayIdx: bDayIdx, minI }); });
                            }}>{"▲"}</button>
                          <button className="btn btn-ghost btn-xs" style={{padding:"2px 6px",fontSize:FS.fs65,lineHeight:1,minWidth:0,opacity:Math.max(i,planPartnerIdx)>=((_optionalChain([bDays, 'access', _22 => _22[bDayIdx], 'optionalAccess', _23 => _23.exercises, 'access', _24 => _24.length])||1)-1)?.3:1}}
                            onClick={e=>{e.stopPropagation();
                              const maxI=Math.max(i,planPartnerIdx); const minI=Math.min(i,planPartnerIdx);
                              const len=(_optionalChain([bDays, 'access', _25 => _25[bDayIdx], 'optionalAccess', _26 => _26.exercises, 'access', _27 => _27.length])||0);
                              if(maxI>=len-1) return;
                              startTransition(()=>{ dispatch({ type: A.MOVE_SUPERSET_DOWN, dayIdx: bDayIdx, minI, maxI }); });
                            }}>{"▼"}</button>
                        </div>
                        <span className="ss-accordion-hdr-title">{"🔗 Superset"}</span>
                        <span className="ss-accordion-xp">{(xpA+xpB)+" XP total"}</span>
                        <button className="ss-accordion-ungroup"
                          onClick={()=>planUngroupSuperset(bDayIdx,i,planPartnerIdx)}>{"✕ Ungroup"}</button>
                      </div>
                      {renderPlanSsSection(ex, bDayIdx, i, exData, "A", "plan_"+bDayIdx+"_"+i+"_a")}
                      {renderPlanSsSection(planPartnerEx, bDayIdx, planPartnerIdx, planPartnerExD, "B", "plan_"+bDayIdx+"_"+i+"_b")}
                    </div>
                  );
                }
                return (
                  <React.Fragment key={bDayIdx+'_'+i+'_'+ex.exId}>
                    {i===minSsCheckedPlan && ssCheckedPlan.size>0 && (
                      <div className="ss-action-bar" style={{marginBottom:S.s8}}>
                        <span className="ss-action-text">{ssCheckedPlan.size+" selected"}</span>
                        {ssCheckedPlan.size===2 && <button className="ss-action-btn" onClick={()=>{
                          const [a,b]=[...ssCheckedPlan]; planGroupSuperset(bDayIdx,a,b);
                        }}>{"🔗 Group as Superset"}</button>}
                        <button className="ss-action-cancel" onClick={()=>setSsCheckedPlan(new Set())}>{"✕"}</button>
                      </div>
                    )}
                    <PlanExCard
                      ex={ex} i={i} exData={exData} bDayIdx={bDayIdx}
                      xp={wizardExXPs[i]||0}
                      collapsed={!!collapsedPlanEx[bDayIdx+'_'+i]}
                      profile={planExCardProfile} allExById={allExById}
                      dispatch={dispatch} setCollapsedPlanEx={setCollapsedPlanEx}
                      ssCheckedPlan={ssCheckedPlan} setSsCheckedPlan={setSsCheckedPlan}
                      planExCount={planExs.filter(e=>!e.supersetWith).length}
                      onOpenExEditor={onOpenExEditor}
                    />
                  </React.Fragment>
                );
              });})()}
              {bEditId && <button className="btn btn-glass-yellow" style={{width:"100%",marginTop:S.s8}}
                onClick={()=>{
                  const plan=(profile.plans||[]).find(p=>p.id===bEditId); if(!plan) return;
                  const currentDay=bDays[bDayIdx]; if(!currentDay) return;
                  const synth={name:currentDay.label||"Day",icon:bIcon||"📋",exercises:currentDay.exercises,
                    durationMin:currentDay.durationMin||null,activeCal:currentDay.activeCal||null,totalCal:currentDay.totalCal||null};
                  if(onCompleteDayStart) {
                    onCompleteDayStart(synth, (woWithStats) => {
                      onStartPlanWorkout({...plan,days:[{...currentDay,durationMin:woWithStats.durationMin,activeCal:woWithStats.activeCal,totalCal:woWithStats.totalCal}]});
                    });
                  }
                }}>{"✓ Complete Day"}</button>}
              <div className="div" style={{margin:"3px 0"}} />
              <button className="btn btn-gold" style={{width:"100%"}} onClick={saveBuiltPlan}>{"💾 Save Plan"}</button>
            </div>{/* close wizard-day-editor */}
          </div>{/* close plan-wizard-inner */}
        </div>,
        document.body
      )}

      {/* ── 3. WORKOUT PICKER PORTAL ── */}
      {bWoPickerOpen && createPortal(
        <div className="ex-picker-backdrop" onClick={e=>{e.stopPropagation();setBWoPickerOpen(false);}}>
          <div className="ex-picker-sheet" onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:S.s10}}>
              <div className="sec" style={{margin:0,border:"none",padding:S.s0}}>Add Workout to Day</div>
              <button className="btn btn-ghost btn-sm" onClick={()=>setBWoPickerOpen(false)}>{"✕"}</button>
            </div>
            {profile.workouts && profile.workouts.length>0 ? profile.workouts.map(wo=>(
              <div key={wo.id} className="ex-pick-item" style={{marginBottom:S.s6,flexDirection:"column",alignItems:"flex-start",gap:S.s4}}
                onClick={()=>{
                  const newExs = wo.exercises.map(e=>({
                    exId:e.exId, sets:e.sets||3, reps:e.reps||10,
                    weightLbs:e.weightLbs||null, durationMin:e.durationMin||null,
                    distanceMi:null, hrZone:null, weightPct:100,
                  }));
                  startTransition(()=>{ dispatch({ type: A.ADD_EXERCISES, dayIdx: bDayIdx, exercises: newExs }); });
                  setBWoPickerOpen(false);
                  showToast(wo.icon+" "+wo.name+" exercises added!");
                }}>
                <div style={{display:"flex",alignItems:"center",gap:S.s8,width:"100%"}}>
                  <span style={{fontSize:"1.3rem"}}>{wo.icon}</span>
                  <div style={{flex:1}}>
                    <div className="ex-pick-name">{wo.name}</div>
                    <div className="ex-pick-xp">{wo.exercises.length}{" exercise"}{wo.exercises.length!==1?"s":""}</div>
                  </div>
                </div>
              </div>
            )) : (
              <div className="empty" style={{padding:"20px 0"}}>{"No saved workouts yet. Build one in the 💪 Work tab first."}</div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* ── 4. EXERCISE PICKER PORTAL ── */}
      {exPickerOpen && createPortal(
        <div className="ex-picker-backdrop" onClick={e=>{e.stopPropagation();if(!pickerConfigOpen)closePicker();}}>
          <div className="ex-picker-sheet" onClick={e=>e.stopPropagation()} style={{maxHeight:"85vh"}}>
            {!pickerConfigOpen ? (
              <>
                {/* -- BROWSE VIEW -- */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:S.s10}}>
                  <div style={{fontFamily:"'Inter',sans-serif",fontSize:FS.fs72,fontWeight:600,color:"#8a8478"}}>
                    {"Add to Plan"}{pickerSelected.length>0 && <span style={{color:"#b4ac9e",marginLeft:S.s6}}>{pickerSelected.length+" selected"}</span>}
                  </div>
                  <div style={{display:"flex",gap:S.s6}}>
                    {pickerSelected.length>0 && <button className="btn btn-gold btn-xs" onClick={()=>setPickerConfigOpen(true)}>{"Configure & Add →"}</button>}
                    <button className="btn btn-ghost btn-xs" onClick={()=>{closePicker();if(onOpenExEditor)onOpenExEditor("create",null);}}>{"✦ New Custom"}</button>
                    <button className="btn btn-ghost btn-sm" onClick={closePicker}>{"✕"}</button>
                  </div>
                </div>
                <div style={{marginBottom:S.s8}}>
                  <input className="inp" style={{width:"100%",padding:"8px 12px",fontSize:FS.fs82}}
                    placeholder={"Search exercises…"} ref={pickerSearchRef}
                    onChange={e=>debouncedSetSearch(e.target.value)} autoFocus={true} />
                </div>
                {(()=>{
                  const PTYPE_LABELS2={strength:"⚔️ Strength",cardio:"🏃 Cardio",flexibility:"🧘 Flex",yoga:"🧘 Yoga",stretching:"🌿 Stretch",plyometric:"⚡ Plyo",calisthenics:"🤸 Cali"};
                  const PTYPE_OPTS2=Object.keys(PTYPE_LABELS2);
                  const PEQUIP_OPTS2=["barbell","dumbbell","kettlebell","cable","machine","bodyweight","band"];
                  const PMUSCLE_OPTS2=["chest","back","shoulder","bicep","legs","glutes","abs","calves","forearm","cardio"];
                  const closeDrops2=()=>setPickerOpenDrop(null);
                  return (
                    <div style={{position:"relative",marginBottom:S.s10}}>
                      {pickerOpenDrop && <div onClick={closeDrops2} style={{position:"fixed",inset:0,zIndex:19}} />}
                      <div style={{display:"flex",gap:S.s8}}>
                        <div style={{position:"relative",flex:1,zIndex:20}}>
                          <button onClick={()=>setPickerOpenDrop(d=>d==="muscle2"?null:"muscle2")} style={{width:"100%",padding:"6px 24px 6px 8px",borderRadius:R.r8,border:"1px solid "+(pickerMuscle!=="All"?"#b4ac9e":"rgba(45,42,36,.3)"),background:"rgba(14,14,12,.95)",color:pickerMuscle!=="All"?"#b4ac9e":"#8a8478",fontSize:FS.fs68,textAlign:"left",cursor:"pointer",position:"relative"}}>
                            {pickerMuscle==="All"?"Muscle":pickerMuscle.charAt(0).toUpperCase()+pickerMuscle.slice(1)}
                            <span style={{position:"absolute",right:7,top:"50%",transform:"translateY(-50%) rotate("+(pickerOpenDrop==="muscle2"?"180deg":"0deg")+")",fontSize:FS.fs55,color:pickerMuscle!=="All"?"#b4ac9e":"#8a8478",transition:"transform .15s"}}>{"▼"}</span>
                          </button>
                          {pickerOpenDrop==="muscle2" && (
                            <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:"100%",background:"rgba(16,14,10,.95)",border:"1px solid rgba(180,172,158,.06)",borderRadius:R.r8,padding:"6px 4px",zIndex:21,boxShadow:"0 8px 24px rgba(0,0,0,.7)"}}>
                              <div onClick={()=>{setPickerMuscle("All");closeDrops2();}} style={{padding:"6px 10px",fontSize:FS.fs72,cursor:"pointer",borderRadius:R.r5,color:pickerMuscle==="All"?"#b4ac9e":"#8a8478",background:pickerMuscle==="All"?"rgba(45,42,36,.2)":"transparent"}}>All Muscles</div>
                              {PMUSCLE_OPTS2.map(m=>(
                                <div key={m} onClick={()=>{setPickerMuscle(m);closeDrops2();}} style={{padding:"6px 10px",fontSize:FS.fs72,cursor:"pointer",borderRadius:R.r5,color:pickerMuscle===m?getMuscleColor(m):"#8a8478",background:pickerMuscle===m?"rgba(45,42,36,.2)":"transparent",textTransform:"capitalize"}}>{m}</div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{position:"relative",flex:1,zIndex:20}}>
                          <button onClick={()=>setPickerOpenDrop(d=>d==="type2"?null:"type2")} style={{width:"100%",padding:"6px 24px 6px 8px",borderRadius:R.r8,border:"1px solid "+(pickerTypeFilter!=="all"?"#d4cec4":"rgba(45,42,36,.3)"),background:"rgba(14,14,12,.95)",color:pickerTypeFilter!=="all"?"#d4cec4":"#8a8478",fontSize:FS.fs68,textAlign:"left",cursor:"pointer",position:"relative"}}>
                            {pickerTypeFilter==="all"?"Type":(PTYPE_LABELS2[pickerTypeFilter]||pickerTypeFilter)}
                            <span style={{position:"absolute",right:7,top:"50%",transform:"translateY(-50%) rotate("+(pickerOpenDrop==="type2"?"180deg":"0deg")+")",fontSize:FS.fs55,color:pickerTypeFilter!=="all"?"#d4cec4":"#8a8478",transition:"transform .15s"}}>{"▼"}</span>
                          </button>
                          {pickerOpenDrop==="type2" && (
                            <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:"100%",background:"rgba(16,14,10,.95)",border:"1px solid rgba(180,172,158,.06)",borderRadius:R.r8,padding:"6px 4px",zIndex:21,boxShadow:"0 8px 24px rgba(0,0,0,.7)"}}>
                              <div onClick={()=>{setPickerTypeFilter("all");closeDrops2();}} style={{padding:"6px 10px",fontSize:FS.fs72,cursor:"pointer",borderRadius:R.r5,color:pickerTypeFilter==="all"?"#d4cec4":"#8a8478",background:pickerTypeFilter==="all"?"rgba(45,42,36,.2)":"transparent"}}>All Types</div>
                              {PTYPE_OPTS2.map(t=>(
                                <div key={t} onClick={()=>{setPickerTypeFilter(t);closeDrops2();}} style={{padding:"6px 10px",fontSize:FS.fs72,cursor:"pointer",borderRadius:R.r5,color:pickerTypeFilter===t?getTypeColor(t):"#8a8478",background:pickerTypeFilter===t?"rgba(45,42,36,.2)":"transparent"}}>{PTYPE_LABELS2[t]}</div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{position:"relative",flex:1,zIndex:20}}>
                          <button onClick={()=>setPickerOpenDrop(d=>d==="equip2"?null:"equip2")} style={{width:"100%",padding:"6px 24px 6px 8px",borderRadius:R.r8,border:"1px solid "+(pickerEquipFilter!=="all"?UI_COLORS.accent:"rgba(45,42,36,.3)"),background:"rgba(14,14,12,.95)",color:pickerEquipFilter!=="all"?UI_COLORS.accent:"#8a8478",fontSize:FS.fs68,textAlign:"left",cursor:"pointer",position:"relative"}}>
                            {pickerEquipFilter==="all"?"Equipment":pickerEquipFilter.charAt(0).toUpperCase()+pickerEquipFilter.slice(1)}
                            <span style={{position:"absolute",right:7,top:"50%",transform:"translateY(-50%) rotate("+(pickerOpenDrop==="equip2"?"180deg":"0deg")+")",fontSize:FS.fs55,color:pickerEquipFilter!=="all"?UI_COLORS.accent:"#8a8478",transition:"transform .15s"}}>{"▼"}</span>
                          </button>
                          {pickerOpenDrop==="equip2" && (
                            <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:"100%",background:"rgba(16,14,10,.95)",border:"1px solid rgba(180,172,158,.06)",borderRadius:R.r8,padding:"6px 4px",zIndex:21,boxShadow:"0 8px 24px rgba(0,0,0,.7)"}}>
                              <div onClick={()=>{setPickerEquipFilter("all");closeDrops2();}} style={{padding:"6px 10px",fontSize:FS.fs72,cursor:"pointer",borderRadius:R.r5,color:pickerEquipFilter==="all"?UI_COLORS.accent:"#8a8478",background:pickerEquipFilter==="all"?"rgba(196,148,40,0.12)":"transparent"}}>All Equipment</div>
                              {PEQUIP_OPTS2.map(e=>(
                                <div key={e} onClick={()=>{setPickerEquipFilter(e);closeDrops2();}} style={{padding:"6px 10px",fontSize:FS.fs72,cursor:"pointer",borderRadius:R.r5,color:pickerEquipFilter===e?UI_COLORS.accent:"#8a8478",background:pickerEquipFilter===e?"rgba(196,148,40,0.12)":"transparent",textTransform:"capitalize"}}>{e}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {(()=>{
                  if(filteredExercises.length===0) return <div className="empty" style={{padding:"20px 0"}}>No exercises found.</div>;
                  return (
                    <>
                      <div style={{fontSize:FS.fs62,color:"#8a8478",marginBottom:S.s6,textAlign:"right"}}>
                        {filteredExercises.length+" match"+(filteredExercises.length!==1?"es":"")}
                      </div>
                      {/* Virtualized: rowHeight 60px = .picker-ex-row content (~52px) + 8px slot padding.
                          height: min(60vh, 480px) keeps the list inside the modal sheet without
                          overflowing on small screens. The previous slice(0,80) cap is gone —
                          users can scroll through all matches. */}
                      <List
                        rowCount={filteredExercises.length}
                        rowHeight={60}
                        rowComponent={PickerRow}
                        rowProps={pickerRowProps}
                        style={{ height: 'min(60vh, 480px)', width: '100%' }}
                      />
                    </>
                  );
                })()}
              </>
            ) : (
              <>
                {/* -- CONFIG VIEW -- */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:S.s10}}>
                  <button className="btn btn-ghost btn-sm" onClick={()=>setPickerConfigOpen(false)}>{"← Back"}</button>
                  <div className="sec" style={{margin:0,border:"none",padding:S.s0}}>{"Configure "}{pickerSelected.length}{" Exercise"}{pickerSelected.length!==1?"s":""}</div>
                  <button className="btn btn-gold btn-sm" onClick={commitPickerToPlan}>{"Add to Plan ✓"}</button>
                </div>
                {pickerSelected.map((entry,idx)=>{
                  const ex=allExById[entry.exId]; if(!ex) return null;
                  const isCardio=ex.category==="cardio"||ex.category==="flexibility";
                  const isTreadEx=ex.hasTreadmill||false;
                  const noSets=NO_SETS_EX_IDS.has(ex.id);
                  const metric=isMetric(profile.units);
                  const wUnit=weightLabel(profile.units);
                  const dUnit=distLabel(profile.units);
                  return (
                    <div key={entry.exId} style={{background:"rgba(45,42,36,.12)",border:"1px solid rgba(180,172,158,.05)",borderRadius:R.r10,padding:"10px 12px",marginBottom:S.s8}}>
                      <div style={{display:"flex",alignItems:"center",gap:S.s8,marginBottom:S.s8}}>
                        <span style={{fontSize:"1.1rem"}}>{ex.icon}</span>
                        <span style={{fontSize:FS.fs82,color:"#d4cec4",flex:1}}>{ex.name}</span>
                        <span style={{fontSize:FS.fs65,cursor:"pointer",color:UI_COLORS.danger}} onClick={()=>setPickerSelected(p=>p.filter(e=>e.exId!==entry.exId))}>{"✕"}</span>
                      </div>
                      {/* Top row -- category-specific */}
                      {ex.id==="rest_day" ? <div style={{fontSize:FS.fs72,color:"#8a8478",fontStyle:"italic",padding:"6px 0"}}>{"🛌 No configuration needed"}</div> : null}
                      {ex.id!=="rest_day" && (
                        <div style={{display:"flex",gap:S.s6,flexWrap:"wrap",marginBottom:S.s6}}>
                          {!noSets && !isCardio && (
                            <div className="field" style={{flex:1,minWidth:60,marginBottom:S.s0}}>
                              <label htmlFor={`pc-${entry.exId}-sets`}>Sets</label>
                              <input id={`pc-${entry.exId}-sets`} className="inp" style={{padding:"6px 8px"}} type="text" inputMode="numeric" value={entry.sets||""} onChange={e=>pickerUpdateEx(entry.exId,"sets",e.target.value)} placeholder="3" />
                            </div>
                          )}
                          {isCardio ? (
                            <>
                              <div className="field" style={{flex:1.6,minWidth:70,marginBottom:S.s0}}>
                                <label htmlFor={`pc-${entry.exId}-dur`}>Duration (HH:MM)</label>
                                <input id={`pc-${entry.exId}-dur`} className="inp" style={{padding:"6px 8px"}} type="text" inputMode="numeric"
                                  value={entry._durHHMM||""}
                                  onChange={e=>pickerUpdateEx(entry.exId,"_durHHMM",e.target.value)}
                                  onBlur={e=>{const n=normalizeHHMM(e.target.value);pickerUpdateEx(entry.exId,"_durHHMM",n);pickerUpdateEx(entry.exId,"reps",String(Math.max(1,Math.floor(combineHHMMSec(n,entry._durSec||"")/60))));}}
                                  placeholder="00:00" />
                              </div>
                              <div className="field" style={{flex:0.8,minWidth:50,marginBottom:S.s0}}>
                                <label htmlFor={`pc-${entry.exId}-sec`}>Seconds</label>
                                <input id={`pc-${entry.exId}-sec`} className="inp" style={{padding:"6px 8px",textAlign:"center"}} type="number" min="0" max="59"
                                  value={entry._durSec||""}
                                  onChange={e=>{pickerUpdateEx(entry.exId,"_durSec",e.target.value);pickerUpdateEx(entry.exId,"reps",String(Math.max(1,Math.floor(combineHHMMSec(entry._durHHMM||"",e.target.value)/60))));}}
                                  placeholder="00" />
                              </div>
                              <div className="field" style={{flex:1,minWidth:60,marginBottom:S.s0}}>
                                <label htmlFor={`pc-${entry.exId}-dist`}>Dist ({dUnit})</label>
                                <input id={`pc-${entry.exId}-dist`} className="inp" style={{padding:"6px 8px"}} type="text" inputMode="decimal" value={entry.distanceMi||""} onChange={e=>pickerUpdateEx(entry.exId,"distanceMi",e.target.value)} placeholder="0" />
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="field" style={{flex:1,minWidth:60,marginBottom:S.s0}}>
                                <label htmlFor={`pc-${entry.exId}-reps`}>Reps</label>
                                <input id={`pc-${entry.exId}-reps`} className="inp" style={{padding:"6px 8px"}} type="text" inputMode="numeric" value={entry.reps||""} onChange={e=>pickerUpdateEx(entry.exId,"reps",e.target.value)} placeholder="10" />
                              </div>
                              <div className="field" style={{flex:1,minWidth:60,marginBottom:S.s0}}>
                                <label htmlFor={`pc-${entry.exId}-weight`}>Weight ({wUnit})</label>
                                <input id={`pc-${entry.exId}-weight`} className="inp" style={{padding:"6px 8px"}} type="text" inputMode="decimal" value={entry.weightLbs||""} onChange={e=>pickerUpdateEx(entry.exId,"weightLbs",e.target.value)} placeholder="0" />
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      {/* Treadmill: Incline + Speed */}
                      {ex.id!=="rest_day" && isTreadEx && (
                        <div style={{display:"flex",gap:S.s6,marginBottom:S.s6}}>
                          <div className="field" style={{flex:1,marginBottom:S.s0}}>
                            <label>{"Incline (0.5–15)"}</label>
                            <input className="inp" style={{padding:"6px 8px"}} type="number" min="0.5" max="15" step="0.5" value={entry.incline||""} onChange={e=>pickerUpdateEx(entry.exId,"incline",e.target.value?parseFloat(e.target.value):null)} placeholder={"—"} />
                          </div>
                          <div className="field" style={{flex:1,marginBottom:S.s0}}>
                            <label>{"Speed (0.5–15)"}</label>
                            <input className="inp" style={{padding:"6px 8px"}} type="number" min="0.5" max="15" step="0.5" value={entry.speed||""} onChange={e=>pickerUpdateEx(entry.exId,"speed",e.target.value?parseFloat(e.target.value):null)} placeholder={"—"} />
                          </div>
                        </div>
                      )}
                      {/* +Add Row */}
                      {ex.id!=="rest_day" && (entry.extraRows||[]).map((row,ri)=>(
                        <div key={ri} style={{display:"flex",gap:S.s4,marginBottom:S.s4,padding:"6px 8px",background:"rgba(45,42,36,.18)",borderRadius:R.r5,alignItems:"center",flexWrap:"wrap"}}>
                          <span style={{fontSize:FS.fs55,color:"#9a8a78",flexShrink:0,minWidth:16}}>{isCardio?`I${ri+2}`:`S${ri+2}`}</span>
                          {isCardio ? (
                            <>
                              <input className="inp" style={{flex:1.5,minWidth:50,padding:"4px 8px",fontSize:FS.fs72}} type="text" inputMode="numeric" placeholder="HH:MM"
                                value={row.hhmm||""}
                                onChange={e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],hhmm:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}}
                                onBlur={e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],hhmm:normalizeHHMM(e.target.value)};pickerUpdateEx(entry.exId,"extraRows",rr);}} />
                              <input className="inp" style={{flex:0.7,minWidth:36,padding:"4px 8px",fontSize:FS.fs72}} type="number" min="0" max="59" placeholder="Sec" value={row.sec||""} onChange={e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],sec:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}} />
                              <input className="inp" style={{flex:1,minWidth:40,padding:"4px 8px",fontSize:FS.fs72}} type="text" inputMode="decimal" placeholder={distLabel(profile.units)} value={row.distanceMi||""} onChange={e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],distanceMi:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}} />
                              {isTreadEx && <input className="inp" style={{flex:0.7,minWidth:34,padding:"4px 8px",fontSize:FS.fs72}} type="number" min="0.5" max="15" step="0.5" placeholder="Inc" value={row.incline||""} onChange={e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],incline:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}} />}
                              {isTreadEx && <input className="inp" style={{flex:0.7,minWidth:34,padding:"4px 8px",fontSize:FS.fs72}} type="number" min="0.5" max="15" step="0.5" placeholder="Spd" value={row.speed||""} onChange={e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],speed:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}} />}
                            </>
                          ) : (
                            <>
                              {!noSets && <input className="inp" style={{flex:1,minWidth:40,padding:"4px 8px",fontSize:FS.fs72}} type="text" inputMode="decimal" placeholder="Sets" value={row.sets||""} onChange={e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],sets:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}} />}
                              <input className="inp" style={{flex:1,minWidth:40,padding:"4px 8px",fontSize:FS.fs72}} type="text" inputMode="decimal" placeholder="Reps" value={row.reps||""} onChange={e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],reps:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}} />
                              <input className="inp" style={{flex:1,minWidth:40,padding:"4px 8px",fontSize:FS.fs72}} type="text" inputMode="decimal" placeholder={wUnit} value={row.weightLbs||""} onChange={e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],weightLbs:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}} />
                            </>
                          )}
                          <button className="btn btn-danger btn-xs" style={{padding:"2px 4px",flexShrink:0}} onClick={()=>{const rr=(entry.extraRows||[]).filter((_,j)=>j!==ri);pickerUpdateEx(entry.exId,"extraRows",rr);}}>{"✕"}</button>
                        </div>
                      ))}
                      {ex.id!=="rest_day" && <button className="btn btn-ghost btn-xs" style={{width:"100%",marginTop:S.s4,fontSize:FS.fs60,color:"#8a8478",borderStyle:"dashed"}}
                        onClick={()=>{const rr=[...(entry.extraRows||[]),isCardio?{hhmm:"",sec:"",distanceMi:"",incline:"",speed:""}:{sets:"",reps:"",weightLbs:""}];pickerUpdateEx(entry.exId,"extraRows",rr);}}>{"＋ Add Row (e.g. "}{isCardio?"interval":"progressive set"}{")"}</button>}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default React.memo(PlanWizard, (prev, next) => {
  // Only re-render when data props change; skip callback props (stable by identity)
  return prev.editPlan === next.editPlan
    && prev.templatePlan === next.templatePlan
    && prev.profile === next.profile
    && prev.allExercises === next.allExercises
    && prev.allExById === next.allExById;
});
