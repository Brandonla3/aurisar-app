/**
 * actorCanary.test.js — the pose that keeps every downstream skinning gate
 * from passing vacuously, and the assertions that keep the POSE from being
 * vacuous in turn.
 *
 * The load-bearing test here is ORTHOGONALITY, not displacement. An earlier
 * version argued that asserting the axis rule "would just restate the
 * implementation" and checked only that things moved. Review disproved it by
 * replacing `orthogonalAxis(limbDirection(b))` with `limbDirection(b)` — every
 * canary becomes the pure twist the module's own header warns about — and only
 * two tests on one of four archetypes went red. Orthogonality is the DESIGN
 * property; the arithmetic that computes it is not. Both are now checked, and
 * the displacement guardrail is two-sided so a canary that stops articulating
 * fails from below as well as a canary that leaves the envelope fails above.
 */
import { describe, expect, it } from 'vitest';
import { ARCHETYPES, archetypeById } from './actorMasses.js';
import { buildActorRig, evaluatePose } from './actorRig.js';
import { CANARY_LADDER_DEG, CANARY_POSE, limbDirection } from './actorCanary.js';

const IDS = ['unbound', 'legion', 'magistari', 'orghon'];
const EXPECTED_NON_ROOT = { unbound: 7, legion: 5, magistari: 1, orghon: 4 };

/**
 * Two-sided worst-endpoint-travel envelope, in metres.
 *
 * `max` is the shared ceiling: small enough to stay inside the sealed envelope
 * Task 3 gates, with unbound's 0.572 m fist (four compounding joints down the
 * graft chain) the roster's worst case.
 *
 * `min` is the floor, set at roughly 60% of each archetype's MEASURED worst
 * (0.572 / 0.207 / 0.053 / 0.260) so it has real headroom rather than sitting
 * on the number. It is a SECOND net, not the primary one: the pure-twist
 * mutation measures 0.174 / 0.156 / 0.000 / 0.117, so the floor catches
 * unbound, magistari and orghon but LEGION SLIPS THROUGH at 0.156 against the
 * SHIPPED 0.12 below. (An earlier version of this comment quoted 0.124, which
 * is 60% of legion's 0.207 exactly — the floor as DERIVED, before it was
 * rounded down to the number actually on the line. Legion slips either way, so
 * the disclosure stands; the figure just was not the one the test runs.) The
 * orthogonality test below is what fails on all four.
 */
const TRAVEL = {
  unbound: { min: 0.34, max: 0.60 },
  legion: { min: 0.12, max: 0.60 },
  magistari: { min: 0.031, max: 0.60 },
  orghon: { min: 0.15, max: 0.60 },
};

/**
 * Every mass must have a SURFACE vertex travelling at least this far.
 * Measured minimum across the roster is 0.0288 m (unbound's neck), so this
 * floor carries ~1.4x headroom. Deliberately not an ENDPOINT floor: a mass
 * that is near-parallel to its bone's axis barely moves its endpoints at all
 * (orghon's hipL travels 0.0049 m, legion's yokeL 0.0115 m) while its skin
 * sweeps right around. Task 3 and Task 4's per-mass assertions have to key on
 * surface vertices for the same reason.
 */
const MIN_SURFACE_TRAVEL = 0.02;

const apply = (palette, i, p) => {
  const o = i * 16;
  return [
    p[0] * palette[o] + p[1] * palette[o + 4] + p[2] * palette[o + 8] + palette[o + 12],
    p[0] * palette[o + 1] + p[1] * palette[o + 5] + p[2] * palette[o + 9] + palette[o + 13],
    p[0] * palette[o + 2] + p[1] * palette[o + 6] + p[2] * palette[o + 10] + palette[o + 14],
  ];
};
const dist = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const matAt = (palette, i) => Array.from(palette.subarray(i * 16, i * 16 + 16));
const IDENTITY_16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Both end rings of a mass at 8 azimuths — the skin, not the axis. */
function surfacePoints(m) {
  const ax = [m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]];
  const l = Math.hypot(...ax);
  const n = [ax[0] / l, ax[1] / l, ax[2] / l];
  const t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
  const ul = Math.hypot(...u);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const pts = [];
  for (let k = 0; k < 8; k++) {
    const c = Math.cos((k / 8) * Math.PI * 2);
    const s = Math.sin((k / 8) * Math.PI * 2);
    pts.push([0, 1, 2].map((j) => m.a[j] + m.r0 * (c * u[j] + s * v[j])));
    pts.push([0, 1, 2].map((j) => m.b[j] + m.r1 * (c * u[j] + s * v[j])));
  }
  return pts;
}

const massMap = (id) => new Map(archetypeById(id).masses.map((m) => [m.id, m]));

describe('CANARY_POSE — shape', () => {
  it('covers the whole shipped roster', () => {
    expect(Object.keys(CANARY_POSE).sort()).toEqual([...IDS].sort());
    expect(ARCHETYPES.map((a) => a.id).sort()).toEqual([...IDS].sort());
  });

  it('is frozen all the way down', () => {
    expect(Object.isFrozen(CANARY_POSE)).toBe(true);
    for (const id of IDS) {
      expect(Object.isFrozen(CANARY_POSE[id]), id).toBe(true);
      for (const e of Object.values(CANARY_POSE[id])) {
        expect(Object.isFrozen(e)).toBe(true);
        expect(Object.isFrozen(e.axis)).toBe(true);
        expect(() => { e.axis[0] = 99; }).toThrow();
      }
    }
  });

  it.each(IDS)('%s poses every non-root bone and only those', (id) => {
    const { bones } = buildActorRig(id);
    const keys = Object.keys(CANARY_POSE[id]).map(Number).sort((x, y) => x - y);
    expect(keys).toEqual(bones.map((_, i) => i).slice(1));
    expect(keys.length).toBe(EXPECTED_NON_ROOT[id]);
  });

  it.each(IDS)('%s angles are distinct, small, and off the prime ladder', (id) => {
    const degrees = Object.values(CANARY_POSE[id]).map((e) => (e.angleRad * 180) / Math.PI);
    expect(new Set(degrees.map((d) => d.toFixed(9))).size).toBe(degrees.length);
    for (const d of degrees) {
      // Rounded because the value round-trips through radians.
      expect(CANARY_LADDER_DEG, `${d} deg`).toContain(Math.round(d));
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(30);
    }
    // No angle is an integer multiple of another: doubling or halving one
    // joint has to change the palette, not alias onto a sibling.
    for (const p of degrees) {
      for (const q of degrees) {
        if (p === q) continue;
        expect(Math.abs((Math.max(p, q) / Math.min(p, q)) % 1), `${p}/${q}`).toBeGreaterThan(1e-6);
      }
    }
  });

  it('the ladder holds enough distinct primes for the deepest rig', () => {
    const deepest = Math.max(...IDS.map((id) => buildActorRig(id).bones.length - 1));
    expect(deepest).toBe(7);
    expect(CANARY_LADDER_DEG.length).toBeGreaterThanOrEqual(deepest);
    expect(new Set(CANARY_LADDER_DEG).size).toBe(CANARY_LADDER_DEG.length);
  });
});

describe('CANARY_POSE — the axis is orthogonal to the limb', () => {
  it.each(IDS)('%s every axis is unit length', (id) => {
    for (const [i, e] of Object.entries(CANARY_POSE[id])) {
      expect(Math.hypot(...e.axis), `${id} bone ${i}`).toBeCloseTo(1, 12);
    }
  });

  it.each(IDS)('%s every axis is perpendicular to its bone\'s limb direction', (id) => {
    // THE design property. A rotation about a limb's own axis spins a capsule
    // on its centreline and moves almost nothing; making every canary such a
    // twist is the cheapest way to gut every downstream skinning gate while
    // leaving this table looking fully populated.
    const rig = buildActorRig(id);
    const byId = massMap(id);
    for (const [i, e] of Object.entries(CANARY_POSE[id])) {
      const d = limbDirection(rig.bones[i], byId);
      expect(Math.hypot(...d), `${id} bone ${i} limb direction`).toBeCloseTo(1, 12);
      expect(Math.abs(dot(e.axis, d)), `${id} bone ${i} (${rig.bones[i].boneId}) axis is not perpendicular`).toBeLessThan(1e-12);
    }
  });

  it.each(IDS)('%s every mass a posed bone owns moves its SURFACE', (id) => {
    // The axis is orthogonal to the bone's SUMMED direction, so an individual
    // mass can still be close to a pure twist — legion's fused face plate is
    // exactly one (|cos| = 1.0000), its crests 0.9972, orghon's hips 0.9839 —
    // and those masses barely move their ENDPOINTS (orghon's hipL 0.0049 m).
    // The skin still sweeps around, which is what keeps the seal and normals
    // gates non-vacuous, so this measures end rings rather than endpoints.
    const rig = buildActorRig(id);
    const byId = massMap(id);
    const palette = evaluatePose(rig, CANARY_POSE[id]);
    for (let i = 1; i < rig.bones.length; i++) {
      for (const mid of rig.bones[i].massIds) {
        const m = byId.get(mid);
        let moved = 0;
        for (const p of surfacePoints(m)) moved = Math.max(moved, dist(apply(palette, i, p), p));
        expect(moved, `${id} bone ${i} left ${mid}'s surface where it was`).toBeGreaterThan(MIN_SURFACE_TRAVEL);
      }
    }
  });
});

describe('CANARY_POSE — the palette it produces', () => {
  it.each(IDS)('%s moves every non-root bone, and none identically', (id) => {
    const rig = buildActorRig(id);
    const palette = evaluatePose(rig, CANARY_POSE[id]);
    expect(matAt(palette, 0)).toEqual(IDENTITY_16);
    const seen = new Set();
    for (let i = 0; i < rig.bones.length; i++) {
      const key = matAt(palette, i).join(',');
      expect(seen.has(key), `${id} bones ${i} and an earlier one share a matrix`).toBe(false);
      seen.add(key);
      if (i > 0) expect(matAt(palette, i), `${id} bone ${i} did not move`).not.toEqual(IDENTITY_16);
    }
  });

  it.each(IDS)('%s worst endpoint travel sits inside a TWO-SIDED envelope', (id) => {
    const rig = buildActorRig(id);
    const byId = massMap(id);
    const palette = evaluatePose(rig, CANARY_POSE[id]);
    let worst = 0;
    for (let i = 1; i < rig.bones.length; i++) {
      for (const mid of rig.bones[i].massIds) {
        const m = byId.get(mid);
        worst = Math.max(worst, dist(apply(palette, i, m.a), m.a), dist(apply(palette, i, m.b), m.b));
      }
    }
    expect(worst, `${id} canary barely articulates`).toBeGreaterThan(TRAVEL[id].min);
    expect(worst, `${id} canary leaves the sealed envelope`).toBeLessThan(TRAVEL[id].max);
  });

  it.each(IDS)('%s canary palette entries are rigid motions', (id) => {
    const rig = buildActorRig(id);
    const palette = evaluatePose(rig, CANARY_POSE[id]);
    for (let i = 0; i < rig.bones.length; i++) {
      const p = apply(palette, i, [0.3, -0.7, 0.2]);
      const q = apply(palette, i, [-0.4, 0.1, 0.9]);
      expect(dist(p, q), `${id} bone ${i}`).toBeCloseTo(dist([0.3, -0.7, 0.2], [-0.4, 0.1, 0.9]), 6);
    }
  });

  it.each(IDS)('%s leaves bone 1\'s own pivot fixed', (id) => {
    // Bone 1's parent is the unrotated root, so bone 1's pivot is a genuine
    // fixed point. Deeper bones inherit their parents' motion.
    const rig = buildActorRig(id);
    const palette = evaluatePose(rig, CANARY_POSE[id]);
    const moved = dist(apply(palette, 1, rig.bones[1].at), rig.bones[1].at);
    expect(moved, `${id} bone 1 pivot drifted`).toBeLessThan(1e-6);
  });
});
