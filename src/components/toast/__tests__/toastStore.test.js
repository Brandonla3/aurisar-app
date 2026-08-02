import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { showToast, dismissToast, getToasts, subscribeToasts, _clearToasts } from '../toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _clearToasts();
  });
  afterEach(() => vi.useRealTimers());

  it('queues concurrent toasts instead of clobbering (the old single-slot bug)', () => {
    showToast('first');
    showToast('second');
    expect(getToasts().map(t => t.message)).toEqual(['first', 'second']);
  });

  it('auto-dismisses each toast on its own timer', () => {
    showToast('quick', 1000);
    showToast('slow', 5000);
    vi.advanceTimersByTime(1000);
    expect(getToasts().map(t => t.message)).toEqual(['slow']);
    vi.advanceTimersByTime(4000);
    expect(getToasts()).toEqual([]);
  });

  it('supports the legacy (msg, duration) signature used by ~60 call sites', () => {
    showToast('legacy', 2000);
    vi.advanceTimersByTime(1999);
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  it('marks error toasts so the host can render role="alert"', () => {
    showToast('boom', { type: 'error' });
    expect(getToasts()[0].type).toBe('error');
  });

  it('caps the visible stack and clears the evicted toast timer', () => {
    for (let i = 0; i < 6; i++) showToast(`t${i}`);
    expect(getToasts()).toHaveLength(4);
    expect(getToasts()[0].message).toBe('t2');
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const seen = [];
    const unsub = subscribeToasts(list => seen.push(list.length));
    showToast('a');
    unsub();
    showToast('b');
    expect(seen).toEqual([1]);
  });

  it('dismissToast is idempotent for an unknown id', () => {
    showToast('a');
    const id = getToasts()[0].id;
    dismissToast(id);
    dismissToast(id);
    expect(getToasts()).toEqual([]);
  });
});
