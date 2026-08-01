import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWorkoutCompletion } from '../useWorkoutCompletion';

/**
 * PR #294 follow-up review: finishing a Repeat Last cardio/timed session
 * used to log blank distance/HR-zone/duration even when the source workout
 * had them, because the completion mapper always read distanceMi/hrZone/
 * seconds off the EXERCISE (never the row), and its reps fallback assumed
 * every blank `reps` meant "untouched strength set" (`|| 10`) rather than
 * "timed row that stores its duration in seconds instead."
 *
 * useWorkoutCompletion has no internal hook calls (no useState/useEffect) —
 * it's safe to call directly as a plain function outside a component.
 * confirmWorkoutComplete defers its heavy work via scheduleAfterPaint
 * (setTimeout(0) in jsdom, since requestIdleCallback isn't defined there),
 * so tests advance fake timers to flush it.
 */

const ALL_EX_BY_ID = {
  run: { id: 'run', name: 'Run', icon: '🏃', category: 'cardio', muscleGroup: 'cardio' },
  bench: { id: 'bench', name: 'Bench', icon: '🏋️', category: 'strength', muscleGroup: 'chest' },
};

function setup(workout) {
  let updater = null;
  const setProfile = vi.fn(fn => { updater = fn; });
  const profile = { xp: 0, log: [], quests: {}, workouts: [], scheduledWorkouts: [], chosenClass: null, equipPerks: null };
  const { confirmWorkoutComplete } = useWorkoutCompletion({
    profile,
    setProfile,
    allExById: ALL_EX_BY_ID,
    applyAutoCheckIn: p => ({ profile: p, checkInApplied: false, checkInXP: 0, checkInStreak: 0 }),
    getMult: () => 1,
    showToast: vi.fn(),
    setXpFlash: vi.fn(),
    showWorkoutsSubTab: vi.fn(),
    completionModal: { workout },
    setCompletionModal: vi.fn(),
    completionDate: '',
    setCompletionDate: vi.fn(),
    completionAction: 'today',
    setCompletionAction: vi.fn(),
    setScheduleWoDate: vi.fn(),
  });
  confirmWorkoutComplete();
  return () => {
    if (!updater) throw new Error('setProfile was never called — entries.length was probably 0');
    return updater(profile).log;
  };
}

describe('useWorkoutCompletion — cardio/timed metadata through completion', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('derives reps-as-minutes from seconds for a blank-reps cardio row, and keeps distanceMi/hrZone/seconds', async () => {
    const getLog = setup({
      id: 'w1', name: 'Cardio Day', icon: '🏃', oneOff: true,
      exercises: [{ exId: 'run', sets: 1, reps: null, seconds: 1800, distanceMi: 3.1, hrZone: 3 }],
    });
    await vi.runAllTimersAsync();
    const [entry] = getLog();
    expect(entry).toMatchObject({ exId: 'run', reps: 30, seconds: 1800, distanceMi: 3.1, hrZone: 3 });
  });

  it('extra rows keep their own distanceMi/hrZone/seconds instead of inheriting the primary row\'s', async () => {
    const getLog = setup({
      id: 'w1', name: 'Cardio Day', icon: '🏃', oneOff: true,
      exercises: [{
        exId: 'run', sets: 1, reps: null, seconds: 1800, distanceMi: 3.1, hrZone: 3,
        extraRows: [{ sets: 1, reps: null, seconds: 600, distanceMi: 1.2, hrZone: 4 }],
      }],
    });
    await vi.runAllTimersAsync();
    const log = getLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ reps: 30, seconds: 1800, distanceMi: 3.1, hrZone: 3 });
    expect(log[1]).toMatchObject({ reps: 10, seconds: 600, distanceMi: 1.2, hrZone: 4 });
  });

  it('builder-created extra rows with no distanceMi/hrZone/seconds of their own fall back to the exercise-level value, unchanged from before', async () => {
    const getLog = setup({
      id: 'w1', name: 'Push Day', icon: '🏋️', oneOff: true,
      exercises: [{
        exId: 'bench', sets: 3, reps: 10, weightLbs: 135,
        extraRows: [{ sets: 1, reps: 8, weightLbs: 155 }],
      }],
    });
    await vi.runAllTimersAsync();
    const log = getLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ reps: 10, weightLbs: 135, distanceMi: null, hrZone: null, seconds: null });
    expect(log[1]).toMatchObject({ reps: 8, weightLbs: 155, distanceMi: null, hrZone: null, seconds: null });
  });

  it('a blank-reps strength row still falls back to 10, not a seconds-derived value it has none of', async () => {
    const getLog = setup({
      id: 'w1', name: 'Push Day', icon: '🏋️', oneOff: true,
      exercises: [{ exId: 'bench', sets: 3, reps: null, weightLbs: 135 }],
    });
    await vi.runAllTimersAsync();
    const [entry] = getLog();
    expect(entry.reps).toBe(10);
  });
});
