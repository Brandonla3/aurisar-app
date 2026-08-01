import { describe, it, expect } from 'vitest';
import { getExerciseHistory } from '../exerciseHistory';

const row = (over = {}) => ({
  exId: 'bench', dateKey: '2026-07-30', sets: 3, reps: 10, weightLbs: 135, xp: 50, ...over,
});

describe('getExerciseHistory', () => {
  it('a multi-row Set Forge session collapses into ONE point, not one per row', () => {
    // An 8-set pyramid must not fill 8 History bars for a single workout.
    const log = [
      row({ sourceGroupId: 'g1', xp: 50 }),
      row({ sourceGroupId: 'g1', sets: 1, reps: 8, weightLbs: 155, xp: 20 }),
      row({ sourceGroupId: 'g1', sets: 1, reps: 6, weightLbs: 165, xp: 15 }),
    ];
    const hist = getExerciseHistory(log, 'bench');
    expect(hist).toHaveLength(1);
    // The session's displayed stats come from its primary (first) row.
    expect(hist[0]).toMatchObject({ sets: 3, reps: 10, weightLbs: 135 });
    // XP is the session's total, not just the primary row's.
    expect(hist[0].xp).toBe(85);
  });

  it('rows without a sourceGroupId are each their own session (legacy/conservative)', () => {
    const log = [
      row({ dateKey: '2026-07-30', weightLbs: 145 }),
      row({ dateKey: '2026-07-29', weightLbs: 140 }),
    ];
    const hist = getExerciseHistory(log, 'bench');
    expect(hist).toHaveLength(2);
  });

  it('ignores rows for other exercises and caps at `limit` sessions, oldest first', () => {
    const log = [
      row({ dateKey: '2026-07-31', sourceGroupId: 'g4' }),
      row({ exId: 'squat', dateKey: '2026-07-31' }), // different exercise — excluded
      row({ dateKey: '2026-07-30', sourceGroupId: 'g3' }),
      row({ dateKey: '2026-07-29', sourceGroupId: 'g2' }),
      row({ dateKey: '2026-07-28', sourceGroupId: 'g1' }),
    ];
    const hist = getExerciseHistory(log, 'bench', 2);
    expect(hist).toHaveLength(2);
    // Newest-first input, capped at 2, then reversed to oldest→newest for display.
    expect(hist.map(h => h.dateKey)).toEqual(['2026-07-30', '2026-07-31']);
  });

  it('a mix of grouped and ungrouped rows for the same exercise sessions correctly', () => {
    const log = [
      row({ dateKey: '2026-07-31', sourceGroupId: 'g2', xp: 40 }),
      row({ dateKey: '2026-07-31', sourceGroupId: 'g2', sets: 1, reps: 5, weightLbs: 145, xp: 10 }),
      row({ dateKey: '2026-07-30', xp: 30 }), // legacy, ungrouped, own session
    ];
    const hist = getExerciseHistory(log, 'bench');
    expect(hist).toHaveLength(2);
    expect(hist[1].xp).toBe(50); // the grouped session's summed total
    expect(hist[0].xp).toBe(30); // the legacy single-row session
  });
});
