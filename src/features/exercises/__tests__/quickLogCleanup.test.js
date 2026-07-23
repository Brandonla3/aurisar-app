import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Guards the Quick Log cleanup path. A scheduled solo exercise opened with the
 * pencil sets `pendingSoloRemoveId`; if a non-completion exit (Edit/Copy, Add
 * to Workout, Add to Plan) closes the sheet with a bare `setSelEx(null)`, the
 * stale id survives and the NEXT unrelated Quick Log completion silently
 * removes the earlier scheduled exercise. Every non-completion exit must run
 * the full `dismiss()` teardown (which clears pendingSoloRemoveId + the
 * duration/rows scratch + the origin).
 *
 * Source-level guard because the repo has no DOM test environment; it proves
 * the wiring, matching rowInvariants.test.js.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const src = readFileSync(ROOT + 'src/features/exercises/QuickLogModal.jsx', 'utf8');

describe('Quick Log — non-completion exits clean up', () => {
  it('clears pendingSoloRemoveId only inside the dismiss teardown', () => {
    const body = src.slice(src.indexOf('const dismiss ='));
    const dismissFn = body.slice(0, body.indexOf('};') + 2);
    expect(dismissFn).toContain('setPendingSoloRemoveId(null)');
  });

  it('routes every non-completion exit through dismiss(), not a bare setSelEx(null)', () => {
    // The ONLY place selEx is nulled directly is the dismiss() teardown itself.
    // Edit/Copy, Add to Workout, and Add to Plan must call dismiss().
    const bareClears = src.match(/setSelEx\(null\)/g) || [];
    expect(bareClears.length, 'setSelEx(null) should appear once, inside dismiss()').toBe(1);
    // The three non-completion actions are present and use dismiss.
    expect(src).toMatch(/openExEditor\((?:"edit"|'edit'|"copy"|'copy')/);
    expect(src).toMatch(/setAddToWorkoutPicker\(/);
    expect(src).toMatch(/openSavePlanWizard\(/);
    // dismiss() is called at least for the three non-completion exits + back.
    const dismissCalls = src.match(/\bdismiss\(\)/g) || [];
    expect(dismissCalls.length).toBeGreaterThanOrEqual(4);
  });
});
