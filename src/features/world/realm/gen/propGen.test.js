/**
 * propGen.test.js — the developmental-LOD contract, measured.
 *
 * The genome design CLAIMS a truncated growth stage is a valid distant LOD
 * (fixed envelope, coarser topology). These tests measure that claim with
 * the silhouette harness instead of trusting it: high IoU between stages,
 * bounded crown-width delta, monotonically decreasing triangle cost. If a
 * genome tweak ever makes stages drift apart, CI catches the pop before an
 * eyeball does.
 */
import { describe, expect, it } from 'vitest';
import { buildPrototypePayload } from './propGen.js';
import { PROTOTYPES } from '../model/propGenomes.js';
import { silhouetteStats } from '../model/silhouette.js';

/**
 * Gate calibration — measured, not aspirational. At 32x32 mask resolution
 * (matching a tree's real on-screen height near the LOD switch distance),
 * the theoretically CLEANEST possible developmental pair — subset-vertex
 * tessellations of an identical envelope, area-compensated — plateaus at
 * meanIoU 0.82-0.85, purely from boundary-cell rasterization noise between
 * different tessellations. Genuinely different shapes measure far lower:
 * a half-width box pair ~0.6, an octahedron-vs-sphere ~0.72, a lens'
 * diamond profile 0.67. The gate sits at 0.80: above everything broken,
 * below everything honest, with the width gate as the sharper pop detector
 * (it caught every real envelope drift during tuning at 0.10-0.15 while
 * IoU still read plausibly). The 0.85 first draft predated measurement and
 * failed the best-possible case — a gate the cleanest geometry cannot pass
 * is miscalibrated, not strict. See "the gate has teeth" below for the
 * discrimination proof.
 */
const IOU_ADJACENT_MIN = 0.80; // L0 vs L1 — the only rendered pair; beyond
// mid distance the far tier is drop-shipped (no instances), so no L2 exists.
const WIDTH_DELTA_MAX = 0.10;

describe('payload validity — every prototype, every stage', () => {
  for (const proto of PROTOTYPES) {
    for (let stage = 0; stage < proto.stages; stage++) {
      it(`${proto.id} stage ${stage} is a well-formed payload`, () => {
        const p = buildPrototypePayload(proto.id, stage);
        expect(p.vertCount).toBeGreaterThan(0);
        expect(p.triCount).toBeGreaterThan(0);
        expect(p.positions.length).toBe(p.vertCount * 3);
        expect(p.normals.length).toBe(p.vertCount * 3);
        expect(p.colors.length).toBe(p.vertCount * 4);
        expect(p.indices.length).toBe(p.triCount * 3);
        for (const i of p.indices) expect(i).toBeLessThan(p.vertCount);
        for (const v of p.positions) expect(Number.isFinite(v)).toBe(true);
        for (const n of p.normals) expect(Number.isFinite(n)).toBe(true);
        for (const c of p.colors) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        }
        expect(p.heightM).toBeGreaterThan(0);
        expect(p.radiusM).toBeGreaterThan(0);
      });
    }
  }
});

describe('determinism — the multiplayer contract extends to props', () => {
  it('same prototype+stage builds byte-identical payloads', () => {
    const a = buildPrototypePayload('valeoak', 0);
    const b = buildPrototypePayload('valeoak', 0);
    expect(a.positions).toEqual(b.positions);
    expect(a.colors).toEqual(b.colors);
    expect(a.indices).toEqual(b.indices);
  });
});

describe('the developmental-LOD contract — silhouettes must match across stages', () => {
  const multiStage = PROTOTYPES.filter((p) => p.stages >= 2);

  for (const proto of multiStage) {
    it(`${proto.id}: adjacent stages stay above IoU ${IOU_ADJACENT_MIN}`, () => {
      const l0 = buildPrototypePayload(proto.id, 0);
      const l1 = buildPrototypePayload(proto.id, 1);
      const s = silhouetteStats(l0, l1);
      expect(s.meanIoU, `${proto.id} L0-L1 meanIoU=${s.meanIoU.toFixed(3)}`).toBeGreaterThanOrEqual(IOU_ADJACENT_MIN);
      expect(s.widthDeltaFrac, `${proto.id} L0-L1 width`).toBeLessThanOrEqual(WIDTH_DELTA_MAX);
    });
  }

  for (const proto of multiStage) {
    it(`${proto.id}: triangle cost strictly decreases with stage`, () => {
      let prev = Infinity;
      for (let stage = 0; stage < proto.stages; stage++) {
        const tris = buildPrototypePayload(proto.id, stage).triCount;
        expect(tris, `${proto.id} stage ${stage}`).toBeLessThan(prev);
        prev = tris;
      }
    });
  }

  for (const proto of multiStage) {
    it(`${proto.id}: envelope (height, radius) holds within 10% across stages`, () => {
      const l0 = buildPrototypePayload(proto.id, 0);
      for (let stage = 1; stage < proto.stages; stage++) {
        const ls = buildPrototypePayload(proto.id, stage);
        expect(Math.abs(ls.heightM - l0.heightM) / l0.heightM, `${proto.id} height s${stage}`).toBeLessThanOrEqual(0.1);
        expect(Math.abs(ls.radiusM - l0.radiusM) / l0.radiusM, `${proto.id} radius s${stage}`).toBeLessThanOrEqual(0.1);
      }
    });
  }
});

describe('the gate has teeth — genuinely different shapes score BELOW it', () => {
  it('two different species at the same stage fail the same-shape bar', () => {
    // Discrimination proof for the calibrated 0.80 gate: if valeoak-vs-
    // cragpine (a broadleaf blob crown vs a conifer disc stack) ever scores
    // ABOVE the gate, the gate has gone blind and passing it means nothing.
    const oak = buildPrototypePayload('valeoak', 0);
    const pine = buildPrototypePayload('cragpine', 0);
    expect(silhouetteStats(oak, pine).meanIoU).toBeLessThan(IOU_ADJACENT_MIN);
  });
});

describe('stress variants are genuinely different prototypes', () => {
  it('krummholz cragpine is far shorter than lush, at the same stage', () => {
    const lush = buildPrototypePayload('cragpine', 0);
    const krum = buildPrototypePayload('cragpine_krum', 0);
    expect(krum.heightM).toBeLessThan(lush.heightM * 0.6);
  });

  it('krummholz costs fewer or equal triangles than lush at every stage', () => {
    const stages = PROTOTYPES.find((p) => p.id === 'cragpine_krum').stages;
    for (let stage = 0; stage < stages; stage++) {
      expect(buildPrototypePayload('cragpine_krum', stage).triCount)
        .toBeLessThanOrEqual(buildPrototypePayload('cragpine', stage).triCount);
    }
  });
});

describe('grass tuft is genuinely cheap', () => {
  it('is exactly the 8-triangle budget the design allocates', () => {
    expect(buildPrototypePayload('tuft', 0).triCount).toBe(8);
  });
});

describe('failure modes are loud', () => {
  it('unknown prototype throws', () => {
    expect(() => buildPrototypePayload('ghostwood', 0)).toThrow(/unknown prototype/);
  });

  it('out-of-range stage throws', () => {
    expect(() => buildPrototypePayload('tuft', 1)).toThrow(/stages/);
  });
});
