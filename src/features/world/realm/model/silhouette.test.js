import { describe, expect, it } from 'vitest';
import {
  maskIoU, projectedBounds, rasterizeMask, silhouetteAreaM2, silhouetteStats,
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
