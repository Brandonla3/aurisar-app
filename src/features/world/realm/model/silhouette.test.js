import { describe, expect, it } from 'vitest';
import {
  ACTOR_WINDOW, bandOccupancy, canonicalStats, fitsWindow, maskIoU, projectedBounds,
  rasterizeMask, silhouetteAreaM2, silhouetteStats,
} from './silhouette.js';

/** A unit box payload centered on the Y axis: [-w/2, w/2] x [0, h] x [-w/2, w/2]. */
function boxPayload(w, h) {
  const x = w / 2;
  const positions = new Float32Array([
    -x, 0, -x, x, 0, -x, x, 0, x, -x, 0, x, // bottom ring
    -x, h, -x, x, h, -x, x, h, x, -x, h, x, // top ring
  ]);
  const indices = new Uint32Array([
    0, 1, 5, 0, 5, 4, // one side
    1, 2, 6, 1, 6, 5, // next side
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
    4, 5, 6, 4, 6, 7, // top
  ]);
  return { positions, indices };
}

describe('projectedBounds', () => {
  it('captures the full extent at yaw 0', () => {
    const b = projectedBounds(boxPayload(2, 3).positions, 0);
    expect(b.minX).toBeCloseTo(-1, 6);
    expect(b.maxX).toBeCloseTo(1, 6);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeCloseTo(3, 6);
  });

  it('a square footprint is wider on the diagonal — yaw genuinely rotates', () => {
    const p = boxPayload(2, 1).positions;
    const w0 = projectedBounds(p, 0);
    const w45 = projectedBounds(p, Math.PI / 4);
    expect(w45.maxX - w45.minX).toBeGreaterThan(w0.maxX - w0.minX);
  });
});

describe('maskIoU', () => {
  it('identical masks score 1', () => {
    const box = boxPayload(2, 3);
    const b = projectedBounds(box.positions, 0);
    const m = rasterizeMask(box, 0, b);
    expect(maskIoU(m, m)).toBe(1);
  });

  it('disjoint masks score 0', () => {
    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    a[0] = 1;
    b[15] = 1;
    expect(maskIoU(a, b)).toBe(0);
  });

  it('two empty masks score 1, not NaN', () => {
    expect(maskIoU(new Uint8Array(16), new Uint8Array(16))).toBe(1);
  });
});

describe('silhouetteStats — the LOD contract measurement', () => {
  it('a payload against itself is a perfect match', () => {
    const box = boxPayload(2, 3);
    const s = silhouetteStats(box, box);
    expect(s.meanIoU).toBe(1);
    expect(s.minIoU).toBe(1);
    expect(s.widthDeltaFrac).toBe(0);
  });

  it('same envelope, coarser interior still scores high — detail loss is not a pop', () => {
    // The property the developmental-LOD design leans on: what matters is
    // the ENVELOPE. A box missing its top face (fewer triangles, same
    // outline) must still read as the same shape.
    const full = boxPayload(2, 3);
    const noTop = {
      positions: full.positions,
      indices: full.indices.slice(0, 24), // drop the top-face triangles
    };
    const s = silhouetteStats(full, noTop);
    expect(s.meanIoU).toBeGreaterThan(0.8);
    expect(s.widthDeltaFrac).toBe(0);
  });

  it('a half-width crown is loudly detected — envelope mismatch cannot hide', () => {
    // The shared-projection-window rule at work: normalizing each mesh to
    // its own bounds would score these near 1. The union window makes the
    // width difference cost real IoU and show in widthDeltaFrac.
    const wide = boxPayload(4, 3);
    const narrow = boxPayload(2, 3);
    const s = silhouetteStats(wide, narrow);
    expect(s.widthDeltaFrac).toBeCloseTo(0.5, 2);
    expect(s.meanIoU).toBeLessThan(0.8);
  });
});

describe('silhouetteAreaM2', () => {
  it('scales with actual size — a 2x-wider, 2x-taller box reads ~4x the area', () => {
    const small = silhouetteAreaM2(boxPayload(1, 1));
    const big = silhouetteAreaM2(boxPayload(2, 2));
    expect(big / small).toBeGreaterThan(3);
    expect(big / small).toBeLessThan(5);
  });

  it('is deterministic', () => {
    const box = boxPayload(2, 3);
    expect(silhouetteAreaM2(box)).toBe(silhouetteAreaM2(box));
  });
});

describe('pitchRad — additive to projectedBounds and rasterizeMask', () => {
  it('projectedBounds: pitchRad=0 explicit matches pitchRad omitted, bit for bit', () => {
    const box = boxPayload(2, 3);
    const omitted = projectedBounds(box.positions, 0.83);
    const explicit = projectedBounds(box.positions, 0.83, 0);
    expect(explicit).toEqual(omitted);
  });

  it('rasterizeMask: pitchRad=0 explicit matches pitchRad omitted, bit for bit', () => {
    const box = boxPayload(2, 3);
    const bounds = projectedBounds(box.positions, 0.83);
    const omitted = rasterizeMask(box, 0.83, bounds, 32);
    const explicit = rasterizeMask(box, 0.83, bounds, 32, 0);
    expect(explicit).toEqual(omitted);
  });

  it('a pitched box projects shorter than an unpitched one', () => {
    // A THIN box: negligible horizontal footprint, so the height axis's own
    // cos(pitch) foreshortening is what dominates the span, instead of
    // getting swamped by depth-parallax spread from a wide footprint (a
    // wide box's depth extent can make a pitched span LONGER, not shorter —
    // this is why the test picks a shape, not just any box).
    const thin = boxPayload(0.01, 3);
    const level = projectedBounds(thin.positions, 0);
    const pitched = projectedBounds(thin.positions, 0, 0.5);
    expect(pitched.maxY - pitched.minY).toBeLessThan(level.maxY - level.minY);
  });
});

describe('canonicalStats — the same per-yaw comparison, against a FIXED window', () => {
  it('a payload against itself scores a perfect match inside a window that contains it', () => {
    const box = boxPayload(2, 3);
    const bounds = { minX: -2, maxX: 2, minY: -1, maxY: 4 };
    const s = canonicalStats(box, box, { bounds });
    expect(s.meanIoU).toBe(1);
    expect(s.minIoU).toBe(1);
  });

  it('scores the true size difference — no per-pair union window to hide behind', () => {
    const wide = boxPayload(3, 2);
    const narrow = boxPayload(1, 2);
    const bounds = { minX: -2, maxX: 2, minY: -1, maxY: 3 };
    const s = canonicalStats(wide, narrow, { bounds });
    expect(s.meanIoU).toBeLessThan(1);
  });
});

describe('fitsWindow — the silent-clip guard', () => {
  it('a payload larger than the window does not fit, and the margin says so', () => {
    const big = boxPayload(4, 3);
    const tooSmall = { minX: -1, maxX: 1, minY: 0, maxY: 2 };
    const result = fitsWindow(big, { bounds: tooSmall });
    expect(result.fits).toBe(false);
    expect(result.worstMarginFrac).toBeLessThan(0);
  });

  it('a payload comfortably inside the window fits, with positive margin', () => {
    const small = boxPayload(1, 1);
    const roomy = { minX: -2, maxX: 2, minY: -1, maxY: 3 };
    const result = fitsWindow(small, { bounds: roomy });
    expect(result.fits).toBe(true);
    expect(result.worstMarginFrac).toBeGreaterThan(0);
  });
});

describe('bandOccupancy — per-band fraction of the filled silhouette', () => {
  const bounds = { minX: -1.5, maxX: 1.5, minY: 0, maxY: 3 };

  it('N interior edges produce N+1 bands — 2 edges (waist/shoulder-shaped) give exactly 3', () => {
    const box = boxPayload(2, 3);
    const bands = bandOccupancy(box, { bounds, bandEdgesY: [1, 2] });
    expect(bands.length).toBe(3);
  });

  it('sums to 1 across bands', () => {
    const box = boxPayload(2, 3);
    const bands = bandOccupancy(box, { bounds, bandEdgesY: [1, 2] });
    expect(bands.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('a box confined to the lowest band reads [1, 0, 0]', () => {
    const low = boxPayload(2, 0.9); // comfortably under the band-1 edge at y=1
    const bands = bandOccupancy(low, { bounds, bandEdgesY: [1, 2] });
    expect(bands.length).toBe(3);
    expect(bands[0]).toBeCloseTo(1, 6);
    expect(bands[1]).toBeCloseTo(0, 6);
    expect(bands[2]).toBeCloseTo(0, 6);
  });
});

describe('ACTOR_WINDOW', () => {
  it('is the derived, snug, frozen span', () => {
    expect(ACTOR_WINDOW).toEqual({
      minX: -1.15, maxX: 1.15, minY: -0.45, maxY: 2.45,
    });
    expect(Object.isFrozen(ACTOR_WINDOW)).toBe(true);
  });
});
