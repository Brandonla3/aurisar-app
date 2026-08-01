import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalTransport } from './LocalTransport.js';
import { EVENT, REJECT, assertTransport, isAck, isNack } from '../WorldTransport.js';
import { MOVE_LIMITS } from '../rules/moveRules.js';

let clock;
let t;

beforeEach(async () => {
  clock = { nowMs: 0 };
  t = createLocalTransport({ now: () => clock.nowMs });
  await t.connect('player-1');
});

describe('contract', () => {
  it('satisfies the WorldTransport interface', () => {
    expect(() => assertTransport(t, 'LocalTransport')).not.toThrow();
  });

  it('nacks every command when not connected', async () => {
    await t.disconnect();
    const r = await t.send('moveIntent', { x: 1, z: 0 }, 1);
    expect(isNack(r)).toBe(true);
    expect(r.code).toBe(REJECT.NOT_CONNECTED);
  });

  it('nacks an unknown command rather than throwing', async () => {
    const r = await t.send('fireballStorm', {}, 2);
    expect(r.code).toBe(REJECT.UNKNOWN_COMMAND);
  });

  it('spawns the player on connect and announces it', async () => {
    const seen = [];
    const t2 = createLocalTransport();
    t2.subscribe((kind, payload) => seen.push([kind, payload]));
    await t2.connect('p2');

    expect(seen[0][0]).toBe(EVENT.CONNECTION);
    expect(seen[1][0]).toBe(EVENT.ENTITY_UPSERT);
    expect(seen[1][1]).toMatchObject({ id: 'p2', hp: 100, x: 0, z: 0 });
  });

  it('requires an identity to connect', async () => {
    const t2 = createLocalTransport();
    await expect(t2.connect()).rejects.toThrow(/identity required/);
  });
});

describe('moveIntent', () => {
  it('accepts a legal move and acks with the position', async () => {
    clock.nowMs = 250;
    const r = await t.send('moveIntent', { x: 1, z: 0, yaw: 0.5 }, 10);

    expect(isAck(r)).toBe(true);
    expect(r.seq).toBe(10);
    expect(r.data).toEqual({ x: 1, z: 0, accepted: true });
    expect(t._db.get('player', 'player-1')).toMatchObject({ x: 1, z: 0, yaw: 0.5 });
  });

  it('clamps an impossible move and emits RECONCILE', async () => {
    const seen = [];
    t.subscribe((kind, payload) => seen.push([kind, payload]));

    clock.nowMs = 100;
    const r = await t.send('moveIntent', { x: 500, z: 0 }, 11);

    // Same shared rules as the future reducer: acked (the command was handled),
    // but the authoritative position is the clamped one.
    expect(isAck(r)).toBe(true);
    expect(r.data.accepted).toBe(false);
    expect(r.data.x).toBeLessThan(500);

    const reconcile = seen.find(([k]) => k === EVENT.RECONCILE);
    expect(reconcile).toBeDefined();
    expect(reconcile[1].seq).toBe(11);
    expect(reconcile[1].x).toBe(r.data.x);
  });

  it('does not emit RECONCILE for an accepted move', async () => {
    const seen = [];
    t.subscribe((kind) => seen.push(kind));
    clock.nowMs = 500;
    await t.send('moveIntent', { x: 0.5, z: 0.5 }, 12);

    expect(seen).not.toContain(EVENT.RECONCILE);
  });

  it('nacks a non-finite position as INVALID_PAYLOAD', async () => {
    const r = await t.send('moveIntent', { x: NaN, z: 0 }, 13);
    expect(r.code).toBe(REJECT.INVALID_PAYLOAD);
    // And the stored position is untouched.
    expect(t._db.get('player', 'player-1')).toMatchObject({ x: 0, z: 0 });
  });

  it('grants the full budget to the first move after connect', async () => {
    // No lastMoveAt yet — dt falls back to maxDtMs rather than zero, so the
    // first move of a session is not spuriously clamped.
    const budget = (MOVE_LIMITS.maxSpeedMps * MOVE_LIMITS.toleranceMult * MOVE_LIMITS.maxDtMs) / 1000;
    const r = await t.send('moveIntent', { x: budget - 0.01, z: 0 }, 14);
    expect(r.data.accepted).toBe(true);
  });

  it('uses injected time for dt, making forged-dt testable', async () => {
    clock.nowMs = 1000;
    await t.send('moveIntent', { x: 1, z: 0 }, 15);

    // 16ms later, claim a 9m hop — far beyond 16ms of budget.
    clock.nowMs = 1016;
    const r = await t.send('moveIntent', { x: 10, z: 0 }, 16);
    expect(r.data.accepted).toBe(false);
  });
});

describe('setTarget', () => {
  it('sets a valid mob target, normalising BigInt ids', async () => {
    t._seedMob(7n);
    const r = await t.send('setTarget', { targetId: 7n }, 20);

    expect(isAck(r)).toBe(true);
    expect(r.data.targetId).toBe('7');
    expect(t._db.get('player', 'player-1').targetId).toBe('7');
  });

  it('rejects a target that does not exist', async () => {
    const r = await t.send('setTarget', { targetId: 'ghost' }, 21);
    expect(r.code).toBe(REJECT.INVALID_TARGET);
  });

  it('clears the target with null', async () => {
    t._seedMob(1);
    await t.send('setTarget', { targetId: 1 }, 22);
    const r = await t.send('setTarget', { targetId: null }, 23);
    expect(isAck(r)).toBe(true);
    expect(t._db.get('player', 'player-1').targetId).toBeNull();
  });
});

describe('events', () => {
  it('emitted rows are copies, not live references', async () => {
    // Mutating an emitted payload must not corrupt the authoritative row —
    // the whole point of server authority is that clients cannot write it.
    let captured;
    t.subscribe((kind, payload) => { if (kind === EVENT.ENTITY_UPSERT) captured = payload; });
    await t.send('moveIntent', { x: 1, z: 0 }, 30);

    captured.x = 9999;
    expect(t._db.get('player', 'player-1').x).toBe(1);
  });

  it('a throwing subscriber does not break the others', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen = [];
    t.subscribe(() => { throw new Error('bad subscriber'); });
    t.subscribe((kind) => seen.push(kind));

    await t.send('moveIntent', { x: 0.5, z: 0 }, 31);

    expect(seen).toContain(EVENT.ENTITY_UPSERT);
    err.mockRestore();
  });

  it('unsubscribe stops delivery', async () => {
    const fn = vi.fn();
    const off = t.subscribe(fn);
    off();
    await t.send('moveIntent', { x: 0.5, z: 0 }, 32);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('reconnect', () => {
  it('resumes the existing row rather than respawning', async () => {
    await t.send('moveIntent', { x: 3, z: 2 }, 40);
    await t.disconnect();
    await t.connect('player-1');

    // Position survives a reconnect — the world is authoritative, not the session.
    expect(t._db.get('player', 'player-1')).toMatchObject({ x: 3, z: 2 });
  });
});
