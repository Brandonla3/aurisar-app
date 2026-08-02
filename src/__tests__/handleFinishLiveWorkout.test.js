import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * PR #294 follow-up review: handleFinishLiveWorkout rebuilt each finished
 * live exercise as {exId, sets, reps, weightLbs, extraRows}, dropping
 * distanceMi/hrZone/seconds even though _buildLiveExercises already carries
 * them onto every live exercise object — so a cardio/timed Repeat Last
 * session logged blank distance/zone/duration at finish time. Source guard
 * because App.jsx isn't unit-testable directly; the actual data-shape fix
 * is covered behaviorally in state/__tests__/useWorkoutCompletion.test.js.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const src = readFileSync(ROOT + 'src/App.jsx', 'utf8');

describe('handleFinishLiveWorkout carries timed/cardio metadata through to completion', () => {
  it('includes distanceMi, hrZone, and seconds in the exercises it hands to the completion flow', () => {
    const start = src.indexOf('function handleFinishLiveWorkout(exercises)');
    const body = src.slice(start, start + 900);
    expect(body).toContain('distanceMi: ex.distanceMi || null');
    expect(body).toContain('hrZone: ex.hrZone || null');
    expect(body).toContain('seconds: ex.seconds || null');
  });
});
