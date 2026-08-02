import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Source guard for a PR #294 review finding: startLiveWorkout only opens the
 * replace-confirm when the incoming workout's id differs from the live one
 * (`liveWorkout.workoutId !== wo.id`). Repeat Last clones the workout you
 * most recently completed — which, mid-session, is very often the exact
 * workout you're already tracking — so that id-mismatch check matched and
 * skipped straight past the confirm, silently overwriting checked-off live
 * progress. Neither path is reachable without a DOM, so this pins the fix at
 * the source level, matching builderReset.test.js.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const app = readFileSync(ROOT + 'src/App.jsx', 'utf8');

describe('Repeat Last routes through the replace-confirm for ANY active live session', () => {
  it("the orb's Repeat Last handler checks `liveWorkout`, not an id comparison, before bypassing the confirm", () => {
    const body = app.slice(app.indexOf('repeatLast={repeatLastSession ? {'));
    const fn = body.slice(0, body.indexOf('} : null}'));
    expect(fn).toContain('if (liveWorkout)');
    expect(fn).toContain('setPendingLiveWorkout(repeatLastSession.workout)');
    // must NOT reintroduce the id-equality escape hatch
    expect(fn).not.toMatch(/liveWorkout\.workoutId !== repeatLastSession\.workout\.id/);
  });

  it('the toast only fires on the direct-start path, or once via the ref after a confirmed replace', () => {
    const body = app.slice(app.indexOf('repeatLast={repeatLastSession ? {'));
    const fn = body.slice(0, body.indexOf('} : null}'));
    expect(fn).toContain('pendingLiveWorkoutToastRef.current = repeatToast');
    expect(fn).toContain('showToast(repeatToast)');

    const confirmBody = app.slice(app.indexOf('function confirmReplaceLiveWorkout()'));
    const confirmFn = confirmBody.slice(0, confirmBody.indexOf('\n  }') + 4);
    expect(confirmFn).toContain('pendingLiveWorkoutToastRef.current');
    expect(confirmFn).toContain('setPendingLiveWorkout(null)');
  });

  it('cancelling the replace-confirm clears the pending toast so a later unrelated replace stays silent', () => {
    const idx = app.indexOf('onConfirm={confirmReplaceLiveWorkout}');
    const cancelBody = app.slice(idx, app.indexOf('/>}', idx));
    expect(cancelBody).toContain('pendingLiveWorkoutToastRef.current = null');
  });
});
