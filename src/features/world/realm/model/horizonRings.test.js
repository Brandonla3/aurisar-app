import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE_M } from './chunkMath.js';
import { GRADIENT_DEF } from './skyModel.js';
import { RING_TIERS, ringElevation, ringPaintFor, ringsStayBelowZenith } from './horizonRings.js';

describe('ring radii derive from the streamer, not magic numbers', () => {
  it('every tier radius is an EXACT integer multiple of the streamed radius', () => {
    // The whole point: if the streaming radius ever changes, the ring kit
    // moves with it instead of drifting into disagreement. Exact multiple,
    // not merely "close to" — an earlier draft used decimal factors (3.1,
    // 4.9, 7.3) chosen to land near a target distance, which this test
    // correctly rejected: "derived from the streamer" must be a checkable
    // relationship, not a coincidence.
    const streamed = 3 * CHUNK_SIZE_M;
    for (const t of RING_TIERS) {
      expect(t.radiusM % streamed).toBe(0);
      expect(t.radiusM).toBeGreaterThan(streamed);
    }
  });

  it('tiers are ordered near to far with increasing darken', () => {
    for (let i = 1; i < RING_TIERS.length; i++) {
      expect(RING_TIERS[i].radiusM).toBeGreaterThan(RING_TIERS[i - 1].radiusM);
      expect(RING_TIERS[i].darken).toBeGreaterThan(RING_TIERS[i - 1].darken);
    }
  });
});

describe('ringElevation', () => {
  it('is distance-independent in the sense that matters: no fog term anywhere', () => {
    // Not literally distance-independent (radius IS an input to the angle) —
    // the guarantee is that nothing here is an EXTINCTION function of
    // distance. Verify the source contains no exp/density-shaped math.
    expect(ringElevation.toString()).not.toMatch(/exp\(|density/i);
  });

  it('a taller feature at the same radius has higher elevation', () => {
    expect(ringElevation(1000, 300)).toBeGreaterThan(ringElevation(1000, 140));
  });

  it('a closer feature at the same height has higher elevation', () => {
    expect(ringElevation(500, 200)).toBeGreaterThan(ringElevation(1000, 200));
  });

  it('approaches 1 for a near-vertical sightline, never exceeding it', () => {
    // dy/hypot(radius, dy) is mathematically bounded to [-1, 1] by
    // construction (hypot >= |dy| always) — the upper clamp exists as a
    // defensive contract, not because real geometry can breach it. A tiny
    // radius with a huge height approaches but never reaches exactly 1.
    const e = ringElevation(1, 100000);
    expect(e).toBeCloseTo(1, 6);
    expect(e).toBeLessThanOrEqual(1);
  });

  it('clamps to exactly 0 for a feature well below the camera', () => {
    // Unlike the upper bound, Math.max(negative, 0) lands on exactly 0 —
    // this IS a real clamp engaging, not an asymptote.
    expect(ringElevation(100000, -100000)).toBe(0);
  });

  it('handles a feature below the camera without going negative-then-NaN', () => {
    const e = ringElevation(1000, 0, 1.6);
    expect(e).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(e)).toBe(true);
  });
});

describe('the zenith-band sanity check', () => {
  it('every authored ring stays below GRADIENT_DEF.zenithStart at eye height', () => {
    // The bug this catches: a ring whose elevation angle drifts into the
    // zenith band would paint itself sky-blue and the silhouette vanishes.
    // Cheap to catch here; expensive to notice on a screenshot.
    expect(ringsStayBelowZenith(1.6)).toBe(true);
    for (const t of RING_TIERS) {
      expect(ringElevation(t.radiusM, t.heightM, 1.6)).toBeLessThan(GRADIENT_DEF.zenithStart);
    }
  });

  it('still holds from a raised camera (a hill, not just eye height)', () => {
    expect(ringsStayBelowZenith(60)).toBe(true);
  });
});

describe('ringPaintFor', () => {
  it('returns the tier darken verbatim alongside the computed elevation', () => {
    const p = ringPaintFor(RING_TIERS[0]);
    expect(p.darken).toBe(RING_TIERS[0].darken);
    expect(p.elevation).toBe(ringElevation(RING_TIERS[0].radiusM, RING_TIERS[0].heightM, 1.6));
  });

  it('is a pure function — same tier, same camera, same result', () => {
    const a = ringPaintFor(RING_TIERS[1], 10);
    const b = ringPaintFor(RING_TIERS[1], 10);
    expect(a).toEqual(b);
  });
});
