/**
 * WorldTransport — the seam between the Realm's simulation and any server.
 *
 * PURE. This module is the contract only: an enum, two constructors, and a
 * JSDoc-typed interface. It imports nothing.
 *
 * ─── This is where "connect to the server" lives ──────────────────────────────
 * The original brief asked for state handlers with explicit
 * `// TODO: Connect to WebSocket server` hooks. Those hooks are this interface.
 * There is no TODO to fill in later: every command already flows through
 * `send()`, and swapping which implementation is installed is the entire
 * difference between offline and online. SpacetimeDB is the production
 * implementation; `LocalTransport` runs the same authoritative logic in-process
 * for tests, for the no-auth dev viewer, and when the connection drops.
 *
 * Two implementations must satisfy this contract identically. The conformance
 * suite runs against both — if a behaviour is only asserted for one, it will
 * drift, and drift here means "works offline, breaks in production".
 */

/**
 * Why a command was refused. A string enum rather than numbers so a rejection
 * is readable in a log without a lookup table.
 */
export const REJECT = Object.freeze({
  NOT_CONNECTED: 'not_connected',
  UNKNOWN_COMMAND: 'unknown_command',
  RATE_LIMITED: 'rate_limited',
  INVALID_PAYLOAD: 'invalid_payload',
  INVALID_TARGET: 'invalid_target',
  OUT_OF_RANGE: 'out_of_range',
  INSUFFICIENT_RESOURCE: 'insufficient_resource',
  ON_COOLDOWN: 'on_cooldown',
  NOT_FOUND: 'not_found',
  INTERNAL: 'internal',
});

const REJECT_CODES = new Set(Object.values(REJECT));

/**
 * An accepted command.
 * @param {number} seq  the client sequence this answers — the client discards
 *   its prediction up to here. Every ack MUST echo the seq it responds to, or
 *   reconciliation has nothing to anchor on.
 */
export function ack(seq, data = null) {
  return { ok: true, seq, data, code: null, message: null };
}

/** A refused command. `code` must be a REJECT value so callers can branch. */
export function nack(seq, code, message = '') {
  if (!REJECT_CODES.has(code)) {
    throw new Error(`[WorldTransport] unknown reject code "${code}"`);
  }
  return { ok: false, seq, data: null, code, message };
}

export const isAck = (r) => !!r && r.ok === true;
export const isNack = (r) => !!r && r.ok === false;

/**
 * Server→client event kinds. The client never invents these; they arrive
 * through `subscribe()` and are the only way remote state enters the store.
 */
export const EVENT = Object.freeze({
  /** Authoritative state for one entity. Payload: { id, ...fields } */
  ENTITY_UPSERT: 'entity_upsert',
  /** An entity left interest range or died. Payload: { id } */
  ENTITY_REMOVE: 'entity_remove',
  /** Correction for the local player. Payload: { seq, x, z, yaw } */
  RECONCILE: 'reconcile',
  /** Connection state moved. Payload: { connected, reason } */
  CONNECTION: 'connection',
});

/**
 * The interface every transport implements.
 *
 * @typedef {object} WorldTransport
 * @property {(identity: string) => Promise<void>} connect
 * @property {() => Promise<void>} disconnect
 * @property {() => boolean} isConnected
 * @property {(command: string, payload: object, seq: number) => Promise<Ack>} send
 *   Never throws for an expected refusal — returns a nack. Throwing is reserved
 *   for programmer error (unknown command shape, contract violation).
 * @property {(handler: (kind: string, payload: object) => void) => () => void} subscribe
 *   Returns an unsubscribe function.
 */

/**
 * Runtime check that an object satisfies the interface.
 *
 * JS has no interfaces, and a transport with a missing method fails at the
 * worst possible moment — mid-session, on the one command nobody tested.
 * Cheap to assert at construction instead.
 */
export const TRANSPORT_METHODS = Object.freeze([
  'connect', 'disconnect', 'isConnected', 'send', 'subscribe',
]);

export function assertTransport(t, label = 'transport') {
  const missing = TRANSPORT_METHODS.filter((m) => typeof t?.[m] !== 'function');
  if (missing.length) {
    throw new Error(`[WorldTransport] ${label} is missing: ${missing.join(', ')}`);
  }
  return t;
}
