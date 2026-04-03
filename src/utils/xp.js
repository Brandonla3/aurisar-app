import { _optionalChain } from './helpers.js';
import { CLASSES, EXERCISES } from '../data/exercises.js';
import { EX_BY_ID, RUNNING_EX_ID } from '../data/constants.js';

const MUSCLE_COLORS = {
  chest:"#9E7B6B", back:"#7B8D7A", shoulder:"#A89070", bicep:"#8B7E6A",
  legs:"#7A8F8B", glutes:"#A08878", abs:"#8A9880", calves:"#9A8A7A",
  forearm:"#7E8E80", full_body:"#B0A090", cardio:"#809090"
};

const TYPE_COLORS = {
  strength:"#C4A044", cardio:"#C4A044", flexibility:"#C4A044", yoga:"#C4A044",
  calisthenics:"#8A7858", plyometric:"#8A7858", isometric:"#8A7858", functional:"#8A7858",
  stretching:"#B0A898", warmup:"#B0A898", cooldown:"#B0A898"
};

function getMuscleColor(mg) {
  return MUSCLE_COLORS[(mg||"").toLowerCase().trim()] || "#B0A090";
}

function getTypeColor(cat) {
  return TYPE_COLORS[(cat||"").toLowerCase().trim()] || "#B0A898";
}

function hrRange(age, zone) {
  const maxHR = 220 - (parseInt(age)||30);
  return { lo: Math.round(maxHR * zone.pct[0]/100), hi: Math.round(maxHR * zone.pct[1]/100) };
}

// Scale a weight value by a percentage (returns rounded to nearest 0.5)
function scaleWeight(baseW, pct) {
  const scaled = parseFloat(baseW||0) * (pct/100);
  return Math.round(scaled * 2) / 2; // round to nearest 0.5 lb
}

// Scale duration (minutes) by intensity, round to nearest whole minute
function scaleDur(baseDur, pct) {
  return Math.max(1, Math.round(parseFloat(baseDur||0) * pct / 100));
}

const _XP_PER_LEVEL = [
  1200,2488,2664,2848,3040,3240,3448,3664,3888,4120,
  4360,4608,4864,5128,5400,5680,5968,6264,6568,6880,
  7200,7528,7864,8208,8560,8920,9288,9664,10048,10440,
  10840,11248,11664,12088,12520,12960,13408,13864,14328,14800,
  15280,15768,16264,16768,17280,17800,18328,18864,19408,19960,
  20520,21088,21664,22248,22840,23440,24048,24664,25288,25920,
  26560,27208,27864,28528,29200,29880,30568,31264,31968,32680,
  33400,34128,34864,35608,36360,37120,37888,38664,39448,40240,
  41040,41848,42664,43488,44320,45160,46008,46864,47728,48600,
  49480,50368,51264,52168,53080,54000,54928,55864,56808
];

function buildXPTable(max=100) {
  const t=[0,0];
  for(let lv=2;lv<=Math.min(max,100);lv++){
    t[lv]=t[lv-1]+_XP_PER_LEVEL[lv-2];
  }
  return t;
}

const XP_TABLE = buildXPTable(100);

const xpToLevel = xp => { let lv=1; while(lv<XP_TABLE.length-1&&xp>=XP_TABLE[lv+1]) lv++; return lv; };
const xpForLevel = l  => XP_TABLE[Math.min(l,XP_TABLE.length-1)]||0;
const xpForNext  = l  => XP_TABLE[Math.min(l+1,XP_TABLE.length-1)]||XP_TABLE[XP_TABLE.length-1]||0;

const calcBMI = (w,h) => (!w||!h)?null:((w/(h*h))*703).toFixed(1);

const detectClassFromAnswers = (sports, priorities, style) => {
  const scores = {warrior:0,gladiator:0,warden:0,phantom:0,tempest:0,warlord:0,druid:0,oracle:0};
  const teamSports   = ["football","basketball","soccer","baseball","volleyball","tennis","wrestling"];
  const endureSports = ["running","cycling","triathlon","hiking","rowing"];
  const waterSports  = ["swimming","rowing","triathlon"];
  const combatSports = ["boxing","mma","wrestling"];
  teamSports.forEach(s=>{if(sports.includes(s)){scores.gladiator+=2;scores.warlord+=1;}});
  endureSports.forEach(s=>{if(sports.includes(s)){scores.warden+=3;}});
  waterSports.forEach(s=>{if(sports.includes(s))scores.tempest+=3;});
  combatSports.forEach(s=>{if(sports.includes(s)){scores.gladiator+=2;scores.warrior+=1;}});
  ["hiking","cycling"].forEach(s=>{if(sports.includes(s))scores.warden+=1;});
  if(sports.includes("powerlifting"))scores.warrior+=4;
  if(sports.includes("bodybuilding"))scores.phantom+=4;
  if(sports.includes("crossfit")){scores.gladiator+=2;scores.warrior+=2;}
  if(sports.includes("yoga")||sports.includes("gymnastics")||sports.includes("dance"))scores.druid+=3;
  if(sports.includes("golf"))scores.oracle+=2;
  if(priorities.includes("be_strong")){scores.warrior+=3;scores.gladiator+=1;}
  if(priorities.includes("look_strong"))scores.phantom+=4;
  if(priorities.includes("feel_good")){scores.druid+=3;scores.warden+=2;}
  if(priorities.includes("eat_right"))scores.oracle+=2;
  if(priorities.includes("mental_clarity")){scores.oracle+=2;scores.druid+=2;}
  if(priorities.includes("athletic_perf")){scores.gladiator+=3;scores.warden+=2;}
  if(priorities.includes("endurance")){scores.warden+=3;scores.tempest+=2;}
  if(priorities.includes("longevity")){scores.druid+=3;scores.oracle+=2;}
  if(priorities.includes("competition")){scores.gladiator+=3;scores.warrior+=2;}
  if(priorities.includes("social"))scores.warlord+=5;
  if(priorities.includes("flexibility"))scores.druid+=3;
  if(style==="heavy")scores.warrior+=4;
  if(style==="cardio"){scores.warden+=3;scores.tempest+=2;}
  if(style==="sculpt")scores.phantom+=4;
  if(style==="hiit"){scores.gladiator+=2;scores.warrior+=1;}
  if(style==="mindful"){scores.druid+=4;scores.oracle+=2;}
  if(style==="sport"){scores.gladiator+=2;scores.warden+=2;}
  if(style==="mixed"){scores.warlord+=2;scores.gladiator+=1;}
  return Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0];
};

const detectClass = bio => {
  const lower=bio.toLowerCase();
  const sports=[]; const priorities=[]; let style="mixed";
  if(lower.includes("lift")||lower.includes("weight")||lower.includes("bench")||lower.includes("squat")||lower.includes("deadlift"))style="heavy";
  if(lower.includes("run")||lower.includes("cardio")||lower.includes("cycle"))style="cardio";
  if(lower.includes("yoga")||lower.includes("stretch")||lower.includes("meditat"))style="mindful";
  if(lower.includes("boxing")||lower.includes("mma"))sports.push("boxing");
  if(lower.includes("swim"))sports.push("swimming");
  if(lower.includes("powerlifting"))sports.push("powerlifting");
  if(lower.includes("bodybuilding")||lower.includes("physique"))sports.push("bodybuilding");
  if(lower.includes("crossfit"))sports.push("crossfit");
  if(lower.includes("hike")||lower.includes("trail"))sports.push("hiking");
  return detectClassFromAnswers(sports, priorities, style);
};

function calcExXP(exId,sets,reps,classKey,exLookup,distanceMi) {
  const ex=(exLookup||EX_BY_ID)[exId]||EX_BY_ID[exId]; if(!ex) return 0;
  const mult=classKey?(_optionalChain([CLASSES, 'access', _2 => _2[classKey], 'optionalAccess', _3 => _3.bonuses, 'access', _4 => _4[ex.category]])||1):1;
  const s=parseInt(sets)||0,r=parseInt(reps)||0;
  const distBonus = distanceMi ? 1+Math.min(distanceMi*0.05,0.5) : 1;
  const runPace = (exId===RUNNING_EX_ID && distanceMi && r) ? r/distanceMi : null;
  const paceBonus = runPace ? (runPace<=8 ? 1.20 : 1.05) : 1;
  return Math.round(ex.baseXP*mult*(1+(s*r-1)*0.05)*distBonus*paceBonus);
}

function calcPlanXP(plan,classKey,exLookup) {
  return plan.days.reduce((t,d)=>t+d.exercises.reduce((s,ex)=>s+calcExXP(ex.exId,ex.sets,ex.reps,classKey,exLookup),0),0);
}

function calcDayXP(day,classKey,exLookup) {
  return day.exercises.reduce((s,ex)=>s+calcExXP(ex.exId,ex.sets,ex.reps,classKey,exLookup),0);
}

// ── PERSONAL BEST CALCULATOR ─────────────────────────────────────
// Returns { exId: { type:"strength"|"assisted"|"cardio", value, display } }
// Strength 1RM: highest weight at exactly 1 set × 1 rep
// Assisted 1RM: lowest weight at exactly 1 set × 1 rep (lower = better)
// Cardio PB: best (lowest) pace in min/mi from distanceMi + reps(duration)
function calcExercisePBs(log, exLookup) {
  const pbs = {};
  const lookup = exLookup || EX_BY_ID;
  (log||[]).forEach(entry => {
    const exId = entry.exId;
    if(!exId) return;
    const ex = lookup[exId];
    if(!ex) return;
    const isCardio = ex.category === "cardio";
    const isAssisted = ex.name && ex.name.toLowerCase().includes("assisted");
    if(isCardio) {
      // Cardio PB: best pace = lowest min/mi
      if(entry.distanceMi && entry.distanceMi > 0 && entry.reps && entry.reps > 0) {
        const pace = entry.reps / entry.distanceMi; // min/mi
        if(!pbs[exId] || pace < pbs[exId].value) {
          pbs[exId] = { type:"cardio", value:pace };
        }
      }
    } else {
      // Strength 1RM: exactly 1 set × 1 rep
      const sets = parseInt(entry.sets)||0;
      const reps = parseInt(entry.reps)||0;
      const weight = parseFloat(entry.weightLbs)||0;
      if(sets === 1 && reps === 1 && weight > 0) {
        const existing = pbs[exId];
        if(isAssisted) {
          // Assisted: lower weight = better
          if(!existing || weight < existing.value) {
            pbs[exId] = { type:"assisted", value:weight };
          }
        } else {
          // Standard: higher weight = better
          if(!existing || weight > existing.value) {
            pbs[exId] = { type:"strength", value:weight };
          }
        }
      }
    }
  });
  return pbs;
}

// ── CLASS FLAT BONUSES ───────────────────────────────────────────
// Applied once at character creation on top of the level formula.
// Active classes: 10 pts. Locked classes: 12 pts.
const CLASS_FLAT = {
  warrior:   {STR:4, CON:3, END:2, CHA:1},
  gladiator: {CHA:4, STR:3, CON:2, END:1},
  warden:    {END:4, WIS:3, CON:2, VIT:1},
  phantom:   {DEX:4, STR:3, CHA:2, INT:1},
  tempest:   {VIT:4, END:3, DEX:2, WIS:1},
  warlord:   {CHA:4, INT:3, WIS:2, STR:1},
  druid:     {WIS:4, INT:3, DEX:2, VIT:1},
  oracle:    {INT:4, WIS:3, VIT:2, END:1},
  titan:     {STR:5, CON:4, END:3},
  striker:   {DEX:5, STR:3, END:2, VIT:2},
  alchemist: {INT:5, WIS:4, CON:2, VIT:1},
};

// ── DECISION TREE STAT BONUSES ───────────────────────────────────
// Calculates one-time creation bonuses from onboarding questionnaire.
function calcDecisionTreeBonus(sports, priorities, timing, style, freq) {
  const b = {STR:0,END:0,DEX:0,CON:0,INT:0,CHA:0,WIS:0,VIT:0};
  const add = (stat, amt) => { b[stat] = (b[stat]||0) + amt; };

  // Sports — max 3 counted
  const SPORT_BONUSES = {
    football:    {STR:1,CON:1}, wrestling:   {STR:1,CON:1},
    basketball:  {DEX:1,VIT:1}, volleyball:  {DEX:1,VIT:1},
    soccer:      {END:1,VIT:1}, cycling:     {END:1,VIT:1},
    baseball:    {DEX:2},       gymnastics:  {DEX:2},
    tennis:      {DEX:1,CHA:1}, dance:       {DEX:1,CHA:1},
    running:     {END:2},
    swimming:    {VIT:2},
    triathlon:   {END:1,VIT:1,WIS:1},
    rowing:      {STR:1,END:1},
    boxing:      {DEX:1,STR:1},
    mma:         {DEX:1,WIS:1},
    crossfit:    {STR:1,END:1},
    powerlifting:{STR:2,CON:1},
    bodybuilding:{STR:1,CHA:1,INT:1},
    yoga:        {DEX:1,WIS:1},
    hiking:      {END:1,WIS:1},
    golf:        {INT:1,WIS:1},
  };
  const validSports = (sports||[]).filter(s=>s!=="none").slice(0,3);
  validSports.forEach(s => {
    const bonuses = SPORT_BONUSES[s]; if(!bonuses) return;
    Object.entries(bonuses).forEach(([stat,amt]) => add(stat, amt));
  });

  // Timing / discipline trait
  if(timing==="earlymorning") { add("WIS",2); add("CON",1); }
  else if(timing==="morning") { add("WIS",1); }
  else if(timing==="evening") { add("VIT",1); }

  // Fitness priorities — each selected priority = +1, max 3
  const PRIORITY_BONUSES = {
    be_strong:"STR", look_strong:"CHA", feel_good:"VIT",
    eat_right:"CON", mental_clarity:"INT", athletic_perf:"END",
    endurance:"END", longevity:"WIS", competition:"CHA",
    social:"CHA", flexibility:"DEX", weight_loss:"VIT",
  };
  (priorities||[]).slice(0,3).forEach(p => {
    const stat = PRIORITY_BONUSES[p]; if(stat) add(stat, 1);
  });

  // Training style — +2 total
  const STYLE_BONUSES = {
    heavy:   {STR:2},
    cardio:  {VIT:1,END:1},
    sculpt:  {CHA:1,DEX:1},
    hiit:    {STR:1,VIT:1},
    mindful: {WIS:1,DEX:1},
    sport:   {DEX:1,END:1},
    mixed:   {INT:1,WIS:1},
  };
  const sb = STYLE_BONUSES[style]; if(sb) Object.entries(sb).forEach(([stat,amt])=>add(stat,amt));

  // Gym frequency — consistency bonus
  const FREQ_BONUSES = {
    light:     {CON:1},
    moderate:  {CON:1,END:1},
    dedicated: {CON:2,END:1},
    elite:     {CON:2,END:1,VIT:1},
  };
  const fb = FREQ_BONUSES[freq]; if(fb) Object.entries(fb).forEach(([stat,amt])=>add(stat,amt));

  return b;
}

// ── MAIN STAT CALCULATOR ─────────────────────────────────────────
// Derives 8 stats from: level formula + class flat bonuses + decision tree bonuses.
// Full calc-on-read from workout log replaces the multiplier formula in a future pass.
function calcCharStats(cls, level, classKey, profile) {
  const base = 10 + (level * 2);
  const s = cls.bonuses.strength||1, c = cls.bonuses.cardio||1, f = cls.bonuses.flexibility||1, e = cls.bonuses.endurance||1;
  const multiplied = {
    STR: Math.round(base * s),
    END: Math.round(base * e),
    DEX: Math.round(base * (f*0.6 + c*0.4)),
    CON: Math.round(base * (s*0.6 + e*0.4)),
    INT: Math.round(base * 1.0),
    CHA: Math.round(base * (s*0.5 + f*0.5)),
    WIS: Math.round(base * (e*0.5 + f*0.5)),
    VIT: Math.round(base * c),
  };
  // Add class flat bonuses
  const flat = CLASS_FLAT[classKey] || {};
  Object.entries(flat).forEach(([stat,amt]) => { multiplied[stat] = (multiplied[stat]||0) + amt; });
  // Add decision tree bonuses (stored once on profile at creation)
  const dt = profile ? calcDecisionTreeBonus(
    profile.sportsBackground, profile.fitnessPriorities,
    profile.workoutTiming, profile.trainingStyle, profile.workoutFreq
  ) : {};
  Object.entries(dt).forEach(([stat,amt]) => { multiplied[stat] = (multiplied[stat]||0) + amt; });
  return multiplied;
}

// Check if a quest is auto-completed given log + streak
function checkQuestCompletion(quest, log, streak) {
  if(quest.manual) return false;
  if(quest.streak) return streak >= quest.streak;
  if(_optionalChain([quest, 'access', _5 => _5.auto, 'optionalAccess', _6 => _6.total])) return log.length >= quest.auto.total;
  if(_optionalChain([quest, 'access', _7 => _7.auto, 'optionalAccess', _8 => _8.exId])) {
    const count = log.filter(e=>_optionalChain([EXERCISES, 'access', _9 => _9.find, 'call', _10 => _10(ex=>ex.name===e.exercise), 'optionalAccess', _11 => _11.id])===quest.auto.exId).length;
    return count >= quest.auto.count;
  }
  return false;
}

export {
  getMuscleColor,
  getTypeColor,
  hrRange,
  scaleWeight,
  scaleDur,
  buildXPTable,
  XP_TABLE,
  xpToLevel,
  xpForLevel,
  xpForNext,
  calcBMI,
  detectClassFromAnswers,
  detectClass,
  calcExXP,
  calcPlanXP,
  calcDayXP,
  calcExercisePBs,
  CLASS_FLAT,
  calcDecisionTreeBonus,
  calcCharStats,
  checkQuestCompletion
};
