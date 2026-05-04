/**
 * Updates App.jsx for the OnboardingScreen extraction:
 *   1. Adds import for OnboardingScreen
 *   2. Replaces the onboarding IIFE with <OnboardingScreen ... />
 *
 * Run with: node scripts/update_app_onboarding.cjs
 */
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'src', 'App.jsx');
const raw = fs.readFileSync(appPath, 'utf8');
const hasCRLF = raw.includes('\r\n');
let src = hasCRLF ? raw.replace(/\r\n/g, '\n') : raw;

// ─── 1. Add import ─────────────────────────────────────────────────────────
const importAnchor = "import ProfileTab from './features/profile/ProfileTab';";
const obImport = "import OnboardingScreen from './features/onboarding/OnboardingScreen';";
if (src.includes(obImport)) {
  console.log('Import already present — skipping.');
} else {
  src = src.replace(importAnchor, importAnchor + '\n' + obImport);
  console.log('Import added.');
}

// ─── 2. Replace IIFE ───────────────────────────────────────────────────────
const OPEN_NEEDLE = `    /* ══ ONBOARDING ═════════════════════════════ */}{screen === "onboard" && (() => {`;
const CLASS_REVEAL_MARKER = `    /* ══ CLASS REVEAL`;
const IIFE_CLOSE = `    })()`;

const openIdx = src.indexOf(OPEN_NEEDLE);
if (openIdx === -1) throw new Error('Could not find onboarding IIFE opening!');

const crIdx = src.indexOf(CLASS_REVEAL_MARKER, openIdx);
if (crIdx === -1) throw new Error('Could not find Class Reveal marker!');

// Find the last })() before the class reveal marker
let closeIdx = -1;
let searchFrom = openIdx;
while (true) {
  const candidate = src.indexOf(IIFE_CLOSE, searchFrom);
  if (candidate === -1 || candidate >= crIdx) break;
  closeIdx = candidate;
  searchFrom = candidate + 1;
}
if (closeIdx === -1) throw new Error('Could not find onboarding IIFE closing!');

const iifeEnd = closeIdx + IIFE_CLOSE.length;

console.log(`IIFE open at char ${openIdx}, close at char ${iifeEnd}`);
console.log(`Class Reveal marker at char ${crIdx}`);

const replacement = `    /* ══ ONBOARDING ═════════════════════════════ */}{screen === "onboard" && (
      <OnboardingScreen
        obStep={obStep}
        setObStep={setObStep}
        obName={obName}
        setObName={setObName}
        obFirstName={obFirstName}
        setObFirstName={setObFirstName}
        obLastName={obLastName}
        setObLastName={setObLastName}
        obAge={obAge}
        setObAge={setObAge}
        obGender={obGender}
        setObGender={setObGender}
        obFreq={obFreq}
        setObFreq={setObFreq}
        obTiming={obTiming}
        setObTiming={setObTiming}
        obSports={obSports}
        setObSports={setObSports}
        obPriorities={obPriorities}
        setObPriorities={setObPriorities}
        obStyle={obStyle}
        setObStyle={setObStyle}
        obState={obState}
        setObState={setObState}
        obCountry={obCountry}
        setObCountry={setObCountry}
        handleOnboard={handleOnboard}
      />
    )`;

src = src.slice(0, openIdx) + replacement + src.slice(iifeEnd);

const finalSrc = hasCRLF ? src.replace(/\n/g, '\r\n') : src;
fs.writeFileSync(appPath, finalSrc, 'utf8');
console.log('App.jsx updated.');
console.log('Line count:', src.split('\n').length);
