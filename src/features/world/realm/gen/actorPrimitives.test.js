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
  addTube, finalize, newAccumulator, sphereFaces,
} from './propPrimitives.js';
import { archetypeById, CAP_LEVEL, SEG } from '../model/actorMasses.js';

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

describe('addMass — a zero-length mass fails loudly instead of emitting NaN', () => {
  // The fail-loudly contract, closed at the primitive rather than only in the
  // shipped table. addTube guards its own division with `|| 1`, so a
  // zero-length mass does not throw there — it normalizes a ZERO vector,
  // basisFor's cross products all come out zero, its reciprocal length is
  // Infinity, and every position and normal emitted is NaN. That payload has
  // a full triangle count of nothing: it renders as absence, silhouetteAreaM2
  // returns NaN, and `NaN <= threshold` is false, so an IoU gate reading it
  // does not go red, it goes quiet. model/actorMasses.test.js rejects a
  // degenerate axis in the SHIPPED table; every DERIVED mass list — the
  // ablation chassis, the proportion roster, whatever P7 builds — bypasses
  // that check entirely.
  it('throws, and the message names the mass', () => {
    const acc = newAccumulator();
    expect(() => addMass(acc, mass({ id: 'collapsed', a: [1, 2, 3], b: [1, 2, 3] }), { segments: 8, capLevel: 1 }))
      .toThrow(/\[actorPrimitives\] mass "collapsed" has zero length/);
    expect(acc.pos.length, 'it must throw BEFORE appending a partial mass').toBe(0);
  });

  it('and would have produced all-NaN geometry — the thing being prevented', () => {
    // Proves the guard is worth having by reproducing the failure it blocks,
    // straight from addTube, which is what addMass called before the check.
    const acc = newAccumulator();
    addTube(acc, [1, 2, 3], [1, 2, 3], 0.2, 0.2, 8, COLOR);
    expect(acc.pos.length).toBeGreaterThan(0);
    expect(acc.pos.every((v) => Number.isNaN(v)), 'every position should be NaN').toBe(true);
    expect(acc.nrm.every((v) => Number.isNaN(v)), 'every normal should be NaN').toBe(true);
  });

  it('a merely SHORT mass is still allowed — the guard is about NaN, not proportions', () => {
    // The floor is 1e-9, not the 2 cm model/actorMasses.test.js holds the
    // shipped table to. This primitive has no business legislating anatomy
    // for mass lists it has never seen; it only refuses the ones that cannot
    // produce a number.
    const acc = newAccumulator();
    const p = finalize((addMass(acc, mass({ a: [0, 0, 0], b: [0, 1e-6, 0] }), { segments: 6, capLevel: 1 }), acc));
    expect(p.positions.every((v) => Number.isFinite(v))).toBe(true);
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

  it('every position and normal component is finite at the DEFAULT comp too (omitted, not just 1.03)', () => {
    // The test above only ever exercised comp as an explicit 1.03 — the near
    // stage never passes comp at all and relies on addMass's default. Cheap
    // to close: a future default-value regression (e.g. `comp = 0` typo)
    // would otherwise slip past every test in this file.
    const acc = newAccumulator();
    addMass(acc, mass({ capA: true, capB: true }), { segments: 8, capLevel: 2 });
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

  it("comp scales the cap sphere itself — measured on the cap's OWN vertices, in isolation", () => {
    // A global finalize().radiusM comparison CANNOT catch a cap that ignores
    // comp, and this is not hypothetical — a reviewer mutated addBlob's capA
    // call to receive `mass.r0` instead of `radiusA` (comp dropped) and the
    // previous version of this test, which compared whole-payload radiusM,
    // stayed green: identical ratio, 1.4999999904456425, correct or broken.
    // The reason is structural, not a fluke. addMass computes ONE number,
    // `radiusA = mass.r0 * comp`, and hands it to BOTH addTube (the ring at
    // mass.a) and addBlob (capA) — so a correctly-scaled ring and a
    // comp-ignoring cap at the SAME endpoint are never in competition: every
    // tube ring vertex sits at EXACTLY radiusA from the axis (it's a true
    // circle, not a polygon inscribed inside one), while sphereFaces' vertex
    // tables include an EQUATORIAL (y=0) direction at both level 1 and level
    // 2, so the cap's best vertex reaches AT MOST radiusA — tying the ring,
    // never beating it. A broken cap (radius unscaled, hence smaller when
    // comp > 1) is invisible behind the ring's own correct vertex. No radius
    // relationship between a mass's ring and its own colocated cap can avoid
    // this tie, because both derive from the identical scalar — so isolating
    // the cap's vertices is the only fix, not picking different radii.
    //
    // addMass's OWN contract makes that isolation cheap: it appends
    // tube-then-capA-then-capB contiguously (the {firstVertex, vertexCount}
    // guarantee this file's last describe block covers), so the cap's
    // vertices are exactly the range starting at `segments*2`.
    const segments = 8;
    const capLevel = 2;
    const r0 = 0.2;
    const m = mass({
      a: [0, 0, 0], b: [0, 0.5, 0], r0, r1: r0, capA: true, capB: false,
    });

    // The cap's direction table is public (sphereFaces), so the expected
    // horizontal reach is an EXACT computed number, not a same-vs-same ratio
    // that a differently-broken implementation could also satisfy by luck.
    const maxHorizontalUnit = Math.max(
      ...sphereFaces(capLevel).flat().map((d) => Math.hypot(d[0], d[2])),
    );
    expect(maxHorizontalUnit).toBeCloseTo(1, 10); // the equatorial vertex, confirmed live

    const capOwnMaxRadius = (comp) => {
      const acc = newAccumulator();
      const { vertexCount } = addMass(acc, m, { segments, capLevel, comp });
      let maxR = 0;
      for (let v = segments * 2; v < vertexCount; v++) { // capA's range only — skip the ring
        const r = Math.hypot(acc.pos[v * 3], acc.pos[v * 3 + 2]);
        if (r > maxR) maxR = r;
      }
      return maxR;
    };

    expect(capOwnMaxRadius(1)).toBeCloseTo(maxHorizontalUnit * r0 * 1, 10);
    expect(capOwnMaxRadius(1.5)).toBeCloseTo(maxHorizontalUnit * r0 * 1.5, 10);
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

/**
 * Legion face-plate seam — the property model/actorMasses.test.js's SEG
 * parity gate is a PROXY for, tested here directly against the real
 * `addMass` output instead of trusted from a comment.
 *
 * model/actorArchetypes.js's legion.faceL and legion.faceR share endpoint
 * `a` (the mask's centre) with capA: false on BOTH — so the only thing
 * closing that seam is the two tube rings addTube emits at that shared
 * point landing on identical vertex positions. addTube interleaves each
 * ring pair as it builds (ringStart[s] then ringEnd[s] per segment s — see
 * propPrimitives.js), so the ring at the capA-less end `a` is exactly the
 * vertices at index 2*s for s in [0, segments): even indices, untouched by
 * whichever cap vertices (if any) get appended after the tube.
 */
describe('addMass — Legion face-plate seam (faceL/faceR ring closure)', () => {
  const legion = archetypeById('legion');
  const faceL = legion.masses.find((m) => m.id === 'faceL');
  const faceR = legion.masses.find((m) => m.id === 'faceR');

  /** The ring of vertices addTube built at `mass.a` — see the block comment above. */
  const aRingPoints = (mass, segments, capLevel) => {
    const acc = newAccumulator();
    addMass(acc, mass, { segments, capLevel });
    const p = finalize(acc);
    const pts = [];
    for (let s = 0; s < segments; s++) {
      const vi = 2 * s;
      pts.push([p.positions[vi * 3], p.positions[vi * 3 + 1], p.positions[vi * 3 + 2]]);
    }
    return pts;
  };

  const countCoincident = (ptsA, ptsB, eps = 1e-4) => ptsA.filter(
    (a) => ptsB.some((b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < eps),
  ).length;

  it('SHIPPED near stage (SEG[0]): every faceL centre-ring vertex has a faceR twin', () => {
    const segments = SEG[0];
    const l = aRingPoints(faceL, segments, CAP_LEVEL[0]);
    const r = aRingPoints(faceR, segments, CAP_LEVEL[0]);
    expect(countCoincident(l, r)).toBe(segments);
  });

  it('SHIPPED far stage (SEG[1]): every faceL centre-ring vertex has a faceR twin', () => {
    const segments = SEG[1];
    const l = aRingPoints(faceL, segments, CAP_LEVEL[1]);
    const r = aRingPoints(faceR, segments, CAP_LEVEL[1]);
    expect(countCoincident(l, r)).toBe(segments);
  });

  it('mechanism check, NOT a shipped value: an odd segment count opens the seam completely', () => {
    // Proves the closure above is really earned by parity, and not some
    // coincidence of these two masses' geometry that would hold regardless
    // of segments — the exact gap the SEG-parity gate in
    // model/actorMasses.test.js exists to close off.
    const segments = 7;
    const l = aRingPoints(faceL, segments, 1);
    const r = aRingPoints(faceR, segments, 1);
    expect(countCoincident(l, r)).toBe(0);
  });
});
