/**
 * The server's movement speed ceiling (review H7).
 *
 * `movePlayer` is client-authoritative about position, and every server-side
 * proximity gate reads that row, so the ceiling is what stops "I am standing
 * at the treasury chest" from being a free assertion. Pure arithmetic, so it
 * tests directly — no reducer harness needed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clampMoveToMaxSpeed,
  MAX_MOVE_SPEED_MPS,
  MOVE_JITTER_GRACE_M,
  MOVE_MAX_CREDIT_MICROS,
} from '../../../../spacetimedb/src/world/moveGuard.ts';

const PX_PER_M = 32;
const repoRoot = join(import.meta.dirname, '../../../..');

/** The server's own move-rate floor — the shortest gap it will ever see. */
const FLOOR_MICROS = 40_000n;

describe('clampMoveToMaxSpeed', () => {
  it('leaves an ordinary step untouched', () => {
    // 80 ms of walking at full tilt is 0.96 m — well inside the allowance.
    const step = 0.96 * PX_PER_M;
    const r = clampMoveToMaxSpeed(0, 0, step, 0, 80_000n);
    expect(r.clamped).toBe(false);
    expect(r.x).toBe(step);
    expect(r.y).toBe(0);
  });

  it('cuts a teleport back to the allowance, keeping the direction', () => {
    // The exploit this exists for: a claim 400 m away in one call.
    const r = clampMoveToMaxSpeed(0, 0, 400 * PX_PER_M, 0, FLOOR_MICROS);
    expect(r.clamped).toBe(true);
    // 12 m/s for 40 ms = 0.48 m, plus the 0.75 m jitter grace.
    expect(r.x / PX_PER_M).toBeCloseTo(12 * 0.04 + MOVE_JITTER_GRACE_M, 6);
    expect(r.y).toBe(0);
  });

  it('clamps along the claimed heading rather than snapping to an axis', () => {
    // Diagonal claim: the clamped point must stay on the same ray, or the
    // player would be dragged sideways into geometry they never walked at.
    const far = 300 * PX_PER_M;
    const r = clampMoveToMaxSpeed(100, 100, 100 + far, 100 + far * 2, 100_000n);
    expect(r.clamped).toBe(true);
    expect((r.y - 100) / (r.x - 100)).toBeCloseTo(2, 9);
  });

  it('never rejects — a clamped move still advances the row', () => {
    // The whole reason this clamps instead of returning: a stalled client must
    // still make progress, or it desyncs permanently.
    const prev = { x: 500, y: 500 };
    const r = clampMoveToMaxSpeed(prev.x, prev.y, 90_000, 500, FLOOR_MICROS);
    expect(r.x).toBeGreaterThan(prev.x);
    expect(Math.hypot(r.x - prev.x, r.y - prev.y)).toBeGreaterThan(0);
  });

  it('caps the budget so idling does not bank a teleport', () => {
    // An hour of standing still must not buy a cross-map jump: the allowance
    // saturates at MOVE_MAX_CREDIT_MICROS.
    const hour = 3_600_000_000n;
    const far = 5_000 * PX_PER_M;
    const idled = clampMoveToMaxSpeed(0, 0, far, 0, hour);
    const capped = clampMoveToMaxSpeed(0, 0, far, 0, MOVE_MAX_CREDIT_MICROS);
    expect(idled.clamped).toBe(true);
    expect(idled.x).toBeCloseTo(capped.x, 6);
    // 3 s of credit is 36 m, plus grace — bounded well short of the 520 m disc.
    expect(idled.x / PX_PER_M).toBeLessThan(40);
  });

  it('absorbs a stall burst instead of stranding the player', () => {
    // 3 s of queued movement arriving at once: allowed outright, because the
    // budget is measured from the last ACCEPTED move.
    const burst = 30 * PX_PER_M;
    const r = clampMoveToMaxSpeed(0, 0, burst, 0, 3_000_000n);
    expect(r.clamped).toBe(false);
  });

  it('gives only the grace term when the clock does not advance', () => {
    // Same-instant replay or clock skew: no budget, but never a negative one.
    for (const elapsed of [0n, -5_000_000n]) {
      const r = clampMoveToMaxSpeed(0, 0, 999 * PX_PER_M, 0, elapsed);
      expect(r.clamped).toBe(true);
      expect(r.x / PX_PER_M).toBeCloseTo(MOVE_JITTER_GRACE_M, 6);
    }
  });
});

describe('the ceiling matches the client it is policing', () => {
  it('MAX_MOVE_SPEED_MPS equals BabylonWorldScene._moveLocal speed', () => {
    // The client integrates `speed * dt` with dt in milliseconds, so the
    // literal is m/ms. If someone speeds the player up without moving this
    // constant, the server would clamp every honest player — pin them
    // together the way worldSpace.test.js pins the px/m constants.
    const scene = readFileSync(
      join(repoRoot, 'src/features/world/game/BabylonWorldScene.js'), 'utf8',
    );
    const m = scene.match(/const speed = ([\d.]+);/);
    expect(m, 'movement speed literal not found in _moveLocal').toBeTruthy();
    expect(Number(m[1]) * 1000).toBe(MAX_MOVE_SPEED_MPS);
  });

  it('a full-rate honest client is never clamped', () => {
    // The client paces sends at 80 ms; the server floor is 40 ms. Both must
    // pass untouched at full walking speed, including the worst jitter case
    // where an 80 ms step arrives after only 40 ms.
    const stepPx = MAX_MOVE_SPEED_MPS * PX_PER_M * 0.08;
    for (const elapsed of [80_000n, FLOOR_MICROS]) {
      expect(clampMoveToMaxSpeed(0, 0, stepPx, 0, elapsed).clamped).toBe(false);
    }
  });
});
