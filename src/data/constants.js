import { EXERCISES, CLASSES } from './exercises.js';

const EX_BY_ID = Object.fromEntries(EXERCISES.map(e=>[e.id,e]));

// ═══════════════════════════════════════════════════════════════════
// PHASE 1 — Iconify Exercise Icons (SVG API)
// Uses Iconify's SVG API to render icons as plain <img> tags.
// No web component, no JS runtime, no font files — just HTTP-cached SVGs.
// Works on iOS Safari, Android, every desktop browser, everywhere.
// Primary sets: game-icons (RPG-themed), mdi (fitness)
// Browse: https://icon-sets.iconify.design
// ═══════════════════════════════════════════════════════════════════

// MUSCLE_COLORS defined in color section below — referenced by getExIconColor
const CAT_ICON_COLORS = {
  strength:"#e05555", cardio:"#2ecc71", flexibility:"#9b59b6", endurance:"#3498db",
};

const NAME_ICON_MAP = [
  // CHEST
  [/bench press|chest press|floor press/i,         "game-icons:weight-lifting-up"],
  [/push.?up|press.?up/i,                          "game-icons:push"],
  [/dip\b/i,                                       "game-icons:muscle-up"],
  [/fly|flye|pec.?dec|cable cross/i,               "game-icons:eagle-emblem"],
  [/chest/i,                                       "game-icons:chest-armor"],
  // BACK
  [/pull.?up|chin.?up/i,                           "game-icons:muscle-up"],
  [/lat pull|pulldown/i,                           "game-icons:weight-lifting-down"],
  [/row|bent.?over|pendlay|t.?bar/i,               "game-icons:weight-lifting-up"],
  [/deadlift|rack pull/i,                          "game-icons:weight-lifting-up"],
  [/shrug|trap/i,                                  "game-icons:shoulder-armor"],
  [/face pull/i,                                   "game-icons:muscle-fat"],
  [/back ext/i,                                    "game-icons:back-pain"],
  // SHOULDERS
  [/overhead|ohp|military|shoulder press/i,        "game-icons:weight-lifting-up"],
  [/lateral raise|side raise/i,                    "game-icons:wingspan"],
  [/front raise/i,                                 "game-icons:wingfoot"],
  [/rear delt|reverse fly/i,                       "game-icons:eagle-emblem"],
  [/shoulder/i,                                    "game-icons:shoulder-armor"],
  // ARMS
  [/bicep|curl|preacher|hammer curl|concentration/i, "game-icons:biceps"],
  [/tricep|skull crush|push.?down|kick.?back/i,     "game-icons:fist"],
  [/wrist curl|forearm|grip/i,                       "game-icons:grab"],
  // LEGS
  [/squat|goblet|hack squat|front squat/i,         "game-icons:leg-armor"],
  [/lunge|split squat|bulgarian|step.?up/i,        "game-icons:boot-stomp"],
  [/leg press/i,                                   "game-icons:leg-armor"],
  [/leg curl|hamstring|rdl|romanian/i,             "game-icons:leg"],
  [/leg ext|quad/i,                                "game-icons:leg-armor"],
  [/calf|soleus|gastro/i,                          "game-icons:boot-stomp"],
  [/hip thrust|glute|bridge|kickback/i,            "game-icons:muscle-fat"],
  // CORE
  [/plank|hollow|dead bug|l.?sit/i,                "game-icons:stone-block"],
  [/crunch|sit.?up|ab.?wheel|v.?up/i,             "game-icons:abdominal-armor"],
  [/twist|wood.?chop|rotation|oblique/i,           "game-icons:spinning-sword"],
  [/hang.?raise|leg raise|knee raise/i,            "game-icons:muscle-up"],
  [/core|ab\b/i,                                   "game-icons:abdominal-armor"],
  // CARDIO
  [/sprint/i,                                      "game-icons:running-ninja"],
  [/run|jog|treadmill/i,                           "game-icons:run"],
  [/cycl|bike|spin|peloton/i,                      "mdi:bike"],
  [/swim|pool|lap|stroke/i,                        "game-icons:swimming"],
  [/row|erg|concept/i,                             "game-icons:rowing"],
  [/jump rope|skipping/i,                          "game-icons:jump-across"],
  [/jump|box jump|plyo|burpee/i,                   "game-icons:jump-across"],
  [/stair|stepper|step mill/i,                     "game-icons:stairs-goal"],
  [/hike|incline walk|mountain/i,                  "game-icons:mountain-climbing"],
  [/walk|march/i,                                  "game-icons:walk"],
  [/elliptical|cross.?train/i,                     "game-icons:run"],
  [/battle rope|wave/i,                            "game-icons:lasso"],
  [/ski/i,                                         "game-icons:ski-boot"],
  [/sled/i,                                        "game-icons:push"],
  // FLEXIBILITY
  [/yoga|sun salut|warrior pose|vinyasa/i,         "game-icons:meditation"],
  [/stretch|mobility|foam roll|pigeon/i,           "game-icons:body-balance"],
  [/lotus|meditation/i,                            "game-icons:lotus-flower"],
  // EQUIPMENT
  [/kettlebell|kb swing|clean.*press/i,            "game-icons:kettlebell"],
  [/ball slam|medicine ball|wall ball/i,           "game-icons:bowling-strike"],
  [/band|resistance|banded/i,                      "game-icons:chain"],
  [/cable|machine/i,                               "game-icons:gear-hammer"],
  [/bar hang|farmer|carry/i,                       "game-icons:grab"],
  [/muscle.?up/i,                                  "game-icons:muscle-up"],
  [/clean.?and.?jerk|snatch|power clean/i,         "game-icons:weight-lifting-up"],
  [/box/i,                                         "game-icons:wooden-crate"],
  // REST / RECOVERY
  [/rest day|rest|recovery|off day|deload/i,       "game-icons:camping-tent"],
];

const MUSCLE_ICON_MAP = {
  chest:"game-icons:chest-armor", back:"game-icons:muscle-up", shoulder:"game-icons:shoulder-armor",
  bicep:"game-icons:biceps", forearm:"game-icons:grab", tricep:"game-icons:fist",
  legs:"game-icons:leg-armor", glutes:"game-icons:muscle-fat", calves:"game-icons:boot-stomp",
  abs:"game-icons:abdominal-armor",
};
const CAT_ICON_FALLBACK = {
  strength:"game-icons:weight-lifting-up", cardio:"game-icons:run",
  flexibility:"game-icons:meditation", endurance:"game-icons:run",
};

function getExIconName(ex) {
  if (!ex) return "game-icons:weight-lifting-up";
  const nm = (ex.name || "");
  for (const [regex, icon] of NAME_ICON_MAP) { if (regex.test(nm)) return icon; }
  const mg = (ex.muscleGroup || "").toLowerCase();
  if (MUSCLE_ICON_MAP[mg]) return MUSCLE_ICON_MAP[mg];
  const cat = (ex.category || "").toLowerCase();
  return CAT_ICON_FALLBACK[cat] || "game-icons:weight-lifting-up";
}

function getExIconColor(ex) {
  if (!ex) return "#b4ac9e";
  const mg = (ex.muscleGroup || "").toLowerCase().trim();
  if (mg && MUSCLE_COLORS[mg]) return MUSCLE_COLORS[mg];
  const cat = (ex.category || "").toLowerCase();
  return CAT_ICON_COLORS[cat] || "#b4ac9e";
}

function ExIcon({ ex, size = "1.15rem", color, style = {} }) {
  if (ex && ex.custom) {
    return React.createElement('span', {
      style: { fontSize: size, lineHeight: 1, display: "block", ...style }
    }, ex.icon || "💪");
  }
  const iconName = getExIconName(ex);
  const fill = color || getExIconColor(ex);
  const iconPath = iconName.replace(":", "/");
  const encodedColor = encodeURIComponent(fill);
  const src = `https://api.iconify.design/${iconPath}.svg?color=${encodedColor}`;
  const pxSize = typeof size === "string" && size.endsWith("rem")
    ? (parseFloat(size) * 16) + "px" : size;
  return React.createElement('img', {
    src, alt: "", width: pxSize, height: pxSize, loading: "lazy",
    style: { display: "block", flexShrink: 0, ...style },
  });
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 2 — game-icons.net class SVGs (CC BY 3.0, Delapouite/Lorc)
// Embedded inline so no network request needed.
// Attribution: game-icons.net
// ═══════════════════════════════════════════════════════════════════
const CLASS_SVG_PATHS = {
  // Warrior — crossed swords
  warrior: "M256 192L346.2 281.6 281.6 346.2 192 256 101.8 346.2 0 448 64 512 165.8 410.2 256 320 346.2 410.2 448 512 512 448 410.2 346.2 320 256 410.2 165.8 346.2 101.8 192 256ZM512 0L320 192 192 64 0 0 64 192 192 320 0 512 64 512 192 384 320 512 512 384 448 256 512 128Z",
  // Gladiator — spartan helmet
  gladiator: "M256 32C149 32 64 117 64 224v32h32v-32c0-88.4 71.6-160 160-160s160 71.6 160 160v32h32v-32C448 117 363 32 256 32zM192 288H128v128h64V288zM384 288h-64v128h64V288zM128 384v32c0 53 43 96 96 96h64c53 0 96-43 96-96v-32H128z",
  // Warden — pine tree / trail marker
  warden: "M256 16L96 272h80L112 480h288L336 272h80L256 16zM220 416l16-80h40l16 80H220z",
  // Phantom — eye within a diamond
  phantom: "M256 64L32 256 256 448 480 256 256 64zM256 176c44.2 0 80 35.8 80 80s-35.8 80-80 80-80-35.8-80-80 35.8-80 80-80zM256 224c-17.7 0-32 14.3-32 32s14.3 32 32 32 32-14.3 32-32-14.3-32-32-32z",
  // Tempest — wave
  tempest: "M32 256c48 0 48-64 96-64s48 64 96 64 48-64 96-64 48 64 96 64 48-64 96-64v64c-48 0-48 64-96 64s-48-64-96-64-48 64-96 64-48-64-96-64-48 64-96 64V256c48 0 48-64 96-64zM32 352c48 0 48-64 96-64s48 64 96 64 48-64 96-64 48 64 96 64 48-64 96-64v64c-48 0-48 64-96 64s-48-64-96-64-48 64-96 64-48-64-96-64-48 64-96 64V352c48 0 48-64 96-64z",
  // Warlord — bow and arrow
  warlord: "M480 32L352 96 416 160 320 256 256 192 192 256 160 288c-18 18-18 48 0 66l0 0c18 18 48 18 66 0L288 288l64 64-96 96-64-64L128 448l64 64L480 32zM64 384L0 480l96-96L64 384z",
  // Druid — leaf
  druid: "M256 32C150 32 64 100 32 196c64 0 128 32 160 80-16-96 32-180 96-212C430 48 512 120 512 212c0 130-112 236-256 268C12 448 0 322 0 256 0 132 114 32 256 32z",
  // Oracle — telescope / eye of providence  
  oracle: "M256 128c-70.7 0-128 57.3-128 128s57.3 128 128 128 128-57.3 128-128-57.3-128-128-128zM256 320c-35.3 0-64-28.7-64-64s28.7-64 64-64 64 28.7 64 64-28.7 64-64 64zM480 234.7L399.5 192C381.6 131.6 324.8 88 256 88S130.4 131.6 112.5 192L32 234.7v42.6L112.5 320C130.4 380.4 187.2 424 256 424s125.6-43.6 143.5-104L480 277.3V234.7z",
  // Titan — anvil
  titan: "M128 96v64H64L32 256h448l-32-96H384V96H128zM64 288v32h384v-32H64zM96 352v64h320v-64H96z",
  // Striker — boxing glove fist
  striker: "M224 32c-35.3 0-64 28.7-64 64v16c-35.3 0-64 28.7-64 64v32c-35.3 0-64 28.7-64 64v96c0 70.7 57.3 128 128 128h128c70.7 0 128-57.3 128-128V208c0-35.3-28.7-64-64-64v-32c0-35.3-28.7-64-64-64H224zM192 96h128c17.7 0 32 14.3 32 32v16H160V128c0-17.7 14.3-32 32-32z",
  // Alchemist — flask / potion
  alchemist: "M192 32v160L96 352c-26.5 35.3-32 64-16 96 16 32 53.3 48 96 48h160c42.7 0 80-16 96-48 16-32 10.5-60.7-16-96L320 192V32H192zM224 64h64v144l16 16H208l16-16V64zM160 368c0-26.5 21.5-48 48-48h96c26.5 0 48 21.5 48 48s-21.5 48-48 48H208c-26.5 0-48-21.5-48-48z",
};

// Renders a class SVG icon — sized to fit its container
function ClassIcon({ classKey, size = 24, color, style = {} }) {
  const cls      = CLASSES[classKey];
  const fillColor = color || (cls ? cls.color : "#b4ac9e");
  const path     = CLASS_SVG_PATHS[classKey];
  if (!path) {
    // Graceful fallback to emoji if class not found
    return React.createElement('span', { style: { fontSize: size * 0.8 } }, cls ? cls.icon : "⚔️");
  }
  return React.createElement('svg', {
    viewBox: "0 0 512 512",
    width: size, height: size,
    style: { display: "inline-block", flexShrink: 0, ...style },
    "aria-hidden": "true",
  },
    React.createElement('path', { d: path, fill: fillColor })
  );
}


// ═══════════════════════════════════════════════════════════════════
//  QUESTS
// ═══════════════════════════════════════════════════════════════════
const QUESTS = [
  // Cardio
  { id:"q_run5k_1",   name:"First Steps",          icon:"👟", cat:"Cardio",       xp:1000,   desc:"Complete your first 5K run.",                              auto:{exId:"run",  count:1} },
  { id:"q_run5k_10",  name:"10K Crucible",          icon:"🏃", cat:"Cardio",       xp:2000,   desc:"Log the equivalent of a 10K — two 5K sessions.",           auto:{exId:"run",  count:2} },
  { id:"q_run5k_26",  name:"Marathon Pilgrim",      icon:"🏅", cat:"Cardio",       xp:6000,   desc:"Complete 26 running sessions — the marathon in spirit.",   auto:{exId:"run",  count:26} },
  { id:"q_cycle_10",  name:"Road Rider",            icon:"🚴", cat:"Cardio",       xp:1000,   desc:"Complete 10 cycling sessions.",                            auto:{exId:"cycling",count:10} },
  { id:"q_swim_10",   name:"Open Water Initiate",   icon:"🏊", cat:"Cardio",       xp:1000,   desc:"Complete 10 swimming sessions.",                           auto:{exId:"swim_lap",   count:10} },
  { id:"q_hiit_5",    name:"Pain Threshold",        icon:"💢", cat:"Cardio",       xp:1000,   desc:"Survive 5 HIIT sessions.",                                 auto:{exId:"jumpRope",   count:5} },
  { id:"q_hiit_20",   name:"Berserker's Path",      icon:"🔥", cat:"Cardio",       xp:4000,   desc:"Complete 20 HIIT sessions without mercy.",                 auto:{exId:"jumpRope",   count:20} },
  // Strength
  { id:"q_dl_10",     name:"Iron Puller",           icon:"⚡", cat:"Strength",     xp:1000,   desc:"Complete 10 deadlift sessions.",                           auto:{exId:"deadlift",count:10} },
  { id:"q_sq_20",     name:"Leg Day Legend",        icon:"💪", cat:"Strength",     xp:2000,   desc:"Complete 20 squat sessions. No excuses.",                  auto:{exId:"squat",  count:20} },
  { id:"q_pu_15",     name:"Gravity Defier",        icon:"🪝", cat:"Strength",     xp:2000,   desc:"Complete 15 pull-up sessions.",                            auto:{exId:"pullups",count:15} },
  { id:"q_bench_15",  name:"Pressing Matters",      icon:"🏋️", cat:"Strength",    xp:2000,   desc:"Complete 15 bench press sessions.",                        auto:{exId:"bench",  count:15} },
  // Flexibility
  { id:"q_yoga_10",   name:"Temple Initiate",       icon:"🧘", cat:"Flexibility",  xp:1000,   desc:"Complete 10 yoga sessions.",                               auto:{exId:"swim_lap",   count:10} },
  { id:"q_yoga_30",   name:"Zen Ascendant",         icon:"🌸", cat:"Flexibility",  xp:4000,   desc:"Complete 30 yoga sessions.",                               auto:{exId:"swim_lap",   count:30} },
  { id:"q_str_20",    name:"Supple Warrior",        icon:"🤸", cat:"Flexibility",  xp:1000,   desc:"Complete 20 deep stretch sessions.",                       auto:{exId:"walk",count:20} },
  // Consistency
  { id:"q_log_50",    name:"Fifty Battles",         icon:"⚔️", cat:"Consistency",  xp:3000,   desc:"Log 50 total workout sessions.",                           auto:{total:50} },
  { id:"q_log_100",   name:"Centurion",             icon:"🛡️", cat:"Consistency", xp:8000,   desc:"Log 100 total workout sessions.",                          auto:{total:100} },
  { id:"q_log_250",   name:"Iron Legend",           icon:"👑", cat:"Consistency",  xp:25000,  desc:"Log 250 total workout sessions.",                          auto:{total:250} },
  { id:"q_streak_7",  name:"Seven Cycles",         icon:"⚡", cat:"Consistency",  xp:1000,   desc:"Maintain a 7-day gym check-in streak.",               streak:7 },
  { id:"q_streak_30", name:"Hard Wired",    icon:"🧬", cat:"Consistency",  xp:7000,   desc:"Maintain a 30-day gym check-in streak.",              streak:30 },
  // Competitions (manual claim)
  { id:"q_race_5k",   name:"Race Day Warrior",      icon:"🏁", cat:"Competition",  xp:3000,   desc:"Participate in an official 5K race.",                      manual:true },
  { id:"q_race_10k",  name:"10K Conqueror",         icon:"🎖️", cat:"Competition", xp:5000,   desc:"Complete an official 10K race.",                           manual:true },
  { id:"q_marathon",  name:"Legend Status",           icon:"🏆", cat:"Competition",  xp:20000,  desc:"Finish a full 26.2-mile marathon. Truly transcendent.",  manual:true },
  { id:"q_crossfit",  name:"CrossFit Gladiator",    icon:"🔥", cat:"Competition",  xp:9000,   desc:"Compete in a CrossFit tournament or Open event.",          manual:true },
  { id:"q_powerlifting",name:"Iron Throne",         icon:"⚔️", cat:"Competition",  xp:9000,   desc:"Compete in an official powerlifting meet.",                manual:true },
  { id:"q_triathlon", name:"The Triathlete",        icon:"🌊", cat:"Competition",  xp:18000,  desc:"Complete a triathlon of any distance.",                    manual:true },
  { id:"q_spartan",   name:"Spartan Born",          icon:"🗡️", cat:"Competition", xp:8000,   desc:"Complete a Spartan Race or obstacle course event.",        manual:true },
];

// ═══════════════════════════════════════════════════════════════════
//  WORKOUT PLANS / TEMPLATES
// ═══════════════════════════════════════════════════════════════════
const WORKOUT_TEMPLATES = [
  {
    id:"murph", name:"The Murph", icon:"🎖️",
    category:"Full Body", difficulty:"Advanced", equipment:"Bodyweight", aurisarClass:"warlord",
    targetMuscles:"Full Body", durationMin:60,
    desc:'"The Murph" is a famous CrossFit Hero workout honoring Navy SEAL Lt. Michael Murphy. 1-mile run, 100 pull-ups, 200 push-ups, 300 squats, and a final 1-mile run.\n\nIntermediate: Cut the reps in half.',
    exercises:[
      {exId:"run",sets:1,reps:10,distanceMi:1,weightLbs:null,durationMin:10,weightPct:100,hrZone:null},
      {exId:"air_squat",sets:10,reps:30,distanceMi:null,weightLbs:null,durationMin:null,weightPct:100,hrZone:null},
      {exId:"pushup",sets:10,reps:20,distanceMi:null,weightLbs:null,durationMin:null,weightPct:100,hrZone:null},
      {exId:"pullups",sets:10,reps:10,distanceMi:null,weightLbs:null,durationMin:null,weightPct:100,hrZone:null},
      {exId:"run",sets:1,reps:10,distanceMi:1,weightLbs:null,durationMin:10,weightPct:100,hrZone:null},
    ],
  },
  // ── 1. Iron Press — Beginner Push Day ──
  {
    id:"iron_press", name:"Iron Press — Beginner Push Day", icon:"⚔️",
    category:"Push", difficulty:"Beginner", equipment:"Gym", aurisarClass:"warrior",
    targetMuscles:"Chest, Shoulders, Triceps", durationMin:45,
    desc:"Foundation push workout building pressing strength with controlled tempo.",
    exercises:[
      {exId:"dumbbell_chest_press",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"machine_chest_press",sets:3,reps:"12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"seated_dumbbell_shoulder_press",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"tricep_pushdown_with_bar",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_lateral_raise",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pushup",sets:2,reps:"AMRAP",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 2. Forge Ahead — Intermediate Push Day ──
  {
    id:"forge_ahead", name:"Forge Ahead — Intermediate Push Day", icon:"🔥",
    category:"Push", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"gladiator",
    targetMuscles:"Chest, Shoulders, Triceps", durationMin:55,
    desc:"Higher volume push session with compound and isolation work.",
    exercises:[
      {exId:"bench",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"incline_dumbbell_press",sets:3,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"ohp",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"standing_cable_chest_fly",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_lateral_raise",sets:4,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"overhead_cable_triceps_extension_upper",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dips",sets:3,reps:"8-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 3. Warlord's Onslaught — Advanced Push Day ──
  {
    id:"warlords_onslaught", name:"Warlord's Onslaught — Advanced Push Day", icon:"⚔️",
    category:"Push", difficulty:"Advanced", equipment:"Gym", aurisarClass:"warlord",
    targetMuscles:"Chest, Shoulders, Triceps", durationMin:70,
    desc:"Heavy compounds with intensity techniques for experienced lifters.",
    exercises:[
      {exId:"bench",sets:5,reps:"5-6",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"incline_barbell_press",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"ohp",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_chest_fly",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"arnold_press",sets:3,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"cable_lateral_raise",sets:4,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"skull_crushers",sets:3,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dips",sets:3,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 4. Steel Back — Beginner Pull Day ──
  {
    id:"steel_back", name:"Steel Back — Beginner Pull Day", icon:"🛡️",
    category:"Pull", difficulty:"Beginner", equipment:"Gym", aurisarClass:"warrior",
    targetMuscles:"Back, Biceps, Rear Delts", durationMin:45,
    desc:"Develop pulling strength with machine and cable assistance.",
    exercises:[
      {exId:"lat_pulldown_pronated_grip",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"cable_close_grip_seated_row",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_row",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"face_pull",sets:3,reps:"15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_curl",sets:3,reps:"12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"hammer_curl",sets:2,reps:"12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 5. Titan's Pull — Intermediate Pull Day ──
  {
    id:"titans_pull", name:"Titan's Pull — Intermediate Pull Day", icon:"🛡️",
    category:"Pull", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"gladiator",
    targetMuscles:"Back, Biceps, Rear Delts", durationMin:55,
    desc:"Compound-heavy pull day with progressive overload focus.",
    exercises:[
      {exId:"row",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pullups",sets:4,reps:"6-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"cable_close_grip_seated_row",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_pullover",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"face_pull",sets:3,reps:"15-20",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"barbell_curl",sets:3,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"incline_dumbbell_curl",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 6. Phantom Strike — Advanced Pull Day ──
  {
    id:"phantom_strike", name:"Phantom Strike — Advanced Pull Day", icon:"👁️",
    category:"Pull", difficulty:"Advanced", equipment:"Gym", aurisarClass:"phantom",
    targetMuscles:"Back, Biceps, Rear Delts, Traps", durationMin:70,
    desc:"High-intensity pulling with heavy rows and advanced techniques.",
    exercises:[
      {exId:"deadlift",sets:4,reps:"5",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pullups",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"row",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"cable_pullover",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"reverse_fly",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"barbell_shrug",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"barbell_preacher_curl",sets:3,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"reverse_curl",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 7. Foundation Legs — Beginner Leg Day ──
  {
    id:"foundation_legs", name:"Foundation Legs — Beginner Leg Day", icon:"🦵",
    category:"Legs", difficulty:"Beginner", equipment:"Gym", aurisarClass:"warden",
    targetMuscles:"Quads, Hamstrings, Glutes, Calves", durationMin:45,
    desc:"Build lower body strength with machine-assisted compound movements.",
    exercises:[
      {exId:"leg_press",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"goblet_squat",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"leg_extension",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"lying_leg_curl",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_lunge",sets:3,reps:"10 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"standing_calf_raise",sets:3,reps:"15-20",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 8. Colosseum Legs — Intermediate Leg Day ──
  {
    id:"colosseum_legs", name:"Colosseum Legs — Intermediate Leg Day", icon:"🦵",
    category:"Legs", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"gladiator",
    targetMuscles:"Quads, Hamstrings, Glutes, Calves", durationMin:60,
    desc:"Barbell-focused leg training with quad and hamstring balance.",
    exercises:[
      {exId:"squat",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"stiff_legged_deadlift",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"leg_press",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"bulgarian_split_squat",sets:3,reps:"10 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"seated_leg_curl",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"standing_calf_raise",sets:4,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"leg_extension",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 9. Titan's Stance — Advanced Leg Day ──
  {
    id:"titans_stance", name:"Titan's Stance — Advanced Leg Day", icon:"🦵",
    category:"Legs", difficulty:"Advanced", equipment:"Gym", aurisarClass:"warlord",
    targetMuscles:"Quads, Hamstrings, Glutes, Calves", durationMin:75,
    desc:"Powerlifting-inspired leg session with high intensity and volume.",
    exercises:[
      {exId:"squat",sets:5,reps:"5",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"front_squat",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"stiff_legged_deadlift",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"hack_squat_machine",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_lunge",sets:3,reps:"10 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"nordic_hamstring_curl",sets:3,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"seated_calf_raise",sets:4,reps:"15-20",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"leg_extension",sets:3,reps:"15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 10. Homefront Upper — Push/Pull Hybrid ──
  {
    id:"homefront_upper", name:"Homefront Upper — Push/Pull Hybrid", icon:"🏠",
    category:"Upper Body", difficulty:"Intermediate", equipment:"Home Gym", aurisarClass:"warden",
    targetMuscles:"Chest, Back, Shoulders, Arms", durationMin:50,
    desc:"Dumbbell-only upper body session for home gym warriors.",
    exercises:[
      {exId:"dumbbell_floor_press",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_row",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_shoulder_press",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_chest_fly",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_rear_delt_row",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_curl",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_tricep_kickback",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 11. Homefront Lower — Dumbbell Leg Day ──
  {
    id:"homefront_lower", name:"Homefront Lower — Dumbbell Leg Day", icon:"🏠",
    category:"Lower Body", difficulty:"Intermediate", equipment:"Home Gym", aurisarClass:"warden",
    targetMuscles:"Quads, Hamstrings, Glutes, Calves", durationMin:45,
    desc:"Effective lower body training with dumbbells at home.",
    exercises:[
      {exId:"goblet_squat",sets:4,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_romanian_deadlift",sets:4,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_lunge",sets:3,reps:"10 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"step_up",sets:3,reps:"10 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_squat",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"standing_calf_raise",sets:3,reps:"15 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"glute_bridge",sets:3,reps:"15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 12. Shadow Press — Bodyweight Push ──
  {
    id:"shadow_press", name:"Shadow Press — Bodyweight Push", icon:"🤸",
    category:"Push", difficulty:"Beginner", equipment:"Bodyweight", aurisarClass:"phantom",
    targetMuscles:"Chest, Shoulders, Triceps", durationMin:35,
    desc:"No equipment needed. Master your bodyweight with pressing patterns.",
    exercises:[
      {exId:"pushup",sets:4,reps:"AMRAP",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"diamond_push_up",sets:3,reps:"8-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pike_push_up",sets:3,reps:"8-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"wide_push_up",sets:3,reps:"10-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"bench_dip",sets:3,reps:"10-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"plank_to_push_up",sets:3,reps:"8 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 13. Anvil Chest — Chest Blast ──
  {
    id:"anvil_chest", name:"Anvil Chest — Chest Blast", icon:"💪",
    category:"Chest", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"warrior",
    targetMuscles:"Chest (Upper, Mid, Lower)", durationMin:50,
    desc:"Hit all three heads of the chest with angles and volume.",
    exercises:[
      {exId:"bench",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"incline_dumbbell_press",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"standing_cable_chest_fly",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_chest_fly",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"decline_push_up",sets:3,reps:"AMRAP",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"machine_chest_press",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 14. Dragon's Back — Back Attack ──
  {
    id:"dragons_back", name:"Dragon's Back — Back Attack", icon:"🐉",
    category:"Back", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"gladiator",
    targetMuscles:"Lats, Rhomboids, Traps, Erectors", durationMin:55,
    desc:"Width and thickness work for a complete back session.",
    exercises:[
      {exId:"pullups",sets:4,reps:"6-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"row",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"lat_pulldown_pronated_grip",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"cable_close_grip_seated_row",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_row",sets:3,reps:"10 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"straight_arm_lat_pulldown",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"hyperextension",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 15. Crown of Blades — Shoulder Sculpt ──
  {
    id:"crown_of_blades", name:"Crown of Blades — Shoulder Sculpt", icon:"👑",
    category:"Shoulders", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"gladiator",
    targetMuscles:"Front, Side, Rear Deltoids", durationMin:50,
    desc:"All three delt heads trained with compounds and isolations.",
    exercises:[
      {exId:"ohp",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_lateral_raise",sets:4,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"face_pull",sets:3,reps:"15-20",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"arnold_press",sets:3,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"cable_lateral_raise",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"reverse_fly",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_front_raise",sets:2,reps:"12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 16. Gauntlet Arms — Biceps & Triceps ──
  {
    id:"gauntlet_arms", name:"Gauntlet Arms — Biceps & Triceps", icon:"🤜",
    category:"Arms", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"gladiator",
    targetMuscles:"Biceps, Triceps, Forearms", durationMin:45,
    desc:"Dedicated arm day with balanced bi/tri volume.",
    exercises:[
      {exId:"barbell_curl",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"skull_crushers",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"hammer_curl",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"tricep_pushdown_with_bar",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"incline_dumbbell_curl",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"overhead_cable_triceps_extension_upper",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"reverse_curl",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 17. Siege Engine — Quad Crusher ──
  {
    id:"siege_engine", name:"Siege Engine — Quad Crusher", icon:"🏰",
    category:"Legs", difficulty:"Advanced", equipment:"Gym", aurisarClass:"warlord",
    targetMuscles:"Quads, VMO", durationMin:55,
    desc:"Quad-dominant leg day to build massive frontal thigh development.",
    exercises:[
      {exId:"front_squat",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"hack_squat_machine",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"leg_extension",sets:4,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_lunge",sets:3,reps:"12 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"sissy_squat",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"wall_sit",sets:3,reps:"45-60s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 18. Warden's Pillars — Hamstring & Glute Focus ──
  {
    id:"wardens_pillars", name:"Warden's Pillars — Hamstring & Glute Focus", icon:"🏛️",
    category:"Glutes", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"warden",
    targetMuscles:"Hamstrings, Glutes", durationMin:50,
    desc:"Posterior chain emphasis for strength and aesthetics.",
    exercises:[
      {exId:"stiff_legged_deadlift",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"hip_thrust",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"seated_leg_curl",sets:4,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"cable_pull_through",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"glute_bridge",sets:3,reps:"12 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"good_morning",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"reverse_hyperextension",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 19. Oracle's Core — Ab Destroyer ──
  {
    id:"oracles_core", name:"Oracle's Core — Ab Destroyer", icon:"🔮",
    category:"Core", difficulty:"Intermediate", equipment:"Bodyweight", aurisarClass:"oracle",
    targetMuscles:"Abs, Obliques, Transverse Abdominis", durationMin:30,
    desc:"Targeted core session with no equipment needed.",
    exercises:[
      {exId:"plank",sets:3,reps:"45-60s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"bicycle_crunch",sets:3,reps:"20 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"lying_leg_raise",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"russian_twist",sets:3,reps:"15 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"mountain_climbers",sets:3,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dead_bug",sets:3,reps:"10 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"side_plank",sets:3,reps:"30s each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 20. Hearthfire Chest — Home Chest & Triceps ──
  {
    id:"hearthfire_chest", name:"Hearthfire Chest — Home Chest & Triceps", icon:"🏠",
    category:"Chest", difficulty:"Beginner", equipment:"Home Gym", aurisarClass:"warrior",
    targetMuscles:"Chest, Triceps", durationMin:40,
    desc:"Effective chest training with just dumbbells and bodyweight.",
    exercises:[
      {exId:"dumbbell_floor_press",sets:4,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pushup",sets:4,reps:"AMRAP",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_chest_fly",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"diamond_push_up",sets:3,reps:"AMRAP",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_pullover",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"bench_dip",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 21. Hearthfire Back — Home Back & Biceps ──
  {
    id:"hearthfire_back", name:"Hearthfire Back — Home Back & Biceps", icon:"🏠",
    category:"Back", difficulty:"Beginner", equipment:"Home Gym", aurisarClass:"warden",
    targetMuscles:"Back, Biceps", durationMin:40,
    desc:"Home dumbbell back session. Pull-up bar optional.",
    exercises:[
      {exId:"dumbbell_row",sets:4,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_row",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_rear_delt_row",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_curl",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"hammer_curl",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"superman_raise",sets:3,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pullups",sets:3,reps:"AMRAP",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 22. Ember Shoulders — Home Shoulder Builder ──
  {
    id:"ember_shoulders", name:"Ember Shoulders — Home Shoulder Builder", icon:"🏠",
    category:"Shoulders", difficulty:"Intermediate", equipment:"Home Gym", aurisarClass:"gladiator",
    targetMuscles:"All Deltoid Heads", durationMin:40,
    desc:"Dumbbell shoulder session hitting all three heads at home.",
    exercises:[
      {exId:"dumbbell_shoulder_press",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_lateral_raise",sets:4,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_front_raise",sets:3,reps:"12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_rear_delt_row",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"arnold_press",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_upright_row",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 23. Ember Arms — Home Arm Pump ──
  {
    id:"ember_arms", name:"Ember Arms — Home Arm Pump", icon:"🏠",
    category:"Arms", difficulty:"Beginner", equipment:"Home Gym", aurisarClass:"warrior",
    targetMuscles:"Biceps, Triceps", durationMin:35,
    desc:"Dumbbell-only arm day you can do in your living room.",
    exercises:[
      {exId:"dumbbell_curl",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_tricep_kickback",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"hammer_curl",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_standing_triceps_extension",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"concentration_curl",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_close_grip_press",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 24. Throne Builder — Glute Specialization ──
  {
    id:"throne_builder", name:"Throne Builder — Glute Specialization", icon:"🍑",
    category:"Glutes", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"warden",
    targetMuscles:"Glutes (Maximus, Medius, Minimus)", durationMin:50,
    desc:"Glute-dominant session for building strength and shape.",
    exercises:[
      {exId:"hip_thrust",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"sumo_deadlift",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"bulgarian_split_squat",sets:3,reps:"10 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"cable_glute_kickback",sets:3,reps:"12-15 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"lateral_walk_with_band",sets:3,reps:"15 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"frog_pump",sets:3,reps:"20",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 25. Bastion Core — Calf & Core Combo ──
  {
    id:"bastion_core", name:"Bastion Core — Calf & Core Combo", icon:"🧱",
    category:"Core", difficulty:"Beginner", equipment:"Gym", aurisarClass:"oracle",
    targetMuscles:"Calves, Abs, Obliques", durationMin:35,
    desc:"Often-neglected calves paired with a solid core circuit.",
    exercises:[
      {exId:"standing_calf_raise",sets:4,reps:"15-20",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"seated_calf_raise",sets:3,reps:"15-20",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"hanging_leg_raise",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"cable_crunch",sets:3,reps:"15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"plank",sets:3,reps:"45s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"kneeling_ab_wheel_roll_out",sets:3,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 26. Sentinel Posture — Rear Delt & Upper Back ──
  {
    id:"sentinel_posture", name:"Sentinel Posture — Rear Delt & Upper Back", icon:"🛡️",
    category:"Back", difficulty:"Beginner", equipment:"Gym", aurisarClass:"warden",
    targetMuscles:"Rear Delts, Rhomboids, Mid Traps", durationMin:35,
    desc:"Posture-correcting workout targeting the upper back.",
    exercises:[
      {exId:"face_pull",sets:4,reps:"15-20",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"reverse_fly",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"cable_close_grip_seated_row",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"band_pull_apart",sets:3,reps:"20",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_rear_delt_row",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"prone_y_raise",sets:3,reps:"12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 27. Long Road — Steady State Cardio ──
  {
    id:"long_road", name:"Long Road — Steady State Cardio", icon:"🛤️",
    category:"Cardio", difficulty:"Beginner", equipment:"Gym", aurisarClass:"druid",
    targetMuscles:"Cardiovascular System, Legs", durationMin:40,
    desc:"Zone 2 steady-state cardio for endurance and recovery.",
    exercises:[
      {exId:"treadmill_walk",sets:1,reps:20,distanceMi:null,weightLbs:null,durationMin:20,weightPct:100,hrZone:2},
      {exId:"elliptical",sets:1,reps:10,distanceMi:null,weightLbs:null,durationMin:10,weightPct:100,hrZone:2},
      {exId:"stationary_bike",sets:1,reps:10,distanceMi:null,weightLbs:null,durationMin:10,weightPct:100,hrZone:2},
    ],
  },
  // ── 28. Tempest Sprint — HIIT Sprints ──
  {
    id:"tempest_sprint", name:"Tempest Sprint — HIIT Sprints", icon:"⚡",
    category:"HIIT", difficulty:"Advanced", equipment:"Gym", aurisarClass:"tempest",
    targetMuscles:"Full Body, Cardiovascular", durationMin:25,
    desc:"High intensity sprint intervals for maximum calorie burn.",
    exercises:[
      {exId:"treadmill_run",sets:8,reps:"30s sprint",distanceMi:null,weightLbs:null,durationMin:null,weightPct:100,hrZone:5},
      {exId:"battle_ropes",sets:4,reps:"30s",distanceMi:null,weightLbs:null,durationMin:null,weightPct:100,hrZone:null},
      {exId:"box_jump",sets:4,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 29. Inferno Protocol — Tabata Bodyweight ──
  {
    id:"inferno_protocol", name:"Inferno Protocol — Tabata Bodyweight", icon:"🔥",
    category:"HIIT", difficulty:"Intermediate", equipment:"Bodyweight", aurisarClass:"tempest",
    targetMuscles:"Full Body", durationMin:25,
    desc:"Classic Tabata: 20s work, 10s rest, 8 rounds per exercise.",
    exercises:[
      {exId:"burpees",sets:8,reps:"20s on",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"mountain_climbers",sets:8,reps:"20s on",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"jump_squat",sets:8,reps:"20s on",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"high_knees",sets:8,reps:"20s on",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pushup",sets:8,reps:"20s on",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 30. War Drum EMOM ──
  {
    id:"war_drum_emom", name:"War Drum EMOM — Every Minute on the Minute", icon:"🥁",
    category:"HIIT", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"tempest",
    targetMuscles:"Full Body", durationMin:30,
    desc:"Perform reps at the top of every minute. Rest remaining time.",
    exercises:[
      {exId:"kettlebell_swing",sets:5,reps:"15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pushup",sets:5,reps:"12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"goblet_squat",sets:5,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"burpees",sets:5,reps:"8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"plank",sets:5,reps:"40s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 31. Crucible AMRAP ──
  {
    id:"crucible_amrap", name:"Crucible AMRAP — As Many Rounds As Possible", icon:"🔥",
    category:"HIIT", difficulty:"Advanced", equipment:"Bodyweight", aurisarClass:"tempest",
    targetMuscles:"Full Body", durationMin:20,
    desc:"20 minutes, as many rounds as possible. Track your score.",
    exercises:[
      {exId:"burpees",sets:1,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pushup",sets:1,reps:"15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"air_squat",sets:1,reps:"20",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"sit_up",sets:1,reps:"15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"jumping_lunge",sets:1,reps:"10 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 32. Rope Storm — Jump Rope HIIT ──
  {
    id:"rope_storm", name:"Rope Storm — Jump Rope HIIT", icon:"⚡",
    category:"HIIT", difficulty:"Intermediate", equipment:"Home Gym", aurisarClass:"phantom",
    targetMuscles:"Calves, Shoulders, Cardiovascular", durationMin:25,
    desc:"Jump rope intervals mixed with bodyweight exercises.",
    exercises:[
      {exId:"jumpRope",sets:1,reps:2,distanceMi:null,weightLbs:null,durationMin:2,weightPct:100,hrZone:null},
      {exId:"high_knees",sets:5,reps:"45s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pushup",sets:5,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"jump_rope_double_unders",sets:5,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"plank",sets:3,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 33. Iron Oar — Rowing Machine Intervals ──
  {
    id:"iron_oar", name:"Iron Oar — Rowing Machine Intervals", icon:"🚣",
    category:"Cardio", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"warden",
    targetMuscles:"Back, Legs, Arms, Cardiovascular", durationMin:30,
    desc:"Rowing intervals for full-body conditioning.",
    exercises:[
      {exId:"rowing_machine",sets:1,reps:5,distanceMi:null,weightLbs:null,durationMin:5,weightPct:100,hrZone:2},
      {exId:"rowing_machine",sets:6,reps:"500m",distanceMi:null,weightLbs:null,durationMin:null,weightPct:100,hrZone:4},
      {exId:"rowing_machine",sets:1,reps:5,distanceMi:null,weightLbs:null,durationMin:5,weightPct:100,hrZone:1},
    ],
  },
  // ── 34. Alchemist's Forge — Metabolic Conditioning ──
  {
    id:"alchemists_forge", name:"Alchemist's Forge — Metabolic Conditioning", icon:"⚗️",
    category:"HIIT", difficulty:"Advanced", equipment:"Gym", aurisarClass:"tempest",
    targetMuscles:"Full Body", durationMin:40,
    desc:"Strength-cardio hybrid that keeps your heart rate elevated throughout.",
    exercises:[
      {exId:"kettlebell_swing",sets:4,reps:"15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"kettlebell_thrusters",sets:4,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"renegade_row",sets:4,reps:"8 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"box_jump",sets:4,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"farmers_walk",sets:4,reps:"30 yards",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"burpees",sets:4,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 35. Phantom Dance — Cardio Kickboxing ──
  {
    id:"phantom_dance", name:"Phantom Dance — Cardio Kickboxing", icon:"🥊",
    category:"Cardio", difficulty:"Beginner", equipment:"Bodyweight", aurisarClass:"phantom",
    targetMuscles:"Full Body, Core", durationMin:35,
    desc:"Punching and kicking combos for fun, stress-relieving cardio.",
    exercises:[
      {exId:"jab_cross",sets:3,reps:"60s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"front_kick",sets:3,reps:"60s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"hook",sets:3,reps:"60s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"roundhouse_kick",sets:3,reps:"60s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"jab_cross",sets:3,reps:"60s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"high_knees",sets:3,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 36. Summit Climb — Stairmaster Endurance ──
  {
    id:"summit_climb", name:"Summit Climb — Stairmaster Endurance", icon:"🏔️",
    category:"Cardio", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"warden",
    targetMuscles:"Glutes, Quads, Cardiovascular", durationMin:35,
    desc:"Stairmaster intervals for lower body endurance and cardio.",
    exercises:[
      {exId:"stairmaster",sets:1,reps:5,distanceMi:null,weightLbs:null,durationMin:5,weightPct:100,hrZone:2},
      {exId:"stairmaster",sets:5,reps:2,distanceMi:null,weightLbs:null,durationMin:2,weightPct:100,hrZone:4},
      {exId:"stairmaster",sets:3,reps:2,distanceMi:null,weightLbs:null,durationMin:2,weightPct:100,hrZone:3},
      {exId:"stairmaster",sets:1,reps:5,distanceMi:null,weightLbs:null,durationMin:5,weightPct:100,hrZone:1},
    ],
  },
  // ── 37. Clash of Steel — Chest & Back Superset ──
  {
    id:"clash_of_steel", name:"Clash of Steel — Chest & Back Superset", icon:"⚔️",
    category:"Superset", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"gladiator",
    targetMuscles:"Chest, Back", durationMin:50,
    desc:"Antagonist supersets pairing chest and back movements. No rest between paired exercises.",
    exercises:[
      {exId:"bench",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:1},
      {exId:"row",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:0},
      {exId:"incline_dumbbell_press",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:3},
      {exId:"lat_pulldown_pronated_grip",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:2},
      {exId:"standing_cable_chest_fly",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:5},
      {exId:"cable_close_grip_seated_row",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:4},
    ],
  },
  // ── 38. Forge & Anvil — Biceps & Triceps Superset ──
  {
    id:"forge_and_anvil", name:"Forge & Anvil — Biceps & Triceps Superset", icon:"🔨",
    category:"Superset", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"gladiator",
    targetMuscles:"Biceps, Triceps", durationMin:40,
    desc:"Antagonist arm supersets for maximum pump.",
    exercises:[
      {exId:"barbell_curl",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:1},
      {exId:"skull_crushers",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:0},
      {exId:"hammer_curl",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:3},
      {exId:"tricep_pushdown_with_bar",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:2},
      {exId:"concentration_curl",sets:3,reps:"12 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:5},
      {exId:"overhead_cable_triceps_extension_upper",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:4},
    ],
  },
  // ── 39. First Light — Full Body Circuit (Beginner) ──
  {
    id:"first_light", name:"First Light — Full Body Circuit (Beginner)", icon:"🌅",
    category:"Circuit", difficulty:"Beginner", equipment:"Bodyweight", aurisarClass:"warden",
    targetMuscles:"Full Body", durationMin:30,
    desc:"3 rounds through all exercises. Rest 15s between exercises, 90s between rounds.",
    exercises:[
      {exId:"air_squat",sets:3,reps:"15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pushup",sets:3,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_row",sets:3,reps:"12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"reverse_lunge",sets:3,reps:"10 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"plank",sets:3,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"jumping_jacks",sets:3,reps:"30",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 40. Gladiator Circuit — Full Body Advanced ──
  {
    id:"gladiator_circuit", name:"Gladiator Circuit — Full Body Advanced", icon:"⚔️",
    category:"Circuit", difficulty:"Advanced", equipment:"Gym", aurisarClass:"gladiator",
    targetMuscles:"Full Body", durationMin:45,
    desc:"5 rounds. Minimal rest. For battle-tested athletes only.",
    exercises:[
      {exId:"kettlebell_clean_and_press",sets:5,reps:"5",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pullups",sets:5,reps:"8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"kettlebell_thrusters",sets:5,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"kettlebell_swing",sets:5,reps:"15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"burpees",sets:5,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"plank",sets:5,reps:"45s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 41. Thunder & Lightning — Upper Body Superset ──
  {
    id:"thunder_lightning", name:"Thunder & Lightning — Upper Body Superset", icon:"⛈️",
    category:"Superset", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"warrior",
    targetMuscles:"Chest, Back, Shoulders, Arms", durationMin:50,
    desc:"Full upper body trained with superset pairings.",
    exercises:[
      {exId:"dumbbell_chest_press",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:1},
      {exId:"dumbbell_row",sets:4,reps:"8-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:0},
      {exId:"dumbbell_shoulder_press",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:3},
      {exId:"lat_pulldown_pronated_grip",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:2},
      {exId:"dumbbell_curl",sets:3,reps:"12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:5},
      {exId:"tricep_pushdown_with_bar",sets:3,reps:"12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:4},
      {exId:"dumbbell_lateral_raise",sets:3,reps:"15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:7},
      {exId:"face_pull",sets:3,reps:"15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:6},
    ],
  },
  // ── 42. Quake — Leg Superset Destroyer ──
  {
    id:"quake", name:"Quake — Leg Superset Destroyer", icon:"💥",
    category:"Superset", difficulty:"Advanced", equipment:"Gym", aurisarClass:"warlord",
    targetMuscles:"Quads, Hamstrings, Glutes, Calves", durationMin:55,
    desc:"Quad-ham and compound-isolation leg supersets.",
    exercises:[
      {exId:"squat",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:1},
      {exId:"lying_leg_curl",sets:4,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:0},
      {exId:"leg_press",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:3},
      {exId:"dumbbell_romanian_deadlift",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:2},
      {exId:"leg_extension",sets:3,reps:"12-15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:5},
      {exId:"standing_calf_raise",sets:3,reps:"15-20",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:4},
    ],
  },
  // ── 43. Tidal Force — Push-Pull Superset ──
  {
    id:"tidal_force", name:"Tidal Force — Push-Pull Superset", icon:"🌊",
    category:"Superset", difficulty:"Intermediate", equipment:"Gym", aurisarClass:"warrior",
    targetMuscles:"Chest, Back, Shoulders", durationMin:50,
    desc:"Push and pull movements paired for efficient full upper body work.",
    exercises:[
      {exId:"bench",sets:4,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:1},
      {exId:"pullups",sets:4,reps:"6-10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:0},
      {exId:"dumbbell_shoulder_press",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:3},
      {exId:"cable_close_grip_seated_row",sets:3,reps:"10-12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:2},
      {exId:"dips",sets:3,reps:"AMRAP",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:5},
      {exId:"face_pull",sets:3,reps:"15-20",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:4},
    ],
  },
  // ── 44. Iron Homestead — Dumbbell Only Circuit ──
  {
    id:"iron_homestead", name:"Iron Homestead — Dumbbell Only Circuit", icon:"🏠",
    category:"Circuit", difficulty:"Intermediate", equipment:"Home Gym", aurisarClass:"warden",
    targetMuscles:"Full Body", durationMin:35,
    desc:"4 rounds with one pair of dumbbells. No excuses needed.",
    exercises:[
      {exId:"kettlebell_thrusters",sets:4,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_row",sets:4,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_lunge",sets:4,reps:"8 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_floor_press",sets:4,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_curl_to_press",sets:4,reps:"8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"renegade_row",sets:4,reps:"6 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 45. Phantom Blaze — Bodyweight Burn ──
  {
    id:"phantom_blaze", name:"Phantom Blaze — Bodyweight Burn", icon:"🔥",
    category:"Circuit", difficulty:"Intermediate", equipment:"Bodyweight", aurisarClass:"phantom",
    targetMuscles:"Full Body", durationMin:30,
    desc:"Zero equipment, maximum effort. 4 rounds.",
    exercises:[
      {exId:"burpees",sets:4,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pushup",sets:4,reps:"12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"jump_squat",sets:4,reps:"15",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"plank_to_push_up",sets:4,reps:"8 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"jumping_lunge",sets:4,reps:"10 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"mountain_climbers",sets:4,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 46. Compound Dominion — Superset Power ──
  {
    id:"compound_dominion", name:"Compound Dominion — Superset Power", icon:"👑",
    category:"Superset", difficulty:"Advanced", equipment:"Gym", aurisarClass:"warlord",
    targetMuscles:"Full Body", durationMin:60,
    desc:"Only compound lifts, all supersetted. For serious lifters.",
    exercises:[
      {exId:"squat",sets:4,reps:"6",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:1},
      {exId:"row",sets:4,reps:"6",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:0},
      {exId:"bench",sets:4,reps:"6",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:3},
      {exId:"deadlift",sets:4,reps:"5",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:2},
      {exId:"ohp",sets:3,reps:"8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:5},
      {exId:"pullups",sets:3,reps:"6-8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null,supersetWith:4},
    ],
  },
  // ── 47. Welcome to Aurisar — Beginner Full Body ──
  {
    id:"welcome_aurisar", name:"Welcome to Aurisar — Beginner Full Body", icon:"🌟",
    category:"Full Body", difficulty:"Beginner", equipment:"Gym", aurisarClass:"warden",
    targetMuscles:"Full Body", durationMin:45,
    desc:"Your first workout in Aurisar. Learn the basics, build the foundation.",
    exercises:[
      {exId:"goblet_squat",sets:3,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_chest_press",sets:3,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"lat_pulldown_pronated_grip",sets:3,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"seated_dumbbell_shoulder_press",sets:3,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"leg_press",sets:3,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"plank",sets:3,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"dumbbell_curl",sets:2,reps:"12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"tricep_pushdown_with_bar",sets:2,reps:"12",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 48. Druid's Rest — Active Recovery & Mobility ──
  {
    id:"druids_rest", name:"Druid's Rest — Active Recovery & Mobility", icon:"🌿",
    category:"Recovery", difficulty:"Beginner", equipment:"Bodyweight", aurisarClass:"druid",
    targetMuscles:"Full Body (Flexibility & Mobility)", durationMin:30,
    desc:"Light movement day for recovery. Focus on breathing and range of motion.",
    exercises:[
      {exId:"cat_cow_stretch",sets:3,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"worlds_greatest_stretch",sets:3,reps:"5 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"hip_90_90_stretch",sets:3,reps:"30s each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"thoracic_spine_rotation",sets:3,reps:"10 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pigeon_stretch",sets:3,reps:"30s each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"childs_pose",sets:3,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"foam_rolling",sets:1,reps:10,distanceMi:null,weightLbs:null,durationMin:10,weightPct:100,hrZone:null},
    ],
  },
  // ── 49. Striker's Arena — Athletic Performance ──
  {
    id:"strikers_arena", name:"Striker's Arena — Athletic Performance", icon:"🎯",
    category:"Functional", difficulty:"Advanced", equipment:"Gym", aurisarClass:"phantom",
    targetMuscles:"Full Body (Power, Agility, Coordination)", durationMin:50,
    desc:"Functional training for athleticism, explosiveness, and coordination.",
    exercises:[
      {exId:"box_jump",sets:4,reps:"8",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"ball_slams",sets:4,reps:"10",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"kettlebell_clean_and_press",sets:4,reps:"5",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"lateral_bound",sets:3,reps:"8 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"single_leg_romanian_deadlift",sets:3,reps:"8 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"farmers_walk",sets:3,reps:"40 yards",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"plank_with_shoulder_taps",sets:3,reps:"10 each",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
  // ── 50. Lightning Round — 20-Min Express Total Body ──
  {
    id:"lightning_round", name:"Lightning Round — 20-Min Express Total Body", icon:"⚡",
    category:"Express", difficulty:"Intermediate", equipment:"Bodyweight", aurisarClass:"tempest",
    targetMuscles:"Full Body", durationMin:20,
    desc:"When you only have 20 minutes. No excuses. 4 rounds, 30s each, 10s transition.",
    exercises:[
      {exId:"burpees",sets:4,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"pushup",sets:4,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"air_squat",sets:4,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"mountain_climbers",sets:4,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"plank",sets:4,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
      {exId:"jump_squat",sets:4,reps:"30s",weightLbs:null,durationMin:null,distanceMi:null,weightPct:100,hrZone:null},
    ],
  },
];

const PLAN_TEMPLATES = [

  {
    id:"dumbbell_8wk",
    name:"8 Week Dumbbell Full Body Plan",
    icon:"🏋️",
    level:"Beginner",
    description:"Every week should see a 5-10% increase in weight where possible. Get your steps in on each rest day.",
    bestFor:["warrior","paladin","ranger","monk","berserker"],
    type:"week",
    durCount:8,
    days:[
    {label:"W1 Sunday (Rest)",exercises:[]},
    {label:"W1 Monday",exercises:[{exId:"dumbbell_squat",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_chest_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_row",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_standing_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"sit_up",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W1 Tuesday (Rest)",exercises:[]},
    {label:"W1 Wednesday",exercises:[{exId:"step_up",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"stiff_legged_deadlift",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"seated_dumbbell_shoulder_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"standing_calf_raise",sets:3,reps:"10-20",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_shrug",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_side_bend",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W1 Thursday (Rest)",exercises:[]},
    {label:"W1 Friday",exercises:[{exId:"dumbbell_lunge",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_floor_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"pullups",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"hammer_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_lying_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"lying_leg_raise",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W1 Saturday (Rest)",exercises:[]},
    {label:"W2 Sunday (Rest)",exercises:[]},
    {label:"W2 Monday",exercises:[{exId:"dumbbell_squat",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_chest_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_row",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_standing_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"sit_up",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W2 Tuesday (Rest)",exercises:[]},
    {label:"W2 Wednesday",exercises:[{exId:"step_up",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"stiff_legged_deadlift",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"seated_dumbbell_shoulder_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"standing_calf_raise",sets:3,reps:"10-20",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_shrug",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_side_bend",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W2 Thursday (Rest)",exercises:[]},
    {label:"W2 Friday",exercises:[{exId:"dumbbell_lunge",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_floor_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"pullups",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"hammer_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_lying_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"lying_leg_raise",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W2 Saturday (Rest)",exercises:[]},
    {label:"W3 Sunday (Rest)",exercises:[]},
    {label:"W3 Monday",exercises:[{exId:"dumbbell_squat",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_chest_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_row",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_standing_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"sit_up",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W3 Tuesday (Rest)",exercises:[]},
    {label:"W3 Wednesday",exercises:[{exId:"step_up",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"stiff_legged_deadlift",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"seated_dumbbell_shoulder_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"standing_calf_raise",sets:3,reps:"10-20",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_shrug",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_side_bend",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W3 Thursday (Rest)",exercises:[]},
    {label:"W3 Friday",exercises:[{exId:"dumbbell_lunge",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_floor_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"pullups",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"hammer_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_lying_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"lying_leg_raise",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W3 Saturday (Rest)",exercises:[]},
    {label:"W4 Sunday (Rest)",exercises:[]},
    {label:"W4 Monday",exercises:[{exId:"dumbbell_squat",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_chest_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_row",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_standing_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"sit_up",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W4 Tuesday (Rest)",exercises:[]},
    {label:"W4 Wednesday",exercises:[{exId:"step_up",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"stiff_legged_deadlift",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"seated_dumbbell_shoulder_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"standing_calf_raise",sets:3,reps:"10-20",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_shrug",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_side_bend",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W4 Thursday (Rest)",exercises:[]},
    {label:"W4 Friday",exercises:[{exId:"dumbbell_lunge",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_floor_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"pullups",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"hammer_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_lying_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"lying_leg_raise",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W4 Saturday (Rest)",exercises:[]},
    {label:"W5 Sunday (Rest)",exercises:[]},
    {label:"W5 Monday",exercises:[{exId:"dumbbell_squat",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_chest_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_row",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_standing_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"sit_up",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W5 Tuesday (Rest)",exercises:[]},
    {label:"W5 Wednesday",exercises:[{exId:"step_up",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"stiff_legged_deadlift",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"seated_dumbbell_shoulder_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"standing_calf_raise",sets:3,reps:"10-20",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_shrug",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_side_bend",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W5 Thursday (Rest)",exercises:[]},
    {label:"W5 Friday",exercises:[{exId:"dumbbell_lunge",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_floor_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"pullups",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"hammer_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_lying_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"lying_leg_raise",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W5 Saturday (Rest)",exercises:[]},
    {label:"W6 Sunday (Rest)",exercises:[]},
    {label:"W6 Monday",exercises:[{exId:"dumbbell_squat",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_chest_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_row",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_standing_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"sit_up",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W6 Tuesday (Rest)",exercises:[]},
    {label:"W6 Wednesday",exercises:[{exId:"step_up",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"stiff_legged_deadlift",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"seated_dumbbell_shoulder_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"standing_calf_raise",sets:3,reps:"10-20",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_shrug",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_side_bend",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W6 Thursday (Rest)",exercises:[]},
    {label:"W6 Friday",exercises:[{exId:"dumbbell_lunge",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_floor_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"pullups",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"hammer_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_lying_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"lying_leg_raise",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W6 Saturday (Rest)",exercises:[]},
    {label:"W7 Sunday (Rest)",exercises:[]},
    {label:"W7 Monday",exercises:[{exId:"dumbbell_squat",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_chest_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_row",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_standing_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"sit_up",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W7 Tuesday (Rest)",exercises:[]},
    {label:"W7 Wednesday",exercises:[{exId:"step_up",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"stiff_legged_deadlift",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"seated_dumbbell_shoulder_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"standing_calf_raise",sets:3,reps:"10-20",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_shrug",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_side_bend",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W7 Thursday (Rest)",exercises:[]},
    {label:"W7 Friday",exercises:[{exId:"dumbbell_lunge",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_floor_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"pullups",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"hammer_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_lying_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"lying_leg_raise",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W7 Saturday (Rest)",exercises:[]},
    {label:"W8 Sunday (Rest)",exercises:[]},
    {label:"W8 Monday",exercises:[{exId:"dumbbell_squat",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_chest_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_row",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_standing_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"sit_up",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W8 Tuesday (Rest)",exercises:[]},
    {label:"W8 Wednesday",exercises:[{exId:"step_up",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"stiff_legged_deadlift",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"seated_dumbbell_shoulder_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"standing_calf_raise",sets:3,reps:"10-20",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_shrug",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_side_bend",sets:3,reps:"10-15",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W8 Thursday (Rest)",exercises:[]},
    {label:"W8 Friday",exercises:[{exId:"dumbbell_lunge",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_floor_press",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"pullups",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"hammer_curl",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"dumbbell_lying_triceps_extension",sets:3,reps:"6-12",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null},{exId:"lying_leg_raise",sets:3,reps:"10-25",weightLbs:null,weightPct:100,distanceMi:null,hrZone:null,durationMin:null}]},
    {label:"W8 Saturday (Rest)",exercises:[]}
    ],
  },
  { id:"ppl", name:"Push / Pull / Legs", icon:"💪", description:"Classic strength split. Ideal for Street Samurai.", bestFor:["warrior","berserker"], type:"week",
    days:[{label:"Push",exercises:[{exId:"bench",sets:4,reps:8},{exId:"ohp",sets:3,reps:10},{exId:"bench_dip",sets:3,reps:12}]},{label:"Pull",exercises:[{exId:"deadlift",sets:4,reps:6},{exId:"row",sets:3,reps:10},{exId:"pullups",sets:3,reps:10}]},{label:"Legs",exercises:[{exId:"squat",sets:4,reps:8},{exId:"lunges",sets:3,reps:12}]},{label:"Rest",exercises:[]},{label:"Push",exercises:[{exId:"bench",sets:4,reps:8},{exId:"ohp",sets:3,reps:10}]},{label:"Pull",exercises:[{exId:"row",sets:4,reps:8},{exId:"pullups",sets:3,reps:12}]},{label:"Rest",exercises:[]}]},
  { id:"cardio_week", name:"Ghost Run", icon:"👁️", description:"Cardio-heavy weekly plan for Ghosts and endurance seekers.", bestFor:["ranger","paladin"], type:"week",
    days:[{label:"Run",exercises:[{exId:"run",sets:1,reps:1}]},{label:"Intervals",exercises:[{exId:"jumpRope",sets:1,reps:1},{exId:"jumpRope",sets:3,reps:10}]},{label:"Cycle",exercises:[{exId:"cycling",sets:1,reps:1}]},{label:"Active Rest",exercises:[{exId:"walk",sets:2,reps:5}]},{label:"Long Run",exercises:[{exId:"run",sets:2,reps:1}]},{label:"Swim",exercises:[{exId:"swim_lap",sets:3,reps:1}]},{label:"Rest",exercises:[]}]},
  { id:"monk_week", name:"Neural Flex", icon:"🧬", description:"Mind-body balance. Flexibility, core, and steady endurance.", bestFor:["monk","paladin"], type:"week",
    days:[{label:"Yoga",exercises:[{exId:"swim_lap",sets:1,reps:1},{exId:"plank",sets:3,reps:3}]},{label:"Core",exercises:[{exId:"plank",sets:4,reps:3},{exId:"walk",sets:3,reps:5}]},{label:"Run",exercises:[{exId:"run",sets:1,reps:1}]},{label:"Yoga",exercises:[{exId:"swim_lap",sets:2,reps:1}]},{label:"Swim",exercises:[{exId:"swim_lap",sets:2,reps:1},{exId:"walk",sets:2,reps:5}]},{label:"Rest",exercises:[]},{label:"Restore",exercises:[{exId:"walk",sets:4,reps:5},{exId:"swim_lap",sets:1,reps:1}]}]},
  { id:"hiit_blast", name:"Overclock", icon:"⚡", description:"Overclocked 5-day HIIT gauntlet. Not for stock builds.", bestFor:["berserker","warrior"], type:"week",
    days:[{label:"HIIT+Lift",exercises:[{exId:"jumpRope",sets:1,reps:1},{exId:"bench",sets:3,reps:10}]},{label:"Legs+Jump",exercises:[{exId:"squat",sets:4,reps:10},{exId:"jumpRope",sets:3,reps:10},{exId:"lunges",sets:3,reps:12}]},{label:"HIIT",exercises:[{exId:"jumpRope",sets:2,reps:1}]},{label:"Pull Day",exercises:[{exId:"deadlift",sets:3,reps:6},{exId:"pullups",sets:4,reps:10},{exId:"row",sets:3,reps:10}]},{label:"HIIT+Core",exercises:[{exId:"jumpRope",sets:1,reps:1},{exId:"plank",sets:4,reps:3}]},{label:"Active Rest",exercises:[{exId:"walk",sets:2,reps:5}]},{label:"Rest",exercises:[]}]},
  { id:"full_body_day", name:"Full Body Blitz", icon:"⚡", description:"Single session hitting everything. Great one-day plan.", bestFor:["paladin","warrior"], type:"day",
    days:[{label:"Full Body",exercises:[{exId:"squat",sets:3,reps:10},{exId:"bench",sets:3,reps:10},{exId:"row",sets:3,reps:10},{exId:"plank",sets:3,reps:3},{exId:"jumpRope",sets:2,reps:10}]}]},
  { id:"morning_routine", name:"Boot Sequence", icon:"💻", description:"30-min morning boot to initialize your systems.", bestFor:["monk","paladin","ranger"], type:"day",
    days:[{label:"Morning",exercises:[{exId:"walk",sets:2,reps:5},{exId:"swim_lap",sets:1,reps:1},{exId:"plank",sets:3,reps:3},{exId:"jumpRope",sets:2,reps:10}]}]},
];

// ═══════════════════════════════════════════════════════════════════
//  CHECK-IN REWARDS
// ═══════════════════════════════════════════════════════════════════
const CHECKIN_REWARDS = [
  { streak:7,   xp:500,    label:"7-Day Streak",     icon:"⚡" },
  { streak:14,  xp:1200,   label:"Ghost Protocol",  icon:"👁️" },
  { streak:30,  xp:3500,   label:"Hard Wired",      icon:"🧬" },
  { streak:60,  xp:9000,   label:"Full Chrome",     icon:"🗡️" },
  { streak:100, xp:20000,  label:"Legendary Rig",   icon:"💀" },
];

// ═══════════════════════════════════════════════════════════════════
//  KEYWORD / HELPERS
// ═══════════════════════════════════════════════════════════════════
const KEYWORD_CLASS_MAP = [
  { keywords:["run","runner","running","marathon","sprint","track","cross country","jog"], class:"ranger" },
  { keywords:["lift","lifting","weight","gym","bench","squat","deadlift","powerlifting","bodybuilding"], class:"warrior" },
  { keywords:["yoga","pilates","stretch","flexibility","meditation","mindful","breathwork"], class:"monk" },
  { keywords:["hiit","crossfit","interval","explosive","intense","adrenaline","extreme"], class:"berserker" },
];

const PARTICLES = Array.from({length:14},(_,i)=>({id:i,x:Math.random()*100,delay:Math.random()*5,duration:6+Math.random()*6,size:2+Math.random()*3}));
const STORAGE_KEY = "iron-glory-v3";

const EMPTY_PROFILE = {
  playerName:"", firstName:"", lastName:"", bio:"", gender:"", chosenClass:null,
  // Name visibility: which contexts show which name. "app"=profile/social, "game"=leaderboard/quests
  // Each of "app" and "game" must be assigned to exactly one row. "hide" = not shown anywhere.
  nameVisibility:{ displayName:["app","game"], realName:["hide"] },
  weightLbs:"", heightFt:"", heightIn:"", gym:"", age:"",
  state:"", country:"United States",
  units:"imperial",
  // About You — collected at onboarding, editable in profile
  sportsBackground:[], fitnessPriorities:[], trainingStyle:"", workoutTiming:"", workoutFreq:"", disciplineTrait:"", motto:"",
  // HUD banner visibility toggles
  hudFields:{weight:false, height:false, bmi:false},
  avatarRace:"human", avatarBodyType:"athletic", avatarSkinTone:"mid_3", avatarHairStyle:"buzz_cut", avatarHairColor:"black", avatarFacePreset:"balanced",
  // Progression
  titles:[], achievements:{},
  xp:0, log:[], plans:[],
  customExercises:[],
  workouts:[],
  scheduledWorkouts:[],
  lastCheckIn:null, checkInStreak:0, totalCheckIns:0, checkInHistory:[],
  quests:{},
  runningPB:null,
  exercisePBs:{},
  travelBoost:null,
  favoriteExercises:[],
  deletedItems:[], // [{id, type:"workout"|"plan", item, deletedAt (ISO)}]
  notificationPrefs:{
    sharedWorkout:true,
    friendLevelUp:true,
    friendRequest:true,
    friendAccepted:true,
    messageReceived:false,
  },
};

// ── Heart Rate Zones ─────────────────────────────────────────────
// Ensures Rest Day is a default favorite and migrates away from customExercises
function ensureRestDay(profile) {
  // Remove rest_day from customExercises if it was there (migration from custom to built-in)
  const customs = (profile.customExercises || []).filter(e => e.id !== "rest_day");
  // Add rest_day to favorites if not already there
  const favs = profile.favoriteExercises || [];
  const hasFav = favs.includes("rest_day");
  return { ...profile, customExercises: customs, favoriteExercises: hasFav ? favs : ["rest_day", ...favs] };
}
// Zones based on % of max HR (220 - age)
// Exercises that track a single continuous effort — no "Sets" field
const NO_SETS_EX_IDS = new Set(["run","walk","cycle_ride","jog","jumpRope","swim_lap","rowing_machine","stationary_bike","rowing","echo_bike","treadmill_walk","treadmill_run","stairmaster","elliptical","battle_ropes","foam_rolling"]);
// Exercise that tracks Personal Best pace
const RUNNING_EX_ID = "run";

const HR_ZONES = [
  { z:1, name:"Recovery",  pct:[50,60], color:"#3498db", desc:"Light & conversational. Active recovery." },
  { z:2, name:"Aerobic",   pct:[60,70], color:"#2ecc71", desc:"Comfortable. Build endurance. Fat burn zone." },
  { z:3, name:"Tempo",     pct:[70,80], color:"#f1c40f", desc:"Moderately hard. Aerobic capacity improves." },
  { z:4, name:"Threshold", pct:[80,90], color:"#e67e22", desc:"Hard. Anaerobic. Max sustainable effort." },
  { z:5, name:"Max",       pct:[90,100],color:"#e74c3c", desc:"All-out. Short bursts only. Peak performance." },
];
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
function getMuscleColor(mg) { return MUSCLE_COLORS[(mg||"").toLowerCase().trim()] || "#B0A090"; }
function getTypeColor(cat) { return TYPE_COLORS[(cat||"").toLowerCase().trim()] || "#B0A898"; }
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
// Intensity slider helpers — maps visual slider 0-100 → pct 50-200 with 100% at dead center (50)
// slider 0-50  → pct 50-100  (1 slider unit = 1 pct point)
// slider 50-100 → pct 100-200 (1 slider unit = 2 pct points)

// ════════════════════════════════════════════════════════════════════
// Map Regions & Points — Progressive journey through fitness zones
// ════════════════════════════════════════════════════════════════════
const MAP_REGIONS = [
  { id: "zone_1", name: "Starter's Realm", icon: "⚔️", color: "#8B7355", glow: "#A89070", desc: "Foundation strength building", boost: { emoji: "💪", label: "Strength", muscle: "all" } },
  { id: "zone_2", name: "Cardio Canyon", icon: "🏃", color: "#5B8D6B", glow: "#7BA68C", desc: "Endurance and stamina zone", boost: { emoji: "❤️", label: "Cardio", muscle: "all" } },
  { id: "zone_3", name: "Flex Temple", icon: "🧘", color: "#7B6B8B", glow: "#9B8BAB", desc: "Flexibility and mobility focus", boost: { emoji: "🤸", label: "Flexibility", muscle: "all" } },
  { id: "zone_4", name: "Iron Peak", icon: "🏔️", color: "#8B7B5B", glow: "#A89B7B", desc: "Advanced strength territory", boost: { emoji: "⚡", label: "Strength", muscle: "all" } },
  { id: "zone_5", name: "Elite Citadel", icon: "👑", color: "#7B8B6B", glow: "#9BAB8B", desc: "Master's domain", boost: { emoji: "🏆", label: "All-Around", muscle: "all" } },
  { id: "zone_6", name: "Legend's Sanctum", icon: "🌟", color: "#8B7B6B", glow: "#A89B8B", desc: "The ultimate fitness sanctuary", boost: { emoji: "✨", label: "All-Around", muscle: "all" } },
];

const MAP_POINTS = [
  { x: 60, y: 120 },
  { x: 120, y: 220 },
  { x: 180, y: 300 },
  { x: 240, y: 380 },
  { x: 300, y: 450 },
  { x: 330, y: 500 },
];

export {
  EX_BY_ID,
  CAT_ICON_COLORS,
  NAME_ICON_MAP,
  MUSCLE_ICON_MAP,
  CAT_ICON_FALLBACK,
  CLASS_SVG_PATHS,
  QUESTS,
  WORKOUT_TEMPLATES,
  PLAN_TEMPLATES,
  CHECKIN_REWARDS,
  KEYWORD_CLASS_MAP,
  PARTICLES,
  STORAGE_KEY,
  EMPTY_PROFILE,
  NO_SETS_EX_IDS,
  RUNNING_EX_ID,
  HR_ZONES,
  MUSCLE_COLORS,
  TYPE_COLORS,
  MAP_REGIONS,
  MAP_POINTS,
};
