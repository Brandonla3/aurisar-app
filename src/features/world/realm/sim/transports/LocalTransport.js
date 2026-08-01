/**
 * LocalTransport — the authoritative world, running in-process.
 *
 * PURE (no BABYLON, no DOM, no network). Implements the WorldTransport contract
 * against a memoryDb instead of a server.
 *
 * This is NOT a mock. The gameplay decisions live in shared rules modules
 * (rules/moveRules.js today; combat/resources later), and this transport calls
 * exactly the code the SpacetimeDB reducer will call. What is faked is only the
 * plumbing: no socket, no auth, no latency unless injected. That is what lets
 * offline dev, unit tests and the no-auth viewer exercise real behaviour
 * instead of a copy that drifts.
 *
 * Time is injected (`now`) rather than read from Date.now(), so tests are
 * deterministic and a forged-dt scenario is expressible.
 */

import {
  EVENT,
  REJECT,
  ack,
  nack,
} from '../WorldTransport.js';
import { createMemoryDb } from './memoryDb.js';
import { resolveMove, MOVE_LIMITS } from '../rules/moveRules.js';
import { packId } from '../InputSnapshot.js';

export const TABLES = Object.freeze(['player', 'mob']);

/** Where a fresh player stands. Provisional until worldgen lands in P2. */
const SPAWN = Object.freeze({ x: 0, z: 0, yaw: 0 });
const PLAYER_MAX_HP = 100;

export function createLocalTransport({ now = () => 0 } = {}) {
  const db = createMemoryDb(TABLES);
  const subscribers = new Set();
  let identity = null;
  let connected = false;
  let lastMoveAtMs = null;

  function emit(kind, payload) {
    for (const fn of [...subscribers]) {
      try {
        fn(kind, payload);
      } catch (err) {
        console.error('[LocalTransport] subscriber threw:', err);
      }
    }
  }

  /** Public row shape — a copy, never the live reference. */
  const playerView = (row) => ({ ...row });

  const commands = {
    /**
     * moveIntent — the client's claimed position for `seq`.
     * Mirrors what the SpacetimeDB movePlayer reducer will do: resolve via the
     * shared rules, write the verdict, and emit a RECONCILE only when clamped —
     * an accepted move needs no correction.
     */
    moveIntent(payload, seq) {
      const me = db.get('player', identity);
      if (!me) return nack(seq, REJECT.NOT_FOUND, 'player not spawned');

      const tMs = now();
      const dtMs = lastMoveAtMs == null ? MOVE_LIMITS.maxDtMs : tMs - lastMoveAtMs;
      const r = resolveMove(me, { x: payload?.x, z: payload?.z }, dtMs);

      if (r.verdict === 'rejected_nan') {
        return nack(seq, REJECT.INVALID_PAYLOAD, 'non-finite position');
      }

      lastMoveAtMs = tMs;
      const yaw = Number.isFinite(payload?.yaw) ? payload.yaw : me.yaw;
      const updated = db.upsert('player', identity, { x: r.x, z: r.z, yaw });

      emit(EVENT.ENTITY_UPSERT, playerView(updated));
      if (!r.accepted) {
        emit(EVENT.RECONCILE, { seq, x: r.x, z: r.z, yaw });
      }
      return ack(seq, { x: r.x, z: r.z, accepted: r.accepted });
    },

    /** setTarget — validated identity write, mirrored to interested clients. */
    setTarget(payload, seq) {
      const me = db.get('player', identity);
      if (!me) return nack(seq, REJECT.NOT_FOUND, 'player not spawned');

      const targetId = payload?.targetId == null ? null : packId(payload.targetId);
      if (targetId !== null && !db.has('mob', targetId)) {
        return nack(seq, REJECT.INVALID_TARGET, `no such mob ${targetId}`);
      }
      const updated = db.upsert('player', identity, { targetId });
      emit(EVENT.ENTITY_UPSERT, playerView(updated));
      return ack(seq, { targetId });
    },
  };

  return {
    async connect(id) {
      if (id == null || id === '') throw new Error('[LocalTransport] identity required');
      identity = packId(id);
      connected = true;
      lastMoveAtMs = null;

      // Spawn (or resume) the player — same row shape the reducer will keep.
      const existing = db.get('player', identity);
      const row = existing ?? db.upsert('player', identity, {
        ...SPAWN, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, targetId: null,
      });

      emit(EVENT.CONNECTION, { connected: true, reason: 'local' });
      emit(EVENT.ENTITY_UPSERT, playerView(row));
    },

    async disconnect() {
      connected = false;
      emit(EVENT.CONNECTION, { connected: false, reason: 'local-disconnect' });
    },

    isConnected: () => connected,

    async send(command, payload, seq) {
      if (!connected) return nack(seq, REJECT.NOT_CONNECTED, 'not connected');
      const handler = commands[command];
      if (!handler) return nack(seq, REJECT.UNKNOWN_COMMAND, `no command "${command}"`);
      return handler(payload, seq);
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    // ── Test/dev-only surface, deliberately outside the WorldTransport contract.
    /** Seed a mob so targeting has something to hit. */
    _seedMob(id, row = {}) {
      return db.upsert('mob', id, { hp: 50, maxHp: 50, x: 5, z: 5, ...row });
    },
    _db: db,
  };
}
