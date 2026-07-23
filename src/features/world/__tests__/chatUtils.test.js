import { describe, it, expect } from 'vitest';
import { idHex, isChatVisible, insertChatMessage, joinCutoffMs, shouldFlagUnseen } from '../chatUtils';

const RADIUS = 400;
const world = (over = {}) => ({ id: 1n, senderName: 'A', text: 'hi', sentAt: 1000n, msgType: 'world', x: 0, y: 0, ...over });
const prox = (over = {}) => ({ ...world({ msgType: 'proximity' }), ...over });

describe('isChatVisible', () => {
  const me = { x: 0, y: 0 };
  it('always shows world and emote messages regardless of distance', () => {
    expect(isChatVisible(world({ x: 99999, y: 99999 }), me, RADIUS)).toBe(true);
    expect(isChatVisible(world({ msgType: 'emote', x: 99999, y: 99999 }), me, RADIUS)).toBe(true);
  });
  it('shows proximity messages inside and exactly at the radius', () => {
    expect(isChatVisible(prox({ x: 100, y: 100 }), me, RADIUS)).toBe(true);
    expect(isChatVisible(prox({ x: RADIUS, y: 0 }), me, RADIUS)).toBe(true);
  });
  it('hides proximity messages outside the radius', () => {
    expect(isChatVisible(prox({ x: RADIUS + 1, y: 0 }), me, RADIUS)).toBe(false);
    expect(isChatVisible(prox({ x: 300, y: 300 }), me, RADIUS)).toBe(false); // √180000 ≈ 424
  });
  it('fails open on missing position data', () => {
    expect(isChatVisible(prox({ x: NaN, y: 0 }), me, RADIUS)).toBe(true);
    expect(isChatVisible(prox({ x: 99999, y: 0 }), null, RADIUS)).toBe(true);
  });
});

describe('insertChatMessage', () => {
  it('dedupes by id (BigInt-safe)', () => {
    const list = [world({ id: 5n })];
    expect(insertChatMessage(list, world({ id: 5n }))).toBe(list);
  });
  it('keeps the list sorted by sentAt even with out-of-order delivery', () => {
    let list = [];
    list = insertChatMessage(list, world({ id: 2n, sentAt: 2000n }));
    list = insertChatMessage(list, world({ id: 1n, sentAt: 1000n }));
    list = insertChatMessage(list, world({ id: 3n, sentAt: 3000n }));
    expect(list.map(m => m.id)).toEqual([1n, 2n, 3n]);
  });
  it('caps the buffer, dropping the oldest', () => {
    let list = [];
    for (let i = 0; i < 70; i++) {
      list = insertChatMessage(list, world({ id: BigInt(i), sentAt: BigInt(i * 1000) }));
    }
    expect(list).toHaveLength(60);
    expect(list[0].id).toBe(10n);
  });
  it('drops rows older than the join cutoff', () => {
    const cutoff = 5000n;
    const list = insertChatMessage([], world({ id: 1n, sentAt: 4000n }), { joinCutoffMs: cutoff });
    expect(list).toHaveLength(0);
    const kept = insertChatMessage([], world({ id: 2n, sentAt: 6000n }), { joinCutoffMs: cutoff });
    expect(kept).toHaveLength(1);
  });
});

describe('joinCutoffMs', () => {
  it('returns milliseconds (now minus window), matching the server sentAt unit', () => {
    // Server stores sentAt in ms, so the cutoff must be ms — NOT microseconds.
    expect(joinCutoffMs(100000, 60000)).toBe(40000n);
  });
  it('clamps at zero', () => {
    expect(joinCutoffMs(1000, 60000)).toBe(0n);
  });
});

describe('shouldFlagUnseen', () => {
  const remote = { senderId: { toHexString: () => 'remote' } };
  const mine = { senderId: { toHexString: () => 'me' } };
  it('flags a remote message while chat is closed', () => {
    expect(shouldFlagUnseen(remote, 'me', false)).toBe(true);
  });
  it('never flags the local player’s own echo', () => {
    // submitChat closes chat immediately, so own rows arrive with chat closed.
    expect(shouldFlagUnseen(mine, 'me', false)).toBe(false);
  });
  it('never flags while chat is open', () => {
    expect(shouldFlagUnseen(remote, 'me', true)).toBe(false);
  });
});

describe('idHex', () => {
  it('uses toHexString when available, falls back to String', () => {
    expect(idHex({ toHexString: () => 'abc' })).toBe('abc');
    expect(idHex(42)).toBe('42');
    expect(idHex(null)).toBeNull();
  });
});
