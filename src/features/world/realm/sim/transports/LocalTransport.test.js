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

  it('does not mint a fresh move budget on reconnect', async () => {
    // The exploit this pins (found in review, reproduced before fixing): move
    // timing lived in a transport-local variable that connect() nulled, so
    // disconnect→reconnect at the same timestamp granted another full maxDtMs
    // budget — a free ~9.45m hop per reconnect, repeatable forever. Timing now
    // lives on the player row, where a reconnect cannot touch it.
    clock.nowMs = 1000;
    const first = await t.send('moveIntent', { x: 9.4, z: 0 }, 41);
    expect(first.data.accepted).toBe(true);

    await t.disconnect();
    await t.connect('player-1');

    // Same timestamp, full-budget claim again: must be clamped near where the
    // player already was, not accepted and not granted a second budget.
    const cheat = await t.send('moveIntent', { x: 18.8, z: 0 }, 42);
    expect(cheat.data.accepted).toBe(false);
    expect(cheat.data.x).toBeLessThan(9.5);
  });

  it('grants the full first-move budget only on a true first spawn', async () => {
    // The reconnect fix must not break the legitimate case: a brand-new player
    // (no lastMoveAtMs on the row) still gets maxDtMs of budget for their
    // first move rather than being clamped by a zero dt.
    const fresh = createLocalTransport({ now: () => 5000 });
    await fresh.connect('newcomer');
    const r = await fresh.send('moveIntent', { x: 9, z: 0 }, 1);
    expect(r.data.accepted).toBe(true);
  });

  it('keeps move timing out of the public event stream', async () => {
    // lastMoveAtMs is server bookkeeping; clients have no business seeing it.
    let captured;
    t.subscribe((kind, payload) => { if (kind === EVENT.ENTITY_UPSERT) captured = payload; });
    clock.nowMs = 500;
    await t.send('moveIntent', { x: 1, z: 0 }, 43);
    expect(captured).not.toHaveProperty('lastMoveAtMs');
  });
});
