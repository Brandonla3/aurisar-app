import { describe, expect, it, vi } from 'vitest';
import { createRealmStore } from './RealmStore.js';

const newStore = () =>
  createRealmStore({
    player: { hp: 100, maxHp: 100, name: 'test' },
    session: { connected: false },
  });

describe('createRealmStore', () => {
  it('exposes its initial slices', () => {
    const s = newStore();
    expect(s.get('player').hp).toBe(100);
    expect(s.getRev('player')).toBe(0);
    expect(s.sliceNames()).toEqual(['player', 'session']);
  });

  it('throws on an unknown slice instead of returning undefined', () => {
    // A typo would otherwise read undefined forever and surface as a mystery
    // blank HUD rather than an error.
    const s = newStore();
    expect(() => s.get('plyer')).toThrow(/unknown slice "plyer"/);
    expect(() => s.update('nope', {})).toThrow(/unknown slice/);
    expect(() => s.subscribe('nope', () => {})).toThrow(/unknown slice/);
  });
});

describe('update', () => {
  it('shallow-merges and bumps the revision', () => {
    const s = newStore();
    expect(s.update('player', { hp: 80 })).toBe(true);

    expect(s.get('player')).toEqual({ hp: 80, maxHp: 100, name: 'test' });
    expect(s.getRev('player')).toBe(1);
  });

  it('accepts a producer function', () => {
    const s = newStore();
    s.update('player', (p) => ({ hp: p.hp - 30 }));
    expect(s.get('player').hp).toBe(70);
  });

  it('does NOT bump the revision or notify when nothing changed', () => {
    // The load-bearing behaviour. Per-frame writers call update() constantly;
    // if a no-op counted as a change, "did anything change?" would always be
    // true and the HUD would re-rasterise every single frame.
    const s = newStore();
    const seen = vi.fn();
    s.subscribe('player', seen);

    expect(s.update('player', { hp: 100 })).toBe(false);

    expect(s.getRev('player')).toBe(0);
    expect(seen).not.toHaveBeenCalled();
  });

  it('detects a change when only one key of many differs', () => {
    const s = newStore();
    expect(s.update('player', { hp: 100, maxHp: 100, name: 'renamed' })).toBe(true);
    expect(s.get('player').name).toBe('renamed');
  });

  it('treats NaN as unchanged rather than always-different', () => {
    // Object.is, not ===. With ===, NaN !== NaN would make any NaN field
    // register as a change on every frame forever.
    const s = createRealmStore({ x: { v: NaN } });
    expect(s.update('x', { v: NaN })).toBe(false);
    expect(s.getRev('x')).toBe(0);
  });

  it('ignores null and undefined patches', () => {
    const s = newStore();
    expect(s.update('player', null)).toBe(false);
    expect(s.update('player', undefined)).toBe(false);
    expect(s.getRev('player')).toBe(0);
  });

  it('produces a new object rather than mutating in place', () => {
    // Consumers may hold the previous reference to diff against it.
    const s = newStore();
    const before = s.get('player');
    s.update('player', { hp: 50 });
    expect(s.get('player')).not.toBe(before);
    expect(before.hp).toBe(100);
  });
});

describe('replace', () => {
  it('swaps the whole slice and bumps the revision', () => {
    const s = newStore();
    s.replace('player', { hp: 1 });
    expect(s.get('player')).toEqual({ hp: 1 });
    expect(s.getRev('player')).toBe(1);
  });

  it('is a no-op when given the identical reference', () => {
    const s = newStore();
    expect(s.replace('player', s.get('player'))).toBe(false);
    expect(s.getRev('player')).toBe(0);
  });
});

describe('subscribe', () => {
  it('notifies only the listeners of the changed slice', () => {
    const s = newStore();
    const onPlayer = vi.fn();
    const onSession = vi.fn();
    s.subscribe('player', onPlayer);
    s.subscribe('session', onSession);

    s.update('player', { hp: 10 });

    expect(onPlayer).toHaveBeenCalledTimes(1);
    expect(onPlayer).toHaveBeenCalledWith({ hp: 10, maxHp: 100, name: 'test' }, 'player');
    // Slice isolation is the point: a mob moving must not wake the health bar.
    expect(onSession).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const s = newStore();
    const fn = vi.fn();
    const off = s.subscribe('player', fn);

    s.update('player', { hp: 90 });
    off();
    s.update('player', { hp: 80 });

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('survives a listener unsubscribing during notification', () => {
    // Mutating the listener set mid-iteration silently skips entries, so the
    // notifier iterates a copy. A self-removing listener is the common case
    // (a "once" subscriber, or a component unmounting on the update).
    const s = newStore();
    const calls = [];
    const offA = s.subscribe('player', () => { calls.push('a'); offA(); });
    s.subscribe('player', () => calls.push('b'));

    s.update('player', { hp: 70 });

    expect(calls).toEqual(['a', 'b']);
  });

  it('keeps notifying the rest when one listener throws', () => {
    // A subscriber bug must not take down the update or starve other consumers.
    const s = newStore();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    s.subscribe('player', () => { throw new Error('bad subscriber'); });
    s.subscribe('player', good);

    expect(() => s.update('player', { hp: 60 })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('snapshot', () => {
  it('returns every slice', () => {
    const s = newStore();
    s.update('session', { connected: true });
    expect(s.snapshot()).toEqual({
      player: { hp: 100, maxHp: 100, name: 'test' },
      session: { connected: true },
    });
  });
});
