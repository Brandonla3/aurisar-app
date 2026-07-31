import { describe, it, expect } from 'vitest';
import { buildLastPerformedIndex, lastPerformed, agoLabel, STALE_AFTER_MS } from '../lastPerformed';

const DAY = 86400000;
const NOW = 1780000000000; // fixed so nothing here depends on the wall clock

const entry = (exId, daysAgo, extra = {}) => ({
  exId,
  sets: 4,
  reps: 8,
  weightLbs: 145,
  loggedAt: NOW - daysAgo * DAY,
  dateKey: new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10),
  ...extra,
});

describe('buildLastPerformedIndex', () => {
  it('keeps the most recent entry per exercise', () => {
    const idx = buildLastPerformedIndex([
      entry('bench', 2, { weightLbs: 155 }),
      entry('bench', 30, { weightLbs: 95 }),
      entry('squat', 5),
    ]);
    expect(idx.size).toBe(2);
    expect(lastPerformed(idx, 'bench', NOW).weightLbs).toBe('155');
  });

  // The whole reason this module exists rather than a .find() on the array:
  // HistoryTab restores a deleted entry by APPENDING it, and entries can be
  // logged against a past date and still be prepended. Array position is
  // "most recently written", not "most recently performed".
  it('ignores array position and uses recency', () => {
    const idx = buildLastPerformedIndex([
      entry('bench', 40, { weightLbs: 95 }),  // first in the array, but oldest
      entry('bench', 1, { weightLbs: 185 }),
    ]);
    expect(lastPerformed(idx, 'bench', NOW).weightLbs).toBe('185');
  });

  it('falls back to dateKey + time for entries predating loggedAt', () => {
    const legacy = { exId: 'ohp', sets: 3, reps: 10, weightLbs: 65, dateKey: '2026-05-01', time: '06:14 PM' };
    const idx = buildLastPerformedIndex([legacy]);
    expect(lastPerformed(idx, 'ohp', NOW)).not.toBeNull();
    expect(lastPerformed(idx, 'ohp', NOW).reps).toBe('10');
  });

  it('skips entries with no exId or no parseable time', () => {
    const idx = buildLastPerformedIndex([{ sets: 3, reps: 3 }, { exId: 'x', sets: 1, reps: 1 }]);
    expect(idx.has(undefined)).toBe(false);
  });

  it('tolerates a null or missing log', () => {
    expect(buildLastPerformedIndex(null).size).toBe(0);
    expect(buildLastPerformedIndex(undefined).size).toBe(0);
  });
});

describe('lastPerformed', () => {
  it('returns null for an exercise with no history, rather than zeros', () => {
    const idx = buildLastPerformedIndex([entry('bench', 1)]);
    expect(lastPerformed(idx, 'deadlift', NOW)).toBeNull();
  });

  // "We know what you did" and "we are guessing" must stay distinguishable,
  // or the builder passes a default off as a memory.
  it('returns null when sets/reps are unusable', () => {
    const idx = buildLastPerformedIndex([entry('run', 1, { sets: 0, reps: 0 })]);
    expect(lastPerformed(idx, 'run', NOW)).toBeNull();
  });

  it('omits weight when the entry had none', () => {
    const idx = buildLastPerformedIndex([entry('pushup', 1, { weightLbs: null })]);
    expect(lastPerformed(idx, 'pushup', NOW).weightLbs).toBe('');
  });

  it('marks entries older than three weeks stale', () => {
    const idx = buildLastPerformedIndex([entry('bench', 20), entry('squat', 25)]);
    expect(lastPerformed(idx, 'bench', NOW).stale).toBe(false);
    expect(lastPerformed(idx, 'squat', NOW).stale).toBe(true);
    expect(STALE_AFTER_MS).toBe(21 * DAY);
  });

  it('reports age in whole days', () => {
    const idx = buildLastPerformedIndex([entry('bench', 5)]);
    expect(lastPerformed(idx, 'bench', NOW).ageDays).toBe(5);
  });

  it('returns strings, because the builder inputs are text fields', () => {
    const idx = buildLastPerformedIndex([entry('bench', 1)]);
    const p = lastPerformed(idx, 'bench', NOW);
    expect(p.sets).toBe('4');
    expect(p.reps).toBe('8');
    expect(p.weightLbs).toBe('145');
  });
});

describe('agoLabel', () => {
  it('reads naturally across the range', () => {
    expect(agoLabel(0)).toBe('today');
    expect(agoLabel(1)).toBe('yesterday');
    expect(agoLabel(5)).toBe('5d ago');
    expect(agoLabel(28)).toBe('4w ago');
    expect(agoLabel(400)).toBe('1y ago');
  });

  it('is empty for a non-number rather than printing NaN', () => {
    expect(agoLabel(undefined)).toBe('');
  });
});
