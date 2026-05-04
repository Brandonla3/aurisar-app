/**
 * Extracts OnboardingScreen from App.jsx.
 * Run with: node scripts/build_onboarding_screen.cjs
 */
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'src', 'App.jsx');
const outPath = path.join(__dirname, '..', 'src', 'features', 'onboarding', 'OnboardingScreen.jsx');

const raw = fs.readFileSync(appPath, 'utf8');
const lines = raw.replace(/\r\n/g, '\n').split('\n');

function extract(startLine, endLine, deindent = 0) {
  const prefix = ' '.repeat(deindent);
  return lines
    .slice(startLine - 1, endLine)
    .map(l => l.startsWith(prefix) ? l.slice(deindent) : l)
    .join('\n');
}

const fileHeader = `import React, { memo } from 'react';
import { S, R, FS } from '../../utils/tokens';

/**
 * Onboarding screen — extracted from the inline IIFE in App.jsx as part of
 * Finding #6 (App.jsx decomposition) per docs/performance-audit.md (PR #116).
 *
 * Renders the 6-step onboarding wizard (name, demographics, sports, priorities,
 * training style, location). All state lives in App via props; handleOnboard
 * fires on the final step and writes the completed profile to Supabase.
 */
`;

const componentOpen = `
const OnboardingScreen = memo(function OnboardingScreen({
  // Current step (1–6)
  obStep, setObStep,
  // Name fields
  obName, setObName,
  obFirstName, setObFirstName,
  obLastName, setObLastName,
  // Demographics
  obAge, setObAge,
  obGender, setObGender,
  // Training preferences
  obFreq, setObFreq,
  obTiming, setObTiming,
  obSports, setObSports,
  obPriorities, setObPriorities,
  obStyle, setObStyle,
  // Location
  obState, setObState,
  obCountry, setObCountry,
  // Submit — defined in App, writes profile + sets screen
  handleOnboard,
}) {
`;

// IIFE body: lines 5107–5459, de-indent by 6
const iifeBody = extract(5107, 5459, 6);

const componentClose = `
});

export default OnboardingScreen;
`;

const finalContent = [fileHeader, componentOpen, iifeBody, componentClose].join('');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, finalContent, 'utf8');

const outLines = finalContent.split('\n').length;
console.log(`Written: ${outPath}`);
console.log(`Lines: ${outLines}`);
console.log(`Bytes: ${Buffer.byteLength(finalContent, 'utf8')}`);
