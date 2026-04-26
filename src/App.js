import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './styles/app.css';
import { CLASSES, EXERCISES } from './data/exercises';
import { EX_BY_ID, CAT_ICON_COLORS, NAME_ICON_MAP, MUSCLE_ICON_MAP, CAT_ICON_FALLBACK, CLASS_SVG_PATHS, QUESTS, WORKOUT_TEMPLATES, PLAN_TEMPLATES, CHECKIN_REWARDS, KEYWORD_CLASS_MAP, PARTICLES, STORAGE_KEY, EMPTY_PROFILE, NO_SETS_EX_IDS, RUNNING_EX_ID, HR_ZONES, MUSCLE_COLORS, MUSCLE_META, TYPE_COLORS, MAP_REGIONS } from './data/constants';
import { _nullishCoalesce, _optionalChain, uid, clone, todayStr } from './utils/helpers';
import { loadSave, doSave } from './utils/storage';
import { isMetric, lbsToKg, kgToLbs, miToKm, kmToMi, ftInToCm, cmToFtIn, weightLabel, distLabel, displayWt, displayDist, pctToSlider, sliderToPct } from './utils/units';
import { buildXPTable, XP_TABLE, xpToLevel, xpForLevel, xpForNext, calcBMI, detectClassFromAnswers, detectClass, calcExXP, calcPlanXP, calcDayXP, calcExercisePBs, calcDecisionTreeBonus, calcCharStats, checkQuestCompletion, getMuscleColor, getTypeColor, hrRange, scaleWeight, scaleDur } from './utils/xp';
import { secToHMS, HMSToSec, normalizeHHMM, secToHHMMSplit, HHMMToSec, combineHHMMSec } from './utils/time';
import { sb } from './utils/supabase';
import { ensureRestDay } from './utils/ensureRestDay';
import { _exercisesLoaded, loadExercises, useExercises } from './utils/exerciseLibrary';

// ── Debounce utility ──
function debounce(fn, ms) { let id; return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); }; }

// ── Recipe view constants (hoisted from render for perf) ──
const RECIPE_CATS = [...new Set([
  ...WORKOUT_TEMPLATES.map(t=>t.category).filter(Boolean),
  ...WORKOUT_TEMPLATES.map(t=>t.equipment).filter(Boolean),
])].sort();
const DIFF_COLORS = {Beginner:"#2ecc71",Intermediate:"#f1c40f",Advanced:"#e74c3c"};
const EQUIP_ICONS = {Gym:"🏋️","Home Gym":"🏠",Bodyweight:"🤸"};
// Recipe category → themed color (drives --mg-color on themed cards/pills)
// Uses the locked masculine palette from MUSCLE_COLORS
const RECIPE_CAT_COLORS = {
  "Push":"#8B5A2B","Pull":"#2E4D38","Legs":"#5C5C2E","Full Body":"#2C4564",
  "Upper Body":"#6B2A2A","Lower Body":"#5C5C2E","Chest":"#8B5A2B","Back":"#2E4D38",
  "Shoulders":"#3D343F","Arms":"#4A5560","Glutes":"#4F4318","Core":"#2A4347",
  "Abs":"#2A4347","Cardio":"#2C4564","HIIT":"#6B2A2A","Endurance":"#494C56",
  "Flexibility":"#3D343F","Yoga":"#3D343F","Mobility":"#3D343F",
  "Gym":"#4F4318","Home Gym":"#8B5A2B","Bodyweight":"#2E4D38"
};
function getRecipeMgColor(tpl){
  if(!tpl) return "#B0A090";
  return RECIPE_CAT_COLORS[tpl.category] || RECIPE_CAT_COLORS[tpl.equipment] || "#B0A090";
}
// Derive workout color from its most-common muscle group
function getWorkoutMgColor(wo, exById, mgColors){
  if(!wo || !wo.exercises) return "#B0A090";
  const counts = {};
  for(const ex of wo.exercises){
    const exD = exById[ex.exId]; if(!exD) continue;
    const mg = (exD.muscleGroup||"").toLowerCase().trim();
    if(!mg) continue;
    counts[mg] = (counts[mg]||0)+1;
  }
  let top=null, topN=0;
  for(const k in counts){ if(counts[k]>topN){ top=k; topN=counts[k]; } }
  return (top && mgColors[top]) || "#B0A090";
}
import { ExIcon, getExIconName, getExIconColor } from './components/ExIcon';
import { ClassIcon } from './components/ClassIcon';
import { getRegionIdx, getMapPosition, MapSVG } from './components/MapSVG';
import { AvatarPreview3D } from './components/AvatarPreview3D';
import { TrendsTab, DEFAULT_CHART_ORDER } from './components/TrendsTab';
import PlanWizard from './components/PlanWizard';
import WorkoutNotificationMockup from './components/WorkoutNotificationMockup';
import loginBg from './assets/login-bg.png';
import { LandingPage } from './components/LandingPage';

const PREVIEW_PIN = "1234";

// Allowed origins for the password-reset redirect target. Each must also be
// listed in Supabase Dashboard → Authentication → URL Configuration → Redirect URLs.
// Picking the redirect dynamically lets the netlify.app preview / local dev
// receive their own reset links instead of bouncing to the apex.
const ALLOWED_RESET_ORIGINS = [
  "https://aurisargames.com",
  "https://aurisargames.netlify.app",
  "http://localhost:5173",
];
function getResetRedirect() {
  try {
    const o = window.location.origin;
    if (ALLOWED_RESET_ORIGINS.includes(o)) return o;
  } catch (_e) {}
  return "https://aurisargames.com"; // canonical fallback
}

// Password policy. 8+ chars (NIST SP 800-63B rev.4 minimum) plus a 3-of-4
// composition rule (lower / upper / digit / symbol) and a HIBP k-anonymity
// breached-password check. Industry parity with MyFitnessPal / Peloton.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72; // Supabase / bcrypt limit
const PASSWORD_REQUIRED_CLASSES = 3; // out of 4

function _passwordCharClassesPresent(pw) {
  let n = 0;
  if (/[a-z]/.test(pw)) n++;
  if (/[A-Z]/.test(pw)) n++;
  if (/[0-9]/.test(pw)) n++;
  if (/[^A-Za-z0-9]/.test(pw)) n++;
  return n;
}

async function _sha1Hex(input) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function isPasswordBreached(password) {
  // Send only the first 5 chars of the SHA-1 prefix; HIBP returns all matching
  // suffixes. The full hash never leaves the browser.
  try {
    const sha1 = await _sha1Hex(password);
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await fetch("https://api.pwnedpasswords.com/range/" + prefix, {
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) return false; // fail-open if HIBP is unreachable
    const text = await res.text();
    return text.split("\n").some(line => line.split(":")[0].trim() === suffix);
  } catch { return false; }
}

// MFA recovery code helpers. Codes are 80 bits of CSPRNG entropy encoded in
// Crockford-style base32 (no I/L/O/U to avoid confusion). Hashing happens
// server-side via the `store_mfa_recovery_codes` RPC, which is responsible
// for salted/slow hashing — DO NOT pre-hash on the client (it adds nothing
// over TLS and locks salts to the client).
const _BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function _base32Encode(bytes) {
  let bits = 0, value = 0, out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += _BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += _BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function generateRecoveryCode() {
  // 10 bytes = 80 bits of entropy → 16 base32 chars; chunked as XXXX-XXXX-XXXX-XXXX.
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const enc = _base32Encode(bytes);
  return enc.slice(0,4) + "-" + enc.slice(4,8) + "-" + enc.slice(8,12) + "-" + enc.slice(12,16);
}

async function validatePasswordPolicy(password) {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, msg: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, msg: `Password is too long (max ${PASSWORD_MAX_LENGTH} characters).` };
  }
  if (_passwordCharClassesPresent(password) < PASSWORD_REQUIRED_CLASSES) {
    return { ok: false, msg: "Password must include at least 3 of: lowercase, uppercase, number, symbol." };
  }
  if (await isPasswordBreached(password)) {
    return { ok: false, msg: "That password has appeared in a public data breach. Please choose a different one." };
  }
  return { ok: true };
}

const WbExCard = React.memo(function WbExCard({ ex, i, exD, collapsed, profile, allExById, metric, wUnit, setWbExercises, setCollapsedWbEx, setSsChecked, ssChecked, exCount, openExEditor }) {
  function updateField(field, val) { setWbExercises(exs=>exs.map((e,j)=>j!==i?e:{...e,[field]:val})); }
  function removeEx() { setWbExercises(exs=>{const updated=exs.map((e,j)=>{if(j===i)return null;if(e.supersetWith===i)return{...e,supersetWith:null};if(e.supersetWith!=null&&e.supersetWith>i)return{...e,supersetWith:e.supersetWith-1};return e;}).filter(Boolean);return updated;}); }
  function toggleCollapse() { setCollapsedWbEx(s=>({...s,[i]:!s[i]})); }
  function reorder(toIdx) { if(i===toIdx)return; setWbExercises(exs=>{const arr=[...exs];const[moved]=arr.splice(i,1);arr.splice(toIdx,0,moved);const indexMap={};const temp=exs.map((_,idx)=>idx);const[movedIdx]=temp.splice(i,1);temp.splice(toIdx,0,movedIdx);temp.forEach((oldIdx,newIdx)=>{indexMap[oldIdx]=newIdx;});return arr.map(e=>{if(e.supersetWith!=null&&indexMap[e.supersetWith]!=null)return{...e,supersetWith:indexMap[e.supersetWith]};return e;});}); }

  const isC=exD.category==="cardio";
  const isF=exD.category==="flexibility";
  const showW=!isC&&!isF;
  const showHR=isC;
  const isTreadmill=exD.hasTreadmill||false;
  const noSetsEx=NO_SETS_EX_IDS.has(exD.id);
  const isRunningEx=exD.id===RUNNING_EX_ID;
  const age=profile.age||30;
  const dispW=ex.weightLbs?(metric?lbsToKg(ex.weightLbs):ex.weightLbs):"";
  const dispDist=ex.distanceMi?(metric?String(parseFloat(miToKm(ex.distanceMi)).toFixed(2)):String(ex.distanceMi)):"";
  const pbPaceMi=profile.runningPB||null;
  const pbDisp=pbPaceMi?(metric?parseFloat((pbPaceMi*1.60934).toFixed(2))+" min/km":parseFloat(pbPaceMi.toFixed(2))+" min/mi"):null;
  const exPB=(profile.exercisePBs||{})[exD.id]||null;
  const exPBDisp=exPB?(exPB.type==="cardio"?(metric?parseFloat((exPB.value*1.60934).toFixed(2))+" min/km":parseFloat(exPB.value.toFixed(2))+" min/mi"):(exPB.type==="assisted"?"🏆 1RM: "+exPB.value+(metric?" kg":" lbs")+" (Assisted)":"🏆 1RM: "+exPB.value+(metric?" kg":" lbs"))):null;
  const durationMin=parseFloat(ex.reps||0);
  const distMiVal=ex.distanceMi?parseFloat(ex.distanceMi):0;
  const runPace=(isRunningEx&&distMiVal>0&&durationMin>0)?durationMin/distMiVal:null;
  const runBoostPct=runPace?(runPace<=8?20:5):0;
  const mgColor=getMuscleColor(exD.muscleGroup);

  return (
    React.createElement(React.Fragment, null
      , React.createElement('div', { className:"wb-ex-hdr", style: {display:"flex",alignItems:"center",gap:6,marginBottom:collapsed?0:8,
        background:"transparent",cursor:"pointer",borderRadius:0,padding:"0",transition:"all .2s",marginLeft:-4,marginRight:-4},
        onClick:()=>toggleCollapse()}
        , React.createElement('div', { style: {display:"flex",flexDirection:"column",gap:2,flexShrink:0}}
          , React.createElement('button', { className: "btn btn-ghost btn-xs", style: {padding:"2px 5px",fontSize:".65rem",lineHeight:1,minWidth:0,opacity:i===0?.3:1}, disabled: i===0, onClick: e=>{e.stopPropagation();reorder(i-1);}}, "▲")
          , React.createElement('button', { className: "btn btn-ghost btn-xs", style: {padding:"2px 5px",fontSize:".65rem",lineHeight:1,minWidth:0,opacity:i===exCount-1?.3:1}, disabled: i===exCount-1, onClick: e=>{e.stopPropagation();reorder(i+1);}}, "▼")
        )
        , ex.supersetWith==null && exCount>=2 && React.createElement('div', {
            style:{display:"flex",alignItems:"center",gap:4,cursor:"pointer",flexShrink:0},
            title:"Select for superset",
            onClick:e=>{e.stopPropagation();setSsChecked(prev=>{const n=new Set(prev);if(n.has(i))n.delete(i);else{if(n.size>=2){const oldest=[...n][0];n.delete(oldest);}n.add(i);}return n;});}
          },
            React.createElement('div', {className:`ss-cb ${ssChecked.has(i)?"on":""}`}),
            React.createElement('span', {style:{fontSize:".55rem",color:ssChecked.has(i)?"#b0b8c0":"#8a8f96",fontWeight:600,letterSpacing:".03em",userSelect:"none"}}, "Superset")
          )
        , React.createElement('span', { style: {cursor:"grab",color:"#5a5650",fontSize:".9rem",flexShrink:0}}, "⠿")
        , React.createElement('div', { className: "builder-ex-orb", style: {"--mg-color":mgColor} }, React.createElement(ExIcon, {ex:exD, size:".95rem", color:"#d4cec4"}))
        , React.createElement('div', { className: "builder-ex-name-styled"}
          , exD.name
          , exD.custom&&React.createElement('span', { className: "custom-ex-badge", style: {marginLeft:4}}, "custom")
          , exD.custom&&React.createElement('button', { className: "btn btn-ghost btn-xs", style: {marginLeft:6,fontSize:".55rem",padding:"1px 5px"}, onClick: e=>{e.stopPropagation();openExEditor("edit",exD);}}, "✎ edit" )
        )
        , ex.supersetWith && React.createElement('span', {className:"ss-badge"}, "SS")
        , (isRunningEx&&pbDisp||exPBDisp)&&React.createElement('span', { style: {fontSize:".58rem",color:"#b4ac9e",flexShrink:0} }, "🏆 ", isRunningEx&&pbDisp?pbDisp:exPBDisp)
        , collapsed&&exD.id!=="rest_day"&&React.createElement('span', { style: {fontSize:".6rem",color:"#5a5650"}}, noSetsEx?"":ex.sets+"×", ex.reps, ex.weightLbs?` · ${metric?lbsToKg(ex.weightLbs):ex.weightLbs}${wUnit}`:"")
        , React.createElement('span', { style: {fontSize:".63rem",color:"#b4ac9e",flexShrink:0}}, (()=>{const b=calcExXP(ex.exId,noSetsEx?1:ex.sets,ex.reps,profile.chosenClass,allExById,distMiVal||null);const r=(ex.extraRows||[]).reduce((s,row)=>s+calcExXP(ex.exId,parseInt(row.sets)||parseInt(ex.sets)||3,parseInt(row.reps)||parseInt(ex.reps)||10,profile.chosenClass,allExById),0);const t=(isC&&(ex.extraRows||[]).length>0)?Math.round((b+r)*1.25):(b+r);return "+"+t.toLocaleString();})(), runBoostPct>0&&React.createElement('span', { style: {color:"#FFE87C",marginLeft:2}}, "⚡"))
        , React.createElement('span', { style: {fontSize:".6rem",color:"#5a5650",transition:"transform .2s",transform:collapsed?"rotate(0deg)":"rotate(180deg)",flexShrink:0,lineHeight:1}}, "▼")
        , React.createElement('button', { className: "btn btn-danger btn-xs", onClick: e=>{e.stopPropagation();removeEx();}}, "✕")
      )
      , !collapsed&&exD.id!=="rest_day"&&React.createElement(React.Fragment, null
        , React.createElement('div', { style: {display:"flex",gap:8,marginBottom:6}}
          , !noSetsEx&&React.createElement('div', { style: {flex:1}}
            , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Sets")
            , React.createElement('input', { className: "wb-ex-inp", style: {width:"100%",padding:"5px 7px"}, type: "text", inputMode: "decimal",
              value: ex.sets===0||ex.sets===""?"":ex.sets||"", onChange: e=>updateField("sets",e.target.value)})
          )
          , (isC||isF) ? (
            React.createElement(React.Fragment, null
              , React.createElement('div', { style: {flex:1.6,minWidth:0}}
                , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Duration (HH:MM)" )
                , React.createElement('input', { className: "wb-ex-inp", style: {width:"100%",padding:"4px 5px"}, type: "text", inputMode: "numeric",
                  value: ex._durHHMM!==undefined ? ex._durHHMM : (ex.durationSec ? secToHHMMSplit(ex.durationSec).hhmm : ex.reps?"00:"+String(ex.reps).padStart(2,"0"):"") ,
                  onChange: e=>updateField("_durHHMM",e.target.value),
                  onBlur: e=>{
                    const hhmm=normalizeHHMM(e.target.value);
                    updateField("_durHHMM",hhmm||undefined);
                    const sec=combineHHMMSec(hhmm, ex._durSecRaw||ex.durationSec?secToHHMMSplit(ex.durationSec||0).sec:"");
                    updateField("durationSec",sec);
                    if(sec) updateField("reps",Math.max(1,Math.floor(sec/60)));
                  },
                  placeholder: "00:00"})
              )
              , React.createElement('div', { style: {flex:0.9,minWidth:0}}
                , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Sec")
                , React.createElement('input', { className: "wb-ex-inp", style: {width:"100%",padding:"4px 5px",textAlign:"center"}, type: "number", min: "0", max: "59",
                  value: ex._durSecRaw!==undefined ? String(ex._durSecRaw).padStart(2,"0") : (ex.durationSec ? String(secToHHMMSplit(ex.durationSec).sec).padStart(2,"0") : ""),
                  onChange: e=>{
                    const v=e.target.value;
                    updateField("_durSecRaw",v);
                    const hhmm=ex._durHHMM||(ex.durationSec?secToHHMMSplit(ex.durationSec).hhmm:"");
                    const sec=combineHHMMSec(hhmm,v);
                    updateField("durationSec",sec);
                    if(sec) updateField("reps",Math.max(1,Math.floor(sec/60)));
                  },
                  placeholder: "00"})
              )
              , React.createElement('div', { style: {flex:1.4,minWidth:0}}
                , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Dist (" , metric?"km":"mi", ")")
                , React.createElement('input', { className: "wb-ex-inp", style: {width:"100%",padding:"4px 5px"}, type: "text", inputMode: "decimal",
                  value: dispDist, placeholder: "0",
                  onChange: e=>{const v=e.target.value;const mi=v&&metric?kmToMi(v):v;updateField("distanceMi",mi||null);}})
              )
            )
          ) : (
            React.createElement(React.Fragment, null
              , React.createElement('div', { style: {flex:1,minWidth:0}}
                , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Reps")
                , React.createElement('input', { className: "wb-ex-inp", style: {width:"100%",padding:"4px 5px"}, type: "text", inputMode: "decimal",
                  value: ex.reps===0||ex.reps===""?"":ex.reps||"", onChange: e=>updateField("reps",e.target.value)})
              )
              , showW&&(
                React.createElement('div', { style: {flex:1.2,minWidth:0}}
                  , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, wUnit)
                  , React.createElement('input', { className: "wb-ex-inp", style: {width:"100%",padding:"4px 5px"}, type: "text", inputMode: "decimal", step: metric?"0.5":"2.5",
                    value: dispW, placeholder: "—",
                    onChange: e=>{const v=e.target.value;const lbs=v&&metric?kgToLbs(v):v;updateField("weightLbs",lbs||null);}})
                )
              )
            )
          )
        )
        , isRunningEx&&runBoostPct>0&&(
          React.createElement('div', { style: {fontSize:".65rem",color:"#FFE87C",marginBottom:5}}, "⚡ +" , runBoostPct, "% pace bonus"  , runBoostPct===20?" (sub-8 mi!)":"")
        )
        , isTreadmill&&(
          React.createElement('div', { style: {marginBottom:6}}
            , React.createElement('div', { style: {display:"flex",gap:8}}
              , React.createElement('div', { style: {flex:1}}
                , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:4,display:"block"}}, "Incline " , React.createElement('span', { style: {opacity:.6,fontSize:".55rem"}}, "(0.5–15)"))
                , React.createElement('input', { className: "inp", type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "—",
                  value: ex.incline||"",
                  onChange: e=>updateField("incline",e.target.value?parseFloat(e.target.value):null)})
              )
              , React.createElement('div', { style: {flex:1}}
                , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:4,display:"block"}}, "Speed " , React.createElement('span', { style: {opacity:.6,fontSize:".55rem"}}, "(0.5–15)"))
                , React.createElement('input', { className: "inp", type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "—",
                  value: ex.speed||"",
                  onChange: e=>updateField("speed",e.target.value?parseFloat(e.target.value):null)})
              )
            )
          )
        )
        , (ex.extraRows||[]).map((row,ri)=>(
          React.createElement('div', { key: ri, style: {display:"flex",gap:4,marginTop:4,padding:"6px 8px",background:"rgba(45,42,36,.18)",borderRadius:6,alignItems:"center",flexWrap:"wrap"}}
            , React.createElement('span', { style: {fontSize:".58rem",color:"#9a8a78",flexShrink:0,minWidth:18}}, (isC||isF)?`I${ri+2}`:`S${ri+2}`)
            , (isC||isF) ? (React.createElement(React.Fragment, null
              , React.createElement('input', { className: "wb-ex-inp", style: {flex:1.5,minWidth:52,padding:"4px 5px",fontSize:".7rem"}, type: "text", inputMode: "numeric", placeholder: "HH:MM",
                defaultValue: row.hhmm||"",
                onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],hhmm:normalizeHHMM(e.target.value)};updateField("extraRows",rr);}})
              , React.createElement('input', { className: "wb-ex-inp", style: {flex:0.8,minWidth:34,padding:"4px 5px",fontSize:".7rem"}, type: "number", min: "0", max: "59", placeholder: "Sec", defaultValue: row.sec||"", onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],sec:e.target.value};updateField("extraRows",rr);}})
              , React.createElement('input', { className: "wb-ex-inp", style: {flex:1,minWidth:38,padding:"4px 5px",fontSize:".7rem"}, type: "text", inputMode: "decimal", placeholder: metric?"km":"mi", defaultValue: row.distanceMi||"", onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],distanceMi:e.target.value};updateField("extraRows",rr);}})
              , isTreadmill&&React.createElement('input', { className: "wb-ex-inp", style: {flex:0.8,minWidth:34,padding:"4px 5px",fontSize:".7rem"}, type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "Inc", defaultValue: row.incline||"", onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],incline:e.target.value};updateField("extraRows",rr);}})
              , isTreadmill&&React.createElement('input', { className: "wb-ex-inp", style: {flex:0.8,minWidth:34,padding:"4px 5px",fontSize:".7rem"}, type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "Spd", defaultValue: row.speed||"", onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],speed:e.target.value};updateField("extraRows",rr);}})
            )) : (React.createElement(React.Fragment, null
              , !noSetsEx&&React.createElement('input', { className: "wb-ex-inp", style: {flex:1,minWidth:40,padding:"4px 5px",fontSize:".7rem"}, type: "text", inputMode: "decimal", placeholder: "Sets", defaultValue: row.sets||"", onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],sets:e.target.value};updateField("extraRows",rr);}})
              , React.createElement('input', { className: "wb-ex-inp", style: {flex:1,minWidth:40,padding:"4px 5px",fontSize:".7rem"}, type: "text", inputMode: "decimal", placeholder: "Reps", defaultValue: row.reps||"", onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],reps:e.target.value};updateField("extraRows",rr);}})
              , showW&&React.createElement('input', { className: "wb-ex-inp", style: {flex:1,minWidth:38,padding:"4px 5px",fontSize:".7rem"}, type: "text", inputMode: "decimal", placeholder: wUnit, defaultValue: row.weightLbs||"", onBlur: e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],weightLbs:e.target.value||null};updateField("extraRows",rr);}})
            ))
            , React.createElement('button', { className: "btn btn-danger btn-xs", style: {padding:"2px 5px",flexShrink:0}, onClick: ()=>{const rr=(ex.extraRows||[]).filter((_,j)=>j!==ri);updateField("extraRows",rr);}}, "✕")
          )
        ))
        , React.createElement('button', { className: "btn btn-ghost btn-xs", style: {width:"100%",marginTop:4,marginBottom:8,fontSize:".6rem",color:"#8a8478",borderStyle:"dashed"},
          onClick: ()=>{const rr=[...(ex.extraRows||[]),(isC||isF)?{hhmm:"",sec:"",distanceMi:"",incline:"",speed:""}:{sets:ex.sets||"",reps:ex.reps||"",weightLbs:ex.weightLbs||""}];updateField("extraRows",rr);}}, "＋ Add Row (e.g. "
              , (isC||isF)?"interval":"progressive weight", ")"
        )
        , showHR&&(
          React.createElement('div', null
            , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:4,display:"block"}}, "Avg Heart Rate Zone "    , React.createElement('span', { style: {opacity:.6,fontSize:".55rem"}}, "(optional)"))
            , React.createElement('div', { className: "hr-zone-row"}
              , HR_ZONES.map(z=>{
                const sel=ex.hrZone===z.z;
                const range=hrRange(age,z);
                return (
                  React.createElement('div', { key: z.z, className: `hr-zone-btn ${sel?"sel":""}`,
                    style: {"--zc":z.color,borderColor:sel?z.color:"rgba(45,42,36,.2)",background:sel?`${z.color}22`:"rgba(45,42,36,.12)"},
                    onClick: ()=>updateField("hrZone",sel?null:z.z)}
                    , React.createElement('span', { className: "hz-name", style: {color:sel?z.color:"#5a5650"}}, "Z", z.z, " " , z.name)
                    , React.createElement('span', { className: "hz-bpm", style: {color:sel?z.color:"#6a645a"}}, range.lo, "–", range.hi)
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
});

function App() {
  const [screen,setScreen]   = useState("loading");
  const [profile,setProfile] = useState(EMPTY_PROFILE);
  const [authUser,setAuthUser] = useState(null);
  const [authEmail,setAuthEmail] = useState("");
  const [authPassword,setAuthPassword] = useState("");
  const [showAuthPw,setShowAuthPw] = useState(false);
  const [showPwProfile,setShowPwProfile] = useState(false);
  const [pwPanelOpen,setPwPanelOpen]     = useState(false);
  const [showEmail,setShowEmail]         = useState(false);
  const [myPublicId,setMyPublicId]       = useState(null);
  const [myPrivateId,setMyPrivateId]     = useState(null);
  const [showPrivateId,setShowPrivateId] = useState(false);
  const [authIsNew,setAuthIsNew] = useState(false);
  const [authRemember,setAuthRemember] = useState(true);
  const [pwNew,setPwNew] = useState("");
  const [pwConfirm,setPwConfirm] = useState("");
  const [pwMsg,setPwMsg] = useState(null);
  const [authLoading,setAuthLoading] = useState(false);
  const [authMsg,setAuthMsg] = useState(null);
  const [loginSubScreen,setLoginSubScreen] = useState(null); // null | "forgot-pw" | "forgot-username"
  const [forgotPwEmail,setForgotPwEmail] = useState("");
  const [forgotPrivateId,setForgotPrivateId] = useState("");
  const [forgotLookupResult,setForgotLookupResult] = useState(null); // null | {found, masked_email, error}
  const [previewPinEnabled] = useState(true); // on/off switch for preview PIN gate
  const [showPreviewPin,setShowPreviewPin] = useState(false);
  const [previewPinInput,setPreviewPinInput] = useState("");
  const [previewPinError,setPreviewPinError] = useState(false);
  const [isPreviewMode,setIsPreviewMode] = useState(false);
  const [detectedClass,setDetectedClass] = useState(null);
  const [activeTab,setActiveTab] = useState("workout");
  const [xpFlash,setXpFlash] = useState(null);
  const [mapOpen,setMapOpen]   = useState(false);
  const [navMenuOpen,setNavMenuOpen] = useState(false);
  const [mapTooltip,setMapTooltip] = useState(null); // {name, x, y, info}
  const [toast,setToast]     = useState(null);
  const [showWNMockup,setShowWNMockup] = useState(false);
  const [feedbackOpen,setFeedbackOpen] = useState(false);
  const [feedbackText,setFeedbackText] = useState("");
  const [feedbackType,setFeedbackType] = useState("idea"); // "idea"|"bug"|"help"
  const [feedbackSent,setFeedbackSent] = useState(false);
  const [feedbackEmail,setFeedbackEmail] = useState("");
  const [feedbackAccountId,setFeedbackAccountId] = useState("");
  const [helpConfirmShown,setHelpConfirmShown] = useState(false);
  // Quick log
  const [selEx,setSelEx]   = useState(null);
  const [sets,setSets]     = useState("");
  const [reps,setReps]     = useState("");
  const [exWeight,setExWeight] = useState("");    // base weight in user's unit
  const [weightPct,setWeightPct] = useState(100); // % multiplier 50–200
  const [hrZone,setHrZone] = useState(null);      // 1–5 or null
  const [distanceVal,setDistanceVal] = useState(""); // distance in user's unit
  const [exIncline,setExIncline]     = useState(null);
  const [exSpeed,setExSpeed]         = useState(null);
  const [exHHMM,setExHHMM]           = useState("");  // HH:MM portion of duration
  const [exSec,setExSec]             = useState("");  // 0-59 seconds portion
  const [quickRows,setQuickRows]     = useState([]); // extra set rows [{sets,reps,weightLbs}]
  const [exCatFilter,setExCatFilter] = useState("All");
  const [exCatFilters,setExCatFilters] = useState(()=>new Set());
  const [showFavsOnly,setShowFavsOnly] = useState(false);
  const [exMuscleFilter,setExMuscleFilter] = useState("All");
  const [musclePickerOpen,setMusclePickerOpen] = useState(false);
  const [exSearch,setExSearch] = useState("");
  const [exSubTab,setExSubTab] = useState("library"); // "log"(hidden) | "library" | "myworkouts"
  const [favSelectMode,setFavSelectMode] = useState(false);
  const [favSelected,setFavSelected] = useState(()=>new Set());
  const [libSearch,setLibSearch]   = useState("");
  const [libSearchDebounced,setLibSearchDebounced] = useState("");
  const debouncedSetLibSearch = React.useRef(debounce(v => setLibSearchDebounced(v), 200)).current;
  const [libTypeFilters,setLibTypeFilters]   = useState(()=>new Set());
  const [libMuscleFilters,setLibMuscleFilters] = useState(()=>new Set());
  const [libEquipFilters,setLibEquipFilters]   = useState(()=>new Set());
  const [libOpenDrop,setLibOpenDrop] = useState(null); // "type"|"muscle"|"equip"|null
  const [libDetailEx,setLibDetailEx] = useState(null);
  const [libSelectMode,setLibSelectMode] = useState(false);
  const [libSelected,setLibSelected]     = useState(()=>new Set());
  const [libBrowseMode,setLibBrowseMode] = useState("home");
  const [libVisibleCount,setLibVisibleCount] = useState(60);
  const [lbFilter,setLbFilter] = useState("overall_xp");
  const [lbScope,setLbScope] = useState("world"); // "world" | "friends"
  const [lbStateFilters,setLbStateFilters] = useState(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"]);
  const [lbCountryFilters,setLbCountryFilters] = useState(["United States"]);
  const [lbData,setLbData] = useState(null); // fetched from Supabase
  const [lbWorldRanks,setLbWorldRanks] = useState({}); // {userId: rank}
  const [lbLoading,setLbLoading] = useState(false);
  const [lbAvailableStates,setLbAvailableStates] = useState([]);
  const [lbAvailableCountries,setLbAvailableCountries] = useState([]);
  const [lbStateDropOpen,setLbStateDropOpen] = useState(false);
  const [lbCountryDropOpen,setLbCountryDropOpen] = useState(false);

  const [multiSelEx,setMultiSelEx] = useState(()=>new Set());
  const [multiMode,setMultiMode] = useState(false);
  // Plan intensity (shared slider for detail + builder)

  // Exercise detail modal
  const [detailEx,setDetailEx] = useState(null);
  const [detailImgIdx,setDetailImgIdx] = useState(0);
  // Profile edit
  const [editMode,setEditMode] = useState(false);
  const [securityMode,setSecurityMode] = useState(false);
  const [notifMode,setNotifMode] = useState(false);
  // Friend exercise banner notification
  const [friendExBanner, setFriendExBanner] = useState(null);
  const friendLogLengthsRef = React.useRef({});
  const friendBannerTimerRef = React.useRef(null);
  const notifPrefsRef = React.useRef(null);
  // Personal Bests filter
  const LEADERBOARD_PB_IDS = new Set(["bench","bench_press","squat","barbell_back_squat","deadlift","barbell_deadlift","overhead_press","ohp","pull_up","pullups","push_up","pushups","running","treadmill_run","run"]);
  const [pbFilterOpen,setPbFilterOpen] = useState(false);
  const [pbSelectedFilters,setPbSelectedFilters] = useState(null);
  // Email change
  const [emailPanelOpen,setEmailPanelOpen] = useState(false);
  const [newEmail,setNewEmail] = useState("");
  const [emailMsg,setEmailMsg] = useState(null);
  // MFA
  const [mfaPanelOpen,setMfaPanelOpen] = useState(false);
  const [mfaEnrolling,setMfaEnrolling] = useState(false);
  const [mfaQR,setMfaQR] = useState(null);
  const [mfaSecret,setMfaSecret] = useState(null);
  const [mfaFactorId,setMfaFactorId] = useState(null);
  const [mfaCode,setMfaCode] = useState("");
  const [mfaMsg,setMfaMsg] = useState(null);
  const [mfaEnabled,setMfaEnabled] = useState(false);
  const [mfaUnenrolling,setMfaUnenrolling] = useState(false);
  const [mfaRecoveryCodes,setMfaRecoveryCodes] = useState(null); // array of plaintext codes shown once
  const [mfaCodesRemaining,setMfaCodesRemaining] = useState(null);
  const [mfaRecoveryMode,setMfaRecoveryMode] = useState(false); // on login challenge screen
  const [mfaRecoveryInput,setMfaRecoveryInput] = useState("");
  // MFA disable verification
  const [mfaDisableConfirm,setMfaDisableConfirm] = useState(false);
  const [mfaDisableCode,setMfaDisableCode] = useState("");
  const [mfaDisableMethod,setMfaDisableMethod] = useState("totp"); // 'totp' | 'phone'
  const [mfaDisableMsg,setMfaDisableMsg] = useState(null);
  // Phone number
  const [phonePanelOpen,setPhonePanelOpen] = useState(false);
  const [phoneInput,setPhoneInput] = useState("");
  const [phoneOtpSent,setPhoneOtpSent] = useState(false);
  const [phoneOtpCode,setPhoneOtpCode] = useState("");
  const [phoneMsg,setPhoneMsg] = useState(null);
  // MFA login challenge
  const [mfaChallengeScreen,setMfaChallengeScreen] = useState(false);
  const [mfaChallengeCode,setMfaChallengeCode] = useState("");
  const [mfaChallengeMsg,setMfaChallengeMsg] = useState(null);
  const [mfaChallengeLoading,setMfaChallengeLoading] = useState(false);
  const [mfaChallengeFactorId,setMfaChallengeFactorId] = useState(null);
  const [draft,setDraft]       = useState({});
  // Onboarding
  const [obName,setObName] = useState("");
  const [obFirstName,setObFirstName] = useState("");
  const [obLastName,setObLastName] = useState("");
  const [obBio,setObBio]   = useState("");
  const [obStep,setObStep] = useState(1);
  const [obAge,setObAge]   = useState("");
  const [obGender,setObGender] = useState("");
  const [obSports,setObSports] = useState([]);
  const [obFreq,setObFreq] = useState("");
  const [obTiming,setObTiming] = useState("");
  const [obPriorities,setObPriorities] = useState([]);
  const [obStyle,setObStyle] = useState("");
  const [obState,setObState] = useState("");
  const [obCountry,setObCountry] = useState("United States");
  const [obDraft,setObDraft] = useState(null); // null | saved onboarding draft from localStorage
  // Plans
  const [charSubTab, setCharSubTab] = useState("avatar");
  const [bodyTypeLocked, setBodyTypeLocked] = useState(false);
  const [planView,setPlanView]     = useState("list");
  const [collapsedTpls,setCollapsedTpls] = useState(()=>{
    const defaults={};
    PLAN_TEMPLATES.forEach(t=>{ defaults[t.id]=true; });
    return defaults;
  });
  const [activePlan,setActivePlan] = useState(null);
  const [detailDayIdx,setDetailDayIdx] = useState(0);
  const [wizardEditPlan,setWizardEditPlan] = useState(null); // plan object for editing, or null for new
  const [wizardTemplatePlan,setWizardTemplatePlan] = useState(null); // template plan, or null
  const [dragDetailExIdx,setDragDetailExIdx] = useState(null);
  const [dragWbExIdx,setDragWbExIdx] = useState(null);
  const [ssChecked,setSsChecked] = useState(()=>new Set()); // indices checked for superset grouping
  const [ssAccordion,setSsAccordion] = useState({}); // collapse state for accordion sections like "0_a", "0_b"
  const [collapsedDetailEx,setCollapsedDetailEx] = useState({}); // {dayIdx_exIdx: bool}
  const [collapsedWbEx,setCollapsedWbEx] = useState({}); // {i: bool}
  function toggleDetailEx(dayIdx,exIdx){ const k=`${dayIdx}_${exIdx}`; setCollapsedDetailEx(s=>({...s,[k]:!s[k]})); }
  function toggleWbEx(i){ setCollapsedWbEx(s=>({...s,[i]:!s[i]})); }
  const [pickerMuscle,setPickerMuscle] = useState("All");
  const [pickerSearch,setPickerSearch] = useState("");
  const [pickerMuscleOpen,setPickerMuscleOpen] = useState(false);
  const [pickerTypeFilter,setPickerTypeFilter]   = useState("all");
  const [pickerEquipFilter,setPickerEquipFilter] = useState("all");
  const [pickerOpenDrop,setPickerOpenDrop]       = useState(null); // "muscle"|"type"|"equip"|null
  const [pickerSelected,setPickerSelected] = useState([]); // [{exId, sets, reps, weightLbs, weightPct, durationMin, distanceMi, hrZone}]
  const [pickerConfigOpen,setPickerConfigOpen] = useState(false); // show config panel in picker
  // Quests
  const [questCat,setQuestCat] = useState("All");
  // Calendar
  const [calViewDate,setCalViewDate] = useState(()=>{ const d=new Date(); return {y:d.getFullYear(),m:d.getMonth()}; });
  const [calSelDate,setCalSelDate] = useState(todayStr());
  // Exercise editor
  const [exEditorOpen,setExEditorOpen] = useState(false);
  const [exEditorDraft,setExEditorDraft] = useState({});
  const [exEditorMode,setExEditorMode] = useState("create"); // "create"|"edit"|"copy"
  // Save-as-Plan wizard (from history)
  const [savePlanWizard,setSavePlanWizard] = useState(null); // null | {entries, label}
  const [spwName,setSpwName]   = useState("");
  const [spwIcon,setSpwIcon]   = useState("📋");
  const [spwDate,setSpwDate]   = useState(""); // YYYY-MM-DD
  const [spwSelected,setSpwSelected] = useState([]); // array of _idx selected
  // Schedule picker (for existing plans or exercises)
  const [schedulePicker,setSchedulePicker] = useState(null); // null | {type:"plan",plan} | {type:"ex",exId,name,icon}
  const [spDate,setSpDate]   = useState("");
  const [spNotes,setSpNotes] = useState("");
  // Workouts tab
  const [workoutView,setWorkoutView]     = useState("list"); // "list"|"detail"|"builder"|"templates"
  const [activeWorkout,setActiveWorkout] = useState(null);
  const [wbName,setWbName]   = useState("");
  const [wbIcon,setWbIcon]   = useState("💪");
  const [wbDesc,setWbDesc]   = useState("");
  const [wbExercises,setWbExercises] = useState([]); // [{exId,sets,reps,weightLbs,durationMin,...}]
  // wbExCompleted removed — Mark Complete feature removed from builder UX
  const [wbExPickerOpen,setWbExPickerOpen] = useState(false);
  const [wbEditId,setWbEditId] = useState(null); // id of workout being edited
  const [wbCopySource,setWbCopySource] = useState(null);
  const [wbIsOneOff,setWbIsOneOff] = useState(false); // true when building a one-off workout
  const [addToPlanPicker,setAddToPlanPicker] = useState(null);
  const [addToWorkoutPicker,setAddToWorkoutPicker] = useState(null); // {exercises} — pick existing workout
  const [pendingSoloRemoveId,setPendingSoloRemoveId] = useState(null); // scheduled solo ex to remove after full-form log
  const [workoutSubTab,setWorkoutSubTab] = useState("reusable"); // "reusable"|"oneoff"
  const [collapsedWo,setCollapsedWo] = useState(new Set());
  const [expandedRecipeDesc,setExpandedRecipeDesc] = useState(new Set()); // which recipe descs are expanded
  const [expandedRecipeEx,setExpandedRecipeEx] = useState(new Set()); // which recipe exercise lists are expanded
  const [recipeFilter,setRecipeFilter] = useState(()=>new Set(["Bodyweight"])); // multi-select category filter
  const [recipeCatDrop,setRecipeCatDrop] = useState(false); // category dropdown open
  const [oneOffModal,setOneOffModal] = useState(null); // {exercises, name, icon} — naming step
  // Workout-level optional stats (builder)
  const [wbDuration,setWbDuration]   = useState(""); // HH:MM string
  const [wbDurSec,setWbDurSec]       = useState(""); // 0-59 seconds
  const [wbActiveCal,setWbActiveCal] = useState(""); // active calories
  const [wbTotalCal,setWbTotalCal]   = useState(""); // total calories
  const [statsPromptModal,setStatsPromptModal] = useState(null);
  const [spDuration,setSpDuration]   = useState(""); // HH:MM
  const [spDurSec,setSpDurSec]       = useState(""); // seconds
  const [spActiveCal,setSpActiveCal] = useState("");
  const [spTotalCal,setSpTotalCal]   = useState("");
  const [spMakeReusable,setSpMakeReusable] = useState(false);
  const [bootStep,setBootStep] = useState(0);
  // Workout label filter & builder
  const [woLabelFilters,setWoLabelFilters] = useState(()=>new Set());
  const [woLabelDropOpen,setWoLabelDropOpen] = useState(false);
  const [wbLabels,setWbLabels] = useState([]); // labels for workout being built/edited
  const [newLabelInput,setNewLabelInput] = useState("");
  // Workout completion modal
  const [completionModal,setCompletionModal] = useState(null); // null | {workout}
  const [retroEditModal,setRetroEditModal]   = useState(null); // {groupId, entries, dateKey, sourceType, sourceName, sourceIcon, sourceId}
  const [completionDate,setCompletionDate] = useState(""); // YYYY-MM-DD
  const [completionAction,setCompletionAction] = useState("today"); // "today"|"past"|"schedule"
  const [scheduleWoDate,setScheduleWoDate] = useState(""); // future date for scheduling
  // In-app confirm delete (replaces window.confirm which fails in sandbox)
  const [confirmDelete,setConfirmDelete] = useState(null); // null | {type:"plan"|"workout"|"exercise"|"char"|"logEntry", id, name, icon}
  // Log tab sub-tabs
  const [logSubTab,setLogSubTab] = useState("exercises"); // "exercises"|"workouts"|"plans"|"social"
  // ── Social / Friends ──────────────────────────────────────────────
  const [friends,setFriends]             = useState([]);
  const [friendRequests,setFriendRequests] = useState([]);
  const [outgoingRequests,setOutgoingRequests] = useState([]); // pending requests I sent
  const [socialLoading,setSocialLoading] = useState(false);
  // Sharing
  const [shareModal,setShareModal]       = useState(null); // {type:"workout"|"exercise", item, friendId?, friendName?}
  const [incomingShares,setIncomingShares] = useState([]); // pending shares received
  const [socialMsg,setSocialMsg]         = useState(null);
  const [friendSearch,setFriendSearch]   = useState("");
  const [friendSearchResult,setFriendSearchResult] = useState(null); // null | {found:bool, user?}
  const [friendSearchLoading,setFriendSearchLoading] = useState(false);
  // Messaging
  const [msgView,setMsgView] = useState("list"); // "list" | "chat"
  const [msgConversations,setMsgConversations] = useState([]);
  const [msgActiveChannel,setMsgActiveChannel] = useState(null); // channel object from conversations
  const [msgMessages,setMsgMessages] = useState([]);
  const [msgInput,setMsgInput] = useState("");
  const [msgLoading,setMsgLoading] = useState(false);
  const [msgSending,setMsgSending] = useState(false);
  const [msgUnreadTotal,setMsgUnreadTotal] = useState(0);
  const msgScrollRef = React.useRef(null);
  React.useEffect(()=>{
    if(msgScrollRef.current) msgScrollRef.current.scrollTop = msgScrollRef.current.scrollHeight;
  }, [msgMessages.length]);
  // Track which log groups are collapsed (by groupId key). Default all expanded.
  const [logCollapsedGroups,setLogCollapsedGroups] = useState({});
  // Log groups default to collapsed — openLogGroups tracks which ones are OPEN
  const [openLogGroups,setOpenLogGroups] = useState({});
  function toggleLogGroup(gid) {
    setOpenLogGroups(prev=>({...prev,[gid]:!prev[gid]}));
  }
  // Retroactive stats lookup: get Duration/ActiveCal/TotalCal from log entry or source workout/plan
  function getEntryStats(entry) {
    let dur = Number(entry.sourceDurationSec)||0;
    let act = Number(entry.sourceActiveCal)||0;
    let tot = Number(entry.sourceTotalCal)||0;
    if(!dur && !act && !tot) {
      if(entry.sourceWorkoutId) {
        const wo = (profile.workouts||[]).find(w=>w.id===entry.sourceWorkoutId);
        if(wo) { dur=Number(wo.durationMin)||0; act=Number(wo.activeCal)||0; tot=Number(wo.totalCal)||0; }
      } else if(entry.sourcePlanId) {
        const pl = (profile.plans||[]).find(p=>p.id===entry.sourcePlanId);
        if(pl && pl.days) {
          pl.days.forEach(d=>{ dur+=Number(d.durationMin)||0; act+=Number(d.activeCal)||0; tot+=Number(d.totalCal)||0; });
        }
      }
    }
    return {durationSec:dur, activeCal:act, totalCal:tot};
  }
  // Log entry editor
  const [logEditModal,setLogEditModal] = useState(null); // null | {idx}
  const [logEditDraft,setLogEditDraft] = useState(null); // copy of the entry being edited
  // Calendar exercise read-only detail modal
  const [calExDetailModal,setCalExDetailModal] = useState(null);
  // Retro check-in modal
  const [retroCheckInModal,setRetroCheckInModal] = useState(false);
  const [retroDate,setRetroDate] = useState("");
  // Save-as-Workout wizard (from history)
  const [saveWorkoutWizard,setSaveWorkoutWizard] = useState(null); // null | {entries,label}
  const [swwName,setSwwName] = useState("");
  const [swwIcon,setSwwIcon] = useState("💪");
  const [swwSelected,setSwwSelected] = useState([]);
  // Save-to-Plan wizard mode: "new" | "existing"
  const [spwMode,setSpwMode] = useState("new"); // within savePlanWizard
  const [spwTargetPlanId,setSpwTargetPlanId] = useState(null);

  // Load Supabase exercises on startup; useExercises() triggers re-render when done
  const _exReady = useExercises();
  useEffect(()=>{ loadExercises(); },[]);

  useEffect(()=>{
    // Listen for auth state changes (login, logout, magic link click)
    const {data:{subscription}} = sb.auth.onAuthStateChange(async (_event, session)=>{
      const user = _optionalChain([session, 'optionalAccess', _22 => _22.user]) || null;

      // Skip INITIAL_SESSION — getSession() below handles the initial page load
      if(_event === "INITIAL_SESSION") return;

      // When user clicks a password reset link, direct them to Security tab
      if(_event === "PASSWORD_RECOVERY") {
        setAuthUser(user);
        const saved = await loadSave(_optionalChain([user, 'optionalAccess', _23 => _23.id]) || null);
        if(_optionalChain([saved, 'optionalAccess', _24 => _24.chosenClass])){
          ((_s)=>setProfile({..._s,exercisePBs:Object.keys(_s.exercisePBs||{}).length>0?_s.exercisePBs:calcExercisePBs(_s.log||[])}))(ensureRestDay({...EMPTY_PROFILE,...saved,plans:saved.plans||[],quests:saved.quests||{},customExercises:saved.customExercises||[],scheduledWorkouts:saved.scheduledWorkouts||[],workouts:saved.workouts||[],checkInHistory:saved.checkInHistory||[]}));
        }
        setScreen("main");
        setActiveTab("profile");
        setSecurityMode(true);
        setEditMode(false);
        setPwPanelOpen(true);
        setPwMsg({ok:null, text:"🔑 You followed a password reset link — please set your new password below."});
        return;
      }

      // Silent background events — never touch the screen
      if(_event === "TOKEN_REFRESHED" || _event === "USER_UPDATED") {
        setAuthUser(user);
        return;
      }

      // Explicit sign-out — always go to login
      if(_event === "SIGNED_OUT") {
        setAuthUser(null);
        setScreen("landing");
        return;
      }

      setAuthUser(user);
      const saved = await loadSave(_optionalChain([user, 'optionalAccess', _25 => _25.id]) || null);
      if(_optionalChain([saved, 'optionalAccess', _26 => _26.chosenClass])){
        ((_s)=>setProfile({..._s,exercisePBs:Object.keys(_s.exercisePBs||{}).length>0?_s.exercisePBs:calcExercisePBs(_s.log||[])}))(ensureRestDay({...EMPTY_PROFILE,...saved,plans:saved.plans||[],quests:saved.quests||{},customExercises:saved.customExercises||[],scheduledWorkouts:saved.scheduledWorkouts||[],workouts:saved.workouts||[],checkInHistory:saved.checkInHistory||[]}));
        setScreen("main");
      } else {
        // Safety net: never navigate an active user away from "main" due to a
        // failed/slow loadSave. Functional updater reads live screen state, not
        // the stale closure value captured at mount.
        setScreen(s => s === "main" ? s : (user ? "intro" : "login"));
      }
    });
    // Check existing session on mount — handle both cases explicitly
    sb.auth.getSession().then(async ({data:{session}})=>{
      if(!session) {
        setScreen("landing");
      } else {
        // Session exists — load profile directly without waiting for onAuthStateChange
        const user = session.user;
        setAuthUser(user);
        checkMfaStatus();
        try {
          const saved = await loadSave(user.id);
          if(_optionalChain([saved, 'optionalAccess', _27 => _27.chosenClass])){
            ((_s)=>setProfile({..._s,exercisePBs:Object.keys(_s.exercisePBs||{}).length>0?_s.exercisePBs:calcExercisePBs(_s.log||[])}))(ensureRestDay({...EMPTY_PROFILE,...saved,plans:saved.plans||[],quests:saved.quests||{},customExercises:saved.customExercises||[],scheduledWorkouts:saved.scheduledWorkouts||[],workouts:saved.workouts||[],checkInHistory:saved.checkInHistory||[]}));
            setScreen("main");
          } else {
            setScreen("landing");
          }
        } catch(e) {
          console.error("loadSave error:", e);
          setScreen("landing");
        }
      }
    }).catch(()=>setScreen("landing"));
    // Safety fallback — if nothing resolves in 5s, go to landing
    const fallback = setTimeout(()=>setScreen(s=>s==="loading"?"landing":s), 5000);
    return ()=>{ subscription.unsubscribe(); clearTimeout(fallback); };
  },[]);
  useEffect(()=>{ if(screen==="main" && !isPreviewMode) doSave(profile, _optionalChain([authUser, 'optionalAccess', _28 => _28.id])||null, _optionalChain([authUser, 'optionalAccess', _29 => _29.email])||null); },[profile,screen,isPreviewMode]);
  useEffect(()=>{
    if(screen!=="intro"){ setBootStep(0); return; }
    setBootStep(0);
    const t1=setTimeout(()=>setBootStep(1),700);
    const t2=setTimeout(()=>setBootStep(2),1400);
    const t3=setTimeout(()=>setBootStep(3),2100);
    const t4=setTimeout(()=>setBootStep(4),2800);
    return ()=>{ clearTimeout(t1);clearTimeout(t2);clearTimeout(t3);clearTimeout(t4); };
  },[screen]);
  useEffect(()=>{
    if(!authUser || screen!=="onboard") return;
    const draft={obStep,obName,obFirstName,obLastName,obBio,obAge,obGender,obSports,obFreq,obTiming,obPriorities,obStyle,obState,obCountry};
    try { localStorage.setItem("aurisar_ob_draft_"+authUser.id, JSON.stringify(draft)); } catch(e) {}
  },[authUser,screen,obStep,obName,obFirstName,obLastName,obBio,obAge,obGender,obSports,obFreq,obTiming,obPriorities,obStyle,obState,obCountry]);
  useEffect(()=>{
    if(screen!=="intro"||!authUser||authIsNew){ setObDraft(null); return; }
    try {
      const raw=localStorage.getItem("aurisar_ob_draft_"+authUser.id);
      const parsed=raw?JSON.parse(raw):null;
      setObDraft(parsed?.obStep>=2?parsed:null);
    } catch(e){ setObDraft(null); }
  },[screen,authUser?.id,authIsNew]);
  useEffect(()=>{
    // Auto-load social data on login so badge shows immediately
    if(screen==="main" && authUser) {
      loadSocialData();
      loadIncomingShares();
    }
  },[screen, _optionalChain([authUser, 'optionalAccess', _30 => _30.id])]);
  useEffect(()=>{
    function handleUnload(){ if(sessionStorage.getItem("ilf_no_persist")) sb.auth.signOut(); }
    window.addEventListener("beforeunload", handleUnload);
    return ()=>window.removeEventListener("beforeunload", handleUnload);
  },[]);

  const showToast = (msg,dur=2800) => { setToast(msg); setTimeout(()=>setToast(null),dur); };

  // Keep notifPrefsRef in sync so realtime handler avoids stale closure
  useEffect(() => { notifPrefsRef.current = profile.notificationPrefs || {}; }, [profile.notificationPrefs]);

  // Show a friend exercise banner notification (auto-dismiss after 5s)
  function showFriendExBanner(data) {
    if(friendBannerTimerRef.current) clearTimeout(friendBannerTimerRef.current);
    const k = Date.now();
    setFriendExBanner({ ...data, key: k });
    friendBannerTimerRef.current = setTimeout(() => setFriendExBanner(null), 5000);
  }

  // Format PB info for friend exercise banner
  function formatFriendPB(pb) {
    if(!pb) return null;
    if(pb.type==="Strength 1RM"||pb.type==="Heaviest Weight") return "\uD83C\uDFC6 PB: "+pb.value+" lbs";
    if(pb.type==="Cardio Pace") return "\uD83C\uDFC6 PB: "+parseFloat(pb.value).toFixed(2)+" min/mi";
    if(pb.type==="Max Reps Per 1 Set") return "\uD83C\uDFC6 PB: "+pb.value+" reps";
    if(pb.type==="Assisted Weight") return "\uD83C\uDFC6 PB: "+pb.value+" lbs (assisted)";
    if(pb.type==="Longest Hold") return "\uD83C\uDFC6 PB: "+parseFloat(pb.value).toFixed(1)+" min";
    if(pb.type==="Fastest Time") return "\uD83C\uDFC6 PB: "+parseFloat(pb.value).toFixed(1)+" min";
    return null;
  }

  async function handleAuthSubmit() {
    if(!authEmail.trim()||!authPassword.trim()) return;
    setAuthLoading(true); setAuthMsg(null);
    if(authIsNew) {
      // Enforce password policy (length + breached-password check) before
      // sending to Supabase, both to protect users and to keep error responses
      // generic (Supabase echoes specific failure modes that aid enumeration).
      const policy = await validatePasswordPolicy(authPassword);
      if(!policy.ok) {
        setAuthLoading(false);
        setAuthMsg({ok:false, text:policy.msg});
        return;
      }
      const {data:signUpData, error} = await sb.auth.signUp({email:authEmail.trim(), password:authPassword});
      if(error) {
        setAuthLoading(false);
        // Map specific failure modes to safe copy; do not echo Supabase's raw
        // error string (it can disclose "User already registered" etc.).
        const msg = (error.message||"").toLowerCase();
        if(msg.includes("already")) {
          setAuthMsg({ok:true, text:"✓ If that email is available, an account has been created. Check your inbox to confirm."});
        } else if(msg.includes("password")) {
          setAuthMsg({ok:false, text:"Password doesn't meet the requirements. Use at least 8 characters with 3 of: lowercase, uppercase, number, symbol."});
        } else {
          setAuthMsg({ok:false, text:"Sign-up failed. Please try again."});
        }
        return;
      }
      // If email confirmation is disabled, a session is returned immediately — use it
      if(_optionalChain([signUpData, 'optionalAccess', _31 => _31.session, 'optionalAccess', _32 => _32.user])) {
        if(!authRemember) sessionStorage.setItem("ilf_no_persist","1");
        else sessionStorage.removeItem("ilf_no_persist");
        const saved = await loadSave(signUpData.session.user.id);
        setAuthUser(signUpData.session.user);
        setAuthLoading(false);
        // Bearer-auth: the function verifies the email matches the session user.
        fetch("/api/send-welcome-email",{
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "Authorization":"Bearer "+signUpData.session.access_token,
          },
          body:JSON.stringify({email:signUpData.session.user.email}),
        }).catch(()=>{});
        if(_optionalChain([saved, 'optionalAccess', _33 => _33.chosenClass])){
          ((_s)=>setProfile({..._s,exercisePBs:Object.keys(_s.exercisePBs||{}).length>0?_s.exercisePBs:calcExercisePBs(_s.log||[])}))(ensureRestDay({...EMPTY_PROFILE,...saved,plans:saved.plans||[],quests:saved.quests||{},customExercises:saved.customExercises||[],scheduledWorkouts:saved.scheduledWorkouts||[],workouts:saved.workouts||[],checkInHistory:saved.checkInHistory||[]}));
          setScreen("main");
        } else {
          setScreen("intro");
        }
      } else {
        // Email confirmation is ON — tell user to verify before signing in
        setAuthLoading(false);
        setAuthMsg({ok:true, text:"✓ Account created! Check your email to verify, then sign in."});
        setAuthIsNew(false);
      }
    } else {
      const {error} = await sb.auth.signInWithPassword({email:authEmail.trim(), password:authPassword});
      setAuthLoading(false);
      if(error) {
        // Generic message — never disclose whether the email exists or whether
        // it just hasn't been confirmed (account-enumeration defence).
        setAuthMsg({ok:false, text:"Sign-in failed. Check your email and password, or confirm your email if you just signed up."});
      } else {
        if(!authRemember) sessionStorage.setItem("ilf_no_persist","1");
        else sessionStorage.removeItem("ilf_no_persist");
        // Check if MFA challenge is needed before proceeding
        const mfaRequired = await checkAndHandleMfaChallenge();
        if(mfaRequired) return; // MFA screen is now showing
        // Fallback: manually trigger load if onAuthStateChange is slow
        // Try up to 3 times with a small delay
        let attempts = 0;
        const tryLoad = async () => {
          attempts++;
          try {
            const {data:{session}} = await sb.auth.getSession();
            if(_optionalChain([session, 'optionalAccess', _34 => _34.user])) {
              const saved = await loadSave(session.user.id);
              if(_optionalChain([saved, 'optionalAccess', _35 => _35.chosenClass])){
                ((_s)=>setProfile({..._s,exercisePBs:Object.keys(_s.exercisePBs||{}).length>0?_s.exercisePBs:calcExercisePBs(_s.log||[])}))(ensureRestDay({...EMPTY_PROFILE,...saved,plans:saved.plans||[],quests:saved.quests||{},customExercises:saved.customExercises||[],scheduledWorkouts:saved.scheduledWorkouts||[],workouts:saved.workouts||[],checkInHistory:saved.checkInHistory||[]}));
                setScreen("main");
              } else {
                setScreen("intro");
              }
            } else if(attempts < 3) {
              setTimeout(tryLoad, 800);
            } else {
              // Give up and show error
              setAuthMsg({ok:false, text:"Login succeeded but session failed to load. Please refresh and try again."});
              setAuthLoading(false);
            }
          } catch(e) {
            if(attempts < 3) setTimeout(tryLoad, 800);
            else { setAuthMsg({ok:false, text:"Network error. Please check your connection and try again."}); }
          }
        };
        tryLoad();
      }
    }
  }

  async function sendPasswordReset() {
    if(!forgotPwEmail.trim()) { setAuthMsg({ok:false, text:"Enter your email address."}); return; }
    setAuthLoading(true); setAuthMsg(null);
    // Fire-and-forget: never reveal whether the email exists.
    await sb.auth.resetPasswordForEmail(forgotPwEmail.trim(), {redirectTo:getResetRedirect()}).catch(()=>{});
    setAuthLoading(false);
    setAuthMsg({ok:true, text:"\u2713 If an account exists for that email, a reset link has been sent. Check your inbox."});
  }

  async function lookupByPrivateId() {
    if(!forgotPrivateId.trim()) { setForgotLookupResult({found:false, error:"Enter your Private Account ID"}); return; }
    setAuthLoading(true); setForgotLookupResult(null);
    try {
      const {data, error} = await sb.rpc('lookup_email_by_private_id', { p_private_id: forgotPrivateId.trim() });
      setAuthLoading(false);
      if(error) { setForgotLookupResult({found:false, error:error.message}); return; }
      setForgotLookupResult(data);
    } catch(e) { setAuthLoading(false); setForgotLookupResult({found:false, error:e.message}); }
  }

  async function changePassword() {
    if(!pwNew.trim()) { setPwMsg({ok:false, text:"Enter a new password."}); return; }
    if(pwNew !== pwConfirm) { setPwMsg({ok:false, text:"Passwords don't match."}); return; }
    setPwMsg({ok:null, text:"Checking password…"});
    const policy = await validatePasswordPolicy(pwNew);
    if(!policy.ok) { setPwMsg({ok:false, text:policy.msg}); return; }
    setPwMsg(null);
    const {error} = await sb.auth.updateUser({password:pwNew});
    if(error) setPwMsg({ok:false, text:"Could not update password. Please try again."});
    else {
      setPwMsg({ok:true, text:"✓ Password updated!"});
      setPwNew("");
      setPwConfirm("");
      setShowPwProfile(false);
    }
  }

  // ── CHANGE EMAIL ──────────────────────────────────────────────
  async function changeEmailAddress() {
    if(!newEmail.trim()) { setEmailMsg({ok:false, text:"Enter a new email address."}); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if(!emailRegex.test(newEmail.trim())) { setEmailMsg({ok:false, text:"Please enter a valid email address."}); return; }
    if(authUser && newEmail.trim().toLowerCase() === authUser.email.toLowerCase()) { setEmailMsg({ok:false, text:"That's already your current email."}); return; }
    setEmailMsg(null);
    try {
      const {error} = await sb.auth.updateUser({email:newEmail.trim()});
      if(error) setEmailMsg({ok:false, text:"Error: "+error.message});
      else {
        setEmailMsg({ok:true, text:"✓ Confirmation sent! Check both your old and new email inboxes to complete the change."});
        setNewEmail("");
      }
    } catch(e) { setEmailMsg({ok:false, text:"Unexpected error: "+e.message}); }
  }

  // ── MFA (TOTP) ────────────────────────────────────────────────
  async function checkMfaStatus() {
    try {
      const {data, error} = await sb.auth.mfa.listFactors();
      if(!error && data) {
        const totp = (data.totp || []).find(f => f.status === "verified");
        setMfaEnabled(!!totp);
        if(totp) setMfaFactorId(totp.id);
      }
      // Fetch remaining recovery codes
      const {data:countData} = await sb.rpc("count_recovery_codes_remaining");
      if(typeof countData === "number") setMfaCodesRemaining(countData);
    } catch(e) { console.warn("MFA check error:", e); }
  }

  async function startMfaEnroll() {
    setMfaEnrolling(true); setMfaMsg(null); setMfaCode("");
    try {
      const {data, error} = await sb.auth.mfa.enroll({factorType:"totp", issuer:"Aurisar"});
      if(error) { setMfaMsg({ok:false, text:"Error: "+error.message}); setMfaEnrolling(false); return; }
      setMfaQR(data.totp.qr_code);
      setMfaSecret(data.totp.secret);
      setMfaFactorId(data.id);
    } catch(e) { setMfaMsg({ok:false, text:"Unexpected error: "+e.message}); setMfaEnrolling(false); }
  }

  async function verifyMfaEnroll() {
    if(!mfaCode.trim() || mfaCode.trim().length < 6) { setMfaMsg({ok:false, text:"Enter the 6-digit code from your authenticator app."}); return; }
    setMfaMsg(null);
    try {
      const {data:challenge, error:chErr} = await sb.auth.mfa.challenge({factorId:mfaFactorId});
      if(chErr) { setMfaMsg({ok:false, text:"Challenge error: "+chErr.message}); return; }
      const {error:vErr} = await sb.auth.mfa.verify({factorId:mfaFactorId, challengeId:challenge.id, code:mfaCode.trim()});
      if(vErr) { setMfaMsg({ok:false, text:"Verification failed — check the code and try again."}); return; }

      // Generate 10 recovery codes
      // Generate 10 × 80-bit recovery codes (was 48-bit). Server-side bcrypt /
      // argon2 hashing is the proper next step (security audit M-5 server) —
      // until that ships, we keep the existing client-side SHA-256 contract.
      const codes = Array.from({length: 10}, () => generateRecoveryCode());
      const hashes = await Promise.all(codes.map(async code => {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
      }));
      await sb.rpc("store_mfa_recovery_codes", { code_hashes: hashes });

      setMfaEnabled(true);
      setMfaEnrolling(false);
      setMfaQR(null);
      setMfaSecret(null);
      setMfaCode("");
      setMfaRecoveryCodes(codes); // Show codes to user (one-time)
      setMfaCodesRemaining(10);
      setMfaMsg({ok:true, text:"✓ MFA is now active! Save your recovery codes below — they won't be shown again."});
    } catch(e) { setMfaMsg({ok:false, text:"Unexpected error: "+e.message}); }
  }

  // ── MFA DISABLE (VERIFIED) ─────────────────────────────────
  // Step 1: User clicks "Disable MFA" → opens confirmation panel
  function unenrollMfa() {
    setMfaDisableConfirm(true);
    setMfaDisableCode("");
    setMfaDisableMsg(null);
    setMfaDisableMethod("totp");
  }

  // Step 2a: Verify with TOTP code, then disable
  async function confirmMfaDisableWithTotp() {
    if(!mfaDisableCode.trim() || mfaDisableCode.trim().length < 6) {
      setMfaDisableMsg({ok:false, text:"Enter your 6-digit authenticator code."}); return;
    }
    setMfaUnenrolling(true); setMfaDisableMsg(null);
    try {
      // Challenge + verify the TOTP code first
      const {data:challenge, error:chErr} = await sb.auth.mfa.challenge({factorId:mfaFactorId});
      if(chErr) { setMfaDisableMsg({ok:false, text:"Error: "+chErr.message}); setMfaUnenrolling(false); return; }
      const {error:vErr} = await sb.auth.mfa.verify({factorId:mfaFactorId, challengeId:challenge.id, code:mfaDisableCode.trim()});
      if(vErr) { setMfaDisableMsg({ok:false, text:"Invalid code — check your authenticator and try again."}); setMfaUnenrolling(false); return; }
      // Code verified — now disable
      await doMfaDisable();
    } catch(e) { setMfaDisableMsg({ok:false, text:"Error: "+e.message}); setMfaUnenrolling(false); }
  }

  // Step 2b: Send phone OTP for MFA disable
  async function sendPhoneOtpForDisable() {
    const phone = profile.phone;
    if(!phone) { setMfaDisableMsg({ok:false, text:"No verified phone on file. Use your authenticator code instead."}); return; }
    setMfaDisableMsg(null);
    try {
      const {data:expiry, error} = await sb.rpc("send_phone_otp", {p_phone: phone, p_purpose: "disable_mfa"});
      if(error) { setMfaDisableMsg({ok:false, text:"Error sending SMS: "+error.message}); return; }
      setMfaDisableMsg({ok:true, text:"✓ Code sent to "+phone.slice(0,-4).replace(/./g,"•")+phone.slice(-4)+". Expires in 10 minutes."});
    } catch(e) { setMfaDisableMsg({ok:false, text:"Error: "+e.message}); }
  }

  // Step 2b continued: Verify phone OTP, then disable
  async function confirmMfaDisableWithPhone() {
    if(!mfaDisableCode.trim() || mfaDisableCode.trim().length < 6) {
      setMfaDisableMsg({ok:false, text:"Enter the 6-digit code sent to your phone."}); return;
    }
    setMfaUnenrolling(true); setMfaDisableMsg(null);
    try {
      const {data:valid, error} = await sb.rpc("verify_phone_otp", {p_code: mfaDisableCode.trim(), p_purpose: "disable_mfa"});
      if(error) { setMfaDisableMsg({ok:false, text:"Error: "+error.message}); setMfaUnenrolling(false); return; }
      if(!valid) { setMfaDisableMsg({ok:false, text:"Invalid or expired code."}); setMfaUnenrolling(false); return; }
      await doMfaDisable();
    } catch(e) { setMfaDisableMsg({ok:false, text:"Error: "+e.message}); setMfaUnenrolling(false); }
  }

  // Step 3: Actual MFA removal (only called after verification)
  async function doMfaDisable() {
    try {
      const {error} = await sb.auth.mfa.unenroll({factorId:mfaFactorId});
      if(error) { setMfaDisableMsg({ok:false, text:"Error: "+error.message}); setMfaUnenrolling(false); return; }
      await sb.rpc("store_mfa_recovery_codes", {code_hashes: []});
      setMfaEnabled(false);
      setMfaFactorId(null);
      setMfaRecoveryCodes(null);
      setMfaCodesRemaining(0);
      setMfaDisableConfirm(false);
      setMfaDisableCode("");
      setMfaMsg({ok:true, text:"✓ MFA has been disabled."});
    } catch(e) { setMfaDisableMsg({ok:false, text:"Error: "+e.message}); }
    setMfaUnenrolling(false);
  }

  // ── PHONE NUMBER MANAGEMENT ───────────────────────────────
  async function sendPhoneVerification() {
    const phone = phoneInput.trim();
    if(!phone) { setPhoneMsg({ok:false, text:"Enter a phone number."}); return; }
    // Basic validation: starts with + and has 10+ digits
    if(!/^\+\d{10,15}$/.test(phone.replace(/[\s\-()]/g,""))) {
      setPhoneMsg({ok:false, text:"Enter a valid phone number with country code (e.g. +12145551234)."}); return;
    }
    setPhoneMsg(null);
    try {
      const {data:expiry, error} = await sb.rpc("send_phone_otp", {p_phone: phone.replace(/[\s\-()]/g,""), p_purpose: "verify_phone"});
      if(error) { setPhoneMsg({ok:false, text:"Error: "+error.message}); return; }
      setPhoneOtpSent(true);
      setPhoneMsg({ok:true, text:"✓ Code sent! Check your phone. Expires in 10 minutes."});
    } catch(e) { setPhoneMsg({ok:false, text:"Error: "+e.message}); }
  }

  async function verifyPhoneOtp() {
    if(!phoneOtpCode.trim() || phoneOtpCode.trim().length < 6) {
      setPhoneMsg({ok:false, text:"Enter the 6-digit code."}); return;
    }
    setPhoneMsg(null);
    try {
      const {data:valid, error} = await sb.rpc("verify_phone_otp", {p_code: phoneOtpCode.trim(), p_purpose: "verify_phone"});
      if(error) { setPhoneMsg({ok:false, text:"Error: "+error.message}); return; }
      if(!valid) { setPhoneMsg({ok:false, text:"Invalid or expired code."}); return; }
      // Phone verified — update local profile
      const cleanPhone = phoneInput.trim().replace(/[\s\-()]/g,"");
      setProfile(p=>({...p, phone: cleanPhone, phoneVerified: true}));
      setPhoneOtpSent(false);
      setPhoneOtpCode("");
      setPhoneInput("");
      setPhoneMsg({ok:true, text:"✓ Phone number verified!"});
    } catch(e) { setPhoneMsg({ok:false, text:"Error: "+e.message}); }
  }

  function removePhone() {
    setProfile(p=>({...p, phone: null, phoneVerified: false}));
    setPhoneMsg({ok:true, text:"Phone number removed."});
    setPhoneOtpSent(false);
    setPhoneOtpCode("");
    setPhoneInput("");
  }

  // ── MFA LOGIN CHALLENGE ───────────────────────────────────
  async function checkAndHandleMfaChallenge() {
    try {
      const {data, error} = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if(error) return false;
      if(data.currentLevel === "aal1" && data.nextLevel === "aal2") {
        // MFA is required — get factor ID
        const {data:factors} = await sb.auth.mfa.listFactors();
        const totp = (factors.totp || []).find(f=>f.status === "verified");
        if(totp) {
          setMfaChallengeFactorId(totp.id);
          setMfaChallengeScreen(true);
          setMfaChallengeCode("");
          setMfaChallengeMsg(null);
          setMfaRecoveryMode(false);
          setMfaRecoveryInput("");
          return true; // Intercepted — don't proceed to main
        }
      }
    } catch(e) { console.warn("MFA assurance check:", e); }
    return false;
  }

  async function submitMfaChallenge() {
    if(!mfaChallengeCode.trim() || mfaChallengeCode.trim().length < 6) { setMfaChallengeMsg({ok:false, text:"Enter the 6-digit code."}); return; }
    setMfaChallengeLoading(true); setMfaChallengeMsg(null);
    try {
      const {data:challenge, error:chErr} = await sb.auth.mfa.challenge({factorId:mfaChallengeFactorId});
      if(chErr) { setMfaChallengeMsg({ok:false, text:"Error: "+chErr.message}); setMfaChallengeLoading(false); return; }
      const {error:vErr} = await sb.auth.mfa.verify({factorId:mfaChallengeFactorId, challengeId:challenge.id, code:mfaChallengeCode.trim()});
      if(vErr) { setMfaChallengeMsg({ok:false, text:"Invalid code — try again."}); setMfaChallengeLoading(false); return; }
      // Success — proceed to load profile
      setMfaChallengeScreen(false);
      setMfaChallengeLoading(false);
      const {data:{session}} = await sb.auth.getSession();
      if(session?.user) {
        setAuthUser(session.user);
        checkMfaStatus();
        const saved = await loadSave(session.user.id);
        if(saved?.chosenClass){
          ((_s)=>setProfile({..._s,exercisePBs:Object.keys(_s.exercisePBs||{}).length>0?_s.exercisePBs:calcExercisePBs(_s.log||[])}))(ensureRestDay({...EMPTY_PROFILE,...saved,plans:saved.plans||[],quests:saved.quests||{},customExercises:saved.customExercises||[],scheduledWorkouts:saved.scheduledWorkouts||[],workouts:saved.workouts||[],checkInHistory:saved.checkInHistory||[]}));
          setScreen("main");
        } else { setScreen("intro"); }
      }
    } catch(e) { setMfaChallengeMsg({ok:false, text:"Error: "+e.message}); setMfaChallengeLoading(false); }
  }

  async function submitRecoveryCode() {
    if(!mfaRecoveryInput.trim()) { setMfaChallengeMsg({ok:false, text:"Enter a recovery code."}); return; }
    setMfaChallengeLoading(true); setMfaChallengeMsg(null);
    try {
      const {data:result, error} = await sb.rpc("use_mfa_recovery_code", {code_plaintext: mfaRecoveryInput.trim().toUpperCase()});
      if(error) { setMfaChallengeMsg({ok:false, text:"Error: "+error.message}); setMfaChallengeLoading(false); return; }
      if(!result) { setMfaChallengeMsg({ok:false, text:"Invalid or already-used recovery code."}); setMfaChallengeLoading(false); return; }
      // MFA has been unenrolled — refresh session and proceed
      setMfaChallengeScreen(false);
      setMfaChallengeLoading(false);
      const {data:{session}} = await sb.auth.getSession();
      if(session?.user) {
        setAuthUser(session.user);
        const saved = await loadSave(session.user.id);
        if(saved?.chosenClass){
          ((_s)=>setProfile({..._s,exercisePBs:Object.keys(_s.exercisePBs||{}).length>0?_s.exercisePBs:calcExercisePBs(_s.log||[])}))(ensureRestDay({...EMPTY_PROFILE,...saved,plans:saved.plans||[],quests:saved.quests||{},customExercises:saved.customExercises||[],scheduledWorkouts:saved.scheduledWorkouts||[],workouts:saved.workouts||[],checkInHistory:saved.checkInHistory||[]}));
          setScreen("main");
        } else { setScreen("intro"); }
        showToast("🔓 Recovery code accepted — MFA has been removed. You can re-enroll in Profile → Security.");
      }
    } catch(e) { setMfaChallengeMsg({ok:false, text:"Error: "+e.message}); setMfaChallengeLoading(false); }
  }

  async function regenerateRecoveryCodes() {
    setMfaMsg(null);
    try {
      const codes = Array.from({length: 10}, () => generateRecoveryCode());
      const hashes = await Promise.all(codes.map(async code => {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
      }));
      await sb.rpc("store_mfa_recovery_codes", { code_hashes: hashes });
      setMfaRecoveryCodes(codes);
      setMfaCodesRemaining(10);
      setMfaMsg({ok:true, text:"✓ New recovery codes generated. Save them — they won't be shown again."});
    } catch(e) { setMfaMsg({ok:false, text:"Error generating codes: "+e.message}); }
  }

  // ── NOTIFICATION PREFS ────────────────────────────────────────
  function toggleNotifPref(key) {
    setProfile(p => ({
      ...p,
      notificationPrefs: {
        ...(p.notificationPrefs || {}),
        [key]: !(p.notificationPrefs || {})[key],
      }
    }));
  }

  // ── RECOVERY CODE NAVIGATION GUARD ────────────────────────
  // Shows a browser confirm dialog if user tries to navigate
  // away while recovery codes are still displayed.
  // ── PROFILE IDS ──────────────────────────────────────────────
  async function loadProfileIds() {
    try {
      const {data} = await sb.from('profiles').select('public_id, private_id').eq('id', authUser?.id).single();
      if(data) { setMyPublicId(data.public_id); setMyPrivateId(data.private_id); }
    } catch(e) { /* silent */ }
  }

  // ── MESSAGING ──────────────────────────────────────────────
  async function loadConversations() {
    if(!authUser) return;
    try {
      const {data, error} = await sb.rpc('get_my_conversations');
      if(!error && data) setMsgConversations(data);
    } catch(e) { /* silent */ }
  }

  async function loadUnreadCount() {
    if(!authUser) return;
    try {
      const {data, error} = await sb.rpc('get_total_unread_count');
      if(!error && typeof data === 'number') setMsgUnreadTotal(data);
    } catch(e) { /* silent */ }
  }

  async function openDmWithUser(otherUserId) {
    if(!authUser) return;
    setMsgLoading(true);
    try {
      const {data: channelId, error} = await sb.rpc('get_or_create_dm_channel', { p_other_user_id: otherUserId });
      if(error) { showToast("Could not open chat: " + error.message); setMsgLoading(false); return; }
      // Load conversations to get channel details
      await loadConversations();
      // Find the channel in conversations
      const convos = msgConversations.length > 0 ? msgConversations : [];
      const {data: freshConvos} = await sb.rpc('get_my_conversations');
      const chan = (freshConvos||[]).find(c => c.channel_id === channelId);
      if(chan) {
        setMsgActiveChannel(chan);
        await loadChannelMessages(channelId);
        setMsgConversations(freshConvos||[]);
      }
      setActiveTab("messages");
      setMsgView("chat");
    } catch(e) { showToast("Chat error: " + e.message); }
    setMsgLoading(false);
  }

  async function loadChannelMessages(channelId) {
    setMsgLoading(true);
    try {
      const {data, error} = await sb.rpc('get_channel_messages', { p_channel_id: channelId, p_limit: 50 });
      if(!error) setMsgMessages(data||[]);
    } catch(e) { /* silent */ }
    setMsgLoading(false);
  }

  async function sendMsg() {
    if(!authUser || !msgActiveChannel || !msgInput.trim()) return;
    setMsgSending(true);
    try {
      const {error} = await sb.rpc('send_message', {
        p_channel_id: msgActiveChannel.channel_id,
        p_content: msgInput.trim()
      });
      if(error) { showToast("Send failed: " + error.message); }
      else {
        setMsgInput("");
        await loadChannelMessages(msgActiveChannel.channel_id);
        await loadConversations();
      }
    } catch(e) { showToast("Send error: " + e.message); }
    setMsgSending(false);
  }

  // Realtime subscription for new messages
  useEffect(() => {
    if(!authUser) return;
    const channel = sb.channel('messages-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const msg = payload.new;
        // If we're in the active chat, refresh messages
        if(msgActiveChannel && msg.channel_id === msgActiveChannel.channel_id) {
          loadChannelMessages(msg.channel_id);
        }
        // Always refresh unread + conversations
        loadUnreadCount();
        loadConversations();
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [authUser?.id, msgActiveChannel?.channel_id]);

  // Realtime subscription for friend exercise completions (in-app banner)
  useEffect(() => {
    if(!authUser || friends.length === 0) return;
    const friendIds = friends.map(f => f.id);
    // Snapshot current log lengths so only genuinely new entries trigger banners
    friends.forEach(f => {
      if(friendLogLengthsRef.current[f.id] === undefined)
        friendLogLengthsRef.current[f.id] = (f.log || []).length;
    });
    const channel = sb.channel('friend-exercise-realtime')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
      }, payload => {
        const fId = payload.new.id;
        if(!friendIds.includes(fId)) return; // not a friend
        const fData = payload.new.data;
        if(!fData || !fData.log || fData.log.length === 0) return;
        const prevLen = friendLogLengthsRef.current[fId] || 0;
        const newLen = fData.log.length;
        if(newLen <= prevLen) { friendLogLengthsRef.current[fId] = newLen; return; }
        friendLogLengthsRef.current[fId] = newLen;
        // Check notification preference via ref (avoids stale closure)
        if(notifPrefsRef.current && notifPrefsRef.current.friendExercise === false) return;
        // New exercise logged — latest entry is at index 0
        const latest = fData.log[0];
        const friendName = fData.playerName || "A friend";
        const exId = latest.exId;
        let pbInfo = null;
        if(LEADERBOARD_PB_IDS.has(exId) && fData.exercisePBs && fData.exercisePBs[exId]) {
          pbInfo = fData.exercisePBs[exId];
        }
        showFriendExBanner({
          friendName,
          exerciseName: latest.exercise || exId || "an exercise",
          exerciseIcon: latest.icon || "\uD83D\uDCAA",
          pbInfo,
        });
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [authUser?.id, friends.map(f=>f.id).join(',')]);

  // Load unread on auth and periodically
  useEffect(() => {
    if(authUser) { loadUnreadCount(); loadConversations(); }
  }, [authUser?.id]);

  // ── LEADERBOARD ────────────────────────────────────────────
  async function loadLeaderboard() {
    setLbLoading(true);
    try {
      // Friends scope ignores state/country filters — always show all friends
      const isFriends = lbScope === 'friends';
      const {data, error} = await sb.rpc('get_leaderboard', {
        p_scope: isFriends ? 'friends' : 'community',  // RPC uses 'community' for world scope
        p_states: isFriends ? null : (lbStateFilters.length > 0 ? lbStateFilters : null),
        p_countries: isFriends ? null : (lbCountryFilters.length > 0 ? lbCountryFilters : null),
        p_limit: 100,
        p_user_id: authUser ? authUser.id : null
      });
      if(error) { console.warn('Leaderboard error:', error.message); }
      else { setLbData(data || []); }

      // Load world ranks (for showing on friends cards)
      if(isFriends) {
        const {data:ranks, error:rErr} = await sb.rpc('get_world_ranks');
        if(!rErr && ranks) setLbWorldRanks(ranks);
      }
    } catch(e) { console.warn('Leaderboard fetch error:', e.message); }
    setLbLoading(false);
  }

  async function loadLeaderboardFilters() {
    try {
      const {data, error} = await sb.rpc('get_leaderboard_filters');
      if(!error && data) {
        setLbAvailableStates(data.states || []);
        setLbAvailableCountries(data.countries || []);
      }
    } catch(e) { /* silent */ }
  }

  // Load profile IDs when authenticated
  useEffect(() => {
    if(authUser) loadProfileIds();
  }, [authUser?.id]);

  // Auto-load leaderboard when tab opens or filters change
  useEffect(() => {
    if(activeTab === 'leaderboard' && authUser) {
      loadLeaderboard();
      loadLeaderboardFilters();
    }
  }, [activeTab]);

  useEffect(() => {
    if(activeTab === 'leaderboard' && authUser && lbData !== null) {
      loadLeaderboard();
    }
  }, [lbScope, lbStateFilters, lbCountryFilters]);

  // ── PROFILE COMPLETION CHECK ────────────────────────────────
  // Blocks navigation away from Profile if state or country is missing
  // ── NAME VISIBILITY ──────────────────────────────────────────
  // Returns the name to display for a given context ("app" or "game")
  function getNameForContext(ctx, prof) {
    const p = prof || profile;
    const nv = p.nameVisibility || { displayName:["app","game"], realName:["hide"] };
    if ((nv.displayName||[]).includes(ctx)) return p.playerName || "Unknown";
    if ((nv.realName||[]).includes(ctx)) {
      const fn = p.firstName||""; const ln = p.lastName||"";
      return (fn + " " + ln).trim() || p.playerName || "Unknown";
    }
    return p.playerName || "Unknown";
  }

  // Toggle a visibility box. Enforces: app and game must each be assigned to exactly one row.
  function toggleNameVisibility(row, box) {
    setProfile(prev => {
      const nv = { ...(prev.nameVisibility || { displayName:["app","game"], realName:["hide"] }) };
      nv.displayName = [...(nv.displayName||[])];
      nv.realName = [...(nv.realName||[])];
      const otherRow = row === "displayName" ? "realName" : "displayName";

      if (box === "hide") {
        // Toggle hide on this row — move all its app/game to the other row
        if (nv[row].includes("hide")) {
          // Unhiding: give this row back whatever the other row has, take from other
          // Default: give this row "app" and "game", other gets "hide"
          nv[row] = ["app","game"];
          nv[otherRow] = ["hide"];
        } else {
          // Hiding this row: move any app/game it has to the other row
          const moving = nv[row].filter(b => b==="app"||b==="game");
          nv[otherRow] = nv[otherRow].filter(b => b!=="hide");
          moving.forEach(m => { if(!nv[otherRow].includes(m)) nv[otherRow].push(m); });
          nv[row] = ["hide"];
        }
      } else {
        // Toggling app or game
        if (nv[row].includes("hide")) {
          // Row is hidden — unhide it and give it this box, take from other row
          nv[row] = [box];
          nv[otherRow] = nv[otherRow].filter(b => b !== box);
          if (nv[otherRow].length === 0) nv[otherRow] = ["hide"];
        } else if (nv[row].includes(box)) {
          // Already has this box — remove it, give to other row
          nv[row] = nv[row].filter(b => b !== box);
          nv[otherRow] = nv[otherRow].filter(b => b !== "hide");
          if (!nv[otherRow].includes(box)) nv[otherRow].push(box);
          if (nv[row].length === 0) nv[row] = ["hide"];
        } else {
          // Doesn't have this box — add it, remove from other row
          nv[row] = nv[row].filter(b => b !== "hide");
          nv[row].push(box);
          nv[otherRow] = nv[otherRow].filter(b => b !== box);
          if (nv[otherRow].length === 0) nv[otherRow] = ["hide"];
        }
      }

      const updated = { ...prev, nameVisibility: nv };
      doSave(updated, authUser?.id||null, authUser?.email||null);
      return updated;
    });
  }

  function profileComplete() {
    return profile.state && profile.state !== '' && profile.country && profile.country !== '';
  }

  function guardProfileCompletion(callback) {
    if(activeTab === 'profile' && !profileComplete() && screen === 'main') {
      showToast("Please set your State and Country in Edit Profile before continuing.");
      return;
    }
    callback();
  }

  function guardAll(callback) {
    guardRecoveryCodes(() => guardProfileCompletion(callback));
  }

  function guardRecoveryCodes(callback) {
    if(mfaRecoveryCodes) {
      const ok = window.confirm("You have unsaved recovery codes!\n\nIf you haven't copied or downloaded them, you won't be able to see them again.\n\nLeave anyway?");
      if(!ok) return;
      setMfaRecoveryCodes(null);
    }
    callback();
  }

  // Block browser tab close / refresh while recovery codes are showing
  useEffect(()=>{
    if(!mfaRecoveryCodes) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return ()=> window.removeEventListener("beforeunload", handler);
  }, [mfaRecoveryCodes]);

  // ── SOCIAL FUNCTIONS ──────────────────────────────────────────────
  async function loadSocialData() {
    if(!authUser) return;
    setSocialLoading(true);
    try {
      // Split into two queries to avoid .or() + .eq() chain issues in Supabase JS v2
      const {data:sentAccepted} = await sb
        .from("friend_requests")
        .select("id,from_user_id,to_user_id,status")
        .eq("from_user_id", authUser.id)
        .eq("status","accepted");
      const {data:receivedAccepted} = await sb
        .from("friend_requests")
        .select("id,from_user_id,to_user_id,status")
        .eq("to_user_id", authUser.id)
        .eq("status","accepted");
      const fRows = [...(sentAccepted||[]), ...(receivedAccepted||[])];
      if(fRows.length>0) {
        const friendIds = fRows.map(r=>r.from_user_id===authUser.id?r.to_user_id:r.from_user_id);
        const {data:pRows} = await sb.from("profiles").select("id,data").in("id",friendIds);
        const enriched = friendIds.map(fid=>{
          const pRow = (pRows||[]).find(p=>p.id===fid);
          const reqRow = fRows.find(r=>r.from_user_id===fid||r.to_user_id===fid);
          return {
            id: fid,
            playerName: _optionalChain([pRow, 'optionalAccess', _36 => _36.data, 'optionalAccess', _37 => _37.playerName])||"Unknown Warrior",
            chosenClass: _optionalChain([pRow, 'optionalAccess', _38 => _38.data, 'optionalAccess', _39 => _39.chosenClass])||null,
            xp: _optionalChain([pRow, 'optionalAccess', _40 => _40.data, 'optionalAccess', _41 => _41.xp])||0,
            log: _optionalChain([pRow, 'optionalAccess', _42 => _42.data, 'optionalAccess', _43 => _43.log])||[],
            _reqId: _optionalChain([reqRow, 'optionalAccess', _44 => _44.id])||null,
          };
        });
        setFriends(enriched);
      } else { setFriends([]); }
      // Incoming pending requests
      const {data:rRows} = await sb
        .from("friend_requests")
        .select("id,from_user_id,created_at")
        .eq("to_user_id",authUser.id)
        .eq("status","pending");
      if(rRows && rRows.length>0) {
        const senderIds = rRows.map(r=>r.from_user_id);
        const {data:pRows2} = await sb.from("profiles").select("id,data").in("id",senderIds);
        const enriched2 = (rRows||[]).map(r=>{
          const p=(pRows2||[]).find(x=>x.id===r.from_user_id);
          return {reqId:r.id,userId:r.from_user_id,playerName:_optionalChain([p, 'optionalAccess', _45 => _45.data, 'optionalAccess', _46 => _46.playerName])||"Unknown Warrior"};
        });
        setFriendRequests(enriched2);
      } else { setFriendRequests([]); }
      // Outgoing pending requests
      const {data:oRows} = await sb
        .from("friend_requests")
        .select("id,to_user_id,created_at")
        .eq("from_user_id",authUser.id)
        .eq("status","pending");
      if(oRows && oRows.length>0) {
        const recipientIds = oRows.map(r=>r.to_user_id);
        const {data:pRows3} = await sb.from("profiles").select("id,data").in("id",recipientIds);
        const enriched3 = oRows.map(r=>{
          const p=(pRows3||[]).find(x=>x.id===r.to_user_id);
          return {reqId:r.id, userId:r.to_user_id, playerName:_optionalChain([p, 'optionalAccess', _47 => _47.data, 'optionalAccess', _48 => _48.playerName])||"Unknown Warrior"};
        });
        setOutgoingRequests(enriched3);
      } else { setOutgoingRequests([]); }
    } catch(e) { console.error("Social load error",e); }
    setSocialLoading(false);
  }

  async function searchFriendByEmail() {
    if(!friendSearch.trim()) return;
    setFriendSearchLoading(true); setFriendSearchResult(null); setSocialMsg(null);
    try {
      // Use RPC that accepts email OR public Account ID
      const {data, error} = await sb.rpc("find_user_for_friend_request", {
        p_identifier: friendSearch.trim()
      });
      if(error) throw error;
      if(data && data.found) {
        // Check if already friends or request pending
        const {data:existing} = await sb.from("friend_requests")
          .select("id,status")
          .or(`and(from_user_id.eq.${authUser.id},to_user_id.eq.${data.user_id}),and(from_user_id.eq.${data.user_id},to_user_id.eq.${authUser.id})`)
          .limit(1);
        setFriendSearchResult({
          found: true,
          user: {
            id: data.user_id,
            playerName: data.player_name,
            chosenClass: data.chosen_class,
            publicId: data.public_id,
          },
          matchType: data.match_type,
          existing: _optionalChain([existing, 'optionalAccess', _49 => _49[0]])||null
        });
      } else {
        setFriendSearchResult({found:false, msg:"No warrior found. Try an email or Account ID (e.g. #A7XK9M)."});
      }
    } catch(e) {
      console.error("Friend search error:", e);
      setFriendSearchResult({found:false, msg:"Search failed. Please try again."});
    }
    setFriendSearchLoading(false);
  }

  async function sendFriendRequest(toUserId) {
    if(!authUser) return;
    const {error} = await sb.from("friend_requests").insert({from_user_id:authUser.id,to_user_id:toUserId,status:"pending"});
    if(error) setSocialMsg({ok:false,text:"Error: "+error.message});
    else {
      setSocialMsg({ok:true,text:"⚔️ Party Request has been sent!"});
      setTimeout(()=>setSocialMsg(null), 2000);
      setFriendSearchResult(null);
      setFriendSearch("");
      loadSocialData();
    }
  }

  async function rescindFriendRequest(reqId, userId) {
    await sb.from("friend_requests").delete().eq("id", reqId);
    setFriendSearchResult(r => r ? {...r, existing: null} : r);
    setOutgoingRequests(o=>o.filter(r=>r.reqId!==reqId));
    setSocialMsg({ok:null, text:"Request withdrawn."});
    setTimeout(()=>setSocialMsg(null), 2000);
  }

  async function acceptFriendRequest(reqId) {
    const {error} = await sb.from("friend_requests").update({status:"accepted"}).eq("id",reqId);
    if(!error) {
      // Small delay so Supabase commit is visible before re-fetching
      setTimeout(()=>loadSocialData(), 500);
    }
  }

  async function rejectFriendRequest(reqId) {
    await sb.from("friend_requests").delete().eq("id",reqId);
    loadSocialData();
  }

  async function removeFriend(reqId) {
    const {error} = await sb.from("friend_requests").delete().eq("id",reqId);
    if(!error) {
      setFriends(f=>f.filter(fr=>fr._reqId!==reqId));
      showToast("Friend removed.");
    } else {
      showToast("Could not remove friend. Try again.");
    }
  }

  async function shareWithFriend(type, item, toUserId, toName) {
    if(!authUser) return;
    try {
      const payload = {
        from_user_id: authUser.id,
        to_user_id: toUserId,
        type,
        item_id: item.id,
        item_data: JSON.stringify(item),
        status: "pending",
        created_at: new Date().toISOString(),
      };
      const {error} = await sb.from("shared_items").insert(payload);
      if(error) throw error;
      showToast(`Shared with ${toName}! ✦`);
      setShareModal(null);
    } catch(e) {
      showToast("Share failed. Try again.");
    }
  }

  async function loadIncomingShares() {
    if(!authUser) return;
    try {
      const {data} = await sb.from("shared_items")
        .select("id,from_user_id,type,item_id,item_data,created_at")
        .eq("to_user_id", authUser.id)
        .eq("status","pending");
      if(data && data.length>0) {
        const senderIds=[...new Set(data.map(d=>d.from_user_id))];
        const {data:pRows} = await sb.from("profiles").select("id,data").in("id",senderIds);
        const enriched = data.map(s=>({
          ...s,
          senderName:_optionalChain([(pRows||[]), 'access', _50 => _50.find, 'call', _51 => _51(p=>p.id===s.from_user_id), 'optionalAccess', _52 => _52.data, 'optionalAccess', _53 => _53.playerName])||"A warrior",
          parsedItem: (() => { try { return JSON.parse(s.item_data); } catch(e){ return null; } })(),
        }));
        setIncomingShares(enriched);
      } else { setIncomingShares([]); }
    } catch(e) { console.error("loadIncomingShares error",e); }
  }

  async function acceptShare(share) {
    try {
      const item = share.parsedItem;
      if(!item) return;
      if(share.type==="workout") {
        const newWo = {...item, id:uid(), createdAt:new Date().toLocaleDateString()};
        setProfile(p=>({...p, workouts:[...(p.workouts||[]), newWo]}));
        showToast(`💪 "${item.name}" added to your workouts!`);
      } else if(share.type==="exercise") {
        const newEx = {...item, id:uid(), custom:true};
        setProfile(p=>({...p, customExercises:[...(p.customExercises||[]), newEx]}));
        showToast(`⚡ "${item.name}" added to your exercises!`);
      }
      await sb.from("shared_items").update({status:"accepted"}).eq("id",share.id);
      setIncomingShares(s=>s.filter(x=>x.id!==share.id));
    } catch(e) { showToast("Could not accept share."); }
  }

  async function declineShare(shareId) {
    await sb.from("shared_items").update({status:"declined"}).eq("id",shareId);
    setIncomingShares(s=>s.filter(x=>x.id!==shareId));
    showToast("Share declined.");
  }

  async function signOut() {
    const prevUserId = _optionalChain([authUser, 'optionalAccess', _signOut1 => _signOut1.id]);
    await sb.auth.signOut();
    // Wipe locally-cached PII so a shared device can't leak data to the next user.
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
    if(prevUserId) { try { localStorage.removeItem("aurisar_ob_draft_"+prevUserId); } catch(e) {} }
    try { sessionStorage.removeItem("ilf_no_persist"); } catch(e) {}
    setAuthUser(null);
    setProfile(EMPTY_PROFILE);
    // Clear all social state so next user starts fresh
    setSocialMsg(null);
    setFriendSearch("");
    setFriendSearchResult(null);
    setFriends([]);
    setFriendRequests([]);
    setOutgoingRequests([]);
    setIncomingShares([]);
    setLogSubTab("exercises");
    setNotifMode(false);
    setMfaEnabled(false);
    setMfaFactorId(null);
    setMfaEnrolling(false);
    setMfaQR(null);
    setMfaCode("");
    setMfaMsg(null);
    setMfaRecoveryCodes(null);
    setMfaCodesRemaining(null);
    setMfaChallengeScreen(false);
    setMfaChallengeCode("");
    setMfaChallengeMsg(null);
    setMfaRecoveryMode(false);
    setMfaRecoveryInput("");
    setMfaChallengeFactorId(null);
    setMfaDisableConfirm(false);
    setMfaDisableCode("");
    setMfaDisableMsg(null);
    setPhonePanelOpen(false);
    setPhoneInput("");
    setPhoneOtpSent(false);
    setPhoneOtpCode("");
    setPhoneMsg(null);
    setEmailPanelOpen(false);
    setEmailMsg(null);
    setNewEmail("");
    setScreen("landing");
  }

  // ── Legacy class migration — maps old keys to new equivalents ──
  const CLASS_MIGRATION = {
    ranger:"warden", monk:"druid", mage:"druid",
    paladin:"warlord", rogue:"phantom",
    berserker:"gladiator", valkyrie:"gladiator",
  };
  const resolveClass = key => {
    if(!key) return null;
    if(CLASSES[key]) return key;
    return CLASS_MIGRATION[key] || "warrior";
  };
  const rawClass    = profile.chosenClass;
  const clsKey      = resolveClass(rawClass);
  const cls         = CLASSES[clsKey] || CLASSES["warrior"];
  const level    = xpToLevel(profile.xp);
  const curXP    = xpForLevel(level);
  const nxtXP    = xpForNext(level);
  const progress = ((profile.xp-curXP)/(nxtXP-curXP))*100;
  const totalH   = (parseInt(profile.heightFt)||0)*12+(parseInt(profile.heightIn)||0);
  const bmi      = calcBMI(profile.weightLbs,totalH);

  // Merged exercise list (built-in + custom) — memoized to avoid rebuilding on every render
  const _customExRef = profile.customExercises;
  const allExercises = useMemo(()=>[...EXERCISES, ...(_customExRef||[])].filter(e=>e&&e.id&&e.name), [_customExRef, _exReady]);
  const allExById = useMemo(()=>Object.fromEntries(allExercises.map(e=>[e.id,e])), [allExercises]);

  const wbTotalXP = useMemo(()=>wbExercises.reduce((s,ex)=>{
    const _exD=allExById[ex.exId];const _isCardio=_exD&&_exD.category==="cardio";
    const b=calcExXP(ex.exId,ex.sets||3,ex.reps||10,profile.chosenClass,allExById);
    const r=(ex.extraRows||[]).reduce((rs,row)=>rs+calcExXP(ex.exId,parseInt(row.sets)||parseInt(ex.sets)||3,parseInt(row.reps)||parseInt(ex.reps)||10,profile.chosenClass,allExById),0);
    const t=(_isCardio&&(ex.extraRows||[]).length>0)?Math.round((b+r)*1.25):(b+r);
    return s+t;
  },0),[wbExercises,profile.chosenClass,allExById]);

  // Auto-update quest completion state when log or streak changes
  const computedQuests = () => {
    const updated = {...(profile.quests||{})};
    QUESTS.forEach(q=>{
      if(_optionalChain([updated, 'access', _54 => _54[q.id], 'optionalAccess', _55 => _55.completed])) return; // already done
      const done = checkQuestCompletion(q, profile.log, profile.checkInStreak);
      if(done) updated[q.id] = {...(updated[q.id]||{}), completed:true, completedAt:todayStr()};
    });
    return updated;
  };

  function claimQuestReward(qId) {
    const q = QUESTS.find(x=>x.id===qId); if(!q) return;
    const qState = profile.quests[qId]||{};
    if(qState.claimed) return;
    const newQuests = {...profile.quests, [qId]:{...qState,completed:true,completedAt:todayStr(),claimed:true}};
    setProfile(p=>({...p,xp:p.xp+q.xp,quests:newQuests}));
    setXpFlash({amount:q.xp,mult:1});
    setTimeout(()=>setXpFlash(null),2200);
    showToast(`Quest complete! +${q.xp.toLocaleString()} XP ✦`);
  }

  function claimManualQuest(qId) {
    const q=QUESTS.find(x=>x.id===qId); if(!q||!q.manual) return;
    const qState=profile.quests[qId]||{};
    if(qState.completed) return;
    const newQuests={...profile.quests,[qId]:{completed:true,completedAt:todayStr(),claimed:false}};
    setProfile(p=>({...p,quests:newQuests}));
    showToast("Quest unlocked! Claim your reward.");
  }

  // Jack in
  // Rebuild streak + lastCheckIn from a sorted list of unique YYYY-MM-DD check-in dates
  function rebuildStreakFromHistory(history) {
    if(!history||history.length===0) return {checkInStreak:0,lastCheckIn:null,totalCheckIns:0};
    const sorted = [...new Set(history)].sort(); // ascending, deduplicated
    const last = sorted[sorted.length-1];
    // Walk backwards from the last date to count consecutive days
    let streak = 1;
    for(let i=sorted.length-2; i>=0; i--) {
      const curr = new Date(sorted[i+1]+"T12:00:00");
      const prev = new Date(sorted[i]+"T12:00:00");
      const diff = Math.round((curr-prev)/(1000*60*60*24));
      if(diff===1) streak++;
      else break;
    }
    return {checkInStreak:streak, lastCheckIn:last, totalCheckIns:sorted.length};
  }
  function doCheckIn() {
    const today = todayStr();
    const history = [...(profile.checkInHistory||[])];
    if(history.includes(today)) { showToast("Already checked in today!"); return; }
    history.push(today);
    const {checkInStreak:newStreak, lastCheckIn, totalCheckIns:newTotal} = rebuildStreakFromHistory(history);
    const xpEarned = newStreak%7===0 ? 500 : 125;
    const newQuests = {...profile.quests};
    QUESTS.filter(q=>q.streak).forEach(q=>{
      if(!_optionalChain([newQuests, 'access', _56 => _56[q.id], 'optionalAccess', _57 => _57.completed]) && newStreak>=q.streak)
        newQuests[q.id]={completed:true,completedAt:today,claimed:false};
    });
    setProfile(p=>({...p,lastCheckIn,checkInStreak:newStreak,totalCheckIns:newTotal,checkInHistory:history,xp:p.xp+xpEarned,quests:newQuests}));
    setXpFlash({amount:xpEarned,mult:1});
    setTimeout(()=>setXpFlash(null),2000);
    showToast(`Checked in! +${xpEarned} XP · ${newStreak} day streak 🔥`);
  }
  function applyAutoCheckIn(base, dateKey) {
    const today = todayStr();
    if(dateKey !== today) return {profile:base, checkInApplied:false, checkInXP:0, checkInStreak:base.checkInStreak||0};
    if((base.checkInHistory||[]).includes(today)) return {profile:base, checkInApplied:false, checkInXP:0, checkInStreak:base.checkInStreak||0};
    const history = [...(base.checkInHistory||[]), today];
    const {checkInStreak, lastCheckIn, totalCheckIns} = rebuildStreakFromHistory(history);
    const xpEarned = checkInStreak%7===0 ? 500 : 125;
    const quests = {...(base.quests||{})};
    QUESTS.filter(q=>q.streak).forEach(q=>{
      if(!_optionalChain([quests, 'access', _ => _[q.id], 'optionalAccess', _ => _.completed]) && checkInStreak>=q.streak)
        quests[q.id]={completed:true, completedAt:today, claimed:false};
    });
    return {
      profile:{...base, lastCheckIn, checkInStreak, totalCheckIns, checkInHistory:history, xp:base.xp+xpEarned, quests},
      checkInApplied:true, checkInXP:xpEarned, checkInStreak,
    };
  }
  function doRetroCheckIn() {
    if(!retroDate) { showToast("Pick a date first!"); return; }
    if(retroDate>todayStr()) { showToast("Can't check in for a future date!"); return; }
    const history = [...(profile.checkInHistory||[])];
    if(history.includes(retroDate)) { showToast("Already checked in for that day!"); return; }
    history.push(retroDate);
    const {checkInStreak:newStreak, lastCheckIn, totalCheckIns:newTotal} = rebuildStreakFromHistory(history);
    const newQuests = {...profile.quests};
    QUESTS.filter(q=>q.streak).forEach(q=>{
      if(!_optionalChain([newQuests, 'access', _58 => _58[q.id], 'optionalAccess', _59 => _59.completed]) && newStreak>=q.streak)
        newQuests[q.id]={completed:true,completedAt:todayStr(),claimed:false};
    });
    setProfile(p=>({...p,lastCheckIn,checkInStreak:newStreak,totalCheckIns:newTotal,checkInHistory:history,xp:p.xp+125,quests:newQuests}));
    setXpFlash({amount:125,mult:1}); setTimeout(()=>setXpFlash(null),2000);
    const d = new Date(retroDate+"T12:00:00");
    showToast("Retro check-in for "+d.toLocaleDateString([],{month:"short",day:"numeric"})+"! +125 XP · "+newStreak+" day streak 🔥");
    setRetroDate(""); setRetroCheckInModal(false);
  }

  // Onboarding
  function handleOnboard() {
    if(!obName.trim() || !obFirstName.trim() || !obLastName.trim()) return;
    const cls = detectClassFromAnswers(obSports, obPriorities, obStyle);
    const trait = obTiming==="earlymorning"?"Iron Discipline":obTiming==="morning"?"Disciplined":obTiming==="evening"?"Night Owl":"";
    setProfile(p=>({...p, playerName:obName, firstName:obFirstName, lastName:obLastName, age:obAge, gender:obGender,
      state:obState, country:obCountry,
      sportsBackground:obSports, fitnessPriorities:obPriorities,
      trainingStyle:obStyle, workoutTiming:obTiming, workoutFreq:obFreq, disciplineTrait:trait}));
    setDetectedClass(cls);
    setScreen("classReveal");
  }
  function confirmClass(c) {
    try { if(authUser) localStorage.removeItem("aurisar_ob_draft_"+authUser.id); } catch(e) {}
    const p={...profile,chosenClass:c}; setProfile(p); doSave(p, _optionalChain([authUser, 'optionalAccess', _60 => _60.id])||null, _optionalChain([authUser, 'optionalAccess', _61 => _61.email])||null); setScreen("main");
  }

  // Quick log
  function getMult(ex){ return clsKey?(CLASSES[clsKey]?.bonuses[ex.category]||1):1; }

  // ── Exercise editor ─────────────────────────────────────────
  const EX_ICON_LIST = ["🏋️","💪","⚡","🦾","🪃","🏃","🚴","🔥","⭕","🧘","🤸","🧱","🪝","🏊","🔻","🦵","🚶","🧗","🎯","🏌️","⛹️","🤼","🏇","🥊","🤺","🏋","🦶","🫀","🧠","🛌","💤","🌙","☕","🧊","🏖️"];
  function newExDraft(base){ return { id:uid(), name:base?base.name+" (Copy)":(""), icon:base?base.icon:"💪", category:base?base.category:"strength", muscleGroup:base?base.muscleGroup:"chest", baseXP:base?base.baseXP:40, muscles:base?base.muscles:"", desc:base?base.desc:"", tips:base?[...base.tips]:["","",""], custom:true, defaultSets:base?(base.defaultSets!=null?base.defaultSets:null):3, defaultReps:base?(base.defaultReps!=null?base.defaultReps:null):10, defaultWeightLbs:base?base.defaultWeightLbs||"":"", defaultWeightPct:base?base.defaultWeightPct||100:100, defaultHrZone:base?base.defaultHrZone||null:null }; }
  function openExEditor(mode, baseEx){ setExEditorMode(mode); setExEditorDraft(newExDraft(mode==="create"?null:baseEx)); setExEditorOpen(true); }
  function saveExEditor(){
    const d=exEditorDraft;
    if(!d.name.trim()){ showToast("Exercise needs a name!"); return; }
    if(exEditorMode==="edit"){
      const updated=(profile.customExercises||[]).map(e=>e.id===d.id?{...d}:e);
      setProfile(p=>({...p,customExercises:updated}));
    } else {
      const newEx={...d, id:uid()};
      setProfile(p=>({...p,customExercises:[...(p.customExercises||[]),newEx]}));
    }
    setExEditorOpen(false);
    showToast(exEditorMode==="edit"?"Exercise patched! ⚡":"New exercise uploaded! ⚡");
  }
  function deleteCustomEx(id){
    const ex=(profile.customExercises||[]).find(e=>e.id===id);
    setConfirmDelete({type:"exercise",id,name:ex?ex.name:"this exercise",icon:ex?ex.icon:"💪"});
  }
  function _doDeleteCustomEx(id){
    setProfile(p=>({...p,customExercises:(p.customExercises||[]).filter(e=>e.id!==id)}));
    setExEditorOpen(false);
    showToast("Exercise deleted.");
  }
  function logExercise() {
    if(!selEx) return;
    const ex=allExById[selEx];
    if(!ex) return;
    const metric = isMetric(profile.units);
    const noSetsEx = NO_SETS_EX_IDS.has(ex.id);
    const mult=getMult(ex),rv=parseInt(reps)||0,sv=noSetsEx?1:(parseInt(sets)||0);
    // Convert weight to lbs for internal storage/XP (weight input already reflects intensity)
    const rawW = parseFloat(exWeight||0);
    const weightInLbs = metric ? parseFloat(kgToLbs(rawW)) : rawW;
    const effectiveW = weightInLbs;
    // Convert distance to miles for storage
    const rawDist = parseFloat(distanceVal||0);
    const distMi = rawDist>0 ? (metric ? parseFloat(kmToMi(rawDist)) : rawDist) : null;
    const isCardioEx = ex.category==="cardio";
    const canHaveZone = isCardioEx;
    const zoneBonus = canHaveZone && hrZone ? 1 + (hrZone-1)*0.04 : 1;
    const weightBonus = effectiveW>0 ? 1 + Math.min(effectiveW/500, 0.3) : 1;
    const distBonus = distMi ? 1 + Math.min(distMi*0.05, 0.5) : 1;
    // Running pace boost: +5% if both duration+dist provided, +20% if sub-8 min/mile
    const durationMin = rv;
    const runPace = (ex.id===RUNNING_EX_ID && distMi && durationMin) ? durationMin/distMi : null;
    const paceBonus = runPace ? (runPace<=8 ? 1.20 : 1.05) : 1;
    const earned=Math.round(ex.baseXP*mult*(1+(rv*sv-1)*0.05)*zoneBonus*weightBonus*distBonus*paceBonus);
    // Apply 10% travel boost if active this week
    const weekStart = ()=>{ const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); };
    const travelActive = profile.travelBoost && profile.travelBoost.weekStart === weekStart();
    // Apply 7% region boost if exercise matches current region's muscle group
    const myRegionIdx = getRegionIdx(xpToLevel(profile.xp));
    const myRegion = MAP_REGIONS[myRegionIdx];
    const regionBoost = myRegion && (myRegion.boost.muscle==="all" || myRegion.boost.muscle===ex.muscleGroup) ? 1.07 : 1;
    const travelMult = travelActive ? 1.1 : 1;
    const finalEarned = Math.round(earned * travelMult * regionBoost);
    // Capture current state values before clearing UI
    const capturedPendingSoloRemoveId = pendingSoloRemoveId;
    const capturedHrZone = (canHaveZone&&hrZone)||null;
    // Show stats popup, then completion modal for Complete/Schedule
    const synth = {name:ex.name, icon:ex.icon, exercises:[], durationMin:null, activeCal:null, totalCal:null, soloEx:true, _soloExId:ex.id};
    openStatsPromptIfNeeded(synth, (woWithStats, _sr) => {
      const soloExCallback = (dateStr) => {
        const dateObj = new Date(dateStr+"T12:00:00");
        const displayDate = dateObj.toLocaleDateString();
        const entry={
          exercise:ex.name, icon:ex.icon, xp:finalEarned, mult, reps:rv, sets:sv,
          weightLbs:effectiveW||null, weightPct,
          hrZone:capturedHrZone,
          distanceMi:distMi||null,
          time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),
          date:displayDate,
          dateKey:dateStr,
          exId:ex.id,
          sourceTotalCal: woWithStats.totalCal || null,
          sourceActiveCal: woWithStats.activeCal || null,
          sourceDurationSec: woWithStats.durationMin || null,
        };
        const newLog=[entry,...profile.log];
        const newQuests={...(profile.quests||{})};
        QUESTS.filter(q=>q.auto&&!_optionalChain([newQuests, 'access', _62 => _62[q.id], 'optionalAccess', _63 => _63.completed])).forEach(q=>{
          if(checkQuestCompletion(q,newLog,profile.checkInStreak))
            newQuests[q.id]={completed:true,completedAt:todayStr(),claimed:false};
        });
        let newPB = profile.runningPB || null;
        if(runPace && (!newPB || runPace < newPB)) newPB = runPace;
        const newExPBs = calcExercisePBs(newLog);
        const oldPB = (profile.exercisePBs||{})[entry.exId];
        const curPB = newExPBs[entry.exId];
        const isNewPB = curPB && (!oldPB || curPB.value !== oldPB.value);
        let _ciResult = {checkInApplied:false, checkInXP:0, checkInStreak:0};
        setProfile(p=>{
          const base = {...p,xp:p.xp+finalEarned,log:newLog,quests:newQuests,runningPB:newPB!==null?newPB:p.runningPB,exercisePBs:newExPBs};
          if(capturedPendingSoloRemoveId) base.scheduledWorkouts=(p.scheduledWorkouts||[]).filter(s=>s.id!==capturedPendingSoloRemoveId);
          const ci = applyAutoCheckIn(base, dateStr);
          _ciResult = ci;
          return ci.profile;
        });
        if(capturedPendingSoloRemoveId) setPendingSoloRemoveId(null);
        setXpFlash({amount:finalEarned+_ciResult.checkInXP,mult,travel:travelActive});
        setTimeout(()=>setXpFlash(null),2000);
        const ciSuffix = _ciResult.checkInApplied ? ` · Checked in! +${_ciResult.checkInXP} XP · ${_ciResult.checkInStreak} day streak 🔥` : "";
        if(newPB!==null && newPB===runPace && (!profile.runningPB || runPace<profile.runningPB))
          showToast(`🏆 New Personal Best! ${metric?parseFloat((runPace*1.60934).toFixed(2))+" min/km":parseFloat(runPace.toFixed(2))+" min/mi"}${ciSuffix}`);
        else if(isNewPB && curPB.type==="strength")
          showToast(`🏆 New 1RM! ${ex.name} — ${curPB.value} lbs${ciSuffix}`);
        else if(isNewPB && curPB.type==="assisted")
          showToast(`🏆 New 1RM! ${ex.name} — ${curPB.value} lbs (assisted PR)${ciSuffix}`);
        else showToast((travelActive&&regionBoost>1?`+${finalEarned} XP (+10% travel, +7% ${myRegion.boost.label}) ⚔️`:travelActive?`+${finalEarned} XP (+10% travel bonus) ⚔️`:regionBoost>1?`+${finalEarned} XP (+7% ${myRegion.boost.label} boost) ${myRegion.icon}`:`+${finalEarned} XP earned!`)+ciSuffix);
        // Clean up form state after successful completion
        setSets("");setReps("");setExWeight("");setWeightPct(100);setHrZone(null);setDistanceVal("");
        setExHHMM("");setExSec("");setQuickRows([]);
      };
      const soloExScheduleCallback = (schedDate) => {
        const sw = {id:uid(), exId:ex.id, scheduledDate:schedDate, notes:ex.name, createdAt:todayStr()};
        setProfile(p=>({...p, scheduledWorkouts:[...(p.scheduledWorkouts||[]), sw]}));
        setCompletionModal(null); setCompletionDate(""); setCompletionAction("today"); setScheduleWoDate("");
        showToast(`📅 ${ex.name} scheduled for ${formatScheduledDate(schedDate)}!`);
        // Clean up form state
        setSets("");setReps("");setExWeight("");setWeightPct(100);setHrZone(null);setDistanceVal("");
        setExHHMM("");setExSec("");setQuickRows([]);
      };
      setCompletionModal({workout:woWithStats, fromStats:_sr, soloExCallback, soloExScheduleCallback});
      setCompletionDate(todayStr()); setCompletionAction("today");
    });
    setSelEx(null);
  }

  // Log a scheduled solo exercise with default values and remove it from schedule (shows stats popup first)
  function quickLogSoloEx(sw) {
    const ex = allExById[sw.exId];
    if (!ex) return;
    const noSetsEx = NO_SETS_EX_IDS.has(ex.id);
    const sv = noSetsEx ? 1 : (ex.defaultSets != null ? ex.defaultSets : 3);
    const rv = ex.defaultReps != null ? ex.defaultReps : 10;
    const mult = getMult(ex);
    const earned = Math.round(ex.baseXP * mult * (1 + (rv * sv - 1) * 0.05));
    const weekStart = () => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); };
    const travelActive = profile.travelBoost && profile.travelBoost.weekStart === weekStart();
    const myRegionIdx = getRegionIdx(xpToLevel(profile.xp));
    const myRegion = MAP_REGIONS[myRegionIdx];
    const regionBoost = myRegion && (myRegion.boost.muscle==="all" || myRegion.boost.muscle===ex.muscleGroup) ? 1.07 : 1;
    const finalEarned = Math.round(earned * (travelActive ? 1.1 : 1) * regionBoost);
    // Show stats popup, then log on confirm
    const synth = {name:ex.name, icon:ex.icon, exercises:[], durationMin:null, activeCal:null, totalCal:null, soloEx:true};
    openStatsPromptIfNeeded(synth, (woWithStats) => {
      const entry = {
        exercise: ex.name, icon: ex.icon, xp: finalEarned, mult, reps: rv, sets: sv,
        weightLbs: null, weightPct: 100, hrZone: null, distanceMi: null,
        time: new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),
        date: new Date().toLocaleDateString(),
        dateKey: todayStr(),
        exId: ex.id,
        sourceTotalCal: woWithStats.totalCal || null,
        sourceActiveCal: woWithStats.activeCal || null,
        sourceDurationSec: woWithStats.durationMin || null,
      };
      const newQuests = {...(profile.quests||{})};
      QUESTS.filter(q => q.auto && !_optionalChain([newQuests, 'access', _62 => _62[q.id], 'optionalAccess', _63 => _63.completed])).forEach(q => {
        if (checkQuestCompletion(q, [entry, ...profile.log], profile.checkInStreak))
          newQuests[q.id] = {completed:true, completedAt:todayStr(), claimed:false};
      });
      const newLog = [entry, ...profile.log];
      const newExPBs = calcExercisePBs(newLog);
      let _ciResult = {checkInApplied:false, checkInXP:0, checkInStreak:0};
      setProfile(p => {
        const base = {
          ...p,
          xp: p.xp + finalEarned,
          log: [entry, ...p.log],
          quests: newQuests,
          exercisePBs: newExPBs,
          scheduledWorkouts: (p.scheduledWorkouts||[]).filter(s => s.id !== sw.id),
        };
        const ci = applyAutoCheckIn(base, todayStr());
        _ciResult = ci;
        return ci.profile;
      });
      const ciSuffix = _ciResult.checkInApplied ? ` · Checked in! +${_ciResult.checkInXP} XP · ${_ciResult.checkInStreak} day streak 🔥` : "";
      setXpFlash({amount: finalEarned+_ciResult.checkInXP, mult, travel: travelActive});
      setTimeout(() => setXpFlash(null), 2000);
      showToast((travelActive && regionBoost>1 ? `+${finalEarned} XP (+10% travel, +7% ${myRegion.boost.label}) ⚔️` : travelActive ? `+${finalEarned} XP (+10% travel bonus) ⚔️` : regionBoost>1 ? `+${finalEarned} XP (+7% ${myRegion.boost.label} boost) ${myRegion.icon}` : `+${finalEarned} XP earned!`)+ciSuffix);
    });
  }

  // Save a set of log entries (from history) as a custom plan template
  // Open "Save To Plan" wizard from history (renamed from Save as Plan)
  function openSavePlanWizard(entries, label) {
    setSavePlanWizard({entries, label});
    setSpwName(label + " Repeat");
    setSpwIcon("📋");
    setSpwDate("");
    setSpwSelected(entries.map(e=>e._idx)); // all pre-selected
    setSpwMode("new");
    setSpwTargetPlanId(null);
  }
  function confirmSavePlanWizard() {
    if(!savePlanWizard) return;
    const selected = savePlanWizard.entries.filter(e=>spwSelected.includes(e._idx));
    if(selected.length===0) { showToast("Select at least one exercise."); return; }
    const exRows = selected.map(e=>({exId:e.exId||"bench", sets:e.sets||3, reps:e.reps||10, weightLbs:e.weightLbs||null}));
    if(spwMode==="existing") {
      if(!spwTargetPlanId) { showToast("Pick a plan to add to!"); return; }
      const targetPlan = profile.plans.find(p=>p.id===spwTargetPlanId);
      if(!targetPlan) { showToast("Plan not found."); return; }
      const newDay = {label:"Added "+savePlanWizard.label, exercises:exRows};
      const updatedPlan = {...targetPlan, days:[...targetPlan.days, newDay]};
      setProfile(pr=>({...pr,plans:pr.plans.map(p=>p.id===spwTargetPlanId?updatedPlan:p)}));
      setSavePlanWizard(null);
      showToast("Added to "+targetPlan.name+" ⚔️");
    } else {
      if(!spwName.trim()) { showToast("Give your plan a name!"); return; }
      const days=[{label:"Day 1", exercises: exRows}];
      const p={id:uid(), name:spwName.trim(), icon:spwIcon, type:"day",
        description:"Saved from "+savePlanWizard.label, bestFor:[], days,
        createdAt:new Date().toLocaleDateString(), custom:true,
        scheduledDate: spwDate||null,
      };
      setProfile(pr=>({...pr,plans:[p,...pr.plans]}));
      setSavePlanWizard(null);
      showToast("Contract saved! ⚡" + (spwDate?" · Scheduled for "+formatScheduledDate(spwDate):""));
    }
  }

  // Open "Save As Workout" wizard from history
  function openSaveWorkoutWizard(entries, label) {
    setSaveWorkoutWizard({entries, label});
    setSwwName(label);
    setSwwIcon("💪");
    setSwwSelected(entries.map(e=>e._idx));
  }
  function confirmSaveWorkoutWizard() {
    if(!saveWorkoutWizard) return;
    if(!swwName.trim()) { showToast("Give your workout a name!"); return; }
    const selected = saveWorkoutWizard.entries.filter(e=>swwSelected.includes(e._idx));
    if(selected.length===0) { showToast("Select at least one exercise."); return; }
    const exercises = selected.map(e=>({exId:e.exId||"bench", sets:e.sets||3, reps:e.reps||10, weightLbs:e.weightLbs||null, durationMin:null}));
    const w = {id:uid(), name:swwName.trim(), icon:swwIcon, desc:"Saved from "+saveWorkoutWizard.label, exercises, createdAt:new Date().toLocaleDateString()};
    setProfile(pr=>({...pr, workouts:[w,...(pr.workouts||[])]}));
    setSaveWorkoutWizard(null);
    showToast(swwIcon+" "+swwName+" saved to Workouts! 💪");
  }

  // Workout builder helpers
  function initWorkoutBuilder(base) {
    if(base) {
      setWbName(base.name); setWbIcon(base.icon); setWbDesc(base.desc||"");
      setWbExercises(base.exercises.map(e=>({...e}))); setWbEditId(base.id);
      const split = base.durationMin ? secToHHMMSplit(Number(base.durationMin)) : {hhmm:"",sec:""};
      setWbDuration(split.hhmm); setWbDurSec(split.sec!==0&&split.sec!==""?String(split.sec):"");
      setWbActiveCal(base.activeCal||""); setWbTotalCal(base.totalCal||"");
      setWbLabels(base.labels||[]);
    } else {
      setWbName(""); setWbIcon("💪"); setWbDesc(""); setWbExercises([]); setWbEditId(null);
      setWbDuration(""); setWbDurSec(""); setWbActiveCal(""); setWbTotalCal("");
      setWbLabels([]);
    }
    setWbIsOneOff(false);
    setNewLabelInput("");
    setWorkoutView("builder");
  }
  function saveBuiltWorkout() {
    if(!wbName.trim()) { showToast("Name your workout first!"); return; }
    if(wbExercises.length===0) { showToast("Add at least one exercise."); return; }
    const w = {id:wbEditId||uid(), name:wbName.trim(), icon:wbIcon, desc:wbDesc.trim(),
      exercises:wbExercises, createdAt:new Date().toLocaleDateString(),
      durationMin:combineHHMMSec(wbDuration,wbDurSec)||null, activeCal:wbActiveCal||null, totalCal:wbTotalCal||null,
      labels:wbLabels};
    if(wbEditId) {
      setProfile(pr=>({...pr, workouts:(pr.workouts||[]).map(wo=>wo.id===wbEditId?w:wo)}));
      showToast("Workout updated! 💪");
    } else {
      setProfile(pr=>({...pr, workouts:[w,...(pr.workouts||[])]}));
      showToast("Workout created! 💪");
    }
    setWorkoutView("list"); setActiveWorkout(null); setWbEditId(null); setWbCopySource(null);
    setWbDuration(""); setWbDurSec(""); setWbActiveCal(""); setWbTotalCal("");
    setWbLabels([]); setNewLabelInput("");
  }
  function saveAsNewWorkout() {
    if(!wbName.trim()) { showToast("Name your workout first!"); return; }
    if(wbExercises.length===0) { showToast("Add at least one exercise."); return; }
    const w = {id:uid(), name:wbName.trim(), icon:wbIcon, desc:wbDesc.trim(),
      exercises:wbExercises, createdAt:new Date().toLocaleDateString(),
      durationMin:combineHHMMSec(wbDuration,wbDurSec)||null, activeCal:wbActiveCal||null, totalCal:wbTotalCal||null,
      labels:wbLabels};
    setProfile(pr=>({...pr, workouts:[w,...(pr.workouts||[])]}));
    showToast("Saved as new workout! 💪");
    setWorkoutView("list"); setActiveWorkout(null); setWbEditId(null); setWbCopySource(null);
    setWbDuration(""); setWbDurSec(""); setWbActiveCal(""); setWbTotalCal("");
    setWbLabels([]); setNewLabelInput("");
  }
  function copyWorkout(wo) {
    setWbName("Copy of "+wo.name);
    setWbIcon(wo.icon);
    setWbDesc(wo.desc||"");
    setWbExercises(wo.exercises.map(e=>({...e})));
    setWbEditId(null); // new id on save
    setWbCopySource(wo.name);
    setWbLabels(wo.labels||[]);
    setNewLabelInput("");
    setWorkoutView("builder");
  }
  function deleteWorkout(id) {
    const wo=(profile.workouts||[]).find(w=>w.id===id);
    setConfirmDelete({type:"workout",id,name:wo?wo.name:"this workout",icon:wo?wo.icon:"💪"});
  }
  function _doDeleteWorkout(id) {
    const wo = (profile.workouts||[]).find(w=>w.id===id);
    if(!wo) return;
    const bin = [...(profile.deletedItems||[]), {id:uid(), type:"workout", item:wo, deletedAt:new Date().toISOString()}];
    setProfile(p=>({...p, workouts:(p.workouts||[]).filter(w=>w.id!==id), deletedItems:bin}));
    setWorkoutView("list"); setActiveWorkout(null);
    showToast("Workout moved to Deleted — recoverable for 7 days.");
  }
  function addExToWorkout(exId) {
    const exd = allExById[exId]||{};
    setWbExercises(ex=>[...ex,{exId,sets:(exd.defaultSets!=null?exd.defaultSets:3),reps:(exd.defaultReps!=null?exd.defaultReps:10),weightLbs:exd.defaultWeightLbs||null,durationMin:exd.defaultDurationMin||null,weightPct:exd.defaultWeightPct||100,distanceMi:exd.defaultDistanceMi||null,hrZone:exd.defaultHrZone||null}]);
    setWbExPickerOpen(false);
  }
  function closePicker() {
    setWbExPickerOpen(false);
    setPickerSearch(""); setPickerMuscle("All"); setPickerMuscleOpen(false); setPickerTypeFilter("all"); setPickerEquipFilter("all"); setPickerOpenDrop(null);
    setPickerSelected([]); setPickerConfigOpen(false);
  }
  function pickerToggleEx(exId) {
    const exd = allExById[exId]||{};
    setPickerSelected(prev => {
      const exists = prev.find(e=>e.exId===exId);
      if(exists) return prev.filter(e=>e.exId!==exId);
      return [...prev, {exId, sets:"3", reps:"10", weightLbs:"", weightPct:100, durationMin:"", distanceMi:"", hrZone:null}];
    });
  }
  function pickerUpdateEx(exId, field, val) {
    setPickerSelected(prev=>prev.map(e=>e.exId===exId?{...e,[field]:val}:e));
  }
  function commitPickerToWorkout() {
    if(pickerSelected.length===0) return;
    setWbExercises(ex=>[...ex,...pickerSelected.map(e=>({...e,sets:e.sets||"",reps:e.reps||"",weightLbs:e.weightLbs||null,durationMin:e.durationMin||null,distanceMi:e.distanceMi||null}))]);
    closePicker();
  }
  function updateWbEx(idx, field, val) {
    setWbExercises(exs=>exs.map((e,i)=>i===idx?{...e,[field]:val}:e));
  }
  /* ── Render exercise body fields (used by solo rows and accordion sections) ── */
  function renderWbExFields(ex, idx, exD) {
    const _isC=exD.category==="cardio";
    const _isF=exD.category==="flexibility";
    const _showW=!_isC&&!_isF;
    const _noSets=NO_SETS_EX_IDS.has(exD.id);
    const _isRunning=exD.id===RUNNING_EX_ID;
    const _isTread=exD.hasTreadmill||false;
    const _metric=isMetric(profile.units);
    const _wUnit=weightLabel(profile.units);
    const _dUnit=distLabel(profile.units);
    const _age=profile.age||30;
    const _distMiVal=ex.distanceMi?parseFloat(ex.distanceMi):0;
    const _durMin=parseFloat(ex.reps||0);
    const _runPace=(_isRunning&&_distMiVal>0&&_durMin>0)?_durMin/_distMiVal:null;
    const _runBoost=_runPace?(_runPace<=8?20:5):0;
    const _dispW=ex.weightLbs?(_metric?lbsToKg(ex.weightLbs):ex.weightLbs):"";
    const _dispDist=ex.distanceMi?(_metric?String(parseFloat(miToKm(ex.distanceMi)).toFixed(2)):String(ex.distanceMi)):"";
    return React.createElement(React.Fragment, null
      , React.createElement('div', {style:{display:"flex",gap:8,marginBottom:6}}
        , !_noSets&&React.createElement('div', {style:{flex:1}}
          , React.createElement('label', {style:{fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Sets")
          , React.createElement('input', {className:"wb-ex-inp",style:{width:"100%",padding:"5px 7px"},type:"text",inputMode:"decimal",
            value:ex.sets===0||ex.sets===""?"":ex.sets||"", onChange:e=>updateWbEx(idx,"sets",e.target.value)})
        )
        , (_isC||_isF) ? (
          React.createElement(React.Fragment, null
            , React.createElement('div', {style:{flex:1.6,minWidth:0}}
              , React.createElement('label', {style:{fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Duration (HH:MM)")
              , React.createElement('input', {className:"wb-ex-inp",style:{width:"100%",padding:"4px 5px"},type:"text",inputMode:"numeric",
                value:ex._durHHMM!==undefined?ex._durHHMM:(ex.durationSec?secToHHMMSplit(ex.durationSec).hhmm:ex.reps?"00:"+String(ex.reps).padStart(2,"0"):""),
                onChange:e=>updateWbEx(idx,"_durHHMM",e.target.value),
                onBlur:e=>{const h=normalizeHHMM(e.target.value);updateWbEx(idx,"_durHHMM",h||undefined);const s=combineHHMMSec(h,ex._durSecRaw||ex.durationSec?secToHHMMSplit(ex.durationSec||0).sec:"");updateWbEx(idx,"durationSec",s);if(s)updateWbEx(idx,"reps",Math.max(1,Math.floor(s/60)));},
                placeholder:"00:00"})
            )
            , React.createElement('div', {style:{flex:0.9,minWidth:0}}
              , React.createElement('label', {style:{fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Sec")
              , React.createElement('input', {className:"wb-ex-inp",style:{width:"100%",padding:"4px 5px",textAlign:"center"},type:"number",min:"0",max:"59",
                value:ex._durSecRaw!==undefined?String(ex._durSecRaw).padStart(2,"0"):(ex.durationSec?String(secToHHMMSplit(ex.durationSec).sec).padStart(2,"0"):""),
                onChange:e=>{const v=e.target.value;updateWbEx(idx,"_durSecRaw",v);const h2=ex._durHHMM||(ex.durationSec?secToHHMMSplit(ex.durationSec).hhmm:"");const s2=combineHHMMSec(h2,v);updateWbEx(idx,"durationSec",s2);if(s2)updateWbEx(idx,"reps",Math.max(1,Math.floor(s2/60)));},
                placeholder:"00"})
            )
            , React.createElement('div', {style:{flex:1.4,minWidth:0}}
              , React.createElement('label', {style:{fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Dist (",_dUnit,")")
              , React.createElement('input', {className:"wb-ex-inp",style:{width:"100%",padding:"4px 5px"},type:"text",inputMode:"decimal",
                value:_dispDist, onChange:e=>{const v=e.target.value;const mi=v&&_metric?kmToMi(v):v;updateWbEx(idx,"distanceMi",mi||null);},
                placeholder:"0"})
            )
          )
        ) : (
          React.createElement(React.Fragment, null
            , React.createElement('div', {style:{flex:1,minWidth:0}}
              , React.createElement('label', {style:{fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Reps")
              , React.createElement('input', {className:"wb-ex-inp",style:{width:"100%",padding:"5px 7px"},type:"text",inputMode:"decimal",
                value:ex.reps===0||ex.reps===""?"":ex.reps||"", onChange:e=>updateWbEx(idx,"reps",e.target.value)})
            )
            , _showW&&(
              React.createElement('div', {style:{flex:1.2,minWidth:0}}
                , React.createElement('label', {style:{fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Weight (",_wUnit,")")
                , React.createElement('input', {className:"wb-ex-inp",style:{width:"100%",padding:"5px 7px"},type:"text",inputMode:"decimal",
                  value:_dispW, onChange:e=>{const v=e.target.value;const lbs=v&&_metric?kgToLbs(v):v;updateWbEx(idx,"weightLbs",lbs||null);},
                  placeholder:"—"})
              )
            )
          )
        )
      )
      , _isRunning&&_runBoost>0&&(
        React.createElement('div', {style:{fontSize:".58rem",color:"#FFE87C",marginBottom:4}}, "⚡ Pace bonus: +",_runBoost,"% XP")
      )
      , _isTread&&(
        React.createElement('div', {style:{marginBottom:6}}
          , React.createElement('div', {style:{display:"flex",gap:8}}
            , React.createElement('div', {style:{flex:1}}
              , React.createElement('label', {style:{fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Incline (0.5–15)")
              , React.createElement('input', {className:"inp",type:"number",min:"0.5",max:"15",step:"0.5",placeholder:"—",
                style:{width:"100%",padding:"4px 5px"},value:ex.incline||"",
                onChange:e=>updateWbEx(idx,"incline",e.target.value?parseFloat(e.target.value):null)})
            )
            , React.createElement('div', {style:{flex:1}}
              , React.createElement('label', {style:{fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Speed (0.5–15)")
              , React.createElement('input', {className:"inp",type:"number",min:"0.5",max:"15",step:"0.5",placeholder:"—",
                style:{width:"100%",padding:"4px 5px"},value:ex.speed||"",
                onChange:e=>updateWbEx(idx,"speed",e.target.value?parseFloat(e.target.value):null)})
            )
          )
        )
      )
      , (ex.extraRows||[]).map((row,ri)=>(
        React.createElement('div', {key:ri,style:{display:"flex",gap:4,marginTop:4,padding:"6px 8px",background:"rgba(45,42,36,.18)",borderRadius:6,alignItems:"center",flexWrap:"wrap"}}
          , React.createElement('span', {style:{fontSize:".52rem",color:"#9a8a78",flexShrink:0,minWidth:16}}, (_isC||_isF)?`I${ri+2}`:`S${ri+2}`)
          , (_isC||_isF) ? (React.createElement(React.Fragment, null
            , React.createElement('input', {className:"wb-ex-inp",style:{flex:1.5,minWidth:52,padding:"4px 5px",fontSize:".7rem"},type:"text",inputMode:"numeric",placeholder:"HH:MM",
              value:row.hhmm||"",onChange:e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],hhmm:e.target.value};updateWbEx(idx,"extraRows",rr);},
              onBlur:e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],hhmm:normalizeHHMM(e.target.value)};updateWbEx(idx,"extraRows",rr);}})
            , React.createElement('input', {className:"wb-ex-inp",style:{flex:0.7,minWidth:36,padding:"4px 5px",fontSize:".7rem"},type:"number",min:"0",max:"59",placeholder:"Sec",value:row.sec||"",onChange:e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],sec:e.target.value};updateWbEx(idx,"extraRows",rr);}})
            , React.createElement('input', {className:"wb-ex-inp",style:{flex:1,minWidth:40,padding:"4px 5px",fontSize:".7rem"},type:"text",inputMode:"decimal",placeholder:_dUnit,value:row.distanceMi||"",onChange:e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],distanceMi:e.target.value};updateWbEx(idx,"extraRows",rr);}})
          )) : (React.createElement(React.Fragment, null
            , React.createElement('input', {className:"wb-ex-inp",style:{flex:1,minWidth:40,padding:"4px 5px",fontSize:".7rem"},type:"text",inputMode:"decimal",placeholder:"Sets",value:row.sets||"",onChange:e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],sets:e.target.value};updateWbEx(idx,"extraRows",rr);}})
            , React.createElement('input', {className:"wb-ex-inp",style:{flex:1,minWidth:40,padding:"4px 5px",fontSize:".7rem"},type:"text",inputMode:"decimal",placeholder:"Reps",value:row.reps||"",onChange:e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],reps:e.target.value};updateWbEx(idx,"extraRows",rr);}})
            , React.createElement('input', {className:"wb-ex-inp",style:{flex:1,minWidth:40,padding:"4px 5px",fontSize:".7rem"},type:"text",inputMode:"decimal",placeholder:_wUnit,value:row.weightLbs||"",onChange:e=>{const rr=[...(ex.extraRows||[])];rr[ri]={...rr[ri],weightLbs:e.target.value};updateWbEx(idx,"extraRows",rr);}})
          ))
          , React.createElement('button', {className:"btn btn-danger btn-xs",style:{padding:"2px 4px",flexShrink:0},onClick:()=>{const rr=(ex.extraRows||[]).filter((_,j)=>j!==ri);updateWbEx(idx,"extraRows",rr);}}, "✕")
        )
      ))
      , React.createElement('button', {className:"btn btn-ghost btn-xs",style:{width:"100%",marginTop:4,marginBottom:4,fontSize:".6rem",color:"#8a8478",borderStyle:"dashed"},
        onClick:()=>{const rr=[...(ex.extraRows||[]),(_isC||_isF)?{hhmm:"",sec:"",distanceMi:""}:{sets:ex.sets||"",reps:ex.reps||"",weightLbs:ex.weightLbs||""}];updateWbEx(idx,"extraRows",rr);}},
        "＋ Add Row (e.g. ", (_isC||_isF)?"interval":"progressive weight", ")")
    );
  }

  /* ── Render one accordion section (A or B) inside a superset card ── */
  function renderSsAccordionSection(ex, idx, exD, label, sectionKey) {
    const collapsed = !!ssAccordion[sectionKey];
    const _noSets = NO_SETS_EX_IDS.has(exD.id);
    const _isC = exD.category==="cardio";
    const _isF = exD.category==="flexibility";
    const _metric = isMetric(profile.units);
    const _wUnit = weightLabel(profile.units);
    const _distMiVal = ex.distanceMi?parseFloat(ex.distanceMi):0;
    const _durMin = parseFloat(ex.reps||0);
    const _isRunning = exD.id===RUNNING_EX_ID;
    const _runPace = (_isRunning&&_distMiVal>0&&_durMin>0)?_durMin/_distMiVal:null;
    const _runBoost = _runPace?(_runPace<=8?20:5):0;
    const xpVal = (()=>{const b=calcExXP(ex.exId,_noSets?1:ex.sets,ex.reps,profile.chosenClass,allExById,_distMiVal||null,ex.weightLbs||null,null);const r=(ex.extraRows||[]).reduce((s,row)=>s+calcExXP(ex.exId,parseInt(row.sets)||parseInt(ex.sets)||3,parseInt(row.reps)||parseInt(ex.reps)||10,profile.chosenClass,allExById,null,ex.weightLbs||null,null),0);return (_isC&&(ex.extraRows||[]).length>0)?Math.round((b+r)*1.25):(b+r);})();
    const summaryText = (_noSets?"":ex.sets+"×") + ex.reps + (ex.weightLbs?` · ${_metric?lbsToKg(ex.weightLbs):ex.weightLbs}${_wUnit}`:"");
    return React.createElement('div', {className:"ss-section"},
      React.createElement('div', {className:"ss-section-hdr",
        onClick:()=>setSsAccordion(prev=>({...prev,[sectionKey]:!prev[sectionKey]}))},
        React.createElement('div', {className:"ab-badge"}, label),
        React.createElement('div', {style:{width:28,height:28,borderRadius:6,flexShrink:0,background:"rgba(45,42,36,.15)",border:"1px solid rgba(180,172,158,.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".8rem"}}, exD.icon),
        React.createElement('span', {style:{fontFamily:"'Cinzel',serif",fontSize:".66rem",color:"#d8caba",letterSpacing:".02em",flex:1,minWidth:0}}, exD.name),
        collapsed && React.createElement('span', {style:{fontSize:".55rem",color:"#5a5650"}}, summaryText),
        React.createElement('span', {style:{fontSize:".6rem",fontWeight:700,color:"#b4ac9e",flexShrink:0}}, "+"+xpVal),
        React.createElement('span', {style:{fontSize:".6rem",color:"#5a5650",transition:"transform .2s",transform:collapsed?"rotate(0deg)":"rotate(180deg)"}}, "▼")
      ),
      !collapsed && React.createElement('div', {className:"ss-section-body"},
        renderWbExFields(ex, idx, exD)
      )
    );
  }

  /* ── Reorder a superset pair as a single unit ── */
  function reorderSupersetPair(anchorIdx, partnerIdx, direction) {
    setWbExercises(exs => {
      const arr = [...exs];
      const minI = Math.min(anchorIdx, partnerIdx);
      const maxI = Math.max(anchorIdx, partnerIdx);
      // We need to move both exercises. For simplicity, ensure they're adjacent first.
      // If not adjacent, move partner next to anchor first.
      if (maxI - minI !== 1) {
        // Make them adjacent: move maxI to minI+1
        const [moved] = arr.splice(maxI, 1);
        arr.splice(minI + 1, 0, moved);
        // Remap supersetWith
        const idxMap = {};
        const temp = exs.map((_, i) => i);
        const [movedI] = temp.splice(maxI, 1);
        temp.splice(minI + 1, 0, movedI);
        temp.forEach((oldI, newI) => { idxMap[oldI] = newI; });
        arr.forEach((e, ei) => { if (e.supersetWith != null && idxMap[e.supersetWith] != null) arr[ei] = {...e, supersetWith: idxMap[e.supersetWith]}; });
        return arr;
      }
      // Now move the pair up or down
      if (direction === "up" && minI > 0) {
        // Swap the pair with the element above
        const above = arr[minI - 1];
        arr[minI - 1] = arr[minI];
        arr[minI] = arr[minI + 1];
        arr[minI + 1] = above;
        // Remap
        arr.forEach((e, ei) => {
          if (e.supersetWith === minI - 1) arr[ei] = {...e, supersetWith: minI + 1};
          else if (e.supersetWith === minI) arr[ei] = {...e, supersetWith: minI - 1};
          else if (e.supersetWith === minI + 1) arr[ei] = {...e, supersetWith: minI};
        });
      } else if (direction === "down" && maxI < arr.length - 1) {
        const below = arr[maxI + 1];
        arr[maxI + 1] = arr[maxI];
        arr[maxI] = arr[minI];
        arr[minI] = below;
        arr.forEach((e, ei) => {
          if (e.supersetWith === minI) arr[ei] = {...e, supersetWith: minI + 1};
          else if (e.supersetWith === minI + 1) arr[ei] = {...e, supersetWith: minI + 2};
          else if (e.supersetWith === maxI + 1) arr[ei] = {...e, supersetWith: minI};
        });
      }
      return arr;
    });
  }

  function removeWbEx(idx) {
    setWbExercises(exs => {
      const updated = exs.map((e, i) => {
        if (i === idx) return null;
        if (e.supersetWith === idx) return { ...e, supersetWith: null };
        if (e.supersetWith != null && e.supersetWith > idx) {
          return { ...e, supersetWith: e.supersetWith - 1 };
        }
        return e;
      }).filter(Boolean);
      return updated;
    });
  }
  function reorderWbEx(fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    setWbExercises(exs => {
      const arr = [...exs];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      const indexMap = {};
      const temp = exs.map((_, i) => i);
      const [movedIdx] = temp.splice(fromIdx, 1);
      temp.splice(toIdx, 0, movedIdx);
      temp.forEach((oldIdx, newIdx) => { indexMap[oldIdx] = newIdx; });
      return arr.map(e => {
        if (e.supersetWith != null && indexMap[e.supersetWith] != null) {
          return { ...e, supersetWith: indexMap[e.supersetWith] };
        }
        return e;
      });
    });
  }
  // Add a workout's exercises as a new day in a plan
  function addWorkoutToPlan(workout, planId) {
    const plan = profile.plans.find(p=>p.id===planId);
    if(!plan) { showToast("Plan not found."); return; }
    const newDay = {label:workout.name, exercises:workout.exercises.map(e=>({...e}))};
    const updated = {...plan, days:[...plan.days, newDay]};
    setProfile(pr=>({...pr, plans:pr.plans.map(p=>p.id===planId?updated:p)}));
    setAddToPlanPicker(null);
    showToast(workout.icon+" "+workout.name+" added to "+plan.name+" ⚔️");
  }
  // Open stats prompt if any of duration/activeCal/totalCal are missing, then run onConfirm
  function openStatsPromptIfNeeded(wo, onConfirm) {
    // Skip stats modal entirely for rest-day-only workouts
    const isRestDayOnly = (wo.soloEx && wo._soloExId === "rest_day") ||
      (wo.exercises && wo.exercises.length > 0 && wo.exercises.every(e => e.exId === "rest_day"));
    if (isRestDayOnly) { onConfirm(wo); return; }
    const _bsPrefs = profile.notificationPrefs || {};
    if (_bsPrefs.reviewBattleStats === false) { onConfirm(wo); return; }
    const hasDur = wo.durationMin!==null && wo.durationMin!==undefined && wo.durationMin!=="";
    const hasAct = wo.activeCal!==null && wo.activeCal!==undefined && wo.activeCal!=="";
    const hasTot = wo.totalCal!==null && wo.totalCal!==undefined && wo.totalCal!=="";
    const split = hasDur ? secToHHMMSplit(Number(wo.durationMin)) : {hhmm:"",sec:""};
    setSpDuration(split.hhmm);
    setSpDurSec(split.sec!==null&&split.sec!==""&&split.sec!==0 ? String(split.sec) : "");
    setSpActiveCal(hasAct ? String(wo.activeCal) : "");
    setSpTotalCal(hasTot ? String(wo.totalCal) : "");
    setStatsPromptModal({ wo, missingDur:!hasDur, missingAct:!hasAct, missingTot:!hasTot, onConfirm, _self: { wo, missingDur:!hasDur, missingAct:!hasAct, missingTot:!hasTot, onConfirm } });
  }

  // Mark a workout complete — logs all its exercises under the chosen date
  function confirmWorkoutComplete() {
    const wo = completionModal && completionModal.workout;
    if(!wo) return;
    const dateStr = (completionAction==="past" && completionDate && completionDate!=="pick") ? completionDate : todayStr();
    const dateObj = new Date(dateStr+"T12:00:00");
    const displayDate = dateObj.toLocaleDateString();
    const now = new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const batchId = uid();
    const entries = wo.exercises.flatMap(ex=>{
      const exData = allExById[ex.exId]; if(!exData) return [];
      const isC = exData.category==="cardio"; const isF = exData.category==="flexibility";
      // Build all rows: main row + extra rows
      const allRows = [{sets:ex.sets||3, reps:ex.reps||10, weightLbs:ex.weightLbs||null},...(ex.extraRows||[])];
      return allRows.map(row=>{
        const baseXp = calcExXP(ex.exId, row.sets||3, row.reps||10, profile.chosenClass, allExById);
        const xp = (isC&&(ex.extraRows||[]).length>0) ? Math.round(baseXp * 1.25) : baseXp;
        return {
          exId:ex.exId, exercise:exData.name, icon:exData.icon, xp,
          mult:getMult(exData), sets:parseInt(row.sets)||3, reps:parseInt(row.reps)||10,
          weightLbs:(!isC&&!isF)?(row.weightLbs||null):null,
          weightPct:100, hrZone:ex.hrZone||null, distanceMi:ex.distanceMi||null,
          seconds:ex.seconds||null,
          time:now, date:displayDate, dateKey:dateStr,
          sourceWorkoutId:wo.id, sourceWorkoutName:wo.name, sourceWorkoutIcon:wo.icon,
          sourceWorkoutType: wo.oneOff ? "oneoff" : "reusable",
          sourceGroupId:batchId,
          sourceTotalCal: wo.totalCal || null,
          sourceActiveCal: wo.activeCal || null,
          sourceDurationSec: wo.durationMin || null,
        };
      });
    }).filter(Boolean);
    if(entries.length===0) { showToast("No valid exercises to log."); return; }
    const totalXP = entries.reduce((s,e)=>s+e.xp,0);
    const newLog = [...entries, ...profile.log];
    const newQuests = {...(profile.quests||{})};
    QUESTS.filter(q=>q.auto&&!newQuests[q.id]&&!newQuests[q.id]).forEach(q=>{
      if(checkQuestCompletion(q,newLog,profile.checkInStreak))
        newQuests[q.id]={completed:true,completedAt:todayStr(),claimed:false};
    });
    // If one-off, save to workouts array (as oneOff or reusable based on flag)
    const newWorkouts = wo.oneOff
      ? (() => {
          const existing = (profile.workouts||[]).find(w=>w.id===wo.id);
          const saved = {...wo, completedAt:dateStr, oneOff: wo.makeReusable ? false : true};
          delete saved.makeReusable; // clean up temp flag
          if(existing) return (profile.workouts||[]).map(w=>w.id===wo.id?saved:w);
          return [...(profile.workouts||[]), saved];
        })()
      : (profile.workouts||[]);
    // Fix sourceWorkoutType on log entries if converting to reusable
    if(wo.makeReusable) {
      entries.forEach(e => { e.sourceWorkoutType = "reusable"; });
    }
    let _ciResult = {checkInApplied:false, checkInXP:0, checkInStreak:0};
    setProfile(p=>{
      const base = {
        ...p, xp:p.xp+totalXP, log:newLog, quests:newQuests, workouts:newWorkouts,
        scheduledWorkouts: wo.oneOff
          ? (p.scheduledWorkouts||[]).filter(sw=>sw.sourceWorkoutId!==wo.id)
          : (p.scheduledWorkouts||[]),
      };
      const ci = applyAutoCheckIn(base, dateStr);
      _ciResult = ci;
      return ci.profile;
    });
    setXpFlash({amount:totalXP+_ciResult.checkInXP,mult:1}); setTimeout(()=>setXpFlash(null),2500);
    setCompletionModal(null); setCompletionDate(""); setCompletionAction("today"); setScheduleWoDate("");
    if(wo.makeReusable) { setWorkoutSubTab("reusable"); }
    const label = dateStr===todayStr()?"today":displayDate;
    const reusableNote = wo.makeReusable ? " · Saved to Re-Usable tab!" : "";
    const ciSuffix = _ciResult.checkInApplied ? ` · Checked in! +${_ciResult.checkInXP} XP · ${_ciResult.checkInStreak} day streak 🔥` : "";
    showToast(wo.icon+" "+wo.name+" completed "+label+"! +"+totalXP.toLocaleString()+" XP ⚡"+reusableNote+ciSuffix);
  }

  function scheduleWorkoutForDate() {
    const wo = _optionalChain([completionModal, 'optionalAccess', _64 => _64.workout]);
    if(!wo || !scheduleWoDate) return;
    const newSw = wo.exercises.map(ex=>({
      id: uid(),
      exId: ex.exId,
      scheduledDate: scheduleWoDate,
      notes: wo.name,
      createdAt: todayStr(),
      sourceWorkoutId: wo.id,
      sourceWorkoutName: wo.name,
      sourceWorkoutIcon: wo.icon,
    }));
    // If one-off, save the workout object so it can be retrieved for completion
    const newWorkouts = wo.oneOff && !(profile.workouts||[]).find(w=>w.id===wo.id)
      ? [...(profile.workouts||[]), wo]
      : (profile.workouts||[]);
    setProfile(p=>({...p, scheduledWorkouts:[...(p.scheduledWorkouts||[]), ...newSw], workouts:newWorkouts}));
    setCompletionModal(null); setCompletionDate(""); setCompletionAction("today"); setScheduleWoDate("");
    showToast(`📅 ${wo.name} scheduled for ${formatScheduledDate(scheduleWoDate)}!`);
  }
  function calcEntryXP(entry) {
    const ex = allExById[entry.exId]; if(!ex) return entry.xp;
    const mult = getMult(ex);
    const rv = parseInt(entry.reps)||1, sv = parseInt(entry.sets)||1;
    const effectiveW = parseFloat(entry.weightLbs)||0;
    const distMi = entry.distanceMi||null;
    const isCardio = ex.category==="cardio";
    const zoneBonus = isCardio && entry.hrZone ? 1+(entry.hrZone-1)*0.04 : 1;
    const weightBonus = effectiveW>0 ? 1+Math.min(effectiveW/500,0.3) : 1;
    const distBonus = distMi ? 1+Math.min(distMi*0.05,0.5) : 1;
    return Math.round(ex.baseXP*mult*(1+(rv*sv-1)*0.05)*zoneBonus*weightBonus*distBonus);
  }
  function openLogEdit(idx) {
    const entry = profile.log[idx];
    if(!entry) return;
    setLogEditDraft({...entry});
    setLogEditModal({idx});
  }
  function saveLogEdit() {
    if(!logEditModal) return;
    const {idx} = logEditModal;
    const oldEntry = profile.log[idx];
    const newXP = calcEntryXP(logEditDraft);
    const xpDiff = newXP - oldEntry.xp;
    const updatedEntry = {...logEditDraft, xp:newXP};
    const updatedLog = profile.log.map((e,i)=>i===idx?updatedEntry:e);
    // Recalculate running PB from the full updated log
    let newPB = null;
    updatedLog.forEach(e=>{
      if(e.exId===RUNNING_EX_ID && e.distanceMi && e.reps) {
        const pace = e.reps / e.distanceMi;
        if(!newPB || pace < newPB) newPB = pace;
      }
    });
    const pbChanged = newPB !== profile.runningPB;
    const newExPBs = calcExercisePBs(updatedLog);
    setProfile(p=>({...p, xp:Math.max(0,p.xp+xpDiff), log:updatedLog, runningPB:newPB, exercisePBs:newExPBs}));
    setLogEditModal(null); setLogEditDraft(null);
    let msg = xpDiff>0?"Updated! +"+xpDiff+" XP ⚡":xpDiff<0?"Updated! "+xpDiff+" XP":"Patched! ⚡";
    if(pbChanged) msg += newPB ? " · 🏆 Run PB updated" : " · Run PB cleared";
    showToast(msg);
  }
  function deleteLogEntryByIdx(idx) {
    const entry = profile.log[idx];
    if(!entry) return;
    setConfirmDelete({type:"logEntry", id:idx, name:entry.exercise, icon:entry.icon||"⚔️", xp:entry.xp});
  }
  function _doDeleteLogEntry(idx) {
    const entry = profile.log[idx];
    if(!entry) return;
    const updatedLog = profile.log.filter((_,i)=>i!==idx);
    let newPB = null;
    updatedLog.forEach(e=>{
      if(e.exId===RUNNING_EX_ID && e.distanceMi && e.reps) {
        const pace = e.reps / e.distanceMi;
        if(!newPB || pace < newPB) newPB = pace;
      }
    });
    // Add to deletedItems for recovery
    const deletedEntry = {id:uid(), type:"logEntry", item:{...entry, _originalIdx:idx}, deletedAt:new Date().toISOString()};
    const bin = [...(profile.deletedItems||[]), deletedEntry];
    setProfile(p=>({...p, xp:Math.max(0,p.xp-entry.xp), log:updatedLog, runningPB:newPB, exercisePBs:calcExercisePBs(updatedLog), deletedItems:bin}));
    showToast("Entry removed. -"+entry.xp+" XP");
  }

  // ── Schedule picker helpers ──────────────────────────────────
  function openSchedulePlan(plan) {
    setSchedulePicker({type:"plan", plan});
    setSpDate(plan.scheduledDate||"");
    setSpNotes(plan.scheduleNotes||"");
  }
  function openScheduleEx(exId, existingId) {
    const ex = allExById[exId]; if(!ex) return;
    const existing = existingId ? (profile.scheduledWorkouts||[]).find(s=>s.id===existingId) : null;
    setSchedulePicker({type:"ex", exId, name:ex.name, icon:ex.icon, existingId:existingId||null});
    setSpDate(_optionalChain([existing, 'optionalAccess', _65 => _65.scheduledDate])||"");
    setSpNotes(_optionalChain([existing, 'optionalAccess', _66 => _66.notes])||"");
  }
  function confirmSchedule() {
    if(!spDate) { showToast("Pick a date first!"); return; }
    const p = schedulePicker;
    if(p.type==="plan") {
      const updated = profile.plans.map(pl=>pl.id===p.plan.id
        ? {...pl, scheduledDate:spDate, scheduleNotes:spNotes}
        : pl);
      const newProfile = {...profile, plans:updated};
      setProfile(newProfile);
      doSave(newProfile, _optionalChain([authUser, 'optionalAccess', _67 => _67.id])||null, _optionalChain([authUser, 'optionalAccess', _68 => _68.email])||null);
      // Also update activePlan if viewing the same plan in detail
      if(activePlan && activePlan.id === p.plan.id) {
        setActivePlan({...activePlan, scheduledDate:spDate, scheduleNotes:spNotes});
      }
      showToast("Plan scheduled for " + formatScheduledDate(spDate) + " \u2726");
    } else {
      if(p.existingId) {
        const updated = (profile.scheduledWorkouts||[]).map(sw=>
          sw.id===p.existingId ? {...sw, scheduledDate:spDate, notes:spNotes} : sw
        );
        const newProfile = {...profile, scheduledWorkouts:updated};
        setProfile(newProfile);
        doSave(newProfile, _optionalChain([authUser, 'optionalAccess', _67 => _67.id])||null, _optionalChain([authUser, 'optionalAccess', _68 => _68.email])||null);
        showToast(p.icon + " " + p.name + " rescheduled to " + formatScheduledDate(spDate) + " \u2726");
      } else {
        const sw = {id:uid(), exId:p.exId, scheduledDate:spDate, notes:spNotes, createdAt:todayStr()};
        const newProfile = {...profile, scheduledWorkouts:[...(profile.scheduledWorkouts||[]), sw]};
        setProfile(newProfile);
        doSave(newProfile, _optionalChain([authUser, 'optionalAccess', _67 => _67.id])||null, _optionalChain([authUser, 'optionalAccess', _68 => _68.email])||null);
        showToast(p.icon + " " + p.name + " scheduled for " + formatScheduledDate(spDate) + " \u2726");
      }
      setActiveTab("workouts");
      setWorkoutSubTab("oneoff");
    }
    setSchedulePicker(null);
  }
  function removeScheduledWorkout(id) {
    setProfile(p=>({...p, scheduledWorkouts:(p.scheduledWorkouts||[]).filter(s=>s.id!==id)}));
  }
  function removePlanSchedule(planId) {
    const updated = profile.plans.map(pl=>pl.id===planId ? {...pl,scheduledDate:null,scheduleNotes:""} : pl);
    setProfile(pr=>({...pr, plans:updated}));
    showToast("Schedule cleared.");
  }
  function formatScheduledDate(dateStr) {
    if(!dateStr) return "";
    try {
      const d = new Date(dateStr + "T12:00:00");
      return d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});
    } catch(e) { return dateStr; }
  }
  function daysUntil(dateStr) {
    if(!dateStr) return null;
    try {
      const now = new Date(); now.setHours(0,0,0,0);
      const then = new Date(dateStr + "T00:00:00");
      const diff = Math.round((then - now) / 86400000);
      return diff;
    } catch(e) { return null; }
  }

  // Profile edit
  function openEdit(){
    const metric = isMetric(profile.units);
    setDraft({
      playerName:profile.playerName,
      firstName:profile.firstName||"",
      lastName:profile.lastName||"",
      weightLbs:profile.weightLbs,
      heightFt:profile.heightFt,
      heightIn:profile.heightIn,
      gym:profile.gym,
      state:profile.state||"",
      country:profile.country||"United States",
      chosenClass:profile.chosenClass,
      age:profile.age||"",
      gender:profile.gender||"",
      runningPB:profile.runningPB||"",
      units:profile.units||"imperial",
      // display values in user's unit for edit form
      _dispWeight: metric && profile.weightLbs ? lbsToKg(profile.weightLbs) : profile.weightLbs,
      _dispHeightCm: metric ? (ftInToCm(profile.heightFt,profile.heightIn)||"") : "",
    });
    setEditMode(true);
  }
  function saveEdit(){
    const metric = isMetric(draft.units);
    const wLbs = metric && draft._dispWeight ? parseFloat(kgToLbs(draft._dispWeight)).toFixed(1) : draft.weightLbs;
    let hFt=draft.heightFt, hIn=draft.heightIn;
    if(metric && draft._dispHeightCm){
      const conv=cmToFtIn(draft._dispHeightCm); hFt=String(conv.ft); hIn=String(conv.inch);
    }
    const u={...profile,...draft,weightLbs:wLbs,heightFt:hFt,heightIn:hIn};
    delete u._dispWeight; delete u._dispHeightCm;
    setProfile(u); doSave(u, _optionalChain([authUser, 'optionalAccess', _67 => _67.id])||null, _optionalChain([authUser, 'optionalAccess', _68 => _68.email])||null); setEditMode(false); showToast("Build saved! ⚡");
  }
  function resetChar(){ setConfirmDelete({type:"char",id:"char",name:"your character",icon:"🛡️",warning:"All XP, history, plans and workouts will be permanently lost."}); }
  function _doResetChar(){ doSave(EMPTY_PROFILE, authUser?.id||null, authUser?.email||null); setProfile(EMPTY_PROFILE); setObName(""); setObBio(""); setObAge(""); setObGender(""); setObSports([]); setObFreq(""); setObTiming(""); setObPriorities([]); setObStyle(""); setObStep(1); setScreen("intro"); }
  function deletePlan(id){ const pl=profile.plans.find(p=>p.id===id); setConfirmDelete({type:"plan",id,name:pl?pl.name:"this plan",icon:pl?pl.icon:"📋"}); }
  function _doDeletePlan(id) {
    const pl = (profile.plans||[]).find(p=>p.id===id);
    if(!pl) return;
    const bin = [...(profile.deletedItems||[]), {id:uid(), type:"plan", item:pl, deletedAt:new Date().toISOString()}];
    setProfile(p=>({...p, plans:p.plans.filter(pl=>pl.id!==id), deletedItems:bin}));
    setPlanView("list"); setActivePlan(null);
    showToast("Plan moved to Deleted — recoverable for 7 days.");
  }
  // Plan builder helpers
  function initBuilderScratch(){ setWizardEditPlan(null); setWizardTemplatePlan(null); setPlanView("builder"); }
  function initBuilderFromTemplate(tpl,customize=false){
    if(customize) {
      setWizardEditPlan(tpl.custom ? tpl : null);
      setWizardTemplatePlan(tpl.custom ? null : {...tpl, customize:true});
      setPlanView("builder");
    } else {
      setPlanView("detail"); setActivePlan(tpl);
    }
  }
  function handlePlanWizardSave(planData){
    if(planData.isEdit) {
      const {isEdit, ...rest} = planData;
      setProfile(pr=>({...pr,plans:pr.plans.map(pl=>pl.id===planData.id?{...pl,...rest}:pl)}));
      setActivePlan(p=>({...p,...rest}));
      setPlanView("list"); showToast("Plan updated! ⚡");
    } else {
      const {isEdit, ...rest} = planData;
      setProfile(pr=>({...pr,plans:[rest,...pr.plans]})); setPlanView("list"); showToast("Plan saved! ⚡");
    }
  }
  function savePlanEdits(plan){ setProfile(p=>({...p,plans:p.plans.map(pl=>pl.id===plan.id?plan:pl)})); setActivePlan(plan); showToast("Plan saved! ✦"); }
  function startPlanWorkout(plan){ const batchId=uid(); let totalXP=0; const entries=[]; plan.days.forEach(day=>{ day.exercises.forEach(ex=>{ const exData=allExById[ex.exId]; if(!exData) return; const earned=calcExXP(ex.exId,ex.sets,ex.reps,profile.chosenClass,allExById,null,ex.weightLbs||null,null); totalXP+=earned; entries.push({exercise:exData.name,icon:exData.icon,xp:earned,mult:getMult(exData),reps:parseInt(ex.reps)||1,sets:parseInt(ex.sets)||1,weightLbs:ex.weightLbs||null,weightPct:100,hrZone:null,distanceMi:null,time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),date:new Date().toLocaleDateString(),dateKey:todayStr(),exId:ex.exId,sourcePlanId:plan.id,sourcePlanName:plan.name,sourcePlanIcon:plan.icon,sourceGroupId:batchId,sourceTotalCal:day.totalCal||null,sourceActiveCal:day.activeCal||null,sourceDurationSec:day.durationMin||null}); }); }); const newLog=[...entries,...profile.log]; const newQuests={...(profile.quests||{})}; QUESTS.filter(q=>q.auto&&!_optionalChain([newQuests, 'access', _71 => _71[q.id], 'optionalAccess', _72 => _72.completed])).forEach(q=>{ if(checkQuestCompletion(q,newLog,profile.checkInStreak)) newQuests[q.id]={completed:true,completedAt:todayStr(),claimed:false}; }); let _ciResult={checkInApplied:false,checkInXP:0,checkInStreak:0}; setProfile(p=>{const base={...p,xp:p.xp+totalXP,log:newLog,quests:newQuests};const ci=applyAutoCheckIn(base,todayStr());_ciResult=ci;return ci.profile;}); const ciSuffix=_ciResult.checkInApplied?` · Checked in! +${_ciResult.checkInXP} XP · ${_ciResult.checkInStreak} day streak 🔥`:""; setXpFlash({amount:totalXP+_ciResult.checkInXP,mult:1}); setTimeout(()=>setXpFlash(null),2500); setPlanView("list"); setActivePlan(null); showToast(`Plan complete! +${totalXP.toLocaleString()} XP claimed!`+ciSuffix); }

  const rootStyle = {"--cls-color":_optionalChain([cls, 'optionalAccess', _73 => _73.color])||"#b4ac9e","--cls-glow":_optionalChain([cls, 'optionalAccess', _74 => _74.glow])||"#9b59b6"};

  // Pending quest claims
  const pendingQuestCount = QUESTS.filter(q=>{
    const qs=_optionalChain([profile, 'access', _75 => _75.quests, 'optionalAccess', _76 => _76[q.id]]);
    return _optionalChain([qs, 'optionalAccess', _77 => _77.completed]) && !_optionalChain([qs, 'optionalAccess', _78 => _78.claimed]);
  }).length;
  const CSS = "";

  function launchPreviewMode(){
    const daysAgo = n => new Date(Date.now()-n*86400000).toISOString().slice(0,10);
    const fmtDate = n => new Date(Date.now()-n*86400000).toLocaleDateString();
    const fmtTime = () => "07:30 AM";
    const gid = s => `preview-grp-${s}`;
    const previewLog = [
      {exercise:"Bench Press",icon:"\uD83C\uDFCB\uFE0F",exId:"bench",sets:4,reps:8,weightLbs:185,weightPct:100,hrZone:null,distanceMi:null,xp:420,mult:1.12,time:fmtTime(),date:fmtDate(1),dateKey:daysAgo(1),sourceGroupId:gid("a")},
      {exercise:"Overhead Press",icon:"\uD83C\uDFCB\uFE0F",exId:"ohp",sets:3,reps:10,weightLbs:115,weightPct:100,hrZone:null,distanceMi:null,xp:310,mult:1.12,time:fmtTime(),date:fmtDate(1),dateKey:daysAgo(1),sourceGroupId:gid("a")},
      {exercise:"Running",icon:"\uD83C\uDFC3",exId:"run",sets:1,reps:28,weightLbs:null,weightPct:100,hrZone:null,distanceMi:3.1,xp:380,mult:0.94,time:fmtTime(),date:fmtDate(3),dateKey:daysAgo(3),sourceGroupId:gid("b")},
      {exercise:"Deadlift",icon:"\uD83C\uDFCB\uFE0F",exId:"deadlift",sets:4,reps:6,weightLbs:225,weightPct:100,hrZone:null,distanceMi:null,xp:580,mult:1.12,time:fmtTime(),date:fmtDate(5),dateKey:daysAgo(5),sourceGroupId:gid("c")},
      {exercise:"Pull-Up",icon:"\uD83E\uDE9D",exId:"pullups",sets:3,reps:10,weightLbs:null,weightPct:100,hrZone:null,distanceMi:null,xp:290,mult:1.12,time:fmtTime(),date:fmtDate(5),dateKey:daysAgo(5),sourceGroupId:gid("c")},
      {exercise:"Squat",icon:"\uD83C\uDFCB\uFE0F",exId:"squat",sets:4,reps:8,weightLbs:205,weightPct:100,hrZone:null,distanceMi:null,xp:510,mult:1.12,time:fmtTime(),date:fmtDate(10),dateKey:daysAgo(10),sourceGroupId:gid("e")},
    ];
    setProfile({...EMPTY_PROFILE,
      playerName:"Test Majiq", firstName:"John", lastName:"Majiq",
      chosenClass:"tempest", xp:320000,
      weightLbs:205, heightFt:6, heightIn:2, age:36, gender:"Male",
      gym:"Lifetime Fitness", state:"KS", country:"United States",
      motto:"I like to test apps", trainingStyle:"mixed", workoutTiming:"evening",
      disciplineTrait:"Night Owl",
      hudFields:{weight:true,height:true,bmi:false},
      fitnessPriorities:["nutrition","endurance","social"],
      sportsBackground:["football","volleyball","dance"],
      nameVisibility:{displayName:["app","game"],realName:["hide"]},
      log:previewLog, workouts:[], plans:[], scheduledWorkouts:[],
      checkInHistory:[], checkInStreak:3, totalCheckIns:10,
      lastCheckIn:new Date(Date.now()-86400000).toISOString().slice(0,10),
      quests:{}, customExercises:[],
      exercisePBs:{bench:{weight:185},squat:{weight:205},deadlift:{weight:225},run:{type:"cardio",value:9.03}},
    });
    setMyPublicId("UQHDD2");
    setMyPrivateId("mPTSbPw8vTnd");
    setFriends([
      {id:"f1",playerName:"IronValkyrie",chosenClass:"warrior",xp:420000,log:[]},
      {id:"f2",playerName:"ZenMaster_X",chosenClass:"druid",xp:155000,log:[]},
      {id:"f3",playerName:"CrushMode88",chosenClass:"gladiator",xp:58000,log:[]},
      {id:"f4",playerName:"SwiftArrow",chosenClass:"warden",xp:105000,log:[]},
    ]);
    setLbData([
      {user_id:"f1",public_id:"VK9R3M",player_name:"IronValkyrie",first_name:"Sarah",last_name:"Chen",chosen_class:"warrior",total_xp:420000,level:8,streak:31,state:"NY",country:"United States",gym:"Gold's Gym",exercise_pbs:{bench:{weight:185},squat:{weight:275},deadlift:{weight:315}},name_visibility:{displayName:["app","game"],realName:["hide"]},is_me:false},
      {user_id:"f5",public_id:"PH3L9F",player_name:"PhantomLift",first_name:"Jake",last_name:"Morrison",chosen_class:"phantom",total_xp:360000,level:8,streak:45,state:"CO",country:"United States",gym:"24 Hr Fitness",exercise_pbs:{bench:{weight:245},squat:{weight:365},deadlift:{weight:405},pullups:{reps:25}},name_visibility:{displayName:["app","game"],realName:["hide"]},is_me:false},
      {user_id:"preview",public_id:"UQHDD2",player_name:"Test Majiq",first_name:"John",last_name:"Majiq",chosen_class:"tempest",total_xp:320000,level:7,streak:3,state:"KS",country:"United States",gym:"Lifetime Fitness",exercise_pbs:{bench:{weight:185},squat:{weight:205},deadlift:{weight:225},run:{type:"cardio",value:9.03}},name_visibility:{displayName:["app","game"],realName:["hide"]},is_me:true},
      {user_id:"f6",public_id:"TT6B4K",player_name:"TitanBreaker",first_name:"Mike",last_name:"OBrien",chosen_class:"titan",total_xp:210000,level:6,streak:18,state:"OH",country:"United States",gym:"YMCA",exercise_pbs:{bench:{weight:315},squat:{weight:455},deadlift:{weight:500}},name_visibility:{displayName:["app","game"],realName:["hide"]},is_me:false},
      {user_id:"f2",public_id:"ZN4K8W",player_name:"ZenMaster_X",first_name:"Marcus",last_name:"Rivera",chosen_class:"druid",total_xp:155000,level:5,streak:14,state:"CA",country:"United States",gym:"Equinox",exercise_pbs:{bench:{weight:135},run:{type:"cardio",value:7.5}},name_visibility:{displayName:["app","game"],realName:["hide"]},is_me:false},
      {user_id:"f4",public_id:"SW7A2R",player_name:"SwiftArrow",first_name:"Emily",last_name:"Park",chosen_class:"warden",total_xp:105000,level:4,streak:22,state:"FL",country:"United States",gym:"LA Fitness",exercise_pbs:{run:{type:"cardio",value:7.2},pullups:{reps:12}},name_visibility:{displayName:["app","game"],realName:["hide"]},is_me:false},
      {user_id:"f3",public_id:"CR8M5T",player_name:"CrushMode88",first_name:"DeAndre",last_name:"Williams",chosen_class:"gladiator",total_xp:58000,level:3,streak:7,state:"TX",country:"United States",gym:"Planet Fitness",exercise_pbs:{bench:{weight:225},squat:{weight:315}},name_visibility:{displayName:["app","game"],realName:["hide"]},is_me:false},
      {user_id:"f7",public_id:"ST2E7X",player_name:"StrikerElite",first_name:"Aisha",last_name:"Thompson",chosen_class:"striker",total_xp:22000,level:2,streak:5,state:"WA",country:"United States",gym:"Home Gym",exercise_pbs:{pushups:{reps:45}},name_visibility:{displayName:["app","game"],realName:["hide"]},is_me:false},
    ]);
    setLbWorldRanks({"f1":1,"f5":2,"preview":3,"f6":4,"f2":5,"f4":6,"f3":7,"f7":8});
    setShowPreviewPin(false);
    setPreviewPinInput("");
    setPreviewPinError(false);
    setIsPreviewMode(true);
    setScreen("main");
  }

  if(screen==="loading") return (
    React.createElement('div', { style: {minHeight:"100vh",background:"#0c0c0a",display:"flex",alignItems:"center",justifyContent:"center"}}
      , React.createElement('span', { style: {color:"#5a5650",fontFamily:"serif",fontStyle:"italic"}}, "Loading your legend…"  )
    )
  );

  if(mfaChallengeScreen) return (
    React.createElement('div', { style: {
      minHeight:"100vh",
      background:"radial-gradient(ellipse 70% 55% at 30% 20%, rgba(55,48,36,.28) 0%, transparent 65%), radial-gradient(ellipse 50% 45% at 68% 78%, rgba(35,30,20,.16) 0%, transparent 60%), #0c0c0a",
      display:"flex", alignItems:"center", justifyContent:"center", padding:"20px"
    }}
      , React.createElement('style', null, CSS)
      , React.createElement('div', { style: {width:"100%", maxWidth:380, display:"flex", flexDirection:"column", alignItems:"center"} }
        /* Shield icon */
        , React.createElement('div', { style: {fontSize:"2.4rem", marginBottom:12} }, "🛡️")
        , React.createElement('div', { style: {fontFamily:"'Cinzel Decorative',serif", fontSize:"1rem", color:"#d4cec4", letterSpacing:".08em", marginBottom:4, textAlign:"center"} }, "Verification Required")
        , React.createElement('div', { style: {fontSize:".72rem", color:"#6a645a", marginBottom:24, textAlign:"center"} }, "Your account is protected with multi-factor authentication.")

        , React.createElement('div', { style: {
          width:"100%",
          background:"linear-gradient(145deg,rgba(45,42,36,.4),rgba(32,30,26,.25))",
          border:"1px solid rgba(180,172,158,.06)",
          borderRadius:12, padding:"20px",
          backdropFilter:"blur(14px)", WebkitBackdropFilter:"blur(14px)"
        }}

          /* Tab toggle: Authenticator / Recovery Code */
          , React.createElement('div', { style: {display:"flex", gap:4, marginBottom:16, background:"rgba(45,42,36,.25)", borderRadius:8, padding:3} }
            , React.createElement('div', { style: {
                flex:1, textAlign:"center", padding:"7px 0", borderRadius:6, fontSize:".68rem", fontWeight:600, cursor:"pointer", transition:"all .15s",
                background: !mfaRecoveryMode ? "rgba(45,42,36,.5)" : "transparent",
                color: !mfaRecoveryMode ? "#d4cec4" : "#5a5650",
                border: !mfaRecoveryMode ? "1px solid rgba(180,172,158,.08)" : "1px solid transparent"
              }, onClick: ()=>{setMfaRecoveryMode(false);setMfaChallengeMsg(null);} }, "Authenticator Code")
            , React.createElement('div', { style: {
                flex:1, textAlign:"center", padding:"7px 0", borderRadius:6, fontSize:".68rem", fontWeight:600, cursor:"pointer", transition:"all .15s",
                background: mfaRecoveryMode ? "rgba(45,42,36,.5)" : "transparent",
                color: mfaRecoveryMode ? "#d4cec4" : "#5a5650",
                border: mfaRecoveryMode ? "1px solid rgba(180,172,158,.08)" : "1px solid transparent"
              }, onClick: ()=>{setMfaRecoveryMode(true);setMfaChallengeMsg(null);} }, "Recovery Code")
          )

          /* Authenticator code input */
          , !mfaRecoveryMode && React.createElement('div', { style: {display:"flex",flexDirection:"column",gap:10} }
            , React.createElement('div', { style: {fontSize:".68rem",color:"#8a8478"} }, "Enter the 6-digit code from your authenticator app.")
            , React.createElement('input', { className: "inp", type: "text", inputMode: "numeric", maxLength: 6, value: mfaChallengeCode, onChange: e=>setMfaChallengeCode(e.target.value.replace(/\D/g,"")),
              placeholder: "000000", style: {textAlign:"center",letterSpacing:".2em",fontSize:".9rem"},
              onKeyDown: e=>{ if(e.key==="Enter") submitMfaChallenge(); } })
            , React.createElement('button', {
              style: {
                width:"100%", padding:"11px", borderRadius:9, border:"none",
                background: mfaChallengeLoading || mfaChallengeCode.length<6 ? "rgba(45,42,36,.3)" : "linear-gradient(135deg, #c49428, #8a6010)",
                color: mfaChallengeLoading || mfaChallengeCode.length<6 ? "#5a5650" : "#0c0c0a",
                fontFamily:"'Cinzel',serif", fontSize:".62rem", fontWeight:700, letterSpacing:".12em", cursor:"pointer"
              },
              disabled: mfaChallengeLoading || mfaChallengeCode.length<6,
              onClick: submitMfaChallenge
            }, mfaChallengeLoading ? "Verifying\u2026" : "VERIFY")
          )

          /* Recovery code input */
          , mfaRecoveryMode && React.createElement('div', { style: {display:"flex",flexDirection:"column",gap:10} }
            , React.createElement('div', { style: {fontSize:".68rem",color:"#8a8478"} }, "Enter one of your backup recovery codes. This will disable MFA so you can log in and re-enroll.")
            , React.createElement('input', { className: "inp", type: "text", value: mfaRecoveryInput, onChange: e=>setMfaRecoveryInput(e.target.value.toUpperCase()),
              placeholder: "XXXX-XXXX-XXXX", style: {textAlign:"center",letterSpacing:".12em",fontSize:".82rem",fontFamily:"monospace"},
              onKeyDown: e=>{ if(e.key==="Enter") submitRecoveryCode(); } })
            , React.createElement('button', {
              style: {
                width:"100%", padding:"11px", borderRadius:9, border:"none",
                background: mfaChallengeLoading || !mfaRecoveryInput.trim() ? "rgba(45,42,36,.3)" : "linear-gradient(135deg, #c49428, #8a6010)",
                color: mfaChallengeLoading || !mfaRecoveryInput.trim() ? "#5a5650" : "#0c0c0a",
                fontFamily:"'Cinzel',serif", fontSize:".62rem", fontWeight:700, letterSpacing:".12em", cursor:"pointer"
              },
              disabled: mfaChallengeLoading || !mfaRecoveryInput.trim(),
              onClick: submitRecoveryCode
            }, mfaChallengeLoading ? "Verifying\u2026" : "USE RECOVERY CODE")
          )

          , mfaChallengeMsg && React.createElement('div', { style: {fontSize:".74rem", color:mfaChallengeMsg.ok?"#2ecc71":"#e74c3c", textAlign:"center", marginTop:10} }, mfaChallengeMsg.text)
        )

        /* Back to login */
        , React.createElement('div', { style: {marginTop:16, textAlign:"center"} }
          , React.createElement('span', { style: {fontSize:".68rem", color:"#5a5650", cursor:"pointer"}, onClick: async ()=>{
            await sb.auth.signOut();
            setMfaChallengeScreen(false);
            setMfaChallengeCode("");
            setMfaChallengeMsg(null);
            setMfaRecoveryMode(false);
            setMfaRecoveryInput("");
            setAuthUser(null);
            setScreen("landing");
          } }, "\u2190 Back to Sign In")
          , React.createElement('div', { style: {fontSize:".56rem", color:"#3a3834", marginTop:8} }, "Lost your authenticator AND recovery codes?")
          , React.createElement('div', { style: {fontSize:".56rem", color:"#5a5650"} }, "Contact support for an admin-assisted reset.")
        )
      )
    )
  );

  /* ══ LANDING PAGE ═══════════════════════════════════════════ */
  if(screen==="landing") return React.createElement(LandingPage, {
    onLogin: () => { setAuthIsNew(false); setScreen("login"); },
    onSignUp: () => { setAuthIsNew(true); setScreen("login"); }
  });

  if(screen==="login") return (
    React.createElement('div', { style: {
      minHeight:"100vh",
      backgroundImage:`radial-gradient(ellipse at center, transparent 55%, rgba(12,12,10,.5) 85%, #0c0c0a 100%), linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.3)), url(${loginBg})`,
      backgroundSize:"cover, cover, 200% auto", backgroundPosition:"center, center, center", backgroundRepeat:"no-repeat, no-repeat, no-repeat",
      backgroundColor:"#0c0c0a",
      color:"#d4cec4", fontFamily:"'Inter',sans-serif", overflowX:"hidden",
      display:"flex", flexDirection:"column", alignItems:"stretch"
    }}
      , React.createElement('style', null, CSS)

      /* ── Back to Home ── */
      , React.createElement('div', { style: {padding:"14px 20px 0", display:"flex", justifyContent:"flex-start"} }
        , React.createElement('span', { style: {fontSize:".72rem", color:"#8a8478", cursor:"pointer", letterSpacing:".04em"}, onClick: ()=>setScreen("landing") }, "\u2190 Back")
      )

      /* ── Logo ── */
      , React.createElement('img', {
          src: "data:image/jpeg;base64,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",
          alt: "Aurisar",
          style: {
            width:"100%",
            maxWidth:300,
            display:"block",
            margin:"52px auto 0",
            borderRadius:16,
            flexShrink:0
          }
        })

      , React.createElement('div', { style: {flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:"20px"} }
        , React.createElement('div', { style: {width:"100%", maxWidth:380, display:"flex", flexDirection:"column", alignItems:"center"} }
        /* ── Tagline ── */
        , React.createElement('p', { style: {fontStyle:"italic", textAlign:"center", fontSize:".78rem", lineHeight:1.65, color:"#6a645a", maxWidth:260, margin:"0 auto 12px"} }
          , "Every rep. Every step. Every drop of sweat earns you glory."
        )

        /* ── Auth Card ── */
        , React.createElement('div', { style: {
            width:"100%",
            background:"linear-gradient(145deg, rgba(45,42,36,.38), rgba(32,30,26,.22))",
            border:"1px solid rgba(180,172,158,.07)",
            borderRadius:16,
            backdropFilter:"blur(16px)",
            WebkitBackdropFilter:"blur(16px)",
            padding:"22px 20px 18px",
            display:"flex", flexDirection:"column", gap:0
          }}

          /* Section header / realm label */
          , React.createElement('div', { style: {
              display:"flex", alignItems:"center", gap:8, marginBottom:18
            }}
            , React.createElement('div', { style: {flex:1, height:1, background:"linear-gradient(90deg, transparent, rgba(180,172,158,.1))"} })
            , React.createElement('span', { style: {fontSize:".5rem", color:"rgba(180,172,158,.35)", letterSpacing:".16em", textTransform:"uppercase", whiteSpace:"nowrap"} }
              , loginSubScreen==="forgot-pw" ? "\u2BF6 Reset Password \u2BF6"
                : loginSubScreen==="forgot-username" ? "\u2BF6 Find Your Account \u2BF6"
                : authIsNew ? "\u2BF6 Create Your Legacy \u2BF6" : "\u2BF6 Enter the Realm \u2BF6"
            )
            , React.createElement('div', { style: {flex:1, height:1, background:"linear-gradient(90deg, rgba(180,172,158,.1), transparent)"} })
          )

          /* ── FORGOT PASSWORD SUB-SCREEN ── */
          , loginSubScreen==="forgot-pw" && React.createElement(React.Fragment, null
            , React.createElement('div', { style: {fontSize:".72rem",color:"#8a8478",lineHeight:1.6,marginBottom:14,textAlign:"center"} },
              "Enter the email address you used to create your account. We\u2019ll send you a link to reset your password."
            )
            , React.createElement('div', { style: {marginBottom:14} }
              , React.createElement('label', { style: {fontSize:".6rem", color:"#8a8478", letterSpacing:".08em", textTransform:"uppercase", display:"block", marginBottom:5} }, "Email Address")
              , React.createElement('input', {
                  className: "inp",
                  type: "email",
                  value: forgotPwEmail,
                  style: {fontSize:".88rem", width:"100%", padding:"10px 13px",
                    background:"linear-gradient(145deg, rgba(32,30,26,.5), rgba(20,18,14,.35))",
                    border:"1px solid rgba(180,172,158,.08)",
                    borderRadius:9, color:"#d4cec4", fontFamily:"'Inter',sans-serif",
                    outline:"none", boxSizing:"border-box"},
                  onChange: e=>{setForgotPwEmail(e.target.value);setAuthMsg(null);},
                  placeholder: "you@example.com",
                  onKeyDown: e=>{ if(e.key==="Enter") sendPasswordReset(); }
                })
            )
            , authMsg && React.createElement('div', { style: {fontSize:".8rem", color:authMsg.ok===true?"#2ecc71":"#e74c3c", textAlign:"center", padding:"4px 0 10px", lineHeight:1.5} }, authMsg.text)
            , React.createElement('button', {
                style: {width:"100%", padding:"12px", borderRadius:9, border:"none",
                  background: (!forgotPwEmail.trim()||authLoading) ? "rgba(45,42,36,.3)" : "linear-gradient(135deg, #c49428, #8a6010)",
                  color: (!forgotPwEmail.trim()||authLoading) ? "#5a5650" : "#0c0c0a",
                  fontFamily:"'Cinzel',serif", fontSize:".65rem", fontWeight:700,
                  letterSpacing:".14em", textTransform:"uppercase", cursor:"pointer", transition:"all .2s"},
                disabled: !forgotPwEmail.trim()||authLoading,
                onClick: sendPasswordReset
              }, authLoading ? "Sending\u2026" : "\uD83D\uDCE7 Send Reset Link")
            , React.createElement('div', { style: {borderTop:"1px solid rgba(45,42,36,.18)", marginTop:14, paddingTop:12, display:"flex", justifyContent:"space-between", alignItems:"center"} }
              , React.createElement('span', { style: {fontSize:".72rem", color:"#8a8478", cursor:"pointer"},
                  onClick: ()=>{setLoginSubScreen(null);setAuthMsg(null);setForgotPwEmail("");}
                }, "\u2190 Back to Sign In")
              , React.createElement('span', { style: {fontSize:".72rem", color:"#5a5650", cursor:"pointer"},
                  onClick: ()=>{setLoginSubScreen("forgot-username");setAuthMsg(null);setForgotLookupResult(null);setForgotPrivateId("");}
                }, "Forgot your email?")
            )
          )

          /* ── FORGOT USERNAME SUB-SCREEN ── */
          , loginSubScreen==="forgot-username" && React.createElement(React.Fragment, null
            , React.createElement('div', { style: {fontSize:".72rem",color:"#8a8478",lineHeight:1.6,marginBottom:14,textAlign:"center"} },
              "Enter your ", React.createElement('strong',{style:{color:"#b4ac9e"}},"Private Account ID"), " to look up the email on your account."
            )
            , React.createElement('div', { style: {marginBottom:14} }
              , React.createElement('label', { style: {fontSize:".6rem", color:"#8a8478", letterSpacing:".08em", textTransform:"uppercase", display:"block", marginBottom:5} }, "Private Account ID")
              , React.createElement('input', {
                  className: "inp",
                  type: "text",
                  value: forgotPrivateId,
                  style: {fontSize:".88rem", width:"100%", padding:"10px 13px",
                    background:"linear-gradient(145deg, rgba(32,30,26,.5), rgba(20,18,14,.35))",
                    border:"1px solid rgba(180,172,158,.08)",
                    borderRadius:9, color:"#d4cec4", fontFamily:"'Inter',sans-serif",
                    outline:"none", boxSizing:"border-box", letterSpacing:".06em"},
                  onChange: e=>{setForgotPrivateId(e.target.value);setForgotLookupResult(null);},
                  placeholder: "e.g. xP4mRk7bN2cQ",
                  onKeyDown: e=>{ if(e.key==="Enter") lookupByPrivateId(); }
                })
            )
            , forgotLookupResult && React.createElement('div', { style: {
                background: forgotLookupResult.found ? "rgba(46,204,113,.08)" : "rgba(231,76,60,.08)",
                border: "1px solid " + (forgotLookupResult.found ? "rgba(46,204,113,.2)" : "rgba(231,76,60,.2)"),
                borderRadius:9, padding:"12px 14px", marginBottom:14, textAlign:"center"
              }}
              , forgotLookupResult.found
                ? React.createElement(React.Fragment, null,
                    React.createElement('div', {style:{fontSize:".68rem",color:"#2ecc71",marginBottom:4}}, "\u2713 Account found!"),
                    React.createElement('div', {style:{fontSize:".82rem",color:"#d4cec4",fontWeight:700,letterSpacing:".04em",fontFamily:"monospace"}}, forgotLookupResult.masked_email),
                    React.createElement('div', {style:{fontSize:".58rem",color:"#8a8478",marginTop:6}}, "Use this email on the password reset screen."),
                    React.createElement('button', {
                      style:{marginTop:8,background:"rgba(45,42,36,.2)",border:"1px solid rgba(180,172,158,.08)",color:"#b4ac9e",padding:"8px 16px",borderRadius:8,fontSize:".68rem",cursor:"pointer",fontFamily:"'Inter',sans-serif"},
                      onClick:()=>{setLoginSubScreen("forgot-pw");setForgotPwEmail("");setAuthMsg(null);setForgotLookupResult(null);}
                    }, "\u2192 Go to Password Reset")
                  )
                : React.createElement('div', {style:{fontSize:".72rem",color:"#e74c3c"}}, forgotLookupResult.error)
            )
            , !forgotLookupResult?.found && React.createElement('button', {
                style: {width:"100%", padding:"12px", borderRadius:9, border:"none",
                  background: (!forgotPrivateId.trim()||authLoading) ? "rgba(45,42,36,.3)" : "linear-gradient(135deg, #c49428, #8a6010)",
                  color: (!forgotPrivateId.trim()||authLoading) ? "#5a5650" : "#0c0c0a",
                  fontFamily:"'Cinzel',serif", fontSize:".65rem", fontWeight:700,
                  letterSpacing:".14em", textTransform:"uppercase", cursor:"pointer", transition:"all .2s"},
                disabled: !forgotPrivateId.trim()||authLoading,
                onClick: lookupByPrivateId
              }, authLoading ? "Looking up\u2026" : "\uD83D\uDD0D Look Up My Email")
            , React.createElement('div', { style: {background:"rgba(45,42,36,.12)",border:"1px solid rgba(45,42,36,.18)",borderRadius:9,padding:"14px",marginTop:14,textAlign:"center"} }
              , React.createElement('div', {style:{fontSize:".68rem",color:"#8a8478",marginBottom:4}}, "Can\u2019t remember your Private ID either?")
              , React.createElement('div', {style:{fontSize:".62rem",color:"#5a5650",lineHeight:1.5}},
                "Contact us at ", React.createElement('span', {style:{color:"#2980b9",fontWeight:600}}, "support@aurisargames.com"),
                " and we\u2019ll help you recover your account.")
            )
            , React.createElement('div', { style: {borderTop:"1px solid rgba(45,42,36,.18)", marginTop:14, paddingTop:12} }
              , React.createElement('span', { style: {fontSize:".72rem", color:"#8a8478", cursor:"pointer"},
                  onClick: ()=>{setLoginSubScreen("forgot-pw");setAuthMsg(null);setForgotLookupResult(null);setForgotPrivateId("");}
                }, "\u2190 Back to Password Reset")
            )
          )

          /* ── NORMAL LOGIN / SIGNUP FORM ── */
          , loginSubScreen===null && React.createElement(React.Fragment, null

          /* Email */
          , React.createElement('div', { style: {marginBottom:10} }
            , React.createElement('label', { style: {fontSize:".6rem", color:"#8a8478", letterSpacing:".08em", textTransform:"uppercase", display:"block", marginBottom:5} }, "Email Address")
            , React.createElement('input', {
                className: "inp",
                type: "email",
                value: authEmail,
                style: {fontSize:".88rem", width:"100%", padding:"10px 13px",
                  background:"linear-gradient(145deg, rgba(32,30,26,.5), rgba(20,18,14,.35))",
                  border:"1px solid rgba(180,172,158,.08)",
                  borderRadius:9, color:"#d4cec4", fontFamily:"'Inter',sans-serif",
                  outline:"none", boxSizing:"border-box"},
                onChange: e=>{setAuthEmail(e.target.value);setAuthMsg(null);},
                placeholder: "you@example.com",
                onKeyDown: e=>{ if(e.key==="Enter") handleAuthSubmit(); }
              })
          )

          /* Password */
          , React.createElement('div', { style: {marginBottom:13} }
            , React.createElement('div', { style: {display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5} }
              , React.createElement('label', { style: {fontSize:".6rem", color:"#8a8478", letterSpacing:".08em", textTransform:"uppercase", margin:0} }
                , authIsNew ? "Create Password" : "Password"
              )
              , React.createElement('span', {
                  style: {fontSize:".6rem", color:"#5a5650", cursor:"pointer", letterSpacing:".04em"},
                  onClick: ()=>setShowAuthPw(v=>!v)
                }, showAuthPw ? "Hide" : "Show")
            )
            , React.createElement('input', {
                className: "inp",
                type: showAuthPw ? "text" : "password",
                value: authPassword,
                style: {fontSize:".88rem", width:"100%", padding:"10px 13px",
                  background:"linear-gradient(145deg, rgba(32,30,26,.5), rgba(20,18,14,.35))",
                  border:"1px solid rgba(180,172,158,.08)",
                  borderRadius:9, color:"#d4cec4", fontFamily:"'Inter',sans-serif",
                  outline:"none", boxSizing:"border-box"},
                onChange: e=>setAuthPassword(e.target.value),
                placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
                onKeyDown: e=>{ if(e.key==="Enter") handleAuthSubmit(); }
              })
          )

          /* Remember me */
          , React.createElement('div', { style: {display:"flex", alignItems:"center", gap:9, cursor:"pointer", marginBottom:16}, onClick: ()=>setAuthRemember(r=>!r) }
            , React.createElement('div', { style: {
                width:17, height:17, borderRadius:4, flexShrink:0, transition:"all .2s",
                border:`1.5px solid ${authRemember ? "#b4ac9e" : "rgba(45,42,36,.32)"}`,
                background: authRemember ? "rgba(45,42,36,.3)" : "transparent",
                display:"flex", alignItems:"center", justifyContent:"center"
              }}
              , authRemember && React.createElement('span', { style: {color:"#b4ac9e", fontSize:".72rem", lineHeight:1} }, "\u2713")
            )
            , React.createElement('span', { style: {fontSize:".72rem", color:"#5a5650", userSelect:"none"} }, "Remain logged in for 30 days")
          )

          /* Feedback message */
          , authMsg && React.createElement('div', { style: {fontSize:".8rem", color:authMsg.ok===true?"#2ecc71":"#e74c3c", textAlign:"center", padding:"4px 0 10px", lineHeight:1.5} }
            , authMsg.text
          )

          /* Submit */
          , React.createElement('button', {
              style: {
                width:"100%", padding:"12px", borderRadius:9, border:"none",
                background: (authLoading||!authEmail.trim()||!authPassword.trim())
                  ? "rgba(45,42,36,.3)"
                  : "linear-gradient(135deg, #c49428, #8a6010)",
                color: (authLoading||!authEmail.trim()||!authPassword.trim()) ? "#5a5650" : "#0c0c0a",
                fontFamily:"'Cinzel',serif", fontSize:".65rem", fontWeight:700,
                letterSpacing:".14em", textTransform:"uppercase", cursor:"pointer",
                transition:"all .2s", opacity: authLoading ? .7 : 1
              },
              disabled: authLoading||!authEmail.trim()||!authPassword.trim(),
              onClick: handleAuthSubmit
            }
            , authLoading
              ? (authIsNew ? "Forging your legacy\u2026" : "Entering the realm\u2026")
              : authIsNew ? "\u2694\uFE0F Create Account" : "\u2694\uFE0F Enter the Realm"
          )

          /* Footer links */
          , React.createElement('div', { style: {borderTop:"1px solid rgba(45,42,36,.18)", marginTop:14, paddingTop:12, display:"flex", justifyContent:"space-between", alignItems:"center"} }
            , !authIsNew
              ? React.createElement('span', { style: {fontSize:".72rem", color:"#b4ac9e", cursor:"pointer"}, onClick: ()=>{setAuthIsNew(true);setAuthMsg(null);setAuthPassword("");} }, "Create a Profile")
              : React.createElement('span', { style: {fontSize:".72rem", color:"#8a8478", cursor:"pointer"}, onClick: ()=>{setAuthIsNew(false);setAuthMsg(null);setAuthPassword("");} }, "\u2190 Back to Sign In")
            , !authIsNew && React.createElement('span', { style: {fontSize:".72rem", color:"#5a5650", cursor:"pointer"}, onClick: ()=>{setLoginSubScreen("forgot-pw");setAuthMsg(null);setForgotPwEmail("");} }, "Forgot password?")
          )
          ) /* end loginSubScreen===null */

/* Preview mode — PIN-gated dev access */
          , React.createElement('div', { style: {borderTop:"1px solid rgba(45,42,36,.12)", marginTop:6, paddingTop:10, textAlign:"center"} }
            , !showPreviewPin && React.createElement('span', {
                style: {fontSize:".55rem", color:"#3a3630", cursor:"pointer", fontStyle:"italic", letterSpacing:".03em"},
                onClick: ()=>{
                  if(!previewPinEnabled){ launchPreviewMode(); }
                  else { setShowPreviewPin(true);setPreviewPinInput("");setPreviewPinError(false); }
                }
              }, "\uD83D\uDC41 Preview Mode"
            )
            , showPreviewPin && React.createElement('div', null
              , React.createElement('div', { style: {fontSize:".55rem", color:"#5a5650", marginBottom:6} }, "Enter dev PIN")
              , React.createElement('div', { className: "preview-pin-wrap" }
                , React.createElement('input', {
                    className: "preview-pin-inp",
                    type: "password",
                    maxLength: 8,
                    value: previewPinInput,
                    onChange: e=>{setPreviewPinInput(e.target.value);setPreviewPinError(false);},
                    onKeyDown: e=>{ if(e.key==="Enter"){ if(previewPinInput===PREVIEW_PIN){launchPreviewMode();}else{setPreviewPinError(true);} } },
                    autoFocus: true
                  })
                , React.createElement('button', { className: "preview-pin-go", onClick: ()=>{ if(previewPinInput===PREVIEW_PIN){launchPreviewMode();}else{setPreviewPinError(true);} } }, "Go")
              )
              , previewPinError && React.createElement('div', { style: {fontSize:".55rem", color:"#e74c3c", marginTop:4} }, "Wrong PIN")
              , React.createElement('span', { style: {fontSize:".5rem", color:"#3a3630", cursor:"pointer", display:"inline-block", marginTop:6}, onClick: ()=>{setShowPreviewPin(false);setPreviewPinError(false);} }, "Cancel")
            )
            , !showPreviewPin && React.createElement('div', { style: {fontSize:".5rem", color:"#2e2c28", marginTop:2} }, "Dev access only")
          )

        )
      )
    )
  ));

  return (
    React.createElement('div', { className: "root", style: rootStyle}
      , React.createElement('style', null, CSS)
      , React.createElement('div', { className: "bg"})
      , PARTICLES.map(p=>React.createElement('div', { key: p.id, className: "pt", style: {left:`${p.x}%`,bottom:`${Math.random()*100}%`,width:p.size,height:p.size,"--dur":`${p.duration}s`,"--dly":`${p.delay}s`}}))
      , xpFlash && React.createElement('div', { className: "xp-flash"}, "+", xpFlash.amount.toLocaleString(), " XP" , xpFlash.mult>1.02?" ⚡":"")
      , toast    && React.createElement('div', { className: "toast"}, toast)
      , friendExBanner && React.createElement('div', { className: "friend-ex-banner", key: friendExBanner.key, onClick: () => setFriendExBanner(null) }
        , React.createElement('div', { className: "friend-ex-banner-icon" }, friendExBanner.exerciseIcon || "\uD83D\uDCAA")
        , React.createElement('div', { className: "friend-ex-banner-text" }
          , React.createElement('div', { className: "friend-ex-banner-title" }, friendExBanner.friendName, " completed ", friendExBanner.exerciseName, "!")
          , friendExBanner.pbInfo && React.createElement('div', { className: "friend-ex-banner-pb" }, formatFriendPB(friendExBanner.pbInfo))
        )
      )
      , showWNMockup && React.createElement(WorkoutNotificationMockup, { onClose: ()=>setShowWNMockup(false) })

      /* ══ INTRO ══════════════════════════════════ */
      , screen==="intro" && (
        React.createElement('div', { className: "screen boot-screen"}
          , React.createElement('div', { className: "boot-title"}
            , "AURISAR"
            , React.createElement('span', { className: "boot-title-sub"}, "FITNESS")
          )
          , React.createElement('div', { className: "boot-log"}
            , React.createElement('div', { className: "boot-bar-wrap"}
              , React.createElement('div', { className: "boot-bar", style: {width: bootStep>=4?"100%": bootStep>=3?"58%": bootStep>=2?"34%": bootStep>=1?"12%":"2%"}})
            )
            , React.createElement('div', { className: "boot-log-lines"}
              , bootStep>=1 && React.createElement('div', { className: "boot-line boot-line-in"}, React.createElement('span', { className: "boot-prompt"}, ">"), " Loading combat modules...", React.createElement('span', { className: "boot-check"}, " ✓"))
              , bootStep>=2 && React.createElement('div', { className: "boot-line boot-line-in"}, React.createElement('span', { className: "boot-prompt"}, ">"), " Calibrating XP engine...", React.createElement('span', { className: "boot-check"}, " ✓"))
              , bootStep>=3 && React.createElement('div', { className: "boot-line boot-line-in"}, React.createElement('span', { className: "boot-prompt"}, ">"), " Assigning warrior class...", bootStep>=4 ? React.createElement('span', { className: "boot-check"}, " ✓") : React.createElement('span', { className: "boot-ellipsis"}, " ..."))
            )
          )
          , React.createElement('button', {
              className: `btn btn-gold${bootStep>=4?" boot-btn-ready":""}`,
              onClick: ()=>setScreen("onboard")
            }, bootStep>=4 ? "BEGIN" : "BOOT UP")
          , React.createElement('button', {
              className: "btn btn-ghost boot-cancel-btn",
              onClick: async ()=>{
                await sb.auth.signOut();
                setAuthUser(null); setAuthIsNew(false); setAuthEmail(""); setAuthPassword("");
                setScreen("landing");
              }
            }, "← Cancel")
          , obDraft && React.createElement('div', { className: "boot-resume-card boot-line-in" }
            , React.createElement('div', {className:"boot-resume-label"}, "⟳ Resume where you left off?")
            , React.createElement('div', {className:"boot-resume-step"}, `Step ${obDraft.obStep} of 6${obDraft.obFirstName ? " · "+obDraft.obFirstName : ""}`)
            , React.createElement('div', {style:{display:"flex",gap:8,justifyContent:"center",marginTop:8}}
              , React.createElement('button', {
                  className:"btn btn-ghost", style:{fontSize:".65rem",padding:"5px 14px"},
                  onClick:()=>{
                    setObStep(obDraft.obStep); setObName(obDraft.obName); setObFirstName(obDraft.obFirstName);
                    setObLastName(obDraft.obLastName); setObBio(obDraft.obBio); setObAge(obDraft.obAge);
                    setObGender(obDraft.obGender); setObSports(obDraft.obSports); setObFreq(obDraft.obFreq);
                    setObTiming(obDraft.obTiming); setObPriorities(obDraft.obPriorities); setObStyle(obDraft.obStyle);
                    setObState(obDraft.obState); setObCountry(obDraft.obCountry);
                    setObDraft(null); setScreen("onboard");
                  }
                }, "Resume")
              , React.createElement('span', {
                  style:{fontSize:".58rem",color:"#3a3834",cursor:"pointer",alignSelf:"center",padding:"4px 6px"},
                  onClick:()=>{
                    try { localStorage.removeItem("aurisar_ob_draft_"+authUser.id); } catch(e) {}
                    setObDraft(null); setObStep(1); setObName(""); setObFirstName(""); setObLastName("");
                    setObBio(""); setObAge(""); setObGender(""); setObSports([]); setObFreq("");
                    setObTiming(""); setObPriorities([]); setObStyle(""); setObState(""); setObCountry("United States");
                    setScreen("onboard");
                  }
                }, "Start fresh")
            )
          )
        )
      )

      /* ══ ONBOARDING ═════════════════════════════ */
      , screen==="onboard" && (()=>{
        const OB_SPORTS=[
          {val:"football",label:"🏈 Football"},{val:"basketball",label:"🏀 Basketball"},{val:"soccer",label:"⚽ Soccer"},
          {val:"baseball",label:"⚾ Baseball"},{val:"volleyball",label:"🏐 Volleyball"},{val:"tennis",label:"🎾 Tennis"},
          {val:"running",label:"🏃 Track/Running"},{val:"cycling",label:"🚴 Cycling"},{val:"swimming",label:"🏊 Swimming"},
          {val:"triathlon",label:"🏅 Triathlon"},{val:"rowing",label:"🚣 Rowing"},{val:"boxing",label:"🥊 Boxing/Kickboxing"},
          {val:"mma",label:"🥋 MMA/Martial Arts"},{val:"wrestling",label:"🤼 Wrestling"},{val:"crossfit",label:"🔁 CrossFit"},
          {val:"powerlifting",label:"🏋️ Powerlifting"},{val:"bodybuilding",label:"💪 Bodybuilding"},{val:"yoga",label:"🧘 Yoga/Pilates"},
          {val:"dance",label:"💃 Dance/Cheer"},{val:"hiking",label:"🥾 Hiking/Rucking"},{val:"gymnastics",label:"🤸 Gymnastics"},
          {val:"golf",label:"⛳ Golf"},{val:"none",label:"🚫 No sports background"},
        ];
        const OB_PRIORITIES=[
          {val:"be_strong",label:"💪 Being Strong"},{val:"look_strong",label:"🪞 Looking Strong"},
          {val:"feel_good",label:"🌿 Feeling Good"},{val:"eat_right",label:"🥗 Eating Right"},
          {val:"mental_clarity",label:"🧠 Mental Clarity"},{val:"athletic_perf",label:"🏅 Athletic Performance"},
          {val:"endurance",label:"🔥 Endurance & Stamina"},{val:"longevity",label:"🕊️ Longevity & Recovery"},
          {val:"competition",label:"🏆 Competition"},{val:"social",label:"👥 Social/Community"},
          {val:"flexibility",label:"🤸 Mobility & Flex"},{val:"weight_loss",label:"⚖️ Weight Management"},
        ];
        const prog=`${(obStep/6)*100}%`;
        const chipSt=(active)=>({display:"inline-flex",alignItems:"center",padding:"7px 12px",borderRadius:20,border:`1px solid ${active?"#d4cec4":"rgba(180,172,158,.06)"}`,background:active?"rgba(45,42,36,.25)":"rgba(45,42,36,.12)",color:active?"#d4cec4":"#8a8478",fontSize:".78rem",cursor:"pointer",margin:"3px",userSelect:"none"});
        const radioSt=(active)=>({display:"flex",alignItems:"flex-start",gap:10,padding:"11px 13px",border:`1px solid ${active?"#d4cec4":"rgba(180,172,158,.06)"}`,borderRadius:10,background:active?"rgba(45,42,36,.25)":"rgba(45,42,36,.12)",cursor:"pointer",marginBottom:7});
        const toggleSport=(v)=>{if(v==="none"){setObSports(s=>s.includes("none")?[]:["none"]);return;}setObSports(s=>s.includes("none")?[v]:s.includes(v)?s.filter(x=>x!==v):[...s,v]);};
        const togglePri=(v)=>setObPriorities(s=>s.includes(v)?s.filter(x=>x!==v):s.length<3?[...s,v]:s);
        return React.createElement('div', {className:"screen"}
          , React.createElement('div', {style:{height:3,background:"rgba(180,172,158,.1)",borderRadius:2,marginBottom:18,overflow:"hidden"}}
            , React.createElement('div', {style:{height:"100%",width:prog,background:"#b4ac9e",borderRadius:2,transition:"width .3s"}}))
          , React.createElement('div', {style:{fontSize:".62rem",color:"#5a5650",letterSpacing:".14em",textTransform:"uppercase",marginBottom:6}}, `Step ${obStep} of 6`)
          , obStep===1 && React.createElement('div', null
            , React.createElement('h1', {className:"title",style:{fontSize:"clamp(1.4rem,4vw,2rem)"}}, "Create Your Build")
            , React.createElement('div', {className:"card",style:{display:"flex",flexDirection:"column",gap:14}}
              , React.createElement('div', {style:{display:"flex",gap:10}}
                , React.createElement('div', {className:"field",style:{flex:1}}, React.createElement('label', null,"First Name"), React.createElement('input', {className:"inp",value:obFirstName,onChange:e=>setObFirstName(e.target.value),placeholder:"First name"}))
                , React.createElement('div', {className:"field",style:{flex:1}}, React.createElement('label', null,"Last Name"), React.createElement('input', {className:"inp",value:obLastName,onChange:e=>setObLastName(e.target.value),placeholder:"Last name"}))
              )
              , React.createElement('div', {className:"field"}, React.createElement('label', null,"Display Name ", React.createElement('span',{style:{fontSize:".55rem",opacity:.6}},"(shown publicly)")), React.createElement('input', {className:"inp",value:obName,onChange:e=>setObName(e.target.value),placeholder:"Your gamertag or nickname\u2026"}))
              , React.createElement('div', {style:{display:"flex",gap:10}}
                , React.createElement('div', {className:"field",style:{flex:1}}, React.createElement('label', null,"Age ",React.createElement('span',{style:{fontSize:".55rem",opacity:.6}},"(optional)")), React.createElement('input', {className:"inp",type:"number",min:"13",max:"99",value:obAge,onChange:e=>setObAge(e.target.value),placeholder:"25"}))
                , React.createElement('div', {className:"field",style:{flex:1}}
                  , React.createElement('label', null,"Sex ",React.createElement('span',{style:{fontSize:".55rem",opacity:.6}},"(optional)"))
                  , React.createElement('div', {style:{display:"flex",gap:5,flexWrap:"wrap",marginTop:4}}
                    , ["Male","Female","Other"].map(g=>React.createElement('button',{key:g,className:`gender-btn ${obGender===g?"sel":""}`,onClick:()=>setObGender(prev=>prev===g?"":g)},g))
                  )
                )
              )
              , React.createElement('div', {style:{display:"flex",gap:10}}
                , React.createElement('div', {className:"field",style:{flex:1}}
                  , React.createElement('label', null, "State")
                  , React.createElement('select', {className:"inp", value:obState, onChange:e=>setObState(e.target.value), style:{cursor:"pointer"}}
                    , React.createElement('option', {value:""}, "Select State")
                    , ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"].map(s=>React.createElement('option',{key:s,value:s},s))
                  )
                )
                , React.createElement('div', {className:"field",style:{flex:1}}
                  , React.createElement('label', null, "Country")
                  , React.createElement('select', {className:"inp", value:obCountry, onChange:e=>setObCountry(e.target.value), style:{cursor:"pointer"}}
                    , ["United States","Canada","United Kingdom","Australia","Germany","France","Mexico","Brazil","India","Japan","South Korea","Philippines","Other"].map(c=>React.createElement('option',{key:c,value:c},c))
                  )
                )
              )
              , React.createElement('button', {className:"btn btn-gold",disabled:!obName.trim()||!obFirstName.trim()||!obLastName.trim()||!obState||!obCountry,onClick:()=>setObStep(2)}, "Continue \u2192")
            )
          )
          , obStep===2 && React.createElement('div', null
            , React.createElement('h1', {className:"title",style:{fontSize:"clamp(1.3rem,4vw,1.9rem)"}}, "Athletic History")
            , React.createElement('p', {style:{color:"#6a645a",fontSize:".82rem",marginBottom:12}}, "Select all sports you've played — past or present. This is your strongest class signal.")
            , React.createElement('div', {style:{marginBottom:16}}, OB_SPORTS.map(s=>React.createElement('span',{key:s.val,style:chipSt(obSports.includes(s.val)),onClick:()=>toggleSport(s.val)},s.label)))
            , React.createElement('div', {style:{display:"flex",gap:8}}
              , React.createElement('button', {className:"btn btn-ghost",onClick:()=>setObStep(1)}, "← Back")
              , React.createElement('button', {className:"btn btn-gold",onClick:()=>setObStep(3)}, "Continue →")
            )
          )
          , obStep===3 && React.createElement('div', null
            , React.createElement('h1', {className:"title",style:{fontSize:"clamp(1.3rem,4vw,1.9rem)"}}, "Current Routine")
            , React.createElement('p', {style:{color:"#6a645a",fontSize:".82rem",marginBottom:12}}, "How often do you work out today? Be honest — this calibrates your starting stats.")
            , [{val:"never",label:"Just getting started",sub:"Little to no workout history"},{val:"light",label:"1–2 times a week",sub:"Casual, inconsistent routine"},{val:"moderate",label:"3–4 times a week",sub:"Solid habit, building consistency"},{val:"dedicated",label:"5–6 times a week",sub:"Dedicated athlete"},{val:"elite",label:"Daily or twice a day",sub:"Elite training volume"}]
              .map(o=>React.createElement('div',{key:o.val,style:radioSt(obFreq===o.val),onClick:()=>setObFreq(o.val)},React.createElement('div',null,React.createElement('div',{style:{fontSize:".82rem",fontWeight:600,color:obFreq===o.val?"#d4cec4":"#b4ac9e"}},o.label),React.createElement('div',{style:{fontSize:".72rem",color:"#5a5650",marginTop:2}},o.sub))))
            , React.createElement('div', {style:{display:"flex",gap:8,marginTop:6}}
              , React.createElement('button', {className:"btn btn-ghost",onClick:()=>setObStep(2)}, "← Back")
              , React.createElement('button', {className:"btn btn-gold",disabled:!obFreq,onClick:()=>setObStep(4)}, "Continue →")
            )
          )
          , obStep===4 && React.createElement('div', null
            , React.createElement('h1', {className:"title",style:{fontSize:"clamp(1.3rem,4vw,1.9rem)"}}, "Discipline Trait")
            , React.createElement('p', {style:{color:"#6a645a",fontSize:".82rem",marginBottom:12}}, "When do you usually work out? Timing unlocks hidden character traits.")
            , [{val:"earlymorning",label:"Early morning (before 7am)",sub:"⚡ Iron Discipline — +WIS +CON boost. One of the rarest traits."},{val:"morning",label:"Morning (7am–12pm)",sub:"☀️ Disciplined — +WIS boost"},{val:"afternoon",label:"Afternoon (12pm–5pm)",sub:"Balanced — no trait modifier"},{val:"evening",label:"Evening (5pm–9pm)",sub:"🌙 Night Owl — +VIT boost"},{val:"varies",label:"It varies / no routine yet",sub:"No trait — earn one as you build your routine"}]
              .map(o=>React.createElement('div',{key:o.val,style:radioSt(obTiming===o.val),onClick:()=>setObTiming(o.val)},React.createElement('div',null,React.createElement('div',{style:{fontSize:".82rem",fontWeight:600,color:obTiming===o.val?"#d4cec4":"#b4ac9e"}},o.label),React.createElement('div',{style:{fontSize:".72rem",color:"#5a5650",marginTop:2}},o.sub))))
            , React.createElement('div', {style:{display:"flex",gap:8,marginTop:6}}
              , React.createElement('button', {className:"btn btn-ghost",onClick:()=>setObStep(3)}, "← Back")
              , React.createElement('button', {className:"btn btn-gold",disabled:!obTiming,onClick:()=>setObStep(5)}, "Continue →")
            )
          )
          , obStep===5 && React.createElement('div', null
            , React.createElement('h1', {className:"title",style:{fontSize:"clamp(1.3rem,4vw,1.9rem)"}}, "Fitness Identity")
            , React.createElement('p', {style:{color:"#6a645a",fontSize:".82rem",marginBottom:12}}, "Pick up to 3 that best describe your mindset. These shape your stat affinity.")
            , React.createElement('div', {style:{marginBottom:12}}
              , OB_PRIORITIES.map(p=>React.createElement('span',{key:p.val,style:chipSt(obPriorities.includes(p.val)),onClick:()=>togglePri(p.val)},p.label))
              , React.createElement('div', {style:{fontSize:".68rem",color:"#5a5650",marginTop:6,fontStyle:"italic"}}, `${obPriorities.length}/3 selected`)
            )
            , React.createElement('div', {style:{display:"flex",gap:8}}
              , React.createElement('button', {className:"btn btn-ghost",onClick:()=>setObStep(4)}, "← Back")
              , React.createElement('button', {className:"btn btn-gold",onClick:()=>setObStep(6)}, "Continue →")
            )
          )
          , obStep===6 && React.createElement('div', null
            , React.createElement('h1', {className:"title",style:{fontSize:"clamp(1.3rem,4vw,1.9rem)"}}, "Training Style")
            , React.createElement('p', {style:{color:"#6a645a",fontSize:".82rem",marginBottom:12}}, "Your natural approach to fitness — this fine-tunes your class assignment.")
            , [{val:"heavy",label:"Heavy compound lifts",sub:"Squats, deadlifts, bench — I chase weight on the bar"},{val:"cardio",label:"Cardio & endurance",sub:"Running, cycling, swimming — I chase distance and time"},{val:"sculpt",label:"Sculpting & aesthetics",sub:"Isolation work and volume — I chase the look"},{val:"hiit",label:"HIIT & explosive power",sub:"Short intense bursts, circuits, functional fitness"},{val:"mindful",label:"Mindful movement",sub:"Yoga, mobility, breath work — mind-body connection"},{val:"sport",label:"Sport-specific training",sub:"I train to compete or perform — sport is the goal"},{val:"mixed",label:"I mix everything",sub:"No single focus — variety keeps me going"}]
              .map(o=>React.createElement('div',{key:o.val,style:radioSt(obStyle===o.val),onClick:()=>setObStyle(o.val)},React.createElement('div',null,React.createElement('div',{style:{fontSize:".82rem",fontWeight:600,color:obStyle===o.val?"#d4cec4":"#b4ac9e"}},o.label),React.createElement('div',{style:{fontSize:".72rem",color:"#5a5650",marginTop:2}},o.sub))))
            , React.createElement('div', {style:{display:"flex",gap:8,marginTop:6}}
              , React.createElement('button', {className:"btn btn-ghost",onClick:()=>setObStep(5)}, "← Back")
              , React.createElement('button', {className:"btn btn-gold",disabled:!obStyle,onClick:handleOnboard}, "Forge My Character →")
            )
          )
        );
      })()

      /* ══ CLASS REVEAL ═══════════════════════════ */
      , screen==="classReveal" && detectedClass && (()=>{
        const dc=CLASSES[detectedClass];
        return (
          React.createElement('div', { className: "screen", style: {"--cls-color":dc.color,"--cls-glow":dc.glow}}
            , React.createElement('p', { style: {color:"#5a5650",fontSize:".7rem",letterSpacing:".14em",textTransform:"uppercase"}}, "The Fates have spoken…"   )
            , React.createElement('div', { className: "reveal-card", style: {"--cls-color":dc.color,"--cls-glow":dc.glow}}
              , React.createElement('span', { className: "reveal-icon"}, dc.icon)
              , React.createElement('div', { className: "reveal-name"}, dc.name)
              , React.createElement('p', { style: {color:"#8a8478",fontStyle:"italic",lineHeight:1.5,fontSize:".9rem"}}, dc.description)
              , React.createElement('div', { className: "traits", style: {justifyContent:"center",marginTop:11}}
                , dc.traits.map(t=>React.createElement('span', { key: t, className: "trait", style: {"--cls-color":dc.color,"--cls-glow":dc.glow}}, t))
              )
            )
            , React.createElement('div', { style: {display:"flex",gap:11,flexWrap:"wrap",justifyContent:"center"}}
              , React.createElement('button', { className: "btn btn-gold" , onClick: ()=>confirmClass(detectedClass)}, "Accept My Fate"  )
              , React.createElement('button', { className: "btn btn-ghost" , onClick: ()=>setScreen("classPick")}, "Choose Differently" )
            )
          )
        );
      })()

      /* ══ CLASS PICK ═════════════════════════════ */
      , screen==="classPick" && (
        React.createElement('div', { className: "screen" }
          , React.createElement('h1', { className: "title", style: {fontSize:"clamp(1.2rem,4vw,1.7rem)"} }, "Choose Your Path")
          , React.createElement('p', { style: {color:"#5a5650",fontSize:".75rem",marginBottom:12,textAlign:"center"} }, "Locked classes unlock through future updates. Class changes after setup require a paid reset.")
          , React.createElement('div', { className: "cls-grid" }
            , Object.entries(CLASSES).map(([key,c])=>(
              React.createElement('div', { key: key,
                className: `cls-card ${profile.chosenClass===key?"sel":""} ${c.locked?"cls-locked":""}`,
                style: {"--bc":c.color, opacity:c.locked?0.4:1, cursor:c.locked?"not-allowed":"pointer"},
                onClick: ()=>{ if(!c.locked) setProfile(p=>({...p,chosenClass:key})); }
              }
                , React.createElement('div', { style: {height:"2.2rem",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:7} }, React.createElement(ClassIcon,{classKey:key,size:32,color:c.glow}))
                , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".63rem",color:c.glow} }, c.name)
                , c.locked && React.createElement('div', { style: {fontSize:".58rem",color:"#5a5650",marginTop:2} }, "🔒 Coming Soon")
                , !c.locked && React.createElement('div', { style: {fontSize:".74rem",color:"#5a5650",marginTop:3,lineHeight:1.4} }, c.description)
              )
            ))
          )
          , React.createElement('button', { className: "btn btn-gold", disabled: !profile.chosenClass, onClick: ()=>confirmClass(profile.chosenClass) }, "Confirm Class")
        )
      )

      /* ══ MAIN ═══════════════════════════════════ */
      , screen==="main" && clsKey && (
        React.createElement('div', { className: "hud", style: (activeTab==="messages"&&msgView==="chat") ? {maxHeight:"100dvh",overflow:"hidden"} : {}}
          /* ══ HUD ══ */
          , React.createElement('div', { className: "hud-top" }
            , React.createElement('div', { className: "ava", style:{display:"flex",alignItems:"center",justifyContent:"center"} }, React.createElement(ClassIcon,{classKey:profile.chosenClass,size:26,color:cls.glow}))
            , React.createElement('div', { className: "hud-info" }
              , React.createElement('div', { className: "hud-name" }, profile.playerName)
              , React.createElement('div', { className: "hud-sub" }, cls.name, profile.gym ? ` · ${profile.gym}` : "")
              , (profile.hudFields?.weight||profile.hudFields?.height||profile.hudFields?.bmi) && React.createElement('div', { className: "hud-body" }
                , profile.hudFields?.weight&&profile.weightLbs?(isMetric(profile.units)?lbsToKg(profile.weightLbs)+" kg":profile.weightLbs+" lbs"):""
                , profile.hudFields?.weight&&profile.weightLbs&&profile.hudFields?.height&&totalH>0?" · ":""
                , profile.hudFields?.height&&totalH>0?(isMetric(profile.units)?ftInToCm(profile.heightFt,profile.heightIn)+" cm":`${profile.heightFt}'${profile.heightIn}"`):""
                , profile.hudFields?.bmi&&bmi?`${(profile.hudFields?.weight||profile.hudFields?.height)?" · ":""}BMI ${bmi}`:""
              )

              , React.createElement('div', { className: "xp-track" }
                , React.createElement('div', { className: "xp-fill", style: {width:`${Math.min(progress,100)}%`} })
              )
              , React.createElement('div', { className: "xp-lbl" }
                , React.createElement('span', null, (profile.xp-curXP).toLocaleString(), " / ", (nxtXP-curXP).toLocaleString(), " XP")
                , React.createElement('span', null, "→ Lv ", level+1)
              )
            )
            , React.createElement('div', { style: {display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,position:"relative",flexShrink:0} }
              , React.createElement('button', {
                  className: "btn nav-menu-btn btn-ghost",
                  style: {position:"relative"},
                  onClick: ()=>setNavMenuOpen(v=>!v)
                }, "☰"
                , msgUnreadTotal>0&&React.createElement('div', { style:{position:"absolute",top:1,right:2,width:8,height:8,borderRadius:"50%",background:"#e74c3c",border:"1.5px solid #0c0c0a"} })
              )
              , React.createElement('div', { style:{textAlign:"right"} }
                , React.createElement('div', { className: "hud-lv" }, level)
                , React.createElement('div', { className: "hud-lv-lbl" }, "Level")
                , React.createElement('div', { style:{fontSize:".48rem",color:"#4a4438",textAlign:"right",marginTop:2,letterSpacing:".03em",fontFamily:"'Inter',sans-serif"} }
                  , new Date().toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"})
                )
              )
            )
          )

          /* ══ DROPDOWN MENU — rendered outside hud-top to escape backdrop-filter stacking context ══ */
          , navMenuOpen && React.createElement('div', { onClick:()=>setNavMenuOpen(false), style:{position:"fixed",inset:0,zIndex:900} })
          , navMenuOpen && React.createElement('div', { className: "nav-menu-panel" }
            , [
                {icon:"⚔️", label:"Profile",  action:()=>guardAll(()=>{setActiveTab("profile");setNavMenuOpen(false);})},
                {icon:"📜", label:"Plans",       action:()=>guardAll(()=>{setActiveTab("plans");setPlanView("list");setNavMenuOpen(false);})},
                {icon:"📖", label:"Battle Log",  action:()=>guardAll(()=>{setActiveTab("history");setNavMenuOpen(false);})},
                {icon:"🏆", label:"Leaderboard", action:()=>guardAll(()=>{setActiveTab("leaderboard");setNavMenuOpen(false);})},
                {icon:"💬", label:"Messages", action:()=>guardAll(()=>{setActiveTab("messages");setMsgView("list");loadConversations();setNavMenuOpen(false);}), badge:msgUnreadTotal||null, badgeDanger:true},
                {icon:"🎯", label:"Quests",      action:()=>guardAll(()=>{setActiveTab("quests");setNavMenuOpen(false);}), badge:pendingQuestCount},
                // Map feature hidden — re-enable when ready
                // {icon:"🗺", label:"Map",         action:()=>{setMapOpen(true);setNavMenuOpen(false);}},
                {icon:"🛟", label:"Support",    action:()=>{setFeedbackOpen(true);setFeedbackSent(false);setFeedbackText("");setFeedbackEmail(_optionalChain([authUser, 'optionalAccess', _a => _a.email])||"");setFeedbackAccountId(myPublicId||"");setFeedbackType("help");setHelpConfirmShown(false);setNavMenuOpen(false);}},
                authUser&&{icon:"🚪", label:"Sign Out", action:()=>{signOut();setNavMenuOpen(false);}, danger:true},
                !authUser&&{icon:"🚪", label:"Exit Preview", action:()=>{setScreen("landing");setProfile(EMPTY_PROFILE);setNavMenuOpen(false);}, danger:true},
              ].filter(Boolean).map((item)=>
                React.createElement('button', {
                    key: item.label,
                    className: "nav-menu-item",
                    style: item.danger ? {color:"#7A2838",borderTop:"1px solid rgba(180,172,158,.04)"} : {},
                    onClick: item.action
                  }
                  , item.icon, " ", item.label
                  , item.badge>0 && React.createElement('span', { className: "nav-menu-badge", style: item.badgeDanger ? {background:"#e74c3c",color:"#fff"} : {} }, item.badge)
                )
              )
          )

          /* ══ BOTTOM TAB BAR — fixed iOS material ══ */
          , React.createElement('div', { className: "hud-nav-panel" }
            , React.createElement('div', { className: "tabs" }
              , [
                  ["workout","Exercises","mdi:dumbbell"],
                  ["workouts","Workouts","mdi:weight-lifter"],
                  ["calendar","Calendar","mdi:calendar-blank"],
                  ["character","Character","game-icons:crossed-swords"],
                  ["social","Guild","game-icons:tribal-pendant"]
                ].map(([t,l,iconName])=>{
                  const isOn = activeTab===t;
                  const tabColor = isOn ? "#d4cec4" : "#6a6050";
                  const iconPath = iconName.replace(":","/");
                  const iconSrc = `https://api.iconify.design/${iconPath}.svg?color=${encodeURIComponent(tabColor)}`;
                  return React.createElement('button', { key: t, className: `tab ${isOn?"on":""}`, onClick: ()=>guardAll(()=>{setActiveTab(t);if(t==="workouts")setWorkoutView("list");if(t==="social"&&authUser){loadSocialData();loadIncomingShares();}}) }
                    , React.createElement('span', { className: "tab-icon" }
                      , React.createElement('img', { src: iconSrc, alt: "", width: 22, height: 22, style: { display:"block" } })
                    )
                    , React.createElement('span', { className: "tab-label" }, l)
                    , t==="social"&&(friendRequests.length+incomingShares.length)>0&&React.createElement('span', { className: "tab-badge" }, friendRequests.length+incomingShares.length)
                  );
                })
            )
          )

          , React.createElement('div', { className: "scroll-area", style: (activeTab==="messages"&&msgView==="chat") ? {overflowY:"hidden",display:"flex",flexDirection:"column",paddingBottom:0} : {}}

            /* ── WORKOUT TAB ─────────────────────── */
            , activeTab==="workout" && (
              React.createElement(React.Fragment, null

                /* ══ DAILY CHECK-IN STRIP ══ */
                , React.createElement('div', { className: "hud-checkin-strip" }
                  , React.createElement('span', { style: {fontSize:"1.05rem"} }, "🔥")
                  , React.createElement('span', { style: {fontSize:".88rem",fontWeight:700,color:"#b4ac9e"} }, profile.checkInStreak)
                  , React.createElement('span', { style: {fontSize:".58rem",color:"#8a8478"} }, "day streak")
                  , React.createElement('div', { style: {flex:1} })
                  , React.createElement('button', {
                      style: {fontSize:".5rem",color:"#5a5650",background:"transparent",border:"none",cursor:"pointer",padding:"4px 8px"},
                      onClick: ()=>{setRetroCheckInModal(true);setRetroDate("");}
                    }, "↺ Retro")
                  , React.createElement('button', {
                      style: {fontSize:".5rem",color:"#c49428",background:"transparent",border:"1px solid rgba(196,148,40,.2)",borderRadius:6,cursor:"pointer",padding:"4px 8px"},
                      onClick: ()=>setShowWNMockup(true)
                    }, "📲 Notification")
                  , React.createElement('button', {
                      style: {padding:"7px 16px",borderRadius:8,fontSize:".54rem",fontWeight:600,border:"1px solid rgba(180,172,158,.08)",background:"linear-gradient(135deg,rgba(45,42,36,.45),rgba(45,42,36,.3))",color:"#d4cec4",cursor:"pointer",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",letterSpacing:".04em"},
                      disabled: profile.lastCheckIn===todayStr(),
                      onClick: doCheckIn
                    }, profile.lastCheckIn===todayStr() ? "✓ Checked In" : "Check In")
                )

                /* ══ EXERCISES SUB-TAB BAR ══ */
                , React.createElement('div', { className:"log-subtab-bar", style:{marginBottom:14} }
                  , [["library","📖 Library"],["myworkouts","💪 My Exercises"]].map(([t,l])=>
                    React.createElement('button', {
                      key:t,
                      className:`log-subtab-btn ${exSubTab===t?"on":""}`,
                      onClick:()=>setExSubTab(t)
                    }, l)
                  )
                )

                /* ══ LOG SUB-TAB (original grimoire view) ══ */
                , exSubTab==="log" && React.createElement(React.Fragment, null

                  /* ══ TECHNIQUES HEADER ══ */
                  , React.createElement('div', { className: "techniques-header" }
                    , React.createElement('div', { className: "tech-hdr-left" }
                      , React.createElement('div', { className: "tech-ornament-line tech-ornament-line-l" })
                      , React.createElement('span', { className: "tech-hdr-title" }, "✦ Techniques ✦")
                      , React.createElement('div', { className: "tech-ornament-line tech-ornament-line-r" })
                    )
                  )

                  /* ══ TECHNIQUE SEARCH ══ */
                  , React.createElement('div', { className: "tech-search-wrap" }
                    , React.createElement('span', { className: "tech-search-icon" }, "🔍")
                    , React.createElement('input', {
                        className: "tech-search-inp",
                        placeholder: "Search Techniques…",
                        value: exSearch,
                        onChange: e=>setExSearch(e.target.value)
                      })
                    , exSearch && React.createElement('span', { className: "tech-search-clear", onClick: ()=>setExSearch("") }, "✕")
                  )

                  /* ══ FILTERS ══ */
                  , React.createElement('div', { className: "filter-section" }
                    , React.createElement('div', { className: "filter-pills-row" }
                      , [{cat:"strength",icon:"⚔",label:"Strength"},{cat:"cardio",icon:"🏃",label:"Cardio"},{cat:"flexibility",icon:"🧘",label:"Flexibility"},{cat:"endurance",icon:"🛡",label:"Endurance"}].map(({cat,icon,label})=>
                          React.createElement('div', {
                              key: cat,
                              className: `filter-pill filter-${cat} ${exCatFilters.has(cat)?"on":""}`,
                              onClick: ()=>setExCatFilters(s=>{const n=new Set(s);n.has(cat)?n.delete(cat):n.add(cat);return n;})
                            }
                            , React.createElement('span', { className: "filter-pill-icon" }, icon)
                            , label
                          )
                      )
                    )
                    , React.createElement('div', { className: "filter-controls-row" }
                      , React.createElement('div', { style: {position:"relative",flexShrink:0} }
                        , React.createElement('button', {
                            className: `muscle-filter-btn ${exMuscleFilter!=="All"?"active":""}`,
                            onClick: ()=>setMusclePickerOpen(s=>!s)
                          }
                          , "🏋️ "
                          , exMuscleFilter==="All" ? "Muscles" : exMuscleFilter.charAt(0).toUpperCase()+exMuscleFilter.slice(1)
                          , React.createElement('svg', { width:"10", height:"10", viewBox:"0 0 14 14", fill:"none", style:{marginLeft:3,transition:"transform .2s",transform:musclePickerOpen?"rotate(180deg)":"rotate(0deg)"} }
                            , React.createElement('polyline', { points:"3,5 7,9 11,5", stroke:"currentColor", strokeWidth:"1.8", strokeLinecap:"round", strokeLinejoin:"round" })
                          )
                        )
                        , musclePickerOpen && (
                          React.createElement('div', { style: {position:"absolute",top:"110%",left:0,zIndex:20,background:"linear-gradient(145deg,#0c0c0a,#0c0c0a)",border:"1px solid rgba(180,172,158,.06)",borderRadius:10,padding:10,minWidth:180,maxWidth:"calc(100vw - 24px)",boxShadow:"0 8px 32px rgba(0,0,0,.7)"} }
                            , React.createElement('div', { style: {display:"flex",justifyContent:"space-between",marginBottom:7} }
                              , React.createElement('span', { style: {fontSize:".6rem",color:"#8a8478",textTransform:"uppercase",letterSpacing:".08em"} }, "Muscle Group")
                              , React.createElement('span', { style: {fontSize:".65rem",color:"#b4ac9e",cursor:"pointer"}, onClick: ()=>{setExMuscleFilter("All");setMusclePickerOpen(false);} }, "Clear")
                            )
                            , ["chest","shoulder","bicep","tricep","legs","back","glutes","abs","calves","forearm","cardio"].map(mg=>
                              React.createElement('div', {
                                  key: mg,
                                  style: {display:"flex",alignItems:"center",gap:8,padding:"5px 0",cursor:"pointer",borderBottom:"1px solid rgba(45,42,36,.15)"},
                                  onClick: ()=>{setExMuscleFilter(exMuscleFilter===mg?"All":mg);setMusclePickerOpen(false);}
                                }
                                , React.createElement('div', { style: {width:14,height:14,borderRadius:3,border:`1.5px solid ${exMuscleFilter===mg?getMuscleColor(mg):"rgba(180,172,158,.08)"}`,background:exMuscleFilter===mg?"rgba(45,42,36,.3)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0} }
                                  , exMuscleFilter===mg && React.createElement('span', { style: {color:getMuscleColor(mg),fontSize:".55rem"} }, "✓")
                                )
                                , React.createElement('span', { style: {fontSize:".72rem",color:exMuscleFilter===mg?getMuscleColor(mg):"#8a8478",textTransform:"capitalize"} }, mg)
                              )
                            )
                          )
                        )
                      )
                      , React.createElement('div', {
                          className: `filter-pill filter-favs ${showFavsOnly?"on":""}`,
                          onClick: ()=>setShowFavsOnly(v=>!v),
                          style: {marginLeft:"auto"}
                        }
                        , React.createElement('span', { className: "filter-pill-icon" }, "⭐")
                        , "Favorites"
                      )
                      , React.createElement('button', {
                          className: `filter-select-btn ${multiMode?"active":""}`,
                          onClick: ()=>{setMultiMode(m=>!m);setMultiSelEx(()=>new Set());setSelEx(null);}
                        }, multiMode ? "✕ Cancel" : "⊞ Select")
                    )
                  )

                  /* ══ COMMAND ACTION BAR ══ */
                  , multiMode && multiSelEx.size>0 && (
                    React.createElement('div', { className: "command-action-bar" }
                      , React.createElement('div', { className: "cab-count" }
                        , React.createElement('span', { className: "cab-rune" }, "⊞")
                        , React.createElement('span', { className: "cab-num" }, multiSelEx.size)
                      )
                      , React.createElement('div', { className: "cab-actions" }
                        , React.createElement('button', { className: "cab-btn", onClick: ()=>{
                            const ids=[...multiSelEx];
                            setSpwSelected(ids);
                            setSavePlanWizard({entries:ids.map(id=>({exId:id,exercise:_optionalChain([allExById,'access',_=>_[id],'optionalAccess',_=>_.name]),icon:_optionalChain([allExById,'access',_=>_[id],'optionalAccess',_=>_.icon]),_idx:id})),label:"Selected Exercises"});
                            setSpwName("Selected Exercises");setSpwIcon("📋");setSpwDate("");setSpwMode("new");setSpwTargetPlanId(null);
                            setMultiMode(false);setMultiSelEx(()=>new Set());
                          }}, "📋 Add to Plan")
                        , React.createElement('button', { className: "cab-btn", onClick: ()=>{
                            const exs=[...multiSelEx].map(id=>{const e=allExById[id];return {exId:id,sets:_optionalChain([e,'optionalAccess',_=>_.defaultSets])||3,reps:_optionalChain([e,'optionalAccess',_=>_.defaultReps])||10,weightLbs:_optionalChain([e,'optionalAccess',_=>_.defaultWeightLbs])||null,durationMin:_optionalChain([e,'optionalAccess',_=>_.defaultDurationMin])||null,weightPct:100,distanceMi:null,hrZone:null};});
                            setAddToWorkoutPicker({exercises:exs});
                            setMultiMode(false);setMultiSelEx(()=>new Set());
                          }}, "➕ Workout")
                        , React.createElement('button', { className: "cab-btn", onClick: ()=>{
                            const exs=[...multiSelEx].map(id=>{const e=allExById[id];return {exId:id,sets:_optionalChain([e,'optionalAccess',_=>_.defaultSets])||3,reps:_optionalChain([e,'optionalAccess',_=>_.defaultReps])||10,weightLbs:_optionalChain([e,'optionalAccess',_=>_.defaultWeightLbs])||null,durationMin:_optionalChain([e,'optionalAccess',_=>_.defaultDurationMin])||null,weightPct:100,distanceMi:null,hrZone:null};});
                            setWbExercises(exs);setWbName("");setWbIcon("💪");setWbDesc("");setWbEditId(null);
                            setWorkoutView("builder");setActiveTab("workouts");
                            setMultiMode(false);setMultiSelEx(()=>new Set());
                          }}, "💪 Reusable")
                      )
                    )
                  )

                  /* ══ GRIMOIRE GRID ══ */
                  , (()=>{
                    const q = exSearch.toLowerCase().trim();
                    const favs = profile.favoriteExercises||[];
                    const filtered = allExercises.filter(ex=>
                      (exCatFilters.size===0 || exCatFilters.has(ex.category) || (ex.secondaryCategory&&exCatFilters.has(ex.secondaryCategory)))&&
                      (exMuscleFilter==="All"||ex.muscleGroup===exMuscleFilter)&&
                      (!showFavsOnly||favs.includes(ex.id))&&
                      (q===""||ex.name.toLowerCase().includes(q))
                    );
                    const toggleFav = (e, exId) => {
                      e.stopPropagation();
                      setProfile(p=>({...p, favoriteExercises: (p.favoriteExercises||[]).includes(exId) ? (p.favoriteExercises||[]).filter(id=>id!==exId) : [...(p.favoriteExercises||[]), exId]}));
                    };
                    return React.createElement(React.Fragment, null
                      , filtered.length===0 && React.createElement('div', { className: "empty", style: {padding:"20px 0"} }, "No techniques found in the grimoire.")
                      , React.createElement('div', { className: "grimoire-grid" }
                        , React.createElement('div', { className: "grimoire-card grimoire-add-card", onClick: ()=>openExEditor("create",null) }
                          , React.createElement('span', { className: "grim-add-icon" }, "＋")
                          , React.createElement('span', { className: "grim-add-label" }, "New Technique")
                        )
                        , filtered.map(ex=>{
                            const m=getMult(ex),isB=m>1.02,isP=m<0.98;
                            const isMultiSel=multiSelEx.has(ex.id);
                            const isFav=favs.includes(ex.id);
                            const catColor=getTypeColor(ex.category);
                            return React.createElement('div', {
                                key: ex.id,
                                className: `grimoire-card ${multiMode&&isMultiSel?"grim-multi-sel":""} ${!multiMode&&selEx===ex.id?"grim-sel":""}`,
                                style: {"--cat-color": catColor},
                                onClick: ()=>{
                                  if(multiMode){setMultiSelEx(s=>{const n=new Set(s);n.has(ex.id)?n.delete(ex.id):n.add(ex.id);return n;});}
                                  else{const toggling=selEx===ex.id;setSelEx(toggling?null:ex.id);setMusclePickerOpen(false);if(!toggling){setSets("");setReps("");setExWeight("");setWeightPct(100);setDistanceVal("");setHrZone(null);setExHHMM("");setExSec("");setQuickRows([]);}}
                                }
                              }
                              , multiMode && React.createElement('div', { className: `grim-checkbox ${isMultiSel?"checked":""}` }, isMultiSel && "✓")
                              , React.createElement('div', { className: `grim-mult ${isB?"grim-bonus":isP?"grim-penalty":"grim-neutral"}` }, Math.round(m*100)+"%")
                              , React.createElement('div', { className: "grim-icon-orb", style: {"--cat-color": catColor} }
                                , React.createElement('span', { className: "grim-icon" }, ex.icon)
                              )
                              , React.createElement('div', { className: "grim-body" }
                                , React.createElement('div', { className: "grim-name" }
                                  , ex.name
                                  , ex.custom && React.createElement('span', { className: "custom-ex-badge" }, "custom")
                                )
                                , React.createElement('div', { className: "grim-meta" }
                                  , React.createElement('span', { className: "grim-xp" }, ex.baseXP+" XP")
                                  , React.createElement('span', { className: "grim-sep" }, "·")
                                  , React.createElement('span', { className: "grim-muscle", style: {color:getMuscleColor(ex.muscleGroup)} }, ex.muscles||ex.muscleGroup)
                                )
                              )
                              , !multiMode && React.createElement('div', {
                                  className: "grim-info-btn",
                                  onClick: e=>{e.stopPropagation();setDetailEx(ex);setDetailImgIdx(0);}
                                }, "ℹ")
                              , !multiMode && React.createElement('div', {
                                  className: `grim-fav-btn ${isFav?"faved":""}`,
                                  onClick: e=>toggleFav(e, ex.id)
                                }, isFav ? "⭐" : "☆")
                            );
                          })
                      )
                    );
                  })()
                )

                /* ══ LIBRARY SUB-TAB ══ */

                , exSubTab==="library" && (()=>{
                  const TYPE_OPTS  = ["strength","cardio","flexibility","yoga","stretching","plyometric","calisthenics","functional","isometric","warmup","cooldown"];
                  const TYPE_LABELS = {strength:"⚔️ Strength",cardio:"🏃 Cardio",flexibility:"🧘 Flexibility",yoga:"🧘 Yoga",stretching:"🌿 Stretch",plyometric:"⚡ Plyo",calisthenics:"🤸 Cali",functional:"🔧 Functional",isometric:"🧱 Isometric",warmup:"🌅 Warmup",cooldown:"🌙 Cooldown"};
                  const ALL_MUSCLE_OPTS = ["chest","back","shoulder","bicep","tricep","legs","glutes","abs","calves","forearm","full_body","cardio"];
                  const ALL_EQUIP_OPTS  = ["barbell","dumbbell","kettlebell","cable","machine","bodyweight","band"];

                  const toggleSet = (setter, val) => { setter(s=>{ const n=new Set(s); n.has(val)?n.delete(val):n.add(val); return n; }); setLibVisibleCount(60); };
                  const clearAll  = () => { setLibTypeFilters(new Set()); setLibMuscleFilters(new Set()); setLibEquipFilters(new Set()); setLibSearch(""); setLibSearchDebounced(""); setLibVisibleCount(60); setLibBrowseMode("home"); };
                  const hasFilters = libTypeFilters.size>0 || libMuscleFilters.size>0 || libEquipFilters.size>0 || libSearch;

                  const q2 = libSearchDebounced.toLowerCase().trim();

                  // Filter function — checks all three filter sets (OR within each, AND across sets)
                  const matchesFilters = (ex, tF, mF, eF) => {
                    if(tF.size>0){
                      const types=(ex.exerciseType||"").toLowerCase();
                      const cat  =(ex.category||"").toLowerCase();
                      // match if any selected type appears in exerciseType string OR equals category
                      if(![...tF].some(t=>types.includes(t)||cat===t)) return false;
                    }
                    if(mF.size>0){
                      const mg=(ex.muscleGroup||"").toLowerCase().trim();
                      if(!mF.has(mg)) return false;
                    }
                    if(eF.size>0){
                      const eq=(ex.equipment||"bodyweight").toLowerCase().trim();
                      if(!eF.has(eq)) return false;
                    }
                    return true;
                  };

                  const libFiltered = allExercises.filter(ex=>{
                    if(q2 && !ex.name.toLowerCase().includes(q2)) return false;
                    return matchesFilters(ex, libTypeFilters, libMuscleFilters, libEquipFilters);
                  });

                  // Cascading: which muscle groups are available given current type+equip filters?
                  const availableMuscles = new Set(
                    allExercises
                      .filter(ex=>matchesFilters(ex, libTypeFilters, new Set(), libEquipFilters))
                      .map(ex=>(ex.muscleGroup||"").toLowerCase().trim())
                      .filter(Boolean)
                  );
                  // Which equipment types are available given current type+muscle filters?
                  const availableEquip = new Set(
                    allExercises
                      .filter(ex=>matchesFilters(ex, libTypeFilters, libMuscleFilters, new Set()))
                      .map(ex=>(ex.equipment||"bodyweight").toLowerCase().trim())
                      .filter(Boolean)
                  );
                  // Which types are available given current muscle+equip filters?
                  const availableTypes = new Set(
                    allExercises
                      .filter(ex=>matchesFilters(ex, new Set(), libMuscleFilters, libEquipFilters))
                      .flatMap(ex=>{
                        const types=(ex.exerciseType||"").toLowerCase().split(",").map(s=>s.trim()).filter(Boolean);
                        const cat  =(ex.category||"").toLowerCase();
                        return cat ? [...types, cat] : types;
                      })
                  );

                  const MUSCLE_OPTS = ALL_MUSCLE_OPTS.filter(m=>availableMuscles.has(m)||libMuscleFilters.has(m));
                  const EQUIP_OPTS  = ALL_EQUIP_OPTS.filter(e=>availableEquip.has(e)||libEquipFilters.has(e));

                  const toggleSel = (id) => setLibSelected(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });

                  /* ── Home view computed data ── */
                  const hexRgba = (hex, a) => { const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return `rgba(${r},${g},${b},${a})`; };

                  const MUSCLE_CARD_DATA = ALL_MUSCLE_OPTS.filter(m=>m!=="full_body").map(mg=>{
                    const count = allExercises.filter(ex=>(ex.muscleGroup||"").toLowerCase().trim()===mg).length;
                    const meta = MUSCLE_META[mg] || {emoji:"💪",label:mg.charAt(0).toUpperCase()+mg.slice(1),icon:"game-icons:weight-lifting-up"};
                    return {mg, label:meta.label, emoji:meta.emoji, icon:meta.icon, count, color:getMuscleColor(mg)};
                  }).filter(d=>d.count>0);

                  // Recent exercises — deduped from log, padded with favorites
                  const recentExIds = []; const seenIds = new Set();
                  for(const entry of (profile.log||[]).slice(0,100)){
                    if(entry.exId && !seenIds.has(entry.exId) && allExById[entry.exId]){ recentExIds.push(entry.exId); seenIds.add(entry.exId); }
                    if(recentExIds.length>=10) break;
                  }
                  for(const fId of (profile.favoriteExercises||[])){
                    if(!seenIds.has(fId) && allExById[fId]){ recentExIds.push(fId); seenIds.add(fId); }
                    if(recentExIds.length>=10) break;
                  }
                  const yourExercises = recentExIds.map(id=>allExById[id]).filter(Boolean);

                  // Discover rows
                  const discoverRows = [
                    {label:"Beginner Friendly", exercises:allExercises.filter(ex=>(ex.baseXP||0)<45).slice(0,15),
                     onSeeAll:()=>setLibBrowseMode("filtered")},
                    {label:"Advanced Challenges", exercises:allExercises.filter(ex=>(ex.baseXP||0)>=60).slice(0,15),
                     onSeeAll:()=>setLibBrowseMode("filtered")},
                  ].concat(_exercisesLoaded ? [
                    {label:"Bodyweight Only", exercises:allExercises.filter(ex=>(ex.equipment||"bodyweight").toLowerCase()==="bodyweight").slice(0,15),
                     onSeeAll:()=>{setLibEquipFilters(new Set(["bodyweight"]));setLibBrowseMode("filtered");}},
                    {label:"Dumbbell Exercises", exercises:allExercises.filter(ex=>(ex.equipment||"").toLowerCase()==="dumbbell").slice(0,15),
                     onSeeAll:()=>{setLibEquipFilters(new Set(["dumbbell"]));setLibBrowseMode("filtered");}},
                    {label:"Barbell Essentials", exercises:allExercises.filter(ex=>(ex.equipment||"").toLowerCase()==="barbell").slice(0,15),
                     onSeeAll:()=>{setLibEquipFilters(new Set(["barbell"]));setLibBrowseMode("filtered");}},
                  ] : []);

                  // Fade-edge scroll handler
                  const handleHScroll = (e) => {
                    const el = e.currentTarget;
                    const wrap = el.parentElement;
                    if(!wrap) return;
                    const atLeft = el.scrollLeft > 8;
                    const atRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 8;
                    wrap.classList.toggle('fade-left', atLeft);
                    wrap.classList.toggle('fade-right-off', !atRight);
                  };

                  return React.createElement('div', null,
                    /* Sticky search bar — translucent material */
                    React.createElement('div', {className:"lib-sticky-search"},
                    React.createElement('div', {style:{display:"flex",gap:8,alignItems:"center"}},
                      React.createElement('div', {className:"tech-search-wrap",style:{flex:1,marginBottom:0}},
                        React.createElement('span', {className:"tech-search-icon"}, "🔍"),
                        React.createElement('input', {
                          className:"tech-search-inp",
                          placeholder:`Search ${allExercises.length} exercises…`,
                          value:libSearch,
                          onChange:e=>{const v=e.target.value;setLibSearch(v);debouncedSetLibSearch(v);if(v&&libBrowseMode==="home")setLibBrowseMode("filtered");}
                        }),
                        libSearch && React.createElement('span', {className:"tech-search-clear",onClick:()=>{setLibSearch("");setLibSearchDebounced("");setLibVisibleCount(60);if(libMuscleFilters.size===0&&libTypeFilters.size===0&&libEquipFilters.size===0)setLibBrowseMode("home");}}, "✕")
                      ),
                      libBrowseMode==="filtered" && React.createElement('button', {
                        onClick:()=>{ setLibSelectMode(m=>!m); setLibSelected(new Set()); },
                        style:{flexShrink:0,padding:"6px 12px",borderRadius:8,border:"1px solid",
                               borderColor:libSelectMode?"#B0A898":"rgba(45,42,36,.3)",
                               background:libSelectMode?"rgba(45,42,36,.26)":"transparent",
                               color:libSelectMode?"#B0A898":"#8a8478",fontSize:".7rem",fontWeight:libSelectMode?"700":"400",cursor:"pointer",whiteSpace:"nowrap"}
                      }, libSelectMode?"✕ Cancel":"⊞ Select")
                    )
                    ),

                    /* ═══ HOME VIEW ═══ */
                    libBrowseMode === "home" && React.createElement('div', null,

                      /* Your Exercises — hero carousel */
                      yourExercises.length > 0 && React.createElement('div', {className:"lib-home-section",style:{marginBottom:4}},
                        React.createElement('div', {className:"lib-section-hdr"},
                          React.createElement('span', {className:"lib-hdr-icon"}, "⚔️"),
                          "Your Exercises"
                        ),
                        React.createElement('div', {className:"lib-hscroll-wrap"},
                        React.createElement('div', {className:"lib-hscroll",onScroll:handleHScroll},
                          yourExercises.map(ex=>{
                            const mgColor = getMuscleColor(ex.muscleGroup);
                            const mgLabel = (MUSCLE_META[(ex.muscleGroup||"").toLowerCase()] || {}).label || ex.muscleGroup || "";
                            return React.createElement('div', {
                              key:"yr-"+ex.id,
                              className:"lib-hero-card",
                              onClick:()=>setLibDetailEx(ex),
                              style:{'--mg-color':mgColor}
                            },
                              React.createElement('div', {className:"lib-hero-orb",style:{'--mg-color':mgColor}},
                                React.createElement(ExIcon, {ex, size:"1.4rem", color:mgColor})
                              ),
                              React.createElement('span', {className:"lib-hero-name"}, ex.name),
                              mgLabel && React.createElement('span', {className:"lib-muscle-pill",style:{'--mg-color':mgColor}}, mgLabel)
                            );
                          })
                        )
                        )
                      ),

                      yourExercises.length > 0 && React.createElement('div', {className:"lib-divider"}),

                      /* Browse by Muscle — feature tiles */
                      React.createElement('div', {className:"lib-home-section",style:{marginBottom:4}},
                        React.createElement('div', {className:"lib-section-hdr"},
                          React.createElement('span', {className:"lib-hdr-icon"}, "🗺️"),
                          "Browse by Muscle"
                        ),
                        React.createElement('div', {style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}},
                          MUSCLE_CARD_DATA.map(({mg, label, emoji, icon, count, color})=>
                            React.createElement('div', {
                              key:"mc-"+mg,
                              className:"lib-muscle-tile",
                              onClick:()=>{setLibMuscleFilters(new Set([mg]));setLibBrowseMode("filtered");},
                              style:{'--mg-color':color}
                            },
                              React.createElement('span', {className:"lib-tile-watermark"}, emoji),
                              React.createElement('div', {className:"lib-tile-orb",style:{'--mg-color':color}},
                                React.createElement(ExIcon, {ex:{muscleGroup:mg,category:"strength"}, size:"1.15rem", color:color})
                              ),
                              React.createElement('div', null,
                                React.createElement('div', {className:"lib-tile-name"}, label),
                                React.createElement('div', {className:"lib-tile-count",style:{'--mg-color':color}}, count+" exercises")
                              )
                            )
                          )
                        )
                      ),

                      React.createElement('div', {className:"lib-divider"}),

                      /* Discover Rows — Netflix-style horizontal scroll */
                      discoverRows.map((row,ri)=>
                        row.exercises.length >= 3 && React.createElement('div', {key:"dr-"+row.label,className:"lib-home-section",style:{marginBottom:ri < discoverRows.length-1 ? 18 : 0}},
                          React.createElement('div', {style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}},
                            React.createElement('span', {className:"lib-section-hdr",style:{marginBottom:0}}, row.label),
                            React.createElement('button', {className:"lib-see-all",onClick:row.onSeeAll}, "See All →")
                          ),
                          React.createElement('div', {className:"lib-hscroll-wrap"},
                          React.createElement('div', {className:"lib-hscroll",onScroll:handleHScroll},
                            row.exercises.map(ex=>{
                              const mgColor = getMuscleColor(ex.muscleGroup);
                              const diff = (ex.difficulty||"").toLowerCase();
                              const diffCls = diff === "beginner" ? "lib-diff-beginner" : diff === "advanced" ? "lib-diff-advanced" : diff === "intermediate" ? "lib-diff-intermediate" : "";
                              const mgLabel = (MUSCLE_META[(ex.muscleGroup||"").toLowerCase()] || {}).label || "";
                              return React.createElement('div', {
                                key:"d-"+ex.id,
                                className:"lib-discover-card",
                                onClick:()=>setLibDetailEx(ex),
                                style:{'--mg-color':mgColor}
                              },
                                React.createElement('div', {className:"lib-discover-orb",style:{'--mg-color':mgColor}},
                                  React.createElement(ExIcon, {ex, size:"1.1rem", color:mgColor})
                                ),
                                React.createElement('span', {className:"lib-discover-name"}, ex.name),
                                React.createElement('div', {className:"lib-discover-meta"},
                                  mgLabel && React.createElement('span', {style:{fontSize:".5rem",color:mgColor,fontWeight:500}}, mgLabel),
                                  mgLabel && diffCls && React.createElement('span', {style:{fontSize:".45rem",color:"#3a3834"}}, "·"),
                                  diffCls && React.createElement('span', {className:"lib-diff-badge "+diffCls}, ex.difficulty),
                                  React.createElement('span', {style:{fontSize:".5rem",color:"#6a6050",fontWeight:600}}, (ex.baseXP||0)+" XP")
                                )
                              );
                            })
                          )
                          )
                        )
                      )
                    ),

                    /* ═══ FILTERED VIEW ═══ */
                    libBrowseMode === "filtered" && React.createElement('div', null,
                    /* Back to browse */
                    React.createElement('div', {style:{marginBottom:10}},
                      React.createElement('button', {
                        onClick:()=>clearAll(),
                        style:{background:"transparent",border:"none",color:"#b4ac9e",fontSize:".78rem",cursor:"pointer",padding:"4px 0",display:"flex",alignItems:"center",gap:4}
                      }, "← Browse Library")
                    ),

                    /* Filter dropdowns row — custom panels that stay open for multi-select */
                    React.createElement('div', {style:{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap",position:"relative"}},

                      /* Close-on-outside-click overlay */
                      libOpenDrop && React.createElement('div', {
                        onClick:()=>setLibOpenDrop(null),
                        style:{position:"fixed",inset:0,zIndex:19}
                      }),

                      /* ── Type dropdown ── */
                      React.createElement('div', {style:{position:"relative",flex:"1 1 110px",zIndex:20}},
                        React.createElement('button', {
                          onClick:()=>setLibOpenDrop(libOpenDrop==="type"?null:"type"),
                          style:{width:"100%",padding:"7px 28px 7px 10px",borderRadius:9,
                                 border:"1px solid "+(libTypeFilters.size>0?"#C4A044":"rgba(45,42,36,.3)"),
                                 background:"rgba(14,14,12,.95)",
                                 color:libTypeFilters.size>0?"#C4A044":"#8a8478",
                                 fontSize:".72rem",textAlign:"left",cursor:"pointer",position:"relative"}
                        },
                          libTypeFilters.size>0?"Type ("+libTypeFilters.size+")":"Type",
                          React.createElement('span',{style:{position:"absolute",right:8,top:"50%",
                            transform:"translateY(-50%) rotate("+(libOpenDrop==="type"?"180deg":"0deg")+")",
                            color:libTypeFilters.size>0?"#C4A044":"#6a6050",fontSize:".6rem",
                            transition:"transform .15s",lineHeight:1}},"▼")
                        ),
                        libOpenDrop==="type" && React.createElement('div', {
                          style:{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:"100%",
                                 background:"rgba(16,14,10,.95)",border:"1px solid rgba(180,172,158,.07)",
                                 borderRadius:9,padding:"6px 4px",zIndex:21,
                                 boxShadow:"0 8px 24px rgba(0,0,0,.6)"}
                        },
                          TYPE_OPTS.map(val=>{
                            const sel=libTypeFilters.has(val);
                            const avail=availableTypes.size===0||availableTypes.has(val)||sel;
                            return React.createElement('div', {
                              key:val,
                              onClick:()=>toggleSet(setLibTypeFilters,val),
                              style:{display:"flex",alignItems:"center",gap:8,
                                     padding:"6px 10px",borderRadius:6,cursor:"pointer",
                                     opacity:avail?1:0.35,
                                     background:sel?"rgba(45,42,36,.22)":"transparent"}
                            },
                              React.createElement('div', {style:{
                                width:14,height:14,borderRadius:3,flexShrink:0,
                                border:"1.5px solid "+(sel?getTypeColor(val):"rgba(180,172,158,.08)"),
                                background:sel?"rgba(45,42,36,.32)":"transparent",
                                display:"flex",alignItems:"center",justifyContent:"center"
                              }}, sel && React.createElement('span',{style:{fontSize:".6rem",color:getTypeColor(val),lineHeight:1}},"✓")),
                              React.createElement('span',{style:{fontSize:".72rem",
                                color:sel?getTypeColor(val):avail?"#b4ac9e":"#5a5650",
                                whiteSpace:"nowrap"}},
                                TYPE_LABELS[val])
                            );
                          })
                        )
                      ),

                      /* ── Muscle dropdown ── */
                      React.createElement('div', {style:{position:"relative",flex:"1 1 110px",zIndex:20}},
                        React.createElement('button', {
                          onClick:()=>setLibOpenDrop(libOpenDrop==="muscle"?null:"muscle"),
                          style:{width:"100%",padding:"7px 28px 7px 10px",borderRadius:9,
                                 border:"1px solid "+(libMuscleFilters.size>0?"#3498db":"rgba(45,42,36,.3)"),
                                 background:"rgba(14,14,12,.95)",
                                 color:libMuscleFilters.size>0?"#7A8F8B":"#8a8478",
                                 fontSize:".72rem",textAlign:"left",cursor:"pointer",position:"relative"}
                        },
                          libMuscleFilters.size>0?"Muscle ("+libMuscleFilters.size+")":"Muscle Group",
                          React.createElement('span',{style:{position:"absolute",right:8,top:"50%",
                            transform:"translateY(-50%) rotate("+(libOpenDrop==="muscle"?"180deg":"0deg")+")",
                            color:libMuscleFilters.size>0?"#7A8F8B":"#6a6050",fontSize:".6rem",
                            transition:"transform .15s",lineHeight:1}},"▼")
                        ),
                        libOpenDrop==="muscle" && React.createElement('div', {
                          style:{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:"100%",
                                 background:"rgba(16,14,10,.95)",border:"1px solid rgba(122,143,139,.25)",
                                 borderRadius:9,padding:"6px 4px",zIndex:21,
                                 boxShadow:"0 8px 24px rgba(0,0,0,.6)"}
                        },
                          MUSCLE_OPTS.map(m=>{
                            const sel=libMuscleFilters.has(m);
                            return React.createElement('div', {
                              key:m,
                              onClick:()=>toggleSet(setLibMuscleFilters,m),
                              style:{display:"flex",alignItems:"center",gap:8,
                                     padding:"6px 10px",borderRadius:6,cursor:"pointer",
                                     background:sel?"rgba(122,143,139,.12)":"transparent"}
                            },
                              React.createElement('div', {style:{
                                width:14,height:14,borderRadius:3,flexShrink:0,
                                border:"1.5px solid "+(sel?"#7A8F8B":"rgba(122,143,139,.3)"),
                                background:sel?"rgba(122,143,139,.25)":"transparent",
                                display:"flex",alignItems:"center",justifyContent:"center"
                              }}, sel && React.createElement('span',{style:{fontSize:".6rem",color:"#3498db",lineHeight:1}},"✓")),
                              React.createElement('span',{style:{fontSize:".72rem",
                                color:sel?"#7A8F8B":"#b4ac9e",whiteSpace:"nowrap"}},
                                m.charAt(0).toUpperCase()+m.slice(1).replace("_"," "))
                            );
                          })
                        )
                      ),

                      /* ── Equipment dropdown ── */
                      React.createElement('div', {style:{position:"relative",flex:"1 1 110px",zIndex:20}},
                        React.createElement('button', {
                          onClick:()=>setLibOpenDrop(libOpenDrop==="equip"?null:"equip"),
                          style:{width:"100%",padding:"7px 28px 7px 10px",borderRadius:9,
                                 border:"1px solid "+(libEquipFilters.size>0?"#9b59b6":"rgba(45,42,36,.3)"),
                                 background:"rgba(14,14,12,.95)",
                                 color:libEquipFilters.size>0?"#9b59b6":"#8a8478",
                                 fontSize:".72rem",textAlign:"left",cursor:"pointer",position:"relative"}
                        },
                          libEquipFilters.size>0?"Equip ("+libEquipFilters.size+")":"Equipment",
                          React.createElement('span',{style:{position:"absolute",right:8,top:"50%",
                            transform:"translateY(-50%) rotate("+(libOpenDrop==="equip"?"180deg":"0deg")+")",
                            color:libEquipFilters.size>0?"#9b59b6":"#6a6050",fontSize:".6rem",
                            transition:"transform .15s",lineHeight:1}},"▼")
                        ),
                        libOpenDrop==="equip" && React.createElement('div', {
                          style:{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:"100%",
                                 background:"rgba(16,14,10,.95)",border:"1px solid rgba(155,89,182,.25)",
                                 borderRadius:9,padding:"6px 4px",zIndex:21,
                                 boxShadow:"0 8px 24px rgba(0,0,0,.6)"}
                        },
                          EQUIP_OPTS.map(eq=>{
                            const sel=libEquipFilters.has(eq);
                            return React.createElement('div', {
                              key:eq,
                              onClick:()=>toggleSet(setLibEquipFilters,eq),
                              style:{display:"flex",alignItems:"center",gap:8,
                                     padding:"6px 10px",borderRadius:6,cursor:"pointer",
                                     background:sel?"rgba(155,89,182,.12)":"transparent"}
                            },
                              React.createElement('div', {style:{
                                width:14,height:14,borderRadius:3,flexShrink:0,
                                border:"1.5px solid "+(sel?"#9b59b6":"rgba(155,89,182,.3)"),
                                background:sel?"rgba(155,89,182,.25)":"transparent",
                                display:"flex",alignItems:"center",justifyContent:"center"
                              }}, sel && React.createElement('span',{style:{fontSize:".6rem",color:"#9b59b6",lineHeight:1}},"✓")),
                              React.createElement('span',{style:{fontSize:".72rem",
                                color:sel?"#9b59b6":"#b4ac9e",whiteSpace:"nowrap"}},
                                eq.charAt(0).toUpperCase()+eq.slice(1))
                            );
                          })
                        )
                      )
                    ),

                    /* Active filter tags — show what's selected, tap to remove */
                    (libTypeFilters.size>0||libMuscleFilters.size>0||libEquipFilters.size>0) && React.createElement('div', {style:{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}},
                      [...libTypeFilters].map(v=>React.createElement('span',{key:"t"+v,onClick:()=>toggleSet(setLibTypeFilters,v),
                        style:{background:"rgba(196,160,68,.08)",border:"1px solid rgba(196,160,68,.25)",color:getTypeColor(v),
                               fontSize:".62rem",padding:"3px 8px",borderRadius:12,cursor:"pointer",display:"flex",alignItems:"center",gap:4}},
                        TYPE_LABELS[v]||v," ✕")),
                      [...libMuscleFilters].map(v=>React.createElement('span',{key:"m"+v,onClick:()=>toggleSet(setLibMuscleFilters,v),
                        style:{background:"rgba(122,143,139,.12)",border:"1px solid rgba(122,143,139,.3)",color:getMuscleColor(v),
                               fontSize:".62rem",padding:"3px 8px",borderRadius:12,cursor:"pointer",display:"flex",alignItems:"center",gap:4}},
                        v.charAt(0).toUpperCase()+v.slice(1).replace("_"," ")," ✕")),
                      [...libEquipFilters].map(v=>React.createElement('span',{key:"e"+v,onClick:()=>toggleSet(setLibEquipFilters,v),
                        style:{background:"rgba(155,89,182,.15)",border:"1px solid #9b59b644",color:"#9b59b6",
                               fontSize:".62rem",padding:"3px 8px",borderRadius:12,cursor:"pointer",display:"flex",alignItems:"center",gap:4}},
                        v.charAt(0).toUpperCase()+v.slice(1)," ✕"))
                    ),

                    /* Count + clear row */
                    React.createElement('div', {style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}},
                      React.createElement('div', {style:{fontSize:".68rem",color:"#4a4438"}},
                        libFiltered.length+" exercises"
                      ),
                      hasFilters && React.createElement('button', {
                        onClick:clearAll,
                        style:{background:"transparent",border:"none",color:"#b4ac9e",fontSize:".68rem",cursor:"pointer"}
                      }, "Clear all filters")
                    ),

                    /* Select mode action bar */
                    libSelectMode && libSelected.size>0 && React.createElement('div', {
                      style:{background:"rgba(45,42,36,.2)",border:"1px solid rgba(180,172,158,.06)",borderRadius:10,
                             padding:"10px 14px",marginBottom:10,display:"flex",flexDirection:"column",alignItems:"center",gap:8}
                    },
                      React.createElement('span',{style:{fontSize:".72rem",color:"#b4ac9e",fontWeight:"700"}}, libSelected.size+" selected"),
                      React.createElement('div',{style:{display:"flex",gap:8,justifyContent:"center"}},
                      React.createElement('button',{
                        onClick:()=>{
                          const exs=[...libSelected].map(id=>{const e=allExById[id];return {exId:id,sets:(e&&e.defaultSets!=null?e.defaultSets:3),reps:(e&&e.defaultReps!=null?e.defaultReps:10),weightLbs:null,durationMin:(e&&e.defaultDurationMin)||null,weightPct:100,distanceMi:null,hrZone:null};});
                          setAddToWorkoutPicker({exercises:exs});
                          setLibSelectMode(false);setLibSelected(new Set());
                        },
                        style:{background:"rgba(45,42,36,.22)",border:"1px solid rgba(180,172,158,.08)",color:"#b4ac9e",padding:"6px 12px",borderRadius:8,fontSize:".7rem",fontWeight:"700",cursor:"pointer",whiteSpace:"nowrap",textAlign:"center"}
                      }, "➕ Existing"),
                      React.createElement('button',{
                        onClick:()=>{
                          const exs=[...libSelected].map(id=>{const e=allExById[id];return {exId:id,sets:(e&&e.defaultSets!=null?e.defaultSets:3),reps:(e&&e.defaultReps!=null?e.defaultReps:10),weightLbs:null,durationMin:(e&&e.defaultDurationMin)||null,weightPct:100,distanceMi:null,hrZone:null};});
                          setWbExercises(exs);setWbName("");setWbIcon("💪");setWbDesc("");setWbEditId(null);setWbIsOneOff(false);
                          setWorkoutView("builder");setActiveTab("workouts");
                          setLibSelectMode(false);setLibSelected(new Set());
                        },
                        style:{background:"linear-gradient(135deg,#5b2d8e,#7b1fa2)",border:"none",color:"#fff",padding:"6px 12px",borderRadius:8,fontSize:".7rem",fontWeight:"700",cursor:"pointer",whiteSpace:"nowrap",textAlign:"center"}
                      }, "⚡ New Workout"),
                      React.createElement('button',{
                        onClick:()=>{
                          const ids=[...libSelected];
                          setSpwSelected(ids);
                          setSavePlanWizard({entries:ids.map(id=>({exId:id,exercise:allExById[id]&&allExById[id].name,icon:allExById[id]&&allExById[id].icon,_idx:id})),label:"Selected Exercises"});
                          setSpwName("Selected Exercises");setSpwIcon("📋");setSpwDate("");setSpwMode("new");setSpwTargetPlanId(null);
                          setLibSelectMode(false);setLibSelected(new Set());
                        },
                        style:{background:"rgba(45,42,36,.26)",border:"1px solid rgba(180,172,158,.08)",color:"#b4ac9e",padding:"6px 12px",borderRadius:8,fontSize:".7rem",fontWeight:"700",cursor:"pointer",whiteSpace:"nowrap",textAlign:"center"}
                      }, "📋 Plan")
                    )),

                    /* Exercise list (paginated) */
                    React.createElement('div', {style:{display:"flex",flexDirection:"column",gap:6}},
                      libFiltered.length===0 && React.createElement('div',{className:"empty",style:{padding:"24px 0"}},"No exercises match your filters."),
                      libFiltered.slice(0, libVisibleCount).map(ex=>{
                        const isFav=(profile.favoriteExercises||[]).includes(ex.id);
                        const hasPB=!!(profile.exercisePBs||{})[ex.id];
                        const isSel=libSelected.has(ex.id);
                        // Derive difficulty — prefer stored value, fall back to baseXP tiers
                        const diffLabel = ex.difficulty || (ex.baseXP>=60?"Advanced":ex.baseXP>=45?"Intermediate":"Beginner");
                        const diffColor = diffLabel==="Advanced"?"#7A2838":diffLabel==="Beginner"?"#5A8A58":"#A8843C";
                        // Sub-line: italic type · muscle · equipment
                        const subParts = [
                          ex.category ? ex.category.charAt(0).toUpperCase()+ex.category.slice(1) : null,
                          ex.muscleGroup ? ex.muscleGroup.charAt(0).toUpperCase()+ex.muscleGroup.slice(1) : null,
                          ex.equipment && ex.equipment!=="bodyweight" ? ex.equipment : null,
                        ].filter(Boolean).join(" · ");
                        const exMgColor = getMuscleColor(ex.muscleGroup);
                        return React.createElement('div', {
                          key:ex.id,
                          className:`picker-ex-row${isSel?" sel":""}`,
                          onClick:()=>{ if(libSelectMode){ toggleSel(ex.id); } else { setLibDetailEx(ex); } },
                          style:{"--mg-color":exMgColor}
                        },
                          /* Icon orb */
                          React.createElement('div', {className:"picker-ex-orb"},
                            React.createElement(ExIcon, {ex:ex, size:"1rem", color:"#d4cec4"})
                          ),
                          /* Body */
                          React.createElement('div', {style:{flex:1, minWidth:0}},
                            React.createElement('div', {style:{display:"flex", alignItems:"center", gap:5, flexWrap:"wrap", marginBottom:3}},
                              React.createElement('span', {style:{
                                fontSize:".83rem", fontWeight:600,
                                color: isSel ? "#d4cec4" : "#d4cec4",
                                letterSpacing:".01em",
                              }}, ex.name),
                              hasPB && React.createElement('span',{style:{fontSize:".6rem"}}, "🏆"),
                            ),
                            React.createElement('div', {style:{
                              fontSize:".62rem", fontStyle:"italic", lineHeight:1.4,
                            }},
                              ex.category && React.createElement('span',{style:{color:getTypeColor(ex.category)}}, ex.category.charAt(0).toUpperCase()+ex.category.slice(1)),
                              ex.category && ex.muscleGroup && React.createElement('span',{style:{color:"#5a5650"}}, " · "),
                              ex.muscleGroup && React.createElement('span',{style:{color:getMuscleColor(ex.muscleGroup)}}, ex.muscleGroup.charAt(0).toUpperCase()+ex.muscleGroup.slice(1)),
                              ex.equipment && ex.equipment!=="bodyweight" && React.createElement('span',{style:{color:"#5a5650"}}, " · "),
                              ex.equipment && ex.equipment!=="bodyweight" && React.createElement('span',{style:{color:"#8a8478"}}, ex.equipment)
                            )
                          ),
                          /* Right */
                          React.createElement('div', {style:{flexShrink:0, display:"flex", flexDirection:"column", alignItems:"flex-end", gap:5}},
                            React.createElement('span', {style:{fontSize:".66rem", fontWeight:700, color:"#b4ac9e", letterSpacing:".02em"}},
                              ex.baseXP+" XP"),
                            diffLabel
                              ? React.createElement('span', {style:{
                                  display:"inline-flex", alignItems:"center",
                                  padding:"2px 8px", borderRadius:4,
                                  fontSize:".58rem", fontWeight:700, letterSpacing:".05em",
                                  color: diffColor,
                                  background: diffLabel==="Advanced"
                                    ? "#2e1515"
                                    : diffLabel==="Beginner"
                                      ? "#1a2e1a"
                                      : "#2e2010",
                                }}, diffLabel)
                              : null,
                            !libSelectMode && React.createElement('button', {
                              style:{background:"transparent",border:"none",
                                     color:isFav?"#d4cec4":"#3a3834",
                                     fontSize:".9rem",cursor:"pointer",padding:0,lineHeight:1},
                              onClick:e=>{e.stopPropagation();setProfile(p=>({...p,favoriteExercises:(p.favoriteExercises||[]).includes(ex.id)?(p.favoriteExercises||[]).filter(i=>i!==ex.id):[...(p.favoriteExercises||[]),ex.id]}));}
                            }, isFav?"⭐":"☆")
                          )
                        );
                      }),
                      /* Load More / count info */
                      libFiltered.length > libVisibleCount && React.createElement('button', {
                        onClick:()=>setLibVisibleCount(c=>c+60),
                        style:{alignSelf:"center",margin:"12px auto",padding:"8px 24px",borderRadius:8,
                               border:"1px solid rgba(180,172,158,.12)",background:"rgba(45,42,36,.3)",
                               color:"#b4ac9e",fontSize:".75rem",fontWeight:600,cursor:"pointer",letterSpacing:".02em"}
                      }, `Load More (${Math.min(libVisibleCount, libFiltered.length)} of ${libFiltered.length})`)
                    )
                    ), /* ── end filtered view ── */

                    /* Detail bottom sheet */
                    libDetailEx && React.createElement('div', {
                      onClick:()=>setLibDetailEx(null),
                      style:{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:500,display:"flex",alignItems:"flex-end",justifyContent:"center"}
                    },
                      React.createElement('div', {
                        onClick:e=>e.stopPropagation(),
                        style:{background:"linear-gradient(160deg,rgba(18,16,12,.92),rgba(12,12,10,.95))",border:"1px solid rgba(180,172,158,.06)",borderRadius:"16px 16px 0 0",width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto",padding:"20px 18px 32px"}
                      },
                        React.createElement('div',{style:{width:36,height:4,background:"rgba(45,42,36,.3)",borderRadius:2,margin:"0 auto 16px"}}),
                        React.createElement('div',{style:{height:90,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12}}, React.createElement(ExIcon,{ex:libDetailEx,size:"3.5rem",color:getTypeColor(libDetailEx.category)})),
                        React.createElement('div',{style:{marginBottom:10}},
                          React.createElement('div',{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}},
                            React.createElement('span',{style:{fontSize:"1rem",fontWeight:"700",color:"#e8e0d0"}}, libDetailEx.name),
                            (profile.exercisePBs||{})[libDetailEx.id] && React.createElement('span',{style:{background:"rgba(180,172,158,.1)",color:"#b4ac9e",fontSize:".6rem",padding:"2px 7px",borderRadius:4,fontWeight:"700"}}, "🏆 PB")
                          ),
                          React.createElement('div',{style:{display:"flex",gap:8,flexWrap:"wrap"}},
                            React.createElement('span',{style:{fontSize:".7rem",color:getMuscleColor(libDetailEx.muscleGroup),fontStyle:"italic"}}, libDetailEx.muscleGroup?(libDetailEx.muscleGroup.charAt(0).toUpperCase()+libDetailEx.muscleGroup.slice(1)):""),
                            libDetailEx.equipment && React.createElement('span',{style:{fontSize:".7rem",color:"#6a6050",fontStyle:"italic"}}, "· "+libDetailEx.equipment),
                            libDetailEx.difficulty && React.createElement('span',{style:{fontSize:".7rem",fontWeight:700,color:libDetailEx.difficulty==="Advanced"?"#7A2838":libDetailEx.difficulty==="Beginner"?"#5A8A58":"#A8843C"}}, "· "+libDetailEx.difficulty),
                            React.createElement('span',{style:{fontSize:".7rem",color:"#b4ac9e",fontWeight:"700"}}, "· "+libDetailEx.baseXP+" XP")
                          )
                        ),
                        libDetailEx.desc && React.createElement('p',{style:{fontSize:".78rem",color:"#8a8478",lineHeight:1.55,marginBottom:12}}, libDetailEx.desc),
                        libDetailEx.pbType && React.createElement('div',{style:{background:"rgba(45,42,36,.16)",border:"1px solid rgba(180,172,158,.05)",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:".72rem",color:"#8a8478"}},
                          React.createElement('span',{style:{color:"#b4ac9e",fontWeight:"700"}}, "PB: "),
                          libDetailEx.pbType,
                          libDetailEx.pbTier==="Leaderboard" && React.createElement('span',{style:{marginLeft:8,color:"#b4ac9e",fontSize:".65rem"}},"🏆 Leaderboard")
                        ),
                        React.createElement('button',{
                          onClick:()=>setProfile(p=>({...p,favoriteExercises:(p.favoriteExercises||[]).includes(libDetailEx.id)?(p.favoriteExercises||[]).filter(i=>i!==libDetailEx.id):[...(p.favoriteExercises||[]),libDetailEx.id]})),
                          style:{width:"100%",background:"rgba(45,42,36,.2)",border:"1px solid rgba(180,172,158,.06)",color:"#b4ac9e",padding:"11px",borderRadius:9,fontWeight:"700",fontSize:".82rem",cursor:"pointer"}
                        }, (profile.favoriteExercises||[]).includes(libDetailEx.id)?"⭐ Saved to Favorites":"☆ Save to Favorites"),
                        React.createElement('div', {style:{display:"flex",gap:8,marginTop:8}},
                          libDetailEx.id!=="rest_day"&&React.createElement('button', {
                            onClick:()=>{
                              const exEntry = {exId:libDetailEx.id,sets:(libDetailEx.defaultSets!=null?libDetailEx.defaultSets:3),reps:(libDetailEx.defaultReps!=null?libDetailEx.defaultReps:10),weightLbs:null,durationMin:null,weightPct:100,distanceMi:null,hrZone:null};
                              setAddToWorkoutPicker({exercises:[exEntry]});
                              setLibDetailEx(null);
                            },
                            style:{flex:1,background:"rgba(45,42,36,.2)",border:"1px solid rgba(180,172,158,.06)",color:"#b4ac9e",padding:"10px",borderRadius:9,fontWeight:"600",fontSize:".72rem",cursor:"pointer",textAlign:"center"}
                          }, "\uD83D\uDCAA Add to Workout"),
                          React.createElement('button', {
                            onClick:()=>{
                              const ids = [libDetailEx.id];
                              setSavePlanWizard({entries:ids.map(id=>({exId:id,exercise:libDetailEx.name,icon:libDetailEx.icon,_idx:id})),label:libDetailEx.name});
                              setSpwName(libDetailEx.name);setSpwIcon("\uD83D\uDCCB");setSpwDate("");setSpwMode("new");setSpwTargetPlanId(null);
                              setLibDetailEx(null);
                            },
                            style:{flex:1,background:"rgba(45,42,36,.2)",border:"1px solid rgba(180,172,158,.06)",color:"#b4ac9e",padding:"10px",borderRadius:9,fontWeight:"600",fontSize:".72rem",cursor:"pointer",textAlign:"center"}
                          }, "\uD83D\uDCCB Add to Plan")
                        ),
                        /* Edit & Complete Now */
                        React.createElement('button', {
                          onClick:()=>{
                            setSelEx(libDetailEx.id);
                            setSets("");
                            setReps("");
                            setExWeight("");setWeightPct(100);setDistanceVal("");setHrZone(null);setExHHMM("");setExSec("");setQuickRows([]);
                            setLibDetailEx(null);
                            setActiveTab("workout");
                          },
                          style:{width:"100%",marginTop:8,background:"linear-gradient(135deg,rgba(26,82,118,.25),rgba(41,128,185,.15))",border:"1px solid rgba(41,128,185,.3)",color:"#2980b9",padding:"11px",borderRadius:9,fontWeight:"700",fontSize:".82rem",cursor:"pointer",textAlign:"center"}
                        }, "\u2699 Configure")
                      )
                    )
                  );
                })()
                /* ══ MY WORKOUTS SUB-TAB ══ */
                , exSubTab==="myworkouts" && React.createElement('div', null
                  , React.createElement('div',{style:{marginBottom:14}}
                    /* Favorites header with Select toggle */
                    , React.createElement('div',{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}
                      , React.createElement('div',{style:{fontSize:".65rem",color:"#4a4438",textTransform:"uppercase",letterSpacing:".1em"}},"Favorite Exercises")
                      , (profile.favoriteExercises||[]).length>0 && React.createElement('button',{
                        onClick:()=>{setFavSelectMode(!favSelectMode);setFavSelected(new Set());},
                        style:{background:favSelectMode?"rgba(45,42,36,.3)":"transparent",border:"1px solid "+(favSelectMode?"rgba(180,172,158,.15)":"rgba(180,172,158,.06)"),color:favSelectMode?"#d4cec4":"#8a8478",fontSize:".6rem",padding:"4px 10px",borderRadius:6,cursor:"pointer"}
                      }, favSelectMode?"✕ Cancel":"☐ Select")
                    )
                    /* Multi-select action bar */
                    , favSelectMode && favSelected.size>0 && React.createElement('div',{style:{background:"rgba(45,42,36,.2)",border:"1px solid rgba(180,172,158,.06)",borderRadius:10,padding:"10px 14px",marginBottom:10,display:"flex",flexDirection:"column",alignItems:"center",gap:8}}
                      , React.createElement('span',{style:{fontSize:".72rem",color:"#b4ac9e",fontWeight:"700"}}, favSelected.size+" selected")
                      , React.createElement('div',{style:{display:"flex",gap:8,justifyContent:"center"}},
                      React.createElement('button',{
                        onClick:()=>{
                          const ids=[...favSelected];
                          const exs=ids.map(id=>{const e=allExById[id];return {exId:id,sets:(e&&e.defaultSets!=null?e.defaultSets:3),reps:(e&&e.defaultReps!=null?e.defaultReps:10),weightLbs:null,durationMin:(e&&e.defaultDurationMin)||null,weightPct:100,distanceMi:null,hrZone:null};});
                          setAddToWorkoutPicker({exercises:exs});
                          setFavSelectMode(false);setFavSelected(new Set());
                        },
                        style:{background:"rgba(45,42,36,.22)",border:"1px solid rgba(180,172,158,.08)",color:"#b4ac9e",padding:"6px 12px",borderRadius:8,fontSize:".7rem",fontWeight:"700",cursor:"pointer",whiteSpace:"nowrap",textAlign:"center"}
                      },"➕ Existing")
                      , React.createElement('button',{
                        onClick:()=>{
                          const ids=[...favSelected];
                          const exs=ids.map(id=>{const e=allExById[id];return {exId:id,sets:(e&&e.defaultSets!=null?e.defaultSets:3),reps:(e&&e.defaultReps!=null?e.defaultReps:10),weightLbs:null,durationMin:(e&&e.defaultDurationMin)||null,weightPct:100,distanceMi:null,hrZone:null};});
                          setWbExercises(exs);setWbName("");setWbIcon("💪");setWbDesc("");setWbEditId(null);setWbIsOneOff(false);
                          setWorkoutView("builder");setActiveTab("workouts");
                          setFavSelectMode(false);setFavSelected(new Set());
                        },
                        style:{background:"linear-gradient(135deg,#5b2d8e,#7b1fa2)",border:"none",color:"#fff",padding:"6px 12px",borderRadius:8,fontSize:".7rem",fontWeight:"700",cursor:"pointer",whiteSpace:"nowrap",textAlign:"center"}
                      },"⚡ New Workout")
                      , React.createElement('button',{
                        onClick:()=>{
                          const ids=[...favSelected];
                          setSavePlanWizard({entries:ids.map(id=>({exId:id,exercise:allExById[id]&&allExById[id].name,icon:allExById[id]&&allExById[id].icon,_idx:id})),label:"Selected Favorites"});
                          setSpwName("Selected Favorites");setSpwIcon("📋");setSpwDate("");setSpwMode("new");setSpwTargetPlanId(null);
                          setFavSelectMode(false);setFavSelected(new Set());
                        },
                        style:{background:"rgba(45,42,36,.26)",border:"1px solid rgba(180,172,158,.08)",color:"#b4ac9e",padding:"6px 12px",borderRadius:8,fontSize:".7rem",fontWeight:"700",cursor:"pointer",whiteSpace:"nowrap",textAlign:"center"}
                      },"📋 Plan")
                    ))
                    , (profile.favoriteExercises||[]).length===0
                        ? React.createElement('div',{className:"empty",style:{padding:"16px 0"}},"No favorites yet — tap ⭐ on any exercise.")
                        : React.createElement('div',{style:{display:"flex",flexDirection:"column",gap:6}}
                          , (profile.favoriteExercises||[]).slice(0,20).map(exId=>{
                              const ex=allExById[exId]; if(!ex) return null;
                              const hasPB=!!(profile.exercisePBs||{})[ex.id];
                              const diffLabel = ex.difficulty || (ex.baseXP>=60?"Advanced":ex.baseXP>=45?"Intermediate":"Beginner");
                              const diffColor = diffLabel==="Advanced"?"#7A2838":diffLabel==="Beginner"?"#5A8A58":"#A8843C";
                              const isSel = favSelected.has(exId);
                              return React.createElement('div',{
                                key:exId,
                                onClick:()=>{
                                  if(favSelectMode){
                                    setFavSelected(s=>{const n=new Set(s);if(n.has(exId))n.delete(exId);else n.add(exId);return n;});
                                  } else {
                                    setLibDetailEx(ex);setExSubTab("library");
                                  }
                                },
                                style:{
                                  background:isSel?"rgba(45,42,36,.3)":"linear-gradient(145deg,rgba(45,42,36,.35),rgba(32,30,26,.2))",
                                  border:"1px solid "+(isSel?"rgba(180,172,158,.2)":"rgba(180,172,158,.05)"),
                                  borderRadius:10, padding:"11px 13px",
                                  display:"flex", alignItems:"center", gap:12, cursor:"pointer",
                                  boxShadow:isSel?"0 0 0 1.5px rgba(180,172,158,.2)":"none",
                                  transition:"all .15s",
                                }
                              },
                                favSelectMode && React.createElement('div',{style:{width:22,height:22,borderRadius:5,flexShrink:0,border:"1.5px solid "+(isSel?"rgba(180,172,158,.3)":"rgba(180,172,158,.08)"),background:isSel?"rgba(45,42,36,.35)":"transparent",display:"flex",alignItems:"center",justifyContent:"center"}},
                                  isSel && React.createElement('span',{style:{color:"#b4ac9e",fontSize:".65rem"}},"✓")
                                ),
                                React.createElement('div',{style:{width:34,height:34,borderRadius:8,flexShrink:0,background:"rgba(45,42,36,.15)",border:"1px solid rgba(180,172,158,.05)",display:"flex",alignItems:"center",justifyContent:"center"}},
                                  React.createElement(ExIcon,{ex:ex,size:"1rem",color:"#b4ac9e"})
                                ),
                                React.createElement('div',{style:{flex:1,minWidth:0}},
                                  React.createElement('div',{style:{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",marginBottom:3}},
                                    React.createElement('span',{style:{fontSize:".83rem",fontWeight:600,color:"#d4cec4",letterSpacing:".01em"}}, ex.name),
                                    hasPB && React.createElement('span',{style:{fontSize:".6rem"}}, "🏆")
                                  ),
                                  React.createElement('div',{style:{fontSize:".62rem",fontStyle:"italic",lineHeight:1.4}}, ex.category&&React.createElement('span',{style:{color:getTypeColor(ex.category)}},ex.category.charAt(0).toUpperCase()+ex.category.slice(1)), ex.category&&ex.muscleGroup&&React.createElement('span',{style:{color:"#5a5650"}}," · "), ex.muscleGroup&&React.createElement('span',{style:{color:getMuscleColor(ex.muscleGroup)}},ex.muscleGroup.charAt(0).toUpperCase()+ex.muscleGroup.slice(1)))
                                ),
                                !favSelectMode && React.createElement('div',{style:{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5}},
                                  React.createElement('span',{style:{fontSize:".66rem",fontWeight:700,color:"#b4ac9e",letterSpacing:".02em"}}, ex.baseXP+" XP"),
                                  React.createElement('button',{
                                    onClick:e=>{e.stopPropagation();setProfile(p=>({...p,favoriteExercises:(p.favoriteExercises||[]).filter(i=>i!==exId)}));},
                                    style:{background:"transparent",border:"none",color:"#b4ac9e",fontSize:".9rem",cursor:"pointer",padding:0,lineHeight:1}
                                  },"⭐")
                                ),
                                favSelectMode && React.createElement('div',{style:{flexShrink:0}},
                                  React.createElement('span',{style:{fontSize:".66rem",fontWeight:700,color:"#b4ac9e"}}, ex.baseXP+" XP")
                                )
                              );
                            })
                        )
                  )
                  , React.createElement('div',{style:{marginTop:8}}
                    , React.createElement('div',{style:{fontSize:".65rem",color:"#4a4438",textTransform:"uppercase",letterSpacing:".1em",marginBottom:10}},"Custom Exercises")
                    , (profile.customExercises||[]).length===0
                        ? React.createElement('div',{className:"empty",style:{padding:"12px 0"}},"No custom exercises yet.")
                        : React.createElement('div',{style:{display:"flex",flexDirection:"column",gap:6}}
                          , (profile.customExercises||[]).map(ex=>{
                              const hasPB=!!(profile.exercisePBs||{})[ex.id];
                              const isFav=(profile.favoriteExercises||[]).includes(ex.id);
                              const diffLabel = ex.difficulty || (ex.baseXP>=60?"Advanced":ex.baseXP>=45?"Intermediate":"Beginner");
                              const diffColor = diffLabel==="Advanced"?"#7A2838":diffLabel==="Beginner"?"#5A8A58":"#A8843C";
                              const subParts = [
                                ex.category ? ex.category.charAt(0).toUpperCase()+ex.category.slice(1) : null,
                                ex.muscleGroup ? ex.muscleGroup.charAt(0).toUpperCase()+ex.muscleGroup.slice(1) : null,
                                ex.equipment && ex.equipment!=="bodyweight" ? ex.equipment : null,
                              ].filter(Boolean).join(" · ");
                              return React.createElement('div',{
                                key:ex.id,
                                onClick:()=>{setLibDetailEx(ex);setExSubTab("library");},
                                style:{
                                  background:"linear-gradient(145deg,rgba(45,42,36,.35),rgba(32,30,26,.2))",
                                  border:"1px solid rgba(180,172,158,.05)",
                                  borderRadius:10, padding:"11px 13px",
                                  display:"flex", alignItems:"center", gap:12, cursor:"pointer",
                                  transition:"all .18s",
                                }
                              },
                                React.createElement('div',{style:{width:34,height:34,borderRadius:8,flexShrink:0,background:"rgba(45,42,36,.15)",border:"1px solid rgba(180,172,158,.05)",display:"flex",alignItems:"center",justifyContent:"center"}},
                                  React.createElement(ExIcon,{ex:ex,size:"1rem",color:"#b4ac9e"})
                                ),
                                React.createElement('div',{style:{flex:1,minWidth:0}},
                                  React.createElement('div',{style:{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",marginBottom:3}},
                                    React.createElement('span',{style:{fontSize:".83rem",fontWeight:600,color:"#d4cec4",letterSpacing:".01em"}}, ex.name),
                                    React.createElement('span',{className:"custom-ex-badge",style:{marginLeft:2}}, "custom"),
                                    hasPB && React.createElement('span',{style:{fontSize:".6rem"}}, "🏆"),
                                  ),
                                  React.createElement('div',{style:{fontSize:".62rem",fontStyle:"italic",lineHeight:1.4}}, ex.category&&React.createElement('span',{style:{color:getTypeColor(ex.category)}},ex.category.charAt(0).toUpperCase()+ex.category.slice(1)), ex.category&&ex.muscleGroup&&React.createElement('span',{style:{color:"#5a5650"}}," · "), ex.muscleGroup&&React.createElement('span',{style:{color:getMuscleColor(ex.muscleGroup)}},ex.muscleGroup.charAt(0).toUpperCase()+ex.muscleGroup.slice(1)))
                                ),
                                React.createElement('div',{style:{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5}},
                                  React.createElement('span',{style:{fontSize:".66rem",fontWeight:700,color:"#b4ac9e",letterSpacing:".02em"}}, ex.baseXP+" XP"),
                                  diffLabel && React.createElement('span',{style:{
                                    display:"inline-flex",alignItems:"center",padding:"2px 8px",borderRadius:4,
                                    fontSize:".58rem",fontWeight:700,letterSpacing:".05em",
                                    color:diffColor,
                                    background:diffLabel==="Advanced"?"#2e1515":diffLabel==="Beginner"?"#1a2e1a":"#2e2010",
                                  }}, diffLabel),
                                  React.createElement('div',{style:{display:"flex",gap:5,alignItems:"center"}},
                                    React.createElement('button',{
                                      onClick:e=>{e.stopPropagation();openExEditor("edit",ex);},
                                      style:{background:"rgba(45,42,36,.25)",border:"1px solid rgba(180,172,158,.08)",color:"#8a8478",fontSize:".55rem",cursor:"pointer",padding:"3px 8px",borderRadius:5,fontFamily:"'Barlow',sans-serif"}
                                    },"✎ edit"),
                                    React.createElement('button',{
                                      onClick:e=>{e.stopPropagation();deleteCustomEx(ex.id);},
                                      style:{background:"rgba(46,20,20,.3)",border:"1px solid rgba(231,76,60,.15)",color:"#e05555",fontSize:".55rem",cursor:"pointer",padding:"3px 8px",borderRadius:5}
                                    },"🗑"),
                                    React.createElement('button',{
                                      onClick:e=>{e.stopPropagation();setProfile(p=>({...p,favoriteExercises:isFav?(p.favoriteExercises||[]).filter(i=>i!==ex.id):[...(p.favoriteExercises||[]),ex.id]}));},
                                      style:{background:"transparent",border:"none",color:isFav?"#d4cec4":"#3a3834",fontSize:".9rem",cursor:"pointer",padding:0,lineHeight:1}
                                    }, isFav?"⭐":"☆")
                                  )
                                )
                              );
                            })
                        )
                    , React.createElement('button',{
                        onClick:()=>openExEditor("create",null),
                        style:{marginTop:10,width:"100%",background:"transparent",border:"1px dashed rgba(180,172,158,.08)",color:"#b4ac9e",borderRadius:9,padding:"10px",fontSize:".78rem",cursor:"pointer"}
                      },"＋ Create Custom Exercise")
                  )
                )
              )
            )

                        /* ── WORKOUTS TAB ────────────────────── */
            , activeTab==="workouts" && (()=>{
              const metric = isMetric(profile.units);
              const wUnit  = weightLabel(profile.units);
              const allW   = profile.workouts||[];
              const calcWorkoutXP = (wo) => (wo.exercises||[]).reduce((s,ex)=>{
                const _exD=allExById[ex.exId];const _isCardio=_exD&&_exD.category==="cardio";const _hasRows=(ex.extraRows||[]).length>0;
                const base = calcExXP(ex.exId,ex.sets||3,ex.reps||10,profile.chosenClass,allExById);
                const rowsXP = (ex.extraRows||[]).reduce((rs,row)=>{
                  const rb=calcExXP(ex.exId,parseInt(row.sets)||parseInt(ex.sets)||3,parseInt(row.reps)||parseInt(ex.reps)||10,profile.chosenClass,allExById);
                  return rs+(_isCardio&&_hasRows?Math.round(rb*1.25):rb);
                },0);
                const xp = _isCardio&&_hasRows ? Math.round(base*1.25) : base;
                return s+xp+rowsXP;
              },0);

              // ── LIST ───────────────────────────────
              if(workoutView==="list") return (
                React.createElement(React.Fragment, null
                  , React.createElement('div', { className: "wo-sticky-filters" }
                    , React.createElement('div', { style: {marginBottom:8} }
                      , React.createElement('div', {className:"rpg-sec-header rpg-sec-header-center"}, React.createElement('div', {className:"rpg-sec-line rpg-sec-line-l"}), React.createElement('span', {className:"rpg-sec-title"}, "\u2726 Arsenal \u2726",
                        React.createElement('span', { className: "info-icon", style: {display:"inline-flex",alignItems:"center",justifyContent:"center",width:16,height:16,borderRadius:"50%",border:"1px solid rgba(180,172,158,.15)",fontSize:".48rem",fontWeight:700,color:"#8a8478",fontStyle:"normal",marginLeft:6,verticalAlign:"middle",cursor:"pointer",position:"relative"} }, "?", React.createElement('span', { className: "info-tooltip" }, "Pre-defined groups of exercises. Build once, reuse anytime in plans or as one-off sessions."))
                      ), React.createElement('div', {className:"rpg-sec-line rpg-sec-line-r"}))
                    )
                    /* Subtabs */
                    , React.createElement('div', { className: "log-subtab-bar", style: {marginBottom:0}}
                      , [["reusable","⚔ Re-Usable"],["oneoff","⚡ One-Off"]].map(([t,l])=>(
                        React.createElement('button', { key: t, className: `log-subtab-btn ${workoutSubTab===t?"on":""}`, onClick: ()=>setWorkoutSubTab(t)}, l)
                      ))
                    )
                  )
                  /* Label filter dropdown */
                  , (profile.workoutLabels||[]).length>0 && React.createElement('div', {style:{display:"flex",gap:8,marginBottom:10,position:"relative"}},
                    woLabelDropOpen && React.createElement('div', {onClick:()=>setWoLabelDropOpen(false), style:{position:"fixed",inset:0,zIndex:19}}),
                    React.createElement('div', {style:{position:"relative",zIndex:20}},
                      React.createElement('button', {
                        onClick:()=>setWoLabelDropOpen(!woLabelDropOpen),
                        style:{padding:"7px 28px 7px 10px",borderRadius:9,
                               border:"1px solid "+(woLabelFilters.size>0?"#C4A044":"rgba(45,42,36,.3)"),
                               background:"rgba(14,14,12,.95)",
                               color:woLabelFilters.size>0?"#C4A044":"#8a8478",
                               fontSize:".72rem",textAlign:"left",cursor:"pointer",position:"relative"}
                      },
                        woLabelFilters.size>0?"Labels ("+woLabelFilters.size+")":"Labels",
                        React.createElement('span',{style:{position:"absolute",right:8,top:"50%",
                          transform:"translateY(-50%) rotate("+(woLabelDropOpen?"180deg":"0deg")+")",
                          color:woLabelFilters.size>0?"#C4A044":"#6a6050",fontSize:".6rem",
                          transition:"transform .15s",lineHeight:1}},"▼")
                      ),
                      woLabelDropOpen && React.createElement('div', {
                        style:{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:180,
                               background:"rgba(16,14,10,.95)",border:"1px solid rgba(180,172,158,.07)",
                               borderRadius:9,padding:"6px 4px",zIndex:21,
                               boxShadow:"0 8px 24px rgba(0,0,0,.6)"}
                      },
                        (profile.workoutLabels||[]).map(l=>{
                          const sel=woLabelFilters.has(l);
                          return React.createElement('div', {
                            key:l,
                            onClick:()=>setWoLabelFilters(s=>{const n=new Set(s);n.has(l)?n.delete(l):n.add(l);return n;}),
                            style:{display:"flex",alignItems:"center",gap:8,
                                   padding:"6px 10px",borderRadius:6,cursor:"pointer",
                                   background:sel?"rgba(196,160,68,.12)":"transparent"}
                          },
                            React.createElement('div', {style:{
                              width:14,height:14,borderRadius:3,flexShrink:0,
                              border:"1.5px solid "+(sel?"#C4A044":"rgba(180,172,158,.08)"),
                              background:sel?"rgba(196,160,68,.25)":"transparent",
                              display:"flex",alignItems:"center",justifyContent:"center"
                            }}, sel && React.createElement('span',{style:{fontSize:".6rem",color:"#C4A044",lineHeight:1}},"✓")),
                            React.createElement('span',{style:{fontSize:".72rem",
                              color:sel?"#C4A044":"#b4ac9e",whiteSpace:"nowrap"}},l)
                          );
                        }),
                        React.createElement('div', {className:"wo-label-new-row"},
                          React.createElement('input', {className:"wo-label-new-inp", value:newLabelInput,
                            onChange:e=>setNewLabelInput(e.target.value),
                            onClick:e=>e.stopPropagation(),
                            onKeyDown:e=>{
                              if(e.key==="Enter"&&newLabelInput.trim()){
                                const lbl=newLabelInput.trim();
                                if(!(profile.workoutLabels||[]).some(x=>x.toLowerCase()===lbl.toLowerCase())){
                                  setProfile(p=>({...p,workoutLabels:[...(p.workoutLabels||[]),lbl]}));
                                }
                                setNewLabelInput("");
                              }
                            },
                            placeholder:"+ New label…"}),
                          React.createElement('button', {className:"btn btn-ghost btn-xs", style:{padding:"2px 6px",fontSize:".6rem"},
                            onClick:e=>{
                              e.stopPropagation();
                              const lbl=newLabelInput.trim(); if(!lbl) return;
                              if(!(profile.workoutLabels||[]).some(x=>x.toLowerCase()===lbl.toLowerCase())){
                                setProfile(p=>({...p,workoutLabels:[...(p.workoutLabels||[]),lbl]}));
                              }
                              setNewLabelInput("");
                            }},"+")
                        )
                      )
                    ),
                    woLabelFilters.size>0 && React.createElement('button', {
                      className:"btn btn-ghost btn-xs",
                      style:{fontSize:".6rem",color:"#8a8478",alignSelf:"center"},
                      onClick:()=>setWoLabelFilters(new Set())
                    },"Clear")
                  )
                  , workoutSubTab==="reusable"&&(
                    React.createElement(React.Fragment, null
                      , React.createElement('div', { style: {display:"flex",gap:8,marginBottom:13}}
                        , React.createElement('button', { className: "btn btn-gold btn-sm"  , onClick: ()=>initWorkoutBuilder(null)}, "＋ New Workout"  )
                        , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setWorkoutView("recipes")}, "📋 Recipes" )
                      )
                      , (()=>{
                        const reusableWo = allW.filter(w=>!w.oneOff);
                        const filtered = reusableWo.filter(w=>woLabelFilters.size===0||(w.labels||[]).some(l=>woLabelFilters.has(l)));
                        if(reusableWo.length===0) return React.createElement('div', { className: "empty"}, "No reusable workouts yet.", React.createElement('br', null), "Create your first custom workout or start from a template.");
                        if(filtered.length===0 && woLabelFilters.size>0) return React.createElement('div', { className: "empty"}, "No workouts match the selected labels.");
                        return null;
                      })()
                  , allW.filter(w=>!w.oneOff).filter(w=>woLabelFilters.size===0||(w.labels||[]).some(l=>woLabelFilters.has(l))).map(wo=>{
                    const exCount = wo.exercises.length;
                    const xp = calcWorkoutXP(wo);
                    const woMgColor = getWorkoutMgColor(wo, allExById, MUSCLE_COLORS);
                    return (
                      React.createElement('div', { key: wo.id, className: "workout-card", style:{"--mg-color":woMgColor}}
                        , React.createElement('div', { className: "workout-card-top", style:{cursor:"pointer"}, onClick: ()=>{setActiveWorkout(wo);setWorkoutView("detail");}}
                          , React.createElement('div', { className: "workout-icon"}, wo.icon)
                          , React.createElement('div', { style: {flex:1,minWidth:0}}
                            , React.createElement('div', { className: "workout-name"}, wo.name)
                            , React.createElement('div', { className: "workout-meta"}
                              , React.createElement('span', { className: "workout-tag"}, exCount, " exercise" , exCount!==1?"s":"")
                              , React.createElement('span', { className: "workout-tag"}, "⚡ " , xp.toLocaleString(), " XP" )
                              , (wo.labels||[]).map(l=>React.createElement('span', {key:l, className:"wo-label-chip", style:{pointerEvents:"none",marginLeft:2}}, l))
                            )
                            , wo.desc&&React.createElement('div', { className: `workout-desc ${collapsedWo.has(wo.id)?"":"recipe-desc-collapsed"}`, style:{marginTop:3,position:"relative",paddingRight:wo.desc.length>60?16:0}, title: wo.desc}
                              , wo.desc
                              , wo.desc.length>60&&React.createElement('span', {
                                className: `ex-collapse-btn ${collapsedWo.has(wo.id)?"open":""}`,
                                style: {position:"absolute",top:0,right:0,fontSize:".6rem",padding:"0 2px"},
                                onClick: (e)=>{e.stopPropagation();setCollapsedWo(s=>{const n=new Set(s);n.has(wo.id)?n.delete(wo.id):n.add(wo.id);return n;});}
                              }, "▼")
                            )
                          )
                          , React.createElement('div', { style: {display:"flex",gap:0,border:"1px solid rgba(180,172,158,.05)",borderRadius:9,overflow:"hidden",background:"rgba(45,42,36,.3)",backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)",flexShrink:0}, onClick: e=>e.stopPropagation() }
                            , React.createElement('button', { style:{padding:"6px 10px",textAlign:"center",fontFamily:"'Cinzel',serif",fontSize:".55rem",letterSpacing:".06em",cursor:"pointer",color:"#5a5650",background:"transparent",border:"none",borderRight:"1px solid rgba(180,172,158,.06)",textTransform:"uppercase"}, title: "Copy", onClick: ()=>copyWorkout(wo)}, "\u2398 Copy")
                            , React.createElement('button', { style:{padding:"6px 10px",textAlign:"center",fontFamily:"'Cinzel',serif",fontSize:".55rem",letterSpacing:".06em",cursor:"pointer",color:"#5a5650",background:"transparent",border:"none",borderRight:"1px solid rgba(180,172,158,.06)",textTransform:"uppercase"}, title: "Edit", onClick: ()=>initWorkoutBuilder(wo)}, "\u270E Edit")
                            , React.createElement('button', { style:{padding:"6px 10px",textAlign:"center",fontFamily:"'Cinzel',serif",fontSize:".55rem",letterSpacing:".06em",cursor:"pointer",color:"#e74c3c",background:"transparent",border:"none",textTransform:"uppercase"}, title: "Delete", onClick: ()=>setConfirmDelete({type:"workout",id:wo.id,name:wo.name,icon:wo.icon})}, "\u2715 Del")
                          )
                        )
                      )
                    );
                  })
                    )
                  )
                  , workoutSubTab==="oneoff"&&(
                    React.createElement(React.Fragment, null
                      , (()=>{
                        const _now = new Date(); const today = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
                        const grouped = {};
                        (profile.scheduledWorkouts||[]).forEach(sw=>{
                          if(!sw.sourceWorkoutId) return;
                          if(sw.scheduledDate < today) return;
                          const key = sw.sourceWorkoutId;
                          if(!grouped[key]) grouped[key]={id:sw.sourceWorkoutId, name:sw.sourceWorkoutName, icon:sw.sourceWorkoutIcon||"⚡", date:sw.scheduledDate, items:[]};
                          grouped[key].items.push(sw);
                        });
                        const scheduled = Object.values(grouped).filter(g=>{
                          if(woLabelFilters.size===0) return true;
                          const wo = (profile.workouts||[]).find(w=>w.id===g.id);
                          return (wo&&wo.labels||[]).some(l=>woLabelFilters.has(l));
                        }).sort((a,b)=>a.date.localeCompare(b.date));
                        const hasSoloExs = (profile.scheduledWorkouts||[]).some(sw=>!sw.sourceWorkoutId && sw.exId && sw.scheduledDate >= today);
                        if(scheduled.length===0 && !hasSoloExs && woLabelFilters.size===0) return React.createElement('div', { className: "empty"}, "No upcoming one-off workouts."   , React.createElement('br', null), "Select exercises and tap ⚡ One-Off Workout to schedule one."         );
                        if(scheduled.length===0 && !hasSoloExs && woLabelFilters.size>0) return React.createElement('div', { className: "empty"}, "No one-off workouts match the selected labels.");
                        if(scheduled.length===0) return null;
                        return scheduled.map(g=>{
                          const days = daysUntil(g.date);
                          const badgeCls = days===0?"badge-today":days<=3?"badge-soon":"badge-future";
                          const badgeTxt = days===0?"Today":days===1?"Tomorrow":`${days}d away`;
                          const wo = (profile.workouts||[]).find(w=>w.id===g.id) || {id:g.id,name:g.name,icon:g.icon,desc:"",exercises:g.items.map(sw=>({exId:sw.exId,sets:3,reps:10,weightLbs:null,weightPct:100,distanceMi:null,hrZone:null})),oneOff:true,durationMin:null,activeCal:null,totalCal:null};
                          const xp = calcWorkoutXP(wo);
                          const woMgColor = getWorkoutMgColor(wo, allExById, MUSCLE_COLORS);
                          return (
                            React.createElement('div', { key: g.id, className: "workout-card", style:{"--mg-color":woMgColor}}
                              , React.createElement('div', { className: "workout-card-top", style:{cursor:"pointer"}, onClick: ()=>{setActiveWorkout(wo);setWorkoutView("detail");}}
                                , React.createElement('div', { className: "workout-icon"}, g.icon)
                                , React.createElement('div', { style: {flex:1,minWidth:0}}
                                  , React.createElement('div', { className: "workout-name"}, g.name)
                                  , React.createElement('div', { className: "workout-meta"}
                                    , React.createElement('span', { className: "workout-tag"}, g.items.length, " exercise" , g.items.length!==1?"s":"")
                                    , React.createElement('span', { className: "workout-tag"}, "\u26A1 " , xp.toLocaleString(), " XP" )
                                    , React.createElement('span', { className: `upcoming-badge ${badgeCls}`, style: {marginLeft:4}}, badgeTxt)
                                    , (wo.labels||[]).map(l=>React.createElement('span', {key:l, className:"wo-label-chip", style:{pointerEvents:"none",marginLeft:2}}, l))
                                  )
                                  , wo.desc&&React.createElement('div', { className: "workout-desc recipe-desc-collapsed", style:{marginTop:3}}, wo.desc)
                                )
                                , React.createElement('div', { style: {display:"flex",gap:0,border:"1px solid rgba(180,172,158,.05)",borderRadius:9,overflow:"hidden",background:"rgba(45,42,36,.3)",backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)",flexShrink:0}, onClick: e=>e.stopPropagation() }
                                  , React.createElement('button', { style:{padding:"6px 10px",textAlign:"center",fontFamily:"'Cinzel',serif",fontSize:".55rem",letterSpacing:".06em",cursor:"pointer",color:"#5a5650",background:"transparent",border:"none",borderRight:"1px solid rgba(180,172,158,.06)",textTransform:"uppercase"}, title: "Edit", onClick: ()=>{
                                    setWbName(wo.name); setWbIcon(wo.icon); setWbDesc(wo.desc||"");
                                    setWbExercises(wo.exercises.map(e=>({...e})));
                                    setWbEditId(wo.id); setWbIsOneOff(true);
                                    setWbLabels(wo.labels||[]); setNewLabelInput("");
                                    setWorkoutView("builder");
                                  }}, "\u270E Edit")
                                  , React.createElement('button', { style:{padding:"6px 10px",textAlign:"center",fontFamily:"'Cinzel',serif",fontSize:".55rem",letterSpacing:".06em",cursor:"pointer",color:"#e74c3c",background:"transparent",border:"none",textTransform:"uppercase"}, title: "Delete", onClick: ()=>{
                                    setProfile(p=>({...p,scheduledWorkouts:(p.scheduledWorkouts||[]).filter(sw=>sw.sourceWorkoutId!==g.id)}));
                                    showToast("Scheduled workout removed.");
                                  }}, "\u2715 Del")
                                )
                              )
                              /* Action row */
                              , React.createElement('div', { style: {display:"flex",gap:6,marginTop:6,paddingTop:6,borderTop:"1px solid rgba(180,172,158,.04)"}}
                                , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {fontSize:".62rem",color:"#8a8478"},
                                  onClick: ()=>{
                                    const reusable = {...wo, oneOff:false, createdAt:wo.createdAt||todayStr()};
                                    setProfile(p=>({
                                      ...p,
                                      workouts:(p.workouts||[]).map(w=>w.id===wo.id?reusable:w).concat((p.workouts||[]).find(w=>w.id===wo.id)?[]:[reusable]),
                                      scheduledWorkouts:(p.scheduledWorkouts||[]).filter(sw=>sw.sourceWorkoutId!==g.id),
                                    }));
                                    setWorkoutSubTab("reusable");
                                    showToast(`\uD83D\uDCAA "${wo.name}" added to Re-Usable Workouts!`);
                                  }}, "\uD83D\uDCAA Make Reusable"  )
                                , React.createElement('div', { style: {flex:1}})
                                , React.createElement('button', { className: "btn btn-gold btn-sm"  , onClick: ()=>{
                                  openStatsPromptIfNeeded(wo, (woWithStats, _sr)=>{
                                    setCompletionModal({workout:{...woWithStats,oneOff:true}, fromStats:_sr});
                                    setCompletionDate(todayStr());setCompletionAction("today");
                                  });
                                }}, "\u2713 Complete" )
                              )
                            )
                          );
                        });
                      })()
                      , (()=>{
                        const _now2 = new Date(); const today = `${_now2.getFullYear()}-${String(_now2.getMonth()+1).padStart(2,'0')}-${String(_now2.getDate()).padStart(2,'0')}`;
                        const soloExs = (profile.scheduledWorkouts||[]).filter(sw=>!sw.sourceWorkoutId && sw.exId && sw.scheduledDate >= today).sort((a,b)=>a.scheduledDate.localeCompare(b.scheduledDate));
                        if(soloExs.length===0) return null;
                        return React.createElement(React.Fragment, null
                          , React.createElement('div', {className:"wo-section-hdr"}, React.createElement('span',{className:"wo-section-hdr-text"}, "Solo Exercises"))
                          , soloExs.map(sw=>{
                            const ex = allExById[sw.exId];
                            if(!ex) return null;
                            const days = daysUntil(sw.scheduledDate);
                            const badgeCls = days===0?"badge-today":days<=3?"badge-soon":"badge-future";
                            const badgeTxt = days===0?"Today":days===1?"Tomorrow":`${days}d away`;
                            const soloMg = (ex.muscleGroup||"").toLowerCase().trim();
                            const soloMgColor = MUSCLE_COLORS[soloMg] || "#B0A090";
                            return React.createElement('div', {key:sw.id, className:"workout-card", style:{"--mg-color":soloMgColor}}
                              , React.createElement('div', {className:"workout-card-top"}
                                , React.createElement('div', {className:"workout-icon"}, ex.icon)
                                , React.createElement('div', {style:{flex:1,minWidth:0}}
                                  , React.createElement('div', {className:"workout-name"}, ex.name)
                                  , React.createElement('div', {className:"workout-meta"}
                                    , React.createElement('span', {className:`upcoming-badge ${badgeCls}`, style:{marginLeft:4}}, badgeTxt)
                                  )
                                  , sw.notes && React.createElement('div', {className:"workout-desc", style:{marginTop:3}}, sw.notes)
                                )
                                , React.createElement('div', {style:{display:"flex",gap:4,flexShrink:0,alignItems:"center"}}
                                  , React.createElement('button', {className:"btn btn-ghost btn-sm", style:{fontSize:".65rem",color:"#b4ac9e",padding:"3px 6px"}, onClick:(e)=>{e.stopPropagation(); setSelEx(sw.exId);setPendingSoloRemoveId(sw.id);}}, "✎")
                                  , React.createElement('button', {className:"btn btn-ghost btn-sm", style:{color:"#e74c3c"}, onClick:()=>{
                                    setProfile(p=>({...p,scheduledWorkouts:(p.scheduledWorkouts||[]).filter(s=>s.id!==sw.id)}));
                                    showToast("Scheduled exercise removed.");
                                  }}, "\u2715")
                                )
                              )
                              , React.createElement('div', {style:{display:"flex",gap:6,marginTop:6,paddingTop:6,borderTop:"1px solid rgba(180,172,158,.04)"}}
                                , React.createElement('button', {className:"btn btn-gold btn-sm", style:{flex:1}, onClick:()=>quickLogSoloEx(sw)}, "\u26A1 Quick Log")
                                , React.createElement('button', {className:"btn btn-ghost btn-sm", style:{flex:1,fontSize:".58rem",borderColor:"rgba(180,172,158,.15)",color:"#b4ac9e"}, onClick:(e)=>{e.stopPropagation(); openScheduleEx(sw.exId, sw.id);}}, "\uD83D\uDCC5 Reschedule")
                                , React.createElement('button', {className:"btn btn-ghost btn-sm", style:{flex:1,fontSize:".58rem",borderColor:"rgba(45,42,36,.3)",color:"#8a8478"}, onClick:()=>{
                                    const ex2=allExById[sw.exId]; if(!ex2) return;
                                    const exEntry={exId:ex2.id,sets:ex2.defaultSets||3,reps:ex2.defaultReps||10,weightLbs:null,durationMin:null,weightPct:100,distanceMi:null,hrZone:null};
                                    setAddToWorkoutPicker({exercises:[exEntry]});
                                  }}, "\u2795 Add to Workout")
                              )
                            );
                          })
                        );
                      })()
                    )
                  )
                )
              );

              // ── TEMPLATES ──────────────────────────
              if(workoutView==="recipes") {
                const filteredTpls = recipeFilter.size===0 ? WORKOUT_TEMPLATES : WORKOUT_TEMPLATES.filter(t=>recipeFilter.has(t.category)||recipeFilter.has(t.equipment));
                return (
                React.createElement(React.Fragment, null
                  , React.createElement('div', { className: "wo-sticky-filters" }
                  , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}
                    , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setWorkoutView("list")}, "← Back" )
                    , React.createElement('div', { className: "sec", style: {margin:0,border:"none",padding:0}}, "Workout Recipes" )
                    , React.createElement('div', null)
                  )
                  /* Category multi-select dropdown */
                  , React.createElement('div', {style:{display:"flex",gap:8,marginBottom:0,position:"relative"}},
                    recipeCatDrop && React.createElement('div', {onClick:()=>setRecipeCatDrop(false), style:{position:"fixed",inset:0,zIndex:19}}),
                    React.createElement('div', {style:{position:"relative",zIndex:20}},
                      React.createElement('button', {
                        onClick:()=>setRecipeCatDrop(!recipeCatDrop),
                        style:{padding:"7px 28px 7px 10px",borderRadius:9,
                               border:"1px solid "+(recipeFilter.size>0?"#C4A044":"rgba(45,42,36,.3)"),
                               background:"rgba(14,14,12,.95)",
                               color:recipeFilter.size>0?"#C4A044":"#8a8478",
                               fontSize:".72rem",textAlign:"left",cursor:"pointer",position:"relative"}
                      },
                        recipeFilter.size>0?"Category ("+recipeFilter.size+")":"Category",
                        React.createElement('span',{style:{position:"absolute",right:8,top:"50%",
                          transform:"translateY(-50%) rotate("+(recipeCatDrop?"180deg":"0deg")+")",
                          color:recipeFilter.size>0?"#C4A044":"#6a6050",fontSize:".6rem",
                          transition:"transform .15s",lineHeight:1}},"▼")
                      ),
                      recipeCatDrop && React.createElement('div', {
                        style:{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:200,maxHeight:280,overflowY:"auto",
                               background:"rgba(16,14,10,.95)",border:"1px solid rgba(180,172,158,.07)",
                               borderRadius:9,padding:"6px 4px",zIndex:21,
                               boxShadow:"0 8px 24px rgba(0,0,0,.6)"}
                      },
                        RECIPE_CATS.filter(c=>c!=="All").map(cat=>{
                          const sel=recipeFilter.has(cat);
                          return React.createElement('div', {
                            key:cat,
                            onClick:()=>setRecipeFilter(s=>{const n=new Set(s);n.has(cat)?n.delete(cat):n.add(cat);return n;}),
                            style:{display:"flex",alignItems:"center",gap:8,
                                   padding:"6px 10px",borderRadius:6,cursor:"pointer",
                                   background:sel?"rgba(196,160,68,.12)":"transparent"}
                          },
                            React.createElement('div', {style:{
                              width:14,height:14,borderRadius:3,flexShrink:0,
                              border:"1.5px solid "+(sel?"#C4A044":"rgba(180,172,158,.08)"),
                              background:sel?"rgba(196,160,68,.25)":"transparent",
                              display:"flex",alignItems:"center",justifyContent:"center"
                            }}, sel && React.createElement('span',{style:{fontSize:".6rem",color:"#C4A044",lineHeight:1}},"✓")),
                            React.createElement('span',{style:{fontSize:".72rem",
                              color:sel?"#C4A044":"#b4ac9e",whiteSpace:"nowrap"}},cat)
                          );
                        })
                      )
                    ),
                    recipeFilter.size>0 && React.createElement('button', {
                      className:"btn btn-ghost btn-xs",
                      style:{fontSize:".6rem",color:"#8a8478",alignSelf:"center"},
                      onClick:()=>setRecipeFilter(new Set())
                    },"Clear")
                  )
                  )
                  , filteredTpls.length===0&&React.createElement('div', { className: "empty"}, "No recipes match the selected categories.")
                  , filteredTpls.map(tpl=>{
                    const xp = tpl.exercises.reduce((t,ex)=>t+calcExXP(ex.exId,ex.sets,ex.reps,profile.chosenClass,allExById),0);
                    const descExpanded = expandedRecipeDesc.has(tpl.id);
                    const tplMgColor = getRecipeMgColor(tpl);
                    const diffCls = tpl.difficulty?`wo-diff-pill wo-diff-${tpl.difficulty.toLowerCase()}`:null;
                    return (
                      React.createElement('div', { key: tpl.id, className: "workout-card", style: {marginBottom:12,"--mg-color":tplMgColor}}
                        , React.createElement('div', { className: "workout-card-top"}
                          , React.createElement('div', { className: "workout-icon"}, tpl.icon)
                          , React.createElement('div', { style: {flex:1,minWidth:0}}
                            , React.createElement('div', { className: "workout-name"}, tpl.name)
                            , React.createElement('div', { className: "workout-meta"}
                              , tpl.category&&React.createElement('span', { className: "wo-cat-pill"}, tpl.category)
                              , tpl.difficulty&&React.createElement('span', { className: diffCls}, tpl.difficulty)
                              , React.createElement('span', { className: "workout-tag"}, tpl.exercises.length, " ex")
                              , React.createElement('span', { className: "workout-tag"}, "⚡ " , xp.toLocaleString(), " XP" )
                              , tpl.durationMin&&React.createElement('span', { className: "workout-tag"}, "⏱ " , tpl.durationMin, "min" )
                              , tpl.equipment&&React.createElement('span', { className: "workout-tag"}, EQUIP_ICONS[tpl.equipment]||"", " " , tpl.equipment)
                            )
                          )
                        )
                        /* Collapsible Description */
                        , tpl.desc&&React.createElement('div', { style: {position:"relative",marginBottom:descExpanded?10:4,marginTop:6}}
                          , React.createElement('div', {
                            className: descExpanded?"":"recipe-desc-collapsed",
                            style: {fontSize:".72rem",color:"#8a8478",fontStyle:"italic",lineHeight:1.5,whiteSpace:"pre-line",paddingRight:20}
                          }, tpl.desc)
                          , React.createElement('span', {
                            className: `ex-collapse-btn ${descExpanded?"open":""}`,
                            style: {position:"absolute",top:0,right:0,fontSize:".7rem",padding:"0 4px",cursor:"pointer"},
                            onClick: ()=>setExpandedRecipeDesc(s=>{const n=new Set(s);n.has(tpl.id)?n.delete(tpl.id):n.add(tpl.id);return n;})
                          }, "▼")
                        )
                        /* Exercise breakdown — collapsible, collapsed by default */
                        , React.createElement('div', {
                          style: {background:"rgba(45,42,36,.12)",border:"1px solid rgba(45,42,36,.18)",borderRadius:8,padding:"8px 12px",marginBottom:12,cursor:"pointer"},
                          onClick: ()=>setExpandedRecipeEx(s=>{const n=new Set(s);n.has(tpl.id)?n.delete(tpl.id):n.add(tpl.id);return n;})
                        }
                          , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between"}}
                            , React.createElement('span', { style: {fontSize:".68rem",color:"#8a8478"}}, tpl.exercises.length, " exercises")
                            , React.createElement('span', {
                              className: `ex-collapse-btn ${expandedRecipeEx.has(tpl.id)?"open":""}`,
                              style: {fontSize:".65rem"}
                            }, "▼")
                          )
                          , expandedRecipeEx.has(tpl.id) && React.createElement('div', { style: {marginTop:8}},
                            (()=>{
                              const rendered = new Set();
                              return tpl.exercises.map((ex,i)=>{
                                if(rendered.has(i)) return null;
                                const exD=allExById[ex.exId]; if(!exD) return null;
                                const noSets=NO_SETS_EX_IDS.has(ex.exId);
                                // Check for superset pair
                                if(ex.supersetWith!=null && !rendered.has(ex.supersetWith)){
                                  const j = ex.supersetWith;
                                  const exB = tpl.exercises[j];
                                  const exDB = allExById[exB?.exId];
                                  if(exDB){
                                    rendered.add(i); rendered.add(j);
                                    const noSetsB = NO_SETS_EX_IDS.has(exB.exId);
                                    return React.createElement('div', { key: i, className: "recipe-ss-group", style: {borderLeft:"2px solid #C4A044",paddingLeft:8,marginBottom:6,marginTop:i>0?6:0}}
                                      , React.createElement('div', { style: {fontSize:".58rem",color:"#C4A044",fontWeight:600,marginBottom:3,textTransform:"uppercase",letterSpacing:".5px"}}, "🔗 Superset")
                                      , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:8,padding:"3px 0"}}
                                        , React.createElement('span', { style: {fontSize:".9rem",flexShrink:0}}, exD.icon)
                                        , React.createElement('span', { style: {fontSize:".75rem",color:"#d4cec4",flex:1}}, exD.name)
                                        , React.createElement('span', { style: {fontSize:".68rem",color:"#8a8478"}}, noSets?`${ex.reps} min`:`${ex.sets} × ${ex.reps}`)
                                      )
                                      , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:8,padding:"3px 0"}}
                                        , React.createElement('span', { style: {fontSize:".9rem",flexShrink:0}}, exDB.icon)
                                        , React.createElement('span', { style: {fontSize:".75rem",color:"#d4cec4",flex:1}}, exDB.name)
                                        , React.createElement('span', { style: {fontSize:".68rem",color:"#8a8478"}}, noSetsB?`${exB.reps} min`:`${exB.sets} × ${exB.reps}`)
                                      )
                                    );
                                  }
                                }
                                rendered.add(i);
                                return (
                                  React.createElement('div', { key: i, style: {display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderBottom:i<tpl.exercises.length-1?"1px solid rgba(45,42,36,.15)":""}}
                                    , React.createElement('span', { style: {fontSize:".9rem",flexShrink:0}}, exD.icon)
                                    , React.createElement('span', { style: {fontSize:".75rem",color:"#d4cec4",flex:1}}, exD.name)
                                    , React.createElement('span', { style: {fontSize:".68rem",color:"#8a8478"}}
                                      , noSets
                                        ? `${ex.distanceMi?ex.distanceMi+"mi · ":""}${ex.reps} min`
                                        : `${ex.sets} × ${ex.reps}`
                                    )
                                  )
                                );
                              });
                            })()
                          )
                        )
                        , React.createElement('div', { style: {display:"flex",gap:8}}
                          , React.createElement('button', { className: "btn btn-gold btn-sm"  , style: {flex:1},
                            onClick: ()=>{
                              const wo={id:uid(),name:tpl.name,icon:tpl.icon,desc:tpl.desc,exercises:tpl.exercises.map(e=>({...e})),createdAt:new Date().toLocaleDateString()};
                              setProfile(pr=>({...pr,workouts:[...(pr.workouts||[]),wo]}));
                              setActiveWorkout(wo); setWorkoutView("detail");
                              showToast(`${tpl.icon} ${tpl.name} added to your workouts!`);
                            }}, "＋ Add to My Workouts"

                          )
                          , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1},
                            onClick: ()=>{
                              setWbName(tpl.name); setWbIcon(tpl.icon); setWbDesc(tpl.desc);
                              setWbExercises(tpl.exercises.map(e=>({...e}))); setWbEditId(null);
                              setWorkoutView("builder");
                            }}, "✎ Customize First"

                          )
                        )
                      )
                    );
                  })
                )
              );
              }

              // ── DETAIL ─────────────────────────────
              if(workoutView==="detail" && activeWorkout) {
                const wo = activeWorkout;
                const xp = calcWorkoutXP(wo);
                return (
                  React.createElement(React.Fragment, null
                    , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:9,marginBottom:11}}
                      , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>{setWorkoutView("list");setActiveWorkout(null);}}, "← Back" )
                      , React.createElement('div', { className: "sec", style: {margin:0,border:"none",padding:0,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}, wo.icon, " " , wo.name)
                      , React.createElement('div', { style: {display:"flex",gap:5,flexShrink:0}}
                        , React.createElement('button', { className: "btn btn-ghost btn-sm"  , title: "Copy workout" , onClick: ()=>copyWorkout(wo)}, "⎘ Copy" )
                        , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>initWorkoutBuilder(wo)}, "✎ Edit" )
                      )
                    )
                    , wo.desc&&React.createElement('div', { style: {fontSize:".75rem",color:"#8a8478",fontStyle:"italic",marginBottom:10}}, wo.desc)
                    , React.createElement('div', { style: {display:"flex",gap:8,marginBottom:13,flexWrap:"wrap"}}
                      , React.createElement('div', { className: "xp-projection", style: {flex:1,minWidth:160,margin:0}}
                        , React.createElement('div', null, React.createElement('div', { className: "xp-proj-label"}, "Total Projected XP"  ), React.createElement('div', { className: "xp-proj-detail"}, wo.exercises.length, " exercises" ))
                        , React.createElement('div', { className: "xp-proj-value"}, "⚡ " , xp.toLocaleString())
                      )
                    )
                    , React.createElement('div', { className: "sec", style: {marginBottom:8}}, "Exercises")
                    , wo.exercises.map((ex,i)=>{
                      const exD=allExById[ex.exId]; if(!exD) return null;
                      const isC=exD.category==="cardio";
                      const isF=exD.category==="flexibility";
                      const showW=!isC&&!isF;
                      const exMgColor=getMuscleColor(exD.muscleGroup);
                      return (
                        React.createElement('div', { key: i, className: "workout-detail-ex", style: {"--mg-color":exMgColor}}
                          , React.createElement('div', { className: "workout-detail-ex-orb"}, React.createElement(ExIcon, {ex:exD,size:".95rem",color:"#d4cec4"}))
                          , React.createElement('div', { style: {flex:1,minWidth:0}}
                            , React.createElement('div', { className: "workout-detail-ex-name"}
                              , exD.name
                              , exD.custom&&React.createElement('span', { className: "custom-ex-badge", style: {marginLeft:5}}, "custom")
                            )
                            , ex.exId!=="rest_day"&&React.createElement('div', { className: "workout-detail-ex-meta"}
                              , ex.sets, "×", ex.reps, isC||isF?" min":""
                              , showW&&ex.weightLbs?React.createElement('span', { style: {color:"#8a8478",marginLeft:6}}, metric?lbsToKg(ex.weightLbs)+" kg":ex.weightLbs+" lbs"):""
                            )
                          )
                          , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:7}}
                            , exD.custom&&(
                              React.createElement('button', { className: "btn btn-ghost btn-xs"  , title: "Edit custom exercise"  ,
                                onClick: ()=>openExEditor("edit",exD)}, "✎")
                            )
                            , React.createElement('div', { className: "workout-detail-ex-xp"}, "+", calcExXP(ex.exId,ex.sets||3,ex.reps||10,profile.chosenClass,allExById), " XP" )
                          )
                        )
                      );
                    })
                    , React.createElement('div', { className: "div"})
                    , React.createElement('div', { style: {display:"flex",gap:8,flexWrap:"wrap"}}
                      , React.createElement('button', { className: "btn btn-glass-yellow" , style: {flex:2,fontSize:".6rem"}, onClick: ()=>{
                        openStatsPromptIfNeeded(wo, (woWithStats, _sr)=>{
                          setCompletionModal({workout:woWithStats, fromStats:_sr});setCompletionDate(todayStr());setCompletionAction("today");
                        });
                      }}, "✓ Mark Complete or Schedule"  )
                      , React.createElement('button', { className: "btn btn-gold btn-sm"  , style: {flex:1}, onClick: ()=>setAddToPlanPicker({workout:wo})}, "📋 Add to Plan"   )
                      , React.createElement('button', { className: "btn btn-danger btn-sm"  , style: {flex:0,paddingLeft:10,paddingRight:10}, onClick: ()=>deleteWorkout(wo.id)}, "🗑")
                    )
                  )
                );
              }

              // ── BUILDER ────────────────────────────
              if(workoutView==="builder") return (
                React.createElement(React.Fragment, null
                  , React.createElement('div', { className: "builder-nav-hdr" }
                    , React.createElement('button', { className: "btn btn-ghost btn-sm", onClick: ()=>{setWorkoutView("list"); setWbCopySource(null); setWbIsOneOff(false); setWbEditId(null); setWbDuration(""); setWbDurSec(""); setWbActiveCal(""); setWbTotalCal(""); setWbLabels([]); setNewLabelInput("");} }, "← Cancel")
                    , React.createElement('div', { style: {flex:1,minWidth:0} }
                      , React.createElement('div', { className: "builder-nav-title" }
                        , wbIsOneOff
                          ? (wbEditId ? "✎ Edit One-Off" : "⚡ New One-Off Workout")
                          : (wbEditId ? "✎ Edit Workout" : wbCopySource ? "⎘ Copy Workout" : "⚔ New Workout")
                      )
                      , wbCopySource && React.createElement('div', { className: "builder-nav-sub" }, "Forging from: ", wbCopySource)
                    )
                  )
                  /* Identity panel: Name + Icon + Description */
                  , React.createElement('div', { className: "wb-section" }
                    , React.createElement('div', { className: "wb-section-hdr" }, React.createElement('span', {className:"wb-section-hdr-icon"}, "✦"), "Identity")
                    , React.createElement('div', { className: "field"}
                      , React.createElement('label', null, "Workout Name" )
                      , React.createElement('input', { className: "inp", value: wbName, onChange: e=>setWbName(e.target.value), placeholder: "e.g. Morning Push Day…"   })
                    )
                    , React.createElement('div', { className: "field"}
                      , React.createElement('label', null, "Icon")
                      , React.createElement('div', { className: "icon-row", style: {flexWrap:"wrap",gap:6}}
                        , ["💪","🏋️","🔥","⚔️","🏃","🚴","🧘","⚡","🎯","🛡️","🏆","🌟","💥","🗡️","🥊","🤸","🏊","🎽","🦵","🦾"].map(ic=>(
                          React.createElement('div', { key: ic, className: `icon-opt ${wbIcon===ic?"sel":""}`, style: {fontSize:"1.2rem",width:36,height:36}, onClick: ()=>setWbIcon(ic)}, ic)
                        ))
                      )
                    )
                    , React.createElement('div', { className: "field"}
                      , React.createElement('label', null, "Description " , React.createElement('span', { style: {color:"#5a5650",fontWeight:"normal"}}, "(optional)"))
                      , React.createElement('input', { className: "inp", value: wbDesc, onChange: e=>setWbDesc(e.target.value), placeholder: "e.g. Upper body strength focus…"    })
                    )
                  )
                  /* Labels panel */
                  , React.createElement('div', { className: "wb-section" }
                    , React.createElement('div', { className: "wb-section-hdr" }, React.createElement('span', {className:"wb-section-hdr-icon"}, "❖"), "Labels", React.createElement('span', { style: {color:"#5a5650",fontWeight:"normal",letterSpacing:".05em",marginLeft:6,textTransform:"none"}}, "(optional)"))
                    , React.createElement('div', { style: {display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}
                      , (profile.workoutLabels||[]).map(l=>
                        React.createElement('span', { key: l, className: "wo-label-chip"+(wbLabels.includes(l)?" sel":""),
                          onClick: ()=>setWbLabels(prev=>prev.includes(l)?prev.filter(x=>x!==l):[...prev,l])
                        }, l)
                      )
                      , React.createElement('span', { style: {display:"inline-flex",alignItems:"center",gap:4}}
                        , React.createElement('input', { className: "wo-label-new-inp", value: newLabelInput,
                          onChange: e=>setNewLabelInput(e.target.value),
                          onKeyDown: e=>{
                            if(e.key==="Enter"&&newLabelInput.trim()){
                              const lbl=newLabelInput.trim();
                              if(!(profile.workoutLabels||[]).some(x=>x.toLowerCase()===lbl.toLowerCase())){
                                setProfile(p=>({...p,workoutLabels:[...(p.workoutLabels||[]),lbl]}));
                              }
                              if(!wbLabels.includes(lbl)) setWbLabels(prev=>[...prev,lbl]);
                              setNewLabelInput("");
                            }
                          },
                          placeholder: "+ New label…", style: {width:100} })
                        , React.createElement('button', { className: "btn btn-ghost btn-xs", style: {padding:"2px 6px",fontSize:".6rem"},
                          onClick: ()=>{
                            const lbl=newLabelInput.trim(); if(!lbl) return;
                            if(!(profile.workoutLabels||[]).some(x=>x.toLowerCase()===lbl.toLowerCase())){
                              setProfile(p=>({...p,workoutLabels:[...(p.workoutLabels||[]),lbl]}));
                            }
                            if(!wbLabels.includes(lbl)) setWbLabels(prev=>[...prev,lbl]);
                            setNewLabelInput("");
                          }}, "+")
                      )
                    )
                  )
                  /* Stats panel: Duration / Calories */
                  , React.createElement('div', { className: "wb-section" }
                    , React.createElement('div', { className: "wb-section-hdr" }, React.createElement('span', {className:"wb-section-hdr-icon"}, "⏱"), "Session Stats", React.createElement('span', { style: {color:"#5a5650",fontWeight:"normal",letterSpacing:".05em",marginLeft:6,textTransform:"none"}}, "(optional)"))
                    , React.createElement('div', { className: "wb-stats-row"}
                      , React.createElement('div', { className: "field", style: {flex:1.5,marginBottom:0}}
                        , React.createElement('label', null, "Duration " , React.createElement('span', { style: {color:"#5a5650",fontWeight:"normal"}}, "(HH:MM)"))
                        , React.createElement('input', { className: "inp", type: "text", inputMode: "numeric",
                          value: wbDuration,
                          onChange: e=>setWbDuration(e.target.value),
                          onBlur: e=>setWbDuration(normalizeHHMM(e.target.value)),
                          placeholder: "00:00"})
                      )
                      , React.createElement('div', { className: "field", style: {flex:0.8,marginBottom:0}}
                        , React.createElement('label', null, "Seconds")
                        , React.createElement('input', { className: "inp", type: "number", min: "0", max: "59",
                          value: wbDurSec,
                          onChange: e=>setWbDurSec(e.target.value),
                          placeholder: "0"})
                      )
                      , React.createElement('div', { className: "field", style: {flex:1,marginBottom:0}}
                        , React.createElement('label', null, "Active Cal" )
                        , React.createElement('input', { className: "inp", type: "number", min: "0", max: "9999", value: wbActiveCal, onChange: e=>setWbActiveCal(e.target.value), placeholder: "e.g. 320" })
                      )
                      , React.createElement('div', { className: "field", style: {flex:1,marginBottom:0}}
                        , React.createElement('label', null, "Total Cal" )
                        , React.createElement('input', { className: "inp", type: "number", min: "0", max: "9999", value: wbTotalCal, onChange: e=>setWbTotalCal(e.target.value), placeholder: "e.g. 450" })
                      )
                    )
                  )
                  /* Exercise list */
                  , React.createElement('div', { className: "wo-section-hdr", style:{marginTop:18,marginBottom:10}}, React.createElement('span', {className:"wo-section-hdr-text"}, "⚔ Techniques"))
                  , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}
                    , React.createElement('label', null, "(", wbExercises.length, " exercise", wbExercises.length!==1?"s":"", ")"
                      , wbExercises.length>0&&React.createElement('span', { style: {marginLeft:8,fontSize:".65rem",color:"#b4ac9e",fontFamily:"'Inter',sans-serif"}}, "⚡ "
                         , wbTotalXP.toLocaleString(), " XP total"
                      )
                    )
                    , React.createElement('div', { style: {display:"flex",gap:6}}
                      , React.createElement('button', { className: "btn btn-ghost btn-xs"  , onClick: ()=>setWbExPickerOpen(true)}, "＋ Add Exercise"  )
                      , React.createElement('button', { className: "btn btn-ghost btn-xs"  , onClick: ()=>openExEditor("create",null)}, "⚔ Forge Custom"  )
                    )
                  )
                  , wbExercises.length===0&&React.createElement('div', { className: "empty", style: {padding:"16px 0"}}, "No techniques yet. Add from the arsenal or forge a custom one."           )
                  , (()=>{const minSsChecked = ssChecked.size>0 ? Math.min(...ssChecked) : -1; return wbExercises.map((ex,i)=>{
                    const exD=allExById[ex.exId]; if(!exD) return null;
                    const isC=exD.category==="cardio";
                    const isF=exD.category==="flexibility";
                    const showW=!isC&&!isF;
                    const showSsConnector = false; // replaced by group card
                    // If this row is the SECOND in a pair (its anchor points back to i), skip — rendered by anchor
                    const isSecondInPair = wbExercises.some((x,xi) => x.supersetWith != null && x.supersetWith === i && xi < i);
                    if (isSecondInPair) return null;
                    // If this row is the FIRST in a pair, we'll render a Group Card wrapper
                    const partnerIdx = ex.supersetWith!=null ? ex.supersetWith : null;
                    const partnerEx  = partnerIdx!=null ? wbExercises[partnerIdx] : null;
                    const partnerExD = partnerEx ? (allExById[partnerEx.exId]||null) : null;
                    const showDist=isC;
                    const showHR=isC;
                    const isTreadmill=exD.hasTreadmill||false;
                    const noSetsEx=NO_SETS_EX_IDS.has(exD.id);
                    const isRunningEx=exD.id===RUNNING_EX_ID;
                    const age=profile.age||30;
                    const dispW=ex.weightLbs?(metric?lbsToKg(ex.weightLbs):ex.weightLbs):"";
                    const dispDist=ex.distanceMi?(metric?String(parseFloat(miToKm(ex.distanceMi)).toFixed(2)):String(ex.distanceMi)):"";
                    const pbPaceMi=profile.runningPB||null;
                    const pbDisp=pbPaceMi?(metric?parseFloat((pbPaceMi*1.60934).toFixed(2))+" min/km":parseFloat(pbPaceMi.toFixed(2))+" min/mi"):null;
                    const exPB=(profile.exercisePBs||{})[exD.id]||null;
                    const exPBDisp=exPB?(exPB.type==="cardio"?(metric?parseFloat((exPB.value*1.60934).toFixed(2))+" min/km":parseFloat(exPB.value.toFixed(2))+" min/mi"):(exPB.type==="assisted"?"🏆 1RM: "+exPB.value+(metric?" kg":" lbs")+" (Assisted)":"🏆 1RM: "+exPB.value+(metric?" kg":" lbs"))):null;
                    const durationMin=parseFloat(ex.reps||0);
                    const distMiVal=ex.distanceMi?parseFloat(ex.distanceMi):0;
                    const runPace=(isRunningEx&&distMiVal>0&&durationMin>0)?durationMin/distMiVal:null;
                    const runBoostPct=runPace?(runPace<=8?20:5):0;
                    const catColor=getTypeColor(exD.category);
                    const mgColor=getMuscleColor(exD.muscleGroup);
                    /* ── ACCORDION SUPERSET CARD — replaces both solo rows when paired ── */
                    if (partnerIdx!=null && partnerExD) {
                      const totalXP = calcExXP(ex.exId,ex.sets||3,ex.reps||10,profile.chosenClass,allExById) + calcExXP(partnerEx.exId,partnerEx.sets||3,partnerEx.reps||10,profile.chosenClass,allExById);
                      return React.createElement('div', {key:i, className:"ss-accordion"},
                        React.createElement('div', {className:"ss-accordion-hdr"},
                          React.createElement('div', {style:{display:"flex",flexDirection:"column",gap:2,flexShrink:0}},
                            React.createElement('button', {className:"btn btn-ghost btn-xs",style:{padding:"2px 5px",fontSize:".65rem",lineHeight:1,minWidth:0,opacity:Math.min(i,partnerIdx)===0?.3:1},
                              onClick:e=>{e.stopPropagation();reorderSupersetPair(i,partnerIdx,"up");}}, "▲"),
                            React.createElement('button', {className:"btn btn-ghost btn-xs",style:{padding:"2px 5px",fontSize:".65rem",lineHeight:1,minWidth:0,opacity:Math.max(i,partnerIdx)>=wbExercises.length-1?.3:1},
                              onClick:e=>{e.stopPropagation();reorderSupersetPair(i,partnerIdx,"down");}}, "▼")
                          ),
                          React.createElement('span', {className:"ss-accordion-hdr-title"}, "🔗 Superset"),
                          React.createElement('span', {className:"ss-accordion-xp"}, totalXP.toLocaleString()+" XP total"),
                          React.createElement('button', {className:"ss-accordion-ungroup",
                            onClick:()=>setWbExercises(exs=>exs.map((x,xi)=>xi===i?{...x,supersetWith:null}:xi===partnerIdx?{...x,supersetWith:null}:x))
                          }, "✕ Ungroup")
                        ),
                        renderSsAccordionSection(ex, i, exD, "A", i+"_a"),
                        renderSsAccordionSection(partnerEx, partnerIdx, partnerExD, "B", i+"_b")
                      );
                    }
                    return React.createElement(React.Fragment, {key:i},
                      i===minSsChecked && ssChecked.size>0 && React.createElement('div',{className:"ss-action-bar"},
                        React.createElement('span',{className:"ss-action-text"}, ssChecked.size+" exercise"+(ssChecked.size!==1?"s":"")+" selected"),
                        ssChecked.size===2 && React.createElement('button',{className:"ss-action-btn",onClick:()=>{
                          const [a,b]=[...ssChecked];
                          setWbExercises(exs=>exs.map((x,xi)=>xi===a?{...x,supersetWith:b}:xi===b?{...x,supersetWith:a}:x));
                          setSsChecked(new Set());
                        }},"🔗 Group as Superset"),
                        React.createElement('button',{className:"ss-action-cancel",onClick:()=>setSsChecked(new Set())},"✕")
                      ),
                      React.createElement('div', {
                        className: `wb-ex-row ${dragWbExIdx===i?"dragging":""}`,
                        style: {
                          opacity:dragWbExIdx===i?0.5:1,flexDirection:"column",alignItems:"stretch",gap:0,
                          "--cat-color":catColor,
                          "--mg-color":mgColor,
                        },
                        draggable: true,
                        onDragStart: e=>{e.dataTransfer.effectAllowed="move";setDragWbExIdx(i);},
                        onDragOver: e=>{e.preventDefault();e.dataTransfer.dropEffect="move";},
                        onDrop: e=>{e.preventDefault();reorderWbEx(dragWbExIdx,i);setDragWbExIdx(null);},
                        onDragEnd: ()=>setDragWbExIdx(null)}
                        , React.createElement(WbExCard, {
                            ex:ex, i:i, exD:exD,
                            collapsed: !!collapsedWbEx[i],
                            profile:profile, allExById:allExById,
                            metric:metric, wUnit:wUnit,
                            setWbExercises:setWbExercises, setCollapsedWbEx:setCollapsedWbEx,
                            setSsChecked:setSsChecked, ssChecked:ssChecked,
                            exCount:wbExercises.length, openExEditor:openExEditor
                          })
                      )

                    );
                  });})()
                  , React.createElement('div', { className: "div"})
                  , wbIsOneOff ? (
                    wbEditId ? (
                      // Editing an existing scheduled one-off — save changes in place
                      React.createElement('button', { className: "btn btn-gold" , style: {width:"100%"}, onClick: ()=>{
                        if(!wbName.trim()){ showToast("Name your workout first!"); return; }
                        if(wbExercises.length===0){ showToast("Add at least one exercise."); return; }
                        const updated = {id:wbEditId, name:wbName.trim(), icon:wbIcon, desc:wbDesc.trim(),
                          exercises:wbExercises, createdAt:todayStr(), oneOff:true, labels:wbLabels};
                        setProfile(p=>({
                          ...p,
                          // Update the saved workout object
                          workouts: (p.workouts||[]).find(w=>w.id===wbEditId)
                            ? (p.workouts||[]).map(w=>w.id===wbEditId ? updated : w)
                            : [...(p.workouts||[]), updated],
                          // Sync the name/icon on all matching scheduledWorkouts
                          scheduledWorkouts: (p.scheduledWorkouts||[]).map(sw=>
                            sw.sourceWorkoutId===wbEditId
                              ? {...sw, sourceWorkoutName:updated.name, sourceWorkoutIcon:updated.icon}
                              : sw
                          ),
                        }));
                        setWorkoutView("list"); setWbEditId(null); setWbIsOneOff(false);
                        showToast(`⚡ "${updated.name}" updated!`);
                      }}, "💾 Save Changes")
                    ) : (
                      // New one-off — proceed through stats prompt then to log/schedule
                      React.createElement('button', { className: "btn btn-gold" , style: {width:"100%"}, onClick: ()=>{
                        if(!wbName.trim()){ showToast("Name your workout first!"); return; }
                        if(wbExercises.length===0){ showToast("Add at least one exercise."); return; }
                        const dur = combineHHMMSec(wbDuration, wbDurSec) || null;
                        const wo={id:uid(),name:wbName.trim(),icon:wbIcon,desc:wbDesc.trim(),
                          exercises:wbExercises,createdAt:todayStr(),oneOff:true,
                          durationMin:dur||null,
                          activeCal:wbActiveCal||null,
                          totalCal:wbTotalCal||null,
                          labels:wbLabels};
                        openStatsPromptIfNeeded(wo,(woWithStats, _sr)=>{
                          setCompletionModal({workout:woWithStats, fromStats:_sr});
                          setCompletionDate(todayStr());
                          setCompletionAction("today");
                        });
                        setWorkoutView("list");
                      }}, "Next: Log or Schedule →")
                    )
                  ) : (
                    wbEditId ? (
                      React.createElement('div', {style:{display:"flex",gap:8}},
                        React.createElement('button', {className:"btn btn-gold", style:{flex:1}, onClick:saveBuiltWorkout}, "💾 Update Workout"),
                        React.createElement('button', {className:"btn btn-ghost", style:{flex:1}, onClick:saveAsNewWorkout}, "📋 Save As New")
                      )
                    ) : (
                      React.createElement('div', {style:{display:"flex",gap:8,width:"100%"}},
                        React.createElement('button', { className: "btn btn-gold" , style: {flex:1}, onClick: saveBuiltWorkout}, "💾 Save Workout"),
                        React.createElement('button', { className: "btn btn-gold" , style: {flex:1,background:"linear-gradient(135deg,#8B7425,#A89030)"}, onClick: ()=>{
                          if(!wbName.trim()){ showToast("Name your workout first!"); return; }
                          if(wbExercises.length===0){ showToast("Add at least one exercise."); return; }
                          const dur = combineHHMMSec(wbDuration, wbDurSec) || null;
                          const wo={id:uid(),name:wbName.trim(),icon:wbIcon,desc:wbDesc.trim(),
                            exercises:wbExercises,createdAt:todayStr(),oneOff:true,
                            durationMin:dur||null,activeCal:wbActiveCal||null,totalCal:wbTotalCal||null,labels:wbLabels};
                          openStatsPromptIfNeeded(wo,(woWithStats, _sr)=>{
                            setCompletionModal({workout:woWithStats, fromStats:_sr});
                            setCompletionDate(todayStr());setCompletionAction("today");
                          });
                          setWorkoutView("list");
                        }}, "✓ Complete / Schedule")
                      )
                    )
                  )
                )
              );

              return null;
            })()

            /* ── PLANS TAB ───────────────────────── */
            , activeTab==="plans" && (
              React.createElement(React.Fragment, null
                , planView==="list" && (
                  React.createElement(React.Fragment, null
                    , React.createElement('div', { style: {display:"flex",alignItems:"center",marginBottom:8}}
                      , React.createElement('div', {className:"rpg-sec-header rpg-sec-header-center"}, React.createElement('div', {className:"rpg-sec-line rpg-sec-line-l"}), React.createElement('span', {className:"rpg-sec-title"}, "\u2726 Plans \u2726",
                        React.createElement('span', { className: "info-icon", style: {display:"inline-flex",alignItems:"center",justifyContent:"center",width:16,height:16,borderRadius:"50%",border:"1px solid rgba(180,172,158,.15)",fontSize:".48rem",fontWeight:700,color:"#8a8478",fontStyle:"normal",marginLeft:6,verticalAlign:"middle",cursor:"pointer",position:"relative"} }, "?", React.createElement('span', { className: "info-tooltip" }, "For long term workout plans. May include individual exercises and/or pre-defined workouts."))
                      ), React.createElement('div', {className:"rpg-sec-line rpg-sec-line-r"}))
                    )
                    , React.createElement('div', { style: {display:"flex",gap:8,marginBottom:13,flexWrap:"wrap"}}
                      , React.createElement('button', { className: "btn btn-gold btn-sm"  , onClick: initBuilderScratch}, "＋ New Plan"  )
                      , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setPlanView("recipe-pick")}, "📋 Recipes" )
                    )

                    /* ── UPCOMING section — standalone exercises only ─ */
                    , (()=>{
                      const swAll = (profile.scheduledWorkouts||[]);
                      if(swAll.length===0) return null;
                      const allItems = swAll
                        .filter(s=>!s.sourceWorkoutId) // exclude workout-grouped items — they show in Workouts tab
                        .map(s=>{const ex=allExById[s.exId]; return {kind:"ex",id:s.id,exId:s.exId,icon:ex?ex.icon:"💪",name:ex?ex.name:"Exercise",date:s.scheduledDate,notes:s.notes};})
                        .filter(s=>s.date)
                        .sort((a,b)=>a.date.localeCompare(b.date));
                      if(allItems.length===0) return null;
                      return (
                        React.createElement('div', { className: "upcoming-section"}
                          , React.createElement('div', { className: "sec", style: {marginBottom:8}}, "📅 Scheduled Exercises"  )
                          , allItems.map(item=>{
                            const days = daysUntil(item.date);
                            const badgeCls = days===0?"badge-today":days<=3?"badge-soon":"badge-future";
                            const badgeTxt = days===0?"Today":days===1?"Tomorrow":`${days}d away`;
                            return (
                              React.createElement('div', { key: item.id, className: "upcoming-card"}
                                , React.createElement('div', { className: "upcoming-icon"}, item.icon)
                                , React.createElement('div', { className: "upcoming-info"}
                                  , React.createElement('div', { className: "upcoming-name"}, item.name)
                                  , React.createElement('div', { className: "upcoming-date"}
                                    , formatScheduledDate(item.date)
                                    , item.notes?React.createElement('span', { style: {color:"#6a645a",marginLeft:6}}, item.notes):""
                                  )
                                )
                                , React.createElement('span', { className: `upcoming-badge ${badgeCls}`}, badgeTxt)
                                , React.createElement('div', { style: {fontSize:".65rem",color:"#b4ac9e",cursor:"pointer",padding:"3px 6px",borderRadius:4},
                                  onClick: e=>{e.stopPropagation(); openScheduleEx(item.exId||item.id, item.id);}}, "✎")
                                , React.createElement('div', { className: "upcoming-del", onClick: e=>{e.stopPropagation(); removeScheduledWorkout(item.id);}}, "✕")
                              )
                            );
                          })
                          , React.createElement('div', { className: "div", style: {margin:"6px 0"}})
                        )
                      );
                    })()
                    , profile.plans.length===0&&React.createElement('div', { className: "empty"}, "No plans yet."  , React.createElement('br', null), "Create one or browse recipes."    )
                    , profile.plans.map(plan=>{
                      const planXP=calcPlanXP(plan,profile.chosenClass,allExById);
                      const hasSched = !!plan.scheduledDate;
                      const daysN = hasSched ? daysUntil(plan.scheduledDate) : null;
                      return (
                        React.createElement('div', { key: plan.id, className: "plan-card", style: {"--pc":cls&&cls.color||"#b4ac9e"}}
                          , React.createElement('div', { className: "plan-card-top", onClick: ()=>{initBuilderFromTemplate(plan,true);}}
                            , React.createElement('div', { className: "plan-icon"}, plan.icon)
                            , React.createElement('div', { style: {flex:1,minWidth:0}}
                              , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,marginBottom:2}}
                                , React.createElement('div', { className: "plan-name", style: {flex:1}}, plan.name)
                                , plan.level&&React.createElement('span', { className: `plan-level-badge ${plan.level.toLowerCase()}`, style: {flexShrink:0}}, plan.level)
                              )
                              , React.createElement('div', { className: "plan-meta"}
                                , React.createElement('span', { className: `plan-type-badge type-${plan.type}`}
                                  , plan.durCount&&plan.durCount>1?`${plan.durCount} ${plan.type}s`:plan.type
                                )
                                , React.createElement('span', { style: {marginLeft:6,fontSize:".6rem",color:"#8a8478"}}, plan.days.filter(d=>d.exercises.length>0).length, " active days"  )
                                , plan.startDate&&React.createElement('span', { style: {marginLeft:6,fontSize:".6rem",color:"#8a8478"}}, "📅 " , new Date(plan.startDate+"T12:00:00").toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"}), plan.endDate?" → "+new Date(plan.endDate+"T12:00:00").toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"}):"")
                                , !plan.startDate&&hasSched&&React.createElement('span', { style: {marginLeft:6,fontSize:".6rem",color:"#b4ac9e"}}, "📅 " , formatScheduledDate(plan.scheduledDate))
                              )
                            )
                            , React.createElement('div', { className: "plan-xp-badge"}, "⚡ " , planXP.toLocaleString())
                          )
                          , plan.description&&React.createElement('div', { className: "plan-desc", onClick: ()=>{initBuilderFromTemplate(plan,true);}}, plan.description)
                          , React.createElement('div', { style: {display:"flex",gap:7,marginTop:7,paddingTop:7,borderTop:"1px solid rgba(45,42,36,.18)"}}
                            , React.createElement('button', { className: `plan-sched-btn ${hasSched?"plan-sched-active":""}`,
                              onClick: e=>{e.stopPropagation();openSchedulePlan(plan);}}
                              , hasSched?("📅 "+formatScheduledDate(plan.scheduledDate)):"📅 Schedule"
                            )
                            , React.createElement('div', { style: {flex:1}})
                            , React.createElement('button', { className: "btn btn-ghost btn-xs"  , onClick: e=>{e.stopPropagation();initBuilderFromTemplate(plan,true);}}, "View →" )
                          )
                        )
                      );
                    })
                  )
                )

                , planView==="recipe-pick" && (
                  React.createElement(React.Fragment, null
                    , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:9,marginBottom:11}}
                      , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setPlanView("list")}, "← Back" )
                      , React.createElement('div', { className: "sec", style: {margin:0,border:"none",padding:0}}, "Plan Recipes" )
                    )
                    , ["day","week"].map(type=>{
                      const typePlans = PLAN_TEMPLATES.filter(t=>t.type===type);
                      if(!typePlans.length) return null;
                      return (
                        React.createElement('div', { key: type}
                          , React.createElement('div', { className: "sec", style: {textTransform:"capitalize",marginBottom:8}}, type, " Plans" )
                          , typePlans.map(tpl=>{
                            const isCollapsed = !!collapsedTpls[tpl.id];
                            const isRec = tpl.bestFor.includes(profile.chosenClass);
                            const activeDays = tpl.days.filter(d=>d.exercises.length>0);
                            const tplXP = calcPlanXP(tpl,profile.chosenClass,allExById);
                            return (
                              React.createElement('div', { key: tpl.id, className: "workout-card", style: {marginBottom:10}}
                                /* Header — always visible, click to collapse */
                                , React.createElement('div', { style: {display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer"},
                                  onClick: ()=>setCollapsedTpls(s=>({...s,[tpl.id]:!s[tpl.id]}))}
                                  , React.createElement('div', { className: "workout-icon", style: {flexShrink:0}}, tpl.icon)
                                  , React.createElement('div', { style: {flex:1,minWidth:0}}
                                    , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,marginBottom:3}}
                                      , React.createElement('div', { className: "workout-name", style: {flex:1}}, tpl.name)
                                      , tpl.level&&React.createElement('span', { className: `plan-level-badge ${tpl.level.toLowerCase()}`, style: {flexShrink:0}}, tpl.level)
                                    )
                                    , React.createElement('div', { className: "workout-meta"}
                                      , React.createElement('span', { className: "workout-tag"}, activeDays.length, " active day"  , activeDays.length!==1?"s":"")
                                      , React.createElement('span', { className: "workout-tag"}, "⚡ " , tplXP.toLocaleString(), " XP" )
                                      , React.createElement('span', { className: `plan-type-badge type-${tpl.type}`, style: {marginLeft:4}}, tpl.durCount&&tpl.durCount>1?`${tpl.durCount} ${tpl.type}s`:tpl.type)
                                      , isRec&&React.createElement('span', { style: {fontSize:".56rem",color:_optionalChain([cls, 'optionalAccess', _95 => _95.color]),marginLeft:4}}, "✦ " , _optionalChain([cls, 'optionalAccess', _96 => _96.name]))
                                    )
                                  )
                                  , React.createElement('span', { style: {flexShrink:0,paddingTop:2,lineHeight:1,display:"flex",alignItems:"center"}}
                                    , React.createElement('svg', { width: "18", height: "18", viewBox: "0 0 18 18"   , fill: "none", xmlns: "http://www.w3.org/2000/svg",
                                      style: {transition:"transform .25s ease",transform:isCollapsed?"rotate(0deg)":"rotate(180deg)"}}
                                      , React.createElement('defs', null
                                        , React.createElement('linearGradient', { id: "chevGrad", x1: "0", y1: "0", x2: "0", y2: "1"}
                                          , React.createElement('stop', { offset: "0%", stopColor: "#b4ac9e"})
                                          , React.createElement('stop', { offset: "100%", stopColor: "#7a4e1a"})
                                        )
                                      )
                                      , React.createElement('polyline', { points: "4,7 9,12 14,7"  , stroke: "url(#chevGrad)", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round"})
                                    )
                                  )
                                )
                                /* Expanded content */
                                , !isCollapsed&&(()=>{
                                  const allTplExIds = [...new Set(tpl.days.flatMap(d=>d.exercises.map(e=>e.exId)))];
                                  return React.createElement('div', { style: {marginTop:10}}
                                    , React.createElement('div', { className: "workout-ex-pill-row", style: {marginBottom:10}}
                                      , allTplExIds.slice(0,6).map((exId,i)=>{
                                        const exD=allExById[exId];
                                        return exD?React.createElement('span', { key: i, className: "workout-ex-pill"}, exD.icon, " " , exD.name):null;
                                      })
                                      , allTplExIds.length>6&&React.createElement('span', { className: "workout-ex-pill"}, "+", allTplExIds.length-6, " more" )
                                    )
                                    , tpl.description&&React.createElement('div', { style: {fontSize:".72rem",color:"#8a8478",fontStyle:"italic",marginBottom:12,lineHeight:1.6}}, tpl.description)
                                    , React.createElement('div', { style: {background:"rgba(45,42,36,.12)",border:"1px solid rgba(45,42,36,.18)",borderRadius:8,padding:"8px 12px",marginBottom:12}}
                                      , tpl.days.map((day,di)=>(
                                        React.createElement('div', { key: di, style: {display:"flex",alignItems:"flex-start",gap:8,padding:"4px 0",borderBottom:di<tpl.days.length-1?"1px solid rgba(45,42,36,.15)":""}}
                                          , React.createElement('span', { style: {fontSize:".65rem",color:"#b4ac9e",minWidth:50,flexShrink:0,paddingTop:1}}, day.label||`Day ${di+1}`)
                                          , React.createElement('span', { style: {fontSize:".68rem",color:"#8a8478",flex:1}}
                                            , day.exercises.length===0
                                              ? React.createElement('span', { style: {color:"#6a645a",fontStyle:"italic"}}, "Rest")
                                              : day.exercises.map((e,ei)=>{const exD=allExById[e.exId];return exD?React.createElement('span', { key: ei}, ei>0?" · ":"", exD.icon, " " , exD.name, " " , e.sets, "×", e.reps):null;})
                                            
                                          )
                                        )
                                      ))
                                    )
                                    , React.createElement('div', { style: {display:"flex",gap:8}}
                                      , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1},
                                        onClick: e=>{e.stopPropagation();initBuilderFromTemplate(tpl,false);}}, "\uD83D\uDC41 View This Plan"

                                      )
                                      , React.createElement('button', { className: "btn btn-gold btn-sm"  , style: {flex:1},
                                        onClick: e=>{e.stopPropagation();initBuilderFromTemplate(tpl,true);}}, "\u270E Customize First"

                                      )
                                    )
                                  );
                                })()
                              )
                            );
                          })
                        )
                      );
                    })
                  )
                )

                , planView==="detail" && activePlan && (()=>{
                  const plan=activePlan;
                  const metric=isMetric(profile.units);
                  const wUnit=weightLabel(profile.units);
                  const [vDayIdx,setVDayIdx]=[detailDayIdx,setDetailDayIdx];
                  const totalXP=calcPlanXP(plan,profile.chosenClass,allExById);
                  const currentDay=plan.days[vDayIdx]||plan.days[0];
                  const dayXP=calcDayXP(currentDay,profile.chosenClass,allExById);
                  // Helper to update a field on an exercise in the active plan
                  function updateDetailEx(dayI,exI,field,val){
                    const newDays=plan.days.map((d,di)=>di!==dayI?d:{...d,exercises:d.exercises.map((e,ei)=>ei!==exI?e:{...e,[field]:val})});
                    setActivePlan({...plan,days:newDays});
                  }
                  return (
                    React.createElement(React.Fragment, null
                      , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:9,marginBottom:13}}
                        , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>{setPlanView("list");setActivePlan(null);setDetailDayIdx(0);}}, "← Back" )
                        , React.createElement('div', { style: {flex:1}}, React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".86rem",color:"#d4cec4"}}, plan.icon, " " , plan.name, plan.level&&React.createElement('span', { className: `plan-level-badge ${plan.level.toLowerCase()}`, style: {marginLeft:8,verticalAlign:"middle"}}, plan.level)))
                        , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flexShrink:0}, onClick: ()=>initBuilderFromTemplate(plan,true)}, "✎ Customize" )
                        , plan.custom&&React.createElement('button', { className: "btn btn-gold btn-sm"  , onClick: ()=>savePlanEdits(plan)}, "💾 Save" )
                      )
                      , React.createElement('div', { className: "xp-projection", style: {marginBottom:11}}
                        , React.createElement('div', null
                          , React.createElement('div', { className: "xp-proj-label"}, "Total Projected XP"  )
                          , React.createElement('div', { className: "xp-proj-detail"}
                            , plan.days.filter(d=>d.exercises.length>0).length, " active days · "    , cls&&cls.name, " bonuses applied"
                            , plan.durCount&&React.createElement('span', { style: {marginLeft:6}}, "· " , React.createElement('span', { className: `plan-type-badge type-${plan.type}`, style: {verticalAlign:"middle"}}, plan.durCount>1?`${plan.durCount} ${plan.type}s`:plan.type))
                          )
                          , (plan.startDate||plan.endDate)&&(
                            React.createElement('div', { style: {fontSize:".63rem",color:"#5a5650",marginTop:4}}
                              , plan.startDate&&React.createElement('span', null, "📅 " , new Date(plan.startDate+"T12:00:00").toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"}))
                              , plan.startDate&&plan.endDate&&React.createElement('span', { style: {margin:"0 4px"}}, "→")
                              , plan.endDate&&React.createElement('span', null, new Date(plan.endDate+"T12:00:00").toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"}))
                              , plan.startDate&&plan.endDate&&(()=>{
                                const s=new Date(plan.startDate+"T12:00:00"); const e=new Date(plan.endDate+"T12:00:00");
                                const days=Math.round((e-s)/(1000*60*60*24))+1;
                                return React.createElement('span', { style: {color:"#5a5650",marginLeft:4}}, "(", days, " day" , days!==1?"s":"", ")");
                              })()
                            )
                          )
                        )
                        , React.createElement('div', { className: "xp-proj-value"}, "⚡ " , totalXP.toLocaleString())
                      )

                      , React.createElement('div', { className: "day-tab-row"}
                        , plan.days.map((d,i)=>(
                          React.createElement('div', { key: i, className: `day-tab ${vDayIdx===i?"on":""} ${d.exercises.length===0?"rest-day":""}`, onClick: ()=>setVDayIdx(i)}, d.label)
                        ))
                      )
                      , currentDay.exercises.length>0&&React.createElement('div', { className: "day-xp-row"}, React.createElement('span', { className: "day-xp-label"}, currentDay.label, " projected XP"  ), React.createElement('span', { className: "day-xp-value"}, "⚡ " , dayXP))
                      , !plan.custom&&React.createElement('div', { style: {fontSize:".64rem",color:"#8a8478",fontStyle:"italic",marginBottom:8}}, "Tip: Customize this plan to save weight/duration edits permanently."        )
                      , currentDay.exercises.length===0?React.createElement('div', { className: "empty", style: {padding:"22px 0"}}, "Rest day. Recover well."   ):
                        currentDay.exercises.map((ex,exI)=>{
                          const exData=allExById[ex.exId]; if(!exData) return null;
                          const noSetsEx=NO_SETS_EX_IDS.has(exData.id);
                          const isRunningEx=exData.id===RUNNING_EX_ID;
                          const distMiVal=ex.distanceMi?parseFloat(ex.distanceMi):0;
                          const exXP=calcExXP(ex.exId,noSetsEx?1:ex.sets,ex.reps,profile.chosenClass,allExById,distMiVal||null,ex.weightLbs||null,null);
                          const clsD=profile.chosenClass?CLASSES[profile.chosenClass]:null; const mult=clsD&&clsD.bonuses&&exData.category?(clsD.bonuses[exData.category]||1):1;
                          const isCardioEx=exData.category==="cardio"||exData.category==="endurance";
                          const hasWeightEx = !isCardioEx && exData.category!=="flexibility";
                          const inputWVal = ex.weightLbs ? (metric ? lbsToKg(ex.weightLbs) : ex.weightLbs) : "";
                          const inputDurVal = ex.durationMin || "";
                          const inputDistVal = ex.distanceMi ? (metric ? String(parseFloat(miToKm(ex.distanceMi)).toFixed(2)) : String(ex.distanceMi)) : "";
                          const age = profile.age || 30;
                          const pbPaceMi=profile.runningPB||null;
                          const pbDisp=pbPaceMi?(metric?parseFloat((pbPaceMi*1.60934).toFixed(2))+" min/km":parseFloat(pbPaceMi.toFixed(2))+" min/mi"):null;
                          const exPB2=(profile.exercisePBs||{})[exData.id]||null;
                          const exPBDisp2=exPB2?(exPB2.type==="cardio"?(metric?parseFloat((exPB2.value*1.60934).toFixed(2))+" min/km":parseFloat(exPB2.value.toFixed(2))+" min/mi"):(exPB2.type==="assisted"?"1RM: "+exPB2.value+(metric?" kg":" lbs")+" (Assisted)":"1RM: "+exPB2.value+(metric?" kg":" lbs"))):null;
                          const durationMin=parseFloat(ex.reps||0);
                          const runPace=(isRunningEx&&distMiVal>0&&durationMin>0)?durationMin/distMiVal:null;
                          const runBoostPct=runPace?(runPace<=8?20:5):0;
                          return (
                            React.createElement('div', { key: exI,
                              className: `plan-ex-row ${dragDetailExIdx===exI?"dragging":""}`,
                              style: {flexDirection:"column",alignItems:"stretch",gap:0,opacity:dragDetailExIdx===exI?0.5:1},
                              draggable: true,
                              onDragStart: e=>{e.dataTransfer.effectAllowed="move";setDragDetailExIdx(exI);},
                              onDragOver: e=>{e.preventDefault();e.dataTransfer.dropEffect="move";},
                              onDrop: e=>{e.preventDefault();if(dragDetailExIdx===null) return; const nd=plan.days.map((d,di)=>{if(di!==vDayIdx) return d; const exs=[...d.exercises]; const [m]=exs.splice(dragDetailExIdx,1); exs.splice(exI,0,m); return {...d,exercises:exs};}); setActivePlan({...plan,days:nd}); setDragDetailExIdx(null);},
                              onDragEnd: ()=>setDragDetailExIdx(null)}
                              , (()=>{
                                const collapsed=!!collapsedDetailEx[`${vDayIdx}_${exI}`];
                                return (
                                  React.createElement(React.Fragment, null
                                    /* Header */
                                    , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:6,marginBottom:collapsed?0:7}}
                                      , React.createElement('span', { style: {cursor:"grab",color:"#5a5650",fontSize:".9rem",flexShrink:0}}, "⠿")
                                      , React.createElement('div', { style: {display:"flex",flexDirection:"column",gap:1,flexShrink:0}}

                                      )
                                      , React.createElement('span', { className: "plan-ex-icon"}, exData.icon)
                                      , React.createElement('div', { style: {flex:1,minWidth:0}}
                                        , React.createElement('div', { className: "plan-ex-name"}, exData.name)
                                        , exData.id!=="rest_day"&&React.createElement('div', { className: "plan-ex-sets"}
                                          , noSetsEx?"":ex.sets+"×", ex.reps
                                          , ex.weightLbs&&React.createElement('span', { style: {color:"#8a8478",marginLeft:5}}, metric?lbsToKg(ex.weightLbs)+" kg":ex.weightLbs+" lbs")
                                          , ex.durationMin&&React.createElement('span', { style: {color:"#8a8478",marginLeft:5}}, ex.durationMin, " min" )
                                          , ex.distanceMi&&React.createElement('span', { style: {color:"#8a8478",marginLeft:5}}, metric?parseFloat(miToKm(ex.distanceMi)).toFixed(1)+" km":ex.distanceMi+" mi")
                                          , ex.hrZone&&React.createElement('span', { style: {color:HR_ZONES[ex.hrZone-1].color,marginLeft:5}}, "Z", ex.hrZone)
                                          , React.createElement('span', { className: `ex-mult ${mult>1.02?"mb":mult<0.98?"mp":"mn"}`, style: {marginLeft:6}}, Math.round(mult*100), "%")
                                        )
                                      )
                                      , (isRunningEx&&pbDisp||exPBDisp2)&&React.createElement('span', { style: {fontSize:".58rem",color:"#b4ac9e",flexShrink:0} }, "🏆 ", isRunningEx&&pbDisp?pbDisp:exPBDisp2)
                                      , React.createElement('div', { className: "plan-ex-xp"}, "+", exXP, " XP" , runBoostPct>0&&React.createElement('span', { style: {color:"#FFE87C",marginLeft:2}}, "⚡"))
                                      , React.createElement('div', { className: "ex-info-btn", style: {position:"static"}, onClick: ()=>{setDetailEx(exData);setDetailImgIdx(0);}}, "ℹ")
                                      , React.createElement('span', { className: "ex-collapse-btn", onClick: e=>{e.stopPropagation();toggleDetailEx(vDayIdx,exI);}}
                                        , React.createElement('svg', { width: "14", height: "14", viewBox: "0 0 14 14"   , fill: "none", xmlns: "http://www.w3.org/2000/svg", style: {transition:"transform .22s ease",transform:collapsed?"rotate(0deg)":"rotate(180deg)"}}
                                          , React.createElement('defs', null, React.createElement('linearGradient', { id: "cg2", x1: "0", y1: "0", x2: "0", y2: "1"}, React.createElement('stop', { offset: "0%", stopColor: "#b4ac9e"}), React.createElement('stop', { offset: "100%", stopColor: "#7a4e1a"})))
                                          , React.createElement('polyline', { points: "3,5 7,9 11,5"  , stroke: "url(#cg2)", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round"})
                                        )
                                      )
                                    )
                                    , !collapsed&&exData.id!=="rest_day"&&React.createElement(React.Fragment, null
                                      /* Sets + Reps/Duration + Weight */
                                      , React.createElement('div', { style: {display:"flex",gap:8,marginBottom:6}}
                                        , !noSetsEx&&React.createElement('div', { style: {flex:1}}
                                          , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Sets")
                                          , React.createElement('input', { className: "plan-ex-edit-inp", style: {width:"100%"}, type: "text", inputMode: "decimal",
                                            value: ex.sets===0||ex.sets===""?"":ex.sets||"", onChange: e=>updateDetailEx(vDayIdx,exI,"sets",e.target.value)})
                                        )
                                        , React.createElement('div', { style: {flex:1}}
                                          , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, isCardioEx?"Duration (min)":"Reps")
                                          , React.createElement('input', { className: "plan-ex-edit-inp", style: {width:"100%"}, type: "text", inputMode: "decimal",
                                            value: ex.reps===0||ex.reps===""?"":ex.reps||"", onChange: e=>updateDetailEx(vDayIdx,exI,"reps",e.target.value)})
                                        )
                                        , hasWeightEx&&(
                                          React.createElement('div', { style: {flex:1}}
                                            , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, wUnit)
                                            , React.createElement('input', { className: "plan-ex-edit-inp", style: {width:"100%"}, type: "text", inputMode: "decimal", step: metric?"0.5":"2.5",
                                              value: inputWVal, placeholder: "—",
                                              onChange: e=>{const v=e.target.value;const lbs=v&&metric?kgToLbs(v):v;updateDetailEx(vDayIdx,exI,"weightLbs",lbs||null);}})
                                          )
                                        )
                                      )
                                      , isRunningEx&&runBoostPct>0&&(
                                        React.createElement('div', { style: {fontSize:".65rem",color:"#FFE87C",marginBottom:5}}, "⚡ +" , runBoostPct, "% pace bonus"  , runBoostPct===20?" (sub-8 mi!)":"")
                                      )
                                      , hasWeightEx&&(
                                        React.createElement('div', { style: {marginBottom:6}}
                                          , React.createElement('div', { style: {display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}
                                            , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:0}}, "Weight Intensity" )
                                            , React.createElement('span', { style: {fontSize:".68rem",color:"#b4ac9e"}}, ex.weightPct||100, "%")
                                          )
                                          , React.createElement('input', { type: "range", className: "pct-slider", min: "0", max: "100", step: "5",
                                            value: pctToSlider(ex.weightPct||100),
                                            onChange: e=>updateDetailEx(vDayIdx,exI,"weightPct",sliderToPct(Number(e.target.value)))})
                                          , React.createElement('div', { style: {display:"flex",justifyContent:"space-between",fontSize:".55rem",color:"#6a645a",marginTop:1}}
                                            , React.createElement('span', null, "50% Deload" ), React.createElement('span', null, "100% Normal" ), React.createElement('span', null, "200% Max" )
                                          )
                                        )
                                      )
                                      , isCardioEx&&(
                                        React.createElement('div', { style: {marginBottom:6}}
                                          , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:3,display:"block"}}, "Distance (" , metric?"km":"mi", ") " , React.createElement('span', { style: {opacity:.6,fontSize:".55rem"}}, "(optional)"))
                                          , React.createElement('input', { className: "plan-ex-edit-inp", style: {width:"100%"}, type: "text", inputMode: "decimal",
                                            value: inputDistVal, placeholder: "0",
                                            onChange: e=>{const v=e.target.value;const mi=v&&metric?kmToMi(v):v;updateDetailEx(vDayIdx,exI,"distanceMi",mi||null);}})
                                        )
                                      )
                                      , isCardioEx&&(
                                        React.createElement('div', null
                                          , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",marginBottom:4,display:"block"}}, "Avg Heart Rate Zone "    , React.createElement('span', { style: {opacity:.6,fontSize:".55rem"}}, "(optional)"))
                                          , React.createElement('div', { className: "hr-zone-row"}
                                            , HR_ZONES.map(z=>{
                                              const sel=ex.hrZone===z.z;
                                              const range=hrRange(age,z);
                                              return (
                                                React.createElement('div', { key: z.z, className: `hr-zone-btn ${sel?"sel":""}`,
                                                  style: {"--zc":z.color,borderColor:sel?z.color:"rgba(45,42,36,.2)",background:sel?`${z.color}22`:"rgba(45,42,36,.12)"},
                                                  onClick: ()=>updateDetailEx(vDayIdx,exI,"hrZone",sel?null:z.z)}
                                                  , React.createElement('span', { className: "hz-name", style: {color:sel?z.color:"#5a5650"}}, "Z", z.z, " " , z.name)
                                                  , React.createElement('span', { className: "hz-bpm", style: {color:sel?z.color:"#6a645a"}}, range.lo, "–", range.hi)
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
                          );
                        })
                      
                      , React.createElement('div', { className: "div"})
                      , (()=>{
                        const isUserPlan = (profile.plans||[]).some(p=>p.id===plan.id);
                        if(!isUserPlan) {
                          return React.createElement('div', {style:{background:"rgba(45,42,36,.15)",border:"1px solid rgba(180,172,158,.06)",borderRadius:10,padding:"14px",textAlign:"center"}},
                            React.createElement('div', {style:{fontSize:".72rem",color:"#8a8478",marginBottom:8}}, "This is a recipe preview. Customize it to add it to your plans."),
                            React.createElement('button', { className: "btn btn-gold", style: {width:"100%"}, onClick: ()=>initBuilderFromTemplate(plan,true) }, "\u270E Customize & Add to My Plans")
                          );
                        }
                        return React.createElement(React.Fragment, null,
                          React.createElement('div', { className: "plan-actions"}
                            , React.createElement('button', { className: "btn btn-glass-yellow" , style: {flex:1}, onClick: ()=>{
                              const synth={name:currentDay.label||"Day",icon:plan.icon||"\uD83D\uDCCB",exercises:currentDay.exercises,
                                durationMin:currentDay.durationMin||null,activeCal:currentDay.activeCal||null,totalCal:currentDay.totalCal||null};
                              openStatsPromptIfNeeded(synth,(woWithStats, _sr)=>{
                                startPlanWorkout({...plan,days:[{...currentDay,durationMin:woWithStats.durationMin,activeCal:woWithStats.activeCal,totalCal:woWithStats.totalCal}]});
                              });
                            }}, "\u2713 Complete Day"  )
                          ),
                          React.createElement('div', { style: {display:"flex",gap:7,marginTop:7}}
                            , React.createElement('button', { className: `plan-sched-btn ${plan.scheduledDate?"plan-sched-active":""}`,
                              style: {flex:1,padding:"8px 12px",textAlign:"center"},
                              onClick: ()=>openSchedulePlan(plan)}
                              , plan.scheduledDate?"\uD83D\uDCC5 "+formatScheduledDate(plan.scheduledDate):"\uD83D\uDCC5 Schedule"
                            )
                            , plan.custom&&React.createElement('button', { className: "btn btn-danger btn-sm"  , style: {flex:1}, onClick: ()=>deletePlan(plan.id)}, "\uD83D\uDDD1 Delete" )
                          ),
                          plan.custom&&React.createElement('button', { className: "btn btn-glass" , style: {width:"100%",marginTop:7}, onClick: ()=>startPlanWorkout(plan)}, "\uD83D\uDCCB Mark Plan Complete"   )
                        );
                      })()
                    )
                  );
                })()

                , planView==="builder" && React.createElement(PlanWizard, {
                  editPlan: wizardEditPlan,
                  templatePlan: wizardTemplatePlan,
                  profile: profile,
                  allExercises: allExercises,
                  allExById: allExById,
                  onSave: handlePlanWizardSave,
                  onClose: ()=>{ setPlanView("list"); },
                  onCompleteDayStart: openStatsPromptIfNeeded,
                  onStartPlanWorkout: startPlanWorkout,
                  onDeletePlan: deletePlan,
                  onSchedulePlan: openSchedulePlan,
                  onOpenExEditor: openExEditor,
                  showToast: showToast,
                })
              ) /* close plans tab React.createElement(React.Fragment) */
            ) /* close activeTab==="plans" && () */

            /* ── CALENDAR TAB ────────────────────── */
            , activeTab==="calendar" && (()=>{
              const {y, m} = calViewDate;
              const today = todayStr();
              const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
              const dowNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

              // Build calendar grid
              const firstDay = new Date(y, m, 1).getDay(); // 0=Sun
              const daysInMonth = new Date(y, m+1, 0).getDate();
              const daysInPrev = new Date(y, m, 0).getDate();

              // Build date→events maps
              const schedMap = {}; // dateStr → [{kind,icon,name,id,planId}]
              // Scheduled plans — populate every day in their date range
              profile.plans.filter(p=>p.scheduledDate||p.startDate).forEach(p=>{
                const start = p.startDate || p.scheduledDate;
                const end   = p.endDate   || p.scheduledDate || p.startDate;
                if(!start) return;
                // Iterate every date from start to end
                const s = new Date(start+"T12:00:00");
                const e = new Date(end+"T12:00:00");
                for(let d=new Date(s); d<=e; d.setDate(d.getDate()+1)){
                  const dk = d.toISOString().slice(0,10);
                  if(!schedMap[dk]) schedMap[dk]=[];
                  // Only add once per plan per day
                  if(!schedMap[dk].find(x=>x.id===p.id))
                    schedMap[dk].push({kind:"plan",icon:p.icon,name:p.name,id:p.id,planId:p.id,notes:p.scheduleNotes,isRange:!!(p.startDate&&p.endDate),rangeStart:start,rangeEnd:end});
                }
              });
              // Scheduled exercises
              (profile.scheduledWorkouts||[]).forEach(s=>{
                const ex = allExById[s.exId];
                const dk = s.scheduledDate;
                if(!schedMap[dk]) schedMap[dk]=[];
                schedMap[dk].push({kind:"ex",icon:ex?ex.icon:"💪",name:ex?ex.name:"Exercise",id:s.id,notes:s.notes});
              });
              // Logged workouts (past)
              const logMap = {}; // dateKey → [{...entry}]
              profile.log.forEach(e=>{
                const dk = e.dateKey||"";
                if(!dk) return;
                if(!logMap[dk]) logMap[dk]=[];
                logMap[dk].push(e);
              });

              // Build cell array
              const cells = [];
              for(let i=0;i<firstDay;i++) cells.push({day:daysInPrev-firstDay+1+i,thisMonth:false,dateStr:null});
              for(let d=1;d<=daysInMonth;d++){
                const ds = `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                cells.push({day:d,thisMonth:true,dateStr:ds});
              }
              const remainder = (7 - cells.length%7)%7;
              for(let i=1;i<=remainder;i++) cells.push({day:i,thisMonth:false,dateStr:null});

              // Selected day events
              const selSched = calSelDate ? (schedMap[calSelDate]||[]) : [];
              const selLog   = calSelDate ? (logMap[calSelDate]||[])   : [];
              const selDateObj = calSelDate ? new Date(calSelDate+"T12:00:00") : null;
              const selLabel = selDateObj
                ? selDateObj.toLocaleDateString([],{weekday:"long",month:"long",day:"numeric",year:"numeric"})
                : "";
              const isSelToday = calSelDate===today;

              return (
                React.createElement(React.Fragment, null
                  , React.createElement('div', {className:"rpg-sec-header rpg-sec-header-center", style:{marginBottom:10}}, React.createElement('div', {className:"rpg-sec-line rpg-sec-line-l"}), React.createElement('span', {className:"rpg-sec-title"}, "✦ Chronicle ✦"), React.createElement('div', {className:"rpg-sec-line rpg-sec-line-r"}))

                  /* Month navigator */
                  , React.createElement('div', { className: "cal-nav"}
                    , React.createElement('div', { className: "cal-nav-btn", onClick: ()=>setCalViewDate(({y,m})=>m===0?{y:y-1,m:11}:{y,m:m-1})}, "‹")
                    , React.createElement('div', { className: "cal-month-lbl"}, monthNames[m], " " , y)
                    , React.createElement('div', { className: "cal-nav-btn", onClick: ()=>setCalViewDate(({y,m})=>m===11?{y:y+1,m:0}:{y,m:m+1})}, "›")
                  )

                  /* Day-of-week headers */
                  , React.createElement('div', { className: "cal-grid"}
                    , dowNames.map(d=>React.createElement('div', { key: d, className: "cal-dow"}, d))

                    /* Calendar cells */
                    , cells.map((cell,ci)=>{
                      if(!cell.thisMonth) return (
                        React.createElement('div', { key: "o"+ci, className: "cal-cell other-month" }
                          , React.createElement('span', { className: "cal-day-num"}, cell.day)
                        )
                      );
                      const ds = cell.dateStr;
                      const hasSched = !!(schedMap[ds] && schedMap[ds].length>0);
                      const hasLog   = !!(logMap[ds]   && logMap[ds].length>0);
                      const isToday  = ds===today;
                      const isSel    = ds===calSelDate;
                      const schedDots = (schedMap[ds]||[]).map(e=>e.kind==="plan"?"#d4cec4":"#3498db");
                      const logDot = hasLog ? "#2ecc71" : null;
                      return (
                        React.createElement('div', { key: ds,
                          className: `cal-cell ${isToday?"today":""} ${isSel?"selected":""} ${hasSched?"has-event":""} ${hasLog&&!hasSched?"has-log":""}`,
                          onClick: ()=>setCalSelDate(ds)}
                          , React.createElement('span', { className: "cal-day-num"}, cell.day)
                          , React.createElement('div', { className: "cal-dot-row"}
                            , schedDots.slice(0,3).map((c,i)=>React.createElement('div', { key: i, className: "cal-dot", style: {background:c}}))
                            , logDot&&React.createElement('div', { className: "cal-dot", style: {background:logDot}})
                          )
                        )
                      );
                    })
                  )

                  /* Legend */
                  , React.createElement('div', { className: "cal-legend"}
                    , React.createElement('div', { className: "cal-legend-item"}, React.createElement('div', { className: "cal-legend-dot", style: {background:"#b4ac9e"}}), " Planned workout"  )
                    , React.createElement('div', { className: "cal-legend-item"}, React.createElement('div', { className: "cal-legend-dot", style: {background:"#3498db"}}), " Scheduled exercise"  )
                    , React.createElement('div', { className: "cal-legend-item"}, React.createElement('div', { className: "cal-legend-dot", style: {background:"#2ecc71"}}), " Completed session"  )
                  )

                  /* Monthly Totals — moved from above to be grouped with Month summary below */

                  /* Selected day detail */
                  , calSelDate && (
                    React.createElement('div', { className: "cal-day-detail"}
                      , React.createElement('div', { className: "cal-day-hdr"}
                        , React.createElement('span', null, selLabel)
                        , isSelToday && React.createElement('span', { style: {fontSize:".6rem",color:"#b4ac9e",fontFamily:"'Inter',sans-serif"}}, "Today")
                      )

                      /* Scheduled items */
                      , selSched.length>0 && (
                        React.createElement(React.Fragment, null
                          , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".54rem",color:"#5a5650",letterSpacing:".1em",textTransform:"uppercase",marginBottom:6}}, "Scheduled")
                          , selSched.map((ev,i)=>(
                            React.createElement('div', { key: i, className: "cal-event-row sched" }
                              , React.createElement('span', { className: "cal-event-icon"}, ev.icon)
                              , React.createElement('div', { style: {flex:1,minWidth:0}}
                                , React.createElement('div', { className: "cal-event-name"}, ev.name)
                                , ev.notes&&React.createElement('div', { className: "cal-event-sub"}, ev.notes)
                                , React.createElement('div', { className: "cal-event-sub"}, ev.kind==="plan"?"Workout Plan":"Exercise")
                              )
                              , ev.kind==="plan" && (
                                React.createElement('button', { className: "cal-sched-btn", onClick: ()=>{
                                  const pl=profile.plans.find(p=>p.id===ev.planId);
                                  if(pl){initBuilderFromTemplate(pl,true);setActiveTab("plans");}
                                }}, "View →" )
                              )
                              , React.createElement('div', { className: "upcoming-del", onClick: ()=>{
                                ev.kind==="plan"?removePlanSchedule(ev.planId):removeScheduledWorkout(ev.id);
                              }}, "✕")
                            )
                          ))
                        )
                      )

                      /* Logged sessions — grouped by workout/plan */
                      , selLog.length>0 && (()=>{
                        /* Group by sourceGroupId */
                        const groups = {};
                        const ungrouped = [];
                        selLog.forEach(e=>{
                          const gid = e.sourceGroupId;
                          if(gid){ if(!groups[gid]) groups[gid]=[]; groups[gid].push(e); }
                          else ungrouped.push(e);
                        });
                        const groupArr = Object.values(groups);
                        return React.createElement(React.Fragment, null
                          , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".54rem",color:"#5a5650",letterSpacing:".1em",textTransform:"uppercase",marginBottom:6,marginTop:selSched.length>0?10:0} }, "Completed")
                          /* Grouped workout/plan cards */
                          , groupArr.map((entries,gi)=>{
                            const first = entries[0];
                            const groupXP = entries.reduce((s,e)=>s+e.xp,0);
                            const gid = first.sourceGroupId;
                            const cKey = "cal_"+gid;
                            const collapsed = !openLogGroups[cKey];
                            const label = first.sourcePlanName || first.sourceWorkoutName || "Workout";
                            const icon = first.sourcePlanIcon || first.sourceWorkoutIcon || "💪";
                            const uniqueExCount = new Set(entries.map(e=>e.exId)).size;
                            const gStats = getEntryStats(first);
                            const hasStats = gStats.durationSec || gStats.activeCal || gStats.totalCal;
                            const calGrpFirstEx = entries.map(en=>allExById[en.exId]).find(Boolean);
                            const calGrpMgColor = getMuscleColor(calGrpFirstEx && calGrpFirstEx.muscleGroup);
                            return React.createElement('div', { key: gi, className: "log-group-card", style:{marginBottom:8, "--mg-color":calGrpMgColor} }
                              , React.createElement('div', { className: "log-group-hdr "+(collapsed?"collapsed":""), onClick:()=>toggleLogGroup(cKey), style:{cursor:"pointer"} }
                                , React.createElement('span', { className: "log-group-icon" }, icon)
                                , React.createElement('div', { style:{flex:1,minWidth:0} }
                                  , React.createElement('div', { className: "log-group-name" }, label)
                                  , React.createElement('div', { className: "log-group-meta" }, uniqueExCount, " exercise", uniqueExCount!==1?"s":"", " · ", first.time)
                                  , hasStats && React.createElement('div', { style:{fontSize:".5rem",color:"#6a645a",marginTop:2,display:"flex",gap:8} }
                                    , gStats.durationSec>0 && React.createElement('span', null, "⏱ ", secToHMS(gStats.durationSec))
                                    , gStats.totalCal>0 && React.createElement('span', null, "🔥 ", gStats.totalCal, " cal")
                                    , gStats.activeCal>0 && React.createElement('span', null, "⚡ ", gStats.activeCal, " active")
                                  )
                                )
                                , React.createElement('div', { className: "log-group-xp" }, "⚡ ", groupXP.toLocaleString(), " XP")
                                , React.createElement('span', { style:{fontSize:".6rem",color:"#5a5650",flexShrink:0,transition:"transform .2s",transform:collapsed?"rotate(-90deg)":"rotate(0deg)",marginLeft:6} }, "▾")
                              )
                              , !collapsed && (()=>{
                                // Consolidate entries by exId
                                const byExId = {};
                                entries.forEach(e=>{ if(!byExId[e.exId]) byExId[e.exId]=[]; byExId[e.exId].push(e); });
                                const consolidated = Object.values(byExId);
                                return React.createElement('div', { className: "log-group-body" }
                                  , consolidated.map((exEntries,ci)=>{
                                    const ef = exEntries[0];
                                    const exXP = exEntries.reduce((s,e)=>s+e.xp,0);
                                    const isSuperset = exEntries.some(e=>entries.some((o,oi)=>o.exId!==e.exId && o.sourceGroupId===e.sourceGroupId && ((o.supersetWith!=null)||(e.supersetWith!=null))));
                                    const efData = allExById[ef.exId];
                                    const efMgColor = getMuscleColor(efData && efData.muscleGroup);
                                    return React.createElement('div', { key:ci, className:"h-entry", style:{marginBottom:4,cursor:"pointer","--mg-color":efMgColor},
                                      onClick:()=>setCalExDetailModal({ entries:exEntries, exerciseName:ef.exercise, exerciseIcon:ef.icon,
                                        sourceName:first.sourcePlanName||first.sourceWorkoutName||null, sourceIcon:icon,
                                        totalCal:gStats.totalCal, activeCal:gStats.activeCal, durationSec:gStats.durationSec }) }
                                      , React.createElement('span', {className:"h-icon"}, ef.icon)
                                      , React.createElement('div', {style:{flex:1,minWidth:0}}
                                        , React.createElement('div', {className:"h-name", style:{display:"flex",alignItems:"center",gap:4}}
                                          , React.createElement('span', null, ef.exercise)
                                          , isSuperset && React.createElement('span', {style:{fontSize:".48rem",color:"#b4ac9e",background:"rgba(180,172,158,.1)",padding:"1px 5px",borderRadius:3,fontWeight:600}}, "SS")
                                          , exEntries.length>1 && React.createElement('span', {style:{fontSize:".48rem",color:"#8a8478",background:"rgba(180,172,158,.08)",padding:"1px 5px",borderRadius:3}}, exEntries.length, " sets")
                                        )
                                      )
                                      , React.createElement('div', {className:"h-xp"}, "+", exXP, " XP")
                                    );
                                  })
                                );
                              })()
                            );
                          })
                          /* Ungrouped standalone exercises */
                          , ungrouped.map((e,i)=>{
                            const uStats = getEntryStats(e);
                            const uHasStats = uStats.durationSec || uStats.activeCal || uStats.totalCal;
                            return React.createElement('div', { key: "u"+i, className: "cal-event-row log-entry", style:{cursor:"pointer"},
                              onClick:()=>setCalExDetailModal({ entries:[e], exerciseName:e.exercise, exerciseIcon:e.icon,
                                sourceName:null, sourceIcon:null,
                                totalCal:uStats.totalCal, activeCal:uStats.activeCal, durationSec:uStats.durationSec }) }
                              , React.createElement('span', { className: "cal-event-icon" }, e.icon)
                              , React.createElement('div', { style: {flex:1,minWidth:0} }
                                , React.createElement('div', { className: "cal-event-name" }, e.exercise)
                                , React.createElement('div', { className: "cal-event-sub" }
                                  , e.sets, "×", e.reps
                                  , e.weightLbs?React.createElement('span', { style: {marginLeft:5} }, isMetric(profile.units)?lbsToKg(e.weightLbs)+" kg":e.weightLbs+" lbs"):""
                                  , e.distanceMi?React.createElement('span', { style: {marginLeft:5} }, isMetric(profile.units)?miToKm(e.distanceMi)+" km":e.distanceMi+" mi"):""
                                  , React.createElement('span', { style: {marginLeft:5,color:"#6a645a"} }, e.time)
                                )
                                , uHasStats && React.createElement('div', { style:{fontSize:".5rem",color:"#6a645a",marginTop:2,display:"flex",gap:8} }
                                  , uStats.durationSec>0 && React.createElement('span', null, "⏱ ", secToHMS(uStats.durationSec))
                                  , uStats.totalCal>0 && React.createElement('span', null, "🔥 ", uStats.totalCal, " cal")
                                  , uStats.activeCal>0 && React.createElement('span', null, "⚡ ", uStats.activeCal, " active")
                                )
                              )
                              , React.createElement('div', { className: "cal-event-xp" }, "+", e.xp, " XP")
                            );
                          })
                        );
                      })()

                      , selSched.length===0 && selLog.length===0 && (
                        React.createElement('div', { className: "cal-empty-day"}, "No workouts "
                            , calSelDate>=today?"planned":"logged", " for this day."
                        )
                      )
                    )
                  )

                  /* Month summary */
                  , (()=>{
                    const monthPrefix = `${y}-${String(m+1).padStart(2,"0")}`;
                    const monthSched = Object.entries(schedMap).filter(([dk])=>dk.startsWith(monthPrefix));
                    const monthLog   = Object.entries(logMap).filter(([dk])=>dk.startsWith(monthPrefix));
                    const totalLoggedDays = monthLog.length;
                    const totalSchedItems = monthSched.reduce((s,[,arr])=>s+arr.length,0);
                    const totalLogXP = monthLog.reduce((s,[,arr])=>s+arr.reduce((t,e)=>t+e.xp,0),0);
                    return (
                      React.createElement('div', { style: {display:"flex",gap:8,marginTop:4}}
                        , React.createElement('div', { className: "eff-weight", style: {flex:1}}
                          , React.createElement('span', { className: "eff-weight-val"}, totalLoggedDays)
                          , React.createElement('span', { className: "eff-weight-lbl"}, "Sessions this month"  )
                        )
                        , React.createElement('div', { className: "eff-weight", style: {flex:1}}
                          , React.createElement('span', { className: "eff-weight-val"}, totalSchedItems)
                          , React.createElement('span', { className: "eff-weight-lbl"}, "Scheduled")
                        )
                        , React.createElement('div', { className: "eff-weight", style: {flex:1}}
                          , React.createElement('span', { className: "eff-weight-val"}, totalLogXP.toLocaleString())
                          , React.createElement('span', { className: "eff-weight-lbl"}, "XP earned" )
                        )
                      )
                    );
                  })()

                  /* Duration / Calorie totals */
                  , (()=>{
                    const mPrefix = `${y}-${String(m+1).padStart(2,"0")}`;
                    const mEntries = profile.log.filter(e=>e.dateKey&&e.dateKey.startsWith(mPrefix));
                    // Deduplicate grouped entries (workouts/plans share a sourceGroupId)
                    const grouped = {};
                    const ungrouped = [];
                    mEntries.forEach(e => {
                      if (e.sourceGroupId) {
                        if (!grouped[e.sourceGroupId]) grouped[e.sourceGroupId] = e;
                      } else {
                        ungrouped.push(e);
                      }
                    });
                    const sources = [...Object.values(grouped), ...ungrouped];
                    const statsArr = sources.map(e => getEntryStats(e));
                    const estC = statsArr.reduce((s, st) => s + st.totalCal, 0);
                    const estA = statsArr.reduce((s, st) => s + st.activeCal, 0);
                    const totalSec = statsArr.reduce((s, st) => s + st.durationSec, 0);
                    const dH = Math.floor(totalSec / 3600);
                    const dM = Math.floor((totalSec % 3600) / 60);
                    const dS = totalSec % 60;
                    const dStr = String(dH).padStart(2,"0")+":"+String(dM).padStart(2,"0")+":"+String(dS).padStart(2,"0");
                    return React.createElement('div', {style:{display:"flex",gap:8,marginTop:8}},
                      React.createElement('div', { className: "eff-weight", style: {flex:1} },
                        React.createElement('span', { className: "eff-weight-val" }, dStr),
                        React.createElement('span', { className: "eff-weight-lbl" }, "Duration")
                      ),
                      React.createElement('div', { className: "eff-weight", style: {flex:1} },
                        React.createElement('span', { className: "eff-weight-val" }, estC.toLocaleString()),
                        React.createElement('span', { className: "eff-weight-lbl" }, "Total Cal")
                      ),
                      React.createElement('div', { className: "eff-weight", style: {flex:1} },
                        React.createElement('span', { className: "eff-weight-val" }, estA.toLocaleString()),
                        React.createElement('span', { className: "eff-weight-lbl" }, "Active Cal")
                      )
                    );
                  })()
                )
              );
            })()

            /* ── LEADERBOARD TAB ─────────────────────── */
            , activeTab==="leaderboard" && (()=>{
              const LB_FILTERS = [
                {id:"overall_xp",   label:"Overall XP",   type:"xp",       icon:"⚔️",  desc:"Total XP earned all time"},
                {id:"weekly_xp",    label:"Weekly XP",    type:"xp",       icon:"📅",  desc:"XP earned this week (resets Monday)"},
                {id:"bench_1rm",    label:"Bench Press",  type:"strength", icon:"🏋️", desc:"Heaviest 1x1 set"},
                {id:"squat_1rm",    label:"Squat",        type:"strength", icon:"🦵",  desc:"Heaviest 1x1 set"},
                {id:"deadlift_1rm", label:"Deadlift",     type:"strength", icon:"💀",  desc:"Heaviest 1x1 set"},
                {id:"ohp_1rm",      label:"Overhead Press",type:"strength",icon:"🏹",  desc:"Heaviest 1x1 set"},
                {id:"pullup_reps",  label:"Pull-Ups",     type:"reps",     icon:"💪",  desc:"Most reps in 1 set"},
                {id:"pushup_reps",  label:"Push-Ups",     type:"reps",     icon:"🤸",  desc:"Most reps in 1 set"},
                {id:"run_pace",     label:"Running Pace", type:"cardio",   icon:"🏃",  desc:"Best min/mi (lower = faster)"},
                {id:"streak",       label:"Streak",       type:"habit",    icon:"🔥",  desc:"Longest consecutive check-in streak"},
              ];
              const TC = {xp:"#b4ac9e",strength:"#e74c3c",reps:"#3498db",cardio:"#2ecc71",habit:"#e67e22",class:"#9b59b6"};
              const cls  = CLASSES[profile.chosenClass]||CLASSES.warrior;
              const af   = LB_FILTERS.find(f=>f.id===lbFilter)||LB_FILTERS[0];
              const tc   = TC[af.type]||"#b4ac9e";

              // Get the correct display name for a leaderboard row based on name visibility
              const getRowName = (row) => {
                const nv = row.name_visibility || { displayName:["app","game"], realName:["hide"] };
                // Leaderboard = "game" context
                if ((nv.realName||[]).includes("game")) {
                  const rn = ((row.first_name||"")+" "+(row.last_name||"")).trim();
                  if (rn) return rn;
                }
                return row.player_name || "Unknown";
              };

              const getRowVal = (row, filterId) => {
                if(filterId==="overall_xp") return row.total_xp||0;
                if(filterId==="streak") return row.streak||0;
                const pbs = row.exercise_pbs||{};
                if(filterId==="bench_1rm") return ((pbs["bench"]||pbs["bench_press"])||{}).weight||0;
                if(filterId==="squat_1rm") return ((pbs["squat"]||pbs["barbell_back_squat"])||{}).weight||0;
                if(filterId==="deadlift_1rm") return ((pbs["deadlift"]||pbs["barbell_deadlift"])||{}).weight||0;
                if(filterId==="ohp_1rm") return ((pbs["overhead_press"]||pbs["ohp"])||{}).weight||0;
                if(filterId==="pullup_reps") return ((pbs["pull_up"]||pbs["pullups"])||{}).reps||0;
                if(filterId==="pushup_reps") return ((pbs["push_up"]||pbs["pushups"])||{}).reps||0;
                if(filterId==="run_pace") return ((pbs["running"]||pbs["treadmill_run"]||pbs["run"])||{}).value||0;
                return 0;
              };
              const fmtVal = (id,v) => {
                if(!v) return "---";
                if(id==="overall_xp"||id==="weekly_xp") return v.toLocaleString()+" XP";
                if(id.includes("_1rm"))  return v+" lbs";
                if(id.includes("_reps")) return v+" reps";
                if(id==="run_pace")      return v.toFixed(2)+"/mi";
                if(id==="streak")        return v+" days";
                return String(v);
              };

              // Sort lbData by the active filter
              const sorted = (lbData||[]).slice().sort((a,b) => {
                const av = getRowVal(a, lbFilter);
                const bv = getRowVal(b, lbFilter);
                if(lbFilter==="run_pace") return (av||999) - (bv||999); // lower is better
                return bv - av;
              }).filter(r => getRowVal(r, lbFilter) > 0 || lbFilter==="overall_xp");

              const myRow = sorted.find(r => r.is_me);
              const myRank = myRow ? sorted.indexOf(myRow)+1 : null;
              const myVal = myRow ? getRowVal(myRow, lbFilter) : 0;

              const ALL_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];
              const ALL_COUNTRIES = ["United States","Canada","United Kingdom","Australia","Germany","France","Mexico","Brazil","India","Japan","South Korea","Philippines","Other"];

              // Compact filter chip with dark overlay dropdown
              const MultiDrop = ({label, icon, open, setOpen, options, selected, setSelected, allLabel}) => {
                if(options.length === 0) return null;
                const allSelected = selected.length === options.length;
                const noneSelected = selected.length === 0;
                const chipLabel = allSelected ? (allLabel||"All") : noneSelected ? label : selected.length <= 2 ? selected.join(", ") : selected.length+" selected";
                return React.createElement('div', {style:{position:"relative",flex:1}},
                  // Trigger chip
                  React.createElement('div', {
                    style:{background:open?"rgba(45,42,36,.45)":"rgba(45,42,36,.2)",border:"1px solid "+(open?"rgba(180,172,158,.12)":"rgba(180,172,158,.06)"),borderRadius:8,padding:"7px 10px",fontSize:".6rem",fontWeight:600,color:noneSelected?"#5a5650":"#b4ac9e",cursor:"pointer",display:"flex",alignItems:"center",gap:5,transition:"all .15s",userSelect:"none"},
                    onClick:()=>{setOpen(!open);if(!open){setLbStateDropOpen(false);setLbCountryDropOpen(false);setOpen(true);}}
                  },
                    React.createElement('span',{style:{fontSize:".7rem"}}, icon||"\uD83D\uDD0D"),
                    React.createElement('span',{style:{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}, chipLabel),
                    React.createElement('span',{style:{fontSize:".46rem",color:"#5a5650",flexShrink:0}}, open?"\u25B2":"\u25BC")
                  ),
                  // Dropdown overlay
                  open && React.createElement('div', {style:{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:60,background:"#16160f",border:"1px solid rgba(180,172,158,.1)",borderRadius:10,boxShadow:"0 8px 32px rgba(0,0,0,.6)",overflow:"hidden"}},
                    // Select All / Clear All header
                    React.createElement('div',{style:{display:"flex",justifyContent:"space-between",padding:"8px 10px",borderBottom:"1px solid rgba(180,172,158,.06)",background:"rgba(45,42,36,.15)"}},
                      React.createElement('span',{style:{fontSize:".56rem",color:"#b4ac9e",cursor:"pointer",fontWeight:600},onClick:()=>setSelected([...options])}, "Select All"),
                      React.createElement('span',{style:{fontSize:".56rem",color:"#e05555",cursor:"pointer",fontWeight:600},onClick:()=>setSelected([])}, "Clear All")
                    ),
                    // Scrollable options
                    React.createElement('div',{style:{maxHeight:200,overflowY:"auto",padding:"4px 4px",scrollbarWidth:"thin",scrollbarColor:"rgba(180,172,158,.15) transparent"}},
                      options.map(opt => {
                        const on = selected.includes(opt);
                        return React.createElement('div', {key:opt, style:{display:"flex",alignItems:"center",gap:7,padding:"6px 8px",cursor:"pointer",borderRadius:5,background:on?"rgba(180,172,158,.07)":"transparent",transition:"background .1s",fontSize:".62rem",color:on?"#d4cec4":"#6a645a"},
                          onClick:()=>{ setSelected(on ? selected.filter(s=>s!==opt) : [...selected, opt]); }
                        },
                          React.createElement('span',{style:{width:15,height:15,borderRadius:3,border:"1.5px solid "+(on?"#b4ac9e":"rgba(180,172,158,.12)"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:".52rem",color:"#b4ac9e",flexShrink:0,background:on?"rgba(180,172,158,.08)":"transparent"}}, on?"\u2713":""),
                          opt
                        );
                      })
                    ),
                    // Done button
                    React.createElement('div',{style:{padding:"6px 10px",borderTop:"1px solid rgba(180,172,158,.06)",background:"rgba(45,42,36,.1)"}},
                      React.createElement('div',{style:{textAlign:"center",fontSize:".58rem",color:"#b4ac9e",cursor:"pointer",fontWeight:600,padding:"4px 0"},onClick:()=>setOpen(false)}, "\u2713 Done ("+selected.length+")")
                    )
                  )
                );
              };

              return React.createElement("div", null,
                /* Header */
                React.createElement("div", {className:"techniques-header"},
                  React.createElement("div", {className:"tech-hdr-left"},
                    React.createElement("div", {className:"tech-ornament-line tech-ornament-line-l"}),
                    React.createElement("span", {className:"tech-hdr-title"}, "✦ Leaderboard ✦"),
                    React.createElement("div", {className:"tech-ornament-line tech-ornament-line-r"})
                  )
                ),

                /* Scope toggle: Friends / World */
                React.createElement("div", {style:{display:"flex",gap:4,marginBottom:12,background:"rgba(45,42,36,.25)",borderRadius:8,padding:3}},
                  ["friends","world"].map(scope =>
                    React.createElement("div", {key:scope, style:{
                      flex:1, textAlign:"center", padding:"8px 0", borderRadius:6, fontSize:".66rem", fontWeight:700, cursor:"pointer", transition:"all .15s", letterSpacing:".04em",
                      background: lbScope===scope ? "rgba(45,42,36,.5)" : "transparent",
                      color: lbScope===scope ? "#d4cec4" : "#5a5650",
                      border: lbScope===scope ? "1px solid rgba(180,172,158,.08)" : "1px solid transparent"
                    }, onClick:()=>setLbScope(scope)}, scope==="friends" ? "\uD83D\uDC65 Friends" : "\uD83C\uDF0D World")
                  )
                ),

                /* Filter row: State + Country multi-selects (World only) */
                lbScope==="world" && React.createElement("div", {style:{display:"flex",gap:8,marginBottom:10}},
                  React.createElement(MultiDrop, {label:"States", icon:"\uD83D\uDCCD", allLabel:"All States", open:lbStateDropOpen, setOpen:setLbStateDropOpen, options:ALL_STATES, selected:lbStateFilters, setSelected:setLbStateFilters}),
                  React.createElement(MultiDrop, {label:"Countries", icon:"\uD83C\uDF0D", allLabel:"All Countries", open:lbCountryDropOpen, setOpen:setLbCountryDropOpen, options:ALL_COUNTRIES, selected:lbCountryFilters, setSelected:setLbCountryFilters})
                ),

                /* Category filter dropdown */
                React.createElement("div", {style:{marginBottom:12,position:"relative"}},
                  React.createElement("select", {
                    value: lbFilter,
                    onChange: function(e){ setLbFilter(e.target.value); },
                    style:{width:"100%",appearance:"none",WebkitAppearance:"none",
                           background:"rgba(14,14,12,.95)",
                           border:"1px solid "+tc,
                           color:tc,borderRadius:9,
                           padding:"8px 28px 8px 12px",
                           fontSize:".72rem",fontWeight:"700",cursor:"pointer"}
                  },
                    LB_FILTERS.map(function(f){
                      var ftc=TC[f.type]||"#b4ac9e";
                      return React.createElement("option",{key:f.id,value:f.id,
                        style:{background:"rgba(14,14,12,.95)",color:ftc,fontWeight:lbFilter===f.id?"700":"400"}},
                        f.icon+" "+f.label);
                    })
                  ),
                  React.createElement("span",{style:{position:"absolute",right:12,top:"50%",
                    transform:"translateY(-50%)",color:tc,pointerEvents:"none",fontSize:".65rem"}},"▼")
                ),

                /* Active filter description */
                React.createElement("div", {style:{fontSize:".6rem",color:"#6a6050",marginBottom:12,
                  paddingLeft:4,fontStyle:"italic"}}, af.desc),

                /* Your standing card — Design 3 accent strip */
                myRow && React.createElement("div", {style:{
                  display:"flex",alignItems:"stretch",
                  background:"linear-gradient(145deg,rgba(45,42,36,.3),rgba(32,30,26,.15))",
                  border:"1px solid rgba(180,172,158,.1)",borderRadius:12,
                  marginBottom:14,overflow:"hidden"
                }},
                  /* Class color accent strip */
                  React.createElement("div",{style:{width:5,background:cls.color,flexShrink:0,borderRadius:0}}),
                  React.createElement("div",{style:{flex:1,padding:"11px 14px",display:"flex",alignItems:"center",gap:10}},
                    /* Rank + medal */
                    React.createElement("div",{style:{display:"flex",alignItems:"center",gap:2,width:36,flexShrink:0,justifyContent:"center"}},
                      myRank<=3 && React.createElement("span",{style:{fontSize:".82rem"}}, myRank===1?"\uD83E\uDD47":myRank===2?"\uD83E\uDD48":"\uD83E\uDD49"),
                      React.createElement("span",{style:{fontSize:".82rem",fontWeight:"700",color:myRank===1?"#c49428":myRank===2?"#8a8478":myRank===3?"#7a5230":"#b4ac9e"}}, myRank)
                    ),
                    /* Name + class tag + subtitle */
                    React.createElement("div",{style:{flex:1,minWidth:0}},
                      React.createElement("div",{style:{fontSize:".74rem",fontWeight:"700",color:"#d4cec4",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},
                        getNameForContext("game")||"You",
                        React.createElement("span",{style:{fontSize:".5rem",fontWeight:700,color:cls.color,marginLeft:5}}, cls.icon+" "+cls.name),
                        myPublicId && React.createElement("span",{style:{fontSize:".44rem",color:"#5a5650",marginLeft:4}}, "#"+myPublicId),
                        React.createElement("span",{style:{fontSize:".5rem",color:"#5a5650",marginLeft:4}},"you")
                      ),
                      React.createElement("div",{style:{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}},
                        React.createElement("span",{style:{fontSize:".56rem",color:"#6a645a"}},
                          "Lv."+xpToLevel(profile.xp||0),
                          (profile.state||profile.country) ? " \u00b7 " : "",
                          profile.state ? profile.state : "",
                          profile.country ? (profile.state?", ":"")+(profile.country==="United States"?"US":profile.country==="United Kingdom"?"UK":profile.country==="Canada"?"CA":profile.country==="Australia"?"AU":profile.country==="Germany"?"DE":profile.country==="France"?"FR":profile.country==="Mexico"?"MX":profile.country==="Brazil"?"BR":profile.country==="India"?"IN":profile.country==="Japan"?"JP":profile.country==="South Korea"?"KR":profile.country==="Philippines"?"PH":profile.country||"") : "",
                          profile.gym ? " \u00b7 "+profile.gym : "",
                          (profile.checkInStreak>0) ? " \u00b7 \uD83D\uDD25"+profile.checkInStreak : ""
                        ),
                        lbScope==="friends" && authUser && lbWorldRanks[authUser.id] && React.createElement("span",{style:{fontSize:".46rem",fontWeight:700,padding:"1px 5px",borderRadius:4,background:"rgba(180,172,158,.08)",color:"#8a8478"}}, "\uD83C\uDF0D #"+lbWorldRanks[authUser.id])
                      )
                    ),
                    /* Stat value */
                    React.createElement("div",{style:{textAlign:"right",flexShrink:0}},
                      React.createElement("div",{style:{fontSize:"1rem",fontWeight:"700",color:tc}}, fmtVal(lbFilter,myVal)),
                      React.createElement("div",{style:{fontSize:".5rem",color:"#4a4438",marginTop:1}}, af.label)
                    )
                  )
                ),

                /* Leaderboard list */
                React.createElement("div",{style:{
                  background:"rgba(45,42,36,.1)",
                  border:"1px solid rgba(45,42,36,.2)",
                  borderRadius:12,overflow:"hidden"
                }},
                  /* Column header */
                  React.createElement("div",{style:{
                    display:"flex",alignItems:"center",
                    padding:"7px 12px 7px 18px",
                    borderBottom:"1px solid rgba(180,172,158,.05)",
                    background:"rgba(45,42,36,.12)"
                  }},
                    React.createElement("span",{style:{width:36,fontSize:".52rem",color:"#4a4438",
                      textTransform:"uppercase",letterSpacing:".08em"}},"#"),
                    React.createElement("span",{style:{flex:1,fontSize:".52rem",color:"#4a4438",
                      textTransform:"uppercase",letterSpacing:".08em"}},"Player"),
                    React.createElement("span",{style:{fontSize:".52rem",color:tc,
                      textTransform:"uppercase",letterSpacing:".08em",fontWeight:"700"}},
                      af.icon+" "+af.label)
                  ),

                  /* Loading state */
                  lbLoading && React.createElement("div",{style:{padding:"24px 14px",textAlign:"center"}},
                    React.createElement("div",{style:{width:24,height:24,border:"2px solid rgba(180,172,158,.12)",borderTopColor:"#b4ac9e",borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 8px"}}),
                    React.createElement("div",{style:{fontSize:".62rem",color:"#5a5650"}}, "Loading rankings\u2026")
                  ),

                  /* Player rows — Design 3: accent strip + medals */
                  !lbLoading && sorted.map(function(row, idx) {
                    var rank = idx + 1;
                    var val = getRowVal(row, lbFilter);
                    var rowCls = row.chosen_class ? (CLASSES[row.chosen_class]||CLASSES.warrior) : CLASSES.warrior;
                    var isMe = row.is_me;
                    var rankColor = rank===1?"#c49428":rank===2?"#8a8478":rank===3?"#7a5230":"#4a4438";
                    var medal = rank===1?"\uD83E\uDD47":rank===2?"\uD83E\uDD48":rank===3?"\uD83E\uDD49":null;
                    var worldRank = lbScope==="friends" ? lbWorldRanks[row.user_id] : null;
                    var countryCode = row.country==="United States"?"US":row.country==="United Kingdom"?"UK":row.country==="Canada"?"CA":row.country==="Australia"?"AU":row.country==="Germany"?"DE":row.country==="France"?"FR":row.country==="Mexico"?"MX":row.country==="Brazil"?"BR":row.country==="India"?"IN":row.country==="Japan"?"JP":row.country==="South Korea"?"KR":row.country==="Philippines"?"PH":row.country||"";
                    var loc = (row.state||"") + (row.state&&countryCode?", ":"") + countryCode;
                    return React.createElement("div",{key:row.user_id, style:{
                      display:"flex",alignItems:"stretch",
                      background:isMe?"rgba(45,42,36,.25)":"linear-gradient(145deg,rgba(45,42,36,.18),rgba(32,30,26,.08))",
                      borderBottom:"1px solid rgba(45,42,36,.12)"
                    }},
                      /* Class color accent strip */
                      React.createElement("div",{style:{width:4,background:rowCls.color,flexShrink:0}}),
                      /* Inner content */
                      React.createElement("div",{style:{flex:1,padding:"9px 12px",display:"flex",alignItems:"center",gap:8}},
                        /* Rank + medal */
                        React.createElement("div",{style:{display:"flex",alignItems:"center",gap:1,width:32,flexShrink:0,justifyContent:"center"}},
                          medal && React.createElement("span",{style:{fontSize:".78rem"}}, medal),
                          React.createElement("span",{style:{fontSize:".72rem",fontWeight:"700",color:rankColor,fontFamily:"'Inter',sans-serif"}}, rank)
                        ),
                        /* Name + class tag + subtitle */
                        React.createElement("div",{style:{flex:1,minWidth:0}},
                          React.createElement("div",{style:{fontSize:".72rem",fontWeight:"700",color:isMe?"#d4cec4":"#b4ac9e",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},
                            getRowName(row),
                            React.createElement("span",{style:{fontSize:".48rem",fontWeight:700,color:rowCls.color,marginLeft:5}}, rowCls.icon+" "+rowCls.name),
                            row.public_id && React.createElement("span",{style:{fontSize:".44rem",color:"#5a5650",marginLeft:4}}, "#"+row.public_id),
                            isMe && React.createElement("span",{style:{fontSize:".48rem",color:"#5a5650",marginLeft:4}},"you")
                          ),
                          React.createElement("div",{style:{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}},
                            React.createElement("span",{style:{fontSize:".52rem",color:"#6a645a"}},
                              "Lv."+row.level,
                              loc ? " \u00b7 "+loc : "",
                              row.gym ? " \u00b7 "+row.gym : "",
                              (row.streak>0) ? " \u00b7 \uD83D\uDD25"+row.streak : ""
                            ),
                            worldRank && React.createElement("span",{style:{fontSize:".46rem",fontWeight:700,padding:"1px 5px",borderRadius:4,background:"rgba(180,172,158,.08)",color:"#8a8478"}}, "\uD83C\uDF0D #"+worldRank)
                          )
                        ),
                        /* Stat value */
                        React.createElement("div",{style:{textAlign:"right",flexShrink:0,paddingLeft:6}},
                          React.createElement("div",{style:{fontSize:".78rem",fontWeight:"700",color:val?tc:"#3a3834",fontFamily:"'Inter',sans-serif"}}, fmtVal(lbFilter,val)),
                          React.createElement("div",{style:{fontSize:".44rem",color:"#4a4438",marginTop:1}}, af.label)
                        )
                      )
                    );
                  }),

                  /* Empty state */
                  !lbLoading && sorted.length === 0 && React.createElement("div",{style:{
                    padding:"24px 14px",textAlign:"center",
                    fontSize:".66rem",color:"#5a5650",fontStyle:"italic"
                  }}, lbScope==="friends" ? "No friends to rank yet. Add friends in the Guild tab!" : "No warriors found matching your filters."),

                  /* Player count footer */
                  !lbLoading && sorted.length > 0 && React.createElement("div",{style:{
                    padding:"8px 14px",textAlign:"center",
                    fontSize:".56rem",color:"#3a3834",fontStyle:"italic",
                    borderTop:"1px solid rgba(45,42,36,.12)"
                  }}, sorted.length + " warrior" + (sorted.length!==1?"s":"") + " ranked" + (lbStateFilters.length||lbCountryFilters.length ? " (filtered)" : ""))
                )
              );
            })()
            /* ── QUESTS TAB ──────────────────────── */
            , activeTab==="quests" && (
              React.createElement(React.Fragment, null
                , React.createElement('div', {className:"rpg-sec-header"}, React.createElement('div', {className:"rpg-sec-line rpg-sec-line-l"}), React.createElement('span', {className:"rpg-sec-title"}, "✦ Deeds & Quests ✦"), React.createElement('div', {className:"rpg-sec-line rpg-sec-line-r"}))
                /* Category filter */
                , React.createElement('div', { className: "quest-cats"}
                  , ["All","Cardio","Strength","Flexibility","Consistency","Competition"].map(cat=>(
                    React.createElement('div', { key: cat, className: `quest-cat-btn ${questCat===cat?"on":""}`, onClick: ()=>setQuestCat(cat)}, cat)
                  ))
                )

                /* Pending claims first */
                , QUESTS.filter(q=>{
                  const qs=_optionalChain([profile, 'access', _124 => _124.quests, 'optionalAccess', _125 => _125[q.id]]);
                  return _optionalChain([qs, 'optionalAccess', _126 => _126.completed])&&!_optionalChain([qs, 'optionalAccess', _127 => _127.claimed])&&(questCat==="All"||q.cat===questCat);
                }).map(q=>{
                  const qs=_optionalChain([profile, 'access', _128 => _128.quests, 'optionalAccess', _129 => _129[q.id]])||{};
                  return (
                    React.createElement('div', { key: q.id, className: "quest-card complete"}
                      , React.createElement('div', { className: "quest-top"}
                        , React.createElement('div', { className: "quest-icon-wrap"}, q.icon)
                        , React.createElement('div', { style: {flex:1}}
                          , React.createElement('div', { className: "quest-name"}, q.name)
                          , React.createElement('div', { className: "quest-desc"}, q.desc)
                          , React.createElement('div', { className: "quest-reward"}, "⚡ +" , q.xp.toLocaleString(), " XP reward"  )
                        )
                        , React.createElement('button', { className: "btn btn-gold btn-sm"  , onClick: ()=>claimQuestReward(q.id)}, "Claim!")
                      )
                    )
                  );
                })

                /* All quests */
                , QUESTS.filter(q=>questCat==="All"||q.cat===questCat).map(q=>{
                  const qs=_optionalChain([profile, 'access', _130 => _130.quests, 'optionalAccess', _131 => _131[q.id]])||{};
                  if(qs.completed&&!qs.claimed) return null; // shown above
                  const isClaimed=qs.claimed;
                  const isDone=qs.completed;
                  // Progress for auto quests
                  let progressText=null;
                  if(!isDone&&_optionalChain([q, 'access', _132 => _132.auto, 'optionalAccess', _133 => _133.exId])){ const cnt=profile.log.filter(e=>_optionalChain([EXERCISES, 'access', _134 => _134.find, 'call', _135 => _135(ex=>ex.name===e.exercise), 'optionalAccess', _136 => _136.id])===q.auto.exId).length; progressText=`${cnt} / ${q.auto.count}`; }
                  if(!isDone&&_optionalChain([q, 'access', _137 => _137.auto, 'optionalAccess', _138 => _138.total])){ progressText=`${profile.log.length} / ${q.auto.total} sessions`; }
                  if(!isDone&&q.streak){ progressText=`${profile.checkInStreak} / ${q.streak} day streak`; }
                  return (
                    React.createElement('div', { key: q.id, className: `quest-card ${isDone?"complete":""} ${isClaimed?"claimed":""}`}
                      , React.createElement('div', { className: "quest-top"}
                        , React.createElement('div', { className: "quest-icon-wrap"}, q.icon)
                        , React.createElement('div', { style: {flex:1}}
                          , React.createElement('div', { className: "quest-name"}, q.name)
                          , React.createElement('div', { className: "quest-desc"}, q.desc)
                          , progressText&&!isDone&&React.createElement('div', { style: {fontSize:".65rem",color:"#5a5650",marginTop:4}}, "Progress: " , progressText)
                          , React.createElement('div', { className: "quest-reward"}, isClaimed?"✓ Claimed":"⚡", " " , isClaimed?"":"+", "  "  , q.xp.toLocaleString(), " XP" )
                        )
                        , React.createElement('div', { className: "quest-status"}
                          , isClaimed?React.createElement('div', { className: "quest-check claimed-check" }, "✓"):
                           isDone?React.createElement('div', { className: "quest-check done" }, "!"):
                           q.manual?React.createElement('button', { className: "btn btn-ghost btn-xs"  , onClick: ()=>claimManualQuest(q.id)}, "Done?"):
                           React.createElement('div', { className: "quest-check"}, "○")
                        )
                      )
                    )
                  );
                })
              )
            )

            /* ── HISTORY TAB ─────────────────────── */
            , activeTab==="history" && (()=>{
              const metric = isMetric(profile.units);
              // Attach real array index to each entry so edits/deletes are index-stable
              const logWithIdx = profile.log.map((e,i)=>({...e,_idx:i}));

              // ── helper: single exercise row ──────────────────────────────
              function EntryRow({e, showSource=false, isSuperset=false}) {
                const exData = allExById[e.exId];
                const isC = exData ? exData.category==="cardio" : false;
                const isF = exData ? exData.category==="flexibility" : false;
                const exMgColor = getMuscleColor(exData && exData.muscleGroup);
                return (
                  React.createElement('div', { className: "h-entry", style: {"--mg-color":exMgColor}}
                    , React.createElement('span', { className: "h-icon"}, e.icon)
                    , React.createElement('div', { style: {flex:1,minWidth:0}}
                      , React.createElement('div', { className: "h-name"}
                        , e.exercise
                        , isSuperset && React.createElement('span', { style: {marginLeft:5,fontSize:".48rem",color:"#b4ac9e",background:"rgba(180,172,158,.1)",padding:"1px 5px",borderRadius:3,fontWeight:600,verticalAlign:"middle"} }, "Superset")
                        , showSource && e.sourcePlanName &&
                          React.createElement('span', { className: "log-source-badge plan" }, "📋 " , e.sourcePlanName)
                        , showSource && e.sourceWorkoutName && e.sourceWorkoutType!=="oneoff" &&
                          React.createElement('span', { className: "log-source-badge workout" }, "💪 " , e.sourceWorkoutName)
                        , e.sourceWorkoutType==="oneoff" && e.sourceWorkoutName &&
                          React.createElement('span', { style: {display:"inline-flex",alignItems:"center",gap:3,fontSize:".56rem",padding:"1px 6px",borderRadius:4,marginLeft:5,background:"rgba(230,126,34,.12)",color:"#e67e22",border:"1px solid rgba(230,126,34,.3)",verticalAlign:"middle"}}, "⚡ " , e.sourceWorkoutName)
                      )
                      , React.createElement('div', { className: "h-meta"}
                        , e.sets, "×", e.reps, isC||isF?" min":""
                        , e.distanceMi?React.createElement('span', { style: {color:"#3498db",marginLeft:5}}, metric?miToKm(e.distanceMi)+" km":e.distanceMi+" mi"):""
                        , e.weightLbs?React.createElement('span', { style: {color:"#8a8478",marginLeft:5}}, metric?lbsToKg(e.weightLbs)+" kg":e.weightLbs+" lbs", e.weightPct&&e.weightPct!==100?React.createElement('span', { style: {color:"#e67e22"}}, " @" , e.weightPct, "%"):""):""
                        , e.hrZone?React.createElement('span', { style: {marginLeft:5,color:_optionalChain([HR_ZONES, 'access', _139 => _139[e.hrZone-1], 'optionalAccess', _140 => _140.color])}}, "Z", e.hrZone):""
                        , React.createElement('span', { style: {marginLeft:5,color:"#6a645a"}}, e.time, " · "  , e.date)
                      )
                    )
                    , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:5,flexShrink:0}}
                      , React.createElement('div', { className: "h-xp"}, "+", e.xp, " XP" )
                      , React.createElement('button', { className: "btn btn-ghost btn-xs"  , title: "Edit entry" , onClick: ()=>openLogEdit(e._idx)}, "✎")
                      , React.createElement('button', { className: "btn btn-danger btn-xs"  , title: "Delete entry" , style: {padding:"2px 5px"}, onClick: ()=>deleteLogEntryByIdx(e._idx)}, "✕")
                    )
                  )
                );
              }

              // ── EXERCISES sub-tab ────────────────────────────────────────
              function ExercisesTab() {
                const groups = {};
                logWithIdx.forEach(e=>{
                  const dk = e.dateKey||e.date||"Unknown";
                  if(!groups[dk]) groups[dk]=[];
                  groups[dk].push(e);
                });
                const sortedKeys = Object.keys(groups).sort((a,b)=>b.localeCompare(a));
                return (
                  React.createElement(React.Fragment, null
                    , logWithIdx.length===0&&React.createElement('div', { className: "empty"}, "No battles logged yet."   , React.createElement('br', null), "Begin your training."  )
                    , sortedKeys.map(dk=>{
                      const entries=groups[dk];
                      const groupXP=entries.reduce((s,e)=>s+e.xp,0);
                      const displayDate=_optionalChain([entries, 'access', _141 => _141[0], 'optionalAccess', _142 => _142.date])||dk;
                      const collapsed = !openLogGroups["ex_"+dk]; // default collapsed
                      // Dominant muscle-group color = first valid entry's muscle group
                      const grpFirstEx = entries.map(en=>allExById[en.exId]).find(Boolean);
                      const grpMgColor = getMuscleColor(grpFirstEx && grpFirstEx.muscleGroup);
                      return (
                        React.createElement('div', { key: dk, className: "log-group-card", style: {"--mg-color":grpMgColor}}
                          , React.createElement('div', { className: `log-group-hdr ${collapsed?"collapsed":""}`,
                            onClick: ()=>toggleLogGroup("ex_"+dk)}
                            , React.createElement('span', { className: "log-group-icon"}, "📅")
                            , React.createElement('div', { style: {flex:1,minWidth:0}}
                              , React.createElement('div', { className: "log-group-name"}, displayDate)
                              , React.createElement('div', { className: "log-group-meta"}, entries.length, " exercise" , entries.length!==1?"s":"", " · ⚡ "   , groupXP.toLocaleString(), " XP" )
                            )
                            , !collapsed&&(
                              React.createElement('div', { style: {display:"flex",gap:5,marginRight:6}, onClick: e=>e.stopPropagation()}
                                , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {fontSize:".55rem",whiteSpace:"nowrap"},
                                  onClick: ()=>openSaveWorkoutWizard(entries, displayDate)}, "💪 Save"

                                )
                                , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {fontSize:".55rem",whiteSpace:"nowrap"},
                                  onClick: ()=>openSavePlanWizard(entries, displayDate)}, "📋 Plan"

                                )
                              )
                            )
                            , React.createElement('svg', { width: "13", height: "13", viewBox: "0 0 14 14"   , fill: "none", xmlns: "http://www.w3.org/2000/svg",
                              style: {flexShrink:0,transition:"transform .22s ease",transform:collapsed?"rotate(0deg)":"rotate(180deg)"}}
                              , React.createElement('defs', null, React.createElement('linearGradient', { id: "cg5e", x1: "0", y1: "0", x2: "0", y2: "1"}, React.createElement('stop', { offset: "0%", stopColor: "#b4ac9e"}), React.createElement('stop', { offset: "100%", stopColor: "#7a4e1a"})))
                              , React.createElement('polyline', { points: "3,5 7,9 11,5"  , stroke: "url(#cg5e)", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round"})
                            )
                          )
                          , !collapsed&&(
                            React.createElement('div', { className: "log-group-body"}
                              , entries.map((e,i)=>React.createElement(EntryRow, { key: i, e: e, showSource: true}))
                            )
                          )
                        )
                      );
                    })
                  )
                );
              }

              // ── WORKOUTS sub-tab ─────────────────────────────────────────
              function WorkoutsTab() {
                const grouped = {};
                logWithIdx.forEach(e=>{
                  if(!e.sourceWorkoutId) return;
                  const gid = e.sourceGroupId||e.sourceWorkoutId;
                  if(!grouped[gid]) grouped[gid]=[];
                  grouped[gid].push(e);
                });
                const sortedGroups = Object.values(grouped).sort((a,b)=>{
                  const da=_optionalChain([a, 'access', _143 => _143[0], 'optionalAccess', _144 => _144.dateKey])||""; const db=_optionalChain([b, 'access', _145 => _145[0], 'optionalAccess', _146 => _146.dateKey])||"";
                  return db.localeCompare(da);
                });
                const reusableGroups = sortedGroups.filter(g=>_optionalChain([g, 'access', _147 => _147[0], 'optionalAccess', _148 => _148.sourceWorkoutType])!=="oneoff");
                const oneoffGroups   = sortedGroups.filter(g=>_optionalChain([g, 'access', _149 => _149[0], 'optionalAccess', _150 => _150.sourceWorkoutType])==="oneoff");

                function GroupCard({entries, gi}) {
                  const first=entries[0];
                  const groupXP=entries.reduce((s,e)=>s+e.xp,0);
                  const gid=first.sourceGroupId||first.sourceWorkoutId||String(gi);
                  const collapsed=!openLogGroups[gid];
                  const isOneOff=first.sourceWorkoutType==="oneoff";
                  const grpFirstEx = entries.map(en=>allExById[en.exId]).find(Boolean);
                  const grpMgColor = getMuscleColor(grpFirstEx && grpFirstEx.muscleGroup);
                  return (
                    React.createElement('div', { className: "log-group-card", style: {"--mg-color":grpMgColor}}
                      , React.createElement('div', { className: `log-group-hdr ${collapsed?"collapsed":""}`, onClick: ()=>toggleLogGroup(gid)}
                        , React.createElement('span', { className: "log-group-icon"}, first.sourceWorkoutIcon||"💪")
                        , React.createElement('div', { style: {flex:1,minWidth:0}}
                          , React.createElement('div', { className: "log-group-name"}
                            , first.sourceWorkoutName
                            , isOneOff&&React.createElement('span', { style: {marginLeft:6,fontSize:".55rem",background:"rgba(230,126,34,.15)",color:"#e67e22",border:"1px solid rgba(230,126,34,.3)",borderRadius:4,padding:"1px 5px",verticalAlign:"middle"}}, "one-off")
                          )
                          , React.createElement('div', { className: "log-group-meta"}, "📅 " , first.date, " · "  , entries.length, " exercise" , entries.length!==1?"s":"")
                        )
                        , React.createElement('div', { className: "log-group-xp"}, "⚡ " , groupXP.toLocaleString(), " XP" )
                        , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {fontSize:".6rem",marginRight:2,flexShrink:0}, title: "Edit completed workout"  ,
                          onClick: e=>{e.stopPropagation();
                            setRetroEditModal({
                              groupId:gid,
                              entries:[...entries],
                              dateKey:first.dateKey,
                              sourceType:isOneOff?"oneoff":"reusable",
                              sourceName:first.sourceWorkoutName,
                              sourceIcon:first.sourceWorkoutIcon||"💪",
                              sourceId:first.sourceWorkoutId,
                            });
                          }}, "\u270E")
                        , React.createElement('button', { className: "btn btn-ghost btn-xs", style: {fontSize:".6rem",marginRight:2,flexShrink:0,color:"#e74c3c"}, title: "Delete all entries",
                          onClick: e=>{e.stopPropagation();
                            const totalXP = entries.reduce((s,en)=>s+en.xp,0);
                            if(!window.confirm(`Delete entire "${first.sourceWorkoutName}" session? (${entries.length} exercises, -${totalXP.toLocaleString()} XP)`)) return;
                            const idxSet = new Set(entries.map(en=>en._idx));
                            const deletedEntries = entries.map(en=>({id:uid(),type:"logEntry",item:{...en},deletedAt:new Date().toISOString()}));
                            const newLog = profile.log.filter((_,i)=>!idxSet.has(i));
                            setProfile(p=>({...p, xp:Math.max(0,p.xp-totalXP), log:newLog, exercisePBs:calcExercisePBs(newLog), deletedItems:[...(p.deletedItems||[]),...deletedEntries]}));
                            showToast("Workout session deleted. -"+totalXP.toLocaleString()+" XP");
                          }}, "\uD83D\uDDD1")
                        , React.createElement('svg', { width: "13", height: "13", viewBox: "0 0 14 14"   , fill: "none", style: {flexShrink:0,transition:"transform .22s ease",transform:collapsed?"rotate(0deg)":"rotate(180deg)"}}
                          , React.createElement('defs', null, React.createElement('linearGradient', { id: "cg5", x1: "0", y1: "0", x2: "0", y2: "1"}, React.createElement('stop', { offset: "0%", stopColor: "#b4ac9e"}), React.createElement('stop', { offset: "100%", stopColor: "#7a4e1a"})))
                          , React.createElement('polyline', { points: "3,5 7,9 11,5"  , stroke: "url(#cg5)", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round"})
                        )
                      )
                      , !collapsed&&(
                        React.createElement('div', { className: "log-group-body"}
                          , (()=>{
                            /* Detect supersets from source workout */
                            const srcWo = (profile.workouts||[]).find(w=>w.id===first.sourceWorkoutId);
                            const srcPlan = !srcWo && (profile.plans||[]).find(p=>p.id===first.sourcePlanId);
                            const srcExs = srcWo ? srcWo.exercises : srcPlan ? (srcPlan.days||[]).flatMap(d=>d.exercises) : [];
                            const ssSet = new Set();
                            srcExs.forEach((ex,i)=>{
                              if(ex.supersetWith!=null){ ssSet.add(ex.exId); const partner=srcExs[ex.supersetWith]; if(partner) ssSet.add(partner.exId); }
                            });
                            return entries.map((e,i)=>React.createElement(EntryRow, { key: i, e: e, showSource: false, isSuperset: ssSet.has(e.exId)}));
                          })()
                        )
                      )
                    )
                  );
                }

                if(sortedGroups.length===0) return React.createElement('div', { className: "empty"}, "No workout completions logged yet."    , React.createElement('br', null), "Complete a workout to see it here."      );
                return (
                  React.createElement(React.Fragment, null
                    , reusableGroups.length>0&&React.createElement(React.Fragment, null
                      , React.createElement('div', { className: "sec", style: {marginBottom:8}}, "💪 Re-Usable Workouts"  )
                      , reusableGroups.map((entries,gi)=>React.createElement(GroupCard, { key: gi, entries: entries, gi: gi}))
                    )
                    , oneoffGroups.length>0&&React.createElement(React.Fragment, null
                      , React.createElement('div', { className: "sec", style: {marginBottom:8,marginTop:reusableGroups.length>0?12:0}}, "⚡ One-Off Workouts"  )
                      , oneoffGroups.map((entries,gi)=>React.createElement(GroupCard, { key: gi, entries: entries, gi: gi}))
                    )
                  )
                );
              }

              // ── PLANS sub-tab ────────────────────────────────────────────
              function PlansTab() {
                // Only include entries that belong to a plan
                const grouped = {};
                logWithIdx.forEach(e=>{
                  if(!e.sourcePlanId) return; // exclude standalone — they belong in Exercises tab
                  const gid = e.sourceGroupId||e.sourcePlanId;
                  if(!grouped[gid]) grouped[gid]=[];
                  grouped[gid].push(e);
                });
                const sortedGroups = Object.values(grouped).sort((a,b)=>{
                  const da = _optionalChain([a, 'access', _151 => _151[0], 'optionalAccess', _152 => _152.dateKey])||""; const db = _optionalChain([b, 'access', _153 => _153[0], 'optionalAccess', _154 => _154.dateKey])||"";
                  return db.localeCompare(da);
                });
                if(sortedGroups.length===0) return React.createElement('div', { className: "empty"}, "No plan completions logged yet."    , React.createElement('br', null), "Complete a plan to see it here."      );
                return (
                  React.createElement(React.Fragment, null
                    , sortedGroups.map((entries,gi)=>{
                      const first = entries[0];
                      const groupXP = entries.reduce((s,e)=>s+e.xp,0);
                      const gid = first.sourceGroupId||first.sourcePlanId||String(gi);
                      const collapsed = !openLogGroups[gid]; // default collapsed, open when toggled
                      const grpFirstEx = entries.map(en=>allExById[en.exId]).find(Boolean);
                      const grpMgColor = getMuscleColor(grpFirstEx && grpFirstEx.muscleGroup);
                      return (
                        React.createElement('div', { key: gid, className: "log-group-card", style: {"--mg-color":grpMgColor}}
                          , React.createElement('div', { className: `log-group-hdr ${collapsed?"collapsed":""}`, onClick: ()=>toggleLogGroup(gid)}
                            , React.createElement('span', { className: "log-group-icon"}, first.sourcePlanIcon||"📋")
                            , React.createElement('div', { style: {flex:1,minWidth:0}}
                              , React.createElement('div', { className: "log-group-name"}, first.sourcePlanName)
                              , React.createElement('div', { className: "log-group-meta"}, "📅 " , first.date, " · "  , entries.length, " exercise" , entries.length!==1?"s":"")
                            )
                            , React.createElement('div', { className: "log-group-xp"}, "⚡ " , groupXP.toLocaleString(), " XP" )
                            , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {fontSize:".6rem",marginRight:2,flexShrink:0}, title: "Edit completed plan"  ,
                              onClick: e=>{e.stopPropagation();
                                setRetroEditModal({
                                  groupId:gid,
                                  entries:[...entries],
                                  dateKey:first.dateKey,
                                  sourceType:"plan",
                                  sourceName:first.sourcePlanName,
                                  sourceIcon:first.sourcePlanIcon||"📋",
                                  sourceId:first.sourcePlanId,
                                });
                              }}, "\u270E")
                            , React.createElement('button', { className: "btn btn-ghost btn-xs", style: {fontSize:".6rem",marginRight:2,flexShrink:0,color:"#e74c3c"}, title: "Delete all entries",
                              onClick: e=>{e.stopPropagation();
                                const totalXP = entries.reduce((s,en)=>s+en.xp,0);
                                if(!window.confirm(`Delete entire "${first.sourcePlanName}" session? (${entries.length} exercises, -${totalXP.toLocaleString()} XP)`)) return;
                                const idxSet = new Set(entries.map(en=>en._idx));
                                const deletedEntries = entries.map(en=>({id:uid(),type:"logEntry",item:{...en},deletedAt:new Date().toISOString()}));
                                const newLog = profile.log.filter((_,i)=>!idxSet.has(i));
                                setProfile(p=>({...p, xp:Math.max(0,p.xp-totalXP), log:newLog, exercisePBs:calcExercisePBs(newLog), deletedItems:[...(p.deletedItems||[]),...deletedEntries]}));
                                showToast("Plan session deleted. -"+totalXP.toLocaleString()+" XP");
                              }}, "\uD83D\uDDD1")
                            , React.createElement('svg', { width: "13", height: "13", viewBox: "0 0 14 14"   , fill: "none", xmlns: "http://www.w3.org/2000/svg", style: {flexShrink:0,transition:"transform .22s ease",transform:collapsed?"rotate(0deg)":"rotate(180deg)"}}
                                          , React.createElement('defs', null, React.createElement('linearGradient', { id: "cg5", x1: "0", y1: "0", x2: "0", y2: "1"}, React.createElement('stop', { offset: "0%", stopColor: "#b4ac9e"}), React.createElement('stop', { offset: "100%", stopColor: "#7a4e1a"})))
                                          , React.createElement('polyline', { points: "3,5 7,9 11,5"  , stroke: "url(#cg5)", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round"})
                                        )
                          )
                          , !collapsed&&(
                            React.createElement('div', { className: "log-group-body"}
                              , entries.map((e,i)=>React.createElement(EntryRow, { key: i, e: e, showSource: false}))
                            )
                          )
                        )
                      );
                    })
                  )
                );
              }

              return (
                React.createElement(React.Fragment, null
                  , React.createElement('div', { className: "sec"}, "Battle Record — "   , profile.log.length, " sessions · "   , profile.xp.toLocaleString(), " total XP"  )
                  , React.createElement('div', { className: "log-subtab-bar"}
                    , [["exercises","⚔️ Exercises"],["workouts","💪 Workouts"],["plans","📋 Plans"],["trends","📊 Trends"],["deleted","🗑 Deleted"]].map(([t,l])=>(
                      React.createElement('button', { key: t, className: `log-subtab-btn ${logSubTab===t?"on":""}`,
                        onClick: ()=>setLogSubTab(t)}, l
                        , t==="deleted"&&(profile.deletedItems||[]).filter(d=>((new Date()-new Date(d.deletedAt))/(1000*60*60*24))<7).length>0&&React.createElement('span', { style: {marginLeft:4,background:"#6a645a",color:"#fff",borderRadius:"50%",width:14,height:14,fontSize:".45rem",display:"inline-flex",alignItems:"center",justifyContent:"center"}}, (profile.deletedItems||[]).filter(d=>((new Date()-new Date(d.deletedAt))/(1000*60*60*24))<7).length)
                      )
                    ))
                  )
                  , logSubTab==="exercises"&&React.createElement(ExercisesTab,null)
                  , logSubTab==="workouts"&&React.createElement(WorkoutsTab,null)
                  , logSubTab==="plans"&&React.createElement(PlansTab,null)
                  , logSubTab==="trends"&&React.createElement(TrendsTab,{log:profile.log,allExById:allExById,clsColor:cls.color,units:profile.units,chartOrder:profile.chartOrder||DEFAULT_CHART_ORDER,onChartOrderChange:(order)=>setProfile(p=>({...p,chartOrder:order})),workouts:profile.workouts,plans:profile.plans})
                  , logSubTab==="deleted"&&(()=>{
                    const now = new Date();
                    const active = (profile.deletedItems||[])
                      .filter(d=>((now-new Date(d.deletedAt))/(1000*60*60*24))<7)
                      .sort((a,b)=>new Date(b.deletedAt)-new Date(a.deletedAt));
                    const daysLeft = d => Math.max(0, 7-Math.floor((now-new Date(d.deletedAt))/(1000*60*60*24)));
                    function restoreItem(entry) {
                      const newBin = (profile.deletedItems||[]).filter(d=>d.id!==entry.id);
                      if(entry.type==="workout") {
                        setProfile(p=>({...p, workouts:[...(p.workouts||[]),entry.item], deletedItems:newBin}));
                        showToast(`\uD83D\uDCAA "${entry.item.name}" restored to Workouts!`);
                      } else if(entry.type==="logEntry") {
                        const restored = entry.item;
                        setProfile(p=>({...p, xp:(p.xp||0)+(restored.xp||0), log:[...p.log, restored], deletedItems:newBin, exercisePBs:calcExercisePBs([...p.log, restored])}));
                        showToast(`\u2694\uFE0F "${restored.exercise}" restored! +${restored.xp} XP`);
                      } else {
                        setProfile(p=>({...p, plans:[...(p.plans||[]),entry.item], deletedItems:newBin}));
                        showToast(`\uD83D\uDCCB "${entry.item.name}" restored to Plans!`);
                      }
                    }
                    function permanentDelete(entry) {
                      setProfile(p=>({...p, deletedItems:(p.deletedItems||[]).filter(d=>d.id!==entry.id)}));
                      showToast("Permanently deleted.");
                    }
                    return (
                      React.createElement('div', null
                        , React.createElement('div', { style: {fontSize:".65rem",color:"#8a8478",marginBottom:12,lineHeight:1.5}}, "Deleted items are kept for "
                               , React.createElement('strong', { style: {color:"#d4cec4"}}, "7 days" ), " before being permanently removed. Tap Restore to recover them."
                        )
                        , active.length===0&&React.createElement('div', { className: "empty"}, "No recently deleted items."   , React.createElement('br', null), "Deleted exercises, workouts and plans will appear here."      )
                        , active.map(entry=>{
                          const dl = daysLeft(entry);
                          const urgentColor = dl<=1?"#e74c3c":dl<=2?"#e67e22":"#8a8478";
                          const itemName = entry.type==="logEntry" ? (entry.item.exercise||"Exercise") : (entry.item.name||"Item");
                          const itemIcon = entry.type==="logEntry" ? (entry.item.icon||"\u2694\uFE0F") : (entry.item.icon||"\uD83D\uDCE6");
                          const typeLabel = entry.type==="logEntry" ? "exercise" : entry.type;
                          const xpNote = entry.type==="logEntry" && entry.item.xp ? " \u00b7 "+entry.item.xp+" XP" : "";
                          return (
                            React.createElement('div', { key: entry.id, style: {background:"rgba(45,42,36,.12)",border:"1px solid rgba(45,42,36,.2)",borderRadius:10,padding:"11px 13px",marginBottom:8,display:"flex",alignItems:"center",gap:10}}
                              , React.createElement('div', { style: {fontSize:"1.2rem",flexShrink:0}}, itemIcon)
                              , React.createElement('div', { style: {flex:1,minWidth:0}}
                                , React.createElement('div', { style: {fontSize:".78rem",color:"#d4cec4",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}, itemName)
                                , React.createElement('div', { style: {fontSize:".6rem",marginTop:2,display:"flex",gap:8}}
                                  , React.createElement('span', { style: {color:"#8a8478",textTransform:"capitalize"}}, typeLabel, xpNote)
                                  , React.createElement('span', { style: {color:urgentColor}}, dl===0?"Expires today":dl===1?"1 day left":`${dl} days left`)
                                )
                              )
                              , React.createElement('button', { className: "btn btn-gold btn-xs"  , style: {flexShrink:0,fontSize:".65rem"}, onClick: ()=>restoreItem(entry)}, "↩ Restore" )
                              , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {flexShrink:0,fontSize:".6rem",color:"#e74c3c",borderColor:"rgba(231,76,60,.25)"}, onClick: ()=>permanentDelete(entry)}, "✕")
                            )
                          );
                        })
                      )
                    );
                  })()

                )
              );
            })()

            , activeTab==="social"&&(()=>{
                    const levelFor = xp => { const t=buildXPTable(100); let lv=1; for(let i=1;i<t.length;i++){if(xp>=t[i])lv=i+1;else break;} return lv; };
                    const recentWorkout = log => {
                      if(!log||!log.length) return null;
                      const entry = log[0];
                      return entry.sourcePlanName
                        ? `${entry.sourcePlanIcon||"📋"} ${entry.sourcePlanName}`
                        : `${entry.icon||"💪"} ${entry.exercise}`;
                    };
                    return (
                      React.createElement('div', null
                        /* Friend search */
                        , React.createElement('div', {className:"rpg-sec-header"}, React.createElement('div', {className:"rpg-sec-line rpg-sec-line-l"}), React.createElement('span', {className:"rpg-sec-title"}, "✦ Guild Search ✦"), React.createElement('div', {className:"rpg-sec-line rpg-sec-line-r"}))
                        , socialMsg&&(
                          React.createElement('div', { style: {fontSize:".75rem",color:socialMsg.ok===true?"#2ecc71":socialMsg.ok===false?"#e74c3c":"#b4ac9e",marginBottom:10,padding:"8px 12px",background:socialMsg.ok===true?"rgba(46,204,113,.06)":socialMsg.ok===false?"rgba(231,76,60,.06)":"rgba(45,42,36,.16)",border:`1px solid ${socialMsg.ok===true?"rgba(46,204,113,.2)":socialMsg.ok===false?"rgba(231,76,60,.2)":"rgba(45,42,36,.3)"}`,borderRadius:8,textAlign:"center"}}
                            , socialMsg.text
                          )
                        )
                        , React.createElement('div', { style: {display:"flex",gap:7,marginBottom:8}}
                          , React.createElement('input', { className: "inp", style: {flex:1,padding:"7px 11px",fontSize:".82rem"},
                            placeholder: "Email or Account ID (#A7XK9M)\u2026"   ,
                            value: friendSearch,
                            onChange: e=>{setFriendSearch(e.target.value);setFriendSearchResult(null);setSocialMsg(null);},
                            onKeyDown: e=>{if(e.key==="Enter")searchFriendByEmail();}})
                          , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flexShrink:0,opacity:friendSearchLoading||!friendSearch.trim()?0.4:1},
                            disabled: friendSearchLoading||!friendSearch.trim(),
                            onClick: searchFriendByEmail}
                            , friendSearchLoading?"…":"Search"
                          )
                        )
                        /* Search result */
                        , socialMsg===null&&friendSearchResult&&(
                          React.createElement('div', { style: {background:"rgba(45,42,36,.18)",border:"1px solid rgba(180,172,158,.06)",borderRadius:10,padding:"10px 12px",marginBottom:12}}
                            , friendSearchResult.found ? (()=>{
                              const u = friendSearchResult.user;
                              const uCls = u.chosenClass?CLASSES[u.chosenClass]:null;
                              const ex = friendSearchResult.existing;
                              return (
                                React.createElement('div', null
                                  , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:10}}
                                    , React.createElement('div', { className: "friend-avatar"}, _optionalChain([uCls, 'optionalAccess', _155 => _155.icon])||"⚔️")
                                    , React.createElement('div', { style: {flex:1}}
                                      , React.createElement('div', { className: "friend-name"}, u.playerName||"Unnamed Warrior",
                                        u.publicId && React.createElement('span', {style:{fontSize:".58rem",color:"#6a645a",fontWeight:400,marginLeft:6}}, "#"+u.publicId)
                                      )
                                      , React.createElement('div', { className: "friend-meta"}, _optionalChain([uCls, 'optionalAccess', _156 => _156.name])||"Unknown",
                                        friendSearchResult.matchType==="account_id" ? " · Found by Account ID" : " · Found by email"
                                      )
                                    )
                                    , !ex&&React.createElement('button', { className: "btn btn-gold btn-xs"  , onClick: ()=>sendFriendRequest(u.id)}, "+ Add" )
                                    , _optionalChain([ex, 'optionalAccess', _157 => _157.status])==="pending"&&(
                                      React.createElement('div', { style: {display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}
                                        , React.createElement('span', { style: {fontSize:".62rem",color:"#8a8478",fontStyle:"italic"}}, "Request pending…" )
                                        , React.createElement('button', { className: "btn btn-ghost btn-xs"  ,
                                          style: {fontSize:".58rem",color:"#e74c3c",borderColor:"rgba(231,76,60,.3)",padding:"2px 8px"},
                                          onClick: ()=>rescindFriendRequest(ex.id, u.id)}, "Rescind"

                                        )
                                      )
                                    )
                                    , _optionalChain([ex, 'optionalAccess', _158 => _158.status])==="accepted"&&React.createElement('span', { style: {fontSize:".65rem",color:"#2ecc71"}}, "Already friends ✓"  )
                                  )
                                )
                              );
                            })() : React.createElement('div', { style: {fontSize:".75rem",color:"#8a8478",fontStyle:"italic"}}, friendSearchResult.msg)
                          )
                        )
                        /* Incoming requests */
                        , friendRequests.length>0&&(
                          React.createElement(React.Fragment, null
                            , React.createElement('div', { className: "sec", style: {marginBottom:8}}, "⚔️ Incoming Requests"  )
                            , friendRequests.map(r=>(
                              React.createElement('div', { key: r.reqId, className: "req-card"}
                                , React.createElement('div', { style: {flex:1}}
                                  , React.createElement('div', { style: {fontSize:".78rem",color:"#d4cec4"}}, r.playerName)
                                  , React.createElement('div', { style: {fontSize:".62rem",color:"#8a8478",marginTop:2}}, "Wants to join your party"    )
                                )
                                , React.createElement('button', { className: "btn btn-gold btn-xs"  , style: {marginRight:6}, onClick: ()=>acceptFriendRequest(r.reqId)}, "Accept")
                                , React.createElement('button', { className: "btn btn-ghost btn-xs"  , onClick: ()=>rejectFriendRequest(r.reqId)}, "Decline")
                              )
                            ))
                          )
                        )

                        /* Incoming shared items */
                        , incomingShares.length>0&&(
                          React.createElement(React.Fragment, null
                            , React.createElement('div', { className: "sec", style: {marginBottom:8}}, "📦 Incoming Shares"  )
                            , incomingShares.map(s=>(
                              React.createElement('div', { key: s.id, className: "req-card", style: {flexDirection:"column",alignItems:"stretch",gap:8}}
                                , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:8}}
                                  , React.createElement('span', { style: {fontSize:"1.1rem"}}, s.type==="workout"?"💪":"⚡")
                                  , React.createElement('div', { style: {flex:1}}
                                    , React.createElement('div', { style: {fontSize:".78rem",color:"#d4cec4"}}, _optionalChain([s, 'access', _159 => _159.parsedItem, 'optionalAccess', _160 => _160.name])||"Unnamed")
                                    , React.createElement('div', { style: {fontSize:".62rem",color:"#8a8478",marginTop:1}}, s.senderName, " shared a "   , s.type, " with you"  )
                                  )
                                )
                                , _optionalChain([s, 'access', _161 => _161.parsedItem, 'optionalAccess', _162 => _162.desc])&&React.createElement('div', { style: {fontSize:".65rem",color:"#6a645a",fontStyle:"italic",paddingLeft:28}}, s.parsedItem.desc.slice(0,80), s.parsedItem.desc.length>80?"…":"")
                                , React.createElement('div', { style: {display:"flex",gap:6,paddingLeft:28}}
                                  , React.createElement('button', { className: "btn btn-gold btn-xs"  , style: {flex:1}, onClick: ()=>acceptShare(s)}, "✓ Add to Mine"   )
                                  , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {flex:1}, onClick: ()=>declineShare(s.id)}, "Decline")
                                )
                              )
                            ))
                          )
                        )

                        /* Outgoing pending requests */
                        , outgoingRequests.length>0&&(
                          React.createElement(React.Fragment, null
                            , React.createElement('div', { className: "sec", style: {marginBottom:8,marginTop:12}}, "📤 Pending Sent ("   , outgoingRequests.length, ")")
                            , outgoingRequests.map(r=>(
                              React.createElement('div', { key: r.reqId, className: "req-card"}
                                , React.createElement('div', { style: {flex:1}}
                                  , React.createElement('div', { style: {fontSize:".78rem",color:"#d4cec4"}}, r.playerName)
                                  , React.createElement('div', { style: {fontSize:".62rem",color:"#8a8478",marginTop:2}}, "Awaiting their response…"  )
                                )
                                , React.createElement('button', { className: "btn btn-ghost btn-xs"  ,
                                  style: {flexShrink:0,fontSize:".65rem",color:"#e74c3c",borderColor:"rgba(231,76,60,.3)"},
                                  onClick: ()=>rescindFriendRequest(r.reqId, r.userId)}, "Rescind"

                                )
                              )
                            ))
                          )
                        )

                        /* Friends list */
                        , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,marginTop:(friendRequests.length>0||incomingShares.length>0||outgoingRequests.length>0)?12:0}}
                          , React.createElement('div', { className: "sec", style: {margin:0,border:"none",padding:0}}, "👥 My Party ("   , friends.length, ")")
                          , authUser&&React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {fontSize:".58rem"}, onClick: ()=>{loadSocialData();loadIncomingShares();}}, socialLoading?"…":"↺ Refresh")
                        )
                        , !authUser&&React.createElement('div', { className: "empty"}, "Sign in to see your friends."     )
                        , authUser&&socialLoading&&React.createElement('div', { className: "empty"}, "Loading your party…"  )
                        , authUser&&!socialLoading&&friends.length===0&&React.createElement('div', { className: "empty"}, "No friends yet."  , React.createElement('br', null), "Search by email to find other warriors."      )
                        , friends.map(f=>{
                          const fCls = f.chosenClass?CLASSES[f.chosenClass]:null;
                          const fLevel = levelFor(f.xp||0);
                          const recent = recentWorkout(f.log);
                          return (
                            React.createElement('div', { key: f.id, className: "friend-card"}
                              , React.createElement('div', { className: "friend-card-top"}
                                , React.createElement('div', { className: "friend-avatar", style: {borderColor:_optionalChain([fCls, 'optionalAccess', _163 => _163.color])||"rgba(45,42,36,.3)"}}, _optionalChain([fCls, 'optionalAccess', _164 => _164.icon])||"⚔️")
                                , React.createElement('div', { style: {flex:1,minWidth:0}}
                                  , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between"}}
                                    , React.createElement('div', { className: "friend-name"}, f.playerName||"Unnamed Warrior")
                                    , React.createElement('div', { style: {display:"flex",gap:4}}
                                      , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {fontSize:".55rem",color:"#2980b9",padding:"2px 6px"},
                                        onClick: ()=>openDmWithUser(f.id)}, "\uD83D\uDCAC Chat" )
                                      , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {fontSize:".55rem",color:"#b4ac9e",padding:"2px 6px"},
                                        onClick: ()=>setShareModal({step:"pick-type",friendId:f.id,friendName:f.playerName||"this warrior"})}, "\u21EA Share" )
                                      , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {fontSize:".55rem",color:"#5a5650",padding:"2px 6px"},
                                        onClick: ()=>removeFriend(f._reqId)}, "Remove")
                                    )
                                  )
                                  , React.createElement('div', { className: "friend-meta"}
                                    , React.createElement('span', { style: {color:_optionalChain([fCls, 'optionalAccess', _165 => _165.color])||"#b4ac9e"}}, _optionalChain([fCls, 'optionalAccess', _166 => _166.name])||"Unknown")
                                    , " · ", "Level " , fLevel
                                    , " · ", React.createElement('span', { style: {color:"#b4ac9e"}}, "⚡ " , (f.xp||0).toLocaleString(), " XP" )
                                  )
                                )
                              )
                              , recent&&(
                                React.createElement('div', { className: "friend-recent"}
                                  , React.createElement('span', { style: {color:"#5a5650",marginRight:5}}, "Latest:"), recent
                                )
                              )
                              , !recent&&React.createElement('div', { className: "friend-recent", style: {color:"#6a645a",fontStyle:"italic"}}, "No workouts logged yet"   )
                            )
                          );
                        })
                      )
                    );
            })()

            /* ── MESSAGES TAB ─────────────────────── */
            , activeTab==="messages" && (()=>{
              const CLASSES_REF = CLASSES;

              // ── Conversation List ──
              if(msgView==="list") {
                return React.createElement("div", null,
                  React.createElement("div", {className:"techniques-header"},
                    React.createElement("div", {className:"tech-hdr-left"},
                      React.createElement("div", {className:"tech-ornament-line tech-ornament-line-l"}),
                      React.createElement("span", {className:"tech-hdr-title"}, "\u2726 Messages \u2726"),
                      React.createElement("div", {className:"tech-ornament-line tech-ornament-line-r"})
                    )
                  ),

                  msgConversations.length === 0 && React.createElement("div", {style:{textAlign:"center",padding:"30px 14px"}},
                    React.createElement("div", {style:{fontSize:"2.5rem",marginBottom:10,opacity:.3}}, "\uD83D\uDCAC"),
                    React.createElement("div", {style:{fontSize:".78rem",color:"#8a8478",marginBottom:6}}, "No conversations yet"),
                    React.createElement("div", {style:{fontSize:".62rem",color:"#5a5650"}}, "Tap ", React.createElement("span",{style:{color:"#2980b9"}},"\uD83D\uDCAC Chat"), " on a friend\u2019s card in the Guild tab to start a conversation.")
                  ),

                  msgConversations.map(conv => {
                    const other = conv.other_user;
                    const otherCls = other ? CLASSES_REF[other.chosen_class] : null;
                    const lastMsg = conv.last_message;
                    const unread = conv.unread_count || 0;
                    const timeAgo = lastMsg ? (()=>{
                      const diff = Date.now() - new Date(lastMsg.created_at).getTime();
                      const mins = Math.floor(diff/60000);
                      if(mins < 1) return "now";
                      if(mins < 60) return mins+"m";
                      const hrs = Math.floor(mins/60);
                      if(hrs < 24) return hrs+"h";
                      const days = Math.floor(hrs/24);
                      return days+"d";
                    })() : "";

                    return React.createElement("div", {key: conv.channel_id,
                      className:`msg-conv-card${unread>0?" unread":""}`,
                      onClick: ()=>{
                      setMsgActiveChannel(conv);
                      loadChannelMessages(conv.channel_id);
                      setMsgView("chat");
                    }},
                      // Avatar
                      React.createElement("div", {className:"msg-avatar",style:{
                        background:(otherCls?otherCls.color:"#5a5650")+"18",
                        border:"1px solid "+(otherCls?otherCls.color:"#5a5650")+"44"}},
                        otherCls ? React.createElement(ClassIcon,{classKey:other.chosen_class,size:18,color:otherCls.color}) : "\uD83D\uDCAC"
                      ),
                      // Name + last message
                      React.createElement("div", {style:{flex:1,minWidth:0}},
                        React.createElement("div", {style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}},
                          React.createElement("span", {className:"msg-conv-name",style:{fontWeight:unread>0?700:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},
                            other ? other.player_name : (conv.name||"Chat")),
                          React.createElement("span", {style:{fontSize:".52rem",color:"#5a5650",flexShrink:0}}, timeAgo)
                        ),
                        lastMsg && React.createElement("div", {className:`msg-conv-preview${unread>0?" unread":""}`},
                          lastMsg.sender_id === authUser?.id ? "You: " : "",
                          lastMsg.content
                        ),
                        !lastMsg && React.createElement("div", {style:{fontSize:".62rem",color:"#3a3834",fontStyle:"italic",marginTop:2}}, "No messages yet")
                      ),
                      // Unread badge
                      unread > 0 && React.createElement("div", {className:"msg-unread-badge"}, unread > 99 ? "99+" : unread)
                    );
                  })
                );
              }

              // ── Chat View ──
              const other = msgActiveChannel?.other_user;
              const otherCls = other ? CLASSES_REF[other.chosen_class] : null;

              return React.createElement("div", {style:{display:"flex",flexDirection:"column",flex:1,minHeight:0}},
                // Chat header
                React.createElement("div", {className:"msg-chat-hdr"},
                  React.createElement("button", {style:{background:"transparent",border:"none",color:"#b4ac9e",fontSize:".82rem",cursor:"pointer",padding:"4px"},
                    onClick:()=>{setMsgView("list");setMsgActiveChannel(null);setMsgMessages([]);loadConversations();loadUnreadCount();}}, "\u2190"),
                  React.createElement("div", {style:{width:30,height:30,borderRadius:"50%",flexShrink:0,
                    background:(otherCls?otherCls.color:"#5a5650")+"18",
                    border:"1.5px solid "+(otherCls?otherCls.color:"#5a5650")+"44",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:".85rem"}},
                    otherCls ? React.createElement(ClassIcon,{classKey:other.chosen_class,size:14,color:otherCls.color}) : "\uD83D\uDCAC"
                  ),
                  React.createElement("div", {style:{flex:1,minWidth:0}},
                    React.createElement("div", {style:{fontSize:".78rem",fontWeight:700,color:"#d4cec4"}}, other ? other.player_name : "Chat"),
                    other && React.createElement("div", {style:{fontSize:".52rem",color:"#6a645a"}},
                      (otherCls?otherCls.name:"Unknown"), " \u00b7 Lv.", other.level||1,
                      other.public_id ? " \u00b7 #"+other.public_id : "")
                  )
                ),

                // Messages area
                React.createElement("div", {ref:msgScrollRef, style:{flex:1,minHeight:0,overflowY:"auto",padding:"10px 14px",display:"flex",flexDirection:"column",gap:6,scrollbarWidth:"thin",scrollbarColor:"rgba(180,172,158,.1) transparent"}},
                  msgLoading && React.createElement("div", {style:{textAlign:"center",padding:"20px 0"}},
                    React.createElement("div", {style:{width:20,height:20,border:"2px solid rgba(180,172,158,.12)",borderTopColor:"#b4ac9e",borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 6px"}}),
                    React.createElement("div", {style:{fontSize:".58rem",color:"#5a5650"}}, "Loading\u2026")
                  ),
                  !msgLoading && msgMessages.length === 0 && React.createElement("div", {style:{textAlign:"center",padding:"30px 0",fontSize:".68rem",color:"#5a5650",fontStyle:"italic"}}, "No messages yet. Say hello!"),
                  !msgLoading && msgMessages.map(msg => {
                    const isMine = msg.is_mine;
                    const isSystem = msg.message_type === "system" || msg.message_type === "event";
                    if(isSystem) {
                      return React.createElement("div", {key:msg.id, style:{textAlign:"center",padding:"4px 0"}},
                        React.createElement("span", {className:"msg-bubble system"}, msg.content)
                      );
                    }
                    const time = new Date(msg.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
                    return React.createElement("div", {key:msg.id, style:{display:"flex",flexDirection:"column",alignItems:isMine?"flex-end":"flex-start",maxWidth:"80%",alignSelf:isMine?"flex-end":"flex-start"}},
                      !isMine && React.createElement("div", {style:{fontSize:".48rem",color:"#5a5650",marginBottom:1,marginLeft:4}}, msg.sender_name),
                      React.createElement("div", {className:`msg-bubble ${isMine?"own":"other"}`}, msg.content),
                      React.createElement("div", {className:"msg-timestamp",style:{marginLeft:4,marginRight:4}}, time,
                        msg.edited_at ? " \u00b7 edited" : "")
                    );
                  })
                ),

                // Input bar
                React.createElement("div", {className:"msg-input-bar"},
                  React.createElement("input", {
                    className:"msg-input",
                    placeholder:"Type a message\u2026",
                    value:msgInput,
                    onChange:e=>setMsgInput(e.target.value),
                    onKeyDown:e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMsg();}}
                  }),
                  React.createElement("button", {
                    className:"msg-send-btn",
                    style:{width:40,height:40,opacity:msgInput.trim()?1:.4,cursor:msgInput.trim()?"pointer":"default"},
                    disabled:msgSending||!msgInput.trim(),
                    onClick:sendMsg
                  }, msgSending ? "\u2026" : "\u2191")
                )
              );
            })()

            /* ── CHARACTER TAB ────────────────────── */
            , activeTab==="character" && (()=>{
              const charStats = calcCharStats(cls, level, clsKey, profile);
              const statMax = Math.max(...Object.values(charStats));
              const STAT_META = {
                STR:{label:"Strength",    icon:"💪", color:"#e74c3c"},
                END:{label:"Endurance",   icon:"🔥", color:"#e67e22"},
                DEX:{label:"Dexterity",   icon:"⚡", color:"#3498db"},
                CON:{label:"Constitution",icon:"🛡️", color:"#27ae60"},
                INT:{label:"Intelligence",icon:"🔮", color:"#9b59b6"},
                CHA:{label:"Charisma",    icon:"✨", color:"#e91e8c"},
                WIS:{label:"Wisdom",      icon:"🌿", color:"#1abc9c"},
                VIT:{label:"Vitality",    icon:"❤️", color:"#e74c3c"},
              };
              const EQUIP_SLOTS = [
                {key:"slot_helmet",    icon:"⛑️",  label:"Helmet",    hint:"INT / WIS"},
                {key:"slot_glasses",   icon:"👓",  label:"Glasses",   hint:"INT cosmetic"},
                {key:"slot_shoulders", icon:"🦺",  label:"Shoulders", hint:"CON / STR"},
                {key:"slot_chest",     icon:"👕",  label:"Chest",     hint:"VIT / CON"},
                {key:"slot_belt",      icon:"🩱",  label:"Belt",      hint:"STR / CON"},
                {key:"slot_gloves",    icon:"🧤",  label:"Gloves",    hint:"STR / DEX"},
                {key:"slot_legs",      icon:"👖",  label:"Legs",      hint:"DEX / END"},
                {key:"slot_shoes",     icon:"👟",  label:"Shoes",     hint:"DEX / END"},
                {key:"slot_weapon_main",icon:"⚔️", label:"Weapon",    hint:"STR / CHA"},
                {key:"slot_weapon_off", icon:"🛡️", label:"Off-hand",  hint:"DEX / CON"},
              ];
              const equipment = profile.equipment||{};
              const isStyleUnlocked = (s) => {
                if(s.unlockRace && profile.avatarRace !== s.unlockRace) return false;
                if(s.unlockDrop) return false;
                return level >= (s.unlockLevel||1);
              };
              const setAv = (field, val) => setProfile(p=>({...p, [field]:val}));
              /* btn styling now via .char-sub-btn / .char-sub-btn.sel */
              const rune = (label) => React.createElement('div',{className:"profile-rune-divider",style:{margin:"0 0 10px"}},React.createElement('span',{className:"profile-rune-label"},`⠿ ${label} ⠿`));
              return React.createElement('div', {style:{"--cls-color":cls.color,"--cls-glow":cls.glow}}

                /* ── CLASS IDENTITY HEADER ── */
                , React.createElement('div', {className:"profile-hero",style:{marginBottom:11}}
                  , React.createElement('div', {className:"profile-hero-inner"}
                    , React.createElement('div', {className:"profile-hero-top"}
                      , React.createElement('div', {className:"profile-avatar-ring",style:{display:"flex",alignItems:"center",justifyContent:"center"}}, React.createElement(ClassIcon,{classKey:profile.chosenClass,size:36,color:cls.glow}))
                      , React.createElement('div', {style:{flex:1,minWidth:0}}
                        , React.createElement('div', {className:"profile-name"}, profile.playerName,
                          myPublicId && React.createElement('span', {style:{fontSize:".58rem",color:"#6a645a",fontWeight:400,marginLeft:8,letterSpacing:".03em"}}, "#"+myPublicId)
                        )
                        , React.createElement('div', {className:"profile-class-line"}, cls.name, " · Level ", level)
                        , profile.disciplineTrait && React.createElement('span',{className:"trait",style:{"--cls-color":cls.color,"--cls-glow":cls.glow,fontSize:".65rem"}},profile.disciplineTrait)
                      )
                    )
                    , React.createElement('div',{className:"profile-rune-divider",style:{margin:"10px 0 8px"}},React.createElement('span',{className:"profile-rune-label"},"⠿ Class Traits ⠿"))
                    , React.createElement('div',{className:"traits"},cls.traits.map(t=>React.createElement('span',{key:t,className:"trait",style:{"--cls-color":cls.color,"--cls-glow":cls.glow}},t)))
                  )
                )

                /* ── SUB-TABS ── */
                , React.createElement('div',{style:{display:"flex",gap:6,marginBottom:12}}
                  , ["avatar","stats","equipment"].map(t=>React.createElement('button',{
                      key:t, onClick:()=>setCharSubTab(t),
                      className:`char-sub-btn${charSubTab===t?" sel":""}`,
                      style:{flex:1, textAlign:"center", padding:"8px 4px"}
                    }, t==="avatar"?"⚔️ Avatar":t==="stats"?"📊 Stats":"🎒 Equipment")
                  )
                )

                /* ══ AVATAR SUB-TAB ══════════════════════════ */
                , charSubTab==="avatar" && React.createElement('div', null
                  , React.createElement('div', {className:"char-section",style:{textAlign:"center",padding:"52px 24px"}}
                    , React.createElement('div', {style:{fontSize:"2.6rem",marginBottom:14}}, "⚔️")
                    , React.createElement('div', {style:{fontSize:".95rem",color:"#b4ac9e",fontWeight:600,marginBottom:8,letterSpacing:".02em"}}, "Avatar Creator")
                    , React.createElement('div', {style:{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(45,42,36,.22)",border:"1px solid rgba(180,172,158,.08)",borderRadius:20,padding:"5px 14px",marginBottom:14}}
                      , React.createElement('span', {style:{fontSize:".65rem",color:"#b4ac9e",fontWeight:600,letterSpacing:".06em",textTransform:"uppercase"}}, "Coming Soon")
                    )
                    , React.createElement('div', {style:{fontSize:".76rem",color:"#5a5650",lineHeight:1.7,maxWidth:260,margin:"0 auto"}},
                      "Full 3D avatar customization is under development. Your character will come to life with Unreal Engine integration."
                    )
                  )
                )
                /* ══ STATS SUB-TAB ════════════════════════════ */
                , charSubTab==="stats" && React.createElement('div', null
                  , React.createElement('div', {className:"char-section"}
                    , rune("Character Stats")
                    , React.createElement('div',{style:{fontSize:".6rem",color:"#5a5650",fontStyle:"italic",textAlign:"center",marginBottom:10}},"Stats grow dynamically as you train — full calculation coming soon")
                    , Object.entries(STAT_META).map(([key,meta])=>{
                      const val=charStats[key]||0, pct=Math.round((val/statMax)*100);
                      return React.createElement('div',{key,className:"char-stat-row"}
                        , React.createElement('span',{className:"char-stat-icon"},meta.icon)
                        , React.createElement('span',{className:"char-stat-label",style:{width:80}},meta.label)
                        , React.createElement('div',{className:"char-stat-bar"}
                          , React.createElement('div',{className:"char-stat-fill",style:{width:`${pct}%`,background:`linear-gradient(90deg,${meta.color}99,${meta.color})`}})
                        )
                        , React.createElement('span',{className:"char-stat-val"},val)
                      );
                    })
                  )
                )

                /* ══ EQUIPMENT SUB-TAB ═══════════════════════ */
                , charSubTab==="equipment" && React.createElement('div', null
                  , React.createElement('div', {className:"char-section"}
                    , rune("Equipment")
                    , React.createElement('div',{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px"}}
                      , EQUIP_SLOTS.map(slot=>{
                        const item=equipment[slot.key]||null;
                        return React.createElement('div',{key:slot.key,className:"char-equip-slot"}
                          , React.createElement('div',{className:"char-equip-icon",style:{width:30,height:30,borderRadius:7,border:`1px solid ${item?"rgba(180,172,158,.1)":"rgba(180,172,158,.06)"}`,background:item?"rgba(45,42,36,.18)":"rgba(45,42,36,.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1rem"}},slot.icon)
                          , React.createElement('div',{style:{flex:1,minWidth:0}}
                            , React.createElement('div',{className:"char-equip-label",style:{fontWeight:600}},slot.label)
                            , React.createElement('div',{className:"char-equip-name",style:{color:item?"#b4ac9e":"#3a3834"}},item||slot.hint)
                          )
                        );
                      })
                    )
                    , React.createElement('div',{style:{fontSize:".62rem",color:"#3a3834",fontStyle:"italic",textAlign:"center",marginTop:8}},"Earn gear through dungeons and quests in the 3D World")
                  )
                )

              );
            })()

            /* ── PROFILE VIEW ─────────────────────── */
            , activeTab==="profile" && !editMode && !securityMode && !notifMode && (
              React.createElement('div', { style: {"--cls-color":cls.color,"--cls-glow":cls.glow} }

                /* Profile completion warning */
                , !profileComplete() && React.createElement('div', { style: {background:"rgba(231,76,60,.08)",border:"1px solid rgba(231,76,60,.2)",borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10} }
                  , React.createElement('span', {style:{fontSize:"1.1rem"}}, "\u26A0\uFE0F")
                  , React.createElement('div', {style:{flex:1}}
                    , React.createElement('div', {style:{fontSize:".72rem",color:"#e05555",fontWeight:700,marginBottom:2}}, "Profile Incomplete")
                    , React.createElement('div', {style:{fontSize:".6rem",color:"#8a8478"}}, "State and Country are required for leaderboard rankings. Tap Edit to add them.")
                  )
                  , React.createElement('button', {className:"btn btn-ghost btn-sm", style:{fontSize:".58rem",flexShrink:0}, onClick:()=>{setSecurityMode(false);setNotifMode(false);openEdit();}}, "Edit")
                )

                /* Action buttons */
                , React.createElement('div', { style: {display:"flex",gap:8,marginBottom:11}}
                  , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>{setSecurityMode(false);setNotifMode(false);openEdit();}}, "✎ Edit"  )
                  , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>{setEditMode(false);setNotifMode(false);setSecurityMode(true);}}, "🔒 Security" )
                  , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>{setEditMode(false);setSecurityMode(false);setNotifMode(true);}}, "🔔 Alerts" )
                )

                /* ── IDENTITY SECTION — Name visibility with App/Game/Hide toggles ── */
                , (()=>{
                  const nv = profile.nameVisibility || { displayName:["app","game"], realName:["hide"] };
                  const realName = ((profile.firstName||"")+" "+(profile.lastName||"")).trim();
                  const boxStyle = (active, color) => ({
                    width:42, height:24, borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:".52rem", fontWeight:700, cursor:"pointer", userSelect:"none", transition:"all .15s",
                    background: active ? (color||"rgba(180,172,158,.12)") : "rgba(45,42,36,.15)",
                    border: "1px solid "+(active ? "rgba(180,172,158,.15)" : "rgba(45,42,36,.2)"),
                    color: active ? "#d4cec4" : "#3a3834"
                  });
                  const ToggleRow = ({label, value, rowKey}) => {
                    const hasApp = (nv[rowKey]||[]).includes("app");
                    const hasGame = (nv[rowKey]||[]).includes("game");
                    const isHidden = (nv[rowKey]||[]).includes("hide");
                    return React.createElement("div", {style:{display:"flex",alignItems:"center",gap:8,padding:"8px 0"}},
                      React.createElement("div", {style:{flex:1,minWidth:0}},
                        React.createElement("div", {style:{fontSize:".56rem",color:"#6a645a",marginBottom:1}}, label),
                        React.createElement("div", {style:{fontSize:".78rem",color:isHidden?"#3a3834":"#d4cec4",fontWeight:600,fontStyle:isHidden?"italic":"normal"}},
                          isHidden ? "Hidden" : (value||"Not set"))
                      ),
                      React.createElement("div", {style:{display:"flex",gap:4}},
                        React.createElement("div", {style:boxStyle(hasApp,"rgba(46,204,113,.12)"), onClick:()=>toggleNameVisibility(rowKey,"app")}, "App"),
                        React.createElement("div", {style:boxStyle(hasGame,"rgba(52,152,219,.12)"), onClick:()=>toggleNameVisibility(rowKey,"game")}, "Game"),
                        React.createElement("div", {style:boxStyle(isHidden,"rgba(231,76,60,.08)"), onClick:()=>toggleNameVisibility(rowKey,"hide")}, "Hide")
                      )
                    );
                  };
                  return React.createElement("div", {className:"profile-section"},
                    React.createElement("div", {className:"profile-rune-divider",style:{margin:"0 0 6px"}},
                      React.createElement("span", {className:"profile-rune-label"}, "⠿ Identity ⠿")),
                    /* Account ID */
                    myPublicId && React.createElement("div", {style:{textAlign:"center",marginBottom:6}},
                      React.createElement("span", {style:{fontSize:".62rem",color:"#6a645a",fontFamily:"'Inter',monospace",letterSpacing:".04em"}}, "Account ID: ",
                        React.createElement("span", {style:{color:"#b4ac9e",fontWeight:700}}, "#"+myPublicId),
                        React.createElement("span", {style:{fontSize:".52rem",color:"#b4ac9e",cursor:"pointer",textDecoration:"underline",marginLeft:6},
                          onClick:()=>{navigator.clipboard.writeText("#"+myPublicId).then(()=>showToast("Account ID copied!"));}}, "Copy")
                      )
                    ),
                    /* Display Name row */
                    React.createElement(ToggleRow, {label:"Display Name", value:profile.playerName, rowKey:"displayName"}),
                    /* Divider */
                    React.createElement("div", {style:{height:1,background:"rgba(180,172,158,.04)",margin:"0 0"}}),
                    /* Real Name row */
                    React.createElement(ToggleRow, {label:"First & Last Name", value:realName||"Not set", rowKey:"realName"}),
                    /* Legend */
                    React.createElement("div", {style:{display:"flex",gap:10,justifyContent:"center",marginTop:8,fontSize:".48rem",color:"#5a5650"}},
                      React.createElement("span", null, "App = Profile & Social"),
                      React.createElement("span", null, "\u00b7"),
                      React.createElement("span", null, "Game = Leaderboard & Quests"),
                      React.createElement("span", null, "\u00b7"),
                      React.createElement("span", null, "Hide = Not shown")
                    )
                  );
                })()

                /* ── COMBAT RECORD — WoW achievement panel / D4 stats tab ── */
                , React.createElement('div', {className:"profile-section"}
                  , React.createElement('div', { className: "profile-rune-divider", style: {margin:"0 0 10px"}}, React.createElement('span', { className: "profile-rune-label"}, "⠿ Combat Record ⠿"   ))
                  , React.createElement('div', { className: "combat-grid"}
                    , React.createElement('div', { className: "combat-chip"}, React.createElement('span', { className: "combat-chip-val"}, profile.xp.toLocaleString()), React.createElement('span', { className: "combat-chip-lbl"}, "Total XP" ))
                    , React.createElement('div', { className: "combat-chip"}, React.createElement('span', { className: "combat-chip-val"}, level), React.createElement('span', { className: "combat-chip-lbl"}, "Level"))
                    , React.createElement('div', { className: "combat-chip"}, React.createElement('span', { className: "combat-chip-val"}, profile.checkInStreak, "🔥"), React.createElement('span', { className: "combat-chip-lbl"}, "Streak"))
                    , React.createElement('div', { className: "combat-chip"}, React.createElement('span', { className: "combat-chip-val"}, profile.log.length), React.createElement('span', { className: "combat-chip-lbl"}, "Sessions"))
                    , React.createElement('div', { className: "combat-chip"}, React.createElement('span', { className: "combat-chip-val"}, QUESTS.filter(q=>_optionalChain([profile, 'access', _167 => _167.quests, 'optionalAccess', _168 => _168[q.id], 'optionalAccess', _169 => _169.claimed])).length), React.createElement('span', { className: "combat-chip-lbl"}, "Quests"))
                    , profile.runningPB ? (
                      React.createElement('div', { className: "combat-chip", style: {borderColor:"rgba(255,232,124,.18)"}}
                        , React.createElement('span', { className: "combat-chip-val", style: {color:"#FFE87C",fontSize:".7rem"}}
                          , isMetric(profile.units)?parseFloat((profile.runningPB*1.60934).toFixed(2))+" /km":parseFloat(profile.runningPB.toFixed(2))+" /mi"
                        )
                        , React.createElement('span', { className: "combat-chip-lbl"}, "🏃 Run PB"  )
                      )
                    ) : (
                      React.createElement('div', { className: "combat-chip"}, React.createElement('span', { className: "combat-chip-val", style: {color:"#3a3834"}}, "—"), React.createElement('span', { className: "combat-chip-lbl"}, "Run PB" ))
                    )
                  )
                )

                /* ── PERSONAL BESTS ── */
                , (()=>{
                  const allPBs = profile.exercisePBs || {};
                  const pbEntries = Object.entries(allPBs);
                  if(pbEntries.length === 0) return null;
                  const metric = isMetric(profile.units);

                  // Compute effective selection: leaderboard PBs pre-selected by default
                  const effectiveSelected = pbSelectedFilters === null
                    ? pbEntries.filter(([id]) => LEADERBOARD_PB_IDS.has(id)).map(([id]) => id)
                    : pbSelectedFilters;

                  // Build options for the filter dropdown
                  const pbOptions = pbEntries.map(([exId]) => {
                    const ex = EX_BY_ID[exId];
                    return { id: exId, label: ex ? ex.name : exId, icon: ex ? ex.icon : "💪" };
                  });

                  // Filter visible entries
                  const visibleEntries = pbEntries.filter(([exId]) => effectiveSelected.includes(exId));

                  // PB Filter Dropdown
                  const chipLabel = effectiveSelected.length === pbOptions.length ? "All PBs"
                    : effectiveSelected.length === 0 ? "Filter PBs"
                    : effectiveSelected.length <= 2 ? effectiveSelected.map(id=>{const ex=EX_BY_ID[id]; return ex?ex.name:id;}).join(", ")
                    : effectiveSelected.length+" selected";

                  const filterDrop = React.createElement('div', {style:{position:"relative",marginBottom:8}},
                    React.createElement('div', {
                      style:{background:pbFilterOpen?"rgba(45,42,36,.45)":"rgba(45,42,36,.2)",border:"1px solid "+(pbFilterOpen?"rgba(180,172,158,.12)":"rgba(180,172,158,.06)"),borderRadius:8,padding:"7px 10px",fontSize:".6rem",fontWeight:600,color:effectiveSelected.length===0?"#5a5650":"#b4ac9e",cursor:"pointer",display:"flex",alignItems:"center",gap:5,transition:"all .15s",userSelect:"none"},
                      onClick:()=>setPbFilterOpen(!pbFilterOpen)
                    },
                      React.createElement('span',{style:{fontSize:".7rem"}}, "🏆"),
                      React.createElement('span',{style:{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}, chipLabel),
                      React.createElement('span',{style:{fontSize:".46rem",color:"#5a5650",flexShrink:0}}, pbFilterOpen?"▲":"▼")
                    ),
                    pbFilterOpen && React.createElement('div', {style:{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:60,background:"#16160f",border:"1px solid rgba(180,172,158,.1)",borderRadius:10,boxShadow:"0 8px 32px rgba(0,0,0,.6)",overflow:"hidden"}},
                      React.createElement('div',{style:{display:"flex",justifyContent:"space-between",padding:"8px 10px",borderBottom:"1px solid rgba(180,172,158,.06)",background:"rgba(45,42,36,.15)"}},
                        React.createElement('span',{style:{fontSize:".56rem",color:"#b4ac9e",cursor:"pointer",fontWeight:600},onClick:()=>setPbSelectedFilters(pbOptions.map(o=>o.id))}, "Select All"),
                        React.createElement('span',{style:{fontSize:".56rem",color:"#e05555",cursor:"pointer",fontWeight:600},onClick:()=>setPbSelectedFilters([])}, "Clear All")
                      ),
                      React.createElement('div',{style:{maxHeight:200,overflowY:"auto",padding:"4px 4px",scrollbarWidth:"thin",scrollbarColor:"rgba(180,172,158,.15) transparent"}},
                        pbOptions.map(opt => {
                          const on = effectiveSelected.includes(opt.id);
                          return React.createElement('div', {key:opt.id, style:{display:"flex",alignItems:"center",gap:7,padding:"6px 8px",cursor:"pointer",borderRadius:5,background:on?"rgba(180,172,158,.07)":"transparent",transition:"background .1s",fontSize:".62rem",color:on?"#d4cec4":"#6a645a"},
                            onClick:()=>{const newSel = on ? effectiveSelected.filter(s=>s!==opt.id) : [...effectiveSelected, opt.id]; setPbSelectedFilters(newSel);}
                          },
                            React.createElement('span',{style:{width:15,height:15,borderRadius:3,border:"1.5px solid "+(on?"#b4ac9e":"rgba(180,172,158,.12)"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:".52rem",color:"#b4ac9e",flexShrink:0,background:on?"rgba(180,172,158,.08)":"transparent"}}, on?"✓":""),
                            React.createElement('span',{style:{fontSize:".7rem",marginRight:4}}, opt.icon),
                            opt.label
                          );
                        })
                      ),
                      React.createElement('div',{style:{padding:"6px 10px",borderTop:"1px solid rgba(180,172,158,.06)",background:"rgba(45,42,36,.1)"}},
                        React.createElement('div',{style:{textAlign:"center",fontSize:".58rem",color:"#b4ac9e",cursor:"pointer",fontWeight:600,padding:"4px 0"},onClick:()=>setPbFilterOpen(false)}, "✓ Done ("+effectiveSelected.length+")")
                      )
                    )
                  );

                  return React.createElement('div', { className:"profile-section" }
                    , React.createElement('div', { className: "profile-rune-divider", style: {margin:"0 0 10px"} }, React.createElement('span', { className: "profile-rune-label" }, "⠿ Personal Bests ⠿"))
                    , filterDrop
                    , visibleEntries.length === 0
                      ? React.createElement('div', {style:{textAlign:"center",fontSize:".62rem",color:"#5a5650",padding:"10px 0"}}, "Use the filter above to select which Personal Bests to display.")
                      : React.createElement('div', { style: {display:"flex",flexDirection:"column",gap:6} }
                        , visibleEntries.map(([exId, pb]) => {
                          const ex = EX_BY_ID[exId];
                          const name = ex ? ex.name : exId;
                          const icon = ex ? ex.icon : "💪";
                          let valDisp = "";
                          if(pb.type === "Cardio Pace") {
                            const pace = metric ? pb.value / 1.60934 : pb.value;
                            valDisp = pace.toFixed(2) + (metric ? " min/km" : " min/mi");
                          } else if(pb.type === "Assisted Weight") {
                            valDisp = (metric ? parseFloat(lbsToKg(pb.value)).toFixed(1) : pb.value) + (metric?" kg":" lbs") + " (Assisted)";
                          } else if(pb.type === "Max Reps Per 1 Set") {
                            valDisp = pb.value + " reps";
                          } else if(pb.type === "Longest Hold" || pb.type === "Fastest Time") {
                            valDisp = parseFloat(pb.value.toFixed(2)) + " min";
                          } else if(pb.type === "Heaviest Weight") {
                            valDisp = (metric ? parseFloat(lbsToKg(pb.value)).toFixed(1) : pb.value) + (metric?" kg":" lbs");
                          } else {
                            valDisp = (metric ? parseFloat(lbsToKg(pb.value)).toFixed(1) : pb.value) + (metric?" kg":" lbs") + " 1RM";
                          }
                          return React.createElement('div', { key: exId, style: {display:"flex",alignItems:"center",gap:8,paddingBottom:5,borderBottom:"1px solid rgba(45,42,36,.15)"} }
                            , React.createElement('span', { style: {fontSize:".9rem",flexShrink:0} }, icon)
                            , React.createElement('span', { style: {fontSize:".7rem",color:"#b4ac9e",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"} }, name)
                            , React.createElement('span', { style: {fontSize:".68rem",color:"#b4ac9e",fontWeight:600,flexShrink:0,fontFamily:"'Inter',sans-serif"} }, "🏆 ", valDisp)
                          );
                        })
                      )
                  );
                })()

                /* ── PHYSICAL STATS — Final Fantasy XIV character panel style ── */
                , React.createElement('div', { className:"profile-section"}
                  , React.createElement('div', { className: "profile-rune-divider", style: {margin:"0 0 10px"} }, React.createElement('span', { className: "profile-rune-label" }, `⠿ ${cls.name} Data ⠿`))
                  , React.createElement('div', { style: {display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px 16px"}}
                    , [
                      ["⚖️ Weight", profile.weightLbs?(isMetric(profile.units)?lbsToKg(profile.weightLbs)+" kg":profile.weightLbs+" lbs"):"—"],
                      ["📏 Height", totalH>0?(isMetric(profile.units)?ftInToCm(profile.heightFt,profile.heightIn)+" cm":`${profile.heightFt}'${profile.heightIn}"`):"—"],
                      ["🧬 BMI", bmi||"—"],
                      ["🎂 Age", profile.age||"—"],
                      ["⚡ Units", isMetric(profile.units)?"Metric":"Imperial"],
                      ["👤 Gender", profile.gender||"—"],
                      ["📍 State", profile.state||"—"],
                      ["🌍 Country", profile.country||"—"],
                    ].map(([label,val])=>(
                      React.createElement('div', { key: label, style: {display:"flex",alignItems:"baseline",gap:6,paddingBottom:5,borderBottom:"1px solid rgba(45,42,36,.15)"}}
                        , React.createElement('span', { style: {fontSize:".6rem",color:"#6a645a",width:72,flexShrink:0}}, label)
                        , React.createElement('span', { style: {fontSize:".74rem",color:"#b4ac9e",fontFamily:"'Inter',sans-serif"}}, val)
                      )
                    ))
                  )
                )

                /* ── ABOUT YOU ── */
                , (profile.sportsBackground||[]).length>0 || profile.trainingStyle || profile.fitnessPriorities?.length>0 || profile.disciplineTrait || profile.motto ? (
                  React.createElement('div', { className:"profile-section" }
                    , React.createElement('div', { className: "profile-rune-divider", style: {margin:"0 0 10px"} }, React.createElement('span', { className: "profile-rune-label" }, "⠿ About You ⠿"))
                    , profile.motto && React.createElement('div', { style: {fontSize:".76rem",color:"#b4ac9e",fontStyle:"italic",marginBottom:8,textAlign:"center"} }, `"${profile.motto}"`)
                    , profile.disciplineTrait && React.createElement('div', { style: {marginBottom:7} }
                      , React.createElement('span', { style: {fontSize:".6rem",color:"#6a645a",display:"block",marginBottom:3} }, "Discipline Trait")
                      , React.createElement('span', { className: "trait", style: {"--cls-color":cls.color,"--cls-glow":cls.glow} }, profile.disciplineTrait)
                    )
                    , profile.trainingStyle && React.createElement('div', { style: {display:"flex",alignItems:"baseline",gap:6,paddingBottom:5,borderBottom:"1px solid rgba(45,42,36,.15)",marginBottom:5} }
                      , React.createElement('span', { style: {fontSize:".6rem",color:"#6a645a",width:90,flexShrink:0} }, "Training Style")
                      , React.createElement('span', { style: {fontSize:".74rem",color:"#b4ac9e"} }, {heavy:"Heavy Compounds",cardio:"Cardio & Endurance",sculpt:"Sculpting & Aesthetics",hiit:"HIIT & Explosive",mindful:"Mindful Movement",sport:"Sport-Specific",mixed:"Mixed Training"}[profile.trainingStyle]||profile.trainingStyle)
                    )
                    , (profile.fitnessPriorities||[]).length>0 && React.createElement('div', { style: {marginBottom:5} }
                      , React.createElement('div', { style: {fontSize:".6rem",color:"#6a645a",marginBottom:4} }, "Fitness Priorities")
                      , React.createElement('div', null, (profile.fitnessPriorities||[]).map(p=>React.createElement('span',{key:p,className:"trait",style:{"--cls-color":"#5a5650","--cls-glow":"#8a8478",marginRight:4}},{be_strong:"💪 Being Strong",look_strong:"🪞 Looking Strong",feel_good:"🌿 Feeling Good",eat_right:"🥗 Eating Right",mental_clarity:"🧠 Mental Clarity",athletic_perf:"🏅 Athletic Perf",endurance:"🔥 Endurance",longevity:"🕊️ Longevity",competition:"🏆 Competition",social:"👥 Social",flexibility:"🤸 Mobility",weight_loss:"⚖️ Weight Mgmt"}[p]||p)))
                    )
                    , (profile.sportsBackground||[]).filter(s=>s!=="none").length>0 && React.createElement('div', null
                      , React.createElement('div', { style: {fontSize:".6rem",color:"#6a645a",marginBottom:4} }, "Sports Background")
                      , React.createElement('div', null, (profile.sportsBackground||[]).filter(s=>s!=="none").map(s=>React.createElement('span',{key:s,className:"trait",style:{"--cls-color":"#3a3834","--cls-glow":"#6a645a",marginRight:4,fontSize:".65rem"}},s.charAt(0).toUpperCase()+s.slice(1))))
                    )
                  )
                ) : null

              )
            )

            /* ── PROFILE EDIT ─────────────────────── */
            , activeTab==="profile" && editMode && (
              React.createElement(React.Fragment, null
                , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:11}}
                  , React.createElement('div', { className: "sec", style: {margin:0,border:"none",padding:0}}, "✎ Edit Profile"  )
                  , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setEditMode(false)}, "✕ Cancel" )
                )
                , React.createElement('div', { className: "edit-panel", style: {"--cls-color":cls.color,"--cls-glow":cls.glow}}

                  /* ── IDENTITY ── */
                  , React.createElement('div', null
                    , React.createElement('div', { className: "profile-rune-divider", style: {margin:"0 0 10px"}}, React.createElement('span', { className: "profile-rune-label"}, "⠿ Identity ⠿"  ))
                    , React.createElement('div', { className: "field"}, React.createElement('label', null, "Display Name" ), React.createElement('input', { className: "inp", value: draft.playerName||"", onChange: e=>setDraft(d=>({...d,playerName:e.target.value})), placeholder: "Your warrior name\u2026"  }))
                    , React.createElement('div', { style: {display:"flex",gap:10,marginBottom:2} }
                      , React.createElement('div', { className: "field", style: {flex:1} }, React.createElement('label', null, "First Name"), React.createElement('input', { className: "inp", value: draft.firstName||"", onChange: e=>setDraft(d=>({...d,firstName:e.target.value})), placeholder: "First name" }))
                      , React.createElement('div', { className: "field", style: {flex:1} }, React.createElement('label', null, "Last Name"), React.createElement('input', { className: "inp", value: draft.lastName||"", onChange: e=>setDraft(d=>({...d,lastName:e.target.value})), placeholder: "Last name" }))
                    )
                    , React.createElement('div', { className: "sec", style: {fontSize:".68rem",marginBottom:7,marginTop:4}}, "Class")
                    , React.createElement('div', { className: "cls-mini-grid" }
                      , Object.entries(CLASSES).map(([key,c])=>(
                        React.createElement('div', { key: key,
                          className: `cls-mini ${draft.chosenClass===key?"sel":""}`,
                          style: {"--bc":c.color, opacity:c.locked?0.35:1, cursor:c.locked?"not-allowed":"pointer"},
                          onClick: ()=>{ if(!c.locked) setDraft(d=>({...d,chosenClass:key})); }
                        }
                          , React.createElement('div', { className: "cls-mini-icon", style:{display:"flex",alignItems:"center",justifyContent:"center"} }, React.createElement(ClassIcon,{classKey:key,size:18,color:c.glow}))
                          , React.createElement('span', { className: "cls-mini-name" }, c.locked?"🔒":c.name)
                        )
                      ))
                    )
                  )

                  /* ── UNITS ── */
                  , React.createElement('div', null
                    , React.createElement('div', { className: "profile-rune-divider", style: {margin:"0 0 10px"}}, React.createElement('span', { className: "profile-rune-label"}, "⠿ Measurement Units ⠿"   ))
                    , React.createElement('div', { className: "units-toggle"}
                      , React.createElement('div', { className: `units-opt ${(draft.units||"imperial")==="imperial"?"on":""}`, onClick: ()=>{
                        const cur=draft.units||"imperial";
                        if(cur==="metric"){
                          const wBack=draft._dispWeight?parseFloat(kgToLbs(draft._dispWeight)).toFixed(1):"";
                          const htCm=draft._dispHeightCm;
                          let hFt="",hIn="";
                          if(htCm){const c=cmToFtIn(htCm);hFt=String(c.ft);hIn=String(c.inch);}
                          setDraft(d=>({...d,units:"imperial",weightLbs:wBack,_dispWeight:"",_dispHeightCm:"",heightFt:hFt,heightIn:hIn}));
                        }
                      }}, "🇺🇸 Imperial" )
                      , React.createElement('div', { className: `units-opt ${(draft.units||"imperial")==="metric"?"on":""}`, onClick: ()=>{
                        const cur=draft.units||"imperial";
                        if(cur==="imperial"){
                          const wKg=draft.weightLbs?lbsToKg(draft.weightLbs):"";
                          const hCm=ftInToCm(draft.heightFt,draft.heightIn)||"";
                          setDraft(d=>({...d,units:"metric",_dispWeight:wKg,_dispHeightCm:String(hCm)}));
                        }
                      }}, "🌍 Metric" )
                    )
                  )

                  /* ── BODY STATS ── */
                  , React.createElement('div', null
                    , React.createElement('div', { className: "profile-rune-divider", style: {margin:"0 0 10px"} }, React.createElement('span', { className: "profile-rune-label" }, "⠿ Body Stats ⠿"))
                    , (draft.units||"imperial")==="imperial" ? (
                      React.createElement(React.Fragment, null
                        , React.createElement('div', { className: "r2" }
                          , React.createElement('div', { className: "field" }, React.createElement('label', null, "Weight (lbs)"), React.createElement('input', { className: "inp", type: "number", min: "50", max: "600", placeholder: "185", value: draft.weightLbs||"", onChange: e=>setDraft(d=>({...d,weightLbs:e.target.value}))}))
                          , React.createElement('div', { className: "field" }, React.createElement('label', null, "Age"), React.createElement('input', { className: "inp", type: "number", min: "10", max: "100", placeholder: "30", value: draft.age||"", onChange: e=>setDraft(d=>({...d,age:e.target.value}))}))
                        )
                        , React.createElement('div', { className: "field" }, React.createElement('label', null, "Height (ft / in)")
                          , React.createElement('div', { style: {display:"flex",gap:5} }
                            , React.createElement('input', { className: "inp", type: "number", min: "3", max: "8", placeholder: "5", style: {width:"50%"}, value: draft.heightFt||"", onChange: e=>setDraft(d=>({...d,heightFt:e.target.value}))})
                            , React.createElement('input', { className: "inp", type: "number", min: "0", max: "11", placeholder: "11", style: {width:"50%"}, value: draft.heightIn||"", onChange: e=>setDraft(d=>({...d,heightIn:e.target.value}))})
                          )
                        )
                        , (()=>{const ph=(parseInt(draft.heightFt)||0)*12+(parseInt(draft.heightIn)||0);const pb=calcBMI(draft.weightLbs,ph);return pb?React.createElement('div', { style: {fontSize:".7rem",color:"#8a8478",fontStyle:"italic",marginTop:-6} }, "BMI: ", React.createElement('span', { style: {color:"#b4ac9e"} }, pb)):null;})()
                      )
                    ) : (
                      React.createElement(React.Fragment, null
                        , React.createElement('div', { className: "r2" }
                          , React.createElement('div', { className: "field" }, React.createElement('label', null, "Weight (kg)"), React.createElement('input', { className: "inp", type: "number", min: "20", max: "300", step: "0.1", placeholder: "84", value: draft._dispWeight||"", onChange: e=>setDraft(d=>({...d,_dispWeight:e.target.value}))}))
                          , React.createElement('div', { className: "field" }, React.createElement('label', null, "Age"), React.createElement('input', { className: "inp", type: "number", min: "10", max: "100", placeholder: "30", value: draft.age||"", onChange: e=>setDraft(d=>({...d,age:e.target.value}))}))
                        )
                        , React.createElement('div', { className: "field" }, React.createElement('label', null, "Height (cm)")
                          , React.createElement('input', { className: "inp", type: "number", min: "100", max: "250", placeholder: "178", value: draft._dispHeightCm||"", onChange: e=>setDraft(d=>({...d,_dispHeightCm:e.target.value}))})
                        )
                        , draft._dispWeight&&React.createElement('div', { style: {fontSize:".7rem",color:"#8a8478",fontStyle:"italic",marginTop:-6} }, draft._dispWeight, " kg = ", parseFloat(kgToLbs(draft._dispWeight)).toFixed(1), " lbs")
                      )
                    )
                    , React.createElement('div', { style: {marginTop:10,padding:"9px 11px",background:"rgba(45,42,36,.18)",border:"1px solid rgba(180,172,158,.05)",borderRadius:9} }
                      , React.createElement('div', { style: {fontSize:".62rem",color:"#6a645a",marginBottom:7,letterSpacing:".04em",textTransform:"uppercase"} }, "Show on Hero Banner")
                      , React.createElement('div', { style: {display:"flex",gap:6,flexWrap:"wrap"} }
                        , [{key:"weight",label:"Weight"},{key:"height",label:"Height"},{key:"bmi",label:"BMI"}].map(f=>{
                          const on=(draft.hudFields||{})[f.key];
                          return React.createElement('button', {
                            key: f.key,
                            className: `gender-btn ${on?"sel":""}`,
                            style: {fontSize:".68rem"},
                            onClick: ()=>setDraft(d=>({...d,hudFields:{...(d.hudFields||{}), [f.key]:!on}}))
                          }, (on?"✓ ":"")+f.label);
                        })
                      )
                      , React.createElement('div', { style: {fontSize:".6rem",color:"#3a3834",marginTop:5,fontStyle:"italic"} }, "Selected fields appear under your name in the main header")
                    )
                    , React.createElement('div', { className: "field" }
                      , React.createElement('label', null, "Gender ", React.createElement('span', { style: {fontSize:".55rem",opacity:.6} }, "(optional)"))
                      , React.createElement('div', { style: {display:"flex",gap:5,flexWrap:"wrap"} }
                        , ["Male","Female","Prefer not to say"].map(g=>(
                          React.createElement('button', { key: g, className: `gender-btn ${draft.gender===g?"sel":""}`, onClick: ()=>setDraft(d=>({...d,gender:d.gender===g?"":g})) }, g)
                        ))
                        , React.createElement('button', { className: `gender-btn ${draft.gender&&!["Male","Female","Prefer not to say"].includes(draft.gender)?"sel":""}`,
                          onClick: ()=>{ const v=window.prompt("Enter your gender identity:",""); if(v&&v.trim()) setDraft(d=>({...d,gender:v.trim()})); }
                        }, draft.gender&&!["Male","Female","Prefer not to say"].includes(draft.gender)?draft.gender:"Not Listed")
                      )
                      , draft.gender&&React.createElement('div', { style: {fontSize:".62rem",color:"#b4ac9e",marginTop:4} }, "Selected: ", draft.gender)
                    )
                  )

                  /* ── PREFERENCES ── */
                  , React.createElement('div', null
                    , React.createElement('div', { className: "profile-rune-divider", style: {margin:"0 0 10px"}}, React.createElement('span', { className: "profile-rune-label"}, "⠿ Preferences ⠿"  ))
                    , React.createElement('div', { className: "field"}, React.createElement('label', null, "Home Gym" ), React.createElement('input', { className: "inp", placeholder: "Planet Fitness, Gold's Gym, Home…"    , value: draft.gym||"", onChange: e=>setDraft(d=>({...d,gym:e.target.value}))}))
                    , React.createElement('div', { style: {display:"flex",gap:8} }
                      , React.createElement('div', { className: "field", style: {flex:1} }
                        , React.createElement('label', null, "State")
                        , React.createElement('select', { className: "inp", value: draft.state||"", onChange: e=>setDraft(d=>({...d,state:e.target.value})), style:{cursor:"pointer"} }
                          , React.createElement('option', {value:""}, "Select State")
                          , ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"].map(s=>React.createElement('option',{key:s,value:s},s))
                        )
                      )
                      , React.createElement('div', { className: "field", style: {flex:1} }
                        , React.createElement('label', null, "Country")
                        , React.createElement('select', { className: "inp", value: draft.country||"United States", onChange: e=>setDraft(d=>({...d,country:e.target.value})), style:{cursor:"pointer"} }
                          , ["United States","Canada","United Kingdom","Australia","Germany","France","Mexico","Brazil","India","Japan","South Korea","Philippines","Other"].map(c=>React.createElement('option',{key:c,value:c},c))
                        )
                      )
                    )
                    , React.createElement('div', { className: "field"}
                      , React.createElement('label', null, "Running PB "  , React.createElement('span', { style: {fontSize:".55rem",opacity:.6}}, "(", isMetric(draft.units||"imperial")?"min/km":"min/mi", ")"))
                      , React.createElement('input', { className: "inp", type: "number", min: "3", max: "20", step: "0.1", placeholder: isMetric(draft.units||"imperial")?"e.g. 5.2":"e.g. 8.5", value: draft.runningPB||"", onChange: e=>setDraft(d=>({...d,runningPB:e.target.value?parseFloat(e.target.value):""}))})
                    )
                  )

                  /* ── ABOUT YOU ── */
                  , React.createElement('div', null
                    , React.createElement('div', { className: "profile-rune-divider", style: {margin:"0 0 10px"} }, React.createElement('span', { className: "profile-rune-label" }, "⠿ About You ⠿"))
                    , React.createElement('div', { className: "field" }
                      , React.createElement('label', null, "Personal Motto ", React.createElement('span', {style:{fontSize:".55rem",opacity:.6}}, "(optional)"))
                      , React.createElement('input', { className: "inp", placeholder: "Your battle cry…", value: draft.motto||"", onChange: e=>setDraft(d=>({...d,motto:e.target.value})) })
                    )
                    , React.createElement('div', { className: "field" }
                      , React.createElement('label', null, "Training Style")
                      , React.createElement('div', { style: {display:"flex",flexWrap:"wrap",gap:5,marginTop:4} }
                        , [{val:"heavy",label:"Heavy Lifts"},{val:"cardio",label:"Cardio"},{val:"sculpt",label:"Sculpting"},{val:"hiit",label:"HIIT"},{val:"mindful",label:"Mindful"},{val:"sport",label:"Sport"},{val:"mixed",label:"Mixed"}]
                          .map(o=>React.createElement('button',{key:o.val,className:`gender-btn ${(draft.trainingStyle||"")=== o.val?"sel":""}`,onClick:()=>setDraft(d=>({...d,trainingStyle:d.trainingStyle===o.val?"":o.val}))},o.label))
                      )
                    )
                    , React.createElement('div', { className: "field" }
                      , React.createElement('label', null, "Workout Timing")
                      , React.createElement('div', { style: {display:"flex",flexWrap:"wrap",gap:5,marginTop:4} }
                        , [{val:"earlymorning",label:"⚡ Early AM"},{val:"morning",label:"☀️ Morning"},{val:"afternoon",label:"Afternoon"},{val:"evening",label:"🌙 Evening"},{val:"varies",label:"Varies"}]
                          .map(o=>React.createElement('button',{key:o.val,className:`gender-btn ${(draft.workoutTiming||"")=== o.val?"sel":""}`,onClick:()=>setDraft(d=>({...d,workoutTiming:d.workoutTiming===o.val?"":o.val}))},o.label))
                      )
                    )
                    , React.createElement('div', { className: "field" }
                      , React.createElement('label', null, "Fitness Priorities ", React.createElement('span',{style:{fontSize:".55rem",opacity:.6}},"(pick up to 3)"))
                      , React.createElement('div', { style: {display:"flex",flexWrap:"wrap",gap:4,marginTop:4} }
                        , [{val:"be_strong",label:"💪 Strong"},{val:"look_strong",label:"🪞 Look Strong"},{val:"feel_good",label:"🌿 Feel Good"},{val:"eat_right",label:"🥗 Nutrition"},{val:"mental_clarity",label:"🧠 Clarity"},{val:"athletic_perf",label:"🏅 Performance"},{val:"endurance",label:"🔥 Endurance"},{val:"longevity",label:"🕊️ Longevity"},{val:"competition",label:"🏆 Compete"},{val:"social",label:"👥 Social"},{val:"flexibility",label:"🤸 Mobility"},{val:"weight_loss",label:"⚖️ Weight"}]
                          .map(o=>{ const active=(draft.fitnessPriorities||[]).includes(o.val); return React.createElement('button',{key:o.val,className:`gender-btn ${active?"sel":""}`,onClick:()=>setDraft(d=>{ const p=d.fitnessPriorities||[]; return {...d,fitnessPriorities:active?p.filter(x=>x!==o.val):p.length<3?[...p,o.val]:p}; })},o.label); })
                      )
                    )
                    , React.createElement('div', { className: "field" }
                      , React.createElement('label', null, "Sports Background")
                      , React.createElement('div', { style: {display:"flex",flexWrap:"wrap",gap:4,marginTop:4} }
                        , ["Football","Basketball","Soccer","Running","Cycling","Swimming","Boxing","MMA","Wrestling","CrossFit","Powerlifting","Bodybuilding","Yoga","Hiking","Gymnastics","Golf","Triathlon","Rowing","Volleyball","Tennis","Dance"].map(s=>{ const v=s.toLowerCase().replace(/ /g,"_"); const active=(draft.sportsBackground||[]).includes(v); return React.createElement('button',{key:v,className:`gender-btn ${active?"sel":""}`,style:{fontSize:".62rem"},onClick:()=>setDraft(d=>{ const b=d.sportsBackground||[]; return {...d,sportsBackground:active?b.filter(x=>x!==v):[...b,v]}; })},s); })
                      )
                    )
                  )

                  , React.createElement('button', { className: "btn btn-gold", style: {width:"100%"}, onClick: saveEdit }, "⚔️ Save Profile")
                )
              )
            )

            /* ── SECURITY SETTINGS ─────────────────── */
            , activeTab==="profile" && securityMode && (
              React.createElement(React.Fragment, null
                , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:11} }
                  , React.createElement('div', { className: "sec", style: {margin:0,border:"none",padding:0} }, "🔒 Security Settings"  )
                  , React.createElement('button', { className: "btn btn-ghost btn-sm", onClick: ()=>guardRecoveryCodes(()=>{setSecurityMode(false);setPwMsg(null);setPwNew("");setPwConfirm("");setPwPanelOpen(false);setShowEmail(false);setEmailPanelOpen(false);setEmailMsg(null);setNewEmail("");setMfaPanelOpen(false);setMfaMsg(null);setMfaEnrolling(false);setMfaQR(null);setMfaCode("");}) }, "✕")
                )

                /* ═══ Email Verification Status (with Show/Hide) ═══ */
                , authUser && React.createElement('div', { style: {background:"rgba(45,42,36,.18)",border:"1px solid rgba(45,42,36,.2)",borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8} }
                  , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0} }
                    , React.createElement('span', { style: {fontSize:".9rem"} }, "\u2709\uFE0F")
                    , React.createElement('div', { style: {flex:1,minWidth:0} }
                      , React.createElement('div', { style: {fontSize:".58rem",color:"#6a645a",marginBottom:2} }, "Email")
                      , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"} }
                        , React.createElement('div', { style: {fontSize:".76rem",color:"#b4ac9e",wordBreak:"break-all"} }
                          , showEmail
                            ? authUser.email
                            : (()=>{
                                const parts = authUser.email.split("@");
                                const local = parts[0]||"";
                                const domain = parts[1]||"";
                                return "\u2022".repeat(Math.min(local.length,8))+"@"+domain;
                              })()
                        )
                        , React.createElement('span', { style: {fontSize:".58rem",color:"#b4ac9e",cursor:"pointer",flexShrink:0,userSelect:"none",textDecoration:"underline"},
                          onClick: ()=>setShowEmail(s=>!s) }
                          , showEmail?"Hide":"Show"
                        )
                      )
                    )
                  )
                  , React.createElement('span', { style: {fontSize:".56rem",fontWeight:700,padding:"2px 8px",borderRadius:10,background:authUser.email_confirmed_at?"#1a2e1a":"#2e1515",color:authUser.email_confirmed_at?"#7ebf73":"#e05555"} }, authUser.email_confirmed_at ? "\u2713 Verified" : "Unverified")
                )

                /* ═══ Account IDs ═══ */
                , React.createElement('div', { style: {background:"rgba(45,42,36,.12)",border:"1px solid rgba(45,42,36,.15)",borderRadius:10,padding:"10px 14px",marginBottom:12} }
                  /* Public Account ID */
                  , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8} }
                    , React.createElement('div', null
                      , React.createElement('div', { style: {fontSize:".58rem",color:"#6a645a",marginBottom:2} }, "Public Account ID")
                      , React.createElement('div', { style: {fontSize:".82rem",color:"#d4cec4",fontWeight:700,fontFamily:"'Inter',monospace",letterSpacing:".06em"} }, myPublicId ? "#"+myPublicId : "\u2026")
                    )
                    , React.createElement('div', { style: {display:"flex",gap:6,alignItems:"center"} }
                      , React.createElement('span', { style: {fontSize:".52rem",color:"#6a645a",fontStyle:"italic"} }, "Share to add friends")
                      , myPublicId && React.createElement('span', { style: {fontSize:".58rem",color:"#b4ac9e",cursor:"pointer",textDecoration:"underline",userSelect:"none"},
                        onClick: ()=>{ navigator.clipboard.writeText("#"+myPublicId).then(()=>showToast("Account ID copied!")); }
                      }, "Copy")
                    )
                  )
                  /* Private Account ID */
                  , React.createElement('div', { style: {borderTop:"1px solid rgba(180,172,158,.04)",paddingTop:8,display:"flex",alignItems:"center",justifyContent:"space-between"} }
                    , React.createElement('div', null
                      , React.createElement('div', { style: {fontSize:".58rem",color:"#6a645a",marginBottom:2} }, "Private Account ID")
                      , React.createElement('div', { style: {fontSize:".76rem",color:showPrivateId?"#b4ac9e":"#5a5650",fontFamily:"'Inter',monospace",letterSpacing:".04em"} }
                        , showPrivateId ? (myPrivateId||"\u2026") : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                      )
                    )
                    , React.createElement('div', { style: {display:"flex",gap:6,alignItems:"center"} }
                      , React.createElement('span', { style: {fontSize:".52rem",color:"#6a645a",fontStyle:"italic"} }, "For account recovery only")
                      , React.createElement('span', { style: {fontSize:".58rem",color:"#b4ac9e",cursor:"pointer",textDecoration:"underline",userSelect:"none"},
                        onClick: ()=>setShowPrivateId(s=>!s)
                      }, showPrivateId?"Hide":"Show")
                    )
                  )
                )

                /* ═══ CHANGE EMAIL — collapsible ═══ */
                , React.createElement('div', { className: "edit-panel", style: {marginBottom:12,padding:0,overflow:"hidden"} }
                  , React.createElement('div', { style: {display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",cursor:"pointer"},
                    onClick: ()=>{setEmailPanelOpen(s=>!s);if(emailPanelOpen){setNewEmail("");setEmailMsg(null);}} }
                    , React.createElement('label', { style: {margin:0,cursor:"pointer"} }, "📧 Change Email Address")
                    , React.createElement('span', { style: {fontSize:".65rem",color:"#b4ac9e",userSelect:"none",display:"flex",alignItems:"center",gap:4} }
                      , emailPanelOpen?"Collapse":"Expand"
                      , React.createElement('svg', { width: "12", height: "12", viewBox: "0 0 14 14", fill: "none", style: {transition:"transform .2s",transform:emailPanelOpen?"rotate(180deg)":"rotate(0deg)"} }
                        , React.createElement('defs', null, React.createElement('linearGradient', { id: "cgEm", x1: "0", y1: "0", x2: "0", y2: "1" }, React.createElement('stop', { offset: "0%", stopColor: "#b4ac9e" }), React.createElement('stop', { offset: "100%", stopColor: "#7a4e1a" })))
                        , React.createElement('polyline', { points: "3,5 7,9 11,5", stroke: "url(#cgEm)", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" })
                      )
                    )
                  )
                  , emailPanelOpen&&(
                    React.createElement('div', { style: {padding:"0 14px 14px 14px",display:"flex",flexDirection:"column",gap:10,borderTop:"1px solid rgba(45,42,36,.2)"} }
                      , React.createElement('div', { style: {fontSize:".64rem",color:"#8a8478",marginTop:10,fontStyle:"italic"} }, "A confirmation will be sent to both your current and new email. You\u2019ll need to confirm both to complete the change.")
                      , React.createElement('div', { className: "field" }
                        , React.createElement('label', { style: {margin:0} }, "New Email Address")
                        , React.createElement('input', { className: "inp", type: "email", value: newEmail, onChange: e=>setNewEmail(e.target.value), placeholder: "new@email.com",
                          onKeyDown: e=>{ if(e.key==="Enter") changeEmailAddress(); } })
                      )
                      , emailMsg&&React.createElement('div', { style: {fontSize:".72rem",color:emailMsg.ok?"#2ecc71":"#e74c3c",textAlign:"center",padding:"6px 8px",borderRadius:6} }, emailMsg.text)
                      , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {width:"100%"}, onClick: changeEmailAddress, disabled: !newEmail.trim() }, "📧 Update Email")
                    )
                  )
                )

                /* ═══ MFA (TOTP) — collapsible ═══ */
                , React.createElement('div', { className: "edit-panel", style: {marginBottom:12,padding:0,overflow:"hidden"} }
                  , React.createElement('div', { style: {display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",cursor:"pointer"},
                    onClick: ()=>guardRecoveryCodes(()=>{setMfaPanelOpen(s=>!s);if(mfaPanelOpen){setMfaMsg(null);setMfaEnrolling(false);setMfaQR(null);setMfaCode("");}}) }
                    , React.createElement('label', { style: {margin:0,cursor:"pointer",display:"flex",alignItems:"center",gap:8} }
                      , "🛡️ Multi-Factor Authentication"
                      , mfaEnabled && React.createElement('span', { style: {fontSize:".56rem",fontWeight:700,padding:"2px 8px",borderRadius:10,background:"#1a2e1a",color:"#7ebf73"} }, "Active")
                    )
                    , React.createElement('span', { style: {fontSize:".65rem",color:"#b4ac9e",userSelect:"none",display:"flex",alignItems:"center",gap:4} }
                      , mfaPanelOpen?"Collapse":"Expand"
                      , React.createElement('svg', { width: "12", height: "12", viewBox: "0 0 14 14", fill: "none", style: {transition:"transform .2s",transform:mfaPanelOpen?"rotate(180deg)":"rotate(0deg)"} }
                        , React.createElement('defs', null, React.createElement('linearGradient', { id: "cgMf", x1: "0", y1: "0", x2: "0", y2: "1" }, React.createElement('stop', { offset: "0%", stopColor: "#b4ac9e" }), React.createElement('stop', { offset: "100%", stopColor: "#7a4e1a" })))
                        , React.createElement('polyline', { points: "3,5 7,9 11,5", stroke: "url(#cgMf)", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" })
                      )
                    )
                  )
                  , mfaPanelOpen&&(
                    React.createElement('div', { style: {padding:"0 14px 14px 14px",display:"flex",flexDirection:"column",gap:10,borderTop:"1px solid rgba(45,42,36,.2)"} }

                      /* If MFA is NOT enabled — show enroll flow */
                      , !mfaEnabled && !mfaEnrolling && !mfaRecoveryCodes && (
                        React.createElement('div', { style: {marginTop:10} }
                          , React.createElement('div', { style: {fontSize:".64rem",color:"#8a8478",marginBottom:10,fontStyle:"italic"} }, "Add an extra layer of protection to your account using an authenticator app.")
                          , React.createElement('div', { style: {fontSize:".58rem",color:"#6a645a",marginBottom:12,background:"rgba(45,42,36,.15)",border:"1px solid rgba(45,42,36,.2)",borderRadius:8,padding:"8px 10px"} }
                            , React.createElement('div', { style: {fontWeight:600,color:"#8a8478",marginBottom:4} }, "Compatible apps:")
                            , "Google Authenticator \u00b7 Authy \u00b7 1Password \u00b7 Microsoft Authenticator \u00b7 Duo \u00b7 Bitwarden \u00b7 Aegis \u00b7 or any TOTP-compatible app"
                          )
                          , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {width:"100%"}, onClick: startMfaEnroll }, "\uD83D\uDEE1\uFE0F Set Up MFA")
                        )
                      )

                      /* MFA enrollment in progress — show QR */
                      , mfaEnrolling && mfaQR && (
                        React.createElement('div', { style: {marginTop:10,display:"flex",flexDirection:"column",alignItems:"center",gap:10} }
                          , React.createElement('div', { style: {fontSize:".64rem",color:"#8a8478",textAlign:"center",fontStyle:"italic"} }, "Scan this QR code with your authenticator app, then enter the 6-digit code below to confirm.")
                          , React.createElement('div', { style: {background:"#fff",borderRadius:10,padding:10,display:"inline-block"} }
                            , React.createElement('img', { src: mfaQR, alt: "MFA QR Code", style: {width:160,height:160,display:"block"} })
                          )
                          , mfaSecret && React.createElement('div', { style: {fontSize:".56rem",color:"#6a645a",textAlign:"center",wordBreak:"break-all",background:"rgba(45,42,36,.2)",padding:"6px 10px",borderRadius:6,border:"1px solid rgba(45,42,36,.2)"} }
                            , "Manual key: ", React.createElement('span', { style: {color:"#b4ac9e",fontFamily:"monospace",letterSpacing:".04em"} }, mfaSecret)
                          )
                          , React.createElement('div', { className: "field", style: {width:"100%"} }
                            , React.createElement('label', { style: {margin:0} }, "Verification Code")
                            , React.createElement('input', { className: "inp", type: "text", inputMode: "numeric", maxLength: 6, value: mfaCode, onChange: e=>setMfaCode(e.target.value.replace(/\D/g,"")), placeholder: "000000", style: {textAlign:"center",letterSpacing:".2em",fontSize:".9rem"},
                              onKeyDown: e=>{ if(e.key==="Enter") verifyMfaEnroll(); } })
                          )
                          , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {width:"100%"}, onClick: verifyMfaEnroll, disabled: mfaCode.length<6 }, "\u2713 Verify & Activate")
                          , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {width:"100%",color:"#8a8478",borderColor:"rgba(45,42,36,.2)"}, onClick: ()=>{setMfaEnrolling(false);setMfaQR(null);setMfaSecret(null);setMfaCode("");setMfaMsg(null);} }, "Cancel")
                        )
                      )

                      /* Recovery codes display — shown once after enrollment or regeneration */
                      , mfaRecoveryCodes && (
                        React.createElement('div', { style: {marginTop:10} }
                          , React.createElement('div', { style: {fontSize:".68rem",color:"#d4cec4",fontWeight:700,marginBottom:6} }, "\uD83D\uDD11 Recovery Codes")
                          , React.createElement('div', { style: {fontSize:".62rem",color:"#e74c3c",marginBottom:10,fontWeight:600} }, "\u26A0 Save these codes now \u2014 they will NOT be shown again!")
                          , React.createElement('div', { style: {fontSize:".64rem",color:"#8a8478",marginBottom:10,fontStyle:"italic"} }, "If you lose access to your authenticator app, use one of these codes to log in. Each code can only be used once.")
                          , React.createElement('div', { style: {background:"rgba(45,42,36,.25)",border:"1px solid rgba(45,42,36,.25)",borderRadius:8,padding:"10px 14px",fontFamily:"monospace",fontSize:".72rem",color:"#b4ac9e",lineHeight:2,letterSpacing:".05em",textAlign:"center"} }
                            , mfaRecoveryCodes.map((c,i)=>React.createElement('div', { key: i }, c))
                          )
                          , React.createElement('div', { style: {display:"flex",gap:6,marginTop:10} }
                            , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {flex:1}, onClick: ()=>{
                              const text = mfaRecoveryCodes.join("\n");
                              navigator.clipboard.writeText(text).then(()=>showToast("\u2713 Codes copied to clipboard")).catch(()=>{});
                            } }, "\uD83D\uDCCB Copy All")
                            , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {flex:1}, onClick: ()=>{
                              const blob = new Blob(["Aurisar \u2014 MFA Recovery Codes\n"+"Generated: "+new Date().toLocaleString()+"\n\n"+mfaRecoveryCodes.join("\n")+"\n\nEach code can only be used once.\nStore these somewhere safe.\n"], {type:"text/plain"});
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a"); a.href=url; a.download="aurisar-recovery-codes.txt"; a.click();
                              URL.revokeObjectURL(url);
                            } }, "\u2B07 Download .txt")
                          )
                          , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {width:"100%",marginTop:6}, onClick: ()=>setMfaRecoveryCodes(null) }, "\u2713 I\u2019ve saved my codes")
                        )
                      )

                      /* MFA IS enabled — show status, codes remaining, and disable option */
                      , mfaEnabled && !mfaRecoveryCodes && !mfaDisableConfirm && (
                        React.createElement('div', { style: {marginTop:10} }
                          , React.createElement('div', { style: {fontSize:".64rem",color:"#8a8478",marginBottom:10,fontStyle:"italic"} }, "MFA is active on your account. You\u2019ll need a verification code from your authenticator app each time you sign in.")

                          /* Recovery codes remaining */
                          , React.createElement('div', { style: {background:"rgba(45,42,36,.15)",border:"1px solid rgba(45,42,36,.2)",borderRadius:8,padding:"10px 14px",marginBottom:10} }
                            , React.createElement('div', { style: {display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6} }
                              , React.createElement('span', { style: {fontSize:".64rem",color:"#8a8478",fontWeight:600} }, "\uD83D\uDD11 Recovery Codes")
                              , mfaCodesRemaining !== null && React.createElement('span', { style: {fontSize:".62rem",fontWeight:700,padding:"2px 8px",borderRadius:10,background:mfaCodesRemaining>3?"#1a2e1a":mfaCodesRemaining>0?"#2e2010":"#2e1515",color:mfaCodesRemaining>3?"#7ebf73":mfaCodesRemaining>0?"#d4943a":"#e05555"} }, mfaCodesRemaining+" remaining")
                            )
                            , mfaCodesRemaining !== null && mfaCodesRemaining <= 3 && React.createElement('div', { style: {fontSize:".58rem",color:mfaCodesRemaining===0?"#e05555":"#d4943a",marginBottom:6} }, mfaCodesRemaining===0 ? "\u26A0 No recovery codes left! Regenerate now to avoid being locked out." : "\u26A0 Running low \u2014 consider regenerating your codes.")
                            , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {width:"100%",fontSize:".6rem"}, onClick: regenerateRecoveryCodes }, "\u21BB Regenerate Recovery Codes")
                          )

                          /* Compatible apps reminder */
                          , React.createElement('div', { style: {fontSize:".56rem",color:"#5a5650",marginBottom:12,fontStyle:"italic"} }, "Works with: Google Authenticator \u00b7 Authy \u00b7 1Password \u00b7 Microsoft Authenticator \u00b7 and any TOTP app")

                          , React.createElement('button', { className: "btn btn-danger", style: {width:"100%"}, onClick: unenrollMfa }, "\uD83D\uDDD1 Disable MFA")
                        )
                      )

                      /* MFA DISABLE CONFIRMATION — requires TOTP verification */
                      , mfaDisableConfirm && (
                        React.createElement('div', { style: {marginTop:10} }
                          , React.createElement('div', { style: {fontSize:".68rem",color:"#e05555",fontWeight:700,marginBottom:8} }, "\u26A0 Confirm MFA Disable")
                          , React.createElement('div', { style: {fontSize:".64rem",color:"#8a8478",marginBottom:12,fontStyle:"italic"} }, "Enter your current authenticator code to confirm you want to disable MFA.")

                          , React.createElement('div', { style: {display:"flex",flexDirection:"column",gap:8} }
                            , React.createElement('input', { className: "inp", type: "text", inputMode: "numeric", maxLength: 6, value: mfaDisableCode, onChange: e=>setMfaDisableCode(e.target.value.replace(/\D/g,"")),
                              placeholder: "000000", style: {textAlign:"center",letterSpacing:".2em",fontSize:".9rem"},
                              onKeyDown: e=>{ if(e.key==="Enter") confirmMfaDisableWithTotp(); } })
                            , React.createElement('button', { className: "btn btn-danger", style: {width:"100%"}, onClick: confirmMfaDisableWithTotp, disabled: mfaUnenrolling || mfaDisableCode.length<6 }, mfaUnenrolling ? "Verifying\u2026" : "Confirm & Disable MFA")
                          )

                          , mfaDisableMsg && React.createElement('div', { style: {fontSize:".72rem",color:mfaDisableMsg.ok?"#2ecc71":"#e74c3c",textAlign:"center",padding:"6px 8px",borderRadius:6,marginTop:4} }, mfaDisableMsg.text)

                          /* Cancel */
                          , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {width:"100%",marginTop:6,color:"#8a8478"}, onClick: ()=>{setMfaDisableConfirm(false);setMfaDisableCode("");setMfaDisableMsg(null);} }, "Cancel")
                        )
                      )

                      , mfaMsg&&React.createElement('div', { style: {fontSize:".72rem",color:mfaMsg.ok?"#2ecc71":"#e74c3c",textAlign:"center",padding:"6px 8px",borderRadius:6} }, mfaMsg.text)
                    )
                  )
                )

                /* ═══ Phone Number — collapsible ═══ */
                , React.createElement('div', { className: "edit-panel", style: {marginBottom:12,padding:0,overflow:"hidden"} }
                  , React.createElement('div', { style: {display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",cursor:"pointer"},
                    onClick: ()=>{setPhonePanelOpen(s=>!s);if(phonePanelOpen){setPhoneMsg(null);setPhoneOtpSent(false);setPhoneOtpCode("");}} }
                    , React.createElement('label', { style: {margin:0,cursor:"pointer",display:"flex",alignItems:"center",gap:8} }
                      , "\uD83D\uDCF1 Phone Number (optional)"
                      , profile.phone && profile.phoneVerified && React.createElement('span', { style: {fontSize:".56rem",fontWeight:700,padding:"2px 8px",borderRadius:10,background:"#1a2e1a",color:"#7ebf73"} }, "Verified")
                    )
                    , React.createElement('span', { style: {fontSize:".65rem",color:"#b4ac9e",userSelect:"none",display:"flex",alignItems:"center",gap:4} }
                      , phonePanelOpen?"Collapse":"Expand"
                      , React.createElement('svg', { width: "12", height: "12", viewBox: "0 0 14 14", fill: "none", style: {transition:"transform .2s",transform:phonePanelOpen?"rotate(180deg)":"rotate(0deg)"} }
                        , React.createElement('defs', null, React.createElement('linearGradient', { id: "cgPh", x1: "0", y1: "0", x2: "0", y2: "1" }, React.createElement('stop', { offset: "0%", stopColor: "#b4ac9e" }), React.createElement('stop', { offset: "100%", stopColor: "#7a4e1a" })))
                        , React.createElement('polyline', { points: "3,5 7,9 11,5", stroke: "url(#cgPh)", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" })
                      )
                    )
                  )
                  , phonePanelOpen&&(
                    React.createElement('div', { style: {padding:"0 14px 14px 14px",display:"flex",flexDirection:"column",gap:10,borderTop:"1px solid rgba(45,42,36,.2)"} }

                      /* If phone is on file — show it */
                      , profile.phone && (
                        React.createElement('div', { style: {marginTop:10} }
                          , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8} }
                            , React.createElement('div', null
                              , React.createElement('div', { style: {fontSize:".6rem",color:"#8a8478",marginBottom:2} }, "Phone on file")
                              , React.createElement('div', { style: {fontSize:".78rem",color:"#b4ac9e",fontFamily:"monospace"} }, profile.phone)
                            )
                            , React.createElement('span', { style: {fontSize:".56rem",fontWeight:700,padding:"2px 8px",borderRadius:10,background:"#1a2e1a",color:"#7ebf73"} }, "\u2713 Saved")
                          )
                          , React.createElement('div', { style: {fontSize:".58rem",color:"#6a645a",marginBottom:8,fontStyle:"italic"} }, "On file for admin identity verification if you ever need account support.")
                          , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {width:"100%",fontSize:".6rem",color:"#e05555",borderColor:"rgba(231,76,60,.2)"}, onClick: removePhone }, "Remove Phone")
                        )
                      )

                      /* If no phone — add one */
                      , !profile.phone && (
                        React.createElement('div', { style: {marginTop:10} }
                          , React.createElement('div', { style: {fontSize:".64rem",color:"#8a8478",marginBottom:10,fontStyle:"italic"} }, "Optionally add a phone number for admin identity verification if you ever need account support. Format: country code + number (e.g. +12145551234).")
                          , React.createElement('div', { className: "field" }
                            , React.createElement('label', { style: {margin:0} }, "Phone Number")
                            , React.createElement('input', { className: "inp", type: "tel", value: phoneInput, onChange: e=>setPhoneInput(e.target.value), placeholder: "+12145551234",
                              onKeyDown: e=>{ if(e.key==="Enter" && phoneInput.trim()) { setProfile(p=>({...p, phone: phoneInput.trim()})); setPhoneInput(""); setPhoneMsg({ok:true, text:"\u2713 Phone number saved."}); } } })
                          )
                          , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {width:"100%"}, onClick: ()=>{
                            if(!phoneInput.trim()) { setPhoneMsg({ok:false, text:"Enter a phone number."}); return; }
                            setProfile(p=>({...p, phone: phoneInput.trim()}));
                            setPhoneInput("");
                            setPhoneMsg({ok:true, text:"\u2713 Phone number saved."});
                          }, disabled: !phoneInput.trim() }, "\uD83D\uDCF1 Save Phone Number")
                        )
                      )

                      , phoneMsg && React.createElement('div', { style: {fontSize:".72rem",color:phoneMsg.ok?"#2ecc71":"#e74c3c",textAlign:"center",padding:"6px 8px",borderRadius:6} }, phoneMsg.text)
                    )
                  )
                )

                /* ═══ Set / Change Password — collapsible ═══ */
                , React.createElement('div', { className: "edit-panel", style: {marginBottom:12,padding:0,overflow:"hidden"} }
                  , React.createElement('div', { style: {display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",cursor:"pointer"},
                    onClick: ()=>{setPwPanelOpen(s=>!s);if(pwPanelOpen){setPwNew("");setPwConfirm("");setPwMsg(null);}} }
                    , React.createElement('label', { style: {margin:0,cursor:"pointer"} }, "🔑 Set / Change Password")
                    , React.createElement('span', { style: {fontSize:".65rem",color:"#b4ac9e",userSelect:"none",display:"flex",alignItems:"center",gap:4} }
                      , pwPanelOpen?"Collapse":"Expand"
                      , React.createElement('svg', { width: "12", height: "12", viewBox: "0 0 14 14", fill: "none", style: {transition:"transform .2s",transform:pwPanelOpen?"rotate(180deg)":"rotate(0deg)"} }
                        , React.createElement('defs', null, React.createElement('linearGradient', { id: "cgPw", x1: "0", y1: "0", x2: "0", y2: "1" }, React.createElement('stop', { offset: "0%", stopColor: "#b4ac9e" }), React.createElement('stop', { offset: "100%", stopColor: "#7a4e1a" })))
                        , React.createElement('polyline', { points: "3,5 7,9 11,5", stroke: "url(#cgPw)", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" })
                      )
                    )
                  )
                  , pwPanelOpen&&(
                    React.createElement('div', { style: {padding:"0 14px 14px 14px",display:"flex",flexDirection:"column",gap:10,borderTop:"1px solid rgba(45,42,36,.2)"} }
                      , React.createElement('div', { className: "field", style: {marginTop:10} }
                        , React.createElement('div', { style: {display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4} }
                          , React.createElement('label', { style: {margin:0} }, "New Password")
                          , React.createElement('span', { style: {fontSize:".62rem",color:"#b4ac9e",cursor:"pointer",userSelect:"none"},
                            onClick: ()=>setShowPwProfile(s=>!s) }
                            , showPwProfile?"\uD83D\uDE48 Hide":"\uD83D\uDC41 Show"
                          )
                        )
                        , React.createElement('input', { className: "inp", type: showPwProfile?"text":"password", value: pwNew, onChange: e=>setPwNew(e.target.value), placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" })
                      )
                      , React.createElement('div', { className: "field" }
                        , React.createElement('label', null, "Confirm Password")
                        , React.createElement('input', { className: "inp", type: showPwProfile?"text":"password", value: pwConfirm, onChange: e=>setPwConfirm(e.target.value), placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
                          onKeyDown: e=>{ if(e.key==="Enter") changePassword(); } })
                      )
                      , pwMsg&&React.createElement('div', { style: {fontSize:".72rem",color:pwMsg.ok===true?"#2ecc71":pwMsg.ok===false?"#e74c3c":"#b4ac9e",textAlign:"center",padding:"6px 8px",background:pwMsg.ok===null?"rgba(45,42,36,.16)":"transparent",borderRadius:6,border:pwMsg.ok===null?"1px solid rgba(180,172,158,.06)":"none"} }, pwMsg.text)
                      , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {width:"100%"}, onClick: changePassword, disabled: !pwNew||!pwConfirm }, "🔑 Save Password")
                    )
                  )
                )

                , React.createElement('div', { className: "div" })

                /* Wipe & Rebuild */
                , React.createElement('div', { style: {marginBottom:6} }
                  , React.createElement('div', { style: {fontSize:".68rem",color:"#8a8478",marginBottom:8,fontStyle:"italic"} }, "Permanently erase all XP, log, plans, and workouts. Cannot be undone.")
                  , React.createElement('button', { className: "btn btn-danger", style: {width:"100%"}, onClick: resetChar }, "\u21BA Wipe & Rebuild")
                )
              )
            )

            /* ── NOTIFICATION PREFERENCES ─────────────────── */
            , activeTab==="profile" && notifMode && (
              React.createElement(React.Fragment, null
                , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:11} }
                  , React.createElement('div', { className: "sec", style: {margin:0,border:"none",padding:0} }, "🔔 Notification Preferences")
                  , React.createElement('button', { className: "btn btn-ghost btn-sm", onClick: ()=>setNotifMode(false) }, "✕")
                )

                , React.createElement('div', { style: {fontSize:".64rem",color:"#8a8478",marginBottom:14,fontStyle:"italic"} }, "Choose which email notifications you\u2019d like to receive from Aurisar.")

                , (()=>{
                  const prefs = profile.notificationPrefs || {};
                  const items = [
                    {key:"sharedWorkout", icon:"📋", label:"Shared Workouts", desc:"When a friend shares a workout with you"},
                    {key:"friendLevelUp", icon:"⬆️", label:"Friend Level Ups", desc:"When one of your friends levels up"},
                    {key:"friendExercise", icon:"🏋️", label:"Friend Exercises", desc:"In-app banner when a friend completes an exercise"},
                    {key:"friendRequest", icon:"🤝", label:"Friend Requests", desc:"When someone sends you a friend request"},
                    {key:"friendAccepted", icon:"✅", label:"Request Accepted", desc:"When someone accepts your friend request"},
                    {key:"messageReceived", icon:"💬", label:"New Messages", desc:"Email me when I receive a new direct message", defaultOff:true},
                    {key:"reviewBattleStats", icon:"📊", label:"Review Battle Stats", desc:"Remind me to input Duration, Total Calories & Active Calories for each completed Workout or Exercise"},
                  ];
                  return React.createElement('div', { style: {display:"flex",flexDirection:"column",gap:8} }
                    , items.map(item => {
                      const isOn = item.defaultOff ? prefs[item.key] === true : prefs[item.key] !== false;
                      return React.createElement('div', { key: item.key,
                        className:"profile-notif-row",
                        style: {cursor:"pointer",borderColor:isOn?"rgba(46,204,113,.18)":"rgba(180,172,158,.05)"},
                        onClick: ()=>toggleNotifPref(item.key) }
                        , React.createElement('span', { style: {fontSize:"1.1rem",flexShrink:0} }, item.icon)
                        , React.createElement('div', { style: {flex:1,minWidth:0} }
                          , React.createElement('div', { style: {fontSize:".76rem",color:"#d4cec4",fontWeight:600} }, item.label)
                          , React.createElement('div', { style: {fontSize:".6rem",color:"#6a645a",marginTop:2} }, item.desc)
                        )
                        /* Toggle switch */
                        , React.createElement('div', { style: {width:40,height:22,borderRadius:11,background:isOn?"rgba(46,204,113,.25)":"rgba(45,42,36,.35)",border:"1px solid "+(isOn?"rgba(46,204,113,.35)":"rgba(180,172,158,.08)"),position:"relative",transition:"all .2s",flexShrink:0} }
                          , React.createElement('div', { style: {width:16,height:16,borderRadius:"50%",background:isOn?"#2ecc71":"#5a5650",position:"absolute",top:2,left:isOn?21:2,transition:"all .2s",boxShadow:isOn?"0 0 6px rgba(46,204,113,.4)":"none"} })
                        )
                      );
                    })
                  );
                })()

                , React.createElement('div', { style: {fontSize:".56rem",color:"#5a5650",marginTop:16,fontStyle:"italic",textAlign:"center"} }, "Changes save automatically. Email notifications require a verified email address.")
              )
            )

          )/* scroll-area */
        )
      )


      /* ══ EXERCISE EDITOR MODAL ══════════════════ */
      , exEditorOpen && exEditorDraft && createPortal((()=>{ try {
        const ed = exEditorDraft;
        const setEd = patch => setExEditorDraft(d=>({...d,...patch}));
        const isCardioED = ed.category==="cardio";
        const isFlexED   = ed.category==="flexibility";
        const hasWeightED = !isCardioED && !isFlexED;
        const metric = isMetric(profile.units);
        const wUnit = weightLabel(profile.units);
        const dUnit = distLabel(profile.units);
        const age = profile.age||30;
        return (
          React.createElement('div', { className: "ex-editor-backdrop", onClick: ()=>setExEditorOpen(false)}
            , React.createElement('div', { className: "ex-editor-sheet", onClick: e=>e.stopPropagation(),
                style: {"--mg-color": getMuscleColor(ed.muscleGroup||"chest")} }
              , React.createElement('div', { className: "ex-editor-hdr"}
                , React.createElement('div', null
                  , React.createElement('div', { className: "ex-editor-title"}
                    , exEditorMode==="edit"?"✎ Edit Technique":exEditorMode==="copy"?"⎘ Copy Technique":"⚔ Forge Technique"
                  )
                  , React.createElement('div', { className: "ex-editor-subtitle"}
                    , exEditorMode==="edit"?"Sharpen your custom technique":"Forge a new technique for your grimoire"
                  )
                )
                , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setExEditorOpen(false)}, "✕")
              )
              , React.createElement('div', { className: "ex-editor-body"}

                /* Copy from existing (create/copy mode only) */
                , exEditorMode!=="edit" && (
                  React.createElement('div', { className: "field"}
                    , React.createElement('label', null, "Start from existing exercise (optional)"    )
                    , React.createElement('select', { className: "inp", style: {appearance:"auto",cursor:"pointer"},
                      onChange: e=>{
                        if(!e.target.value) return;
                        const base=allExById[e.target.value];
                        if(base) setExEditorDraft(newExDraft(base));
                      }, defaultValue: ""}
                      , React.createElement('option', { value: ""}, "— Start from scratch —"    )
                      , ["strength","cardio","flexibility","endurance"].map(cat=>(
                        React.createElement('optgroup', { key: cat, label: cat.charAt(0).toUpperCase()+cat.slice(1)}
                          , allExercises.filter(ex=>ex.category===cat).map(ex=>(
                            React.createElement('option', { key: ex.id, value: ex.id}, ex.icon, " " , ex.name)
                          ))
                        )
                      ))
                    )
                  )
                )

                /* Name + Icon row */
                , React.createElement('div', { style: {display:"flex",gap:8}}
                  , React.createElement('div', { className: "field", style: {flex:1}}
                    , React.createElement('label', null, "Exercise Name" )
                    , React.createElement('input', { className: "inp", value: ed.name||"", onChange: e=>setEd({name:e.target.value}), placeholder: "e.g. Cable Fly"  })
                  )
                  , React.createElement('div', { className: "field", style: {width:70}}
                    , React.createElement('label', null, "Icon")
                    , React.createElement('div', { className: "inp", style: {textAlign:"center",fontSize:"1.4rem",padding:"5px 0",cursor:"default"}}, ed.icon||"💪")
                  )
                )

                /* Icon grid */
                , React.createElement('div', { style: {display:"flex",flexWrap:"wrap",gap:5,marginBottom:4}}
                  , EX_ICON_LIST.map(ic=>(
                    React.createElement('div', { key: ic,
                      onClick: ()=>setEd({icon:ic}),
                      style: {width:34,height:34,display:"flex",alignItems:"center",justifyContent:"center",
                        fontSize:"1.15rem",cursor:"pointer",borderRadius:7,
                        border:`1px solid ${ed.icon===ic?"rgba(180,172,158,.2)":"rgba(45,42,36,.22)"}`,
                        background:ed.icon===ic?"rgba(45,42,36,.25)":"rgba(45,42,36,.12)",
                        transition:"all .15s"}}
                      , ic
                    )
                  ))
                )

                /* Category */
                , React.createElement('div', { className: "field"}
                  , React.createElement('label', null, "Category")
                  , React.createElement('div', { style: {display:"flex",gap:5}}
                    , ["strength","cardio","flexibility","endurance"].map(cat=>(
                      React.createElement('button', { key: cat,
                        className: `btn btn-sm ${ed.category===cat?"btn-gold":"btn-ghost"}`,
                        style: {flex:1,textTransform:"capitalize",fontSize:".58rem",padding:"5px 2px"},
                        onClick: ()=>setEd({category:cat})}
                        , cat
                      )
                    ))
                  )
                )

                /* Muscle Group */
                , React.createElement('div', { className: "field"}
                  , React.createElement('label', {}, "Muscle Group")
                  , React.createElement('div', { style: {display:"flex",gap:4,flexWrap:"wrap"}}
                    , ["chest","back","shoulder","bicep","tricep","forearm","legs","glutes","calves","abs"].map(mg=>(
                      React.createElement('button', { key: mg,
                        className: `btn btn-sm ${ed.muscleGroup===mg?"btn-gold":"btn-ghost"}`,
                        style: {textTransform:"capitalize",fontSize:".54rem",padding:"4px 8px"},
                        onClick: ()=>setEd({muscleGroup:mg})}
                        , mg
                      )
                    ))
                  )
                )

                /* Base XP */
                , React.createElement('div', { className: "field"}
                  , React.createElement('label', null, "Base XP per session "    , React.createElement('span', { style: {fontSize:".6rem",color:"#8a8478",fontStyle:"italic"}}, "— typical: 20–80"  ))
                  , React.createElement('input', { className: "inp", type: "number", min: "1", max: "500", value: ed.baseXP||40,
                    onChange: e=>setEd({baseXP:parseInt(e.target.value)||1})})
                )

                /* ── Default Workout Values ───────────────── */
                , React.createElement('div', { className: "ex-editor-section" }
                  , React.createElement('div', { className: "ex-editor-section-title" }, "Default Values When Logging"

                  )
                  , React.createElement('div', { style: {fontSize:".63rem",color:"#5a5650",marginTop:-6,fontStyle:"italic"}}, "Pre-filled each time you log this exercise"      )

                  /* Sets + Reps/Duration */
                  , React.createElement('div', { className: "r2"}
                    , React.createElement('div', { className: "field"}
                      , React.createElement('label', null, "Default Sets" )
                      , React.createElement('input', { className: "inp", type: "number", min: "0", max: "20", value: ed.defaultSets!=null?ed.defaultSets:"", placeholder:"0",
                        onChange: e=>{const v=e.target.value;setEd({defaultSets:v===""?null:parseInt(v)});}})
                    )
                    , React.createElement('div', { className: "field"}
                      , React.createElement('label', null, "Default " , (isCardioED||isFlexED)?"Duration (min)":"Reps")
                      , React.createElement('input', { className: "inp", type: "number", min: "0", max: "300", value: ed.defaultReps!=null?ed.defaultReps:"", placeholder:"0",
                        onChange: e=>{const v=e.target.value;setEd({defaultReps:v===""?null:parseInt(v)});}})
                    )
                  )

                  /* Weight — strength/endurance only */
                  , hasWeightED && (
                    React.createElement(React.Fragment, null
                      , React.createElement('div', { className: "r2"}
                        , React.createElement('div', { className: "field"}
                          , React.createElement('label', null, "Default Base Weight ("   , wUnit, ")")
                          , React.createElement('input', { className: "inp", type: "number", min: "0", max: "2000", step: metric?"0.5":"2.5",
                            value: ed.defaultWeightLbs?(metric?lbsToKg(ed.defaultWeightLbs):ed.defaultWeightLbs):"",
                            onChange: e=>{const v=e.target.value;const lbs=v&&metric?kgToLbs(v):v;setEd({defaultWeightLbs:lbs||""}); },
                            placeholder: metric?"60":"135"})
                        )
                        , React.createElement('div', { className: "field"}
                          , React.createElement('label', null, "Default Intensity %"  )
                          , React.createElement('input', { className: "inp", type: "number", min: "50", max: "200", step: "5",
                            value: ed.defaultWeightPct||100,
                            onChange: e=>setEd({defaultWeightPct:parseInt(e.target.value)||100})})
                        )
                      )
                      , React.createElement('div', null
                        , React.createElement('input', { type: "range", className: "pct-slider", min: "0", max: "100", step: "5",
                          value: pctToSlider(ed.defaultWeightPct||100),
                          onChange: e=>setEd({defaultWeightPct:sliderToPct(Number(e.target.value))})})
                        , React.createElement('div', { style: {display:"flex",justifyContent:"space-between",fontSize:".56rem",color:"#6a645a",marginTop:2}}
                          , React.createElement('span', null, "50% Deload" ), React.createElement('span', null, "100% Normal" ), React.createElement('span', null, "200% Max" )
                        )
                      )
                    )
                  )

                  /* Distance — cardio only */
                  , isCardioED && (
                    React.createElement('div', { className: "field"}
                      , React.createElement('label', null, "Default Distance ("  , dUnit, ")")
                      , React.createElement('input', { className: "inp", type: "number", min: "0", max: "200", step: "0.1",
                        value: ed.defaultDistanceMi?(metric?miToKm(ed.defaultDistanceMi):ed.defaultDistanceMi):"",
                        onChange: e=>{const v=e.target.value;const mi=v&&metric?kmToMi(v):v;setEd({defaultDistanceMi:mi||""}); },
                        placeholder: metric?"5.0":"3.1"})
                    )
                  )

                  /* HR Zone — cardio only */
                  , isCardioED && (
                    React.createElement('div', { className: "field"}
                      , React.createElement('label', null, "Default Heart Rate Zone "    , profile.age?`(Age ${profile.age})`:"")
                      , React.createElement('div', { className: "hr-zone-row"}
                        , HR_ZONES.map(z=>{
                          const range=hrRange(age,z);
                          const sel=(ed.defaultHrZone||null)===z.z;
                          return (
                            React.createElement('div', { key: z.z, className: `hr-zone-btn ${sel?"sel":""}`,
                              style: {"--zc":z.color,borderColor:sel?z.color:"rgba(45,42,36,.2)",background:sel?`${z.color}22`:"rgba(45,42,36,.12)"},
                              onClick: ()=>setEd({defaultHrZone:sel?null:z.z})}
                              , React.createElement('span', { className: "hz-name", style: {color:sel?z.color:"#5a5650"}}, "Z", z.z, " " , z.name)
                              , React.createElement('span', { className: "hz-bpm", style: {color:sel?z.color:"#6a645a"}}, range.lo, "–", range.hi)
                            )
                          );
                        })
                      )
                      , !profile.age&&React.createElement('div', { style: {fontSize:".6rem",color:"#6a645a",marginTop:3}}, "Set your age in Profile for accurate BPM ranges"        )
                    )
                  )
                )

                /* ── Exercise Details (optional) ─────── */
                , React.createElement('div', { className: "ex-editor-section-title", style:{marginTop:4} }, "✦ Exercise Details (optional)"

                )

                /* Muscles */
                , React.createElement('div', { className: "field"}
                  , React.createElement('label', null, "Target Muscles" )
                  , React.createElement('input', { className: "inp", value: ed.muscles||"",
                    onChange: e=>setEd({muscles:e.target.value}),
                    placeholder: "e.g. Chest · Front Deltoids · Triceps"      })
                )

                /* Description */
                , React.createElement('div', { className: "field"}
                  , React.createElement('label', null, "Description")
                  , React.createElement('textarea', { className: "inp", rows: 3, value: ed.desc||"",
                    onChange: e=>setEd({desc:e.target.value}),
                    placeholder: "How to perform this exercise, key cues…"      ,
                    style: {resize:"vertical",minHeight:70,fontFamily:"'Inter',sans-serif",lineHeight:1.5}})
                )

                /* Tips */
                , React.createElement('div', { className: "field"}
                  , React.createElement('label', null, "Form Tips (up to 3)"    )
                  , [0,1,2].map(ti=>(
                    React.createElement('input', { key: ti, className: "inp", style: {marginBottom:5},
                      value: (ed.tips||["","",""])[ti]||"",
                      onChange: e=>{const t=[...(ed.tips||["","",""])];t[ti]=e.target.value;setEd({tips:t});},
                      placeholder: `Tip ${ti+1}…`})
                  ))
                )

                /* ── Action Buttons ─────────────────── */
                , React.createElement('div', { className: "div"})
                , React.createElement('div', { style: {display:"flex",gap:8}}
                  , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>setExEditorOpen(false)}, "Cancel")
                  , React.createElement('button', { className: "btn btn-gold" , style: {flex:2}, onClick: saveExEditor}
                    , exEditorMode==="edit"?"✦ Save Changes":"⚔ Forge Technique"
                  )
                )
                , exEditorMode==="edit"&&(
                  React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {width:"100%",marginTop:5},
                    onClick: ()=>openExEditor("copy",ed)}, "⎘ Duplicate as New Exercise"

                  )
                )
                , exEditorMode==="edit"&&(
                  React.createElement('button', { className: "btn btn-danger" , style: {width:"100%",marginTop:8,padding:"10px",fontSize:".78rem"},
                    onClick: ()=>deleteCustomEx(ed.id)}, "🗑 Delete Exercise")
                )

              )
            )
          )
        );
      } catch(e) { console.error("Exercise editor render error:", e); return null; } })(), document.body)

      /* ══ EXERCISE DETAIL MODAL ══════════════════ */
      , detailEx && (
        React.createElement('div', { className: "modal-backdrop", onClick: ()=>setDetailEx(null)}
          , React.createElement('div', { className: "modal-sheet", onClick: e=>e.stopPropagation()}
            /* Image pair */
            , React.createElement('div', { className: "modal-img-row"}
              , detailEx.images.map((src,i)=>(
                React.createElement('img', { key: i, src: `${src}?w=420&h=260&fit=crop&q=80`, alt: detailEx.name,
                  className: "modal-img",
                  onError: e=>{e.target.style.display="none";e.target.nextSibling&&(e.target.nextSibling.style.display="flex");}}
                )
              ))
              /* Fallback placeholders hidden by default */
              , detailEx.images.map((_,i)=>(
                React.createElement('div', { key: `fb${i}`, className: "modal-img-placeholder", style: {display:"none"}}, detailEx.icon)
              ))
            )
            /* Body */
            , React.createElement('div', { className: "modal-body"}
              , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}
                , React.createElement('div', { className: "modal-title"}, detailEx.icon, " " , detailEx.name)
                , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setDetailEx(null)}, "✕")
              )
              , React.createElement('div', { className: "modal-muscles"}, detailEx.muscles)
              , React.createElement('p', { className: "modal-desc"}, detailEx.desc)
              , React.createElement('div', { className: "sec"}, "Form Tips" )
              , React.createElement('div', { className: "modal-tips"}
                , detailEx.tips.map((tip,i)=>React.createElement('div', { key: i, className: "modal-tip"}, tip))
              )
              , React.createElement('div', { className: "div"})
              , React.createElement('div', { style: {display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}
                , React.createElement('div', { style: {display:"flex",gap:8,flexWrap:"wrap"}}
                  , React.createElement('span', { style: {fontSize:".7rem",color:"#5a5650"}}, "Base XP: "  , React.createElement('span', { style: {color:"#b4ac9e",fontFamily:"'Inter',sans-serif"}}, detailEx.baseXP))
                  , React.createElement('span', { style: {fontSize:".7rem",color:"#5a5650"}}, "Category: " , React.createElement('span', { style: {color:"#b4ac9e",textTransform:"capitalize"}}, detailEx.category))
                  , cls&&React.createElement('span', { style: {fontSize:".7rem",color:"#5a5650"}}, "Mult: " , React.createElement('span', { style: {color:getMult(detailEx)>1.02?"#2ecc71":getMult(detailEx)<0.98?"#e74c3c":"#b4ac9e"}}, Math.round(getMult(detailEx)*100), "%"))
                )
, React.createElement('div', null)
              )
            )
          )
        )
      )

      /* ══ SAVE-TO-PLAN WIZARD ════════════════════ */
      , savePlanWizard && (
        React.createElement('div', { className: "spw-backdrop", onClick: ()=>setSavePlanWizard(null)}
          , React.createElement('div', { className: "spw-sheet", onClick: e=>e.stopPropagation()}
            , React.createElement('div', { className: "spw-hdr"}
              , React.createElement('div', null
                , React.createElement('div', { className: "spw-title"}, "📋 Save To Plan"   )
                , React.createElement('div', { style: {fontSize:".65rem",color:"#5a5650",marginTop:2}}, "Select exercises, then create a new plan or add to an existing one."            )
              )
              , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setSavePlanWizard(null)}, "✕")
            )
            , React.createElement('div', { className: "spw-body"}

              /* Exercise checklist */
              , React.createElement('div', null
                , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}
                  , React.createElement('label', null, "Exercises (" , spwSelected.length, "/", savePlanWizard.entries.length, " selected)" )
                  , React.createElement('div', { style: {display:"flex",gap:6}}
                    , React.createElement('button', { className: "btn btn-ghost btn-xs"  , onClick: ()=>setSpwSelected(savePlanWizard.entries.map(e=>e._idx))}, "All")
                    , React.createElement('button', { className: "btn btn-ghost btn-xs"  , onClick: ()=>setSpwSelected([])}, "None")
                  )
                )
                , React.createElement('div', { className: "spw-ex-list"}
                  , savePlanWizard.entries.map(e=>{
                    const sel = spwSelected.includes(e._idx);
                    return (
                      React.createElement('div', { key: e._idx, className: `spw-ex-row ${sel?"sel":""}`,
                        onClick: ()=>setSpwSelected(s=>sel?s.filter(i=>i!==e._idx):[...s,e._idx])}
                        , React.createElement('div', { className: "spw-check"}, sel?"✓":"")
                        , React.createElement('span', { className: "spw-ex-icon"}, e.icon)
                        , React.createElement('div', { style: {flex:1,minWidth:0}}
                          , React.createElement('div', { className: "spw-ex-name"}, e.exercise)
                          , React.createElement('div', { className: "spw-ex-meta"}, e.sets, "×", e.reps, e.weightLbs?" · "+(isMetric(profile.units)?lbsToKg(e.weightLbs)+" kg":e.weightLbs+" lbs"):"", "  +"  , e.xp, " XP" )
                        )
                      )
                    );
                  })
                )
              )

              /* Mode toggle */
              , React.createElement('div', { style: {display:"flex",borderRadius:9,overflow:"hidden",border:"1px solid rgba(180,172,158,.06)"}}
                , [["new","＋ New Plan"],["existing","Add to Existing"]].map(([m,lbl])=>(
                  React.createElement('button', { key: m, style: {flex:1,padding:"8px 4px",fontFamily:"'Inter',sans-serif",fontSize:".62rem",letterSpacing:".03em",cursor:"pointer",border:"none",borderRight:m==="new"?"1px solid rgba(180,172,158,.05)":"none",background:spwMode===m?"rgba(45,42,36,.3)":"rgba(45,42,36,.18)",color:spwMode===m?"#d4cec4":"#5a5650",transition:"all .18s"},
                    onClick: ()=>setSpwMode(m)}, lbl)
                ))
              )

              /* NEW PLAN fields */
              , spwMode==="new" && (React.createElement(React.Fragment, null
                , React.createElement('div', { className: "field"}
                  , React.createElement('label', null, "Plan Name" )
                  , React.createElement('input', { className: "inp", value: spwName, onChange: e=>setSpwName(e.target.value), placeholder: "Name your plan…"  })
                )
                , React.createElement('div', { className: "field"}
                  , React.createElement('label', null, "Icon")
                  , React.createElement('div', { className: "icon-row", style: {flexWrap:"wrap",gap:6}}
                    , ["📋","⚔️","🏋️","🔥","💪","🏃","🚴","🧘","⚡","🎯","🛡️","🏆","🌟","💥","🗡️"].map(ic=>(
                      React.createElement('div', { key: ic, className: `icon-opt ${spwIcon===ic?"sel":""}`, style: {fontSize:"1.2rem",width:36,height:36}, onClick: ()=>setSpwIcon(ic)}, ic)
                    ))
                  )
                )
                , React.createElement('div', { className: "field"}
                  , React.createElement('label', null, "Schedule for a Future Date "     , React.createElement('span', { style: {color:"#5a5650",fontWeight:"normal"}}, "(optional)"))
                  , React.createElement('input', { className: "inp", type: "date", min: todayStr(), value: spwDate, onChange: e=>setSpwDate(e.target.value)})
                  , spwDate&&React.createElement('div', { style: {fontSize:".65rem",color:"#b4ac9e",marginTop:4}}, "📅 "
                     , formatScheduledDate(spwDate), " · "  , (()=>{const d=daysUntil(spwDate); return d===0?"Today":d===1?"Tomorrow":d+" days from now";})()
                  )
                )
              ))

              /* EXISTING PLAN picker */
              , spwMode==="existing" && (React.createElement(React.Fragment, null
                , profile.plans.length===0
                  ? React.createElement('div', { className: "empty", style: {padding:"14px 0"}}, "No plans yet — create one first!"      )
                  : profile.plans.map(pl=>(
                    React.createElement('div', { key: pl.id, className: "atp-plan-row",
                      style: {borderColor:spwTargetPlanId===pl.id?"rgba(180,172,158,.15)":"rgba(45,42,36,.22)",background:spwTargetPlanId===pl.id?"rgba(45,42,36,.2)":"rgba(45,42,36,.12)"},
                      onClick: ()=>setSpwTargetPlanId(pl.id)}
                      , React.createElement('span', { style: {fontSize:"1.3rem"}}, pl.icon)
                      , React.createElement('div', { style: {flex:1,minWidth:0}}
                        , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".72rem",color:"#d4cec4"}}, pl.name)
                        , React.createElement('div', { style: {fontSize:".6rem",color:"#5a5650"}}, pl.days.length, " day" , pl.days.length!==1?"s":"", " · "  , pl.days.reduce((s,d)=>s+d.exercises.length,0), " exercises" )
                      )
                      , React.createElement('div', { style: {width:18,height:18,border:"1.5px solid rgba(180,172,158,.08)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".7rem",flexShrink:0,background:spwTargetPlanId===pl.id?"rgba(180,172,158,.25)":"transparent",color:spwTargetPlanId===pl.id?"#1a1200":"transparent"}}, "✓")
                    )
                  ))
                
              ))

              , React.createElement('div', { className: "div"})
              , React.createElement('div', { style: {display:"flex",gap:8}}
                , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>setSavePlanWizard(null)}, "Cancel")
                , React.createElement('button', { className: "btn btn-gold" , style: {flex:2}, onClick: confirmSavePlanWizard}
                  , spwMode==="existing"?"📋 Add to Plan":"💾 Save New Plan", spwMode==="new"&&spwDate?" & Schedule":""
                )
              )
            )
          )
        )
      )

      /* ══ SCHEDULE PICKER ════════════════════════ */
      , schedulePicker && (
        React.createElement('div', { className: "sched-backdrop", onClick: ()=>setSchedulePicker(null)}
          , React.createElement('div', { className: "sched-sheet", onClick: e=>e.stopPropagation()}
            , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between"}}
              , React.createElement('div', { className: "sched-title"}, "📅 Schedule Workout"  )
              , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setSchedulePicker(null)}, "✕")
            )

            /* Target card */
            , React.createElement('div', { className: "sched-target"}
              , React.createElement('div', { className: "sched-target-icon"}
                , schedulePicker.type==="plan" ? schedulePicker.plan.icon : schedulePicker.icon
              )
              , React.createElement('div', null
                , React.createElement('div', { className: "sched-target-name"}
                  , schedulePicker.type==="plan" ? schedulePicker.plan.name : schedulePicker.name
                )
                , React.createElement('div', { className: "sched-target-type"}
                  , schedulePicker.type==="plan" ? "Workout Plan" : "Exercise"
                )
              )
            )

            /* Date picker */
            , React.createElement('div', { className: "field"}
              , React.createElement('label', null, "Scheduled Date" )
              , React.createElement('input', { className: "inp", type: "date",
                min: todayStr(),
                value: spDate, onChange: e=>setSpDate(e.target.value)})
              , spDate&&React.createElement('div', { style: {fontSize:".65rem",color:"#b4ac9e",marginTop:4}}
                , (()=>{const d=daysUntil(spDate); return d===0?"Today — let's go! 🔥":d===1?"Tomorrow ⚡":d+" days from now";})(), " — "  , formatScheduledDate(spDate)
              )
            )

            /* Notes */
            , React.createElement('div', { className: "field"}
              , React.createElement('label', null, "Notes " , React.createElement('span', { style: {color:"#5a5650",fontWeight:"normal"}}, "(optional)"))
              , React.createElement('input', { className: "inp", value: spNotes, onChange: e=>setSpNotes(e.target.value), placeholder: "e.g. Morning session, skip leg day…"     })
            )

            /* If there's already a schedule, offer to clear it */
            , schedulePicker.type==="plan" && schedulePicker.plan.scheduledDate && (
              React.createElement('div', { style: {fontSize:".65rem",color:"#8a8478",fontStyle:"italic"}}, "Currently scheduled: "
                  , formatScheduledDate(schedulePicker.plan.scheduledDate)
                , React.createElement('span', { className: "upcoming-del", style: {marginLeft:8,display:"inline"},
                  onClick: ()=>{removePlanSchedule(schedulePicker.plan.id);setSchedulePicker(null);}}, "Clear ✕"

                )
              )
            )

            , React.createElement('div', { style: {display:"flex",gap:8}}
              , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>setSchedulePicker(null)}, "Cancel")
              , React.createElement('button', { className: "btn btn-gold" , style: {flex:2}, onClick: confirmSchedule}, "📅 Schedule" )
            )
          )
        )
      )

      /* ══ SAVE-AS-WORKOUT WIZARD ═════════════════ */
      , saveWorkoutWizard && (
        React.createElement('div', { className: "saw-backdrop", onClick: ()=>setSaveWorkoutWizard(null)}
          , React.createElement('div', { className: "saw-sheet", onClick: e=>e.stopPropagation()}
            , React.createElement('div', { className: "spw-hdr"}
              , React.createElement('div', null
                , React.createElement('div', { className: "spw-title"}, "💪 Save As Workout"   )
                , React.createElement('div', { style: {fontSize:".65rem",color:"#5a5650",marginTop:2}}, "Select exercises and save as a reusable workout."       )
              )
              , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setSaveWorkoutWizard(null)}, "✕")
            )
            , React.createElement('div', { className: "spw-body"}
              /* Exercise checklist */
              , React.createElement('div', null
                , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}
                  , React.createElement('label', null, "Exercises (" , swwSelected.length, "/", saveWorkoutWizard.entries.length, " selected)" )
                  , React.createElement('div', { style: {display:"flex",gap:6}}
                    , React.createElement('button', { className: "btn btn-ghost btn-xs"  , onClick: ()=>setSwwSelected(saveWorkoutWizard.entries.map(e=>e._idx))}, "All")
                    , React.createElement('button', { className: "btn btn-ghost btn-xs"  , onClick: ()=>setSwwSelected([])}, "None")
                  )
                )
                , React.createElement('div', { className: "spw-ex-list"}
                  , saveWorkoutWizard.entries.map(e=>{
                    const sel = swwSelected.includes(e._idx);
                    return (
                      React.createElement('div', { key: e._idx, className: `spw-ex-row ${sel?"sel":""}`,
                        onClick: ()=>setSwwSelected(s=>sel?s.filter(i=>i!==e._idx):[...s,e._idx])}
                        , React.createElement('div', { className: "spw-check"}, sel?"✓":"")
                        , React.createElement('span', { className: "spw-ex-icon"}, e.icon)
                        , React.createElement('div', { style: {flex:1,minWidth:0}}
                          , React.createElement('div', { className: "spw-ex-name"}, e.exercise)
                          , React.createElement('div', { className: "spw-ex-meta"}, e.sets, "×", e.reps, e.weightLbs?" · "+(isMetric(profile.units)?lbsToKg(e.weightLbs)+" kg":e.weightLbs+" lbs"):"", "  +"  , e.xp, " XP" )
                        )
                      )
                    );
                  })
                )
              )
              /* Workout name */
              , React.createElement('div', { className: "field"}
                , React.createElement('label', null, "Workout Name" )
                , React.createElement('input', { className: "inp", value: swwName, onChange: e=>setSwwName(e.target.value), placeholder: "Name your workout…"  })
              )
              /* Icon */
              , React.createElement('div', { className: "field"}
                , React.createElement('label', null, "Icon")
                , React.createElement('div', { className: "icon-row", style: {flexWrap:"wrap",gap:6}}
                  , ["💪","🏋️","🔥","⚔️","🏃","🚴","🧘","⚡","🎯","🛡️","🏆","🌟","💥","🗡️","🥊"].map(ic=>(
                    React.createElement('div', { key: ic, className: `icon-opt ${swwIcon===ic?"sel":""}`, style: {fontSize:"1.2rem",width:36,height:36}, onClick: ()=>setSwwIcon(ic)}, ic)
                  ))
                )
              )
              , React.createElement('div', { className: "div"})
              , React.createElement('div', { style: {display:"flex",gap:8}}
                , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>setSaveWorkoutWizard(null)}, "Cancel")
                , React.createElement('button', { className: "btn btn-gold" , style: {flex:2}, onClick: confirmSaveWorkoutWizard}, "💪 Save Workout"  )
              )
            )
          )
        )
      )

      /* ══ WORKOUT EXERCISE PICKER ═════════════════ */
      , wbExPickerOpen && (
        React.createElement('div', { className: "ex-picker-backdrop", onClick: e=>{e.stopPropagation();if(!pickerConfigOpen)closePicker();}}
          , React.createElement('div', { className: "ex-picker-sheet", onClick: e=>e.stopPropagation(), style: {maxHeight:"85vh"}}
            , !pickerConfigOpen ? React.createElement(React.Fragment, null
              /* ── BROWSE VIEW — Charcoal Inset style ── */
              , React.createElement('div', {style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}
                , React.createElement('div', {style:{fontFamily:"'Inter',sans-serif",fontSize:".72rem",fontWeight:600,color:"#8a8478"}},
                    "Add to Workout", pickerSelected.length>0&&React.createElement('span',{style:{color:"#b4ac9e",marginLeft:6}},pickerSelected.length+" selected"))
                , React.createElement('div', {style:{display:"flex",gap:6}},
                    pickerSelected.length>0&&React.createElement('button',{className:"btn btn-gold btn-xs",onClick:()=>setPickerConfigOpen(true)},"Configure & Add →"),
                    React.createElement('button',{className:"btn btn-ghost btn-xs",onClick:()=>{closePicker();openExEditor("create",null);}},"✦ New Custom"),
                    React.createElement('button',{className:"btn btn-ghost btn-sm",onClick:closePicker},"✕")
                )
              )
              /* Search bar */
              , React.createElement('div', {style:{marginBottom:8}},
                React.createElement('input', {className:"inp",style:{width:"100%",padding:"7px 11px",fontSize:".82rem"},
                  placeholder:"Search exercises…", value:pickerSearch,
                  onChange:e=>setPickerSearch(e.target.value), autoFocus:true})
              )
              /* Filter dropdowns — mirrors Library */
              , (()=>{
                const PTYPE_LABELS = {strength:"⚔️ Strength",cardio:"🏃 Cardio",flexibility:"🧘 Flex",yoga:"🧘 Yoga",stretching:"🌿 Stretch",plyometric:"⚡ Plyo",calisthenics:"🤸 Cali"};
                const PTYPE_OPTS   = Object.keys(PTYPE_LABELS);
                const PEQUIP_OPTS  = ["barbell","dumbbell","kettlebell","cable","machine","bodyweight","band"];
                const PMUSCLE_OPTS = ["chest","back","shoulder","bicep","tricep","legs","glutes","abs","calves","forearm","cardio"];
                const closeDrops   = () => setPickerOpenDrop(null);
                return React.createElement('div', {style:{position:"relative",marginBottom:10}},
                  pickerOpenDrop && React.createElement('div',{onClick:closeDrops,style:{position:"fixed",inset:0,zIndex:19}}),
                  React.createElement('div', {style:{display:"flex",gap:7}},
                    /* Muscle */
                    React.createElement('div', {style:{position:"relative",flex:1,zIndex:20}},
                      React.createElement('button', {
                        onClick:()=>setPickerOpenDrop(d=>d==="muscle"?null:"muscle"),
                        style:{width:"100%",padding:"6px 24px 6px 9px",borderRadius:8,border:"1px solid "+(pickerMuscle!=="All"?"#b4ac9e":"rgba(45,42,36,.3)"),background:"rgba(14,14,12,.95)",color:pickerMuscle!=="All"?"#b4ac9e":"#8a8478",fontSize:".68rem",textAlign:"left",cursor:"pointer",position:"relative"}
                      },
                        pickerMuscle==="All"?"Muscle":pickerMuscle.charAt(0).toUpperCase()+pickerMuscle.slice(1),
                        React.createElement('span',{style:{position:"absolute",right:7,top:"50%",transform:"translateY(-50%) rotate("+(pickerOpenDrop==="muscle"?"180deg":"0deg")+")",fontSize:".55rem",color:pickerMuscle!=="All"?"#b4ac9e":"#5a5650",transition:"transform .15s"}},"▼")
                      ),
                      pickerOpenDrop==="muscle" && React.createElement('div',{style:{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:"100%",background:"rgba(16,14,10,.95)",border:"1px solid rgba(180,172,158,.06)",borderRadius:8,padding:"5px 3px",zIndex:21,boxShadow:"0 8px 24px rgba(0,0,0,.7)"}},
                        React.createElement('div',{onClick:()=>{setPickerMuscle("All");closeDrops();},style:{padding:"6px 10px",fontSize:".72rem",cursor:"pointer",borderRadius:5,color:pickerMuscle==="All"?"#b4ac9e":"#8a8478",background:pickerMuscle==="All"?"rgba(45,42,36,.2)":"transparent"}},"All Muscles"),
                        PMUSCLE_OPTS.map(m=>React.createElement('div',{key:m,onClick:()=>{setPickerMuscle(m);closeDrops();},style:{padding:"6px 10px",fontSize:".72rem",cursor:"pointer",borderRadius:5,color:pickerMuscle===m?getMuscleColor(m):"#8a8478",background:pickerMuscle===m?"rgba(45,42,36,.2)":"transparent",textTransform:"capitalize"}},m))
                      )
                    ),
                    /* Type */
                    React.createElement('div', {style:{position:"relative",flex:1,zIndex:20}},
                      React.createElement('button', {
                        onClick:()=>setPickerOpenDrop(d=>d==="type"?null:"type"),
                        style:{width:"100%",padding:"6px 24px 6px 9px",borderRadius:8,border:"1px solid "+(pickerTypeFilter!=="all"?"#d4cec4":"rgba(45,42,36,.3)"),background:"rgba(14,14,12,.95)",color:pickerTypeFilter!=="all"?"#d4cec4":"#8a8478",fontSize:".68rem",textAlign:"left",cursor:"pointer",position:"relative"}
                      },
                        pickerTypeFilter==="all"?"Type":(PTYPE_LABELS[pickerTypeFilter]||pickerTypeFilter),
                        React.createElement('span',{style:{position:"absolute",right:7,top:"50%",transform:"translateY(-50%) rotate("+(pickerOpenDrop==="type"?"180deg":"0deg")+")",fontSize:".55rem",color:pickerTypeFilter!=="all"?"#d4cec4":"#5a5650",transition:"transform .15s"}},"▼")
                      ),
                      pickerOpenDrop==="type" && React.createElement('div',{style:{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:"100%",background:"rgba(16,14,10,.95)",border:"1px solid rgba(180,172,158,.06)",borderRadius:8,padding:"5px 3px",zIndex:21,boxShadow:"0 8px 24px rgba(0,0,0,.7)"}},
                        React.createElement('div',{onClick:()=>{setPickerTypeFilter("all");closeDrops();},style:{padding:"6px 10px",fontSize:".72rem",cursor:"pointer",borderRadius:5,color:pickerTypeFilter==="all"?"#d4cec4":"#8a8478",background:pickerTypeFilter==="all"?"rgba(45,42,36,.2)":"transparent"}},"All Types"),
                        PTYPE_OPTS.map(t=>React.createElement('div',{key:t,onClick:()=>{setPickerTypeFilter(t);closeDrops();},style:{padding:"6px 10px",fontSize:".72rem",cursor:"pointer",borderRadius:5,color:pickerTypeFilter===t?getTypeColor(t):"#8a8478",background:pickerTypeFilter===t?"rgba(45,42,36,.2)":"transparent"}},PTYPE_LABELS[t]))
                      )
                    ),
                    /* Equipment */
                    React.createElement('div', {style:{position:"relative",flex:1,zIndex:20}},
                      React.createElement('button', {
                        onClick:()=>setPickerOpenDrop(d=>d==="equip"?null:"equip"),
                        style:{width:"100%",padding:"6px 24px 6px 9px",borderRadius:8,border:"1px solid "+(pickerEquipFilter!=="all"?"#9b59b6":"rgba(45,42,36,.3)"),background:"rgba(14,14,12,.95)",color:pickerEquipFilter!=="all"?"#9b59b6":"#8a8478",fontSize:".68rem",textAlign:"left",cursor:"pointer",position:"relative"}
                      },
                        pickerEquipFilter==="all"?"Equipment":pickerEquipFilter.charAt(0).toUpperCase()+pickerEquipFilter.slice(1),
                        React.createElement('span',{style:{position:"absolute",right:7,top:"50%",transform:"translateY(-50%) rotate("+(pickerOpenDrop==="equip"?"180deg":"0deg")+")",fontSize:".55rem",color:pickerEquipFilter!=="all"?"#9b59b6":"#5a5650",transition:"transform .15s"}},"▼")
                      ),
                      pickerOpenDrop==="equip" && React.createElement('div',{style:{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:"100%",background:"rgba(16,14,10,.95)",border:"1px solid rgba(180,172,158,.06)",borderRadius:8,padding:"5px 3px",zIndex:21,boxShadow:"0 8px 24px rgba(0,0,0,.7)"}},
                        React.createElement('div',{onClick:()=>{setPickerEquipFilter("all");closeDrops();},style:{padding:"6px 10px",fontSize:".72rem",cursor:"pointer",borderRadius:5,color:pickerEquipFilter==="all"?"#9b59b6":"#8a8478",background:pickerEquipFilter==="all"?"rgba(155,89,182,.12)":"transparent"}},"All Equipment"),
                        PEQUIP_OPTS.map(e=>React.createElement('div',{key:e,onClick:()=>{setPickerEquipFilter(e);closeDrops();},style:{padding:"6px 10px",fontSize:".72rem",cursor:"pointer",borderRadius:5,color:pickerEquipFilter===e?"#9b59b6":"#8a8478",background:pickerEquipFilter===e?"rgba(155,89,182,.12)":"transparent",textTransform:"capitalize"}},e))
                      )
                    )
                  )
                );
              })()
              /* Exercise list — Charcoal Inset */
              , (()=>{
                const q   = pickerSearch.toLowerCase().trim();
                const filtered = allExercises.filter(e=>{
                  if(e.id==="rest_day") return false; // Rest Day is plan-only
                  if(pickerMuscle!=="All" && e.muscleGroup!==pickerMuscle) return false;
                  if(pickerTypeFilter!=="all"){
                    const ty=(e.exerciseType||"").toLowerCase(), ca=(e.category||"").toLowerCase();
                    if(!ty.includes(pickerTypeFilter) && ca!==pickerTypeFilter) return false;
                  }
                  if(pickerEquipFilter!=="all" && (e.equipment||"bodyweight").toLowerCase()!==pickerEquipFilter) return false;
                  if(q && !e.name.toLowerCase().includes(q)) return false;
                  return true;
                });
                if(filtered.length===0) return React.createElement('div',{className:"empty",style:{padding:"20px 0"}},"No exercises found.");
                const selIds = new Set(pickerSelected.map(e=>e.exId));
                const visible = filtered.slice(0,80);
                const clsData = profile.chosenClass?CLASSES[profile.chosenClass]:null;
                return React.createElement(React.Fragment, null,
                  React.createElement('div',{style:{fontSize:".62rem",color:"#5a5650",marginBottom:6,textAlign:"right"}},
                    (q||pickerMuscle!=="All"||pickerTypeFilter!=="all"||pickerEquipFilter!=="all")
                      ? filtered.length+" match"+(filtered.length!==1?"es":"")
                      : "Showing 80 of "+filtered.length+" · search or filter"),
                  React.createElement('div',{style:{display:"flex",flexDirection:"column",gap:5}},
                    visible.map(ex=>{
                      const sel = selIds.has(ex.id);
                      const diffLabel = ex.difficulty||(ex.baseXP>=60?"Advanced":ex.baseXP>=45?"Intermediate":"Beginner");
                      const diffColor = diffLabel==="Advanced"?"#7A2838":diffLabel==="Beginner"?"#5A8A58":"#A8843C";
                      const diffBg    = diffLabel==="Advanced"?"#2e1515":diffLabel==="Beginner"?"#1a2e1a":"#2e2010";
                      const subParts  = [ex.category?ex.category.charAt(0).toUpperCase()+ex.category.slice(1):null, ex.muscleGroup?ex.muscleGroup.charAt(0).toUpperCase()+ex.muscleGroup.slice(1):null].filter(Boolean).join(" · ");
                      const exMgColor = getMuscleColor(ex.muscleGroup);
                      return React.createElement('div',{
                        key:ex.id,
                        className:`picker-ex-row${sel?" sel":""}`,
                        onClick:()=>pickerToggleEx(ex.id),
                        style:{"--mg-color":exMgColor}
                      },
                        React.createElement('div',{className:"picker-ex-orb"},
                          React.createElement(ExIcon,{ex:ex,size:".95rem",color:"#d4cec4"})
                        ),
                        React.createElement('div',{style:{flex:1,minWidth:0}},
                          React.createElement('div',{style:{fontSize:".8rem",fontWeight:600,color:sel?"#d4cec4":"#d4cec4",marginBottom:2}},
                            ex.name, ex.custom&&React.createElement('span',{className:"custom-ex-badge",style:{marginLeft:4}},"custom")),
                          React.createElement('div',{style:{fontSize:".6rem",fontStyle:"italic"}}, ex.category&&React.createElement('span',{style:{color:getTypeColor(ex.category)}},ex.category.charAt(0).toUpperCase()+ex.category.slice(1)), ex.category&&ex.muscleGroup&&React.createElement('span',{style:{color:"#5a5650"}}," · "), ex.muscleGroup&&React.createElement('span',{style:{color:getMuscleColor(ex.muscleGroup)}},ex.muscleGroup.charAt(0).toUpperCase()+ex.muscleGroup.slice(1)))
                        ),
                        React.createElement('div',{style:{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}},
                          React.createElement('span',{style:{fontSize:".63rem",fontWeight:700,color:"#b4ac9e"}},ex.baseXP+" XP"),
                          React.createElement('span',{style:{fontSize:".56rem",fontWeight:700,color:diffColor,background:diffBg,padding:"1px 6px",borderRadius:3,letterSpacing:".04em"}},diffLabel)
                        )
                      );
                    })
                  )
                );
              })()
            ) : React.createElement(React.Fragment, null
              /* ── CONFIG VIEW ── */
              , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}
                , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setPickerConfigOpen(false)}, "← Back" )
                , React.createElement('div', { className: "sec", style: {margin:0,border:"none",padding:0}}, "Configure " , pickerSelected.length, " Exercise" , pickerSelected.length!==1?"s":"")
                , React.createElement('button', { className: "btn btn-gold btn-sm"  , onClick: commitPickerToWorkout}, "Add to Workout ✓"   )
              )
              , pickerSelected.map((entry)=>{
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
                      , React.createElement('span', { style: {fontSize:".65rem",cursor:"pointer",color:"#e74c3c"}, onClick: ()=>setPickerSelected(p=>p.filter(e=>e.exId!==entry.exId))}, "✕")
                    )
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
                    , isTreadEx&&(
                      React.createElement('div', { style: {display:"flex",gap:6,marginBottom:6}}
                        , React.createElement('div', { className: "field", style: {flex:1,marginBottom:0}}
                          , React.createElement('label', null, "Incline (0.5–15)" )
                          , React.createElement('input', { className: "inp", style: {padding:"6px 8px"}, type: "number", min: "0.5", max: "15", step: "0.5", value: entry.incline||"", onChange: e=>pickerUpdateEx(entry.exId,"incline",e.target.value?parseFloat(e.target.value):null), placeholder: "—"})
                        )
                        , React.createElement('div', { className: "field", style: {flex:1,marginBottom:0}}
                          , React.createElement('label', null, "Speed (0.5–15)" )
                          , React.createElement('input', { className: "inp", style: {padding:"6px 8px"}, type: "number", min: "0.5", max: "15", step: "0.5", value: entry.speed||"", onChange: e=>pickerUpdateEx(entry.exId,"speed",e.target.value?parseFloat(e.target.value):null), placeholder: "—"})
                        )
                      )
                    )
                    , (entry.extraRows||[]).map((row,ri)=>(
                      React.createElement('div', { key: ri, style: {display:"flex",gap:4,marginBottom:4,padding:"5px 7px",background:"rgba(45,42,36,.18)",borderRadius:5,alignItems:"center",flexWrap:"wrap"}}
                        , React.createElement('span', { style: {fontSize:".55rem",color:"#9a8a78",flexShrink:0,minWidth:16}}, isCardio?`I${ri+2}`:`S${ri+2}`)
                        , isCardio ? (React.createElement(React.Fragment, null
                          , React.createElement('input', { className: "inp", style: {flex:1.5,minWidth:50,padding:"4px 7px",fontSize:".72rem"}, type: "text", inputMode: "numeric", placeholder: "HH:MM",
                            value: row.hhmm||"",
                            onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],hhmm:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);},
                            onBlur: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],hhmm:normalizeHHMM(e.target.value)};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                          , React.createElement('input', { className: "inp", style: {flex:0.7,minWidth:36,padding:"4px 7px",fontSize:".72rem"}, type: "number", min: "0", max: "59", placeholder: "Sec", value: row.sec||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],sec:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                          , React.createElement('input', { className: "inp", style: {flex:1,minWidth:40,padding:"4px 7px",fontSize:".72rem"}, type: "text", inputMode: "decimal", placeholder: dUnit, value: row.distanceMi||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],distanceMi:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                          , isTreadEx&&React.createElement('input', { className: "inp", style: {flex:0.7,minWidth:34,padding:"4px 7px",fontSize:".72rem"}, type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "Inc", value: row.incline||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],incline:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                          , isTreadEx&&React.createElement('input', { className: "inp", style: {flex:0.7,minWidth:34,padding:"4px 7px",fontSize:".72rem"}, type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "Spd", value: row.speed||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],speed:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                        )) : (React.createElement(React.Fragment, null
                          , !noSets&&React.createElement('input', { className: "inp", style: {flex:1,minWidth:40,padding:"4px 7px",fontSize:".72rem"}, type: "text", inputMode: "decimal", placeholder: "Sets", value: row.sets||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],sets:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                          , React.createElement('input', { className: "inp", style: {flex:1,minWidth:40,padding:"4px 7px",fontSize:".72rem"}, type: "text", inputMode: "decimal", placeholder: "Reps", value: row.reps||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],reps:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                          , React.createElement('input', { className: "inp", style: {flex:1,minWidth:40,padding:"4px 7px",fontSize:".72rem"}, type: "text", inputMode: "decimal", placeholder: wUnit, value: row.weightLbs||"", onChange: e=>{const rr=[...(entry.extraRows||[])];rr[ri]={...rr[ri],weightLbs:e.target.value};pickerUpdateEx(entry.exId,"extraRows",rr);}})
                        ))
                        , React.createElement('button', { className: "btn btn-danger btn-xs"  , style: {padding:"2px 4px",flexShrink:0}, onClick: ()=>{const rr=(entry.extraRows||[]).filter((_,j)=>j!==ri);pickerUpdateEx(entry.exId,"extraRows",rr);}}, "✕")
                      )
                    ))
                    , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {width:"100%",marginTop:4,fontSize:".6rem",color:"#8a8478",borderStyle:"dashed"},
                      onClick: ()=>{const rr=[...(entry.extraRows||[]),isCardio?{hhmm:"",sec:"",distanceMi:"",incline:"",speed:""}:{sets:"",reps:"",weightLbs:""}];pickerUpdateEx(entry.exId,"extraRows",rr);}}, "＋ Add Row (e.g. "
                          , isCardio?"interval":"progressive set", ")"
                    )
                  )
                );
              })
            )
          )
        )
      )

      /* ══ ADD WORKOUT TO PLAN PICKER ══════════════ */
      , addToPlanPicker && (
        React.createElement('div', { className: "atp-backdrop", onClick: ()=>setAddToPlanPicker(null)}
          , React.createElement('div', { className: "atp-sheet", onClick: e=>e.stopPropagation()}
            , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between"}}
              , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".84rem",color:"#d4cec4"}}, "📋 Add to Plan"   )
              , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setAddToPlanPicker(null)}, "✕")
            )
            , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:9,padding:"10px 12px",borderRadius:9,background:"rgba(45,42,36,.18)",border:"1px solid rgba(180,172,158,.06)"}}
              , React.createElement('span', { style: {fontSize:"1.4rem"}}, addToPlanPicker.workout.icon)
              , React.createElement('div', null
                , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".76rem",color:"#d4cec4"}}, addToPlanPicker.workout.name)
                , React.createElement('div', { style: {fontSize:".6rem",color:"#5a5650"}}, addToPlanPicker.workout.exercises.length, " exercises will be added as a new day"        )
              )
            )
            , profile.plans.length===0
              ? React.createElement('div', { className: "empty", style: {padding:"14px 0"}}, "No plans yet. Create a plan first in the Plans tab."          )
              : profile.plans.map(pl=>(
                React.createElement('div', { key: pl.id, className: "atp-plan-row", onClick: ()=>addWorkoutToPlan(addToPlanPicker.workout, pl.id)}
                  , React.createElement('span', { style: {fontSize:"1.3rem"}}, pl.icon)
                  , React.createElement('div', { style: {flex:1,minWidth:0}}
                    , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".72rem",color:"#d4cec4"}}, pl.name)
                    , React.createElement('div', { style: {fontSize:".6rem",color:"#5a5650"}}, pl.days.length, " day" , pl.days.length!==1?"s":"", " · currently "   , pl.days.reduce((s,d)=>s+d.exercises.length,0), " exercises" )
                  )
                  , React.createElement('span', { style: {fontSize:".7rem",color:"#b4ac9e"}}, "→")
                )
              ))
            
            , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {width:"100%"}, onClick: ()=>setAddToPlanPicker(null)}, "Cancel")
          )
        )
      )

      /* ══ RETRO CHECK-IN MODAL ════════════════════ */
      , retroCheckInModal && (
        React.createElement('div', { className: "cdel-backdrop", onClick: ()=>setRetroCheckInModal(false)}
          , React.createElement('div', { className: "cdel-sheet", style: {borderColor:"rgba(180,172,158,.08)",background:"linear-gradient(160deg,#0c0c0a,#0c0c0a)"}, onClick: e=>e.stopPropagation()}
            , React.createElement('div', { className: "cdel-icon"}, "🔥")
            , React.createElement('div', { className: "cdel-title"}, "Retro Check-In" )
            , React.createElement('div', { className: "cdel-body"}, "Forgot to check in? Log a past gym visit here. Each day awards +125 XP and updates your streak."

            )
            , React.createElement('div', { className: "field", style: {margin:0}}
              , React.createElement('label', null, "Select Date" )
              , React.createElement('input', { className: "inp", type: "date",
                value: retroDate,
                max: todayStr(),
                onChange: e=>setRetroDate(e.target.value)})
              , retroDate&&(()=>{
                const d = new Date(retroDate+"T12:00:00");
                const already = (profile.checkInHistory||[]).includes(retroDate);
                return (
                  React.createElement('div', { style: {fontSize:".68rem",marginTop:5,color:already?"#e74c3c":"#b4ac9e"}}
                    , already
                      ? "⚠ Already checked in for "+d.toLocaleDateString([],{weekday:"long",month:"long",day:"numeric"})
                      : "📅 "+d.toLocaleDateString([],{weekday:"long",month:"long",day:"numeric",year:"numeric"})
                  )
                );
              })()
            )
            /* Recent history preview */
            , (profile.checkInHistory||[]).length>0&&(
              React.createElement('div', { style: {fontSize:".6rem",color:"#5a5650"}}
                , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",letterSpacing:".06em",marginBottom:4}}, "Recent Check-Ins" )
                , React.createElement('div', { style: {display:"flex",flexWrap:"wrap",gap:4}}
                  , [...(profile.checkInHistory||[])].sort().reverse().slice(0,14).map(d=>{
                    const date = new Date(d+"T12:00:00");
                    const isToday = d===todayStr();
                    return (
                      React.createElement('span', { key: d, style: {padding:"2px 7px",borderRadius:4,background:isToday?"rgba(45,42,36,.26)":"rgba(45,42,36,.15)",border:`1px solid ${isToday?"rgba(180,172,158,.08)":"rgba(180,172,158,.06)"}`,color:isToday?"#d4cec4":"#5a5650"}}
                        , date.toLocaleDateString([],{month:"short",day:"numeric"})
                      )
                    );
                  })
                )
              )
            )
            , React.createElement('div', { style: {display:"flex",gap:8}}
              , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>setRetroCheckInModal(false)}, "Cancel")
              , React.createElement('button', { className: "btn btn-gold" , style: {flex:2},
                disabled: !retroDate||(profile.checkInHistory||[]).includes(retroDate),
                onClick: doRetroCheckIn}, "🔥 Log Check-In"

              )
            )
          )
        )
      )

      /* ══ WORKOUT COMPLETION MODAL ════════════════ */
      /* ══ ONE-OFF NAMING MODAL ════════════════════ */
      /* ══ SINGLE EXERCISE QUICK-LOG MODAL ════════ */
      , selEx&&(()=>{
        const ex = allExById[selEx];
        if(!ex) return null;
        const metric=isMetric(profile.units);
        const isCardio=ex.category==="cardio";
        const isFlex=ex.category==="flexibility";
        const showWeight=!isCardio&&!isFlex;
        const showHR=isCardio;
        const showDist=isCardio;
        const noSets=NO_SETS_EX_IDS.has(ex.id);
        const isRunning=ex.id===RUNNING_EX_ID;
        const isTreadmill=ex.hasTreadmill||false;
        const age=profile.age||30;
        const rawW=parseFloat(exWeight||0);
        const wLbs=metric?parseFloat(kgToLbs(rawW)||0):rawW;
        const effW=wLbs;
        const effWDisp=metric?lbsToKg(effW):effW;
        const wUnit=weightLabel(profile.units);
        const dUnit=distLabel(profile.units);
        const rawDist=parseFloat(distanceVal||0);
        const distMi=rawDist>0?(metric?parseFloat(kmToMi(rawDist)):rawDist):0;
        const pbPaceMi=profile.runningPB||null;
        const pbDisp=pbPaceMi?(metric?`${(pbPaceMi/1.60934).toFixed(2)} min/km`:`${pbPaceMi.toFixed(2)} min/mi`):null;
        const exPB4=(profile.exercisePBs||{})[ex.id]||null;
        const pbWeightDisp=(v)=>(metric?parseFloat(lbsToKg(v)).toFixed(1):v)+(metric?" kg":" lbs");
        const exPBDisp4=exPB4?(
          exPB4.type==="Cardio Pace"
            ? (metric?(exPB4.value/1.60934).toFixed(2)+" min/km":exPB4.value.toFixed(2)+" min/mi")
          : exPB4.type==="Assisted Weight"
            ? "1RM: "+pbWeightDisp(exPB4.value)+" (Assisted)"
          : exPB4.type==="Max Reps Per 1 Set"
            ? exPB4.value+" reps"
          : (exPB4.type==="Longest Hold"||exPB4.type==="Fastest Time")
            ? parseFloat(exPB4.value.toFixed(2))+" min"
          : exPB4.type==="Heaviest Weight"
            ? pbWeightDisp(exPB4.value)
          : "1RM: "+pbWeightDisp(exPB4.value)
        ):null;
        const durationMin=parseFloat(reps||0);
        const runPace=(isRunning&&distMi>0&&durationMin>0)?durationMin/distMi:null;
        const runBoostPct=runPace?(runPace<=8?20:5):0;
        const estXP=(()=>{
          const sv=noSets?1:(parseInt(sets)||0);
          const rv=isCardio||isFlex ? Math.max(1,Math.floor(combineHHMMSec(exHHMM,exSec)/60)||parseInt(reps)||1) : (parseInt(reps)||0);
          const baseXP=calcExXP(ex.id,sv,rv,profile.chosenClass,allExById,distMi||null);
          const zb=showHR&&hrZone?1+(hrZone-1)*0.04:1;
          const wb=effW>0?1+Math.min(effW/500,0.3):1;
          const pb=1+(runBoostPct/100);
          const intBoost=(isCardio&&quickRows.length>0)?1.25:1;
          // Add XP from extra rows
          const rowsXP=quickRows.reduce((s,row)=>{
            const rs=noSets?1:(parseInt(row.sets)||sv);
            const rr=isCardio||isFlex?(Math.max(1,Math.floor(combineHHMMSec(row.hhmm||"",row.sec||"")/60))||rv):(parseInt(row.reps)||rv);
            return s+Math.round(calcExXP(ex.id,rs,rr,profile.chosenClass,allExById,parseFloat(row.dist)||distMi||null)*zb*wb*pb*intBoost);
          },0);
          return (Math.round(baseXP*zb*wb*pb*intBoost)+rowsXP).toLocaleString();
        })();
        try { return (
          React.createElement('div', { style: {position:"fixed",inset:0,background:"rgba(0,0,0,.78)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center"},
            onClick: ()=>{setSelEx(null);setExHHMM("");setExSec("");setQuickRows([]);setPendingSoloRemoveId(null);}}
            , React.createElement('div', { style: {width:"100%",maxWidth:520,maxHeight:"92vh",overflowY:"auto",background:"linear-gradient(160deg,#0c0c0a,#0c0c0a)",border:"1px solid rgba(180,172,158,.06)",borderRadius:"18px 18px 0 0",padding:"0 0 24px"},
              onClick: e=>e.stopPropagation()}
              /* Header */
              , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px 4px"}}
                , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:8}}
                  , React.createElement('button', { className: "btn btn-ghost btn-sm", style:{padding:"4px 8px",fontSize:".75rem"},
                      onClick: ()=>{setSelEx(null);setExHHMM("");setExSec("");setQuickRows([]);setPendingSoloRemoveId(null);setLibDetailEx(ex);}}, "← Back")
                  , React.createElement('div', { style: {fontSize:".95rem",color:"#d4cec4",fontFamily:"'Inter',sans-serif",fontWeight:600}}, ex.icon, " " , ex.name)
                )
                , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>{setSelEx(null);setExHHMM("");setExSec("");setQuickRows([]);setPendingSoloRemoveId(null);}}, "✕")
              )
              , React.createElement('div', { style: {padding:"0 14px"}}
                , React.createElement('div', { className: "log-form"}
                  , ex.id==="rest_day" ? React.createElement('div', { style: {textAlign:"center",padding:"18px 0",color:"#8a8478",fontSize:".78rem",fontStyle:"italic"}}, "🛌 Rest day — no stats to track. Recover well!") : null
                  /* Top row: Sets/Reps or Duration+Sec+Dist, then Weight */
                  , ex.id!=="rest_day"&&React.createElement('div', { style: {display:"flex",gap:6,marginBottom:9,alignItems:"flex-end"}}
                    , !noSets&&!(isCardio||isFlex)&&React.createElement('div', { style: {flex:1}}
                      , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",display:"block",marginBottom:3}}, "Sets")
                      , React.createElement('input', { className: "inp", style: {padding:"6px 8px",textAlign:"center"}, type: "number", min: "0", max: "20", value: sets, onChange: e=>setSets(e.target.value), placeholder: ""})
                    )
                    , isCardio||isFlex ? (React.createElement(React.Fragment, null
                      , React.createElement('div', { style: {flex:2}}
                        , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",display:"block",marginBottom:3}}, "Duration (HH:MM)" )
                        , React.createElement('input', { className: "inp", style: {padding:"6px 8px",textAlign:"center"}, type: "text", inputMode: "numeric", value: exHHMM, onChange: e=>setExHHMM(e.target.value), onBlur: e=>{const norm=normalizeHHMM(e.target.value);setExHHMM(norm);const sec=combineHHMMSec(norm,exSec);if(sec) setReps(String(Math.max(1,Math.floor(sec/60))));}, placeholder: "00:00"})
                      )
                      , React.createElement('div', { style: {flex:1}}
                        , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",display:"block",marginBottom:3}}, "Seconds")
                        , React.createElement('input', { className: "inp", style: {padding:"6px 8px",textAlign:"center"}, type: "number", min: "0", max: "59", value: exSec, onChange: e=>{setExSec(e.target.value);const sec=combineHHMMSec(exHHMM,e.target.value);if(sec) setReps(String(Math.max(1,Math.floor(sec/60))));}, placeholder: "00"})
                      )
                      , showDist&&React.createElement('div', { style: {flex:1.5}}
                        , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",display:"block",marginBottom:3}}, "Dist (" , dUnit, ")")
                        , React.createElement('input', { className: "inp", style: {padding:"6px 8px",textAlign:"center"}, type: "number", min: "0", max: "200", step: "0.1", value: distanceVal, onChange: e=>setDistanceVal(e.target.value), placeholder: metric?"0.0":"0.0"})
                      )
                    )) : (React.createElement(React.Fragment, null
                      , React.createElement('div', { style: {flex:1}}
                        , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",display:"block",marginBottom:3}}, "Reps")
                        , React.createElement('input', { className: "inp", style: {padding:"6px 8px",textAlign:"center"}, type: "number", min: "0", max: "200", value: reps, onChange: e=>setReps(e.target.value), placeholder: ""})
                      )
                      , showWeight&&React.createElement('div', { style: {flex:1.5}}
                        , React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",display:"block",marginBottom:3}}, "Weight (" , wUnit, ")")
                        , React.createElement('input', { className: "inp", style: {padding:"6px 8px",textAlign:"center"}, type: "number", min: "0", max: "2000", step: metric?"0.5":"2.5", value: exWeight, onChange: e=>setExWeight(e.target.value), placeholder: metric?"60":"135"})
                      )
                    ))
                  )
                  /* Extra rows */
                  , ex.id!=="rest_day"&&React.createElement('div', { style: {marginBottom:9}}
                    , quickRows.map((row,ri)=>(
                      React.createElement('div', { key: ri, style: {display:"flex",gap:4,marginBottom:4,padding:"6px 8px",background:"rgba(45,42,36,.18)",borderRadius:6,alignItems:"center",flexWrap:"wrap"}}
                        , React.createElement('span', { style: {fontSize:".6rem",color:"#a09080",flexShrink:0,minWidth:18}}, isCardio||isFlex?`I${ri+2}`:`S${ri+2}`)
                        , (isCardio||isFlex) ? (React.createElement(React.Fragment, null
                          , React.createElement('input', { className: "inp", style: {flex:1.5,minWidth:52,padding:"4px 8px",fontSize:".72rem"}, type: "text", inputMode: "numeric", placeholder: "HH:MM",
                            defaultValue: row.hhmm||"",
                            onBlur: e=>{const rr=[...quickRows];rr[ri]={...rr[ri],hhmm:normalizeHHMM(e.target.value)};setQuickRows(rr);}})
                          , React.createElement('input', { className: "inp", style: {flex:0.8,minWidth:36,padding:"4px 8px",fontSize:".72rem"}, type: "number", min: "0", max: "59", placeholder: "Sec", defaultValue: row.sec||"", onBlur: e=>{const rr=[...quickRows];rr[ri]={...rr[ri],sec:e.target.value};setQuickRows(rr);}})
                          , React.createElement('input', { className: "inp", style: {flex:1,minWidth:40,padding:"4px 8px",fontSize:".72rem"}, type: "text", inputMode: "decimal", placeholder: dUnit, defaultValue: row.dist||"", onBlur: e=>{const rr=[...quickRows];rr[ri]={...rr[ri],dist:e.target.value};setQuickRows(rr);}})
                          , isTreadmill&&React.createElement('input', { className: "inp", style: {flex:0.8,minWidth:34,padding:"4px 8px",fontSize:".72rem"}, type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "Inc", defaultValue: row.incline||"", onBlur: e=>{const rr=[...quickRows];rr[ri]={...rr[ri],incline:e.target.value};setQuickRows(rr);}})
                          , isTreadmill&&React.createElement('input', { className: "inp", style: {flex:0.8,minWidth:34,padding:"4px 8px",fontSize:".72rem"}, type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "Spd", defaultValue: row.speed||"", onBlur: e=>{const rr=[...quickRows];rr[ri]={...rr[ri],speed:e.target.value};setQuickRows(rr);}})
                        )) : (React.createElement(React.Fragment, null
                          , !noSets&&React.createElement('input', { className: "inp", style: {flex:1,minWidth:40,padding:"4px 8px",fontSize:".72rem"}, type: "number", min: "1", max: "20", placeholder: "Sets", defaultValue: row.sets||"", onBlur: e=>{const rr=[...quickRows];rr[ri]={...rr[ri],sets:e.target.value};setQuickRows(rr);}})
                          , React.createElement('input', { className: "inp", style: {flex:1,minWidth:40,padding:"4px 8px",fontSize:".72rem"}, type: "number", min: "1", max: "200", placeholder: "Reps", defaultValue: row.reps||"", onBlur: e=>{const rr=[...quickRows];rr[ri]={...rr[ri],reps:e.target.value};setQuickRows(rr);}})
                          , showWeight&&React.createElement('input', { className: "inp", style: {flex:1,minWidth:40,padding:"4px 8px",fontSize:".72rem"}, type: "number", min: "0", placeholder: wUnit, defaultValue: row.weightLbs||"", onBlur: e=>{const rr=[...quickRows];rr[ri]={...rr[ri],weightLbs:e.target.value};setQuickRows(rr);}})
                        ))
                        , React.createElement('button', { className: "btn btn-danger btn-xs"  , style: {padding:"2px 5px",flexShrink:0}, onClick: ()=>setQuickRows(quickRows.filter((_,j)=>j!==ri))}, "✕")
                      )
                    ))
                  )
                  /* Distance bonus info (field is now in top row) */
                  , ex.id!=="rest_day"&&showDist&&rawDist>0&&(
                    React.createElement('div', { style: {fontSize:".62rem",color:"#6a645a",marginBottom:6,marginTop:-4}}
                      , metric?`${rawDist} km = ${parseFloat(kmToMi(rawDist)).toFixed(2)} mi`:`${rawDist} mi = ${parseFloat(miToKm(rawDist)).toFixed(2)} km`
                      , React.createElement('span', { style: {color:"#e67e22",marginLeft:6}}, "+", Math.round(Math.min(distMi*0.05,0.5)*100), "% dist bonus"  )
                    )
                  )
                  /* Treadmill: Incline + Speed */
                  , ex.id!=="rest_day"&&isTreadmill&&(
                    React.createElement('div', { style: {display:"flex",gap:8,marginBottom:10}}
                      , React.createElement('div', { style: {flex:1}}, React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",display:"block",marginBottom:4}}, "Incline (0.5–15)" ), React.createElement('input', { className: "inp", type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "—", value: exIncline||"", onChange: e=>setExIncline(e.target.value?parseFloat(e.target.value):null)}))
                      , React.createElement('div', { style: {flex:1}}, React.createElement('label', { style: {fontSize:".6rem",color:"#b0a898",display:"block",marginBottom:4}}, "Speed (0.5–15)" ), React.createElement('input', { className: "inp", type: "number", min: "0.5", max: "15", step: "0.5", placeholder: "—", value: exSpeed||"", onChange: e=>setExSpeed(e.target.value?parseFloat(e.target.value):null)}))
                    )
                  )
                  /* Add Row button */
                  , ex.id!=="rest_day"&&(isCardio||isFlex||showWeight)&&(
                    React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {width:"100%",marginBottom:8,fontSize:".6rem",color:"#8a8478",borderStyle:"dashed"},
                      onClick: ()=>setQuickRows([...quickRows,(isCardio||isFlex)?{hhmm:"",sec:"",dist:"",incline:"",speed:""}:{sets:sets||"",reps:reps||"",weightLbs:exWeight||""}])}, "＋ Add Row ("
                         , isCardio||isFlex?"e.g. interval":"progressive weight/sets", ")"
                    )
                  )
                  /* Weight Intensity slider (weight field is now in top row) */
                  , ex.id!=="rest_day"&&showWeight&&(
                    React.createElement('div', { style: {marginBottom:11}}
                      , React.createElement('div', { className: "intensity-row"}
                        , React.createElement('label', { style: {marginBottom:0,flex:1}}, "Weight Intensity" )
                        , React.createElement('span', { className: "intensity-val"}, weightPct, "%")
                      )
                      , React.createElement('input', { type: "range", className: "pct-slider", min: "0", max: "100", step: "5", value: pctToSlider(weightPct), onChange: e=>{const newPct=sliderToPct(Number(e.target.value));const curW=parseFloat(exWeight);if(curW&&weightPct>0){const scaled=Math.round(curW*newPct/weightPct*100)/100;setExWeight(String(scaled));}setWeightPct(newPct);}})
                      , React.createElement('div', { style: {display:"flex",justifyContent:"space-between",fontSize:".58rem",color:"#6a645a",marginTop:2}}
                        , React.createElement('span', null, "50% Deload" ), React.createElement('span', null, "100% Normal" ), React.createElement('span', null, "200% Max" )
                      )
                    )
                  )
                  /* Avg HR Zone — last */
                  , ex.id!=="rest_day"&&showHR&&(
                    React.createElement('div', { style: {marginBottom:11}}
                      , React.createElement('label', null, "Avg Heart Rate Zone "    , profile.age?`(Age ${profile.age})`:"")
                      , React.createElement('div', { className: "hr-zone-row"}
                        , HR_ZONES.map(z=>{
                          const range=hrRange(age,z); const sel=hrZone===z.z;
                          return (
                            React.createElement('div', { key: z.z, className: `hr-zone-btn ${sel?"sel":""}`,
                              style: {"--zc":z.color,borderColor:sel?z.color:"rgba(45,42,36,.2)",background:sel?`${z.color}22`:"rgba(45,42,36,.12)"},
                              onClick: ()=>setHrZone(sel?null:z.z)}
                              , React.createElement('span', { className: "hz-name", style: {color:sel?z.color:"#5a5650"}}, "Z", z.z, " " , z.name)
                              , React.createElement('span', { className: "hz-bpm", style: {color:sel?z.color:"#6a645a"}}, range.lo, "–", range.hi)
                            )
                          );
                        })
                      )
                      , hrZone&&React.createElement('div', { style: {fontSize:".7rem",color:"#8a8478",fontStyle:"italic",marginTop:5}}, HR_ZONES[hrZone-1].desc)
                    )
                  )
                  /* Personal Best display */
                  , ex.id!=="rest_day"&&(isRunning&&pbDisp||exPBDisp4) && React.createElement('div', { style: {fontSize:".68rem",color:"#b4ac9e",marginBottom:7,display:"flex",alignItems:"center",gap:5} }
                    , React.createElement('span', null, "🏆")
                    , React.createElement('span', null, "Current PB: ", isRunning&&pbDisp?pbDisp:exPBDisp4)
                  )
                  /* XP estimate */
                  , ex.id!=="rest_day"&&React.createElement('div', { style: {marginBottom:9,fontSize:".7rem",color:"#8a8478",fontStyle:"italic"}}, "Est. XP: "
                      , React.createElement('span', { style: {color:"#b4ac9e",fontFamily:"'Inter',sans-serif"}}, estXP)
                    , showHR&&hrZone&&React.createElement('span', { style: {color:"#e67e22",marginLeft:6}}, "Z", hrZone, " +" , ((hrZone-1)*4), "% XP" )
                    , showWeight&&effW>0&&React.createElement('span', { style: {color:"#2ecc71",marginLeft:6}}, "+", Math.round(Math.min(effW/500,0.3)*100), "% wt bonus"  )
                    , runBoostPct>0&&React.createElement('span', { style: {color:"#FFE87C",marginLeft:6}}, "⚡ +" , runBoostPct, "% pace bonus"  )
                  )
                  /* Primary action row */
                  , React.createElement('div', { style: {display:"flex",gap:6,marginBottom:8}}
                    , React.createElement('button', { className: "btn btn-glass-yellow" , style: {flex:2,fontSize:".6rem",padding:"8px 10px"}, onClick: logExercise}, "✓ Complete / Schedule" )
                    , ex.id!=="rest_day"&&React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1,fontSize:".6rem",padding:"8px 6px"}, onClick: ()=>{ex.custom?openExEditor("edit",ex):openExEditor("copy",ex);setSelEx(null);}}, ex.custom?"✎ Edit":"📋 Copy")
                  )
                  /* Secondary actions — add to existing workout / plan */
                  , React.createElement('div', { style: {display:"flex",gap:6}}
                    , ex.id!=="rest_day"&&React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1,fontSize:".58rem",padding:"6px 8px",borderColor:"rgba(45,42,36,.3)",color:"#8a8478"},
                      onClick: ()=>{
                        const exEntry={exId:ex.id,sets:parseInt(sets)||0,reps:parseInt(reps)||0,weightLbs:wLbs||null,durationMin:null,weightPct,distanceMi:distMi||null,hrZone:hrZone||null};
                        setAddToWorkoutPicker({exercises:[exEntry]});
                        setSelEx(null);
                      }}, "➕ Add to Workout"   )
                    , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1,fontSize:".58rem",padding:"6px 8px",borderColor:"rgba(45,42,36,.3)",color:"#8a8478"},
                      onClick: ()=>{
                        const ids=[ex.id];
                        setSpwSelected(ids);
                        setSavePlanWizard({entries:[{exId:ex.id,exercise:ex.name,icon:ex.icon,_idx:ex.id}],label:ex.name});
                        setSpwName(ex.name);setSpwIcon(ex.icon||"📋");setSpwDate("");setSpwMode("new");setSpwTargetPlanId(null);
                        setSelEx(null);
                      }}, "📋 Add to Plan"   )
                  )
                )
              )
            )
          )
        );
      } catch(e) { console.error("Quick-log render error:", e); return null; }
      })()

      /* ══ STATS PROMPT MODAL ══════════════════════ */
      , statsPromptModal&&createPortal(
        React.createElement('div', { className: "modal-backdrop", onClick: ()=>setStatsPromptModal(null)}
          , React.createElement('div', { className: "modal-sheet", onClick: e=>e.stopPropagation(), style: {borderRadius:16,padding:0}}
            , React.createElement('div', { className: "modal-body"}
              /* ── Glass dismiss banner ── */
              , React.createElement('div', {
                  className: "stats-prompt-banner",
                  onClick: ()=>{
                    setProfile(p=>({...p,notificationPrefs:{...(p.notificationPrefs||{}),reviewBattleStats:false}}));
                    statsPromptModal.onConfirm(statsPromptModal.wo);
                    setStatsPromptModal(null); setSpMakeReusable(false); setSpDurSec("");
                  }
                }
                , React.createElement('div', { style: {width:16,height:16,borderRadius:3,border:"1.5px solid rgba(180,172,158,.25)",background:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0} })
                , React.createElement('div', { className: "stats-prompt-banner-text" }
                  , "Want this reminder off? Check here. To re-enable, you can do so in "
                  , React.createElement('strong', null, "Alerts settings")
                  , "."
                )
              )
              , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10} }
                , React.createElement('div', null
                  , React.createElement('div', {style:{display:"flex",alignItems:"center",gap:8}},
                    React.createElement('button', {className:"btn btn-ghost btn-sm", style:{padding:"4px 8px",fontSize:".75rem"},
                      onClick:()=>{ setStatsPromptModal(null); if(statsPromptModal.wo.soloEx && statsPromptModal.wo._soloExId){ setSelEx(statsPromptModal.wo._soloExId); } else if(!statsPromptModal.wo.soloEx){ setWorkoutView("builder"); setActiveTab("workouts"); } }
                    }, "← Back"),
                    React.createElement('div', {className:"stats-modal-title",style:{flex:1}}, "📊 ", "Review Battle Stats ", React.createElement('span',{style:{color:"#5a5650",fontWeight:"normal",fontSize:".72rem"}},"(Optional)"))
                  )
                )
                , React.createElement('button', { className: "btn btn-ghost btn-sm", onClick: ()=>setStatsPromptModal(null) }, "✕")
              )
              , React.createElement('div', { className: "stats-modal-subtitle", style:{marginBottom:14} }
                , statsPromptModal.wo.oneOff
                  ? "Review your workout stats before completing. Fill in any missing values, or leave blank to skip."
                  : (()=>{
                      const missing=[statsPromptModal.missingDur&&"Duration",statsPromptModal.missingAct&&"Active Cal",statsPromptModal.missingTot&&"Total Cal"].filter(Boolean);
                      return missing.length ? `${missing.join(", ")} ${missing.length===1?"was":"were"} not recorded. Would you like to add ${missing.length===1?"it":"them"} before completing?` : "Review your workout stats before completing.";
                    })()
              )
              , React.createElement('div', { className: "stats-prompt-fields"}
                , React.createElement('div', { className: "field", style: {flex:1.5,marginBottom:0}}
                  , React.createElement('label', null, "Duration " , React.createElement('span', { style: {color:"#5a5650",fontWeight:"normal"}}, "(HH:MM)"))
                  , React.createElement('input', { className: "inp", type: "text", inputMode: "numeric", placeholder: "00:00",
                    value: spDuration,
                    onChange: e=>setSpDuration(e.target.value),
                    onBlur: e=>setSpDuration(normalizeHHMM(e.target.value))})
                )
                , React.createElement('div', { className: "field", style: {flex:0.8,marginBottom:0}}
                  , React.createElement('label', null, "Sec")
                  , React.createElement('input', { className: "inp", type: "number", min: "0", max: "59", placeholder: ":00",
                    value: spDurSec,
                    onChange: e=>setSpDurSec(e.target.value)})
                )
                , React.createElement('div', { className: "field", style: {flex:1,marginBottom:0}}
                  , React.createElement('label', null, "Active Cal" )
                  , React.createElement('input', { className: "inp", type: "number", min: "0", max: "9999", placeholder: "e.g. 320" , value: spActiveCal, onChange: e=>setSpActiveCal(e.target.value)})
                )
                , React.createElement('div', { className: "field", style: {flex:1,marginBottom:0}}
                  , React.createElement('label', null, "Total Cal" )
                  , React.createElement('input', { className: "inp", type: "number", min: "0", max: "9999", placeholder: "e.g. 450" , value: spTotalCal, onChange: e=>setSpTotalCal(e.target.value)})
                )
              )
              /* Make Reusable checkbox — only for one-off workouts */
              , statsPromptModal.wo.oneOff&&(
                React.createElement('div', { className: "stats-prompt-reusable",
                  onClick: ()=>setSpMakeReusable(v=>!v)}
                  , React.createElement('div', { style: {width:18,height:18,borderRadius:4,border:`2px solid ${spMakeReusable?"#b4ac9e":"rgba(180,172,158,.18)"}`,background:spMakeReusable?"#b4ac9e":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .15s"}}
                    , spMakeReusable&&React.createElement('span', { style: {fontSize:".7rem",color:"#0c0c0a",fontWeight:"bold"}}, "✓")
                  )
                  , React.createElement('div', null
                    , React.createElement('div', { className: "stats-prompt-reusable-title"}, "💪 Also save as Reusable Workout"     )
                    , React.createElement('div', { className: "stats-prompt-reusable-sub"}, "Keep this workout in your Re-Usable tab for future use"         )
                  )
                )
              )
              , React.createElement('div', { style: {display:"flex",gap:8}}
                , React.createElement('button', { className: "btn btn-gold" , style: {flex:1,fontSize:".75rem"}, onClick: ()=>{
                  const durSec = combineHHMMSec(spDuration, spDurSec) || null;
                  const wo={...statsPromptModal.wo,
                    durationMin:durSec!==null?durSec:(_nullishCoalesce(statsPromptModal.wo.durationMin, () => (null))),
                    activeCal:spActiveCal!==null&&spActiveCal!==""?Number(spActiveCal):_nullishCoalesce(statsPromptModal.wo.activeCal, () => (null)),
                    totalCal:spTotalCal!==null&&spTotalCal!==""?Number(spTotalCal):_nullishCoalesce(statsPromptModal.wo.totalCal, () => (null)),
                    makeReusable:spMakeReusable,
                  };
                  const _statsRef = {wo:statsPromptModal.wo, missingDur:statsPromptModal.missingDur, missingAct:statsPromptModal.missingAct, missingTot:statsPromptModal.missingTot, onConfirm:statsPromptModal.onConfirm};
                  statsPromptModal.onConfirm(wo, _statsRef);
                  setStatsPromptModal(null); setSpMakeReusable(false); setSpDurSec("");
                }}, "✓ Save & Complete"   )
              )
            )
          )
        )
      , document.body)

      /* ══ CALENDAR EXERCISE READ-ONLY DETAIL MODAL ══ */
      , calExDetailModal && (
        React.createElement('div', { className: "modal-backdrop", onClick: ()=>setCalExDetailModal(null)}
          , React.createElement('div', { className: "modal-sheet", onClick: e=>e.stopPropagation(), style: {borderRadius:16,padding:0}}
            , React.createElement('div', { className: "modal-body"}
              /* Header */
              , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10} }
                , React.createElement('div', { style:{display:"flex",alignItems:"center",gap:8} }
                  , React.createElement('span', { style:{fontSize:"1.2rem"} }, calExDetailModal.exerciseIcon)
                  , React.createElement('div', { className: "stats-modal-title" }, calExDetailModal.exerciseName)
                )
                , React.createElement('button', { className: "btn btn-ghost btn-sm", onClick: ()=>setCalExDetailModal(null) }, "✕")
              )
              /* Source info */
              , calExDetailModal.sourceName && React.createElement('div', { style: {fontSize:".65rem",color:"#8a8478",fontStyle:"italic",padding:"6px 10px",background:"rgba(45,42,36,.12)",borderRadius:7,border:"1px solid rgba(45,42,36,.2)",marginBottom:10} }
                , React.createElement('span', null, calExDetailModal.sourceIcon||"💪", " From: ", React.createElement('b', { style:{color:"#b4ac9e"} }, calExDetailModal.sourceName))
              )
              , !calExDetailModal.sourceName && React.createElement('div', { style: {fontSize:".65rem",color:"#8a8478",fontStyle:"italic",padding:"6px 10px",background:"rgba(45,42,36,.12)",borderRadius:7,border:"1px solid rgba(45,42,36,.2)",marginBottom:10} }
                , "Solo Exercise"
              )
              /* Stats row */
              , (calExDetailModal.durationSec>0 || calExDetailModal.activeCal>0 || calExDetailModal.totalCal>0) && React.createElement('div', { style:{display:"flex",gap:8,marginBottom:12} }
                , calExDetailModal.durationSec>0 && React.createElement('div', { className: "eff-weight", style: {flex:1} }
                  , React.createElement('span', { className: "eff-weight-val" }, secToHMS(calExDetailModal.durationSec))
                  , React.createElement('span', { className: "eff-weight-lbl" }, "Duration")
                )
                , calExDetailModal.totalCal>0 && React.createElement('div', { className: "eff-weight", style: {flex:1} }
                  , React.createElement('span', { className: "eff-weight-val" }, calExDetailModal.totalCal)
                  , React.createElement('span', { className: "eff-weight-lbl" }, "Total Cal")
                )
                , calExDetailModal.activeCal>0 && React.createElement('div', { className: "eff-weight", style: {flex:1} }
                  , React.createElement('span', { className: "eff-weight-val" }, calExDetailModal.activeCal)
                  , React.createElement('span', { className: "eff-weight-lbl" }, "Active Cal")
                )
              )
              /* Entry rows */
              , React.createElement('div', { style:{marginBottom:8} }
                , calExDetailModal.entries.length>1 && React.createElement('div', { style:{fontSize:".58rem",color:"#5a5650",textTransform:"uppercase",letterSpacing:".08em",marginBottom:6} }, calExDetailModal.entries.length, " Sets / Rows")
                , calExDetailModal.entries.map((e,i)=>
                  React.createElement('div', { key:i, style:{background:"rgba(45,42,36,.18)",border:"1px solid rgba(45,42,36,.2)",borderRadius:8,padding:"10px 12px",marginBottom:6} }
                    , React.createElement('div', { style:{display:"flex",justifyContent:"space-between",alignItems:"center"} }
                      , React.createElement('div', { style:{fontSize:".72rem",color:"#d4cec4",fontWeight:600} }
                        , calExDetailModal.entries.length>1 ? "Set "+(i+1) : "Details"
                      )
                      , React.createElement('div', { style:{fontSize:".62rem",fontWeight:600,color:"#b4ac9e"} }, "+", e.xp, " XP")
                    )
                    , React.createElement('div', { style:{display:"flex",gap:12,marginTop:6,flexWrap:"wrap"} }
                      , React.createElement('div', { style:{fontSize:".62rem",color:"#8a8478"} }
                        , React.createElement('span', { style:{color:"#5a5650"} }, "Sets: "), e.sets
                      )
                      , React.createElement('div', { style:{fontSize:".62rem",color:"#8a8478"} }
                        , React.createElement('span', { style:{color:"#5a5650"} }, "Reps: "), e.reps
                      )
                      , e.weightLbs && React.createElement('div', { style:{fontSize:".62rem",color:"#8a8478"} }
                        , React.createElement('span', { style:{color:"#5a5650"} }, "Weight: "), isMetric(profile.units)?lbsToKg(e.weightLbs)+" kg":e.weightLbs+" lbs"
                      )
                      , e.distanceMi && React.createElement('div', { style:{fontSize:".62rem",color:"#8a8478"} }
                        , React.createElement('span', { style:{color:"#5a5650"} }, "Distance: "), isMetric(profile.units)?miToKm(e.distanceMi)+" km":e.distanceMi+" mi"
                      )
                      , e.hrZone && React.createElement('div', { style:{fontSize:".62rem",color:"#8a8478"} }
                        , React.createElement('span', { style:{color:"#5a5650"} }, "HR Zone: "), e.hrZone
                      )
                      , e.seconds && React.createElement('div', { style:{fontSize:".62rem",color:"#8a8478"} }
                        , React.createElement('span', { style:{color:"#5a5650"} }, "Seconds: "), e.seconds
                      )
                    )
                  )
                )
              )
              /* Total XP */
              , React.createElement('div', { style:{display:"flex",justifyContent:"flex-end",padding:"8px 0",borderTop:"1px solid rgba(180,172,158,.08)"} }
                , React.createElement('div', { style:{fontSize:".75rem",fontWeight:700,color:"#b4ac9e"} }, "Total: +", calExDetailModal.entries.reduce((s,e)=>s+e.xp,0), " XP")
              )
            )
          )
        )
      )

      /* ══ RETRO EDIT MODAL ═══════════════════════ */
      , retroEditModal&&(()=>{
        const rem = retroEditModal;
        // Build a synthetic workout from the log entries for the builder
        const exercises = rem.entries.map(e=>({
          exId:e.exId, sets:e.sets||3, reps:e.reps||10,
          weightLbs:e.weightLbs||null, weightPct:e.weightPct||100,
          distanceMi:e.distanceMi||null, hrZone:e.hrZone||null,
          durationMin:null,
        }));
        const wo = {
          id:rem.sourceId||uid(), name:rem.sourceName, icon:rem.sourceIcon,
          exercises, oneOff:rem.sourceType==="oneoff",
          durationMin:_optionalChain([rem, 'access', _170 => _170.entries, 'access', _171 => _171[0], 'optionalAccess', _172 => _172.durationMin])||null,
          activeCal:_optionalChain([rem, 'access', _173 => _173.entries, 'access', _174 => _174[0], 'optionalAccess', _175 => _175.activeCal])||null,
          totalCal:_optionalChain([rem, 'access', _176 => _176.entries, 'access', _177 => _177[0], 'optionalAccess', _178 => _178.totalCal])||null,
        };
        return (
          React.createElement('div', { className: "modal-backdrop", onClick: ()=>setRetroEditModal(null)}
            , React.createElement('div', { className: "modal-sheet", onClick: e=>e.stopPropagation(), style: {borderRadius:16,padding:0,maxHeight:"85vh",overflowY:"auto"}}
              , React.createElement('div', { className: "modal-body"}
                , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}
                  , React.createElement('div', { style: {fontSize:".9rem",color:"#d4cec4",fontFamily:"'Inter',sans-serif",fontWeight:600}}, "✎ Edit Completed "   , rem.sourceType==="plan"?"Plan Session":"Workout")
                  , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setRetroEditModal(null)}, "✕")
                )
                , React.createElement('div', { style: {fontSize:".65rem",color:"#8a8478",marginBottom:14,lineHeight:1.5}}
                  , rem.sourceName, " · "  , _optionalChain([rem, 'access', _179 => _179.entries, 'access', _180 => _180[0], 'optionalAccess', _181 => _181.date]), " · Editing will recalculate XP and update your log."
                )
                /* Exercise list — editable */
                , React.createElement('div', { style: {marginBottom:12}}
                  , rem.entries.map((e,i)=>{
                    const exData = allExById[e.exId];
                    if(!exData) return null;
                    return (
                      React.createElement('div', { key: i, style: {background:"rgba(45,42,36,.18)",border:"1px solid rgba(45,42,36,.2)",borderRadius:8,padding:"10px 12px",marginBottom:6}}
                        , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:8,marginBottom:6}}
                          , React.createElement('span', { style: {fontSize:"1rem"}}, exData.icon)
                          , React.createElement('span', { style: {fontSize:".78rem",color:"#d4cec4",flex:1,fontWeight:600}}, exData.name)
                          , React.createElement('button', { className: "btn btn-danger btn-xs"  , onClick: ()=>{
                            setRetroEditModal(prev=>({...prev,entries:prev.entries.filter((_,j)=>j!==i)}));
                          }}, "✕")
                        )
                        , React.createElement('div', { style: {display:"flex",gap:6}}
                          , React.createElement('div', { style: {flex:1}}, React.createElement('label', { style: {fontSize:".58rem",color:"#b0a898",display:"block",marginBottom:3}}, "Sets")
                            , React.createElement('input', { className: "inp", type: "number", min: "1", max: "20", value: e.sets||"", style: {padding:"4px 6px",fontSize:".72rem"},
                              onChange: ev=>{const v=ev.target.value;setRetroEditModal(prev=>({...prev,entries:prev.entries.map((r,j)=>j===i?{...r,sets:v}:r)}));}}))
                          , React.createElement('div', { style: {flex:1}}, React.createElement('label', { style: {fontSize:".58rem",color:"#b0a898",display:"block",marginBottom:3}}, "Reps/Min")
                            , React.createElement('input', { className: "inp", type: "number", min: "1", max: "300", value: e.reps||"", style: {padding:"4px 6px",fontSize:".72rem"},
                              onChange: ev=>{const v=ev.target.value;setRetroEditModal(prev=>({...prev,entries:prev.entries.map((r,j)=>j===i?{...r,reps:v}:r)}));}}))
                          , !["cardio","flexibility"].includes(exData.category)&&React.createElement('div', { style: {flex:1}}, React.createElement('label', { style: {fontSize:".58rem",color:"#b0a898",display:"block",marginBottom:3}}, "Weight")
                            , React.createElement('input', { className: "inp", type: "number", min: "0", max: "2000", value: e.weightLbs||"", style: {padding:"4px 6px",fontSize:".72rem"},
                              onChange: ev=>{const v=ev.target.value;setRetroEditModal(prev=>({...prev,entries:prev.entries.map((r,j)=>j===i?{...r,weightLbs:v||null}:r)}));}}))
                        )
                      )
                    );
                  })
                )
                , React.createElement('div', { style: {display:"flex",gap:8}}
                  , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>setRetroEditModal(null)}, "Cancel")
                  , React.createElement('button', { className: "btn btn-gold" , style: {flex:2}, onClick: ()=>{
                    // Recalculate XP and update log entries in place
                    const now = new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
                    const newEntries = rem.entries.map((e,i)=>{
                      const updated = retroEditModal.entries[i];
                      if(!updated) return null;
                      const xp = calcExXP(updated.exId, parseInt(updated.sets)||3, parseInt(updated.reps)||10, profile.chosenClass, allExById);
                      return {...e, ...updated, xp, sets:parseInt(updated.sets)||e.sets, reps:parseInt(updated.reps)||e.reps};
                    }).filter(Boolean);
                    // Replace all matching entries in the log
                    const updatedLog = profile.log.map(le=>{
                      const matchIdx = rem.entries.findIndex(re=>re._idx===le._idx||(re.exId===le.exId&&re.dateKey===le.dateKey&&(re.sourceGroupId===le.sourceGroupId||re.sourcePlanId===le.sourcePlanId)));
                      if(matchIdx<0) return le;
                      const ne = newEntries[matchIdx];
                      return ne ? {...le, ...ne} : le;
                    });
                    const totalXP = updatedLog.filter(le=>rem.entries.some(re=>re._idx===le._idx)).reduce((s,e)=>s+e.xp,0);
                    setProfile(p=>({...p, log:updatedLog}));
                    setRetroEditModal(null);
                    showToast("✓ Workout log updated!");
                  }}, "✓ Save Changes"  )
                )
              )
            )
          )
        );
      })()

      /* ══ ADD TO EXISTING WORKOUT PICKER ════════ */
      , addToWorkoutPicker&&(
        React.createElement('div', { className: "modal-backdrop", onClick: ()=>setAddToWorkoutPicker(null)}
          , React.createElement('div', { className: "modal-sheet", onClick: e=>e.stopPropagation(), style: {borderRadius:16,padding:0,maxHeight:"80vh",overflowY:"auto"}}
            , React.createElement('div', { className: "modal-body"}
              , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}
                , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".92rem",color:"#d4cec4",fontWeight:700}}, "➕ Add to Existing Workout"    )
                , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setAddToWorkoutPicker(null)}, "✕")
              )
              , React.createElement('div', { style: {fontSize:".65rem",color:"#8a8478",marginBottom:12}}, "Adding "
                 , addToWorkoutPicker.exercises.length, " exercise" , addToWorkoutPicker.exercises.length!==1?"s":"", " — choose a workout to append them to:"
              )
              /* Re-Usable Workouts */
              , (profile.workouts||[]).filter(w=>!w.oneOff).length>0&&React.createElement(React.Fragment, null
                , React.createElement('div', { style: {fontSize:".62rem",color:"#b4ac9e",textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}, "💪 Re-Usable Workouts"  )
                , (profile.workouts||[]).filter(w=>!w.oneOff).map(wo=>(
                  React.createElement('div', { key: wo.id, style: {display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:9,border:"1px solid rgba(45,42,36,.2)",marginBottom:6,cursor:"pointer",background:"rgba(45,42,36,.12)"},
                    onClick: ()=>{
                      const merged = {...wo, exercises:[...wo.exercises, ...addToWorkoutPicker.exercises]};
                      setProfile(p=>({...p, workouts:(p.workouts||[]).map(w=>w.id===wo.id?merged:w)}));
                      showToast(`Added to "${wo.name}"! 💪`);
                      setAddToWorkoutPicker(null);
                    }}
                    , React.createElement('span', { style: {fontSize:"1.3rem"}}, wo.icon)
                    , React.createElement('div', { style: {flex:1,minWidth:0}}
                      , React.createElement('div', { style: {fontSize:".78rem",color:"#d4cec4",fontWeight:600}}, wo.name)
                      , React.createElement('div', { style: {fontSize:".6rem",color:"#8a8478"}}, wo.exercises.length, " exercises" )
                    )
                    , React.createElement('span', { style: {fontSize:".65rem",color:"#b4ac9e"}}, "+ add →"  )
                  )
                ))
              )
              /* Scheduled One-Off Workouts */
              , (()=>{
                const today = todayStr();
                const grouped = {};
                (profile.scheduledWorkouts||[]).forEach(sw=>{
                  if(!sw.sourceWorkoutId || sw.scheduledDate < today) return;
                  const key = sw.sourceWorkoutId;
                  if(!grouped[key]) grouped[key]={id:sw.sourceWorkoutId,name:sw.sourceWorkoutName,icon:sw.sourceWorkoutIcon||"⚡",date:sw.scheduledDate};
                });
                const scheduled = Object.values(grouped);
                if(!scheduled.length) return null;
                return React.createElement(React.Fragment, null
                  , React.createElement('div', { style: {fontSize:".62rem",color:"#e67e22",textTransform:"uppercase",letterSpacing:".08em",marginBottom:6,marginTop:10}}, "⚡ Scheduled One-Off Workouts"   )
                  , scheduled.map(g=>{
                    const wo = (profile.workouts||[]).find(w=>w.id===g.id) || {id:g.id,name:g.name,icon:g.icon,exercises:[],oneOff:true};
                    return (
                      React.createElement('div', { key: g.id, style: {display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:9,border:"1px solid rgba(230,126,34,.15)",marginBottom:6,cursor:"pointer",background:"rgba(230,126,34,.04)"},
                        onClick: ()=>{
                          const merged = {...wo, exercises:[...wo.exercises, ...addToWorkoutPicker.exercises]};
                          setProfile(p=>({
                            ...p,
                            workouts:(p.workouts||[]).find(w=>w.id===g.id)
                              ? (p.workouts||[]).map(w=>w.id===g.id?merged:w)
                              : [...(p.workouts||[]), merged],
                            scheduledWorkouts:(p.scheduledWorkouts||[]).map(sw=>
                              sw.sourceWorkoutId===g.id ? {...sw,sourceWorkoutName:merged.name} : sw
                            ),
                          }));
                          showToast(`Added to "${g.name}"! ⚡`);
                          setAddToWorkoutPicker(null);
                        }}
                        , React.createElement('span', { style: {fontSize:"1.3rem"}}, g.icon)
                        , React.createElement('div', { style: {flex:1,minWidth:0}}
                          , React.createElement('div', { style: {fontSize:".78rem",color:"#d4cec4",fontWeight:600}}, g.name)
                          , React.createElement('div', { style: {fontSize:".6rem",color:"#8a8478"}}, "📅 " , formatScheduledDate(g.date))
                        )
                        , React.createElement('span', { style: {fontSize:".65rem",color:"#e67e22"}}, "+ add →"  )
                      )
                    );
                  }));
              })()
              , (profile.workouts||[]).filter(w=>!w.oneOff).length===0 && !(profile.scheduledWorkouts||[]).some(sw=>sw.scheduledDate>=todayStr()&&sw.sourceWorkoutId) && (
                React.createElement('div', { className: "empty"}, "No workouts to add to yet."     , React.createElement('br', null), "Create a Re-Usable Workout or schedule a One-Off first."        )
              )
            )
          )
        )
      )

      , oneOffModal&&(
        React.createElement('div', { className: "modal-backdrop", onClick: ()=>setOneOffModal(null)}
          , React.createElement('div', { className: "modal-sheet", onClick: e=>e.stopPropagation(), style: {borderRadius:16,padding:0}}
            , React.createElement('div', { className: "modal-body"}
              , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}
                , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".92rem",color:"#d4cec4",fontWeight:700}}, "⚡ Name Your One-Off Workout"    )
                , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setOneOffModal(null)}, "✕")
              )
              , React.createElement('div', { className: "field", style: {marginBottom:10}}
                , React.createElement('label', null, "Workout Name" )
                , React.createElement('input', { className: "inp", placeholder: "e.g. Morning Push Session…"   ,
                  value: oneOffModal.name,
                  onChange: e=>setOneOffModal(m=>({...m,name:e.target.value})),
                  autoFocus: true})
              )
              , React.createElement('div', { className: "field", style: {marginBottom:14}}
                , React.createElement('label', null, "Icon")
                , React.createElement('div', { style: {display:"flex",gap:6,flexWrap:"wrap"}}
                  , ["⚡","💪","🔥","🏋️","🏃","⚔️","🧱","🦵","🤜"].map(ic=>(
                    React.createElement('span', { key: ic, style: {fontSize:"1.4rem",cursor:"pointer",padding:4,borderRadius:6,background:oneOffModal.icon===ic?"rgba(45,42,36,.3)":"transparent",border:oneOffModal.icon===ic?"1px solid rgba(180,172,158,.08)":"1px solid transparent"},
                      onClick: ()=>setOneOffModal(m=>({...m,icon:ic}))}, ic)
                  ))
                )
              )
              , React.createElement('div', { style: {fontSize:".65rem",color:"#8a8478",marginBottom:14}}
                , oneOffModal.exercises.length, " exercises selected · XP will be calculated on completion"
              )
              , React.createElement('button', { className: "btn btn-gold" , style: {width:"100%"},
                disabled: !oneOffModal.name.trim(),
                onClick: ()=>{
                  const wo={id:uid(),name:oneOffModal.name.trim(),icon:oneOffModal.icon||"⚡",desc:"",exercises:oneOffModal.exercises,createdAt:todayStr(),oneOff:true};
                  setCompletionModal({workout:wo});
                  setCompletionDate(todayStr());
                  setCompletionAction("today");
                  setOneOffModal(null);
                }}, "Next: Log or Schedule →"

              )
            )
          )
        )
      )

      , completionModal && (()=>{
        const wo = completionModal.workout;
        const xp = wo.exercises.reduce((s,ex)=>s+calcExXP(ex.exId,ex.sets||3,ex.reps||10,profile.chosenClass,allExById),0);
        // Pick the dominant muscle group from the workout's first valid exercise as the theme color
        const firstEx = wo.exercises.map(e=>allExById[e.exId]).find(Boolean);
        const woMgColor = getMuscleColor(firstEx?.muscleGroup);
        // inPickMode: true when user tapped "Choose Day" or selected a specific date
        // pickerValue: the actual date string when a date is selected
        const inPickMode = completionAction==="past";
        const inScheduleMode = completionAction==="schedule";
        const pickerValue = (inPickMode && completionDate!=="pick") ? completionDate : "";
        return (
          React.createElement('div', { className: "completion-backdrop", onClick: ()=>{setCompletionModal(null);setCompletionAction("today");setScheduleWoDate("");}}
            , React.createElement('div', { className: "completion-sheet", onClick: e=>e.stopPropagation(), style: {"--mg-color":woMgColor}}
              /* Header */
              , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:8} }
                , completionModal.fromStats && React.createElement('button', {
                    className: "btn btn-ghost btn-sm", style:{padding:"4px 8px",fontSize:".75rem"},
                    onClick: ()=>{
                      const prev = completionModal.fromStats;
                      setCompletionModal(null); setCompletionAction("today"); setScheduleWoDate("");
                      setStatsPromptModal(prev);
                    }
                  }, "← Back")
                , React.createElement('div', { className: "completion-wo-name", style:{fontSize:".9rem",flex:1} }, "⚔ Complete Deed")
                , React.createElement('button', { className: "btn btn-ghost btn-sm", onClick: ()=>{setCompletionModal(null);setCompletionAction("today");setScheduleWoDate("");} }, "✕")
              )

              /* Workout card */
              , React.createElement('div', { className: "completion-wo-card"}
                , React.createElement('span', { className: "completion-wo-icon"}, wo.icon)
                , React.createElement('div', null
                  , React.createElement('div', { className: "completion-wo-name"}, wo.name)
                  , React.createElement('div', { className: "completion-wo-sub"}, wo.exercises.length, " exercises · ⚡ "    , xp.toLocaleString(), " XP" )
                )
              )

              /* Options */
              , React.createElement('div', { style: {display:"flex",flexDirection:"column",gap:8}}

                /* Option 1 — Completed Today */
                , React.createElement('div', { className: `completion-option ${completionAction==="today"?"sel":""}`,
                  onClick: ()=>{setCompletionAction("today");setCompletionDate(todayStr());}}
                  , React.createElement('span', { className: "completion-option-icon"}, "🔥")
                  , React.createElement('div', null
                    , React.createElement('div', { className: "completion-option-title"}, "Completed Today" )
                    , React.createElement('div', { className: "completion-option-sub"}, new Date().toLocaleDateString([],{weekday:"long",month:"short",day:"numeric"}))
                  )
                  , React.createElement('div', { style: {marginLeft:"auto",width:18,height:18,border:"1.5px solid rgba(180,172,158,.08)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".7rem",background:completionAction==="today"?"rgba(180,172,158,.25)":"transparent",color:completionAction==="today"?"#1a1200":"transparent",flexShrink:0}}, "✓")
                )

                /* Option 2 — Completed on a past day */
                , React.createElement('div', { className: `completion-option ${inPickMode?"sel":""}`,
                  onClick: ()=>{setCompletionAction("past");setCompletionDate("");}}
                  , React.createElement('span', { className: "completion-option-icon"}, "📋")
                  , React.createElement('div', { style: {flex:1,minWidth:0}}
                    , React.createElement('div', { className: "completion-option-title"}, "Choose Completion Day"  )
                    , React.createElement('div', { className: "completion-option-sub"}
                      , inPickMode&&pickerValue
                        ? new Date(pickerValue+"T12:00:00").toLocaleDateString([],{weekday:"long",month:"long",day:"numeric",year:"numeric"})
                        : "Log for a past date"
                    )
                  )
                  , React.createElement('div', { style: {marginLeft:"auto",width:18,height:18,border:"1.5px solid rgba(180,172,158,.08)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".7rem",background:inPickMode&&pickerValue?"rgba(180,172,158,.25)":"transparent",color:inPickMode&&pickerValue?"#1a1200":"transparent",flexShrink:0}}, "✓")
                )
                , inPickMode&&(
                  React.createElement('div', { style: {paddingLeft:8}}
                    , React.createElement('input', { className: "inp", type: "date",
                      max: todayStr(),
                      value: pickerValue,
                      onChange: e=>setCompletionDate(e.target.value),
                      style: {marginTop:2}, autoFocus: true})
                    , pickerValue&&React.createElement('div', { style: {fontSize:".65rem",color:"#b4ac9e",marginTop:5}}, "📅 "
                       , new Date(pickerValue+"T12:00:00").toLocaleDateString([],{weekday:"long",month:"long",day:"numeric",year:"numeric"})
                    )
                  )
                )

                /* Option 3 — Schedule for a future date */
                , React.createElement('div', { className: `completion-option ${inScheduleMode?"sel":""}`,
                  onClick: ()=>{setCompletionAction("schedule");setScheduleWoDate("");}}
                  , React.createElement('span', { className: "completion-option-icon"}, "📅")
                  , React.createElement('div', { style: {flex:1,minWidth:0}}
                    , React.createElement('div', { className: "completion-option-title"}, "Schedule for Later"  )
                    , React.createElement('div', { className: "completion-option-sub"}
                      , inScheduleMode&&scheduleWoDate
                        ? new Date(scheduleWoDate+"T12:00:00").toLocaleDateString([],{weekday:"long",month:"long",day:"numeric",year:"numeric"})
                        : "Add to calendar for a future date"
                    )
                  )
                  , React.createElement('div', { style: {marginLeft:"auto",width:18,height:18,border:"1.5px solid rgba(180,172,158,.08)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".7rem",background:inScheduleMode&&scheduleWoDate?"rgba(180,172,158,.25)":"transparent",color:inScheduleMode&&scheduleWoDate?"#1a1200":"transparent",flexShrink:0}}, "✓")
                )
                , inScheduleMode&&(
                  React.createElement('div', { style: {paddingLeft:8}}
                    , React.createElement('input', { className: "inp", type: "date",
                      min: (() => { const d=new Date(); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); })(),
                      value: scheduleWoDate,
                      onChange: e=>setScheduleWoDate(e.target.value),
                      style: {marginTop:2}, autoFocus: true})
                    , scheduleWoDate&&React.createElement('div', { style: {fontSize:".65rem",color:"#b4ac9e",marginTop:5}}, "📅 "
                       , new Date(scheduleWoDate+"T12:00:00").toLocaleDateString([],{weekday:"long",month:"long",day:"numeric",year:"numeric"})
                    )
                  )
                )

              )

              /* XP preview — only for log actions */
              , (completionAction==="today"||(inPickMode&&pickerValue))&&(
                React.createElement('div', { className: "completion-xp-preview"}
                  , React.createElement('div', { className: "completion-xp-preview-label"}, "XP to be claimed"   )
                  , React.createElement('div', { className: "completion-xp-preview-value"}, "⚡ " , xp.toLocaleString())
                )
              )

              , React.createElement('div', { style: {display:"flex",gap:8}}
                , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>{setCompletionModal(null);setCompletionAction("today");setScheduleWoDate("");}}, "Cancel")
                , !inScheduleMode ? (
                  React.createElement('button', { className: "btn btn-cls" , style: {flex:2},
                    disabled: inPickMode&&!pickerValue,
                    onClick: ()=>{
                      if(completionModal.soloExCallback){
                        const dateStr=(completionAction==="past"&&completionDate&&completionDate!=="pick")?completionDate:todayStr();
                        completionModal.soloExCallback(dateStr);
                        setCompletionModal(null);setCompletionDate("");setCompletionAction("today");setScheduleWoDate("");
                      } else { confirmWorkoutComplete(); }
                    }}, "✓ Confirm & Claim XP"

                  )
                ) : (
                  React.createElement('button', { className: "btn btn-gold" , style: {flex:2},
                    disabled: !scheduleWoDate,
                    onClick: ()=>{
                      if(completionModal.soloExScheduleCallback){
                        completionModal.soloExScheduleCallback(scheduleWoDate);
                      } else { scheduleWorkoutForDate(); }
                    }}, "📅 Schedule Workout"

                  )
                )
              )
            )
          )
        );
      })()

      /* ══ LOG ENTRY EDIT MODAL ════════════════════ */
      , logEditModal && logEditDraft && (()=>{
        const d = logEditDraft;
        const setD = patch => setLogEditDraft(prev=>({...prev,...patch}));
        const exData = allExById[d.exId];
        const isCardio = exData ? exData.category==="cardio" : false;
        const isFlex   = exData ? exData.category==="flexibility" : false;
        const showWeight = !isCardio && !isFlex;
        const showDist   = isCardio;
        const showZone   = isCardio;
        const metric = isMetric(profile.units);
        const wUnit = weightLabel(profile.units);
        const dUnit = distLabel(profile.units);
        const previewXP = calcEntryXP(d);
        const xpDiff = previewXP - (_optionalChain([profile, 'access', _182 => _182.log, 'access', _183 => _183[logEditModal.idx], 'optionalAccess', _184 => _184.xp])||0);
        return (
          React.createElement('div', { className: "ledit-backdrop", onClick: ()=>setLogEditModal(null)}
            , React.createElement('div', { className: "ledit-sheet", onClick: e=>e.stopPropagation()}
              /* Header */
              , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between"}}
                , React.createElement('div', null
                  , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".88rem",color:"#d4cec4"}}, "✎ Edit Log Entry"   )
                  , React.createElement('div', { style: {fontSize:".65rem",color:"#5a5650",marginTop:2}}, d.icon, " " , d.exercise)
                )
                , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setLogEditModal(null)}, "✕")
              )

              /* Source info */
              , (d.sourcePlanName||d.sourceWorkoutName)&&(
                React.createElement('div', { style: {fontSize:".65rem",color:"#8a8478",fontStyle:"italic",padding:"6px 10px",background:"rgba(45,42,36,.12)",borderRadius:7,border:"1px solid rgba(45,42,36,.2)"}}
                  , d.sourcePlanName&&React.createElement('span', null, "📋 From plan: "   , React.createElement('b', { style: {color:"#b4ac9e"}}, d.sourcePlanName))
                  , d.sourceWorkoutName&&React.createElement('span', null, "💪 From workout: "   , React.createElement('b', { style: {color:"#3498db"}}, d.sourceWorkoutName))
                )
              )

              /* Date */
              , React.createElement('div', { className: "field"}
                , React.createElement('label', null, "Date")
                , React.createElement('input', { className: "inp", type: "date", value: d.dateKey||"",
                  onChange: e=>{
                    const v = e.target.value;
                    const disp = v ? new Date(v+"T12:00:00").toLocaleDateString() : d.date;
                    setD({dateKey:v, date:disp});
                  }})
              )

              /* Sets + Reps/Duration */
              , React.createElement('div', { className: "r2"}
                , React.createElement('div', { className: "field"}
                  , React.createElement('label', null, "Sets")
                  , React.createElement('input', { className: "inp", type: "number", min: "1", max: "99", value: d.sets||1,
                    onChange: e=>setD({sets:parseInt(e.target.value)||1})})
                )
                , React.createElement('div', { className: "field"}
                  , React.createElement('label', null, isCardio||isFlex?"Duration (min)":"Reps")
                  , React.createElement('input', { className: "inp", type: "number", min: "1", max: "999", value: d.reps||1,
                    onChange: e=>setD({reps:parseInt(e.target.value)||1})})
                )
              )

              /* Weight */
              , showWeight&&(
                React.createElement('div', { className: "field"}
                  , React.createElement('label', null, "Weight (" , wUnit, ")")
                  , React.createElement('input', { className: "inp", type: "number", min: "0", step: "2.5",
                    value: d.weightLbs ? (metric?lbsToKg(d.weightLbs):d.weightLbs) : "",
                    placeholder: "0",
                    onChange: e=>{
                      const v = parseFloat(e.target.value)||null;
                      setD({weightLbs: v ? (metric?parseFloat(kgToLbs(v)):v) : null});
                    }})
                )
              )

              /* Distance */
              , showDist&&(
                React.createElement('div', { className: "field"}
                  , React.createElement('label', null, "Distance (" , dUnit, ")")
                  , React.createElement('input', { className: "inp", type: "number", min: "0", step: "0.1",
                    value: d.distanceMi ? (metric?miToKm(d.distanceMi):d.distanceMi) : "",
                    placeholder: "0",
                    onChange: e=>{
                      const v = parseFloat(e.target.value)||null;
                      setD({distanceMi: v ? (metric?parseFloat(kmToMi(v)):v) : null});
                    }})
                )
              )

              /* HR Zone */
              , showZone&&(
                React.createElement('div', { className: "field"}
                  , React.createElement('label', null, "HR Zone" )
                  , React.createElement('div', { className: "hr-zone-row"}
                    , HR_ZONES.map((z,zi)=>{
                      const zn=zi+1;
                      return (
                        React.createElement('div', { key: zn, className: `hr-zone-btn ${d.hrZone===zn?"sel":""}`,
                          style: {"--zc":z.color,borderColor:d.hrZone===zn?z.color:"rgba(45,42,36,.2)"},
                          onClick: ()=>setD({hrZone:d.hrZone===zn?null:zn})}
                          , React.createElement('span', { className: "hz-name", style: {color:z.color}}, "Z", zn)
                          , React.createElement('span', { className: "hz-bpm"}, z.short)
                        )
                      );
                    })
                  )
                )
              )

              /* XP preview */
              , React.createElement('div', { style: {background:"rgba(45,42,36,.16)",border:"1px solid rgba(180,172,158,.06)",borderRadius:9,padding:"9px 13px",display:"flex",alignItems:"center",justifyContent:"space-between"}}
                , React.createElement('div', { style: {fontSize:".7rem",color:"#5a5650"}}, "New XP for this entry"    )
                , React.createElement('div', { style: {display:"flex",alignItems:"center",gap:8}}
                  , xpDiff!==0&&React.createElement('div', { style: {fontSize:".7rem",color:xpDiff>0?"#2ecc71":"#e74c3c"}}, xpDiff>0?"+":"", xpDiff, " XP" )
                  , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:"1rem",color:"#b4ac9e"}}, "⚡ " , previewXP)
                )
              )

              /* Actions */
              , React.createElement('div', { style: {display:"flex",gap:8}}
                , React.createElement('button', { className: "btn btn-danger btn-sm"  , style: {flex:0,padding:"7px 11px"},
                  onClick: ()=>{setLogEditModal(null);deleteLogEntryByIdx(logEditModal.idx);}}, "🗑")
                , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>setLogEditModal(null)}, "Cancel")
                , React.createElement('button', { className: "btn btn-gold" , style: {flex:2}, onClick: saveLogEdit}, "✦ Save Changes"  )
              )
            )
          )
        );
      })()

      /* ══ CONFIRM DELETE MODAL ════════════════════ */
      , confirmDelete && (
        React.createElement('div', { className: "cdel-backdrop", onClick: ()=>setConfirmDelete(null)}
          , React.createElement('div', { className: "cdel-sheet", onClick: e=>e.stopPropagation()}
            , React.createElement('div', { className: "cdel-icon"}, confirmDelete.icon)
            , React.createElement('div', { className: "cdel-title"}, "Delete " , 
              confirmDelete.type==="plan"?"Plan":
              confirmDelete.type==="workout"?"Workout":
              confirmDelete.type==="exercise"?"Exercise":
              confirmDelete.type==="logEntry"?"Log Entry":
              "Character"
            , "?")
            , React.createElement('div', { className: "cdel-body"}
              , confirmDelete.type==="char"
                ? "This will permanently erase all your XP, battle log, plans, and workouts. This cannot be undone."
                : confirmDelete.type==="logEntry"
                ? React.createElement('span', null, "Remove " , React.createElement('span', { className: "cdel-name"}, confirmDelete.name), " from your log? "    , confirmDelete.xp&&React.createElement('span', null, "This will deduct "   , confirmDelete.xp, " XP." ))
                : React.createElement('span', null, "Are you sure you want to delete "       , React.createElement('span', { className: "cdel-name"}, confirmDelete.name), "? This cannot be undone."    )
              
            )
            , confirmDelete.warning&&React.createElement('div', { className: "cdel-warning"}, confirmDelete.warning)
            , React.createElement('div', { style: {display:"flex",gap:8}}
              , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1}, onClick: ()=>setConfirmDelete(null)}, "Cancel")
              , React.createElement('button', { className: "btn btn-danger" , style: {flex:1}, onClick: ()=>{
                const {type,id} = confirmDelete;
                setConfirmDelete(null);
                if(type==="plan")      _doDeletePlan(id);
                else if(type==="workout")   _doDeleteWorkout(id);
                else if(type==="exercise")  _doDeleteCustomEx(id);
                else if(type==="logEntry")  _doDeleteLogEntry(id);
                else if(type==="char")      _doResetChar();
              }}, "🗑 Delete" )
            )
          )
        )
      )

      /* ══ MAP OVERLAY ═════════════════════════════ */
      , mapOpen&&(()=>{
        const myPos = getMapPosition(profile.xp, level);
        const myRegion = MAP_REGIONS[myPos.regionIdx];
        const weekStart = (()=>{ const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); })();
        const travelActive = profile.travelBoost && profile.travelBoost.weekStart === weekStart;
        const friendPositions = friends.map(f=>{
          const fLv = Math.max(1, Math.floor(Math.log(Math.max(1,f.xp||0)/100+1)*3));
          const fPos = getMapPosition(f.xp||0, fLv);
          return {...f, mapX:fPos.x, mapY:fPos.y, regionIdx:fPos.regionIdx};
        });
        return (
          React.createElement('div', { style: {position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:200,display:"flex",flexDirection:"column",alignItems:"center",overflowY:"auto",padding:"14px 12px 30px"}}
            /* Header */
            , React.createElement('div', { style: {width:"100%",maxWidth:420,display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexShrink:0}}
              , React.createElement('div', null
                , React.createElement('div', { style: {fontFamily:"'Cinzel Decorative',serif,Arial",fontSize:".95rem",color:"#b4ac9e",letterSpacing:".08em"}}, "⚔️ Auranthel" )
                , React.createElement('div', { style: {fontSize:".65rem",color:"#8a8478",marginTop:2,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}
                  , React.createElement('span', null, myRegion.icon, " " , myRegion.name, " · Level "   , level)
                  , React.createElement('span', { style: {color:"#b4ac9e"}}, myRegion.boost.emoji, " +7% "  , myRegion.boost.label)
                  , travelActive&&React.createElement('span', { style: {color:"#2ecc71"}}, "⚡ +10% Travel"  )
                )
              )
              , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>{setMapOpen(false);setMapTooltip(null);}}, "✕")
            )

            /* Zoom controls + map */
            , React.createElement(MapSVG, { myPos: myPos, myRegion: myRegion, friendPositions: friendPositions, mapTooltip: mapTooltip, setMapTooltip: setMapTooltip, travelActive: travelActive, profile: profile})

            /* Tooltip / travel panel */
            , mapTooltip&&(
              React.createElement('div', { style: {width:"100%",maxWidth:420,marginTop:10,background:"rgba(10,8,4,.97)",border:"1px solid rgba(180,172,158,.08)",borderRadius:10,padding:"12px 14px",flexShrink:0}}
                , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}
                  , React.createElement('div', null
                    , React.createElement('div', { style: {fontSize:".84rem",color:"#d4cec4",fontWeight:600}}, mapTooltip.name)
                    , React.createElement('div', { style: {fontSize:".65rem",color:"#8a8478",marginTop:2}}, mapTooltip.cls||"Unknown", " · "  , mapTooltip.region)
                  )
                  , React.createElement('button', { className: "btn btn-ghost btn-xs"  , onClick: ()=>setMapTooltip(null)}, "✕")
                )
                , !mapTooltip.alreadyTraveling ? (
                  React.createElement('div', null
                    , React.createElement('div', { style: {fontSize:".68rem",color:"#8a8478",marginBottom:8,lineHeight:1.5}}, "Travel to their location for "
                           , React.createElement('strong', { style: {color:"#b4ac9e"}}, "+10% XP boost"  ), " on all workouts this week."
                    )
                    , React.createElement('button', { className: "btn btn-gold" , style: {width:"100%",fontSize:".72rem"},
                      onClick: ()=>{
                        const ws=(()=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-d.getDay());return d.toISOString().slice(0,10);})();
                        setProfile(p=>({...p,travelBoost:{friendId:mapTooltip.id,friendName:mapTooltip.name,weekStart:ws}}));
                        showToast(`⚔️ Traveling with ${mapTooltip.name}! +10% XP this week.`);
                        setMapTooltip(null);
                      }}, "⚔️ Travel with "
                         , mapTooltip.name
                    )
                  )
                ) : (
                  React.createElement('div', { style: {fontSize:".68rem",color:_optionalChain([profile, 'access', _185 => _185.travelBoost, 'optionalAccess', _186 => _186.friendId])===mapTooltip.id?"#2ecc71":"#8a8478",textAlign:"center",padding:"6px 0"}}
                    , _optionalChain([profile, 'access', _187 => _187.travelBoost, 'optionalAccess', _188 => _188.friendId])===mapTooltip.id
                      ? "✓ You are traveling with this warrior this week"
                      : `Already traveling with ${_optionalChain([profile, 'access', _189 => _189.travelBoost, 'optionalAccess', _190 => _190.friendName])} this week`
                  )
                )
              )
            )

            /* Legend */
            , React.createElement('div', { style: {width:"100%",maxWidth:420,marginTop:12,flexShrink:0}}
              , React.createElement('div', { style: {fontSize:".6rem",color:"#5a5650",marginBottom:6,letterSpacing:".06em",textTransform:"uppercase"}}, "Your Journey" )
              , React.createElement('div', { style: {display:"flex",flexWrap:"wrap",gap:5}}
                , MAP_REGIONS.map((r,i)=>{
                  const isVisited=i<=myPos.regionIdx, isCurrent=i===myPos.regionIdx;
                  return (
                    React.createElement('div', { key: r.id, style: {display:"flex",alignItems:"center",gap:5,padding:"4px 8px",
                      background:isCurrent?"rgba(45,42,36,.2)":"rgba(45,42,36,.12)",
                      border:`1px solid ${isCurrent?"rgba(180,172,158,.15)":isVisited?"rgba(45,42,36,.22)":"rgba(45,42,36,.18)"}`,
                      borderRadius:6,opacity:isVisited?1:.4}}
                      , React.createElement('span', { style: {fontSize:".72rem"}}, r.icon)
                      , React.createElement('div', null
                        , React.createElement('div', { style: {fontSize:".6rem",color:isCurrent?"#b4ac9e":isVisited?"#d4cec4":"#5a6060",lineHeight:1.2}}
                          , r.name, isCurrent&&React.createElement('span', { style: {color:"#b4ac9e",marginLeft:4}}, "◀")
                        )
                        , React.createElement('div', { style: {fontSize:".52rem",color:isCurrent?"#b4ac9e":isVisited?"#8a8478":"#3a4040",lineHeight:1.2}}
                          , r.boost.emoji, " " , r.boost.label, " +7% · Lv"   , r.levels[0], "–", r.levels[1]
                        )
                      )
                    )
                  );
                })
              )
            )

            /* Active travel banner */
            , travelActive&&(
              React.createElement('div', { style: {width:"100%",maxWidth:420,marginTop:10,padding:"10px 14px",background:"rgba(46,204,113,.06)",border:"1px solid rgba(46,204,113,.2)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}
                , React.createElement('div', null
                  , React.createElement('div', { style: {fontSize:".72rem",color:"#2ecc71"}}, "⚡ Travel Boost Active"   )
                  , React.createElement('div', { style: {fontSize:".62rem",color:"#8a8478",marginTop:2}}, "With " , React.createElement('strong', { style: {color:"#d4cec4"}}, profile.travelBoost.friendName), " · +10% XP all workouts this week"       )
                )
                , React.createElement('button', { className: "btn btn-ghost btn-xs"  , style: {fontSize:".6rem",color:"#e74c3c",borderColor:"rgba(231,76,60,.3)"},
                  onClick: ()=>{setProfile(p=>({...p,travelBoost:null}));showToast("Travel ended.");}}, "End")
              )
            )
          )
        );
      })()

      /* ══ SHARE MODAL ═════════════════════════════ */
      , shareModal&&(
        React.createElement('div', { className: "modal-backdrop", onClick: ()=>setShareModal(null)}
          , React.createElement('div', { className: "modal-sheet", onClick: e=>e.stopPropagation(), style: {borderRadius:16,padding:0}}
            , React.createElement('div', { className: "modal-body"}
              , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}
                , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".88rem",color:"#d4cec4",fontWeight:700}}, "⇪ Share with "
                     , shareModal.friendName
                )
                , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setShareModal(null)}, "✕")
              )
              , shareModal.step==="pick-type"&&(
                React.createElement(React.Fragment, null
                  , React.createElement('div', { style: {fontSize:".72rem",color:"#8a8478",marginBottom:12}}, "What would you like to share?"     )
                  , React.createElement('div', { style: {display:"flex",gap:8}}
                    , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1,fontSize:".72rem"},
                      onClick: ()=>setShareModal({...shareModal,step:"pick-workout"})}, "💪 A Workout"

                    )
                    , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {flex:1,fontSize:".72rem"},
                      onClick: ()=>setShareModal({...shareModal,step:"pick-exercise"})}, "⚡ A Custom Exercise"

                    )
                  )
                )
              )
              , shareModal.step==="pick-workout"&&(
                React.createElement(React.Fragment, null
                  , React.createElement('div', { style: {fontSize:".72rem",color:"#8a8478",marginBottom:10}}, "Choose a workout to share:"    )
                  , (profile.workouts||[]).length===0&&React.createElement('div', { className: "empty"}, "No workouts saved yet."   )
                  , (profile.workouts||[]).map(wo=>(
                    React.createElement('div', { key: wo.id, style: {display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid rgba(45,42,36,.15)",cursor:"pointer"},
                      onClick: ()=>shareWithFriend("workout",wo,shareModal.friendId,shareModal.friendName)}
                      , React.createElement('span', { style: {fontSize:"1.2rem"}}, wo.icon)
                      , React.createElement('div', { style: {flex:1}}
                        , React.createElement('div', { style: {fontSize:".78rem",color:"#d4cec4"}}, wo.name)
                        , React.createElement('div', { style: {fontSize:".62rem",color:"#8a8478"}}, _optionalChain([wo, 'access', _191 => _191.exercises, 'optionalAccess', _192 => _192.length])||0, " exercises" )
                      )
                      , React.createElement('span', { style: {fontSize:".65rem",color:"#b4ac9e"}}, "Share →" )
                    )
                  ))
                  , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {width:"100%",marginTop:10}, onClick: ()=>setShareModal({...shareModal,step:"pick-type"})}, "← Back" )
                )
              )
              , shareModal.step==="pick-exercise"&&(
                React.createElement(React.Fragment, null
                  , React.createElement('div', { style: {fontSize:".72rem",color:"#8a8478",marginBottom:10}}, "Choose a custom exercise to share:"     )
                  , (profile.customExercises||[]).length===0&&React.createElement('div', { className: "empty"}, "No custom exercises yet."   )
                  , (profile.customExercises||[]).map(ex=>(
                    React.createElement('div', { key: ex.id, style: {display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid rgba(45,42,36,.15)",cursor:"pointer"},
                      onClick: ()=>shareWithFriend("exercise",ex,shareModal.friendId,shareModal.friendName)}
                      , React.createElement('span', { style: {fontSize:"1.2rem"}}, ex.icon)
                      , React.createElement('div', { style: {flex:1}}
                        , React.createElement('div', { style: {fontSize:".78rem",color:"#d4cec4"}}, ex.name)
                        , React.createElement('div', { style: {fontSize:".62rem",color:"#8a8478",textTransform:"capitalize"}}, ex.category)
                      )
                      , React.createElement('span', { style: {fontSize:".65rem",color:"#b4ac9e"}}, "Share →" )
                    )
                  ))
                  , React.createElement('button', { className: "btn btn-ghost btn-sm"  , style: {width:"100%",marginTop:10}, onClick: ()=>setShareModal({...shareModal,step:"pick-type"})}, "← Back" )
                )
              )
            )
          )
        )
      )

      /* ══ FEEDBACK MODAL ══════════════════════════ */
      , feedbackOpen&&(
        React.createElement('div', { className: "modal-backdrop", onClick: ()=>setFeedbackOpen(false)}
          , React.createElement('div', { className: "modal-sheet", onClick: e=>e.stopPropagation(), style: {borderRadius:16,padding:0}}
            , React.createElement('div', { className: "modal-body"}
              , React.createElement('div', { style: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}
                , React.createElement('div', { className: "feedback-title" }, "🛟 Support")
                , React.createElement('button', { className: "btn btn-ghost btn-sm"  , onClick: ()=>setFeedbackOpen(false)}, "✕")
              )
              , !feedbackSent && React.createElement('div', { style: {display:"flex",gap:6,marginBottom:14}}
                , ["bug","idea","help"].map(t=>
                  React.createElement('button', {
                    key: t,
                    onClick: ()=>setFeedbackType(t),
                    style: {
                      flex:1, padding:"6px 0", borderRadius:8, fontSize:".72rem", fontWeight:600,
                      border: feedbackType===t ? "1.5px solid #c9a84c" : "1.5px solid #3a342c",
                      background: feedbackType===t ? "#2a2318" : "transparent",
                      color: feedbackType===t ? "#c9a84c" : "#8a8478",
                      cursor:"pointer", textTransform:"capitalize",
                    }
                  }, t==="bug"?"🐛 Bug":t==="idea"?"💡 Idea":"🛟 Help")
                )
              )
              , feedbackSent ? (
                helpConfirmShown ? (
                  React.createElement('div', { style: {textAlign:"center",padding:"24px 0"}}
                    , React.createElement('div', { style: {fontSize:"2rem",marginBottom:10}}, "📬")
                    , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".88rem",color:"#b4ac9e",marginBottom:6}}, "Help request received!")
                    , React.createElement('div', { style: {fontSize:".72rem",color:"#8a8478",lineHeight:1.6,maxWidth:280,margin:"0 auto"}},
                      "You\u2019ll receive an email from Support@aurisargames.com upon review that will ask for your 12-character Private User ID to verify your identity.")
                    , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {marginTop:16}, onClick: ()=>setFeedbackOpen(false)}, "Close")
                  )
                ) : (
                  React.createElement('div', { style: {textAlign:"center",padding:"24px 0"}}
                    , React.createElement('div', { style: {fontSize:"2rem",marginBottom:10}}, "⚡")
                    , React.createElement('div', { style: {fontFamily:"'Inter',sans-serif",fontSize:".88rem",color:"#b4ac9e",marginBottom:6}}, "Feedback received!" )
                    , React.createElement('div', { style: {fontSize:".72rem",color:"#8a8478"}}, "Thanks for helping forge Aurisar into something legendary.")
                    , React.createElement('button', { className: "btn btn-ghost btn-sm", style: {marginTop:16}, onClick: ()=>setFeedbackOpen(false)}, "Close")
                  )
                )
              ) : (
                React.createElement(React.Fragment, null
                  , React.createElement('div', { className: "field", style: {marginBottom:8}}
                    , React.createElement('label', null, "Email Address")
                    , React.createElement('input', { className: "inp", type: "email",
                      placeholder: "your@email.com",
                      value: feedbackEmail,
                      onChange: e=>setFeedbackEmail(e.target.value)})
                  )
                  , React.createElement('div', { className: "field", style: {marginBottom:8}}
                    , React.createElement('label', null, "Account ID")
                    , React.createElement('input', { className: "inp", type: "text",
                      placeholder: "e.g. A7XK9M",
                      value: feedbackAccountId,
                      onChange: e=>setFeedbackAccountId(e.target.value)})
                  )
                  , React.createElement('div', { className: "field", style: {marginBottom:12}}
                    , React.createElement('label', null, feedbackType==="bug"?"Describe the bug":feedbackType==="help"?"How can we help?":"What's on your mind?")
                    , React.createElement('textarea', { className: "inp", rows: 5,
                      style: {resize:"vertical",minHeight:100,lineHeight:1.5},
                      placeholder: feedbackType==="idea"?"I'd love to see…":feedbackType==="bug"?"When I tap… it does…":"Describe your issue…",
                      value: feedbackText,
                      onChange: e=>setFeedbackText(e.target.value)})
                  )
                  , React.createElement('button', { className: "btn btn-gold" , style: {width:"100%"},
                    disabled: !feedbackText.trim(),
                    onClick: async()=>{
                      const msg = feedbackText.trim();
                      const type = feedbackType;
                      const email = feedbackEmail.trim();
                      const acctId = feedbackAccountId.trim();
                      // Show success immediately (optimistic UI)
                      setFeedbackSent(true);
                      if (type === "help") setHelpConfirmShown(true);
                      setFeedbackText("");
                      // Store in Supabase
                      try {
                        await sb.from("feedback").insert({
                          user_id:_optionalChain([authUser, 'optionalAccess', _193 => _193.id])||null,
                          email: email||"anonymous",
                          type,
                          message:msg,
                          account_id: acctId||null,
                          created_at:new Date().toISOString(),
                        });
                      } catch(e) {
                        console.log("Supabase feedback insert failed:", e);
                      }
                      // Send email to support@aurisargames.com for all types
                      try {
                        await fetch("/api/send-support-email", {
                          method: "POST",
                          headers: {"Content-Type":"application/json"},
                          body: JSON.stringify({ type, message: msg, email, accountId: acctId }),
                        });
                      } catch(e) {
                        console.log("Support email failed:", e);
                      }
                      // For Idea/Bug, also create a GitHub issue
                      if (type === "idea" || type === "bug") {
                        try {
                          await fetch("/api/create-github-issue", {
                            method: "POST",
                            headers: {"Content-Type":"application/json"},
                            body: JSON.stringify({ type, message: msg, email, accountId: acctId }),
                          });
                        } catch(e) {
                          console.log("GitHub issue creation failed:", e);
                        }
                      }
                    }}, "Submit"

                  )
                )
              )
            )
          )
        )
      )

    )
  );
}

export default App;
