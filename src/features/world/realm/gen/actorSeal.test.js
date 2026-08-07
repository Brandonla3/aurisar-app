/**
 * actorSeal.test.js — you cannot see through an actor.
 *
 * P6's exit bar is about OUTLINES, and every gate built for it is blind to
 * this by construction: model/silhouette.js rasterizes a filled mask, so a
 * hole punched clean through a body changes no silhouette, no band histogram,
 * no IoU and no manifest figure. gen/winding.test.js is blind too — it asks
 * which WAY each triangle faces, never whether a triangle is there at all.
 * Both blindnesses are correct for what those files measure, and together
 * they left the surface itself ungated.
 *
 * The P6 review found the gap by hand. Magistari's shoulder was two coaxial
 * octagons of radius 0.17 and 0.16 in the plane y = 1.40 with no cap between
 * them: a ~9 mm annulus, missed by the sleeves (they leave along +/-x, the
 * leak was at +/-z), through which a ray fired straight down at (0, +/-0.165)
 * crossed the ENTIRE actor and hit ZERO triangles — in through the annulus,
 * out through the open hem. Orghon's throat was a 24 mm slit between two
 * equal-radius rings whose axes were 8 degrees apart.
 *
 * WHAT "SEALED" MEANS HERE, precisely, because the honest version is narrower
 * than "watertight" and the difference matters:
 *
 *   - Actors are NOT watertight and are not meant to be. Magistari's hem is
 *     deliberately open (model/actorArchetypes.js explains why a hem cap is
 *     refused), and every joint buries neighbouring open rings inside a
 *     wider mass rather than trimming them, so a boundary-edge census counts
 *     104-208 open edges per archetype and always will.
 *   - So the property gated is CLEAN PASS-THROUGH: a ray that starts outside,
 *     passes through a point PROVABLY INSIDE some mass, and reaches the far
 *     side having crossed zero triangles. That takes two aligned holes, and
 *     it is exactly the defect a player sees as background through a body.
 *   - Rays are only counted when their sample point is inside a mass's own
 *     PRISM (radius scaled by the apothem cos(pi/SEG), never the circumradius).
 *     That distinction is not pedantry: the review's own orghon fan reported
 *     4 pass-throughs at offsets 0.165 and 0.170 from a neck whose ring
 *     radius is 0.170 — between the octagon's apothem (0.1571) and its
 *     circumradius (0.1700), so those rays never entered the solid at all and
 *     were measuring the gap between a circle and the polygon inside it.
 *
 * WHAT THIS GATE DOES NOT CATCH, stated up front rather than discovered
 * later — the same mistake gen/actorPrimitives.js's old cap contract made.
 *
 *   - ONE-SIDED apertures. A gap you can see the actor's dark interior
 *     through, but not the background, crosses one triangle and passes.
 *     Orghon's throat was exactly that, which is why group 3 pins the throat
 *     by its MECHANISM (the ring weld) rather than by a ray count.
 *   - FAR-STAGE CAP PINHOLES. A cap of radius R does not cover its OWN
 *     tube's end ring, for the reason group 1 measures, so at CAP_LEVEL 1
 *     every capped end carries an annulus up to 0.2R wide. Swept at 1652
 *     directions from 1375 interior points (2.27 M rays, far too slow to be
 *     a gate), the far stage still shows 16 see-through rays on unbound,
 *     68 on legion and 2 on orghon — 0.0007% to 0.003%, all of them
 *     near-axis threads through two coaxial cap annuli. The near stage is
 *     clean at that density; so is magistari at both. Closing them means
 *     changing how addMass composes tube and cap, which is LOCKED to Task
 *     2's measurement stand-in (see gen/actorPrimitives.js), so they are
 *     recorded here rather than papered over. The 26-direction grid below
 *     does not reach them; it does reach both joints the review found.
 *
 * Deterministic throughout: fixed axial fractions, fixed radial fractions,
 * fixed azimuths, fixed direction set. No randomness, no time, no hashing.
 *
 * The ray-cast/interior-point machinery (`crossings`, `interiorPoints`,
 * `DIRECTIONS`, `AXIAL`, `RADIAL`, `AZIMUTHS`) lives in gen/rayFan.js —
 * extracted so gen/actorSealPose.test.js's posed seal reuses the identical
 * epsilons and sampling grid rather than a hand-copied second one that could
 * drift. This file's own numbers (found lists, ray counts) are unchanged by
 * the extraction; only the `function`/`const` declarations moved.
 */
import { describe, expect, it } from 'vitest';
import { addMass } from './actorPrimitives.js';
import { finalize, newAccumulator, sphereFaces } from './propPrimitives.js';
import { buildActorPayload } from './actorGen.js';
import {
  AZIMUTHS, AXIAL, DIRECTIONS, RADIAL, crossings, interiorPoints,
} from './rayFan.js';
import {
  ARCHETYPES, CAP_LEVEL, FAR_COMP, SEG, archetypeById, pivotsOf,
} from '../model/actorMasses.js';

const IDS = ARCHETYPES.map((a) => a.id);
const STAGES = [0, 1];
const STAGE_NAME = ['near', 'far'];
const compFor = (stage) => (stage === 0 ? 1 : FAR_COMP);

// ── the interior sample grid ────────────────────────────────────────────────

/** Every clean pass-through this ray grid finds. */
function passThroughs(payload, masses, stage) {
  const found = [];
  for (const mass of masses) {
    for (const p of interiorPoints(mass, stage)) {
      for (const d of DIRECTIONS) {
        const [f, b] = crossings(payload, p.at, d);
        if (f === 0 && b === 0) {
          found.push(`${p.label} dir=[${d.map((n) => n.toFixed(2)).join(',')}]`);
        }
      }
    }
  }
  return found;
}

// ── 1. THE CAP'S REACH ──────────────────────────────────────────────────────

describe('1. what a cap can and cannot cover', () => {
  it('addBlob INSCRIBES: a cap of radius R reaches 0.9342R near, 0.7947R far', () => {
    // Three separate comments now cite these two numbers as the reason the
    // roster closes two joints by equal radii instead of by a cap
    // (model/actorArchetypes.js, gen/actorPrimitives.js, closureAt). This is
    // where they are measured, off the same sphereFaces the caps are built
    // from: the minimum distance from the centre to any FACE PLANE, which is
    // how far out the solid actually reaches in its worst direction.
    const inradius = (level) => {
      let worst = Infinity;
      for (const [a, b, c] of sphereFaces(level)) {
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ];
        const il = 1 / Math.hypot(n[0], n[1], n[2]);
        worst = Math.min(worst, Math.abs((n[0] * a[0] + n[1] * a[1] + n[2] * a[2]) * il));
      }
      return worst;
    };
    expect(inradius(CAP_LEVEL[0])).toBeCloseTo(0.9342, 4);
    expect(inradius(CAP_LEVEL[1])).toBeCloseTo(0.7947, 4);
    // The consequence, stated as the assertion it is: a tube RING sits at
    // exactly R (addTube places its vertices on the circle, not inside it),
    // so at the far stage a cap has to be 1/0.7947 = 1.26x the neighbouring
    // ring before it buries it. That is why "put a cap on it" is not a
    // general repair for an open joint.
    expect(1 / inradius(CAP_LEVEL[1])).toBeGreaterThan(1.25);
  });
});

// ── 2. NOTHING IS SEE-THROUGH ───────────────────────────────────────────────

describe('2. no ray crosses an actor without meeting a triangle', () => {
  for (const id of IDS) {
    for (const stage of STAGES) {
      it(`${id} ${STAGE_NAME[stage]}: ${DIRECTIONS.length} directions from every interior sample`, () => {
        const masses = archetypeById(id).masses;
        const found = passThroughs(buildActorPayload(id, stage), masses, stage);
        expect(
          found,
          `${id} s${stage}: these rays start inside the body and leave it having crossed NO triangle, `
          + 'so there are two aligned holes in the surface and a player can see the background through '
          + `this actor. ${found.length} of them:\n  ${found.slice(0, 12).join('\n  ')}`,
        ).toEqual([]);
      });
    }
  }

  it('the grid is big enough to be worth trusting', () => {
    // Anti-vacuity. An empty ARCHETYPES, or an interiorPoints that returned
    // nothing, would make every case above pass by measuring zero rays.
    const perMass = AXIAL.length * (1 + (RADIAL.length - 1) * AZIMUTHS);
    expect(perMass).toBe(51);
    expect(DIRECTIONS.length).toBe(26);
    const masses = ARCHETYPES.reduce((n, a) => n + a.masses.length, 0);
    expect(masses).toBe(45); // 11 unbound + 14 legion + 9 magistari + 11 orghon
    // 59,670 rays per stage, 119,340 across both — measured at 1.3 s.
    expect(masses * perMass * DIRECTIONS.length).toBe(59670);
  });
});

// ── 3. THE TWO JOINTS THE REVIEW FOUND ──────────────────────────────────────

describe('3. the two repaired joints, probed the way they were found', () => {
  it("magistari's shoulder: a ray straight down at 0.165 from the axis meets the robe", () => {
    // The original finding, reproduced as its own case so a regression names
    // the joint instead of appearing as one line in group 2's list. Offsets
    // bracket the old 0.16-0.17 annulus; +/-z is where the sleeves are not.
    const payload = buildActorPayload('magistari', 0);
    const robeLower = archetypeById('magistari').masses.find((m) => m.id === 'robeLower');
    for (const r of [0.155, 0.160, 0.165, 0.168]) {
      // The ray is inside robeLower's prism the whole way down: at y = 1.0 the
      // cone's radius is 0.227 and its octagonal apothem 0.210, both well
      // clear of 0.168. Asserted, not asserted-in-prose.
      const rAtY1 = robeLower.r0 + (robeLower.r1 - robeLower.r0) * (1.0 / 1.14);
      expect(rAtY1 * Math.cos(Math.PI / SEG[0])).toBeGreaterThan(r);
      for (let s = 0; s < 8; s += 1) {
        const th = (s / 8) * Math.PI * 2;
        const o = [Math.cos(th) * r, 3, Math.sin(th) * r];
        const [f] = crossings(payload, o, [0, -1, 0]);
        expect(
          f,
          `magistari: a ray straight down at radius ${r}, azimuth ${s}/8 crosses NOTHING. The shoulder `
          + 'annulus at y=1.40 is open again — robeUpper.r1 and cowlStem.r0 must stay equal so their '
          + 'rings weld (a cap cannot close this; see group 1).',
        ).toBeGreaterThan(0);
      }
    }
  });

  it("orghon's throat: the neck and head rings are the same ring, not 24 mm apart", () => {
    // The throat was never see-through — the gap was one-sided, so group 2
    // cannot catch it and this is the assertion that does. It measures the
    // MECHANISM: collinear axes at equal radius make one ring out of two.
    const orghon = archetypeById('orghon');
    const neck = orghon.masses.find((m) => m.id === 'neck');
    const head = orghon.masses.find((m) => m.id === 'head');
    const broken = { ...head, b: [0, 1.28, 0.32] }; // the shipped-before axis, 8.13 deg off
    for (const stage of STAGES) {
      expect(ringGap(neck, 'b', head, 'a', stage)).toBeLessThan(1e-4);
      expect(
        ringGap(neck, 'b', broken, 'a', stage),
        'the 8-degree fixture must really be broken, or the assertion above proves nothing',
      ).toBeGreaterThan(0.02);
    }
  });
});

// ── 4. EVERY 'ring' JOINT REALLY IS ONE RING ────────────────────────────────

/** The ring addTube built at `end` of `mass`, read back out of real addMass
 *  output. addTube interleaves ringStart[s], ringEnd[s] per segment, so `a`'s
 *  ring is the even vertex indices and `b`'s the odd ones — the same access
 *  gen/actorPrimitives.test.js's face-plate group uses. */
function ringPoints(mass, end, stage) {
  const acc = newAccumulator();
  addMass(acc, mass, { segments: SEG[stage], capLevel: CAP_LEVEL[stage], comp: compFor(stage) });
  const p = finalize(acc);
  const out = [];
  for (let s = 0; s < SEG[stage]; s += 1) {
    const vi = 2 * s + (end === 'a' ? 0 : 1);
    out.push([p.positions[vi * 3], p.positions[vi * 3 + 1], p.positions[vi * 3 + 2]]);
  }
  return out;
}

/** Worst distance from a vertex of one ring to its NEAREST twin on the other:
 *  0 when the two rings are the same set of points. */
function ringGap(mA, endA, mB, endB, stage) {
  const A = ringPoints(mA, endA, stage);
  const B = ringPoints(mB, endB, stage);
  let worst = 0;
  for (const a of A) {
    let best = Infinity;
    for (const b of B) best = Math.min(best, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    worst = Math.max(worst, best);
  }
  return worst;
}

describe("4. every 'ring' closure is an EXACT weld, measured on real vertices", () => {
  // model/actorMasses.js's closureAt decides 'ring' from equal radius plus a
  // collinear axis, and argues from basisFor's shape that the ring vertices
  // must then coincide. That argument is only as good as basisFor staying
  // what it is. This reads the actual vertices addMass emits and checks the
  // claim, for every ring joint in the roster, at both shipped stages — so a
  // change to basisFor turns the classifier into a liar loudly.
  const ringPivots = IDS.flatMap((id) => pivotsOf(id)
    .filter((p) => p.closure === 'ring')
    .map((p) => ({ id, pivot: p })));

  it('there are ring joints to check at all', () => {
    expect(ringPivots.length).toBe(5);
  });

  for (const { id, pivot } of ringPivots) {
    for (const stage of STAGES) {
      it(`${id} ${pivot.pivotId} ${STAGE_NAME[stage]}: ${pivot.massIds.join('/')} share their ring`, () => {
        const masses = archetypeById(id).masses;
        const near = (p) => Math.hypot(
          p[0] - pivot.at[0], p[1] - pivot.at[1], p[2] - pivot.at[2],
        ) <= 1e-4;
        const ends = [];
        for (const m of masses) {
          if (near(m.a)) ends.push({ m, end: 'a', r: m.r0 });
          if (near(m.b)) ends.push({ m, end: 'b', r: m.r1 });
        }
        // The welded pair is the widest equal-radius pair at this joint; the
        // narrower ends are buried inside it and are not this test's subject.
        const widest = Math.max(...ends.map((e) => e.r));
        const pair = ends.filter((e) => Math.abs(e.r - widest) < 1e-4);
        expect(pair.length, `${pivot.pivotId} has no equal-radius pair at its widest radius`)
          .toBeGreaterThanOrEqual(2);
        const gap = ringGap(pair[0].m, pair[0].end, pair[1].m, pair[1].end, stage);
        expect(
          gap,
          `${id} ${pivot.pivotId} s${stage}: ${pair[0].m.id} and ${pair[1].m.id} are ${gap.toFixed(5)} m `
          + 'apart at their shared ring. Nothing caps this joint, so that distance IS the hole.',
        ).toBeLessThan(1e-4);
      });
    }
  }
});
