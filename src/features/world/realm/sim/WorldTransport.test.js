import { describe, expect, it } from 'vitest';
import {
  EVENT,
  REJECT,
  TRANSPORT_METHODS,
  ack,
  assertTransport,
  isAck,
  isNack,
  nack,
} from './WorldTransport.js';

describe('ack', () => {
  it('echoes the seq it answers', () => {
    // Reconciliation has nothing to anchor on without this: the client discards
    // its prediction up to the acked seq.
    const r = ack(42, { x: 1 });
    expect(r).toEqual({ ok: true, seq: 42, data: { x: 1 }, code: null, message: null });
  });

  it('defaults data to null rather than undefined', () => {
    // undefined vanishes through JSON; null survives, so the shape a transport
    // delivers matches the shape it was given.
    expect(ack(1).data).toBeNull();
  });
});

describe('nack', () => {
  it('carries a code and message', () => {
    const r = nack(7, REJECT.ON_COOLDOWN, 'still cooling');
    expect(r).toEqual({
      ok: false, seq: 7, data: null, code: REJECT.ON_COOLDOWN, message: 'still cooling',
    });
  });

  it('throws on an unknown reject code', () => {
    // Caught at the point of construction rather than at the branch that fails
    // to match it. A typo'd code would otherwise fall through every `switch`
    // and surface as a command that silently does nothing.
    expect(() => nack(1, 'made_up_code')).toThrow(/unknown reject code/);
    expect(() => nack(1, undefined)).toThrow(/unknown reject code/);
  });

  it('accepts every declared REJECT value', () => {
    for (const code of Object.values(REJECT)) {
      expect(() => nack(1, code)).not.toThrow();
    }
  });
});

describe('isAck / isNack', () => {
  it('discriminates the two result shapes', () => {
    expect(isAck(ack(1))).toBe(true);
    expect(isNack(ack(1))).toBe(false);
    expect(isAck(nack(1, REJECT.NOT_FOUND))).toBe(false);
    expect(isNack(nack(1, REJECT.NOT_FOUND))).toBe(true);
  });

  it('is safe on null and undefined', () => {
    // A transport that resolves with nothing must not crash the caller's branch.
    for (const bad of [null, undefined, 0, '']) {
      expect(isAck(bad)).toBe(false);
      expect(isNack(bad)).toBe(false);
    }
  });
});

describe('assertTransport', () => {
  const complete = Object.fromEntries(TRANSPORT_METHODS.map((m) => [m, () => {}]));

  it('accepts a complete transport and returns it', () => {
    expect(assertTransport(complete)).toBe(complete);
  });

  it('names every missing method at once', () => {
    // JS has no interfaces, so a half-implemented transport otherwise fails on
    // the one command nobody exercised, mid-session. Listing all gaps at once
    // beats fixing them one crash at a time.
    const partial = { connect: () => {}, send: () => {} };
    expect(() => assertTransport(partial, 'LocalTransport')).toThrow(
      /LocalTransport is missing: disconnect, isConnected, subscribe/,
    );
  });

  it('rejects a non-function property masquerading as a method', () => {
    expect(() => assertTransport({ ...complete, send: 'nope' })).toThrow(/missing: send/);
  });

  it('rejects null and undefined without throwing the wrong error', () => {
    expect(() => assertTransport(null)).toThrow(/is missing/);
    expect(() => assertTransport(undefined)).toThrow(/is missing/);
  });
});

describe('contract constants', () => {
  it('exposes the event kinds the store consumes', () => {
    expect(Object.values(EVENT)).toEqual([
      'entity_upsert', 'entity_remove', 'reconcile', 'connection',
    ]);
  });

  it('freezes the enums so a consumer cannot mutate them', () => {
    expect(Object.isFrozen(REJECT)).toBe(true);
    expect(Object.isFrozen(EVENT)).toBe(true);
    expect(Object.isFrozen(TRANSPORT_METHODS)).toBe(true);
  });
});
