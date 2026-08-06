/**
 * actorMasses.test.js — the TABLE's structural invariants, and only those.
 *
 * Silhouette gating (window fit, pairwise IoU, LOD fidelity, band occupancy
 * against bandTargets) belongs to gen/actorSilhouette.test.js — it needs the
 * generator that turns masses into triangles, which is a later task, and
 * duplicating a weaker version of it here would mean two places to update
 * when the roster is retuned. What is testable from the data alone is:
 * the table is genuinely immutable, every archetype is fully populated, the
 * banned tessellation level stays banned, lookup is Map-backed, and the
 * joint table pivotsOf derives is the one the masses were authored to have.
 *
 * Covers BOTH halves of the split (actorMasses.js + actorArchetypes.js) from
 * one file, and imports through actorMasses.js exactly as Tasks 4-6 are told
 * to — so this suite exercises the public surface rather than a shortcut.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARCHETYPES, CAP_LEVEL, FAR_COMP, PIVOT_EPS, SEG, archetypeById, pivotsOf, pivotsOfMasses,
} from './actorMasses.js';
import { ARCHETYPES as ARCHETYPES_DIRECT } from './actorArchetypes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'actorMasses.js'), 'utf8');
const TABLE_SOURCE = readFileSync(join(HERE, 'actorArchetypes.js'), 'utf8');

const FACTION_IDS = ['unbound', 'legion', 'magistari', 'orghon'];

describe('roster shape', () => {
  it('is exactly the four factions, in their locked ids', () => {
    expect(ARCHETYPES.map((a) => a.id)).toEqual(FACTION_IDS);
    expect(ARCHETYPES.map((a) => a.factionId)).toEqual(FACTION_IDS);
  });

  it('every archetype carries every required field', () => {
    for (const a of ARCHETYPES) {
      expect(typeof a.displayName, a.id).toBe('string');
      expect(a.displayName.length, a.id).toBeGreaterThan(0);
      expect(a.stages, a.id).toBe(SEG.length);
      expect(a.bandTargets.length, a.id).toBe(3);
      // bandOccupancy against two interior edges returns three bands whose
      // fractions sum to ~1 — a declared target that does not is a typo, and
      // would otherwise only surface as a confusing tolerance failure later.
      const sum = a.bandTargets.reduce((s, v) => s + v, 0);
      expect(sum, `${a.id} bandTargets must sum to ~1`).toBeCloseTo(1, 2);
      for (const t of a.bandTargets) expect(t, a.id).toBeGreaterThanOrEqual(0);
      expect(a.masses.length, a.id).toBeGreaterThan(0);
    }
  });

  it('every mass is a well-formed capsule with a unique id', () => {
    for (const a of ARCHETYPES) {
      const seen = new Set();
      for (const m of a.masses) {
        const where = `${a.id}.${m.id}`;
        expect(seen.has(m.id), `${where} duplicated`).toBe(false);
        seen.add(m.id);
        expect(m.a.length, where).toBe(3);
        expect(m.b.length, where).toBe(3);
        for (const v of [...m.a, ...m.b]) expect(Number.isFinite(v), where).toBe(true);
        expect(m.r0, where).toBeGreaterThan(0);
        expect(m.r1, where).toBeGreaterThan(0);
        expect(typeof m.capA, where).toBe('boolean');
        expect(typeof m.capB, where).toBe('boolean');
        expect(m.color.length, where).toBe(3);
        for (const c of m.color) {
          expect(c, `${where} colour channel out of [0,1]`).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        }
        // A zero-length axis makes basisFor's segment direction degenerate.
        // Floor is a literal 2 cm, NOT PIVOT_EPS: keying it to the joint
        // tolerance meant a mutation setting PIVOT_EPS to 0 silently
        // downgraded this to `len > 0`, and two constants that can quietly
        // cross are two constants that eventually do.
        const len = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]);
        expect(len, `${where} has a degenerate axis`).toBeGreaterThan(0.02);
      }
    }
  });
});

describe('the table is DEEP frozen', () => {
  // Object.freeze is shallow. These assert the nested writes actually fail to
  // take effect — not merely that Object.isFrozen returns true, which a
  // one-level freeze would also satisfy while leaving every [x, y, z] and
  // every mass object writable underneath it.
  const mutate = (fn) => {
    try { fn(); } catch { /* strict mode throws; module scope may not */ }
  };

  it('an archetype cannot gain or lose a field', () => {
    const a = archetypeById('orghon');
    mutate(() => { a.stages = 99; });
    mutate(() => { a.displayName = 'clobbered'; });
    expect(a.stages).toBe(2);
    expect(a.displayName).toBe('Orghon');
  });

  it('the masses array cannot be appended to or reordered', () => {
    const a = archetypeById('legion');
    const before = a.masses.length;
    const first = a.masses[0];
    mutate(() => a.masses.push({ id: 'ghost' }));
    mutate(() => { a.masses[0] = { id: 'swapped' }; });
    expect(a.masses.length).toBe(before);
    expect(a.masses[0]).toBe(first);
  });

  it('a mass radius cannot be retuned in place', () => {
    const m = archetypeById('magistari').masses.find((x) => x.id === 'robeLower');
    const before = m.r0;
    mutate(() => { m.r0 = 9.5; });
    expect(m.r0).toBe(before);
  });

  it('a mass endpoint coordinate cannot be nudged — the aliasing case', () => {
    // The specific bug this guards: a spread-derived archetype shares the
    // base's [x, y, z] arrays, so one write here would move a joint on every
    // archetype derived from this one.
    //
    // BOTH endpoints, deliberately. An earlier version of this test nudged
    // only `a`, and deleting `Object.freeze(m.b)` alone left the whole suite
    // green — half of every joint coordinate unguarded, which is exactly the
    // aliasing case the header describes.
    const m = archetypeById('unbound').masses.find((x) => x.id === 'fist');
    const beforeA = [...m.a];
    const beforeB = [...m.b];
    const beforeColor = [...m.color];
    mutate(() => { m.a[1] = 42; });
    mutate(() => { m.b[1] = 42; });
    mutate(() => { m.color[0] = 42; });
    expect([...m.a]).toEqual(beforeA);
    expect([...m.b]).toEqual(beforeB);
    expect([...m.color]).toEqual(beforeColor);
  });

  it('freezes both endpoints of EVERY mass, not just the ones spot-checked', () => {
    for (const arch of ARCHETYPES) {
      for (const m of arch.masses) {
        expect(Object.isFrozen(m.a), `${arch.id}.${m.id}.a`).toBe(true);
        expect(Object.isFrozen(m.b), `${arch.id}.${m.id}.b`).toBe(true);
        expect(Object.isFrozen(m.color), `${arch.id}.${m.id}.color`).toBe(true);
        expect(Object.isFrozen(m), `${arch.id}.${m.id}`).toBe(true);
      }
      expect(Object.isFrozen(arch.masses), arch.id).toBe(true);
      expect(Object.isFrozen(arch.bandTargets), arch.id).toBe(true);
    }
  });

  it('bandTargets cannot be edited to match a drifted measurement', () => {
    const a = archetypeById('unbound');
    const before = [...a.bandTargets];
    mutate(() => { a.bandTargets[0] = 0.99; });
    expect([...a.bandTargets]).toEqual(before);
  });

  it('the stage constant arrays are frozen too', () => {
    mutate(() => { SEG[1] = 3; });
    mutate(() => { CAP_LEVEL[1] = 0; });
    expect([...SEG]).toEqual([8, 6]);
    expect([...CAP_LEVEL]).toEqual([2, 1]);
  });
});

describe('stage constants', () => {
  it('CAP_LEVEL never contains 0', () => {
    // sphereFaces(0) is an octahedron: its filled projection is a diamond at
    // ~64% of the equivalent sphere's area, measured. Anything silhouette-
    // gated that uses it loses a third of every cap's outline at range.
    expect(CAP_LEVEL).not.toContain(0);
    for (const lvl of CAP_LEVEL) expect(lvl).toBeGreaterThanOrEqual(1);
  });

  it('coarser stages really are coarser, never finer', () => {
    for (let s = 1; s < SEG.length; s++) {
      expect(SEG[s], `SEG stage ${s}`).toBeLessThanOrEqual(SEG[s - 1]);
      expect(CAP_LEVEL[s], `CAP_LEVEL stage ${s}`).toBeLessThanOrEqual(CAP_LEVEL[s - 1]);
    }
    expect(SEG.length).toBe(CAP_LEVEL.length);
  });

  it('far segments can hold a width envelope with margin', () => {
    // A ring's projected width varies with yaw, and widthDeltaFrac is a MAX
    // over yaws, so the swing is what a single scalar FAR_COMP has to absorb.
    // For even n the extremes are 2r·cos(pi/n) and 2r; for odd n they are
    // r(1 + cos(pi/n)) and 2r·cos(pi/2n), a much smaller spread —
    // n=4 swings 1.414r-2.000r (29%), n=5 only 1.809r-1.902r (4.9%), n=6
    // 1.732r-2.000r (13.4%). n=4 is the outlier, and measured it passes all
    // three LOD gates only for comp in 1.0875-1.0975, at 98-99% of the width
    // gate. Five is the floor where a workable margin exists at all.
    expect(SEG[SEG.length - 1]).toBeGreaterThanOrEqual(5);
  });

  it('FAR_COMP compensates without inflating', () => {
    // It must widen the far stage (a coarser ring inscribes a smaller shape)
    // but a large value overshoots the near stage's envelope in the other
    // direction — 1.10 measures widthDeltaFrac exactly 0.100 against the 0.10
    // gate, so anything near that is a coin flip dressed as a pass.
    expect(FAR_COMP).toBeGreaterThan(1);
    expect(FAR_COMP).toBeLessThan(1.10);
  });
});

describe('archetypeById', () => {
  it('returns the very same frozen object the table holds', () => {
    for (const a of ARCHETYPES) expect(archetypeById(a.id)).toBe(a);
  });

  it('returns undefined for unknown ids — same contract as prototypeById', () => {
    for (const bogus of ['', 'Unbound', 'unbound ', 'legion2', 'toString', '__proto__']) {
      expect(archetypeById(bogus), bogus).toBeUndefined();
    }
  });

  it('survives non-string keys without throwing', () => {
    for (const bogus of [undefined, null, 0, {}]) expect(archetypeById(bogus)).toBeUndefined();
  });

  it('is Map-backed, not a linear find', () => {
    // Structural, because the reason is scale, not behaviour: a roster
    // spanning species x class x faction outgrows the props' 7-entry scan,
    // and the lookup sits on the per-actor spawn path. Behaviour alone cannot
    // distinguish the two implementations at four entries. Both halves of the
    // split are scanned — a linear lookup could be reintroduced in either.
    expect(SOURCE).toMatch(/new Map\(/);
    expect(SOURCE).not.toMatch(/ARCHETYPES\.find\(/);
    expect(TABLE_SOURCE).not.toMatch(/ARCHETYPES\.find\(/);
    expect(archetypeById.toString()).toMatch(/\.get\(/);
  });
});

/**
 * The tables were split into actorArchetypes.js when the combined file hit
 * 394 lines against a 400 ceiling. These pin the properties that split relies
 * on, so a later edit cannot quietly undo them.
 */
describe('the actorMasses / actorArchetypes split', () => {
  it('re-exports the SAME frozen objects, not a copy', () => {
    // Downstream is told to import everything from actorMasses.js. If the
    // re-export ever became a clone, identity comparisons (archetypeById(id)
    // === ARCHETYPES[i]) would silently start failing for direct importers.
    expect(ARCHETYPES).toBe(ARCHETYPES_DIRECT);
    for (const a of ARCHETYPES_DIRECT) expect(archetypeById(a.id)).toBe(a);
  });

  it('keeps actorArchetypes.js a ZERO-IMPORT leaf', () => {
    // This is the whole reason freezeArchetype lives beside the tables rather
    // than with the rest of the vocabulary. Helper in actorMasses.js + tables
    // here is a real ESM cycle, and its failure is order-dependent: importing
    // actorMasses.js first happens to work (hoisted function declaration),
    // while importing actorArchetypes.js first throws "Cannot access
    // 'ARCHETYPES' before initialization" as actorMasses builds its Map.
    // Verified against a reproduction, not theorised. A leaf cannot have that
    // problem in either order — so it has to stay a leaf.
    expect(TABLE_SOURCE).not.toMatch(/^\s*import\s/m);
    expect(TABLE_SOURCE).not.toMatch(/\bfrom\s*['"]/);
  });

  it('still applies the deep freeze wherever the helper now lives', () => {
    expect(TABLE_SOURCE).toMatch(/function freezeArchetype/);
    // Belt and braces with the freeze block above: the tables must be frozen
    // as seen through BOTH import paths, since they are the same objects.
    for (const a of ARCHETYPES_DIRECT) {
      expect(Object.isFrozen(a), a.id).toBe(true);
      expect(Object.isFrozen(a.masses), a.id).toBe(true);
    }
  });
});

describe('pivotsOf', () => {
  it('throws on an unknown archetype rather than returning nothing', () => {
    expect(() => pivotsOf('nosuch')).toThrow(/\[actorMasses\] unknown archetype "nosuch"/);
  });

  it('finds the pelvis, chest and neck joints Unbound was authored with', () => {
    const byId = new Map(pivotsOf('unbound').map((p) => [p.pivotId, p]));
    const at = (y) => [...byId.values()].find((p) => Math.abs(p.at[1] - y) < 1e-9);

    const pelvis = at(0.88);
    expect(pelvis.at).toEqual([0, 0.88, 0]);
    expect([...pelvis.massIds].sort()).toEqual(['legL', 'legR', 'torso']);

    const chest = at(1.40);
    expect([...chest.massIds].sort()).toEqual(['neck', 'torso', 'yokeL', 'yokeR']);

    const neckTop = at(1.52);
    expect([...neckTop.massIds].sort()).toEqual(['head', 'neck']);
  });

  it('chains the graft arm shoulder -> elbow -> wrist', () => {
    const chain = pivotsOf('unbound').filter((p) => p.massIds.some((id) => id.startsWith('graft')));
    expect(chain.map((p) => [...p.massIds].sort())).toEqual([
      ['graftUpper', 'yokeR'],
      ['graftFore', 'graftUpper'],
      ['fist', 'graftFore'],
    ]);
  });

  it('gives every archetype a connected joint table', () => {
    // The "P7 topology for free" claim is only true if the masses were
    // authored to share endpoints. An earlier draft placed limbs where they
    // looked right and Legion returned ZERO pivots — the regression this
    // catches is silent, because the geometry still renders fine.
    for (const a of ARCHETYPES) {
      const pivots = pivotsOf(a.id);
      expect(pivots.length, `${a.id} has no joints`).toBeGreaterThanOrEqual(4);
      const jointed = new Set(pivots.flatMap((p) => p.massIds));
      // Every mass must meet at least one other mass. A floating mass is a
      // bone P7 could never parent, and visually a detached blob.
      for (const m of a.masses) {
        expect(jointed.has(m.id), `${a.id}.${m.id} touches nothing`).toBe(true);
      }
    }
  });

  it('emits plain, unique, deterministic data — no bones, no classes', () => {
    for (const a of ARCHETYPES) {
      const first = pivotsOf(a.id);
      expect(JSON.stringify(pivotsOf(a.id))).toBe(JSON.stringify(first));
      const ids = first.map((p) => p.pivotId);
      expect(new Set(ids).size, `${a.id} pivotIds collide`).toBe(ids.length);
      for (const p of first) {
        expect(p.pivotId.startsWith(`${a.id}.`), p.pivotId).toBe(true);
        expect(Object.getPrototypeOf(p)).toBe(Object.prototype);
        expect(p.at.length).toBe(3);
        // A pivot exists only where two or more masses actually meet.
        expect(p.massIds.length, p.pivotId).toBeGreaterThan(1);
        expect(new Set(p.massIds).size).toBe(p.massIds.length);
      }
    }
  });

  it("reports each joint at an authored coordinate, never a cluster average", () => {
    for (const a of ARCHETYPES) {
      const endpoints = a.masses.flatMap((m) => [m.a, m.b]);
      for (const p of pivotsOf(a.id)) {
        const exact = endpoints.some((e) => e[0] === p.at[0] && e[1] === p.at[1] && e[2] === p.at[2]);
        expect(exact, `${p.pivotId} is not an authored endpoint`).toBe(true);
      }
      // ...and every mass at that joint really is within tolerance of it.
      for (const p of pivotsOf(a.id)) {
        for (const id of p.massIds) {
          const m = a.masses.find((x) => x.id === id);
          const d = (e) => Math.hypot(e[0] - p.at[0], e[1] - p.at[1], e[2] - p.at[2]);
          expect(Math.min(d(m.a), d(m.b)), `${p.pivotId}/${id}`).toBeLessThanOrEqual(PIVOT_EPS);
        }
      }
    }
  });
});

/**
 * PIVOT_EPS is the one constant the shipped data cannot exercise: every joint
 * in the table is authored EXACTLY equal, so the tolerance never decides
 * anything and a mutation could set it to 0 (exact equality) or to 0.05
 * (500x, welding unrelated masses) with the rest of this file still green.
 * These fixtures pin it from both sides — which is the whole reason
 * pivotsOfMasses is exported separately from pivotsOf.
 */
describe('PIVOT_EPS tolerance, pinned with fixtures', () => {
  const mass = (id, a, b) => ({ id, a, b, r0: 0.1, r1: 0.1, color: [0, 0, 0], capA: false, capB: false });

  it('joins endpoints inside the tolerance', () => {
    const under = PIVOT_EPS / 2; // 5e-5
    const pivots = pivotsOfMasses([
      mass('parent', [0, 0, 0], [0, 1, 0]),
      mass('child', [0, 1 + under, 0], [0.5, 1.5, 0]),
    ], 'fx');
    expect(pivots.length).toBe(1);
    expect([...pivots[0].massIds].sort()).toEqual(['child', 'parent']);
    // ...at the first authored coordinate, not the midpoint of the two.
    expect(pivots[0].at).toEqual([0, 1, 0]);
  });

  it('does NOT join endpoints outside the tolerance', () => {
    const over = PIVOT_EPS * 2; // 2e-4
    const pivots = pivotsOfMasses([
      mass('parent', [0, 0, 0], [0, 1, 0]),
      mass('child', [0, 1 + over, 0], [0.5, 1.5, 0]),
    ], 'fx');
    expect(pivots).toEqual([]);
  });

  it('groups transitively — an A-B-C chain is ONE joint, not two', () => {
    // Greedy first-match clustering compares each endpoint only against the
    // first-seen member of a cluster, so a chain where A~B and B~C but A!~C
    // splits one physical joint in two, depending on table order. Invisible
    // while every coordinate is typed by hand; a real bug the moment one is
    // computed. Spacing: each step is 0.7*EPS, so A-C is 1.4*EPS apart.
    const step = PIVOT_EPS * 0.7;
    const pivots = pivotsOfMasses([
      mass('a', [0, 0, 0], [0, 1, 0]),
      mass('b', [0, 1 + step, 0], [1, 2, 0]),
      mass('c', [0, 1 + 2 * step, 0], [-1, 2, 0]),
    ], 'fx');
    expect(Math.hypot(0, 2 * step, 0)).toBeGreaterThan(PIVOT_EPS); // a and c are NOT direct neighbours
    expect(pivots.length, 'a-b-c is one physical joint').toBe(1);
    expect([...pivots[0].massIds].sort()).toEqual(['a', 'b', 'c']);
  });

  it('is small enough to never weld two genuinely different joints', () => {
    // Guards the other direction of the same mutation: the closest pair of
    // DISTINCT joints anywhere in the shipped roster must stay far outside
    // the tolerance, or PIVOT_EPS is silently fusing the skeleton.
    let closest = Infinity;
    for (const a of ARCHETYPES) {
      const pivots = pivotsOf(a.id);
      for (let i = 0; i < pivots.length; i++) {
        for (let j = i + 1; j < pivots.length; j++) {
          const [p, q] = [pivots[i].at, pivots[j].at];
          closest = Math.min(closest, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
        }
      }
    }
    // Measured: the closest distinct joints in the roster are 0.12 m apart,
    // 1200x the tolerance. The floor here is 100x, which leaves room for a
    // denser future skeleton without leaving room for a silent weld.
    expect(closest).toBeGreaterThan(PIVOT_EPS * 100);
  });
});

describe('bandTargets actually separate the roster', () => {
  it('no two archetypes declare a confusable band histogram', () => {
    // bandTargets is called the LEADING indicator of roster separation, but
    // nothing else in this file would notice if all four declared
    // [0.33, 0.33, 0.34]. Task 5 gates the measured values against these
    // declarations; this gates the declarations against EACH OTHER, so the
    // file is self-guarding rather than trusting a downstream suite.
    let worst = Infinity;
    let worstPair = '';
    for (let i = 0; i < ARCHETYPES.length; i++) {
      for (let j = i + 1; j < ARCHETYPES.length; j++) {
        const [x, y] = [ARCHETYPES[i], ARCHETYPES[j]];
        const l1 = x.bandTargets.reduce((s, v, k) => s + Math.abs(v - y.bandTargets[k]), 0);
        if (l1 < worst) { worst = l1; worstPair = `${x.id}/${y.id}`; }
      }
    }
    // Measured worst pair is magistari/orghon, the roster's two bottom-heavy
    // bodies. Floor is 0.25 — comfortably above 2x the +/-0.06 per-band
    // tolerance Task 5 asserts with, and well under the measured value, so
    // this fails on a real regression rather than on normal retuning.
    expect(worst, `closest band histograms: ${worstPair}`).toBeGreaterThan(0.25);
  });
});
