import { describe, it, expect } from 'vitest';
import { commitDurationBlur, commitSecChange, durationDisplay } from '../setsEditorDuration';

/**
 * The duration pair's scratch-field sync (`_durHHMM`/`_durSecRaw` →
 * `durationSec` + minute-`reps`) is the one piece of the sets editor whose
 * corruption silently damages saved workouts — reps double as "minutes" for
 * cardio XP, and durationSec is what completion stores. These tests pin the
 * exact patch sequences the builder has always produced, so the SetsEditor
 * consolidation (and any future edit) can't drift them.
 */

const apply = (value, patches) => {
  const next = { ...value };
  for (const p of patches) next[p.field] = p.val;
  return next;
};

describe('commitDurationBlur', () => {
  it('normalizes 1:30 → 01:30 and derives durationSec + minute reps', () => {
    const v = { reps: '', durationSec: null };
    const next = apply(v, commitDurationBlur(v, '1:30'));
    expect(next._durHHMM).toBe('01:30');
    expect(next.durationSec).toBe(90 * 60);
    expect(next.reps).toBe(90);
  });

  it('keeps previously-typed loose seconds in the total', () => {
    const v = { _durSecRaw: '45', durationSec: null };
    const next = apply(v, commitDurationBlur(v, '00:10'));
    expect(next.durationSec).toBe(10 * 60 + 45);
    expect(next.reps).toBe(10); // floor of minutes
  });

  it('clears the scratch field (undefined) when input is blanked', () => {
    const v = { durationSec: null };
    const patches = commitDurationBlur(v, '');
    expect(patches[0]).toEqual({ field: '_durHHMM', val: undefined });
  });

  it('clears the stale minute reps when an existing timed exercise is cleared', () => {
    // Start with a real prior duration/reps and blank both fields to zero.
    const v = { durationSec: 90 * 60, reps: 90, _durSecRaw: '' };
    const next = apply(v, commitDurationBlur(v, ''));
    expect(next.durationSec).toBe(0);
    // reps MUST be cleared, not left at 90 (else it stays saved + XP-scored
    // and durationDisplay resurfaces it).
    expect(next.reps).toBe('');
  });

  it('a sub-minute duration still yields at least 1 rep-minute', () => {
    const v = { _durSecRaw: '30', durationSec: null };
    const next = apply(v, commitDurationBlur(v, '00:00'));
    expect(next.durationSec).toBe(30);
    expect(next.reps).toBe(1);
  });
});

describe('commitSecChange', () => {
  it('combines with the in-progress HH:MM scratch value', () => {
    const v = { _durHHMM: '00:05', durationSec: null };
    const next = apply(v, commitSecChange(v, '20'));
    expect(next._durSecRaw).toBe('20');
    expect(next.durationSec).toBe(5 * 60 + 20);
    expect(next.reps).toBe(5);
  });

  it('falls back to the stored durationSec HH:MM when no scratch exists', () => {
    const v = { durationSec: 3600 }; // 01:00:00 stored
    const next = apply(v, commitSecChange(v, '15'));
    expect(next.durationSec).toBe(60 * 60 + 15);
    expect(next.reps).toBe(60);
  });

  it('clears reps when the seconds change empties the total', () => {
    const v = { durationSec: 45, reps: 1, _durHHMM: '00:00' };
    const next = apply(v, commitSecChange(v, ''));
    expect(next.durationSec).toBe(0);
    expect(next.reps).toBe('');
  });
});

describe('durationDisplay', () => {
  it('prefers scratch fields over stored values (mid-edit)', () => {
    expect(durationDisplay({ _durHHMM: '01:2', durationSec: 5400 }).hhmm).toBe('01:2');
    expect(durationDisplay({ _durSecRaw: '7', durationSec: 5400 }).sec).toBe('07');
  });

  it('renders stored durationSec when no scratch exists', () => {
    const d = durationDisplay({ durationSec: 90 * 60 + 5 });
    expect(d.hhmm).toBe('01:30');
    expect(d.sec).toBe('05');
  });

  it('falls back to legacy minute-reps when only reps exist', () => {
    expect(durationDisplay({ reps: 45 }).hhmm).toBe('00:45');
  });

  it('normalizes an over-60 legacy reps value (90 → 01:30, not 00:90)', () => {
    expect(durationDisplay({ reps: 90 }).hhmm).toBe('01:30');
    expect(durationDisplay({ reps: 125 }).hhmm).toBe('02:05');
  });
});
