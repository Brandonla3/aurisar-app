/**
 * check_no_undef.mjs — fail the build on a reference to something that does
 * not exist in scope.
 *
 * Why this is its own gate rather than `npm run lint`: the repo carries ~590
 * pre-existing lint findings (hook deps, unused vars, a11y), so turning the
 * whole linter into a required check is not currently possible. `no-undef` is
 * the one rule whose violations are always a runtime crash, never a matter of
 * taste — so it is enforced on its own.
 *
 * It exists because PR #321 shipped exactly that. New state was added to
 * useAuthState.js and used throughout App.jsx, but never destructured from the
 * hook, so:
 *
 *   Uncaught ReferenceError: setPwRecoveryMode is not defined
 *
 * fired on sign-in, sign-out, password change AND the password-reset handler.
 * `npm run build` passed (it is valid syntax), 1233 tests passed (they were
 * source-guard string matches and unit tests that never executed the wiring),
 * and login was broken in production. `npx eslint src/App.jsx` reported it on
 * the first run, as 15 no-undef errors.
 *
 * The same run surfaced a second, older one: ProfileTab's "Remove Phone"
 * button called a `removePhone` that was defined in App.jsx and never passed
 * down — dead since it was written.
 *
 * Scope is the app wiring surface (App.jsx, features, state, utils,
 * components). scripts/ and netlify/ are excluded because they are Node, where
 * `process`/`Buffer` read as undefined under the browser globals config —
 * noise that would bury the real findings.
 */

import { ESLint } from "eslint";

const PATHS = [
  "src/App.jsx",
  "src/features",
  "src/state",
  "src/utils",
  "src/components",
];

const eslint = new ESLint();
const results = await eslint.lintFiles(PATHS);

const offences = [];
for (const r of results) {
  for (const m of r.messages) {
    if (m.ruleId === "no-undef") {
      offences.push(`${r.filePath.replace(process.cwd() + "\\", "").replace(process.cwd() + "/", "")}:${m.line}:${m.column}  ${m.message}`);
    }
  }
}

if (offences.length) {
  console.error(
    `[no-undef] ${offences.length} reference(s) to something not in scope.\n` +
    `These are runtime ReferenceErrors, not style:\n\n` +
    offences.map(o => `    ${o}`).join("\n") +
    `\n\nUsually a value was added to a hook (e.g. useAuthState) and used in a\n` +
    `component without being destructured from it, or a handler is passed to a\n` +
    `child that never declared it as a prop.\n`
  );
  process.exit(1);
}

console.log(`[no-undef] clean across ${results.length} files in the app wiring surface.`);
