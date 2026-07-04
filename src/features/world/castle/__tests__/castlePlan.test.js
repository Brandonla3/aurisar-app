/**
 * castlePlan invariants — every constraint the geometry builders and nav
 * model silently rely on. A failure here means the floor plan itself is
 * malformed (overlapping rooms, doors on non-shared edges, stairs poking
 * out of their rooms, footprint outside the server movement clamp).
 */
import { describe, it, expect } from 'vitest';
import {
  CASTLE_PLAN, LEVELS, ROOMS, DOORS, STAIRS, VOIDS,
  LOCAL_BOUNDS, INTERIOR_ANCHOR, ROOMS_BY_ID,
  stairRects, stairSurfaceY,
} from '../castlePlan.js';

const rectsOverlap = (a, b) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const rectInside = (inner, outer, eps = 0.01) =>
  inner.x0 >= outer.x0 - eps && inner.x1 <= outer.x1 + eps &&
  inner.z0 >= outer.z0 - eps && inner.z1 <= outer.z1 + eps;

describe('castlePlan invariants', () => {
  it('interior footprint stays inside the server movement clamp (x <= 995 m)', () => {
    expect(INTERIOR_ANCHOR.x + LOCAL_BOUNDS.x1).toBeLessThanOrEqual(995);
    expect(INTERIOR_ANCHOR.x + LOCAL_BOUNDS.x0).toBeGreaterThan(500); // flat interiors region
  });

  it('levels are strictly ascending with positive clearance', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].y).toBeGreaterThan(LEVELS[i - 1].y);
      // slab of level i sits above level i-1's clear height
      expect(LEVELS[i].y - LEVELS[i - 1].y).toBeGreaterThan(LEVELS[i - 1].clear * 0.7);
    }
    LEVELS.forEach((l) => expect(l.clear).toBeGreaterThan(3.5));
  });

  it('every room lies inside the local bounds and rooms on a level never overlap', () => {
    for (const r of ROOMS) {
      expect(rectInside(r.rect, LOCAL_BOUNDS), `room ${r.id} in bounds`).toBe(true);
      expect(r.rect.x1 - r.rect.x0).toBeGreaterThan(3);
      expect(r.rect.z1 - r.rect.z0).toBeGreaterThan(3);
    }
    for (const a of ROOMS) {
      for (const b of ROOMS) {
        if (a.id >= b.id || a.level !== b.level) continue;
        expect(rectsOverlap(a.rect, b.rect), `rooms ${a.id} / ${b.id} overlap`).toBe(false);
      }
    }
  });

  it('every door sits on an edge genuinely shared by its two rooms', () => {
    for (const d of DOORS) {
      const A = ROOMS_BY_ID[d.a];
      expect(A, `door ${d.id} room a`).toBeTruthy();
      if (d.b === 'EXTERIOR') {
        // gate must sit on the room's own boundary
        const onEdge = d.edge === 'x'
          ? (d.at === A.rect.x0 || d.at === A.rect.x1)
          : (d.at === A.rect.z0 || d.at === A.rect.z1);
        expect(onEdge, `gate ${d.id} on boundary`).toBe(true);
        continue;
      }
      const B = ROOMS_BY_ID[d.b];
      expect(B, `door ${d.id} room b`).toBeTruthy();
      expect(A.level, `door ${d.id} same level`).toBe(B.level);
      if (d.edge === 'x') {
        const shared = (A.rect.x1 === d.at && B.rect.x0 === d.at) ||
                       (B.rect.x1 === d.at && A.rect.x0 === d.at);
        expect(shared, `door ${d.id} rooms share x=${d.at}`).toBe(true);
        const lo = Math.max(A.rect.z0, B.rect.z0), hi = Math.min(A.rect.z1, B.rect.z1);
        expect(d.lo, `door ${d.id} opening inside shared span`).toBeGreaterThanOrEqual(lo);
        expect(d.hi).toBeLessThanOrEqual(hi);
      } else {
        const shared = (A.rect.z1 === d.at && B.rect.z0 === d.at) ||
                       (B.rect.z1 === d.at && A.rect.z0 === d.at);
        expect(shared, `door ${d.id} rooms share z=${d.at}`).toBe(true);
        const lo = Math.max(A.rect.x0, B.rect.x0), hi = Math.min(A.rect.x1, B.rect.x1);
        expect(d.lo, `door ${d.id} opening inside shared span`).toBeGreaterThanOrEqual(lo);
        expect(d.hi).toBeLessThanOrEqual(hi);
      }
      expect(d.hi - d.lo).toBeGreaterThanOrEqual(2);
    }
  });

  it('every stair footprint sits inside one room on BOTH its levels', () => {
    for (const st of STAIRS) {
      const fp = stairRects(st).footprint;
      for (const level of [st.lo, st.hi]) {
        const host = ROOMS.filter((r) => r.level === level)
          .find((r) => rectInside(fp, r.rect));
        expect(host, `stair ${st.id} hosted on level ${level}`).toBeTruthy();
      }
      expect(st.hi).toBe(st.lo + 1);
    }
  });

  it('stairSurfaceY endpoints meet the two floor heights exactly', () => {
    for (const st of STAIRS) {
      const { laneA, laneB, landing } = stairRects(st);
      const mid = (r) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
      const a = mid(laneA), bt = mid(laneB), ld = mid(landing);
      const yLo = LEVELS[st.lo].y, yHi = LEVELS[st.hi].y, yMid = (yLo + yHi) / 2;
      // base of lane A = lower floor
      const base = st.axis === 'z' ? { x: a.x, z: st.u0 } : { x: st.u0, z: a.z };
      expect(stairSurfaceY(st, base.x, base.z)).toBeCloseTo(yLo, 5);
      // top of lane B = upper floor
      const top = st.axis === 'z' ? { x: bt.x, z: st.u0 } : { x: st.u0, z: bt.z };
      expect(stairSurfaceY(st, top.x, top.z)).toBeCloseTo(yHi, 5);
      // landing = midpoint
      expect(stairSurfaceY(st, ld.x, ld.z)).toBeCloseTo(yMid, 5);
      // railing gap between lanes is off-stair
      const gapV = st.v0 + st.laneW + st.gap / 2;
      const gp = st.axis === 'z'
        ? { x: gapV, z: st.u0 + st.runLen / 2 }
        : { x: st.u0 + st.runLen / 2, z: gapV };
      expect(stairSurfaceY(st, gp.x, gp.z)).toBeNull();
    }
  });

  it('grand-stair footprints on a shared level grid never overlap in plan view', () => {
    // Ramps live on the lo grid; holes on the hi grid. Any two stairs whose
    // rects overlap AND touch the same grid level would corrupt the nav.
    for (const a of STAIRS) {
      for (const b of STAIRS) {
        if (a.id >= b.id) continue;
        const sharedLevels =
          [a.lo, a.hi].filter((l) => l === b.lo || l === b.hi);
        if (!sharedLevels.length) continue;
        const fa = stairRects(a).footprint, fb = stairRects(b).footprint;
        expect(rectsOverlap(fa, fb), `stairs ${a.id}/${b.id}`).toBe(false);
      }
    }
  });

  it('voids never swallow a room on their own level', () => {
    for (const v of VOIDS) {
      for (const r of ROOMS.filter((r) => r.level === v.level)) {
        expect(rectsOverlap(v.rect, r.rect), `void over ${r.id}`).toBe(false);
      }
    }
  });

  it('plan is JSON-serializable (SEAM:layout-manifest)', () => {
    const json = JSON.stringify(CASTLE_PLAN);
    expect(JSON.parse(json).rooms.length).toBe(ROOMS.length);
  });
});
