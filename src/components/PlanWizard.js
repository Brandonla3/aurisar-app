import React, { useState, useMemo, useTransition, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { calcExXP, calcDayXP, getMuscleColor, getTypeColor, hrRange } from '../utils/xp';
import { isMetric, weightLabel, distLabel, lbsToKg, kgToLbs, miToKm, kmToMi } from '../utils/units';
import { normalizeHHMM, combineHHMMSec, secToHHMMSplit } from '../utils/time';
import { _optionalChain, uid, clone } from '../utils/helpers';
import { NO_SETS_EX_IDS, RUNNING_EX_ID, HR_ZONES } from '../data/constants';
import { CLASSES } from '../data/exercises';
import { ExIcon } from './ExIcon';

const ICONS = ["\u2694\uFE0F","\uD83C\uDFF9","\uD83E\uDDD8","\uD83D\uDEE1\uFE0F","\uD83D\uDD25","\uD83D\uDCAA","\uD83C\uDFCB\uFE0F","\u26A1","\uD83C\uDFC3","\uD83D\uDEB4","\uD83C\uDF05","\uD83C\uDF19","\uD83C\uDFD4\uFE0F","\uD83D\uDDE1\uFE0F","\uD83E\uDDD7","\uD83C\uDFAF"];

function formatScheduledDate(dateStr) {
  if(!dateStr) return "";
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});
  } catch(e) { return dateStr; }
}

function debounce(fn, ms) { let id; return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); }; }

function PlanWizard(props) {
  const { editPlan, templatePlan, profile, allExercises, allExById, onSave, onClose, onCompleteDayStart, onStartPlanWorkout, onDeletePlan, onSchedulePlan, onOpenExEditor, showToast } = props;

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
    if(editPlan) return editPlan.icon || "\u2694\uFE0F";
    if(templatePlan) return templatePlan.icon || "\u2694\uFE0F";
    return "\u2694\uFE0F";
  });
  const [bDays, setBDays] = useState(() => {
    if(editPlan) return clone(editPlan.days);
    if(templatePlan) return clone(templatePlan.days);
    return Array.from({length:7},(_,i)=>({label:`Day ${i+1}`,exercises:[]}));
  });
  const [bDayIdx, setBDayIdx] = useState(0);

  // ── Wizard/UI state ──
  const [wizardWeekIdx, setWizardWeekIdx] = useState(0);
  const [collapsedWeeks, setCollapsedWeeks] = useState({});
  const [planWizardOpen, setPlanWizardOpen] = useState(false);
  const [dragDayIdx, setDragDayIdx] = useState(null);
  const [dragWeekIdx, setDragWeekIdx] = useState(null);
  const [dragPlanExIdx, setDragPlanExIdx] = useState(null);
  const [collapsedPlanEx, setCollapsedPlanEx] = useState({});
  const [ssAccordion, setSsAccordion] = useState({});
  const [ssCheckedPlan, setSsCheckedPlan] = useState(()=>new Set());

  // ── Picker state ──
  const [exPickerOpen, setExPickerOpen] = useState(false);
  const [bWoPickerOpen, setBWoPickerOpen] = useState(false);
  const [pickerSearchDisplay, setPickerSearchDisplay] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");
  const debouncedSetSearch = useRef(debounce(v => setPickerSearch(v), 200)).current;
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
      return ex.intervals ? Math.round((base+rowsXP)*1.25) : (base+rowsXP);
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

  function addDayToBuilder(){ startTransition(()=>{ setBDays(d=>[...d,{label:`Day ${d.length+1}`,exercises:[]}]); setBDayIdx(bDays.length); }); }
  function removeDayFromBuilder(idx){ startTransition(()=>{ const nd=bDays.filter((_,i)=>i!==idx); setBDays(nd); setBDayIdx(Math.min(bDayIdx,nd.length-1)); }); }
  function reorderDay(fromIdx,toIdx){ if(fromIdx===toIdx) return; startTransition(()=>{ const nd=[...bDays]; const [moved]=nd.splice(fromIdx,1); nd.splice(toIdx,0,moved); setBDays(nd); setBDayIdx(toIdx); }); }

  function duplicateWeek(weekIdx){
    const start=weekIdx*7; const end=Math.min(start+7,bDays.length);
    const weekDays=bDays.slice(start,end);
    const base=bDays.length;
    const copies=weekDays.map((d,i)=>({...d,label:`Day ${base+i+1}`,exercises:d.exercises.map(e=>({...e}))}));
    startTransition(()=>{setBDays(d=>[...d,...copies]);});
    showToast(`Week ${weekIdx+1} duplicated!`);
  }

  function reorderWeek(fromWeek,toWeek){
    if(fromWeek===toWeek) return;
    const weeks=[]; const days=[...bDays];
    for(let i=0;i<days.length;i+=7) weeks.push(days.slice(i,i+7));
    const [moved]=weeks.splice(fromWeek,1); weeks.splice(toWeek,0,moved);
    const reordered=weeks.flat().map((d,i)=>({...d,label:`Day ${i+1}`}));
    startTransition(()=>{ setBDays(reordered); setBDayIdx(toWeek*7); });
  }

  function reorderPlanEx(dayIdx,fromIdx,toIdx){ if(fromIdx===toIdx) return; startTransition(()=>{setBDays(days=>days.map((d,i)=>{ if(i!==dayIdx) return d; const exs=[...d.exercises]; const [m]=exs.splice(fromIdx,1); exs.splice(toIdx,0,m); return {...d,exercises:exs}; }));}); }

  function addExToDay(exId){ const exd=allExById[exId]||{}; startTransition(()=>{setBDays(days=>days.map((d,i)=>i!==bDayIdx?d:{...d,exercises:[...d.exercises,{exId,sets:(exd.defaultSets!=null?exd.defaultSets:3),reps:(exd.defaultReps!=null?exd.defaultReps:10),weightLbs:exd.defaultWeightLbs||null,durationMin:exd.defaultDurationMin||null,distanceMi:exd.defaultDistanceMi||null,hrZone:exd.defaultHrZone||null,weightPct:exd.defaultWeightPct||100}]}));}); setExPickerOpen(false); }

  function removeExFromDay(di,ei){ startTransition(()=>{setBDays(days=>days.map((d,i)=>i!==di?d:{...d,exercises:d.exercises.filter((_,j)=>j!==ei)}));}); }

  function updateExInDay(di,ei,field,val){ startTransition(()=>{setBDays(days=>days.map((d,i)=>i!==di?d:{...d,exercises:d.exercises.map((e,j)=>j!==ei?e:{...e,[field]:val})}));}); }

  function updateExInDayBatch(di,ei,fields){ startTransition(()=>{setBDays(days=>days.map((d,i)=>i!==di?d:{...d,exercises:d.exercises.map((e,j)=>j!==ei?e:{...e,...fields})}));}); }

  function updateDayLabel(idx,val){ startTransition(()=>{setBDays(days=>days.map((d,i)=>i!==idx?d:{...d,label:val}));}); }

  function planGroupSuperset(dayIdx, idxA, idxB) {
    startTransition(()=>{setBDays(days => days.map((d,di) => {
      if(di!==dayIdx) return d;
      return {...d, exercises: d.exercises.map((e,ei) =>
        ei===idxA ? {...e, supersetWith:idxB} : ei===idxB ? {...e, supersetWith:idxA} : e
      )};
    }));});
    setSsCheckedPlan(new Set());
  }

  function planUngroupSuperset(dayIdx, idxA, idxB) {
    startTransition(()=>{setBDays(days => days.map((d,di) => {
      if(di!==dayIdx) return d;
      return {...d, exercises: d.exercises.map((e,ei) =>
        ei===idxA ? {...e, supersetWith:null} : ei===idxB ? {...e, supersetWith:null} : e
      )};
    }));});
  }

  function renderPlanSsSection(ex, dayIdx, exIdx, exData, label, sectionKey) {
    const collapsed = !!ssAccordion[sectionKey];
    const _noSets = NO_SETS_EX_IDS.has(exData.id);
    const _isC = exData.category==="cardio"; const _isF = exData.category==="flexibility";
    const _hasDur = _isC||_isF; const _hasW = !_isC&&!_isF;
    const _m = isMetric(profile.units); const _wU = weightLabel(profile.units); const _dU = distLabel(profile.units);
    const xpVal = wizardExXPs[exIdx]||0;
    const summaryText = (_noSets?"":ex.sets+"\u00D7") + ex.reps + (ex.weightLbs?` \u00B7 ${_m?lbsToKg(ex.weightLbs):ex.weightLbs}${_wU}`:"");
    return React.createElement('div', {className:"ss-section"},
      React.createElement('div', {className:"ss-section-hdr",onClick:()=>setSsAccordion(p=>({...p,[sectionKey]:!p[sectionKey]}))},
        React.createElement('div', {className:"ab-badge"}, label),
        React.createElement('div', {style:{width:28,height:28,borderRadius:6,flexShrink:0,background:"rgba(45,42,36,.15)",border:"1px solid rgba(180,172,158,.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".8rem"}}, exData.icon),
        React.createElement('span', {style:{fontFamily:"'Cinzel',serif",fontSize:".66rem",color:"#d8caba",letterSpacing:".02em",flex:1,minWidth:0}}, exData.name),
        collapsed && React.createElement('span', {style:{fontSize:".55rem",color:"#5a5650"}}, summaryText),
        React.createElement('span', {style:{fontSize:".6rem",fontWeight:700,color:"#b4ac9e",flexShrink:0}}, "+"+xpVal),
        React.createElement('span', {style:{fontSize:".6rem",color:"#5a5650",transition:"transform .2s",transform:collapsed?"rotate(0deg)":"rotate(180deg)"}}, "\u25BC")
      ),
      !collapsed && React.createElement('div', {className:"ss-section-body"},
        React.createElement('div', {style:{display:"flex",gap:6,marginBottom:6}},
          !_noSets&&!_hasDur&&React.createElement('div', {style:{flex:1,minWidth:0}},
            React.createElement('label', {style:{fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Sets"),
            React.createElement('input', {className:"builder-ex-input",style:{width:"100%"},type:"text",inputMode:"decimal",
              defaultValue:ex.sets===0||ex.sets===""?"":ex.sets, onBlur:e=>updateExInDay(dayIdx,exIdx,"sets",e.target.value)})
          ),
          _hasDur ? (React.createElement(React.Fragment, null,
            React.createElement('div', {style:{flex:1.6,minWidth:0}},
              React.createElement('label', {style:{fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Duration"),
              React.createElement('input', {className:"builder-ex-input",style:{width:"100%"},type:"text",inputMode:"numeric",
                defaultValue:ex._durHHMM!==undefined?ex._durHHMM:(ex.durationSec?secToHHMMSplit(ex.durationSec).hhmm:ex.reps?"00:"+String(ex.reps).padStart(2,"0"):""),
                onBlur:e=>{const n=normalizeHHMM(e.target.value);const s=combineHHMMSec(n,ex._durSec||"");const batch={_durHHMM:n||undefined,durationSec:s};if(s){batch.reps=Math.max(1,Math.floor(s/60));batch.durationMin=s/60;}updateExInDayBatch(dayIdx,exIdx,batch);},
                placeholder:"00:00"})
            ),
            React.createElement('div', {style:{flex:1,minWidth:0}},
              React.createElement('label', {style:{fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Dist (",_dU,")"),
              React.createElement('input', {className:"builder-ex-input",style:{width:"100%"},type:"text",inputMode:"decimal",
                defaultValue:ex.distanceMi?(_m?String(parseFloat(miToKm(ex.distanceMi)).toFixed(2)):String(ex.distanceMi)):"",
                onBlur:e=>{const v=e.target.value;const mi=v&&_m?kmToMi(v):v;updateExInDay(dayIdx,exIdx,"distanceMi",mi||null);},
                placeholder:"0"})
            )
          )) : (React.createElement(React.Fragment, null,
            React.createElement('div', {style:{flex:1,minWidth:0}},
              React.createElement('label', {style:{fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Reps"),
              React.createElement('input', {className:"builder-ex-input",style:{width:"100%"},type:"text",inputMode:"decimal",
                defaultValue:ex.reps===0||ex.reps===""?"":ex.reps, onBlur:e=>updateExInDay(dayIdx,exIdx,"reps",e.target.value)})
            ),
            _hasW&&React.createElement('div', {style:{flex:1.2,minWidth:0}},
              React.createElement('label', {style:{fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Weight (",_wU,")"),
              React.createElement('input', {className:"builder-ex-input",style:{width:"100%"},type:"text",inputMode:"decimal",
                defaultValue:ex.weightLbs!=null&&ex.weightLbs!==""?(_m?lbsToKg(ex.weightLbs):String(ex.weightLbs)):"",
                onBlur:e=>{const v=e.target.value;const lbs=v&&_m?kgToLbs(v):v;updateExInDay(dayIdx,exIdx,"weightLbs",lbs||null);},
                placeholder:"\u2014"})
            )
          ))
        )
      )
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
    setPickerSearchDisplay(""); setPickerSearch(""); setPickerMuscle("All"); setPickerMuscleOpen(false); setPickerTypeFilter("all"); setPickerEquipFilter("all"); setPickerOpenDrop(null);
    setPickerSelected([]); setPickerConfigOpen(false);
  }

  function pickerToggleEx(exId) {
    setPickerSelected(prev => {
      const exists = prev.find(e=>e.exId===exId);
      if(exists) return prev.filter(e=>e.exId!==exId);
      return [...prev, {exId, sets:"3", reps:"10", weightLbs:"", weightPct:100, durationMin:"", distanceMi:"", hrZone:null}];
    });
  }

  function pickerUpdateEx(exId, field, val) {
    setPickerSelected(prev=>prev.map(e=>e.exId===exId?{...e,[field]:val}:e));
  }

  function commitPickerToPlan() {
    if(pickerSelected.length===0) return;
    startTransition(()=>{setBDays(days=>days.map((d,i)=>i!==bDayIdx?d:{...d,exercises:[...d.exercises,...pickerSelected.map(e=>({exId:e.exId,sets:e.sets||"",reps:e.reps||"",weightLbs:e.weightLbs||null,durationMin:e.durationMin||null,distanceMi:e.distanceMi||null,hrZone:e.hrZone||null,weightPct:e.weightPct||100}))]}));});
    closePicker();
  }

  // ══════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════
  return React.createElement(React.Fragment, null

    // ── 1. BUILDER OVERVIEW FORM ──
    , React.createElement('div', { className: "builder-nav-hdr" }
      , React.createElement('button', { className: "btn btn-ghost btn-sm", onClick: onClose }, "\u2190 Back")
      , React.createElement('div', { className: "builder-nav-title" }, bEditId ? "\u270E Overview" : "\uD83D\uDCDC New Plan")
    )
    , React.createElement('div', { className: "builder-wrap"}
      , React.createElement('div', { className: "field"}, React.createElement('label', null, "Plan Name" ), React.createElement('input', { className: "inp", value: bName, onChange: e=>setBName(e.target.value), placeholder: "Name your plan\u2026"  }))
      , React.createElement('div', { className: "field"}
        , React.createElement('label', null, "Level " , React.createElement('span', { style: {fontSize:".55rem",opacity:.6}}, "(optional)"))
        , React.createElement('div', { style: {display:"flex",gap:6}}
          , ["Beginner","Intermediate","Expert"].map(lvl=>(
            React.createElement('button', { key: lvl, className: "btn btn-ghost btn-xs"  ,
              style: {flex:1,fontSize:".62rem",
                border:bLevel===lvl?`1px solid ${lvl==="Beginner"?"#5A8A58":lvl==="Intermediate"?"#A8843C":"#7A2838"}`:"",
                color:bLevel===lvl?(lvl==="Beginner"?"#5A8A58":lvl==="Intermediate"?"#A8843C":"#7A2838"):"",
                background:bLevel===lvl?"rgba(45,42,36,.15)":""},
              onClick: ()=>setBLevel(bLevel===lvl?"":lvl)}
              , lvl
            )
          ))
        )
      )

      /* Duration Type + Count */
      , React.createElement('div', { className: "field"}
        , React.createElement('label', null, "Duration")
        , React.createElement('div', { className: "dur-row"}
          , React.createElement('select', { className: "dur-count-sel", value: bDurCount,
            onChange: e=>{
              const newCount=parseInt(e.target.value);
              setBDurCount(newCount);
              const totalDays=bType==="day"?newCount:bType==="week"?newCount*7:bType==="month"?newCount*28:newCount*52*7;
              if(totalDays>7&&totalDays>bDays.length){
                const extra=Array.from({length:totalDays-bDays.length},(_,i)=>({label:`Day ${bDays.length+i+1}`,exercises:[]}));
                startTransition(()=>{setBDays(d=>[...d,...extra]);});
              }
              if(bStartDate){
                const d=new Date(bStartDate+"T12:00:00");
                if(bType==="day") d.setDate(d.getDate()+newCount-1);
                else if(bType==="week") d.setDate(d.getDate()+newCount*7-1);
                else if(bType==="month") d.setMonth(d.getMonth()+newCount);
                else d.setFullYear(d.getFullYear()+newCount);
                setBEndDate(d.toISOString().slice(0,10));
              }
            }}
            , (()=>{
              const max = bType==="day"?31:bType==="week"?52:bType==="month"?12:3;
              return Array.from({length:max},(_,i)=>i+1).map(n=>(
                React.createElement('option', { key: n, value: n}, n)
              ));
            })()
          )
          , React.createElement('select', { className: "dur-type-sel", value: bType,
            onChange: e=>{
              const t=e.target.value;
              setBType(t);
              const max=t==="day"?31:t==="week"?52:t==="month"?12:3;
              const newCount=Math.min(bDurCount,max);
              setBDurCount(newCount);
              const totalDays=t==="day"?newCount:t==="week"?newCount*7:t==="month"?newCount*28:newCount*52*7;
              if(totalDays>7&&totalDays>bDays.length){
                const extra=Array.from({length:totalDays-bDays.length},(_,i)=>({label:`Day ${bDays.length+i+1}`,exercises:[]}));
                startTransition(()=>{setBDays(d=>[...d,...extra]);});
              }
              if(bStartDate){
                const d=new Date(bStartDate+"T12:00:00");
                if(t==="day") d.setDate(d.getDate()+newCount-1);
                else if(t==="week") d.setDate(d.getDate()+newCount*7-1);
                else if(t==="month") d.setMonth(d.getMonth()+newCount);
                else d.setFullYear(d.getFullYear()+newCount);
                setBEndDate(d.toISOString().slice(0,10));
              }
            }}
            , React.createElement('option', { value: "day"}, "Day", bDurCount>1?"s":"")
            , React.createElement('option', { value: "week"}, "Week", bDurCount>1?"s":"")
            , React.createElement('option', { value: "month"}, "Month", bDurCount>1?"s":"")
            , React.createElement('option', { value: "year"}, "Year", bDurCount>1?"s":"")
          )
        )
        , React.createElement('div', { style: {fontSize:".62rem",color:"#5a5650",marginTop:4,fontStyle:"italic"}}
          , bDurCount===1?"Single "+bType+" plan":`${bDurCount}-${bType} program`
        )
      )

      /* Start / End Dates */
      , React.createElement('div', { className: "plan-date-row"}
        , React.createElement('div', { className: "field"}
          , React.createElement('label', null, "Start Date "  , React.createElement('span', { style: {fontSize:".55rem",opacity:.6}}, "(optional)"))
          , React.createElement('input', { className: "inp", type: "date", value: bStartDate,
            onChange: e=>{
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
            }})
        )
        , React.createElement('div', { className: "field"}
          , React.createElement('label', null, "End Date "  , React.createElement('span', { style: {fontSize:".55rem",opacity:.6}}, "(optional)"))
          , React.createElement('input', { className: "inp", type: "date", value: bEndDate,
            min: (()=>{
              if(!bStartDate) return undefined;
              const d = new Date(bStartDate+"T12:00:00");
              if(bType==="day")   d.setDate(d.getDate()+bDurCount-1);
              else if(bType==="week")  d.setDate(d.getDate()+bDurCount*7-1);
              else if(bType==="month") d.setMonth(d.getMonth()+bDurCount);
              else                d.setFullYear(d.getFullYear()+bDurCount);
              return d.toISOString().slice(0,10);
            })(),
            onChange: e=>{
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
            }})
        )
      )
      , bStartDate&&bEndDate&&(
        React.createElement('div', { style: {fontSize:".65rem",color:"#b4ac9e",marginTop:-8,marginBottom:4,fontStyle:"italic"}}, "\uD83D\uDCC5 "
           , (()=>{
            const s=new Date(bStartDate+"T12:00:00");
            const e=new Date(bEndDate+"T12:00:00");
            const days=Math.round((e-s)/(1000*60*60*24))+1;
            return s.toLocaleDateString([],{month:"short",day:"numeric"})+" \u2192 "+e.toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"})+" ("+days+" day"+(days!==1?"s":"")+")"
          })()
        )
      )
      , React.createElement('div', { className: "field"}, React.createElement('label', null, "Icon")
        , React.createElement('div', { className: "icon-row"}, ICONS.map(ic=>React.createElement('div', { key: ic, className: `icon-opt ${bIcon===ic?"sel":""}`, onClick: ()=>setBIcon(ic)}, ic)))
      )
      , React.createElement('div', { className: "xp-projection"}
        , React.createElement('div', null, React.createElement('div', { className: "xp-proj-label"}, "Projected Total XP"  ), React.createElement('div', { className: "xp-proj-detail"}, bDays.filter(d=>d.exercises.length>0).length, " active days \u00B7 "    , bDays.reduce((t,d)=>t+d.exercises.length,0), " exercises"  ))
        , React.createElement('div', { className: "xp-proj-value"}, "\u26A1 " , builderXP.toLocaleString())
      )
      , React.createElement('button', { className: "btn btn-gold btn-plan-action" ,
          onClick: ()=>{setPlanWizardOpen(true);setWizardWeekIdx(0);}},
          bEditId ? "\u270E Edit Plan" : "\u2694 Create Plan"
      )
      , React.createElement('div', { style: {fontSize:".58rem",color:"#5a5650",textAlign:"center",marginTop:6,fontStyle:"italic"}},
          bEditId ? "Open the plan wizard to edit days and exercises" : "Open the plan wizard to add days and exercises"
      )
      /* Action buttons -- only for existing plans in user's collection */
      , bEditId && (()=>{
        const plan = (profile.plans||[]).find(p=>p.id===bEditId);
        if(!plan) return null;
        return React.createElement(React.Fragment, null
          , React.createElement('div', { className: "div", style: {margin:"8px 0"}})
          , React.createElement('div', { style: {display:"flex",gap:7}}
            , React.createElement('button', { className: `plan-sched-btn ${plan.scheduledDate?"plan-sched-active":""}`,
              style: {flex:1,padding:"8px 12px",textAlign:"center"},
              onClick: ()=>onSchedulePlan(plan)}
              , plan.scheduledDate?"\uD83D\uDCC5 "+formatScheduledDate(plan.scheduledDate):"\uD83D\uDCC5 Schedule"
            )
            , plan.custom&&React.createElement('button', { className: "btn btn-danger btn-sm"  , style: {flex:1}, onClick: ()=>{onDeletePlan(plan.id);onClose();}}, "\uD83D\uDDD1 Delete" )
          )
          , plan.custom&&React.createElement('button', { className: "btn btn-glass" , style: {width:"100%",marginTop:7}, onClick: ()=>onStartPlanWorkout(plan)}, "\uD83D\uDCCB Mark Plan Complete"   )
        );
      })()
    )

    // ── 2. PLAN WIZARD FULL-SCREEN OVERLAY ──
    , planWizardOpen && createPortal(
      React.createElement('div', { className: "plan-wizard-backdrop", onClick: e=>e.stopPropagation() }
        , React.createElement('div', { className: "plan-wizard-inner" }
          /* Wizard Header */
          , React.createElement('div', { className: "plan-wizard-hdr" }
            , React.createElement('button', { className: "btn btn-ghost btn-sm" , onClick: ()=>setPlanWizardOpen(false)}, "\u2190 Back")
            , React.createElement('div', { className: "plan-wizard-hdr-title" }
              , React.createElement('span', { className: "plan-wizard-hdr-icon" }, bIcon)
              , " " , bName||"Untitled Plan"
            )
            , React.createElement('button', { className: "btn btn-gold btn-sm" , onClick: ()=>{saveBuiltPlan();setPlanWizardOpen(false);}}, "\uD83D\uDCBE Save")
          )

          /* Week tabs (only for multi-week plans) */
          , bDays.length > 7 && (()=>{
            const weekCount = Math.ceil(bDays.length / 7);
            return React.createElement('div', { className: "wizard-week-tabs" }
              , Array.from({length:weekCount},(_,wk)=>{
                const weekDays = bDays.slice(wk*7, wk*7+7);
                const weekXP = weekDays.reduce((t,d,di)=>t+(wizardDayXPs[wk*7+di]||0),0);
                const activeDays = weekDays.filter(d=>d.exercises.length>0).length;
                return React.createElement('div', { key: wk,
                  className: `wizard-week-tab ${wizardWeekIdx===wk?"on":""}`,
                  onClick: ()=>{setWizardWeekIdx(wk);setBDayIdx(wk*7);}
                }
                  , React.createElement('span', null, "Week " , wk+1)
                  , React.createElement('span', { className: "wk-days" }, activeDays, "/", weekDays.length, " active" )
                  , React.createElement('span', { className: "wk-xp" }, "\u26A1", weekXP.toLocaleString())
                );
              })
              , React.createElement('div', { className: "wizard-week-tab", style: {color:"#b4ac9e",borderStyle:"dashed",borderColor:"rgba(180,172,158,.12)"},
                onClick: ()=>{
                  const newDays = Array.from({length:7},(_,i)=>({label:`Day ${bDays.length+i+1}`,exercises:[]}));
                  startTransition(()=>{setBDays(d=>[...d,...newDays]);});
                  setWizardWeekIdx(Math.ceil((bDays.length+7)/7)-1);
                }}, "\uFF0B Week")
            );
          })()

          /* Day tabs for the current week (or all days if single-week) */
          , (()=>{
            const multiWeek = bDays.length > 7;
            const weekStart = multiWeek ? wizardWeekIdx * 7 : 0;
            const weekDays = multiWeek ? bDays.slice(weekStart, weekStart+7) : bDays;
            return React.createElement('div', { className: "wizard-day-tabs" }
              , weekDays.map((d,wi)=>{
                const globalIdx = weekStart + wi;
                const dayXP = wizardDayXPs[globalIdx]||0;
                const hasExercises = d.exercises.length > 0;
                return React.createElement('div', { key: globalIdx,
                  className: `wizard-day-tab ${bDayIdx===globalIdx?"on":""}`,
                  draggable: true,
                  onDragStart: e=>{e.dataTransfer.effectAllowed="move";setDragDayIdx(globalIdx);},
                  onDragOver: e=>{e.preventDefault();e.dataTransfer.dropEffect="move";},
                  onDrop: e=>{e.preventDefault();reorderDay(dragDayIdx,globalIdx);setDragDayIdx(null);},
                  onDragEnd: ()=>setDragDayIdx(null),
                  onClick: ()=>setBDayIdx(globalIdx),
                  onTouchEnd: e=>{e.preventDefault();setBDayIdx(globalIdx);}
                }
                  , React.createElement('span', { className: "drag-handle" }, "\u2807")
                  , React.createElement('span', null, d.label||`Day ${globalIdx+1}`)
                  , hasExercises
                    ? React.createElement('span', { className: "day-xp-mini" }, "\u26A1", dayXP)
                    : React.createElement('span', { className: "day-rest-badge" }, "REST")
                );
              })
              , React.createElement('div', { className: "wizard-day-tab", style: {color:"#b4ac9e",borderStyle:"dashed",borderColor:"rgba(180,172,158,.12)",minWidth:52},
                onClick: addDayToBuilder}, "\uFF0B")
            );
          })()

          /* Multi-week: duplicate week + week XP info */
          , bDays.length > 7 && React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}
            , React.createElement('span', { style: {fontSize:".62rem",color:"#8a8478"}}
              , "Week ", wizardWeekIdx+1, " \u00B7 "
              , (()=>{const wDays=bDays.slice(wizardWeekIdx*7,wizardWeekIdx*7+7);return wDays.filter(d=>d.exercises.length>0).length;})(), " active days"
            )
            , React.createElement('button', { className: "btn btn-ghost btn-xs" , style: {fontSize:".58rem"},
              onClick: ()=>duplicateWeek(wizardWeekIdx)}, "\u2398 Duplicate Week" )
          )

          /* Selected day editor */
          , React.createElement('div', { className: "wizard-day-editor" }
            , React.createElement('div', { className: "wizard-day-hdr" }
              , React.createElement('input', { key: "dlbl_"+bDayIdx, className: "inp", defaultValue: _optionalChain([bDays, 'access', _4 => _4[bDayIdx], 'optionalAccess', _5 => _5.label])||"", onBlur: e=>updateDayLabel(bDayIdx,e.target.value), placeholder: "Day label\u2026" , style: {flex:1,padding:"8px 12px",fontSize:".82rem"}})
              , React.createElement('span', { style: {fontSize:".72rem",color:"#b4ac9e",fontFamily:"'Inter',sans-serif",whiteSpace:"nowrap"}}, "\u26A1 " , wizardDayXPs[bDayIdx]||0)
              , bDays.length>1 && React.createElement('button', { className: "btn btn-danger btn-xs", style: {marginLeft:6,padding:"4px 8px",fontSize:".6rem"}, onClick: ()=>removeDayFromBuilder(bDayIdx)}, "\uD83D\uDDD1 Delete Day")
            )
            /* Optional day-level stats */
            , React.createElement('div', { key: "dstats_"+bDayIdx, className: "wizard-day-stats" }
              , React.createElement('input', { className: "inp", type: "text", inputMode: "numeric", placeholder: "Duration HH:MM" ,
                style: {flex:1.5,fontSize:".68rem",padding:"6px 10px"},
                defaultValue: _optionalChain([bDays, 'access', _6 => _6[bDayIdx], 'optionalAccess', _7 => _7._durHHMM])!==undefined ? bDays[bDayIdx]._durHHMM : (_optionalChain([bDays, 'access', _8 => _8[bDayIdx], 'optionalAccess', _9 => _9.durationSec]) ? secToHHMMSplit(bDays[bDayIdx].durationSec).hhmm : ""),
                onBlur: e=>{const norm=normalizeHHMM(e.target.value);const sec=combineHHMMSec(norm,_optionalChain([bDays, 'access', _10 => _10[bDayIdx], 'optionalAccess', _11 => _11._durSec])||"");setBDays(days=>days.map((d,i)=>i!==bDayIdx?d:{...d,durationSec:sec,_durHHMM:sec?norm:undefined,durationMin:sec?sec/60:null}));}})
              , React.createElement('input', { className: "inp", type: "number", min: "0", max: "59", placeholder: "Sec (0-59)" ,
                style: {flex:0.8,fontSize:".68rem",padding:"6px 10px"},
                defaultValue: _optionalChain([bDays, 'access', _12 => _12[bDayIdx], 'optionalAccess', _13 => _13._durSec])||"",
                onBlur: e=>{const sec=combineHHMMSec(_optionalChain([bDays, 'access', _14 => _14[bDayIdx], 'optionalAccess', _15 => _15._durHHMM])||"",e.target.value);setBDays(days=>days.map((d,i)=>i!==bDayIdx?d:{...d,durationSec:sec,_durSec:undefined,durationMin:sec?sec/60:null}));}})
              , React.createElement('input', { className: "inp", type: "number", min: "0", max: "9999", placeholder: "Active Cal" ,
                style: {flex:1,fontSize:".68rem",padding:"6px 10px"},
                defaultValue: _optionalChain([bDays, 'access', _16 => _16[bDayIdx], 'optionalAccess', _17 => _17.activeCal])||"",
                onBlur: e=>setBDays(days=>days.map((d,i)=>i!==bDayIdx?d:{...d,activeCal:e.target.value||null}))})
              , React.createElement('input', { className: "inp", type: "number", min: "0", max: "9999", placeholder: "Total Cal" ,
                style: {flex:1,fontSize:".68rem",padding:"6px 10px"},
                defaultValue: _optionalChain([bDays, 'access', _18 => _18[bDayIdx], 'optionalAccess', _19 => _19.totalCal])||"",
                onBlur: e=>setBDays(days=>days.map((d,i)=>i!==bDayIdx?d:{...d,totalCal:e.target.value||null}))})
            )
            , React.createElement('div', { style: {display:"flex",gap:6,marginBottom:8}}
              , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>setExPickerOpen(true)}, "\uFF0B Add Exercise"  )
              , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>setBWoPickerOpen(true)}, "\uD83D\uDCAA Add Workout"  )
            )
            , (()=>{const minSsCheckedPlan = ssCheckedPlan.size>0 ? Math.min(...ssCheckedPlan) : -1; return (_optionalChain([bDays, 'access', _20 => _20[bDayIdx], 'optionalAccess', _21 => _21.exercises])||[]).map((ex,i)=>{
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
                return React.createElement('div', {key:i, className:"ss-accordion"},
                  React.createElement('div', {className:"ss-accordion-hdr"},
                    React.createElement('div', {style:{display:"flex",flexDirection:"column",gap:2,flexShrink:0}},
                      React.createElement('button', {className:"btn btn-ghost btn-xs",style:{padding:"2px 5px",fontSize:".65rem",lineHeight:1,minWidth:0,opacity:Math.min(i,planPartnerIdx)===0?.3:1},
                        onClick:e=>{e.stopPropagation();
                          const minI=Math.min(i,planPartnerIdx);
                          if(minI<=0) return;
                          startTransition(()=>{setBDays(days=>days.map((d,di)=>{if(di!==bDayIdx)return d;const exs=[...d.exercises];
                            const above=exs[minI-1]; exs[minI-1]=exs[minI]; exs[minI]=exs[minI+1]; exs[minI+1]=above;
                            return {...d,exercises:exs.map(e=>{if(e.supersetWith===minI-1)return{...e,supersetWith:minI+1};if(e.supersetWith===minI)return{...e,supersetWith:minI-1};if(e.supersetWith===minI+1)return{...e,supersetWith:minI};return e;})};
                          }));});
                        }}, "\u25B2"),
                      React.createElement('button', {className:"btn btn-ghost btn-xs",style:{padding:"2px 5px",fontSize:".65rem",lineHeight:1,minWidth:0,opacity:Math.max(i,planPartnerIdx)>=((_optionalChain([bDays, 'access', _22 => _22[bDayIdx], 'optionalAccess', _23 => _23.exercises, 'access', _24 => _24.length])||1)-1)?.3:1},
                        onClick:e=>{e.stopPropagation();
                          const maxI=Math.max(i,planPartnerIdx); const minI=Math.min(i,planPartnerIdx);
                          const len=(_optionalChain([bDays, 'access', _25 => _25[bDayIdx], 'optionalAccess', _26 => _26.exercises, 'access', _27 => _27.length])||0);
                          if(maxI>=len-1) return;
                          startTransition(()=>{setBDays(days=>days.map((d,di)=>{if(di!==bDayIdx)return d;const exs=[...d.exercises];
                            const below=exs[maxI+1]; exs[maxI+1]=exs[maxI]; exs[maxI]=exs[minI]; exs[minI]=below;
                            return {...d,exercises:exs.map(e=>{if(e.supersetWith===minI)return{...e,supersetWith:minI+1};if(e.supersetWith===minI+1)return{...e,supersetWith:minI+2};if(e.supersetWith===maxI+1)return{...e,supersetWith:minI};return e;})};
                          }));});
                        }}, "\u25BC")
                    ),
                    React.createElement('span', {className:"ss-accordion-hdr-title"}, "\uD83D\uDD17 Superset"),
                    React.createElement('span', {className:"ss-accordion-xp"}, (xpA+xpB)+" XP total"),
                    React.createElement('button', {className:"ss-accordion-ungroup",
                      onClick:()=>planUngroupSuperset(bDayIdx,i,planPartnerIdx)
                    }, "\u2715 Ungroup")
                  ),
                  renderPlanSsSection(ex, bDayIdx, i, exData, "A", "plan_"+bDayIdx+"_"+i+"_a"),
                  renderPlanSsSection(planPartnerEx, bDayIdx, planPartnerIdx, planPartnerExD, "B", "plan_"+bDayIdx+"_"+i+"_b")
                );
              }
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
                React.createElement(React.Fragment, {key:bDayIdx+'_'+i+'_'+ex.exId},
                i===minSsCheckedPlan && ssCheckedPlan.size>0 && React.createElement('div',{className:"ss-action-bar",style:{marginBottom:8}},
                  React.createElement('span',{className:"ss-action-text"}, ssCheckedPlan.size+" selected"),
                  ssCheckedPlan.size===2 && React.createElement('button',{className:"ss-action-btn",onClick:()=>{
                    const [a,b]=[...ssCheckedPlan]; planGroupSuperset(bDayIdx,a,b);
                  }},"\uD83D\uDD17 Group as Superset"),
                  React.createElement('button',{className:"ss-action-cancel",onClick:()=>setSsCheckedPlan(new Set())},"\u2715")
                ),
                React.createElement('div', { className: `builder-ex-row ${dragPlanExIdx===i?"dragging":""}`,
                  style: {flexDirection:"column",alignItems:"stretch",gap:0,opacity:dragPlanExIdx===i?0.5:1,"--cat-color":catColorPlan},
                  draggable: true,
                  onDragStart: e=>{e.dataTransfer.effectAllowed="move";setDragPlanExIdx(i);},
                  onDragOver: e=>{e.preventDefault();e.dataTransfer.dropEffect="move";},
                  onDrop: e=>{e.preventDefault();reorderPlanEx(bDayIdx,dragPlanExIdx,i);setDragPlanExIdx(null);},
                  onDragEnd: ()=>setDragPlanExIdx(null)}
                  /* Header row */
                  , (()=>{
                    const collapsed=!!collapsedPlanEx[`${bDayIdx}_${i}`];
                    return (
                      React.createElement(React.Fragment, null
                        , React.createElement('div', { className:"wb-ex-hdr", style: {display:"flex",alignItems:"center",gap:4,marginBottom:collapsed?0:8,cursor:"pointer"},
                            onClick:()=>togglePlanEx(bDayIdx,i)}
                          , React.createElement('div', { style: {display:"flex",flexDirection:"column",gap:2,flexShrink:0}}
                            , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {padding:"2px 5px",fontSize:".65rem",lineHeight:1,minWidth:0,opacity:i===0?.3:1}, disabled: i===0, onClick: e=>{e.stopPropagation();startTransition(()=>{const nd=bDays.map((d,di)=>{if(di!==bDayIdx)return d;const exs=[...d.exercises];const[m]=exs.splice(i,1);exs.splice(i-1,0,m);return{...d,exercises:exs};});setBDays(nd);});}}, "\u25B2")
                            , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {padding:"2px 5px",fontSize:".65rem",lineHeight:1,minWidth:0,opacity:i===_optionalChain([bDays, 'access', _28 => _28[bDayIdx], 'optionalAccess', _29 => _29.exercises, 'access', _30 => _30.length])-1?.3:1}, disabled: i===_optionalChain([bDays, 'access', _31 => _31[bDayIdx], 'optionalAccess', _32 => _32.exercises, 'access', _33 => _33.length])-1, onClick: e=>{e.stopPropagation();startTransition(()=>{const nd=bDays.map((d,di)=>{if(di!==bDayIdx)return d;const exs=[...d.exercises];const[m]=exs.splice(i,1);exs.splice(i+1,0,m);return{...d,exercises:exs};});setBDays(nd);});}}, "\u25BC")
                          )
                          , ex.supersetWith==null && planExs.filter(e=>!e.supersetWith).length>=2 && React.createElement('div', {
                              style:{display:"flex",alignItems:"center",gap:4,cursor:"pointer",flexShrink:0},
                              title:"Select for superset",
                              onClick:e=>{e.stopPropagation();setSsCheckedPlan(prev=>{const n=new Set(prev);if(n.has(i))n.delete(i);else{if(n.size>=2){const oldest=[...n][0];n.delete(oldest);}n.add(i);}return n;});}
                            },
                              React.createElement('div', {className:`ss-cb ${ssCheckedPlan.has(i)?"on":""}`}),
                              React.createElement('span', {style:{fontSize:".55rem",color:ssCheckedPlan.has(i)?"#b0b8c0":"#8a8f96",fontWeight:600,letterSpacing:".03em",userSelect:"none"}}, "Superset")
                            )
                          , React.createElement('span', { style: {cursor:"grab",color:"#5a5650",fontSize:".9rem",marginRight:2}}, "\u2807")
                          , exData.custom&&React.createElement('div', { className: "ex-edit-btn", style: {position:"static",marginRight:2}, onClick: e=>{e.stopPropagation();onOpenExEditor("edit",exData);}}, "\u270E")
                          , React.createElement('div', { className: "builder-ex-orb", style: {"--cat-color":catColorPlan} }, exData.icon)
                          , React.createElement('span', { className: "builder-ex-name-styled", style: {flex:1} }, exData.name)
                          , (isRunningEx&&pbDisp||exPBDisp3)&&React.createElement('span', { style: {fontSize:".58rem",color:"#b4ac9e",flexShrink:0} }, "\uD83C\uDFC6 ", isRunningEx&&pbDisp?pbDisp:exPBDisp3)
                          , collapsed&&React.createElement('span', { style: {fontSize:".6rem",color:"#5a5650"}}, noSetsEx?"":ex.sets+"\u00D7", ex.reps, ex.weightLbs?` \u00B7 ${bMetric?lbsToKg(ex.weightLbs):ex.weightLbs}${bWUnit}`:"")
                          , React.createElement('span', { style: {fontSize:".63rem",color:"#b4ac9e",minWidth:36,textAlign:"right"}}, "+"+(wizardExXPs[i]||0).toLocaleString())
                          , React.createElement('span', { style: {fontSize:".6rem",color:"#5a5650",transition:"transform .2s",transform:collapsed?"rotate(0deg)":"rotate(180deg)",flexShrink:0,lineHeight:1}}, "\u25BC")
                          , React.createElement('button', { className: "btn btn-danger btn-xs"  , style: {marginLeft:2}, onClick: e=>{e.stopPropagation();removeExFromDay(bDayIdx,i);}}, "\u2715")
                        )
                        , !collapsed&&React.createElement(React.Fragment, null
                          /* Top row: Sets+Reps+Weight or Duration+Sec+Dist */
                          , React.createElement('div', { style: {display:"flex",gap:6,marginBottom:6}}
                            , !noSetsEx&&!hasDur&&React.createElement('div', { style: {flex:1,minWidth:0}}
                              , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Sets")
                              , React.createElement('input', { className: "builder-ex-input", style: {width:"100%"}, type: "text", inputMode: "decimal",
                                defaultValue: ex.sets===0||ex.sets===""?"":ex.sets, onBlur: e=>updateExInDay(bDayIdx,i,"sets",e.target.value)})
                            )
                            , hasDur ? (React.createElement(React.Fragment, null
                              , React.createElement('div', { style: {flex:1.6,minWidth:0}}
                                , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Duration")
                                , React.createElement('input', { className: "builder-ex-input", style: {width:"100%"}, type: "text", inputMode: "numeric",
                                  defaultValue: ex._durHHMM!==undefined ? ex._durHHMM : (ex.durationSec ? secToHHMMSplit(ex.durationSec).hhmm : ex.reps?"00:"+String(ex.reps).padStart(2,"0"):""),
                                  onBlur: e=>{
                                    const norm=normalizeHHMM(e.target.value);
                                    const sec=combineHHMMSec(norm,ex._durSec||"");
                                    const batch={_durHHMM:norm||undefined,durationSec:sec};
                                    if(sec) batch.reps=Math.max(1,Math.floor(sec/60));
                                    if(sec) batch.durationMin=sec/60;
                                    updateExInDayBatch(bDayIdx,i,batch);
                                  },
                                  placeholder: "00:00"})
                              )
                              , React.createElement('div', { style: {flex:0.8,minWidth:0}}
                                , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Sec")
                                , React.createElement('input', { className: "builder-ex-input", style: {width:"100%",textAlign:"center"}, type: "number", min: "0", max: "59",
                                  defaultValue: ex._durSec!==undefined ? String(ex._durSec).padStart(2,"0") : (ex.durationSec ? String(secToHHMMSplit(ex.durationSec).sec).padStart(2,"0") : ""),
                                  onBlur: e=>{
                                    const v=e.target.value;
                                    const sec=combineHHMMSec(ex._durHHMM||"",v);
                                    const batch={_durSec:v,durationSec:sec};
                                    if(sec) batch.reps=Math.max(1,Math.floor(sec/60));
                                    updateExInDayBatch(bDayIdx,i,batch);
                                  },
                                  placeholder: "00"})
                              )
                              , React.createElement('div', { style: {flex:1.2,minWidth:0}}
                                , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Dist (" , bMetric?"km":"mi", ")")
                                , React.createElement('input', { className: "builder-ex-input", style: {width:"100%"}, type: "text", inputMode: "decimal",
                                  defaultValue: dispDist, placeholder: "0",
                                  onBlur: e=>{const v=e.target.value;const mi=v&&bMetric?kmToMi(v):v;updateExInDay(bDayIdx,i,"distanceMi",mi||null);}})
                              )
                            )) : (
                              React.createElement(React.Fragment, null
                                , React.createElement('div', { style: {flex:1,minWidth:0}}
                                  , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Reps")
                                  , React.createElement('input', { className: "builder-ex-input", style: {width:"100%"}, type: "text", inputMode: "decimal",
                                    defaultValue: dispReps===0||dispReps===""?"":dispReps, onBlur: e=>updateExInDay(bDayIdx,i,"reps",e.target.value)})
                                )
                                , hasWeight&&(
                                  React.createElement('div', { style: {flex:1.2,minWidth:0}}
                                    , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, bWUnit)
                                    , React.createElement('input', { className: "builder-ex-input", style: {width:"100%"}, type: "text", inputMode: "decimal", step: bMetric?"0.5":"2.5",
                                      defaultValue: dispW, placeholder: "\u2014",
                                      onBlur: e=>{const v=e.target.value;const lbs=v&&bMetric?kgToLbs(v):v;updateExInDay(bDayIdx,i,"weightLbs",lbs||null);}})
                                  )
                                )
                              )
                            )
                          )
                          , isRunningEx&&runBoostPct>0&&(
                            React.createElement('div', { style: {fontSize:".65rem",color:"#FFE87C",marginBottom:5}}, "\u26A1 +" , runBoostPct, "% pace bonus"  , runBoostPct===20?" (sub-8 mi!)":"")
                          )
                          /* Treadmill controls */
                          , hasDur&&exData.hasTreadmill&&(
                            React.createElement('div', { style: {marginBottom:6}}
                              , React.createElement('div', { style: {display:"flex",gap:8}}
                                , React.createElement('div', { style: {flex:1}}
                                  , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Incline " , React.createElement('span', { style: {opacity:.6,fontSize:".55rem"}}, "(0.5\u201315)"))
                                  , React.createElement('input', { className: "builder-ex-input", style: {width:"100%"}, type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "\u2014", defaultValue: ex.incline||"", onBlur: e=>updateExInDay(bDayIdx,i,"incline",e.target.value?parseFloat(e.target.value):null)})
                                )
                                , React.createElement('div', { style: {flex:1}}
                                  , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Speed " , React.createElement('span', { style: {opacity:.6,fontSize:".55rem"}}, "(0.5\u201315)"))
                                  , React.createElement('input', { className: "builder-ex-input", style: {width:"100%"}, type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "\u2014", defaultValue: ex.speed||"", onBlur: e=>updateExInDay(bDayIdx,i,"speed",e.target.value?parseFloat(e.target.value):null)})
                                )
                              )
                            )
                          )
                          /* Intervals toggle -- all cardio */
                          , hasDur&&(
                            React.createElement('button', { className: "btn btn-sm" , style: {width:"100%",marginBottom:8,padding:"8px 12px",fontSize:".68rem",fontFamily:"'Inter',sans-serif",
                              background:ex.intervals?"rgba(45,42,36,.3)":"rgba(45,42,36,.15)",
                              border:`1.5px solid ${ex.intervals?"rgba(180,172,158,.18)":"rgba(180,172,158,.06)"}`,
                              color:ex.intervals?"#b4ac9e":"#5a5650",borderRadius:8,cursor:"pointer",transition:"all .2s"},
                              onClick: ()=>updateExInDay(bDayIdx,i,"intervals",!ex.intervals)}, "\u26A1 Intervals "
                                , ex.intervals?"ON \u00B7 +25% XP":"OFF"
                            )
                          )
                          /* Extra interval/set rows */
                          , (ex.extraRows||[]).map((row,ri)=>(
                            React.createElement('div', { key: ri, style: {display:"flex",gap:4,marginTop:4,padding:"6px 8px",background:"rgba(45,42,36,.18)",borderRadius:6,alignItems:"center",flexWrap:"wrap"}}
                              , React.createElement('span', { style: {fontSize:".58rem",color:"#9a8a78",flexShrink:0,minWidth:18}}, hasDur?`I${ri+2}`:`S${ri+2}`)
                              , !hasDur&&!noSetsEx&&React.createElement('input', { className: "builder-ex-input", style: {flex:1,minWidth:40,fontSize:".7rem"}, type: "text", inputMode: "decimal", placeholder: "Sets", defaultValue: row.sets||"", onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],sets:e.target.value};updateExInDay(bDayIdx,i,"extraRows",rr);}})
                              , React.createElement('input', { className: "builder-ex-input", style: {flex:1.5,minWidth:52,fontSize:".7rem"}, type: "text", inputMode: "numeric", placeholder: "HH:MM",
                                defaultValue: row.hhmm||"",
                                onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],hhmm:normalizeHHMM(e.target.value)};updateExInDay(bDayIdx,i,"extraRows",rr);}})
                              , React.createElement('input', { className: "builder-ex-input", style: {flex:0.8,minWidth:34,fontSize:".7rem"}, type: "number", min: "0", max: "59", placeholder: "Sec", defaultValue: row.sec||"", onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],sec:e.target.value};updateExInDay(bDayIdx,i,"extraRows",rr);}})
                              , hasDur&&React.createElement('input', { className: "builder-ex-input", style: {flex:1,minWidth:38,fontSize:".7rem"}, type: "text", inputMode: "decimal", placeholder: bMetric?"km":"mi", defaultValue: row.distanceMi||"", onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],distanceMi:e.target.value};updateExInDay(bDayIdx,i,"extraRows",rr);}})
                              , hasDur&&exData.hasTreadmill&&React.createElement('input', { className: "builder-ex-input", style: {flex:0.8,minWidth:34,fontSize:".7rem"}, type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "Inc", defaultValue: row.incline||"", onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],incline:e.target.value};updateExInDay(bDayIdx,i,"extraRows",rr);}})
                              , hasDur&&exData.hasTreadmill&&React.createElement('input', { className: "builder-ex-input", style: {flex:0.8,minWidth:34,fontSize:".7rem"}, type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "Spd", defaultValue: row.speed||"", onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],speed:e.target.value};updateExInDay(bDayIdx,i,"extraRows",rr);}})
                              , hasWeight&&React.createElement('input', { className: "builder-ex-input", style: {flex:1,minWidth:38,fontSize:".7rem"}, type: "text", inputMode: "decimal", placeholder: bWUnit, defaultValue: row.weightLbs||"", onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],weightLbs:e.target.value||null};updateExInDay(bDayIdx,i,"extraRows",rr);}})
                              , React.createElement('button', { className: "btn btn-danger btn-xs"  , style: {padding:"2px 5px",flexShrink:0}, onClick: ()=>{const rr=(ex.extraRows||[]).filter((_,j)=>j!==ri);updateExInDay(bDayIdx,i,"extraRows",rr);}}, "\u2715")
                            )
                          ))
                          , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {width:"100%",marginTop:4,marginBottom:8,fontSize:".6rem",color:"#8a8478",borderStyle:"dashed"},
                            onClick: ()=>{const rr=[...(ex.extraRows||[]),hasDur?{hhmm:"",sec:"",distanceMi:"",incline:"",speed:""}:{sets:ex.sets||"",reps:ex.reps||"",weightLbs:ex.weightLbs||""}];updateExInDay(bDayIdx,i,"extraRows",rr);}}, "\uFF0B Add Row (e.g. "
                                , hasDur?"interval":"progressive weight", ")"
                          )
                          /* Avg HR Zone -- last for cardio */
                          , hasDur&&(
                            React.createElement('div', null
                              , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:4,display:"block"}}, "Avg Heart Rate Zone "    , React.createElement('span', { style: {opacity:.6,fontSize:".55rem"}}, "(optional)"))
                              , React.createElement('div', { className: "hr-zone-row"}
                                , HR_ZONES.map(z=>{
                                  const sel=ex.hrZone===z.z;
                                  const range=hrRange(age,z);
                                  return (
                                    React.createElement('div', { key: z.z, className: `hr-zone-btn ${sel?"sel":""}`,
                                      style: {"--zc":z.color,borderColor:sel?z.color:"rgba(45,42,36,.2)",background:sel?`${z.color}22`:"rgba(45,42,36,.12)"},
                                      onClick: ()=>updateExInDay(bDayIdx,i,"hrZone",sel?null:z.z)}
                                      , React.createElement('span', { className: "hz-name", style: {color:sel?z.color:"#5a5650"}}, "Z", z.z, " " , z.name)
                                      , React.createElement('span', { className: "hz-bpm", style: {color:sel?z.color:"#6a645a"}}, range.lo, "\u2013", range.hi)
                                    )
                                  );
                                })
                              )
                              , ex.hrZone&&React.createElement('div', { style: {fontSize:".65rem",color:"#8a8478",fontStyle:"italic",marginTop:4}}, HR_ZONES[ex.hrZone-1].desc)
                            )
                          )
                        )
                      )
                    );
                  })()
                )
              ));
            });})()
            , bEditId && React.createElement('button', { className:"btn btn-glass-yellow", style:{width:"100%",marginTop:8},
              onClick:()=>{
                const plan=(profile.plans||[]).find(p=>p.id===bEditId); if(!plan) return;
                const currentDay=bDays[bDayIdx]; if(!currentDay) return;
                const synth={name:currentDay.label||"Day",icon:bIcon||"\uD83D\uDCCB",exercises:currentDay.exercises,
                  durationMin:currentDay.durationMin||null,activeCal:currentDay.activeCal||null,totalCal:currentDay.totalCal||null};
                if(onCompleteDayStart) {
                  onCompleteDayStart(synth, (woWithStats) => {
                    onStartPlanWorkout({...plan,days:[{...currentDay,durationMin:woWithStats.durationMin,activeCal:woWithStats.activeCal,totalCal:woWithStats.totalCal}]});
                  });
                }
              }}, "\u2713 Complete Day")
            , React.createElement('div', { className: "div", style: {margin:"3px 0"}})
            , React.createElement('button', { className: "btn btn-gold" , style: {width:"100%"}, onClick: saveBuiltPlan}, "\uD83D\uDCBE Save Plan"  )
          ) /* close wizard-day-editor */
        ) /* close plan-wizard-inner */
      ) /* close plan-wizard-backdrop */
    , document.body) /* close planWizardOpen portal */

    // ── 3. WORKOUT PICKER PORTAL ──
    , bWoPickerOpen && createPortal(
      React.createElement('div', { className: "ex-picker-backdrop", onClick: e=>{e.stopPropagation();setBWoPickerOpen(false);}}
        , React.createElement('div', { className: "ex-picker-sheet", onClick: e=>e.stopPropagation()}
          , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}
            , React.createElement('div', { className: "sec", style: {margin:0,border:"none",padding:0}}, "Add Workout to Day"   )
            , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setBWoPickerOpen(false)}, "\u2715")
          )
          , profile.workouts&&profile.workouts.length>0 ? profile.workouts.map(wo=>(
            React.createElement('div', { key: wo.id, className: "ex-pick-item", style: {marginBottom:6,flexDirection:"column",alignItems:"flex-start",gap:4},
              onClick: ()=>{
                const newExs = wo.exercises.map(e=>({
                  exId:e.exId, sets:e.sets||3, reps:e.reps||10,
                  weightLbs:e.weightLbs||null, durationMin:e.durationMin||null,
                  distanceMi:null, hrZone:null, weightPct:100,
                }));
                startTransition(()=>{setBDays(days=>days.map((d,i)=>i!==bDayIdx?d:{...d,exercises:[...d.exercises,...newExs]}));});
                setBWoPickerOpen(false);
                showToast(wo.icon+" "+wo.name+" exercises added!");
              }}
              , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:8,width:"100%"}}
                , React.createElement('span', { style: {fontSize:"1.3rem"}}, wo.icon)
                , React.createElement('div', { style: {flex:1}}
                  , React.createElement('div', { className: "ex-pick-name"}, wo.name)
                  , React.createElement('div', { className: "ex-pick-xp"}, wo.exercises.length, " exercise" , wo.exercises.length!==1?"s":"")
                )
              )
            )
          )) : (
            React.createElement('div', { className: "empty", style: {padding:"20px 0"}}, "No saved workouts yet. Build one in the \uD83D\uDCAA Work tab first."           )
          )
        )
      )
    , document.body)

    // ── 4. EXERCISE PICKER PORTAL ──
    , exPickerOpen && createPortal(
      React.createElement('div', { className: "ex-picker-backdrop", onClick: e=>{e.stopPropagation();if(!pickerConfigOpen)closePicker();}}
        , React.createElement('div', { className: "ex-picker-sheet", onClick: e=>e.stopPropagation(), style: {maxHeight:"85vh"}}
          , !pickerConfigOpen ? React.createElement(React.Fragment, null
                          /* -- BROWSE VIEW -- */
            , React.createElement('div', {style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}
              , React.createElement('div', {style:{fontFamily:"'Inter',sans-serif",fontSize:".72rem",fontWeight:600,color:"#8a8478"}},
                  "Add to Plan", pickerSelected.length>0&&React.createElement('span',{style:{color:"#b4ac9e",marginLeft:6}},pickerSelected.length+" selected"))
              , React.createElement('div', {style:{display:"flex",gap:6}},
                  pickerSelected.length>0&&React.createElement('button',{className:"btn btn-gold btn-xs",onClick:()=>setPickerConfigOpen(true)},"Configure & Add \u2192"),
                  React.createElement('button',{className:"btn btn-ghost btn-xs",onClick:()=>{closePicker();if(onOpenExEditor)onOpenExEditor("create",null);}},"\u2726 New Custom"),
                  React.createElement('button',{className:"btn btn-ghost btn-sm",onClick:closePicker},"\u2715")
              )
            )
            , React.createElement('div', {style:{marginBottom:8}},
              React.createElement('input', {className:"inp",style:{width:"100%",padding:"7px 11px",fontSize:".82rem"},
                placeholder:"Search exercises\u2026", value:pickerSearchDisplay,
                onChange:e=>{setPickerSearchDisplay(e.target.value);debouncedSetSearch(e.target.value);}, autoFocus:true})
            )
            , (()=>{
              const PTYPE_LABELS2={strength:"\u2694\uFE0F Strength",cardio:"\uD83C\uDFC3 Cardio",flexibility:"\uD83E\uDDD8 Flex",yoga:"\uD83E\uDDD8 Yoga",stretching:"\uD83C\uDF3F Stretch",plyometric:"\u26A1 Plyo",calisthenics:"\uD83E\uDD38 Cali"};
              const PTYPE_OPTS2=Object.keys(PTYPE_LABELS2);
              const PEQUIP_OPTS2=["barbell","dumbbell","kettlebell","cable","machine","bodyweight","band"];
              const PMUSCLE_OPTS2=["chest","back","shoulder","bicep","legs","glutes","abs","calves","forearm","cardio"];
              const closeDrops2=()=>setPickerOpenDrop(null);
              return React.createElement('div',{style:{position:"relative",marginBottom:10}},
                pickerOpenDrop&&React.createElement('div',{onClick:closeDrops2,style:{position:"fixed",inset:0,zIndex:19}}),
                React.createElement('div',{style:{display:"flex",gap:7}},
                  React.createElement('div',{style:{position:"relative",flex:1,zIndex:20}},
                    React.createElement('button',{onClick:()=>setPickerOpenDrop(d=>d==="muscle2"?null:"muscle2"),style:{width:"100%",padding:"6px 24px 6px 9px",borderRadius:8,border:"1px solid "+(pickerMuscle!=="All"?"#b4ac9e":"rgba(45,42,36,.3)"),background:"rgba(14,14,12,.95)",color:pickerMuscle!=="All"?"#b4ac9e":"#8a8478",fontSize:".68rem",textAlign:"left",cursor:"pointer",position:"relative"}},
                      pickerMuscle==="All"?"Muscle":pickerMuscle.charAt(0).toUpperCase()+pickerMuscle.slice(1),
                      React.createElement('span',{style:{position:"absolute",right:7,top:"50%",transform:"translateY(-50%) rotate("+(pickerOpenDrop==="muscle2"?"180deg":"0deg")+")",fontSize:".55rem",color:pickerMuscle!=="All"?"#b4ac9e":"#5a5650",transition:"transform .15s"}},"\u25BC")),
                    pickerOpenDrop==="muscle2"&&React.createElement('div',{style:{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:"100%",background:"rgba(16,14,10,.95)",border:"1px solid rgba(180,172,158,.06)",borderRadius:8,padding:"5px 3px",zIndex:21,boxShadow:"0 8px 24px rgba(0,0,0,.7)"}},
                      React.createElement('div',{onClick:()=>{setPickerMuscle("All");closeDrops2();},style:{padding:"6px 10px",fontSize:".72rem",cursor:"pointer",borderRadius:5,color:pickerMuscle==="All"?"#b4ac9e":"#8a8478",background:pickerMuscle==="All"?"rgba(45,42,36,.2)":"transparent"}},"All Muscles"),
                      PMUSCLE_OPTS2.map(m=>React.createElement('div',{key:m,onClick:()=>{setPickerMuscle(m);closeDrops2();},style:{padding:"6px 10px",fontSize:".72rem",cursor:"pointer",borderRadius:5,color:pickerMuscle===m?getMuscleColor(m):"#8a8478",background:pickerMuscle===m?"rgba(45,42,36,.2)":"transparent",textTransform:"capitalize"}},m)))
                  ),
                  React.createElement('div',{style:{position:"relative",flex:1,zIndex:20}},
                    React.createElement('button',{onClick:()=>setPickerOpenDrop(d=>d==="type2"?null:"type2"),style:{width:"100%",padding:"6px 24px 6px 9px",borderRadius:8,border:"1px solid "+(pickerTypeFilter!=="all"?"#d4cec4":"rgba(45,42,36,.3)"),background:"rgba(14,14,12,.95)",color:pickerTypeFilter!=="all"?"#d4cec4":"#8a8478",fontSize:".68rem",textAlign:"left",cursor:"pointer",position:"relative"}},
                      pickerTypeFilter==="all"?"Type":(PTYPE_LABELS2[pickerTypeFilter]||pickerTypeFilter),
                      React.createElement('span',{style:{position:"absolute",right:7,top:"50%",transform:"translateY(-50%) rotate("+(pickerOpenDrop==="type2"?"180deg":"0deg")+")",fontSize:".55rem",color:pickerTypeFilter!=="all"?"#d4cec4":"#5a5650",transition:"transform .15s"}},"\u25BC")),
                    pickerOpenDrop==="type2"&&React.createElement('div',{style:{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:"100%",background:"rgba(16,14,10,.95)",border:"1px solid rgba(180,172,158,.06)",borderRadius:8,padding:"5px 3px",zIndex:21,boxShadow:"0 8px 24px rgba(0,0,0,.7)"}},
                      React.createElement('div',{onClick:()=>{setPickerTypeFilter("all");closeDrops2();},style:{padding:"6px 10px",fontSize:".72rem",cursor:"pointer",borderRadius:5,color:pickerTypeFilter==="all"?"#d4cec4":"#8a8478",background:pickerTypeFilter==="all"?"rgba(45,42,36,.2)":"transparent"}},"All Types"),
                      PTYPE_OPTS2.map(t=>React.createElement('div',{key:t,onClick:()=>{setPickerTypeFilter(t);closeDrops2();},style:{padding:"6px 10px",fontSize:".72rem",cursor:"pointer",borderRadius:5,color:pickerTypeFilter===t?getTypeColor(t):"#8a8478",background:pickerTypeFilter===t?"rgba(45,42,36,.2)":"transparent"}},PTYPE_LABELS2[t])))
                  ),
                  React.createElement('div',{style:{position:"relative",flex:1,zIndex:20}},
                    React.createElement('button',{onClick:()=>setPickerOpenDrop(d=>d==="equip2"?null:"equip2"),style:{width:"100%",padding:"6px 24px 6px 9px",borderRadius:8,border:"1px solid "+(pickerEquipFilter!=="all"?"#9b59b6":"rgba(45,42,36,.3)"),background:"rgba(14,14,12,.95)",color:pickerEquipFilter!=="all"?"#9b59b6":"#8a8478",fontSize:".68rem",textAlign:"left",cursor:"pointer",position:"relative"}},
                      pickerEquipFilter==="all"?"Equipment":pickerEquipFilter.charAt(0).toUpperCase()+pickerEquipFilter.slice(1),
                      React.createElement('span',{style:{position:"absolute",right:7,top:"50%",transform:"translateY(-50%) rotate("+(pickerOpenDrop==="equip2"?"180deg":"0deg")+")",fontSize:".55rem",color:pickerEquipFilter!=="all"?"#9b59b6":"#5a5650",transition:"transform .15s"}},"\u25BC")),
                    pickerOpenDrop==="equip2"&&React.createElement('div',{style:{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:"100%",background:"rgba(16,14,10,.95)",border:"1px solid rgba(180,172,158,.06)",borderRadius:8,padding:"5px 3px",zIndex:21,boxShadow:"0 8px 24px rgba(0,0,0,.7)"}},
                      React.createElement('div',{onClick:()=>{setPickerEquipFilter("all");closeDrops2();},style:{padding:"6px 10px",fontSize:".72rem",cursor:"pointer",borderRadius:5,color:pickerEquipFilter==="all"?"#9b59b6":"#8a8478",background:pickerEquipFilter==="all"?"rgba(155,89,182,.12)":"transparent"}},"All Equipment"),
                      PEQUIP_OPTS2.map(e=>React.createElement('div',{key:e,onClick:()=>{setPickerEquipFilter(e);closeDrops2();},style:{padding:"6px 10px",fontSize:".72rem",cursor:"pointer",borderRadius:5,color:pickerEquipFilter===e?"#9b59b6":"#8a8478",background:pickerEquipFilter===e?"rgba(155,89,182,.12)":"transparent",textTransform:"capitalize"}},e)))
                  )
                )
              );
            })()
            , (()=>{
              const filtered=filteredExercises;
              if(filtered.length===0) return React.createElement('div',{className:"empty",style:{padding:"20px 0"}},"No exercises found.");
              const q=pickerSearch.trim();
              const selIds=new Set(pickerSelected.map(e=>e.exId));
              const visible=filtered.slice(0,80);
              return React.createElement(React.Fragment,null,
                React.createElement('div',{style:{fontSize:".62rem",color:"#5a5650",marginBottom:6,textAlign:"right"}},
                  (q||pickerMuscle!=="All"||pickerTypeFilter!=="all"||pickerEquipFilter!=="all")?filtered.length+" match"+(filtered.length!==1?"es":""):"Showing 80 of "+filtered.length+" \u00B7 search or filter"),
                React.createElement('div',{style:{display:"flex",flexDirection:"column",gap:5}},
                  visible.map(ex=>{
                    const sel=selIds.has(ex.id);
                    const diffLabel=ex.difficulty||(ex.baseXP>=60?"Advanced":ex.baseXP>=45?"Intermediate":"Beginner");
                    const diffColor=diffLabel==="Advanced"?"#7A2838":diffLabel==="Beginner"?"#5A8A58":"#A8843C";
                    const diffBg=diffLabel==="Advanced"?"#2e1515":diffLabel==="Beginner"?"#1a2e1a":"#2e2010";
                    const subParts=[ex.category?ex.category.charAt(0).toUpperCase()+ex.category.slice(1):null,ex.muscleGroup?ex.muscleGroup.charAt(0).toUpperCase()+ex.muscleGroup.slice(1):null].filter(Boolean).join(" \u00B7 ");
                    return React.createElement('div',{key:ex.id,onClick:()=>pickerToggleEx(ex.id),style:{background:sel?"rgba(45,42,36,.25)":"linear-gradient(145deg,rgba(45,42,36,.35),rgba(32,30,26,.2))",border:"1px solid "+(sel?"rgba(180,172,158,.35)":"rgba(180,172,158,.05)"),borderRadius:9,padding:"9px 12px",display:"flex",alignItems:"center",gap:11,cursor:"pointer",boxShadow:sel?"0 0 0 1.5px rgba(180,172,158,.3),0 3px 14px rgba(180,172,158,.06)":"none",transition:"all .15s"}},
                      React.createElement('div',{style:{width:30,height:30,borderRadius:7,flexShrink:0,background:"rgba(45,42,36,.15)",border:"1px solid rgba(180,172,158,.05)",display:"flex",alignItems:"center",justifyContent:"center"}},React.createElement(ExIcon,{ex:ex,size:".9rem",color:getTypeColor(ex.category)})),
                      React.createElement('div',{style:{flex:1,minWidth:0}},
                        React.createElement('div',{style:{fontSize:".8rem",fontWeight:600,color:sel?"#d4cec4":"#d4cec4",marginBottom:2}},ex.name,ex.custom&&React.createElement('span',{className:"custom-ex-badge",style:{marginLeft:4}},"custom")),
                        React.createElement('div',{style:{fontSize:".6rem",fontStyle:"italic"}}, ex.category&&React.createElement('span',{style:{color:getTypeColor(ex.category)}},ex.category.charAt(0).toUpperCase()+ex.category.slice(1)), ex.category&&ex.muscleGroup&&React.createElement('span',{style:{color:"#5a5650"}}," \u00B7 "), ex.muscleGroup&&React.createElement('span',{style:{color:getMuscleColor(ex.muscleGroup)}},ex.muscleGroup.charAt(0).toUpperCase()+ex.muscleGroup.slice(1)))),
                      React.createElement('div',{style:{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}},
                        React.createElement('span',{style:{fontSize:".63rem",fontWeight:700,color:"#b4ac9e"}},ex.baseXP+" XP"),
                        React.createElement('span',{style:{fontSize:".56rem",fontWeight:700,color:diffColor,background:diffBg,padding:"1px 6px",borderRadius:3,letterSpacing:".04em"}},diffLabel))
                    );
                  })
                )
              );
            })()
          ) : React.createElement(React.Fragment, null
            /* -- CONFIG VIEW -- */
            , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}
              , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setPickerConfigOpen(false)}, "\u2190 Back" )
              , React.createElement('div', { className: "sec", style: {margin:0,border:"none",padding:0}}, "Configure " , pickerSelected.length, " Exercise" , pickerSelected.length!==1?"s":"")
              , React.createElement('button', { className: "btn btn-gold btn-sm"  , onClick: commitPickerToPlan}, "Add to Plan \u2713"   )
            )
            , pickerSelected.map((entry,idx)=>{
              const ex=allExById[entry.exId]; if(!ex) return null;
              const isCardio=ex.category==="cardio"||ex.category==="flexibility";
              const isTreadEx=ex.hasTreadmill||false;
              const noSets=NO_SETS_EX_IDS.has(ex.id);
              const metric=isMetric(profile.units);
              const wUnit=weightLabel(profile.units);
              const dUnit=distLabel(profile.units);
              return (
                React.createElement('div', { key: entry.exId, style: {background:"rgba(45,42,36,.12)",border:"1px solid rgba(180,172,158,.05)",borderRadius:10,padding:"10px 12px",marginBottom:8}}
                  , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:8,marginBottom:8}}
                    , React.createElement('span', { style: {fontSize:"1.1rem"}}, ex.icon)
                    , React.createElement('span', { style: {fontSize:".82rem",color:"#d4cec4",flex:1}}, ex.name)
                    , React.createElement('span', { style: {fontSize:".65rem",cursor:"pointer",color:"#e74c3c"}, onClick: ()=>setPickerSelected(p=>p.filter(e=>e.exId!==entry.exId))}, "\u2715")
                  )
                  /* Top row -- category-specific */
                  , React.createElement('div', { style: {display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}
                    , !noSets&&!isCardio&&React.createElement('div', { className: "field", style: {flex:1,minWidth:60,marginBottom:0}}
                      , React.createElement('label', null, "Sets")
                      , React.createElement('input', { className: "inp", style: {padding:"6px 8px"}, type: "text", inputMode: "numeric", value: entry.sets||"", onChange: e=>pickerUpdateEx(entry.exId,"sets",e.target.value), placeholder: "3"})
                    )
                    , isCardio ? (React.createElement(React.Fragment, null
                      , React.createElement('div', { className: "field", style: {flex:1.6,minWidth:70,marginBottom:0}}
                        , React.createElement('label', null, "Duration (HH:MM)" )
                        , React.createElement('input', { className: "inp", style: {padding:"6px 8px"}, type: "text", inputMode: "numeric",
                          value: entry._durHHMM||"",
                          onChange: e=>pickerUpdateEx(entry.exId,"_durHHMM",e.target.value),
                          onBlur: e=>{const n=normalizeHHMM(e.target.value);pickerUpdateEx(entry.exId,"_durHHMM",n);pickerUpdateEx(entry.exId,"reps",String(Math.max(1,Math.floor(combineHHMMSec(n,entry._durSec||"")/60))));},
                          placeholder: "00:00"})
                      )
                      , React.createElement('div', { className: "field", style: {flex:0.8,minWidth:50,marginBottom:0}}
                        , React.createElement('label', null, "Seconds")
                        , React.createElement('input', { className: "inp", style: {padding:"6px 8px",textAlign:"center"}, type: "number", min: "0", max: "59",
                          value: entry._durSec||"",
                          onChange: e=>{pickerUpdateEx(entry.exId,"_durSec",e.target.value);pickerUpdateEx(entry.exId,"reps",String(Math.max(1,Math.floor(combineHHMMSec(entry._durHHMM||"",e.target.value)/60))));},
                          placeholder: "00"})
                      )
                      , React.createElement('div', { className: "field", style: {flex:1,minWidth:60,marginBottom:0}}
                        , React.createElement('label', null, "Dist (" , dUnit, ")")
                        , React.createElement('input', { className: "inp", style: {padding:"6px 8px"}, type: "text", inputMode: "decimal", value: entry.distanceMi||"", onChange: e=>pickerUpdateEx(entry.exId,"distanceMi",e.target.value), placeholder: "0"})
                      )
                    )) : (React.createElement(React.Fragment, null
                      , React.createElement('div', { className: "field", style: {flex:1,minWidth:60,marginBottom:0}}
                        , React.createElement('label', null, "Reps")
                        , React.createElement('input', { className: "inp", style: {padding:"6px 8px"}, type: "text", inputMode: "numeric", value: entry.reps||"", onChange: e=>pickerUpdateEx(entry.exId,"reps",e.target.value), placeholder: "10"})
                      )
                      , React.createElement('div', { className: "field", style: {flex:1,minWidth:60,marginBottom:0}}
                        , React.createElement('label', null, "Weight (" , wUnit, ")")
                        , React.createElement('input', { className: "inp", style: {padding:"6px 8px"}, type: "text", inputMode: "decimal", value: entry.weightLbs||"", onChange: e=>pickerUpdateEx(entry.exId,"weightLbs",e.target.value), placeholder: "0"})
                      )
                    ))
                  )
                  /* Treadmill: Incline + Speed */
                  , isTreadEx&&(
                    React.createElement('div', { style: {display:"flex",gap:6,marginBottom:6}}
                      , React.createElement('div', { className: "field", style: {flex:1,marginBottom:0}}
                        , React.createElement('label', null, "Incline (0.5\u201315)" )
                        , React.createElement('input', { className: "inp", style: {padding:"6px 8px"}, type: "number", min: "0.5", max: "15", step: "0.5", value: entry.incline||"", onChange: e=>pickerUpdateEx(entry.exId,"incline",e.target.value?parseFloat(e.target.value):null), placeholder: "\u2014"})
                      )
                      , React.createElement('div', { className: "field", style: {flex:1,marginBottom:0}}
                        , React.createElement('label', null, "Speed (0.5\u201315)" )
                        , React.createElement('input', { className: "inp", style: {padding:"6px 8px"}, type: "number", min: "0.5", max: "15", step: "0.5", value: entry.speed||"", onChange: e=>pickerUpdateEx(entry.exId,"speed",e.target.value?parseFloat(e.target.value):null), placeholder: "\u2014"})
                      )
                    )
                  )
                  /* +Add Row */
                  , (entry.extraRows||[]).map((row,ri)=>(
                    React.createElement('div', { key: ri, style: {display:"flex",gap:4,marginBottom:4,padding:"5px 7px",background:"rgba(45,42,36,.18)",borderRadius:5,alignItems:"center",flexWrap:"wrap"}}
                      , React.createElement('span', { style: {fontSize:".55rem",color:"#9a8a78",flexShrink:0,minWidth:16}}, isCardio?`I${ri+2}`:`S${ri+2}`)
                      , isCardio ? (React.createElement(React.Fragment, null
                        , React.createElement('input', { className: "inp", style: {flex:1.5,minWidth:50,padding:"4px 7px",fontSize:".72rem"}, type: "text", inputMode: "numeric", placeholder: "HH:MM",
                          value: row.hhmm||"",
                          onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],hhmm:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);},
                          onBlur: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],hhmm:normalizeHHMM(e.target.value)};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                        , React.createElement('input', { className: "inp", style: {flex:0.7,minWidth:36,padding:"4px 7px",fontSize:".72rem"}, type: "number", min: "0", max: "59", placeholder: "Sec", value: row.sec||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],sec:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                        , React.createElement('input', { className: "inp", style: {flex:1,minWidth:40,padding:"4px 7px",fontSize:".72rem"}, type: "text", inputMode: "decimal", placeholder: distLabel(profile.units), value: row.distanceMi||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],distanceMi:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                        , isTreadEx&&React.createElement('input', { className: "inp", style: {flex:0.7,minWidth:34,padding:"4px 7px",fontSize:".72rem"}, type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "Inc", value: row.incline||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],incline:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                        , isTreadEx&&React.createElement('input', { className: "inp", style: {flex:0.7,minWidth:34,padding:"4px 7px",fontSize:".72rem"}, type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "Spd", value: row.speed||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],speed:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                      )) : (React.createElement(React.Fragment, null
                        , !noSets&&React.createElement('input', { className: "inp", style: {flex:1,minWidth:40,padding:"4px 7px",fontSize:".72rem"}, type: "text", inputMode: "decimal", placeholder: "Sets", value: row.sets||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],sets:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                        , React.createElement('input', { className: "inp", style: {flex:1,minWidth:40,padding:"4px 7px",fontSize:".72rem"}, type: "text", inputMode: "decimal", placeholder: "Reps", value: row.reps||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],reps:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                        , React.createElement('input', { className: "inp", style: {flex:1,minWidth:40,padding:"4px 7px",fontSize:".72rem"}, type: "text", inputMode: "decimal", placeholder: wUnit, value: row.weightLbs||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],weightLbs:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                      ))
                      , React.createElement('button', { className: "btn btn-danger btn-xs"  , style: {padding:"2px 4px",flexShrink:0}, onClick: ()=>{const rr=(entry.extraRows||[]).filter((_,j)=>j!==ri);pickerUpdateEx(entry.exId,"extraRows",rr);}}, "\u2715")
                    )
                  ))
                  , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {width:"100%",marginTop:4,fontSize:".6rem",color:"#8a8478",borderStyle:"dashed"},
                    onClick: ()=>{const rr=[...(entry.extraRows||[]),isCardio?{hhmm:"",sec:"",distanceMi:"",incline:"",speed:""}:{sets:"",reps:"",weightLbs:""}];pickerUpdateEx(entry.exId,"extraRows",rr);}}, "\uFF0B Add Row (e.g. "
                        , isCardio?"interval":"progressive set", ")"
                  )
                )
              );
            })
          )
        )
      )
    , document.body)
  ); // end return
}

export default React.memo(PlanWizard, (prev, next) => {
  // Only re-render when data props change; skip callback props (stable by identity)
  return prev.editPlan === next.editPlan
    && prev.templatePlan === next.templatePlan
    && prev.profile === next.profile
    && prev.allExercises === next.allExercises
    && prev.allExById === next.allExById;
});
