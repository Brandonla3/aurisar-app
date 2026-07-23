import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Guards for two bugs that shipped and were caught in review, not by tests.
 *
 * Both were "someone forgot to pair X with Y" rather than bad logic, and
 * neither is reachable by a normal unit test:
 *
 *   1. The stretched-overlay bug is a *layout* bug — a `::after` painting over
 *      sibling controls so clicks land on the wrong element. jsdom has no
 *      layout engine and no paint order, so even with testing-library the
 *      failure would not reproduce. Only a real browser can catch it, and only
 *      if someone thinks to look.
 *
 *   2. The picker Escape bug was a modal wired to a bare setter instead of the
 *      teardown function everything else used.
 *
 * So these assert the *pairings* at the source level. That is weaker than a
 * behavioural test — it proves the wiring exists, not that it works — but it
 * catches the way both defects actually recur: a new row or a new dismissal
 * path that forgets the safeguard.
 */

// Repo root, resolved from this file rather than the working directory so the
// guards behave the same however vitest is invoked.
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = p => readFileSync(ROOT + p, 'utf8');

const STRETCH_ROW_FILES = [
  'src/features/exercises/ExerciseRow.jsx',
  'src/features/exercises/MyWorkoutsSubTab.jsx',
];

describe('stretched-row overlay safeguard', () => {
  const css = read('src/styles/app.css');

  it('lifts every non-primary control above the overlay', () => {
    // Without this rule the ::after swallows clicks meant for the favourite,
    // edit and delete buttons — they become unusable by mouse and touch.
    expect(css).toMatch(/\.stretch-row button:not\(\.picker-ex-main\)/);
    expect(css).toMatch(/\.stretch-row\s*\{[^}]*position:\s*relative/);
  });

  it('applies .stretch-row wherever the stretched primary action is used', () => {
    for (const file of STRETCH_ROW_FILES) {
      const src = read(file);
      if (!src.includes('picker-ex-main')) continue;
      expect(
        src.includes('stretch-row'),
        `${file} uses picker-ex-main without stretch-row — its secondary controls will be unclickable`
      ).toBe(true);
    }
  });

  it('has no row using the overlay outside the audited files', () => {
    // If a third surface adopts the pattern, it must be added above so the
    // pairing is checked there too.
    const walk = d => readdirSync(ROOT + d).flatMap(n => {
      const rel = `${d}/${n}`;
      if (statSync(ROOT + rel).isDirectory()) return n === '__tests__' ? [] : walk(rel);
      return [rel];
    });

    const unaudited = ['src/features/exercises', 'src/features/workouts', 'src/components']
      .flatMap(walk)
      .filter(p => /\.jsx?$/.test(p) && read(p).includes('picker-ex-main'))
      .filter(p => !STRETCH_ROW_FILES.includes(p));
    expect(unaudited).toEqual([]);
  });
});

describe('picker dismissal runs the full teardown', () => {
  const app = read('src/App.jsx');

  it('wires the builder picker Escape to closePicker, not a bare setter', () => {
    // useModalLifecycle(!!wbExPickerOpen, () => setWbExPickerOpen(false)) left
    // the search, filter Sets and selection populated, so reopening restored
    // the previous session's state.
    const line = app.split(/\r?\n/).find(l => l.includes('useModalLifecycle(!!wbExPickerOpen'));
    expect(line, 'builder picker modal lifecycle not found').toBeTruthy();
    expect(line).toMatch(/closePicker\(\)/);
  });

  it('clears every picker facet in closePicker', () => {
    const body = app.slice(app.indexOf('function closePicker()'));
    const fn = body.slice(0, body.indexOf('\n  }') + 4);
    for (const setter of ['setPickerSearch', 'setPickerMuscle', 'setPickerTypeFilter', 'setPickerEquipFilter', 'setPickerSelected']) {
      expect(fn, `closePicker does not reset ${setter}`).toContain(setter);
    }
  });
});

describe('filter vocabulary has a single source', () => {
  it('no surface declares its own muscle or equipment option list', () => {
    // Every private copy so far has drifted. The shared module is the only
    // place these may be spelled out.
    const suspects = [
      'src/components/PlanWizard.jsx',
      'src/features/workouts/WorkoutExercisePicker.jsx',
      'src/features/exercises/ExerciseLibraryTab.jsx',
    ];
    for (const file of suspects) {
      const src = read(file);
      expect(src, `${file} hardcodes a muscle list`).not.toMatch(/\[\s*"chest"\s*,\s*"back"/);
      expect(src, `${file} hardcodes an equipment list`).not.toMatch(/\[\s*"barbell"\s*,\s*"dumbbell"/);
    }
  });
});
