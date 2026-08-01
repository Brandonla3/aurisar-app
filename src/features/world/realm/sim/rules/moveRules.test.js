import { describe, expect, it } from 'vitest';
import { MOVE_LIMITS, MOVE_VERDICT, resolveMove } from './moveRules.js';

const at = (x, z) => ({ x, z });

describe('resolveMove', () => {
  it('accepts a walk within the speed budget', () => {
    // 1m in 250ms = 4 m/s, under the 7 m/s cap.
    const r = resolveMove(at(0, 0), at(1, 0), 250);
    expect(r.accepted).toBe(true);
    expect(r.verdict).toBe(MOVE_VERDICT.ACCEPTED);
    expect(r.x).toBe(1);
  });

  it('accepts standing still', () => {
    const r = resolveMove(at(5, 5), at(5, 5), 16);
    expect(r.accepted).toBe(true);
    expect(r).toMatchObject({ x: 5, z: 5 });
  });

  it('allows tolerance headroom above the raw cap', () => {
    // Exactly at maxSpeed over 1s would be 7m; tolerance permits up to 9.45m.
    // An honest client whose frame arrived late must not be treated as cheating.
    expect(resolveMove(at(0, 0), at(9, 0), 1000).accepted).toBe(true);
    expect(resolveMove(at(0, 0), at(9.9, 0), 1000).accepted).toBe(false);
  });

  it('clamps an impossible jump but keeps the direction', () => {
    // Rubber-banding back to `from` would fight a laggy player; clamping along
    // their own heading lets them keep going, just slower.
    const r = resolveMove(at(0, 0), at(100, 0), 100);
    expect(r.accepted).toBe(false);
    expect(r.verdict).toBe(MOVE_VERDICT.CLAMPED_SPEED);
    expect(r.z).toBe(0);
    expect(r.x).toBeGreaterThan(0);
    expect(r.x).toBeLessThan(100);
  });

  it('preserves the heading of a diagonal claim when clamping', () => {
    const r = resolveMove(at(0, 0), at(100, 100), 100);
    expect(r.accepted).toBe(false);
    // Same 45-degree bearing, shorter distance.
    expect(r.x).toBeCloseTo(r.z, 10);
  });

  it('bounds a forged dt to one second of movement', () => {
    // The forged-dt teleport: claim ten minutes elapsed and walk across the map.
    // The dt clamp — not maxStepM — is what stops this at the default limits.
    const r = resolveMove(at(0, 0), at(5000, 0), 10 * 60 * 1000);
    expect(r.accepted).toBe(false);
    expect(r.verdict).toBe(MOVE_VERDICT.CLAMPED_SPEED);

    const oneSecondBudget =
      (MOVE_LIMITS.maxSpeedMps * MOVE_LIMITS.toleranceMult * MOVE_LIMITS.maxDtMs) / 1000;
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(oneSecondBudget, 6);
  });

  it('maxStepM does not bind at the default limits', () => {
    // Documents that the knob is currently inactive, so nobody reads it as the
    // thing providing protection. 9.45m speed budget < 12m step cap.
    const speedBudget =
      (MOVE_LIMITS.maxSpeedMps * MOVE_LIMITS.toleranceMult * MOVE_LIMITS.maxDtMs) / 1000;
    expect(speedBudget).toBeLessThan(MOVE_LIMITS.maxStepM);
  });

  it('maxStepM binds once dt tolerance is widened', () => {
    // The backstop's reason to exist: raising maxDtMs for mobile background
    // stalls would otherwise permit a 47m jump at 5s.
    const relaxed = { ...MOVE_LIMITS, maxDtMs: 5000 };
    const r = resolveMove(at(0, 0), at(5000, 0), 5000, relaxed);
    expect(r.verdict).toBe(MOVE_VERDICT.CLAMPED_STEP);
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(relaxed.maxStepM, 6);
  });

  it('clamps dt rather than trusting it', () => {
    // Negative or zero dt would otherwise produce a zero/negative budget and
    // reject every honest move.
    const r = resolveMove(at(0, 0), at(0.005, 0), -5000);
    expect(r.accepted).toBe(true);
  });

  it('rejects non-finite positions instead of storing NaN', () => {
    // NaN compares false against everything, so without an explicit guard a
    // single bad packet parks the player at NaN silently and forever.
    for (const bad of [NaN, Infinity, undefined, null, '3']) {
      const r = resolveMove(at(1, 2), { x: bad, z: 0 }, 16);
      expect(r.accepted).toBe(false);
      expect(r.verdict).toBe(MOVE_VERDICT.REJECTED_NAN);
      // Falls back to the last known-good position.
      expect(r.x).toBe(1);
      expect(r.z).toBe(2);
    }
  });

  it('survives a missing origin without throwing', () => {
    const r = resolveMove(undefined, at(1, 1), 16);
    expect(r.accepted).toBe(false);
    expect(Number.isFinite(r.x)).toBe(true);
  });

  it('always returns an authoritative position, accepted or not', () => {
    // Callers write r.x/r.z back unconditionally; every path must supply them.
    for (const [from, to, dt] of [
      [at(0, 0), at(1, 0), 250],
      [at(0, 0), at(999, 0), 16],
      [at(0, 0), { x: NaN, z: 0 }, 16],
    ]) {
      const r = resolveMove(from, to, dt);
      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.z)).toBe(true);
    }
  });

  it('is deterministic — same inputs, same verdict', () => {
    // No clock, no randomness: this is what lets the reducer and LocalTransport
    // stay in agreement.
    const a = resolveMove(at(0, 0), at(50, 12), 200);
    const b = resolveMove(at(0, 0), at(50, 12), 200);
    expect(a).toEqual(b);
  });
});
