import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  classifyError, toResult, ok, empty, unavailable,
  isBroken, isUnreachable, KIND, STATUS,
} from '../fetchResult';

// navigator.onLine is read at classify time; restore it between cases.
const setOnline = value => {
  Object.defineProperty(globalThis.navigator, 'onLine', {
    value, configurable: true, writable: true,
  });
};
afterEach(() => { setOnline(true); vi.restoreAllMocks(); });

describe('classifyError', () => {
  it('treats missing schema objects as permanent and reportable', () => {
    // The exact codes behind the dead leaderboard and the dead inbox.
    for (const code of ['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703']) {
      const c = classifyError({ code, message: 'boom' });
      expect(c.kind, code).toBe(KIND.SCHEMA);
      expect(c.permanent, code).toBe(true);
      expect(c.report, code).toBe(true);
    }
  });

  it('treats a permission failure as permanent — retrying cannot fix a missing GRANT', () => {
    const c = classifyError({ code: '42501', message: 'permission denied' });
    expect(c.kind).toBe(KIND.PERMISSION);
    expect(c.permanent).toBe(true);
  });

  it('does NOT call an expired JWT broken — signing in again fixes it', () => {
    const c = classifyError({ code: 'PGRST301', message: 'JWT expired' });
    expect(c.kind).toBe(KIND.AUTH);
    expect(c.permanent).toBe(false);
    expect(c.report).toBe(false);
  });

  it('treats offline / network / 5xx as transient and does not shout', () => {
    setOnline(false);
    expect(classifyError({ message: 'whatever' }).kind).toBe(KIND.TRANSIENT);
    setOnline(true);
    expect(classifyError({ message: 'TypeError: Failed to fetch' }).kind).toBe(KIND.TRANSIENT);
    expect(classifyError({ message: 'x', status: 503 }).kind).toBe(KIND.TRANSIENT);
    expect(classifyError({ message: 'x', status: 408 }).kind).toBe(KIND.TRANSIENT);
    for (const k of [KIND.TRANSIENT]) {
      expect(classifyError({ message: 'Failed to fetch' }).permanent).toBe(false);
      expect(k).toBeTruthy();
    }
  });

  it('reports unknown errors to the developer without shouting at the user', () => {
    // Misreading a permanent failure as transient is the mode that recreates
    // the original bug, so unknowns lean toward being reported.
    const c = classifyError({ code: '23505', message: 'duplicate key' });
    expect(c.kind).toBe(KIND.UNKNOWN);
    expect(c.permanent).toBe(false);
    expect(c.report).toBe(true);
  });

  it('returns a null kind for no error', () => {
    expect(classifyError(null).kind).toBeNull();
    expect(classifyError(undefined).report).toBe(false);
  });
});

describe('toResult', () => {
  it('never collapses an error into an empty array — the original bug', () => {
    const r = toResult({ data: null, error: { code: '42P01', message: 'no relation' } });
    expect(r.status).toBe(STATUS.UNAVAILABLE);
    expect(r.rows).toEqual([]);
    expect(r.permanent).toBe(true);
    // The crucial property: unavailable is distinguishable from empty.
    expect(r.status).not.toBe(STATUS.EMPTY);
  });

  it('distinguishes a proven-empty result from an unavailable one', () => {
    const e = toResult({ data: [], error: null });
    expect(e.status).toBe(STATUS.EMPTY);
    expect(e.checkedAt).toBeTruthy();
    expect(isBroken(e)).toBe(false);
    expect(isUnreachable(e)).toBe(false);
  });

  it('passes rows through on success', () => {
    const r = toResult({ data: [{ id: 1 }], error: null });
    expect(r.status).toBe(STATUS.OK);
    expect(r.rows).toHaveLength(1);
  });

  it('carries the surface name so a report says WHICH feature died', () => {
    const r = toResult(
      { data: null, error: { code: '42P01', message: 'x' } },
      { surface: 'notifications.inbox' }
    );
    expect(r.surface).toBe('notifications.inbox');
  });
});

describe('render predicates', () => {
  it('isBroken is true only for permanent failures', () => {
    expect(isBroken(unavailable({ code: '42P01' }))).toBe(true);
    expect(isBroken(unavailable({ message: 'Failed to fetch' }))).toBe(false);
    expect(isBroken(empty())).toBe(false);
    expect(isBroken(ok([1]))).toBe(false);
  });

  it('isUnreachable is the calm counterpart, so a train ride is not an outage', () => {
    expect(isUnreachable(unavailable({ message: 'Failed to fetch' }))).toBe(true);
    expect(isUnreachable(unavailable({ code: '42P01' }))).toBe(false);
  });

  it('is null-safe', () => {
    expect(isBroken(null)).toBe(false);
    expect(isUnreachable(undefined)).toBe(false);
  });
});
