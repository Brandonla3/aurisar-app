/**
 * When the client calls movePlayer — including the case that motivated it:
 * the server's move guard clamped our claim, and we stopped walking.
 */
import { describe, expect, it } from 'vitest';
import {
  shouldSendMove,
  MOVE_SEND_INTERVAL_MS,
  MOVE_SEND_DEADBAND_M,
  MOVE_RECONCILE_INTERVAL_MS,
  MOVE_RECONCILE_DEADBAND_PX,
} from '../game/moveSync.js';

/** Standing still, converged with the server, alive. */
const idle = {
  sinceLastSendMs: MOVE_RECONCILE_INTERVAL_MS,
  movedM: 0,
  isMoving: false,
  wasMoving: false,
  serverOffsetPx: 0,
  alive: true,
};

describe('shouldSendMove', () => {
  it('stays silent when nothing changed', () => {
    expect(shouldSendMove(idle)).toBe(false);
  });

  it('holds the rate floor even with a big move pending', () => {
    expect(shouldSendMove({
      ...idle, sinceLastSendMs: MOVE_SEND_INTERVAL_MS - 1, movedM: 50,
    })).toBe(false);
  });

  it('sends once walking clears the dead-band', () => {
    expect(shouldSendMove({
      ...idle, sinceLastSendMs: MOVE_SEND_INTERVAL_MS,
      movedM: MOVE_SEND_DEADBAND_M + 0.01, isMoving: true,
    })).toBe(true);
  });

  it('sends on an isMoving flip even without displacement', () => {
    // Stopping must reach the server or remote avatars keep walking in place.
    expect(shouldSendMove({ ...idle, isMoving: false, wasMoving: true })).toBe(true);
  });
});

describe('re-sending after the server clamped us', () => {
  // The regression this guards: the player outruns the ceiling during a
  // network stall, the server stores a clamped position, and the player STOPS.
  // Nothing local changes from then on, so without the reconcile term the row
  // would sit metres behind the avatar and every server-side proximity check
  // (chests, vendors, NPCs, melee) would read the stale spot indefinitely.
  const strandedAfterStop = {
    ...idle,
    movedM: 0,          // stopped — no local change will ever fire a send
    isMoving: false,
    wasMoving: false,
    serverOffsetPx: 40 * 32,   // server is 40 m behind the claim
  };

  it('keeps sending while the row is behind, though nothing local changed', () => {
    expect(shouldSendMove(strandedAfterStop)).toBe(true);
  });

  it('stops as soon as the row catches up', () => {
    expect(shouldSendMove({ ...strandedAfterStop, serverOffsetPx: 0 })).toBe(false);
  });

  it('ignores sub-dead-band disagreement so idle players stay silent', () => {
    // f32 rounding on the stored row must not turn every idle tick into a call.
    expect(shouldSendMove({
      ...strandedAfterStop, serverOffsetPx: MOVE_RECONCILE_DEADBAND_PX,
    })).toBe(false);
  });

  it('re-sends at the slower reconcile cadence, not the live rate', () => {
    // A longer gap earns a bigger allowance from the guard, so convergence
    // costs about the same either way — and a wedged state cannot spam.
    expect(shouldSendMove({
      ...strandedAfterStop, sinceLastSendMs: MOVE_RECONCILE_INTERVAL_MS - 1,
    })).toBe(false);
    expect(shouldSendMove({
      ...strandedAfterStop, sinceLastSendMs: MOVE_RECONCILE_INTERVAL_MS,
    })).toBe(true);
  });

  it('never retries while dead', () => {
    // movePlayer returns early for dead players, so a retry could not converge
    // and would spin at the reconcile rate until respawn.
    expect(shouldSendMove({ ...strandedAfterStop, alive: false })).toBe(false);
  });

  it('still sends immediately when the player walks again', () => {
    // Walking outranks the reconcile cadence — catch-up must not wait 500 ms.
    expect(shouldSendMove({
      ...strandedAfterStop,
      sinceLastSendMs: MOVE_SEND_INTERVAL_MS,
      movedM: 1, isMoving: true,
    })).toBe(true);
  });
});
