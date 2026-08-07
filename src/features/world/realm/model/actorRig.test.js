/**
 * actorRig.test.js — the rig derivation and the palette, held to the numbers
 * the plan names. The canary pose has its own file, actorCanary.test.js.
 *
 * Three kinds of assertion live here and they are not interchangeable.
 *
 * PINS re-state a decision as a number: 8/6/2/5 bones, four named roots, 45
 * masses each owned exactly once. They exist so a refactor that quietly
 * re-derives a different skeleton has to argue with a diff.
 *
 * ANTI-VACUITY assertions exist because this project has shipped eight tests
 * that executed without being able to fail. Every structural claim is paired
 * with proof that the thing it polices is present: the "no ring pivot is a
 * bone" test first asserts the roster HAS five ring pivots, and the
 * identity-palette test uses `toEqual` on all sixteen floats rather than a
 * tolerance that would pass on 0.9999997 as readily as on 1.
 *
 * FIXTURE-REACHED GUARDS are the reason `buildActorRigOfMasses` is exported.
 * Every error branch in the derivation is unreachable from the four shipped
 * archetypes, because they are healthy; a guard no test can reach is one that
 * can be deleted or inverted in silence. The `describe('rejects a malformed
 * genome')` block below hands it deliberately broken mass/pivot tables.
 */
import { describe, expect, it } from 'vitest';
import { ARCHETYPES, archetypeById, pivotsOf } from './actorMasses.js';
import { buildActorRig, buildActorRigOfMasses, evaluatePose } from './actorRig.js';

const IDS = ['unbound', 'legion', 'magistari', 'orghon'];

/** The plan's locked counts. A different number here is a design change. */
const EXPECTED_BONES = { unbound: 8, legion: 6, magistari: 2, orghon: 5 };

/**
 * The named roots. All four are "heaviest mass that is not half of a mirrored
 * pair" — orghon is the one where the mirror clause decides anything: volume
 * alone picks `hipL` (0.162 m³ against torso's 0.085), which roots the whole
 * body on the LEFT HIP SLAB. Same bone count, wrong pelvis.
 */
const EXPECTED_ROOT_MASS = {
  unbound: 'torso', legion: 'torso', magistari: 'robeLower', orghon: 'torso',
};

/** Left/right pairs the root rule must refuse, by archetype. */
const MIRRORED_PAIRS = {
  unbound: [['legL', 'legR']],
  legion: [['legL', 'legR'], ['yokeL', 'yokeR'], ['armL', 'armR'], ['faceL', 'faceR'], ['crestL', 'crestR']],
  magistari: [['sleeveL', 'sleeveR'], ['cowlL', 'cowlR']],
  orghon: [['hipL', 'hipR'], ['thighL', 'thighR'], ['armLUpper', 'armRUpper'], ['armLFore', 'armRFore']],
};

const IDENTITY_16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** One bone's 16 floats out of a palette. */
const matAt = (palette, i) => Array.from(palette.subarray(i * 16, i * 16 + 16));

/** Row-vector transform of a point by bone `i`'s palette entry: p' = p·M. */
function apply(palette, i, p) {
  const o = i * 16;
  return [
    p[0] * palette[o] + p[1] * palette[o + 4] + p[2] * palette[o + 8] + palette[o + 12],
    p[0] * palette[o + 1] + p[1] * palette[o + 5] + p[2] * palette[o + 9] + palette[o + 13],
    p[0] * palette[o + 2] + p[1] * palette[o + 6] + p[2] * palette[o + 10] + palette[o + 14],
  ];
}

const dist = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);

describe('buildActorRig — topology', () => {
  it('covers the whole shipped roster', () => {
    // Guards every it.each below: an empty or renamed roster would make them
    // all trivially true.
    expect(ARCHETYPES.map((a) => a.id).sort()).toEqual([...IDS].sort());
  });

  it.each(IDS)('%s derives the bone count the plan locked', (id) => {
    expect(buildActorRig(id).bones.length).toBe(EXPECTED_BONES[id]);
  });

  it.each(IDS)('%s roots on the mass the plan names', (id) => {
    const rig = buildActorRig(id);
    const rootMass = EXPECTED_ROOT_MASS[id];
    // The root mass is the first one BFS visits, so it heads bone 0's list.
    expect(rig.bones[0].massIds[0]).toBe(rootMass);
    expect(rig.bones[0].parentIndex).toBe(-1);
    expect(rig.bones[0].boneId).toBe(`${id}.root`);
    // ...and bone 0's pivot is that mass's inboard end.
    expect([...rig.bones[0].at]).toEqual([...archetypeById(id).masses.find((m) => m.id === rootMass).a]);
  });

  it.each(IDS)('%s never roots on half of a mirrored pair', (id) => {
    // The reflection arithmetic is redone here rather than imported, so the
    // module's own mirror test is not the only thing that believes these are
    // pairs. Anti-vacuity: the list must be non-empty for the check to mean
    // anything, and every listed pair must really mirror.
    const byId = new Map(archetypeById(id).masses.map((m) => [m.id, m]));
    const pairs = MIRRORED_PAIRS[id];
    expect(pairs.length, `${id} has no mirrored pairs to refuse`).toBeGreaterThan(0);
    // `-0` and `+0` are the same point but not `toEqual`-equal, and every one
    // of these pairs has a centreline endpoint at x = 0.
    const reflect = (p) => [p[0] === 0 ? 0 : -p[0], p[1], p[2]];
    const mirrored = new Set();
    for (const [l, r] of pairs) {
      const a = byId.get(l);
      const b = byId.get(r);
      expect(reflect(a.a), `${l} vs ${r} start`).toEqual([...b.a]);
      expect(reflect(a.b), `${l} vs ${r} end`).toEqual([...b.b]);
      expect([a.r0, a.r1], `${l} vs ${r} radii`).toEqual([b.r0, b.r1]);
      mirrored.add(l).add(r);
    }
    expect(mirrored.has(EXPECTED_ROOT_MASS[id])).toBe(false);
    expect(mirrored.has(buildActorRig(id).bones[0].massIds[0])).toBe(false);
  });

  it('orghon would root on the wrong mass without the mirror clause', () => {
    // The clause is load-bearing on exactly one archetype, and this records
    // why: hipL is the heaviest mass orghon has, and rooting there puts the
    // torso — and everything above it — underneath one hip slab.
    const masses = archetypeById('orghon').masses;
    const vol = (m) => {
      const len = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]);
      const cone = ((Math.PI * len) / 3) * (m.r0 * m.r0 + m.r0 * m.r1 + m.r1 * m.r1);
      return cone + (m.capA ? (2 / 3) * Math.PI * m.r0 ** 3 : 0) + (m.capB ? (2 / 3) * Math.PI * m.r1 ** 3 : 0);
    };
    const heaviest = masses.reduce((a, b) => (vol(b) > vol(a) ? b : a));
    expect(heaviest.id).toBe('hipL');
    expect(buildActorRig('orghon').bones[0].massIds[0]).toBe('torso');
    // ...and the shipped root really is the heaviest CENTRELINE mass.
    const centreline = masses.filter((m) => m.a[0] === 0 && m.b[0] === 0);
    expect(centreline.reduce((a, b) => (vol(b) > vol(a) ? b : a)).id).toBe('torso');
  });

  it.each(IDS)('%s has parent[i] < i, with exactly one root', (id) => {
    const { bones } = buildActorRig(id);
    const roots = bones.filter((b) => b.parentIndex === -1);
    expect(roots).toHaveLength(1);
    expect(bones.indexOf(roots[0])).toBe(0);
    for (let i = 1; i < bones.length; i++) {
      expect(bones[i].parentIndex, `bone ${i} (${bones[i].boneId})`).toBeGreaterThanOrEqual(0);
      expect(bones[i].parentIndex, `bone ${i} (${bones[i].boneId})`).toBeLessThan(i);
    }
  });

  it('fuses every ring pivot — none of the five appears as a bone', () => {
    // Anti-vacuity first: if the roster ever stopped having ring joints, the
    // loop below would pass while proving nothing at all.
    const ringIds = IDS.flatMap((id) => pivotsOf(id).filter((p) => p.closure === 'ring').map((p) => p.pivotId));
    expect(ringIds).toHaveLength(5);

    const boneIds = new Set(IDS.flatMap((id) => buildActorRig(id).bones.map((b) => b.boneId)));
    expect(ringIds.filter((p) => boneIds.has(p))).toEqual([]);
  });

  it('opens exactly one bone per cap pivot, plus a root', () => {
    for (const id of IDS) {
      const capIds = pivotsOf(id).filter((p) => p.closure === 'cap').map((p) => p.pivotId);
      const { bones } = buildActorRig(id);
      expect(bones.slice(1).map((b) => b.boneId).sort(), id).toEqual([...capIds].sort());
      expect(bones.length, id).toBe(capIds.length + 1);
    }
  });

  it.each(IDS)('%s hangs every non-root bone on its own pivot coordinate', (id) => {
    const byPivotId = new Map(pivotsOf(id).map((p) => [p.pivotId, p]));
    for (const b of buildActorRig(id).bones.slice(1)) {
      expect([...b.at], b.boneId).toEqual([...byPivotId.get(b.boneId).at]);
    }
  });

  it('owns every mass exactly once — 45 across the roster', () => {
    let total = 0;
    for (const id of IDS) {
      const masses = archetypeById(id).masses;
      const rig = buildActorRig(id);
      const owned = rig.bones.flatMap((b) => b.massIds);
      expect(new Set(owned).size, `${id} duplicates a mass`).toBe(owned.length);
      expect([...owned].sort(), id).toEqual(masses.map((m) => m.id).sort());
      total += masses.length;
    }
    expect(total).toBe(45);
  });

  it.each(IDS)('%s boneOfMass agrees with the bones it built', (id) => {
    const masses = archetypeById(id).masses;
    const rig = buildActorRig(id);
    expect(rig.boneOfMass).toBeInstanceOf(Uint16Array);
    expect(rig.boneOfMass).toHaveLength(masses.length);
    masses.forEach((m, ord) => {
      const bone = rig.boneOfMass[ord];
      expect(bone, m.id).toBeLessThan(rig.bones.length);
      expect(rig.bones[bone].massIds, m.id).toContain(m.id);
    });
  });

  it.each(IDS)('%s mass/pivot incidence really is a tree', (id) => {
    // Recomputed here from the public genome, independently of the module's
    // own guard, so the guard cannot be the only thing that believes it.
    const masses = archetypeById(id).masses;
    const pivots = pivotsOf(id);
    const incidences = pivots.reduce((n, p) => n + p.massIds.length, 0);
    expect(incidences, `${id} bipartite edges`).toBe(masses.length + pivots.length - 1);
    // ...and the naive "masses joined where they share a pivot" graph is NOT a
    // tree, which is why the module asserts on the bipartite one.
    const cliqueEdges = pivots.reduce((n, p) => n + (p.massIds.length * (p.massIds.length - 1)) / 2, 0);
    expect(cliqueEdges, `${id} mass-clique edges`).toBeGreaterThan(masses.length - 1);
  });

  it('rejects an unknown archetype by name', () => {
    expect(() => buildActorRig('nosuch')).toThrow(/unknown archetype "nosuch"/);
  });

  it.each(IDS)('%s is deterministic and deep-frozen', (id) => {
    const a = buildActorRig(id);
    const b = buildActorRig(id);
    expect(a.bones).toEqual(b.bones);
    expect(Array.from(a.boneOfMass)).toEqual(Array.from(b.boneOfMass));
    expect(a).not.toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.bones)).toBe(true);
    for (const bone of a.bones) {
      expect(Object.isFrozen(bone), bone.boneId).toBe(true);
      expect(Object.isFrozen(bone.at), bone.boneId).toBe(true);
      expect(Object.isFrozen(bone.massIds), bone.boneId).toBe(true);
      // Shallow freeze would leave these writable; strict-mode ESM throws.
      expect(() => { bone.at[0] = 99; }).toThrow();
      expect(() => { bone.massIds.push('x'); }).toThrow();
    }
  });
});

/**
 * The malformed-genome fixtures. None of these shapes exists in the shipped
 * roster — that is the point: `pivotsOfMasses` makes no tree-ness promise for
 * a derived or computed mass list, and these guards are the only thing between
 * such a list and a skeleton with two parents for one mass.
 */
describe('buildActorRigOfMasses — rejects a malformed genome', () => {
  const mass = (id, a, b, over = {}) => ({ id, a, b, r0: 0.1, r1: 0.1, color: [1, 1, 1], capA: false, capB: false, ...over });
  const pivot = (pivotId, at, massIds, closure = 'cap') => ({ pivotId, at, massIds, closure });

  /** A minimal HEALTHY fixture, so the failures below are the only difference. */
  const healthyMasses = [mass('a', [0, 0, 0], [0, 1, 0]), mass('b', [0, 1, 0], [0, 2, 0])];
  const healthyPivots = [pivot('t.p0', [0, 1, 0], ['a', 'b'])];

  it('builds the healthy fixture, so the rejections below mean something', () => {
    const rig = buildActorRigOfMasses(healthyMasses, healthyPivots, 't');
    expect(rig.bones.map((b) => b.boneId)).toEqual(['t.root', 't.p0']);
    expect(rig.bones.map((b) => b.massIds)).toEqual([['a'], ['b']]);
    expect(Array.from(rig.boneOfMass)).toEqual([0, 1]);
  });

  it('a pivot naming a mass that does not exist', () => {
    expect(() => buildActorRigOfMasses(
      healthyMasses,
      [pivot('t.p0', [0, 1, 0], ['a', 'ghost'])],
      't',
    )).toThrow(/pivot t\.p0 names unknown mass "ghost"/);
  });

  it('a cycle — two pivots joining the same two masses', () => {
    expect(() => buildActorRigOfMasses(
      healthyMasses,
      [pivot('t.p0', [0, 1, 0], ['a', 'b']), pivot('t.p1', [0, 1, 0], ['a', 'b'])],
      't',
    )).toThrow(/is not a tree: 4 incidences across 4 nodes, a tree needs 3.*cycle/s);
  });

  it('a forest — a mass joined to nothing', () => {
    expect(() => buildActorRigOfMasses(healthyMasses, [], 't'))
      .toThrow(/is not a tree: 0 incidences across 2 nodes, a tree needs 1.*forest/s);
  });

  it('a joint held shut by neither mechanism', () => {
    // `closureAt` returns null when a joint is neither capped nor ring-welded.
    // Rotating one is not merely risky, it is undefined: there is nothing to
    // decide whether the bone may exist.
    expect(() => buildActorRigOfMasses(
      healthyMasses,
      [pivot('t.p0', [0, 1, 0], ['a', 'b'], null)],
      't',
    )).toThrow(/pivot t\.p0 has closure null: neither mechanism holds it shut/);
  });

  it('a disconnected graph that still has the right edge count', () => {
    // The edge count alone cannot see this: 6 incidences across 7 nodes is
    // exactly nodes-1, but it is a tree PLUS a separate cycle, so the connected
    // half of the proof has to be the BFS itself.
    const masses = [
      mass('a', [0, 0, 0], [0, 1, 0], { r0: 0.5, r1: 0.5 }), // heaviest -> root
      mass('b', [0, 1, 0], [0, 2, 0]),
      mass('c', [1, 0, 0], [1, 1, 0]),
      mass('d', [1, 1, 0], [1, 2, 0]),
    ];
    const pivots = [
      pivot('t.p0', [0, 1, 0], ['a', 'b']),
      pivot('t.p1', [1, 1, 0], ['c', 'd']),
      pivot('t.p2', [1, 1, 0], ['c', 'd']),
    ];
    expect(pivots.reduce((n, p) => n + p.massIds.length, 0)).toBe(masses.length + pivots.length - 1);
    expect(() => buildActorRigOfMasses(masses, pivots, 't'))
      .toThrow(/is disconnected: masses \[c,d\] and pivots \[t\.p1,t\.p2\] are unreachable from root "a"/);
  });

  it('derives the shipped rigs identically through the seam', () => {
    // The wrapper must add nothing but genome lookup.
    for (const id of IDS) {
      const direct = buildActorRigOfMasses(archetypeById(id).masses, pivotsOf(id), id);
      const wrapped = buildActorRig(id);
      expect(direct.bones, id).toEqual(wrapped.bones);
      expect(Array.from(direct.boneOfMass), id).toEqual(Array.from(wrapped.boneOfMass));
    }
  });
});

describe('evaluatePose — the palette', () => {
  it.each(IDS)('%s rest palette is BIT-EXACT identity', (id) => {
    const rig = buildActorRig(id);
    const palette = evaluatePose(rig, {});
    expect(palette).toBeInstanceOf(Float32Array);
    expect(palette).toHaveLength(rig.bones.length * 16);
    for (let i = 0; i < rig.bones.length; i++) {
      // `toEqual`, never `toBeCloseTo`: the whole point is that no rounding
      // happened. 0.9999999403953552 would satisfy a tolerance and would mean
      // the pivot conjugation was composed numerically instead of as at-at·R.
      expect(matAt(palette, i), `${id} bone ${i} (${rig.bones[i].boneId})`).toEqual(IDENTITY_16);
    }
  });

  it.each(IDS)('%s rest palette is identity for an explicit zero-angle pose too', (id) => {
    // The axis has a ZERO COMPONENT on purpose. `at - at·R` then produces
    // genuine -0 entries, and `toEqual` uses Object.is, so this assertion only
    // holds because evaluatePose canonicalises negative zero on the way out.
    // Without that, the rest palette compares unequal to the identity it
    // numerically IS — the exact trap Task 4's element-wise oracle would hit.
    const rig = buildActorRig(id);
    const zero = Object.fromEntries(rig.bones.map((_, i) => [i, { axis: [0.6, 0, -0.8], angleRad: 0 }]));
    const palette = evaluatePose(rig, zero);
    for (let i = 0; i < rig.bones.length; i++) {
      expect(matAt(palette, i), `${id} bone ${i}`).toEqual(IDENTITY_16);
      for (const v of matAt(palette, i)) expect(Object.is(v, -0), `${id} bone ${i} kept a -0`).toBe(false);
    }
  });

  it('canonicalises negative zero in a posed palette too', () => {
    // Anti-vacuity for the clause above: a pose that WOULD emit -0 without it.
    //
    // THE SIGN OF THE AXIS IS THE ENTIRE TEST. This case used to run
    // `axis [0, 1, 0], angleRad: PI` and could not fail under the mutation its
    // own name promises — delete evaluatePose's canonicalisation and that pose
    // emits no -0 anywhere, so the assertion passed on both sides.
    //
    // The two paths mint -0 differently, which is why the rest-pose case above
    // does not cover this one. At angle 0, `t = 1 - cos` is EXACTLY 0, so
    // `t*ax*az` is a zero times whatever sign `az` carries and the -0 appears
    // for any negative component at all (that case uses [0.6, 0, -0.8]). At a
    // real angle `t` and `s` are both non-zero, so the only zero products left
    // are the ones a ZERO axis component makes — and `(t*0)*c` is -0 only when
    // `c` is itself negative. `[0, 1, 0]` has no negative component, so every
    // zero product in it is `+0` and the canonicalisation had nothing to do.
    // `[0, -1, 0]` at a real angle puts a genuine -0 in palette elements 4 and
    // 9 (`t*ax*ay - s*az` and `t*ay*az - s*ax`), measured.
    const bones = [{ boneId: 'root', at: [0, 1, 0], parentIndex: -1, massIds: [] }];
    const ANGLE = 0.7;
    // The -0-minting arithmetic, asserted in the open rather than trusted to
    // the axis literal: a future edit that "tidies" the axis back to something
    // all-positive fails HERE, with this message, instead of going quietly
    // toothless again.
    const t = 1 - Math.cos(ANGLE);
    expect(
      Object.is(t * 0 * -1 - Math.sin(ANGLE) * 0, -0),
      'this axis no longer mints a -0, so the assertion below cannot fail',
    ).toBe(true);
    const palette = evaluatePose({ bones }, { 0: { axis: [0, -1, 0], angleRad: ANGLE } });
    expect(Array.from(palette).some((v) => Object.is(v, -0))).toBe(false);
    // ...and the rotation itself is real, not a dressed-up identity: 0.7 rad
    // about -Y swings +x toward +z.
    expect(matAt(palette, 0)).not.toEqual(IDENTITY_16);
    expect(apply(palette, 0, [1, 0, 0])[2]).toBeCloseTo(Math.sin(ANGLE), 6);
    expect(apply(palette, 0, [1, 0, 0])[0]).toBeCloseTo(Math.cos(ANGLE), 6);
  });

  it.each(IDS)('%s evaluatePose is deterministic and uncached', (id) => {
    const rig = buildActorRig(id);
    const pose = { 1: { axis: [1, 0, 0], angleRad: 0.2 } };
    const a = evaluatePose(rig, pose);
    const b = evaluatePose(rig, pose);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a).not.toBe(b);
    // Scribbling on one palette cannot reach the next: there is no cache.
    a[0] = 42;
    expect(Array.from(evaluatePose(rig, pose))).toEqual(Array.from(b));
  });

  it('refuses a forward parent reference', () => {
    const bones = [
      { boneId: 'a', at: [0, 0, 0], parentIndex: 1, massIds: [] },
      { boneId: 'b', at: [0, 1, 0], parentIndex: -1, massIds: [] },
    ];
    expect(() => evaluatePose({ bones }, {})).toThrow(/requires parent < index/);
  });

  it('refuses a non-unit rotation axis, naming the bone', () => {
    // Rodrigues assumes |axis| = 1. A scaled axis returns a matrix that scales
    // and shears instead of rotating, and every downstream gate would then
    // measure the wrong body without anything failing.
    const bones = [{ boneId: 'solo', at: [0, 1, 0], parentIndex: -1, massIds: [] }];
    expect(() => evaluatePose({ bones }, { 0: { axis: [0, 2, 0], angleRad: 0.3 } }))
      .toThrow(/bone 0 \(solo\) has a non-unit pose axis, \|axis\| = 2/);
    expect(() => evaluatePose({ bones }, { 0: { axis: [0, 0, 0], angleRad: 0.3 } }))
      .toThrow(/non-unit pose axis/);
    // A unit axis passes, so the guard is not simply rejecting everything.
    expect(() => evaluatePose({ bones }, { 0: { axis: [0, 1, 0], angleRad: 0.3 } })).not.toThrow();
  });

  it.each(IDS)('%s palette entries stay rigid under an arbitrary pose', () => {
    // Rotation about a pivot is length-preserving. A palette row that lost
    // orthonormality would shear the mesh and no bone-count pin would notice.
    const rig = buildActorRig(IDS[0]);
    const pose = Object.fromEntries(rig.bones.map((_, i) => [i, { axis: [0, 0, 1], angleRad: 0.11 * (i + 1) }]));
    const palette = evaluatePose(rig, pose);
    for (let i = 0; i < rig.bones.length; i++) {
      const p = apply(palette, i, [0.3, -0.7, 0.2]);
      const q = apply(palette, i, [-0.4, 0.1, 0.9]);
      expect(dist(p, q), `bone ${i}`).toBeCloseTo(dist([0.3, -0.7, 0.2], [-0.4, 0.1, 0.9]), 6);
    }
  });
});

describe('evaluatePose — hand-computed fixtures', () => {
  /**
   * ONE JOINT, 90 DEGREES, ARITHMETIC IN FULL.
   *
   * Bone 1 pivots at `at = (0, 1, 0)` and rotates 90 degrees about the world X
   * axis. In the row-vector convention this module shares with
   * model/instanceMatrix.js, Rodrigues with axis (1,0,0), s = sin 90 = 1,
   * c = cos 90 = 0, t = 1 - c = 1 gives the row-major rows
   *
   *   row0 = [t·1·1 + c, t·1·0 + s·0, t·1·0 - s·0] = [1,  0, 0]
   *   row1 = [t·1·0 - s·0, t·0·0 + c, t·0·0 + s·1] = [0,  0, 1]
   *   row2 = [t·1·0 + s·0, t·0·0 - s·1, t·0·0 + c] = [0, -1, 0]
   *
   * so +Y maps to +Z. The conjugation's translation is `at - at·R`:
   *   at·R = (0,1,0)·R = row1 = (0, 0, 1)
   *   t    = (0,1,0) - (0,0,1) = (0, 1, -1)
   *
   * Take the point p = (0, 2, 0) — one metre straight above the pivot.
   *   p·R = 2·row1      = (0, 0, 2)
   *   p'  = p·R + t     = (0, 0, 2) + (0, 1, -1) = (0, 1, 1)
   *
   * Which is the geometric answer read off the page: the pivot is at (0,1,0),
   * p is one metre along +Y from it, and a 90-degree turn that carries +Y to
   * +Z lands it one metre along +Z from the pivot — (0, 1, 1).
   */
  it('rotates a known point 90 degrees about a single joint', () => {
    const bones = [
      { boneId: 'root', at: [0, 0, 0], parentIndex: -1, massIds: [] },
      { boneId: 'joint', at: [0, 1, 0], parentIndex: 0, massIds: [] },
    ];
    const palette = evaluatePose({ bones }, { 1: { axis: [1, 0, 0], angleRad: Math.PI / 2 } });

    const image = apply(palette, 1, [0, 2, 0]);
    expect(image[0]).toBeCloseTo(0, 12);
    expect(image[1]).toBeCloseTo(1, 12);
    expect(image[2]).toBeCloseTo(1, 12);

    // The pivot itself is the fixed point of its own joint.
    const fixed = apply(palette, 1, [0, 1, 0]);
    expect(fixed.map((v) => Number(v.toFixed(12)))).toEqual([0, 1, 0]);

    // The unposed root is untouched.
    expect(matAt(palette, 0)).toEqual(IDENTITY_16);
  });

  /**
   * TWO JOINTS, AND THE COMPOSITION ORDER THAT DISTINGUISHES THEM.
   *
   * Root pivots at the origin and turns 90 degrees about +Y; child pivots at
   * (0,1,0) and turns 90 degrees about +X (the same joint as above).
   *
   * Row-vector RotationY(90): s = 1, c = 0 gives rows
   *   row0 = [c, 0, -s] = [0, 0, -1]
   *   row1 = [0, 1,  0] = [0, 1,  0]
   *   row2 = [s, 0,  c] = [1, 0,  0]
   *
   * A point on the CHILD is articulated by the child's joint first, then by
   * the root's — `M_child = A_child · A_root` in row-vector order. Taking
   * p = (0, 2, 0) again:
   *   after the child joint   p1 = (0, 1, 1)          [derived above]
   *   after the root joint    p2 = p1 · Ry
   *                              = 0·row0 + 1·row1 + 1·row2
   *                              = (0,1,0) + (1,0,0) = (1, 1, 0)
   *
   * The mirrored composition `A_root · A_child` would instead rotate p about
   * +Y first — p is on the Y axis, so it does not move — and then apply the
   * child joint, landing on (0, 1, 1). The two answers differ, which is the
   * whole reason this fixture exists.
   */
  it('composes a two-joint chain child-first', () => {
    const bones = [
      { boneId: 'root', at: [0, 0, 0], parentIndex: -1, massIds: [] },
      { boneId: 'joint', at: [0, 1, 0], parentIndex: 0, massIds: [] },
    ];
    const palette = evaluatePose({ bones }, {
      0: { axis: [0, 1, 0], angleRad: Math.PI / 2 },
      1: { axis: [1, 0, 0], angleRad: Math.PI / 2 },
    });

    const image = apply(palette, 1, [0, 2, 0]);
    expect(image[0]).toBeCloseTo(1, 12);
    expect(image[1]).toBeCloseTo(1, 12);
    expect(image[2]).toBeCloseTo(0, 12);
    // Not the mirrored order's answer.
    expect(dist(image, [0, 1, 1])).toBeGreaterThan(1);
  });

  it('writes the row-vector layout the engine skeleton expects', () => {
    // Translation in elements 12..14, w column 0,0,0,1 — the layout
    // Skeleton.getTransformMatrices emits and model/instanceMatrix.js writes.
    const bones = [{ boneId: 'root', at: [0, 3, 0], parentIndex: -1, massIds: [] }];
    const palette = evaluatePose({ bones }, { 0: { axis: [1, 0, 0], angleRad: Math.PI / 2 } });
    expect([palette[3], palette[7], palette[11], palette[15]]).toEqual([0, 0, 0, 1]);
    // at - at·R with at = (0,3,0) and +Y -> +Z is (0,3,0) - (0,0,3) = (0,3,-3).
    expect(palette[12]).toBeCloseTo(0, 12);
    expect(palette[13]).toBeCloseTo(3, 12);
    expect(palette[14]).toBeCloseTo(-3, 12);
    // ...and the rotation is NOT its own transpose here, so a transposed store
    // would move element 1 and element 4 into each other's slots.
    expect(palette[6]).toBeCloseTo(1, 12);
    expect(palette[9]).toBeCloseTo(-1, 12);
  });
});
