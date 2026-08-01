import { describe, expect, it, vi } from 'vitest';
import { createDispatcher } from './dispatch.js';
import { REJECT, ack, nack } from './WorldTransport.js';
import { createRealmStore } from './RealmStore.js';

/** A transport whose answers are scripted per test. */
function stubTransport(sendImpl) {
  return {
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    send: sendImpl,
    subscribe: () => () => {},
  };
}

const COMMANDS = {
  ping: {},
  guarded: {
    validate: (p) => (p.allowed ? null : REJECT.INVALID_PAYLOAD),
  },
  optimistic: {
    predict: (p, store) => {
      const before = store.get('player').hp;
      store.update('player', { hp: before - p.cost });
      return () => store.update('player', { hp: before });
    },
  },
};

const newStore = () => createRealmStore({ player: { hp: 100 } });

describe('createDispatcher', () => {
  it('rejects a transport missing methods at construction', () => {
    expect(() => createDispatcher({ store: newStore(), transport: {}, commands: COMMANDS }))
      .toThrow(/missing/);
  });

  it('requires a command registry', () => {
    expect(() => createDispatcher({ store: newStore(), transport: stubTransport(async () => {}), commands: null }))
      .toThrow(/command registry/);
  });
});

describe('dispatch flow', () => {
  it('sends and settles an acked command', async () => {
    const send = vi.fn(async (type, payload, seq) => ack(seq, { pong: true }));
    const d = createDispatcher({ store: newStore(), transport: stubTransport(send), commands: COMMANDS });

    const r = await d.dispatch('ping');

    expect(r).toEqual({ ok: true, seq: 1, code: null, data: { pong: true } });
    expect(send).toHaveBeenCalledWith('ping', {}, 1);
    expect(d.pendingCount()).toBe(0);
  });

  it('numbers commands monotonically — dispatch owns seq', async () => {
    const seqs = [];
    const d = createDispatcher({
      store: newStore(),
      transport: stubTransport(async (t, p, seq) => { seqs.push(seq); return ack(seq); }),
      commands: COMMANDS,
    });

    await d.dispatch('ping');
    await d.dispatch('ping');
    await d.dispatch('ping');

    expect(seqs).toEqual([1, 2, 3]);
  });

  it('refuses an unknown command without touching the wire', async () => {
    const send = vi.fn();
    const d = createDispatcher({ store: newStore(), transport: stubTransport(send), commands: COMMANDS });

    const r = await d.dispatch('nonsense');

    expect(r.code).toBe(REJECT.UNKNOWN_COMMAND);
    expect(send).not.toHaveBeenCalled();
  });

  it('local validation rejects before send — free UX, nothing on the wire', async () => {
    const send = vi.fn(async (type, payload, seq) => ack(seq));
    const d = createDispatcher({ store: newStore(), transport: stubTransport(send), commands: COMMANDS });

    const r = await d.dispatch('guarded', { allowed: false });

    expect(r.code).toBe(REJECT.INVALID_PAYLOAD);
    expect(send).not.toHaveBeenCalled();

    // And validation passing goes through to the wire.
    const ok = await d.dispatch('guarded', { allowed: true });
    expect(ok.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('settles a contract-violating transport result as INTERNAL, not a crash', async () => {
    // Writing this test with a bare vi.fn() (which resolves undefined) crashed
    // dispatch on `result.code` — a stranded prediction and an exception where
    // the caller expected an answer. Pinned so the malformed-result branch stays.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = newStore();
    const d = createDispatcher({
      store,
      transport: stubTransport(async () => undefined),
      commands: COMMANDS,
    });

    const r = await d.dispatch('optimistic', { cost: 25 });

    expect(r.ok).toBe(false);
    expect(r.code).toBe(REJECT.INTERNAL);
    // The prediction was rolled back, not stranded.
    expect(store.get('player').hp).toBe(100);
    expect(d.pendingCount()).toBe(0);
    err.mockRestore();
  });
});

describe('prediction and rollback', () => {
  it('applies optimism immediately and keeps it on ack', async () => {
    const store = newStore();
    const d = createDispatcher({
      store,
      transport: stubTransport(async (t, p, seq) => ack(seq)),
      commands: COMMANDS,
    });

    const promise = d.dispatch('optimistic', { cost: 30 });
    // Before the transport settles, the player already sees the result.
    expect(store.get('player').hp).toBe(70);

    await promise;
    expect(store.get('player').hp).toBe(70);
    expect(d.pendingCount()).toBe(0);
  });

  it('rolls the prediction back on nack', async () => {
    const store = newStore();
    const d = createDispatcher({
      store,
      transport: stubTransport(async (t, p, seq) => nack(seq, REJECT.INSUFFICIENT_RESOURCE, 'oom')),
      commands: COMMANDS,
    });

    const r = await d.dispatch('optimistic', { cost: 30 });

    expect(r.ok).toBe(false);
    expect(r.code).toBe(REJECT.INSUFFICIENT_RESOURCE);
    expect(store.get('player').hp).toBe(100);
  });

  it('rolls back on a transport THROW, with a distinct code', async () => {
    // A throw is plumbing failure, not a gameplay refusal — the caller may want
    // to retry a THROW but should never retry an ON_COOLDOWN.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = newStore();
    const d = createDispatcher({
      store,
      transport: stubTransport(async () => { throw new Error('socket died'); }),
      commands: COMMANDS,
    });

    const r = await d.dispatch('optimistic', { cost: 10 });

    expect(r.code).toBe(REJECT.INTERNAL);
    expect(store.get('player').hp).toBe(100);
    expect(d.pendingCount()).toBe(0);
    err.mockRestore();
  });

  it('a failed prediction takes later optimism down with it', async () => {
    // Command A fails after command B predicted on top of A's optimistic state.
    // B's optimism is built on a lie, so settling A must unwind B too — in
    // reverse order, so each undo sees the state its prediction produced.
    const store = newStore();
    let resolveA;
    const answers = {
      1: new Promise((res) => { resolveA = res; }),
      2: Promise.resolve(ack(2)),
    };
    const d = createDispatcher({
      store,
      transport: stubTransport((t, p, seq) => answers[seq]),
      commands: COMMANDS,
    });

    const a = d.dispatch('optimistic', { cost: 30 }); // hp 100 -> 70
    const b = d.dispatch('optimistic', { cost: 20 }); // hp 70 -> 50
    expect(store.get('player').hp).toBe(50);

    resolveA(nack(1, REJECT.ON_COOLDOWN, 'nope'));
    await a;
    await b;

    // A's rollback swept B's prediction with it (B settled after, ack arrives
    // for a prediction that was already unwound — pending is empty, no undo).
    expect(store.get('player').hp).toBe(100);
    expect(d.pendingCount()).toBe(0);
  });

  it('ack-after-cascade: ok means server-accepted, optimism is NOT re-applied', async () => {
    // The documented settle contract, pinned so it cannot drift silently:
    // A nacks first and its rollback sweeps B's prediction; B's ack then
    // arrives for a prediction that no longer exists. B still reports ok:true
    // (the server DID accept it) and dispatch does not re-apply B's optimism —
    // the store converges to server truth via the event stream instead. If
    // P12's real-latency transport makes this too lossy, the alternative is
    // seq-ordered settling; changing THIS test is that decision being made.
    const store = newStore();
    let resolveA, resolveB;
    const answers = {
      1: new Promise((res) => { resolveA = res; }),
      2: new Promise((res) => { resolveB = res; }),
    };
    const d = createDispatcher({
      store,
      transport: stubTransport((t, p, seq) => answers[seq]),
      commands: COMMANDS,
    });

    const a = d.dispatch('optimistic', { cost: 30 }); // hp 100 -> 70
    const b = d.dispatch('optimistic', { cost: 20 }); // hp 70 -> 50

    resolveA(nack(1, REJECT.ON_COOLDOWN, 'nope'));
    await a;
    expect(store.get('player').hp).toBe(100); // sweep took B's optimism too

    resolveB(ack(2));
    const rb = await b;

    expect(rb.ok).toBe(true); // the server accepted B...
    expect(store.get('player').hp).toBe(100); // ...and optimism stays gone, by contract
    expect(d.pendingCount()).toBe(0);
  });

  it('exposes the oldest pending seq for the reconciler', async () => {
    const store = newStore();
    let release;
    const d = createDispatcher({
      store,
      transport: stubTransport((t, p, seq) => new Promise((res) => { release = () => res(ack(seq)); })),
      commands: COMMANDS,
    });

    expect(d.oldestPendingSeq()).toBeNull();
    const p = d.dispatch('ping');
    expect(d.oldestPendingSeq()).toBe(1);

    release();
    await p;
    expect(d.oldestPendingSeq()).toBeNull();
  });
});
