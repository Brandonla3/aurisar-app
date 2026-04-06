#!/usr/bin/env node
/**
 * generate-exercises.js
 * Reads the "Updated List" sheet from the master Excel audit file
 * and generates src/data/exercises.js with all 1,489 exercises.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const EXCEL_PATH = process.argv[2] || path.resolve(__dirname, '..', '..', '..', '..', 'Downloads', 'AurisarGames_Master_Exercise_Audit (1).xlsx');
const OUTPUT_PATH = path.resolve(__dirname, '..', 'src', 'data', 'exercises.js');

// ── Read spreadsheet ────────────────────────────────────────────
const wb = XLSX.readFile(EXCEL_PATH);
const ws = wb.Sheets['Updated List'];
if (!ws) { console.error('Sheet "Updated List" not found'); process.exit(1); }
const rows = XLSX.utils.sheet_to_json(ws);
console.log(`Read ${rows.length} exercises from spreadsheet`);

// ── Helpers ─────────────────────────────────────────────────────
function yn(v) { return String(v || '').trim().toLowerCase() === 'yes'; }
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function slug(v) { return String(v || '').toLowerCase(); }
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// Special ID mappings for backward compatibility with existing user data
const ID_OVERRIDES = {
  'pushups': 'pushup',  // keep old singular ID for user data compat
};

// ── Build exercises ─────────────────────────────────────────────
const exercises = [];
const seenIds = new Set();
const duplicates = [];

for (const row of rows) {
  let id = slug(row['ID / Slug'] || '');
  if (!id) continue;

  // Apply backward-compat overrides
  if (ID_OVERRIDES[id]) id = ID_OVERRIDES[id];

  if (seenIds.has(id)) {
    duplicates.push(id);
    continue;
  }
  seenIds.add(id);

  const name = String(row['Name'] || '').trim();
  const source = String(row['Source'] || '').trim().toLowerCase().replace(/\s+/g, '-');
  const category = String(row['Category'] || 'strength').trim().toLowerCase();
  const exerciseType = String(row['Exercise Type(s)'] || '').trim().toLowerCase();
  const muscleGroup = String(row['Muscle Group'] || '').trim().toLowerCase();
  const equipment = String(row['Equipment'] || 'bodyweight').trim().toLowerCase();
  const difficulty = String(row['Difficulty'] || 'Intermediate').trim();
  const classAffinity = String(row['Class Affinity'] || 'all').trim().toLowerCase();
  const baseXP = num(row['Base XP']) || 40;
  const icon = String(row['Icon'] || '\u{1F3CB}\u{FE0F}').trim();
  const desc = String(row['Description'] || '').trim();

  // Boolean flags
  const wodViable = yn(row['WOD Viable']);
  const compound = yn(row['Compound']);
  const calisthenics = yn(row['Calisthenics']);
  const olympic = yn(row['Olympic']);
  const plyometric = yn(row['Plyometric']);
  const isolation = yn(row['Isolation']);

  // Tracking flags
  const tracksWeight = yn(row['Tracks Weight']);
  const tracksDistance = yn(row['Tracks Distance']);
  const tracksInclineSpeed = yn(row['Tracks Incline/Speed']);
  const resistanceLevel = yn(row['Resistance Level']);

  // PB system
  const pbType = row['PB Type'] ? String(row['PB Type']).trim() : null;
  const pbTier = row['PB Tier'] ? String(row['PB Tier']).trim() : 'Personal';
  const primaryPBMetric = row['Primary PB Metric'] ? String(row['Primary PB Metric']).trim() : null;
  const markAsPB = yn(row['Mark as PB']);

  // XP system
  const xpInputFormula = row['XP Input Formula'] ? String(row['XP Input Formula']).trim() : null;
  const supersetEligible = yn(row['Superset Eligible']);
  const intervalEligible = yn(row['Interval Eligible']);

  // Class multipliers
  const xpClassMap = {
    warrior:   num(row['\u2694\uFE0F Warrior']) || 1,
    gladiator: num(row['\uD83C\uDFDB\uFE0F Gladiator']) || 1,
    warden:    num(row['\uD83C\uDF32 Warden']) || 1,
    phantom:   num(row['\uD83E\uDD85 Phantom']) || 1,
    tempest:   num(row['\uD83C\uDF0A Tempest']) || 1,
    warlord:   num(row['\uD83C\uDFF9 Warlord']) || 1,
    druid:     num(row['\uD83E\uDDEC Druid']) || 1,
    oracle:    num(row['\uD83D\uDCA0 Oracle']) || 1,
    titan:     num(row['\u26D3\uFE0F Titan']) || 1,
    striker:   num(row['\uD83E\uDD4A Striker']) || 1,
    alchemist: num(row['\uD83D\uDD2C Alchemist']) || 1,
  };

  // Derived
  const muscles = muscleGroup ? muscleGroup.charAt(0).toUpperCase() + muscleGroup.slice(1) : '';

  exercises.push({
    id, name, source, category, exerciseType, muscleGroup, equipment,
    difficulty, classAffinity, baseXP, icon, desc, muscles,
    wodViable, compound, calisthenics, olympic, plyometric, isolation,
    tracksWeight, tracksDistance, tracksInclineSpeed, resistanceLevel,
    pbType, pbTier, primaryPBMetric, markAsPB,
    xpInputFormula, supersetEligible, intervalEligible,
    xpClassMap,
  });
}

// ── Validation ──────────────────────────────────────────────────
console.log(`\nGenerated ${exercises.length} exercises`);
if (duplicates.length) {
  console.warn(`WARNING: ${duplicates.length} duplicate IDs skipped:`, duplicates);
}

// Validate template/quest references
const allIds = new Set(exercises.map(e => e.id));

const TEMPLATE_REFS = [
  'run','pushup','pullups',
  'dumbbell_squat','dumbbell_chest_press','dumbbell_row','dumbbell_curl',
  'dumbbell_standing_triceps_extension','sit_up','step_up',
  'stiff_legged_deadlift','seated_dumbbell_shoulder_press',
  'dumbbell_shrug','dumbbell_side_bend',
  'dumbbell_lying_triceps_extension','lying_leg_raise',
];
const QUEST_REFS = [
  'run','cycling','swim_lap','jumpRope','deadlift','squat','pullups',
];
const NO_SETS_REFS = [
  'run','walk','cycle_ride','jog','jumprope','swim_lap',
  'stationary_bike','rowing','echo_bike','treadmill_walk','treadmill_run',
];

console.log('\n── Template Exercise Validation ──');
for (const id of TEMPLATE_REFS) {
  if (!allIds.has(id)) console.warn(`  MISSING template ref: ${id}`);
}
console.log('── Quest Exercise Validation ──');
for (const id of QUEST_REFS) {
  if (!allIds.has(id)) console.warn(`  MISSING quest ref: ${id}`);
}
console.log('── NO_SETS_EX_IDS Validation ──');
for (const id of NO_SETS_REFS) {
  if (!allIds.has(id)) console.warn(`  MISSING no-sets ref: ${id}`);
}

// ── Read existing CLASSES from exercises.js ─────────────────────
const existingFile = fs.readFileSync(OUTPUT_PATH, 'utf8');
const classesMatch = existingFile.match(/^const CLASSES = \{[\s\S]*?\n\};/m);
if (!classesMatch) {
  console.error('Could not extract CLASSES from existing exercises.js');
  process.exit(1);
}
const classesBlock = classesMatch[0];

// ── Generate output ─────────────────────────────────────────────
let out = classesBlock + '\n\n';
out += '// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n';
out += '//  EXERCISES  (master list \u2014 1,489 exercises from audit spreadsheet)\n';
out += '// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n';
out += 'const EXERCISES = [\n';

for (const ex of exercises) {
  const cm = ex.xpClassMap;
  const cmStr = `{warrior:${cm.warrior},gladiator:${cm.gladiator},warden:${cm.warden},phantom:${cm.phantom},tempest:${cm.tempest},warlord:${cm.warlord},druid:${cm.druid},oracle:${cm.oracle},titan:${cm.titan},striker:${cm.striker},alchemist:${cm.alchemist}}`;

  out += '  {\n';
  out += `    id:"${esc(ex.id)}", name:"${esc(ex.name)}", source:"${esc(ex.source)}",\n`;
  out += `    category:"${esc(ex.category)}", exerciseType:"${esc(ex.exerciseType)}", muscleGroup:"${esc(ex.muscleGroup)}",\n`;
  out += `    equipment:"${esc(ex.equipment)}", difficulty:"${esc(ex.difficulty)}", classAffinity:"${esc(ex.classAffinity)}",\n`;
  out += `    baseXP:${ex.baseXP}, icon:"${esc(ex.icon)}", muscles:"${esc(ex.muscles)}",\n`;
  out += `    desc:"${esc(ex.desc)}",\n`;
  out += `    wodViable:${ex.wodViable}, compound:${ex.compound}, calisthenics:${ex.calisthenics}, olympic:${ex.olympic}, plyometric:${ex.plyometric}, isolation:${ex.isolation},\n`;
  out += `    tracksWeight:${ex.tracksWeight}, tracksDistance:${ex.tracksDistance}, tracksInclineSpeed:${ex.tracksInclineSpeed}, resistanceLevel:${ex.resistanceLevel},\n`;
  out += `    pbType:${ex.pbType ? '"' + esc(ex.pbType) + '"' : 'null'}, pbTier:"${esc(ex.pbTier)}", primaryPBMetric:${ex.primaryPBMetric ? '"' + esc(ex.primaryPBMetric) + '"' : 'null'}, markAsPB:${ex.markAsPB},\n`;
  out += `    xpInputFormula:${ex.xpInputFormula ? '"' + esc(ex.xpInputFormula) + '"' : 'null'}, supersetEligible:${ex.supersetEligible}, intervalEligible:${ex.intervalEligible},\n`;
  out += `    xpClassMap:${cmStr},\n`;
  out += `    tips:[], images:[],\n`;
  out += '  },\n';
}

out += '];\n\n';
out += 'export { CLASSES, EXERCISES };\n';

fs.writeFileSync(OUTPUT_PATH, out, 'utf8');
console.log(`\nWrote ${OUTPUT_PATH} (${exercises.length} exercises)`);
