/**
 * dispatch — the single path every player action takes.
 *
 * PURE. validate → predict → send → settle:
 *
 *   validate  reject locally what the server would certainly reject — free UX,
 *             and it keeps garbage off the wire.
 *   predict   apply the optimistic result to the store immediately, so the
 *             player never waits an RTT to see their own action.
 *   send      hand the command to whichever WorldTransport is installed.
 *   settle    on ack, confirm; on nack, roll the prediction back and record why.
 *
 * This module owns `seq`. Commands are numbered here and nowhere else, so the
 * transport, the reconciler and the store all agree on what "up to seq N" means.
 *
 * ─── Settle semantics under latency (the contract, stated plainly) ───────────
 * `ok: true` means THE SERVER ACCEPTED THE COMMAND. It does not promise the
 * local optimism is still applied. With delayed, out-of-order settles, a nacked
 * command's rollback sweeps every LATER prediction with it (they were built on
 * its state); if one of those later commands then acks, its optimistic effect
 * is already gone and dispatch does not re-apply it. The store converges to
 * server truth through the event stream (ENTITY_UPSERT / RECONCILE), which is
 * authoritative regardless of what optimism did. Consumers must treat events
 * as truth and `ok` as "the server said yes", nothing more.
 *
 * This is safe today because events carry full authoritative rows. If P12's
 * SpacetimeTransport surfaces real reordering and the sweep proves too lossy in
 * practice, the alternative is settling strictly in seq order (buffering acks
 * until the oldest pending settles) — a deliberate decision for then, recorded
 * here so it is not rediscovered as a bug.
 *
 * A command definition is data, not a subclass:
 *   { validate?(payload, store) -> string|null,   // REJECT code or ok
 *     predict?(payload, store)  -> undo|null }    // apply optimism, return undo
 */

import { REJECT, isAck, isNack, assertTransport } from './WorldTransport.js';

export function createDispatcher({ store, transport, commands }) {
  assertTransport(transport, 'dispatch transport');
  if (!commands || typeof commands !== 'object') {
    throw new Error('[dispatch] a command registry is required');
  }

  let seq = 0;
  /** Predictions not yet settled, in send order: { seq, undo }. */
  const pending = [];

  function rollbackFrom(failedSeq) {
    // Roll back the failed prediction AND everything predicted after it —
    // later optimism may have been built on the failed state. Undo in reverse
    // order so each undo sees the world its prediction produced.
    const idx = pending.findIndex((p) => p.seq === failedSeq);
    if (idx === -1) return;
    const toUndo = pending.splice(idx);
    for (let i = toUndo.length - 1; i >= 0; i--) toUndo[i].undo?.();
  }

  return {
    /**
     * @returns {Promise<{ok: boolean, seq: number, code: string|null, data: object|null}>}
     *   Never throws for gameplay outcomes — a refusal is a value, not an
     *   exception, because "out of range" is not exceptional.
     */
    async dispatch(type, payload = {}) {
      const def = commands[type];
      if (!def) {
        return { ok: false, seq: -1, code: REJECT.UNKNOWN_COMMAND, data: null };
      }

      // validate — cheap, local, uses only store state.
      const rejection = def.validate?.(payload, store) ?? null;
      if (rejection) {
        return { ok: false, seq: -1, code: rejection, data: null };
      }

      const mySeq = ++seq;

      // predict — optimistic apply; keep the undo for settle.
      const undo = def.predict?.(payload, store) ?? null;
      pending.push({ seq: mySeq, undo });

      // send — the transport decides what the server actually says.
      let result;
      try {
        result = await transport.send(type, payload, mySeq);
      } catch (err) {
        // A transport THROW is plumbing failure, not a gameplay refusal.
        // Same rollback path, distinct code so callers can tell them apart.
        console.error(`[dispatch] transport threw on "${type}":`, err);
        rollbackFrom(mySeq);
        return { ok: false, seq: mySeq, code: REJECT.INTERNAL, data: null };
      }

      // settle
      if (isAck(result)) {
        const idx = pending.findIndex((p) => p.seq === mySeq);
        if (idx !== -1) pending.splice(idx, 1);
        return { ok: true, seq: mySeq, code: null, data: result.data };
      }

      rollbackFrom(mySeq);
      if (!isNack(result)) {
        // Contract violation: the transport resolved with something that is
        // neither ack nor nack (undefined, a bare object...). Without this
        // branch, reading `result.code` throws and the prediction above would
        // be stranded — rolled back, but the caller gets an exception instead
        // of an answer. Same INTERNAL code as a throw: both are plumbing bugs.
        console.error(`[dispatch] transport returned a malformed result for "${type}":`, result);
        return { ok: false, seq: mySeq, code: REJECT.INTERNAL, data: null };
      }
      return { ok: false, seq: mySeq, code: result.code, data: null };
    },

    /** Oldest unsettled seq, or null. The reconciler anchors on this. */
    oldestPendingSeq: () => (pending.length ? pending[0].seq : null),
    pendingCount: () => pending.length,
  };
}
