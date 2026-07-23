import { describe, it, expect } from 'vitest';
import { buildWorkoutObject } from '../workoutModel';

/**
 * Pins the workout-object shape for every construction entry point, so the
 * consolidation of the five hand-rolled sites can't silently drop or
 * reformat a field. createdAt formats intentionally differ per site and
 * must pass through verbatim.
 */

const EXS = [{ exId: 'pushup', sets: 3, reps: 10 }];

describe('buildWorkoutObject', () => {
  it('builder save/update shape (localized createdAt, no oneOff key)', () => {
    const w = buildWorkoutObject({
      id: 'w1', name: '  Push Day ', icon: '💪', desc: ' chest focus ',
      exercises: EXS, createdAt: '7/23/2026',
      durationMin: 3600, activeCal: '320', totalCal: '410', labels: ['Push'],
    });
    expect(w).toEqual({
      id: 'w1', name: 'Push Day', icon: '💪', desc: 'chest focus',
      exercises: EXS, createdAt: '7/23/2026',
      durationMin: 3600, activeCal: '320', totalCal: '410', labels: ['Push'],
    });
    expect('oneOff' in w).toBe(false);
  });

  it('save-as-new mints an id when none is given', () => {
    const w = buildWorkoutObject({ name: 'A', icon: '⚡', exercises: EXS, createdAt: 'x' });
    expect(typeof w.id).toBe('string');
    expect(w.id.length).toBeGreaterThan(0);
  });

  it('one-off shape carries oneOff:true and the ISO createdAt it was given', () => {
    const w = buildWorkoutObject({
      name: 'Quick Blast', icon: '⚡', exercises: EXS,
      createdAt: '2026-07-23', oneOff: true, labels: [],
    });
    expect(w.oneOff).toBe(true);
    expect(w.createdAt).toBe('2026-07-23');
  });

  it('recipe shape: empty stats collapse to null, empty labels stay an array', () => {
    const w = buildWorkoutObject({
      name: 'Forge of Dawn', icon: '🌅', desc: 'from template',
      exercises: EXS, createdAt: '7/23/2026',
    });
    expect(w.durationMin).toBeNull();
    expect(w.activeCal).toBeNull();
    expect(w.totalCal).toBeNull();
    expect(w.labels).toEqual([]);
    expect('oneOff' in w).toBe(false);
  });

  it('empty-string stats normalize to null exactly like the originals ("" || null)', () => {
    const w = buildWorkoutObject({
      name: 'A', icon: 'x', exercises: EXS, createdAt: 'c',
      durationMin: '', activeCal: '', totalCal: '',
    });
    expect(w.durationMin).toBeNull();
    expect(w.activeCal).toBeNull();
    expect(w.totalCal).toBeNull();
  });
});
