import { describe, it, expect } from 'vitest';
import { deriveLastSession } from '../repeatLast';

const row = (over = {}) => ({
  exId: 'bench', exercise: 'Bench Press', xp: 50, sets: 3, reps: 10, weightLbs: 135,
  dateKey: '2026-07-30', sourceWorkoutId: 'w1', sourceWorkoutName: 'Iron Vigil',
  sourceWorkoutIcon: '⚔', sourceGroupId: 'batch-1', ...over,
});

describe('deriveLastSession', () => {
  it('returns null for an empty or solo-only log', () => {
    expect(deriveLastSession([])).toBeNull();
    expect(deriveLastSession(null)).toBeNull();
    // Solo quick logs carry no source* fields — not a session.
    expect(deriveLastSession([{ exId: 'bench', sets: 3, reps: 10, dateKey: '2026-07-30' }])).toBeNull();
  });

  it('rebuilds the newest batch, folding duplicate-exId rows into extraRows', () => {
    const log = [
      // newest batch: bench primary + one progressive row, then squat
      row({ sets: 3, reps: 10, weightLbs: 135 }),
      row({ sets: 1, reps: 8, weightLbs: 155 }),
      row({ exId: 'squat', exercise: 'Squat', weightLbs: 225 }),
      // older batch — must be ignored
      row({ sourceGroupId: 'batch-0', dateKey: '2026-07-28', weightLbs: 115 }),
    ];
    const out = deriveLastSession(log);
    expect(out.workout.id).toBe('w1');
    expect(out.workout.name).toBe('Iron Vigil');
    expect(out.workout.oneOff).toBe(true);
    expect(out.completedOn).toBe('2026-07-30');
    expect(out.workout.exercises).toEqual([
      {
        exId: 'bench', sets: 3, reps: 10, weightLbs: 135, weightPct: 100,
        distanceMi: null, hrZone: null, seconds: null,
        extraRows: [{ sets: 1, reps: 8, weightLbs: 155, distanceMi: null, hrZone: null, seconds: null }],
      },
      { exId: 'squat', sets: 3, reps: 10, weightLbs: 225, weightPct: 100, distanceMi: null, hrZone: null, seconds: null },
    ]);
  });

  it('skips leading solo entries to find the newest session', () => {
    const log = [
      { exId: 'plank', sets: 3, reps: 12, dateKey: '2026-07-31' }, // solo, newest
      row(),
    ];
    expect(deriveLastSession(log).workout.name).toBe('Iron Vigil');
  });

  it('falls back to workoutId+dateKey grouping for legacy rows without sourceGroupId', () => {
    const legacy = (over = {}) => { const r = row(over); delete r.sourceGroupId; return r; };
    const log = [
      legacy({ weightLbs: 135 }),
      legacy({ exId: 'squat', weightLbs: 225 }),
      legacy({ dateKey: '2026-07-25', weightLbs: 95 }), // different day — excluded
    ];
    const out = deriveLastSession(log);
    expect(out.workout.exercises).toHaveLength(2);
    expect(out.workout.exercises[0].weightLbs).toBe(135);
  });

  it('does not merge two separate same-day legacy completions of the same workout', () => {
    // Same workoutId + dateKey, but two distinct completions (different
    // `time`) — the second, earlier one must not fold into the first as a
    // fabricated multi-exercise session.
    const legacy = (over = {}) => { const r = row(over); delete r.sourceGroupId; return r; };
    const log = [
      legacy({ weightLbs: 145, time: '6:14 PM' }), // newest completion, evening
      legacy({ exId: 'squat', weightLbs: 225, time: '9:02 AM' }), // separate morning completion
    ];
    const out = deriveLastSession(log);
    expect(out.workout.exercises).toHaveLength(1);
    expect(out.workout.exercises[0]).toMatchObject({ exId: 'bench', weightLbs: 145 });
  });

  it('preserves distanceMi, hrZone and seconds through both the sourceGroupId and legacy paths', () => {
    const out = deriveLastSession([
      row({ distanceMi: 3.1, hrZone: 3, seconds: 42 }),
      row({ sets: 1, reps: 8, weightLbs: 155, distanceMi: 1.2, hrZone: 4, seconds: 10 }),
    ]);
    expect(out.workout.exercises[0]).toMatchObject({ distanceMi: 3.1, hrZone: 3, seconds: 42 });
    expect(out.workout.exercises[0].extraRows[0]).toMatchObject({ distanceMi: 1.2, hrZone: 4, seconds: 10 });

    const legacy = (over = {}) => { const r = row(over); delete r.sourceGroupId; return r; };
    const legacyOut = deriveLastSession([legacy({ distanceMi: 6.2, hrZone: 2, seconds: 5 })]);
    expect(legacyOut.workout.exercises[0]).toMatchObject({ distanceMi: 6.2, hrZone: 2, seconds: 5 });
  });
});
