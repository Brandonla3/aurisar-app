/**
 * actorPrimitives.test.js — `addMass`'s geometry contract, measured directly.
 *
 * Roster-level silhouette gating (fitsWindow, canonicalStats, bandOccupancy
 * against bandTargets) belongs to gen/actorSilhouette.test.js — it needs the
 * archetype-walking generator, which is a later task. What belongs here is
 * the primitive's own contract: it composes addTube + addBlob exactly as
 * Task 2's measurement stand-in did (closed-form vertex/triangle counts),
 * every vertex is well-formed (colours in [0,1], analytic unit normals),
 * `comp` scales radii only, and the returned range is exactly what was
 * appended — the property Task 4's massIndex fill depends on.
 */
import { describe, expect, it } from 'vitest';
import { addMass } from './actorPrimitives.js';
import {
  finalize, newAccumulator, sphereFaces,
} from './propPrimitives.js';

const COLOR = [0.4, 0.5, 0.6];

const mass = (overrides = {}) => ({
  id: 'fixture',
  a: [0, 0, 0],
  b: [0, 1, 0],
  r0: 0.2,
  r1: 0.15,
  color: COLOR,
  capA: false,
  capB: false,
  ...overrides,
});

describe('addMass — composition matches the closed form', () => {
  // Closed form: an open addTube contributes `segments*2` triangles and
  // `segments*2` vertices (two full rings, no caps). Each requested cap is
  // one addBlob at `capLevel`, which is `sphereFaces(capLevel).length`
  // unindexed triangles — one triangle each, three NEW vertices each (blobs
  // never share verts across faces). This is exactly Task 2's stand-in
  // composition, re-derived here so a future change to the composition
  // (welding rings into caps, skipping a ring, etc.) fails this test loudly
  // instead of silently drifting the archetype measurements Task 2 shipped.
  const segments = 8;
  const capLevel = 1;
  const faceCount = sphereFaces(capLevel).length;

  it('both ends capped: tris = 2*segments + 2*faces, verts = 2*segments + 6*faces', () => {
    const acc = newAccumulator();
    addMass(acc, mass({ capA: true, capB: true }), { segments, capLevel });
    const p = finalize(acc);
    expect(p.triCount).toBe(segments * 2 + 2 * faceCount);
    expect(p.vertCount).toBe(segments * 2 + 2 * faceCount * 3);
  });

  it('no caps: an open tube alone is 2*segments tris and verts', () => {
    const acc = newAccumulator();
    addMass(acc, mass({ capA: false, capB: false }), { segments, capLevel });
    const p = finalize(acc);
    expect(p.triCount).toBe(segments * 2);
    expect(p.vertCount).toBe(segments * 2);
  });

  it('one end capped (capA only): 2*segments + faces tris, matching verts', () => {
    const acc = newAccumulator();
    addMass(acc, mass({ capA: true, capB: false }), { segments, capLevel });
    const p = finalize(acc);
    expect(p.triCount).toBe(segments * 2 + faceCount);
    expect(p.vertCount).toBe(segments * 2 + faceCount * 3);
  });

  it('one end capped (capB only): same closed form, the other endpoint', () => {
    const acc = newAccumulator();
    addMass(acc, mass({ capA: false, capB: true }), { segments, capLevel });
    const p = finalize(acc);
    expect(p.triCount).toBe(segments * 2 + faceCount);
    expect(p.vertCount).toBe(segments * 2 + faceCount * 3);
  });

  it('every index references a real vertex — indices and vertCount agree', () => {
    const acc = newAccumulator();
    addMass(acc, mass({ capA: true, capB: true }), { segments, capLevel });
    const p = finalize(acc);
    expect(p.indices.length).toBe(p.triCount * 3);
    for (const i of p.indices) expect(i).toBeLessThan(p.vertCount);
  });
});

describe('addMass — per-vertex well-formedness', () => {
  it('every colour channel is in [0,1] and alpha is always exactly 1', () => {
    const acc = newAccumulator();
    addMass(acc, mass({ capA: true, capB: true }), { segments: 8, capLevel: 2 });
    const p = finalize(acc);
    for (let v = 0; v < p.vertCount; v++) {
      for (let ch = 0; ch < 3; ch++) {
        const c = p.colors[v * 4 + ch];
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
      expect(p.colors[v * 4 + 3]).toBe(1);
    }
  });

  it('every normal is unit length — analytic, never zero or face-averaged away', () => {
    const acc = newAccumulator();
    addMass(acc, mass({ capA: true, capB: true }), { segments: 8, capLevel: 2 });
    const p = finalize(acc);
    for (let v = 0; v < p.vertCount; v++) {
      const nx = p.normals[v * 3];
      const ny = p.normals[v * 3 + 1];
      const nz = p.normals[v * 3 + 2];
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
    }
  });

  it('every position and normal component is finite', () => {
    const acc = newAccumulator();
    addMass(acc, mass({ capA: true, capB: false }), { segments: 6, capLevel: 1, comp: 1.03 });
    const p = finalize(acc);
    for (const v of p.positions) expect(Number.isFinite(v)).toBe(true);
    for (const n of p.normals) expect(Number.isFinite(n)).toBe(true);
  });
});

describe('addMass — comp scales radii only, never length', () => {
  it('an axis-aligned tube keeps its exact axial extent under comp, while the radial extent scales', () => {
    // Axis along world X so the ring plane (perpendicular to the axis) has
    // zero X component by construction — any axial drift under comp would
    // show up directly as a moved min/max X, with no basisFor ambiguity.
    const m = mass({
      a: [0, 0, 0], b: [1, 0, 0], r0: 0.1, r1: 0.1, capA: false, capB: false,
    });
    const buildAt = (comp) => {
      const acc = newAccumulator();
      addMass(acc, m, { segments: 8, capLevel: 1, comp });
      return finalize(acc);
    };
    const extent = (p) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let maxR = 0;
      for (let i = 0; i < p.positions.length; i += 3) {
        const x = p.positions[i];
        const r = Math.hypot(p.positions[i + 1], p.positions[i + 2]);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (r > maxR) maxR = r;
      }
      return { minX, maxX, maxR };
    };
    const e1 = extent(buildAt(1));
    const e2 = extent(buildAt(2));
    expect(e2.minX).toBeCloseTo(e1.minX, 10);
    expect(e2.maxX).toBeCloseTo(e1.maxX, 10);
    expect(e2.maxR / e1.maxR).toBeCloseTo(2, 5);
  });

  it('comp also scales the cap sphere, not just the tube ring', () => {
    // capA's blob is centered at mass.a = the origin, and r0 === r1, so both
    // the tube's start ring and the cap sphere have every vertex at exactly
    // radius r0*comp from the Y axis (ring) or the origin (cap) — a fixed
    // unit direction times a scalar radius. finalize's radiusM (max distance
    // from the Y axis) is therefore EXACTLY linear in comp, not approximately.
    const m = mass({
      a: [0, 0, 0], b: [0, 0.5, 0], r0: 0.2, r1: 0.2, capA: true, capB: false,
    });
    const buildAt = (comp) => {
      const acc = newAccumulator();
      addMass(acc, m, { segments: 8, capLevel: 2, comp });
      return finalize(acc);
    };
    const p1 = buildAt(1);
    const p2 = buildAt(1.5);
    expect(p2.radiusM / p1.radiusM).toBeCloseTo(1.5, 5);
  });
});

describe('addMass — the returned range exactly brackets what was appended', () => {
  it('a single call on a fresh accumulator starts at 0 and spans everything pushed', () => {
    const acc = newAccumulator();
    const range = addMass(acc, mass({ capA: true, capB: true }), { segments: 8, capLevel: 1 });
    expect(range.firstVertex).toBe(0);
    expect(range.vertexCount).toBe(acc.pos.length / 3);
  });

  it('consecutive calls append contiguously — no interleaving, no gaps, no overlap', () => {
    const acc = newAccumulator();
    const rangeA = addMass(acc, mass({ id: 'a', capA: true, capB: true }), { segments: 8, capLevel: 2 });
    const afterA = acc.pos.length / 3;
    expect(rangeA.firstVertex).toBe(0);
    expect(rangeA.vertexCount).toBe(afterA);

    const rangeB = addMass(
      acc,
      mass({
        id: 'b', a: [0, 1, 0], b: [0, 2, 0], capA: false, capB: true,
      }),
      { segments: 6, capLevel: 1, comp: 1.03 },
    );
    expect(rangeB.firstVertex).toBe(afterA);
    expect(rangeB.vertexCount).toBe(acc.pos.length / 3 - afterA);

    // The two ranges partition [0, totalVertCount) with no gap and no overlap.
    expect(rangeA.firstVertex + rangeA.vertexCount).toBe(rangeB.firstVertex);
    expect(rangeB.firstVertex + rangeB.vertexCount).toBe(acc.pos.length / 3);
  });
});
