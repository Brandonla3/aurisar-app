/**
 * headlessSim.test.js — the P1 exit criterion.
 *
 * A whole playable loop — connect, move under validation, get clamped, target a
 * mob, react to server events — running in plain node with NO renderer, NO
 * Babylon, NO network, NO jsdom. Store + dispatcher + LocalTransport wired
 * together exactly the way RealmWorld will wire them, with the real shared
 * rules doing the deciding.
 *
 * If this file needs anything from view/ to pass, the architecture has failed;
 * that is enforced structurally by boundary.test.js, and demonstrated
 * behaviourally here.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createRealmStore } from './RealmStore.js';
import { createDispatcher } from './dispatch.js';
import { createLocalTransport } from './transports/LocalTransport.js';
import { EVENT, REJECT } from './WorldTransport.js';
import { MOVE_LIMITS } from './rules/moveRules.js';

/** The wiring RealmWorld will do for real — store <- events, store -> commands. */
function bootHeadlessWorld({ now }) {
  const store = createRealmStore({
    player: { id: null, x: 0, z: 0, yaw: 0, hp: 0, maxHp: 0, targetId: null },
    entities: { byId: {} },
    session: { connected: false, lastReconcileSeq: null },
  });

  const transport = createLocalTransport({ now });

  transport.subscribe((kind, payload) => {
    if (kind === EVENT.CONNECTION) {
      store.update('session', { connected: payload.connected });
    } else if (kind === EVENT.ENTITY_UPSERT) {
      if (payload.id === store.get('player').id) {
        store.update('player', payload);
      } else {
        store.update('entities', (e) => ({ byId: { ...e.byId, [payload.id]: payload } }));
      }
    } else if (kind === EVENT.RECONCILE) {
      // Server correction wins over local optimism, always.
      store.update('player', { x: payload.x, z: payload.z, yaw: payload.yaw });
      store.update('session', { lastReconcileSeq: payload.seq });
    }
  });

  const dispatcher = createDispatcher({
    store,
    transport,
    commands: {
      moveIntent: {
        validate: (p) =>
          Number.isFinite(p.x) && Number.isFinite(p.z) ? null : REJECT.INVALID_PAYLOAD,
        predict: (p, s) => {
          const before = { x: s.get('player').x, z: s.get('player').z };
          s.update('player', { x: p.x, z: p.z });
          return () => s.update('player', before);
        },
      },
      setTarget: {
        predict: (p, s) => {
          const before = s.get('player').targetId;
          s.update('player', { targetId: p.targetId == null ? null : String(p.targetId) });
          return () => s.update('player', { targetId: before });
        },
      },
    },
  });

  return { store, transport, dispatcher };
}

let clock, world;

beforeEach(async () => {
  clock = { nowMs: 0 };
  world = bootHeadlessWorld({ now: () => clock.nowMs });
  world.store.update('player', { id: 'hero' });
  await world.transport.connect('hero');
});

describe('headless world sim', () => {
  it('boots to a connected, spawned state', () => {
    expect(world.store.get('session').connected).toBe(true);
    expect(world.store.get('player')).toMatchObject({ id: 'hero', hp: 100, x: 0, z: 0 });
  });

  it('a legal walk lands in the store with no correction', async () => {
    clock.nowMs = 250;
    const r = await world.dispatcher.dispatch('moveIntent', { x: 1, z: 0.5 });

    expect(r.ok).toBe(true);
    expect(world.store.get('player')).toMatchObject({ x: 1, z: 0.5 });
    expect(world.store.get('session').lastReconcileSeq).toBeNull();
  });

  it('an impossible hop is predicted, then corrected by the server', async () => {
    clock.nowMs = 100;
    const r = await world.dispatcher.dispatch('moveIntent', { x: 500, z: 0 });

    // The command was handled (ack), the claim was not honoured...
    expect(r.ok).toBe(true);
    expect(r.data.accepted).toBe(false);

    // ...and by settle time the store holds the server's clamped position, not
    // the optimistic 500. This is the full predict -> reconcile round trip.
    const p = world.store.get('player');
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(500);
    expect(world.store.get('session').lastReconcileSeq).toBe(r.seq);
  });

  it('garbage input never reaches the transport and never moves the player', async () => {
    const before = world.store.get('player').x;
    const r = await world.dispatcher.dispatch('moveIntent', { x: NaN, z: 0 });

    expect(r.ok).toBe(false);
    expect(r.code).toBe(REJECT.INVALID_PAYLOAD);
    expect(world.store.get('player').x).toBe(before);
  });

  it('targeting flows end to end, including a server rejection rollback', async () => {
    world.transport._seedMob(7n, { hp: 50 });

    const good = await world.dispatcher.dispatch('setTarget', { targetId: 7n });
    expect(good.ok).toBe(true);
    expect(world.store.get('player').targetId).toBe('7');

    // A target the server does not know: optimism applies, then rolls back.
    const bad = await world.dispatcher.dispatch('setTarget', { targetId: 'ghost' });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe(REJECT.INVALID_TARGET);
    expect(world.store.get('player').targetId).toBe('7');
  });

  it('sustained play: 60 legal ticks keep client and server in lockstep', async () => {
    // A minute of simulated walking at one command per second, each step within
    // budget. No reconcile should ever fire, and the final positions must agree
    // exactly — this is the determinism the shared rules exist to provide.
    let x = 0;
    for (let i = 1; i <= 60; i++) {
      clock.nowMs = i * 1000;
      x += 2; // 2 m/s, well under the 9.45 budget
      const r = await world.dispatcher.dispatch('moveIntent', { x, z: 0 });
      expect(r.data.accepted).toBe(true);
    }

    expect(world.store.get('player').x).toBe(120);
    expect(world.transport._db.get('player', 'hero').x).toBe(120);
    expect(world.store.get('session').lastReconcileSeq).toBeNull();
    expect(world.dispatcher.pendingCount()).toBe(0);
  });

  it('speed hacking under sustained play is contained', async () => {
    // Claim 20 m/s for ten seconds. Every step gets clamped; the total ground
    // covered cannot exceed the budget the rules allow.
    let claimed = 0;
    for (let i = 1; i <= 10; i++) {
      clock.nowMs = i * 1000;
      claimed += 20;
      await world.dispatcher.dispatch('moveIntent', { x: claimed, z: 0 });
    }

    // 1e-9 slack: ten clamped steps accumulate float addition, and 94.500…01
    // vs 94.5 is one ulp of drift, not a containment failure.
    const maxLegal = 10 * MOVE_LIMITS.maxSpeedMps * MOVE_LIMITS.toleranceMult;
    expect(world.store.get('player').x).toBeLessThanOrEqual(maxLegal + 1e-9);
    // And client/server still agree on where the cheater actually is.
    expect(world.store.get('player').x).toBe(world.transport._db.get('player', 'hero').x);
  });
});
