/**
 * Updates App.jsx for two extractions:
 *   1. ClassRevealScreen — replaces the classReveal IIFE
 *   2. ConfirmDeleteModal — replaces the confirmDelete IIFE
 * Also adds both imports.
 *
 * Run with: node scripts/update_app_class_reveal_confirm_delete.cjs
 */
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'src', 'App.jsx');
const raw = fs.readFileSync(appPath, 'utf8');
const hasCRLF = raw.includes('\r\n');
let src = hasCRLF ? raw.replace(/\r\n/g, '\n') : raw;

// ─── 1. Add imports ────────────────────────────────────────────────────────
const importAnchor = "import OnboardingScreen from './features/onboarding/OnboardingScreen';";
const classRevealImport = "import ClassRevealScreen from './features/onboarding/ClassRevealScreen';";
const confirmDeleteImport = "import ConfirmDeleteModal from './components/ConfirmDeleteModal';";

if (!src.includes(classRevealImport)) {
  src = src.replace(importAnchor, importAnchor + '\n' + classRevealImport);
  console.log('ClassRevealScreen import added.');
} else {
  console.log('ClassRevealScreen import already present.');
}

if (!src.includes(confirmDeleteImport)) {
  // Add after ClassRevealScreen import
  src = src.replace(classRevealImport, classRevealImport + '\n' + confirmDeleteImport);
  console.log('ConfirmDeleteModal import added.');
} else {
  console.log('ConfirmDeleteModal import already present.');
}

// ─── 2. Replace CLASS REVEAL IIFE ─────────────────────────────────────────
const CR_OPEN = `    /* ══ CLASS REVEAL ═══════════════════════════ */}{screen === "classReveal" && detectedClass && (() => {`;
const CP_MARKER = `    /* ══ CLASS PICK`;
const IIFE_CLOSE = `    })()`;

const crOpenIdx = src.indexOf(CR_OPEN);
if (crOpenIdx === -1) throw new Error('Could not find CLASS REVEAL IIFE opening!');

const cpIdx = src.indexOf(CP_MARKER, crOpenIdx);
if (cpIdx === -1) throw new Error('Could not find CLASS PICK marker!');

let crCloseIdx = -1;
let searchFrom = crOpenIdx;
while (true) {
  const candidate = src.indexOf(IIFE_CLOSE, searchFrom);
  if (candidate === -1 || candidate >= cpIdx) break;
  crCloseIdx = candidate;
  searchFrom = candidate + 1;
}
if (crCloseIdx === -1) throw new Error('Could not find CLASS REVEAL IIFE closing!');

const crEnd = crCloseIdx + IIFE_CLOSE.length;
console.log(`CLASS REVEAL: open at char ${crOpenIdx}, close at char ${crEnd}`);

const crReplacement = `    /* ══ CLASS REVEAL ═══════════════════════════ */}{screen === "classReveal" && detectedClass && (
      <ClassRevealScreen
        detectedClass={detectedClass}
        confirmClass={confirmClass}
        setScreen={setScreen}
      />
    )`;

src = src.slice(0, crOpenIdx) + crReplacement + src.slice(crEnd);

// ─── 3. Replace CONFIRM DELETE IIFE ───────────────────────────────────────
const CD_OPEN = `    /* ══ CONFIRM DELETE MODAL ════════════════════ */}{confirmDelete && (() => {`;
const MAP_MARKER = `    /* ══ MAP OVERLAY`;

const cdOpenIdx = src.indexOf(CD_OPEN);
if (cdOpenIdx === -1) throw new Error('Could not find CONFIRM DELETE IIFE opening!');

const mapIdx = src.indexOf(MAP_MARKER, cdOpenIdx);
if (mapIdx === -1) throw new Error('Could not find MAP OVERLAY marker!');

let cdCloseIdx = -1;
searchFrom = cdOpenIdx;
while (true) {
  const candidate = src.indexOf(IIFE_CLOSE, searchFrom);
  if (candidate === -1 || candidate >= mapIdx) break;
  cdCloseIdx = candidate;
  searchFrom = candidate + 1;
}
if (cdCloseIdx === -1) throw new Error('Could not find CONFIRM DELETE IIFE closing!');

const cdEnd = cdCloseIdx + IIFE_CLOSE.length;
console.log(`CONFIRM DELETE: open at char ${cdOpenIdx}, close at char ${cdEnd}`);

const cdReplacement = `    /* ══ CONFIRM DELETE MODAL ════════════════════ */}{confirmDelete && (
      <ConfirmDeleteModal
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        plansContainerRef={plansContainerRef}
        _doDeleteWorkout={_doDeleteWorkout}
        _doDeleteCustomEx={_doDeleteCustomEx}
        _doDeleteLogEntry={_doDeleteLogEntry}
        _doResetChar={_doResetChar}
      />
    )`;

src = src.slice(0, cdOpenIdx) + cdReplacement + src.slice(cdEnd);

const finalSrc = hasCRLF ? src.replace(/\n/g, '\r\n') : src;
fs.writeFileSync(appPath, finalSrc, 'utf8');
console.log('App.jsx updated.');
console.log('Line count:', src.split('\n').length);
