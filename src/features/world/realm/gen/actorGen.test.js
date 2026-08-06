/**
 * actorGen.test.js — `buildActorPayload`'s own contract, measured directly.
 *
 * Roster-level silhouette gating (window fit, pairwise IoU, identification
 * margin, band occupancy against bandTargets, ablation) belongs to
 * gen/actorSilhouette.test.js (Task 5) — it is the phase's actual exit bar
 * and needs its own gate constants. What belongs here is the generator's own
 * shape: error paths, payload well-formedness, the massIndex fill's
 * correctness against addMass's contiguous-range contract, determinism, and
 * the stage-invariant-envelope claim (fewer triangles, same silhouette
 * bounds) that the whole two-stage LOD design rests on.
 */
import { describe, expect, it } from 'vitest';
import { buildActorPayload } from './actorGen.js';
import { addMass } from './actorPrimitives.js';
import { finalize, newAccumulator } from './propPrimitives.js';
import {
  ARCHETYPES, CAP_LEVEL, SEG, archetypeById,
} from '../model/actorMasses.js';

const FACTION_IDS = ARCHETYPES.map((a) => a.id);

// Measured through the real generator (see task-4-report.md for the full
// table). Range, not exact-match: this pins "actors are roughly human-to-
// ogre scale", not a specific decimal that any future retune would need to
// chase down here as well as in Task 5's gates.
const HEIGHT_RANGE_M = { unbound: [1.5, 2.0], legion: [2.0, 2.4], magistari: [2.0, 2.4], orghon: [1.2, 1.6] };

describe('buildActorPayload — error paths', () => {
  it('throws exactly this message on an unknown archetype', () => {
    expect(() => buildActorPayload('nosuch', 0)).toThrow(/^\[actorGen\] unknown archetype "nosuch"$/);
  });

  it('throws exactly this message on an out-of-range stage', () => {
    expect(() => buildActorPayload('unbound', 2)).toThrow(/^\[actorGen\] "unbound" has 2 stages; got 2$/);
  });

  it('throws on a negative stage too, same message shape', () => {
    expect(() => buildActorPayload('legion', -1)).toThrow(/^\[actorGen\] "legion" has 2 stages; got -1$/);
  });

  it('does not throw for either shipped stage of every archetype', () => {
    for (const id of FACTION_IDS) {
      expect(() => buildActorPayload(id, 0)).not.toThrow();
      expect(() => buildActorPayload(id, 1)).not.toThrow();
    }
  });
});

describe('buildActorPayload — payload validity, every archetype, every stage', () => {
  for (const id of FACTION_IDS) {
    for (let stage = 0; stage < 2; stage++) {
      it(`${id} stage ${stage} is a well-formed payload with the standard prop-payload shape`, () => {
        const p = buildActorPayload(id, stage);

        expect(p.positions).toBeInstanceOf(Float32Array);
        expect(p.normals).toBeInstanceOf(Float32Array);
        expect(p.colors).toBeInstanceOf(Float32Array);
        expect(p.indices).toBeInstanceOf(Uint32Array);
        expect(p.massIndex).toBeInstanceOf(Uint16Array);

        expect(p.vertCount).toBeGreaterThan(0);
        expect(p.triCount).toBeGreaterThan(0);
        expect(p.positions.length).toBe(p.vertCount * 3);
        expect(p.normals.length).toBe(p.vertCount * 3);
        expect(p.colors.length).toBe(p.vertCount * 4);
        expect(p.indices.length).toBe(p.triCount * 3);
        for (const i of p.indices) expect(i).toBeLessThan(p.vertCount);
        for (const v of p.positions) expect(Number.isFinite(v)).toBe(true);
        for (const n of p.normals) expect(Number.isFinite(n)).toBe(true);

        expect(typeof p.heightM).toBe('number');
        expect(typeof p.minY).toBe('number');
        expect(typeof p.radiusM).toBe('number');
        expect(p.heightM).toBeGreaterThan(0);
        expect(p.radiusM).toBeGreaterThan(0);
      });
    }
  }

  for (const id of FACTION_IDS) {
    it(`${id}: colour channels are in [0,1] and alpha is always exactly 1, both stages`, () => {
      for (let stage = 0; stage < 2; stage++) {
        const p = buildActorPayload(id, stage);
        for (let v = 0; v < p.vertCount; v++) {
          for (let ch = 0; ch < 3; ch++) {
            const c = p.colors[v * 4 + ch];
            expect(c, `${id} s${stage} vert ${v} ch${ch}`).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThanOrEqual(1);
          }
          expect(p.colors[v * 4 + 3], `${id} s${stage} vert ${v} alpha`).toBe(1);
        }
      }
    });
  }

  for (const id of FACTION_IDS) {
    it(`${id}: heightM falls in the expected range at both stages`, () => {
      const [lo, hi] = HEIGHT_RANGE_M[id];
      for (let stage = 0; stage < 2; stage++) {
        const p = buildActorPayload(id, stage);
        expect(p.heightM, `${id} s${stage}`).toBeGreaterThanOrEqual(lo);
        expect(p.heightM, `${id} s${stage}`).toBeLessThanOrEqual(hi);
      }
    });
  }
});

describe('buildActorPayload — massIndex is a correct per-vertex fill over addMass ranges', () => {
  for (const id of FACTION_IDS) {
    for (let stage = 0; stage < 2; stage++) {
      it(`${id} stage ${stage}: massIndex.length === vertCount`, () => {
        const p = buildActorPayload(id, stage);
        expect(p.massIndex.length).toBe(p.vertCount);
      });

      it(`${id} stage ${stage}: every entry is a valid mass index, ranges are contiguous with no gaps`, () => {
        const p = buildActorPayload(id, stage);
        const massCount = ARCHETYPES.find((a) => a.id === id).masses.length;

        // Valid index range.
        for (const mi of p.massIndex) {
          expect(mi).toBeGreaterThanOrEqual(0);
          expect(mi).toBeLessThan(massCount);
        }

        // Contiguous, no-gap, no-overlap coverage: scanning left to right, the
        // mass index is non-decreasing (each mass owns one unbroken run), every
        // mass id from 0..massCount-1 that owns any vertex appears as exactly
        // one run, and the runs partition [0, vertCount) completely.
        let prev = -1;
        let seenIds = 0;
        for (let v = 0; v < p.massIndex.length; v++) {
          const mi = p.massIndex[v];
          expect(mi, `vertex ${v} out of order — massIndex must be non-decreasing`).toBeGreaterThanOrEqual(prev);
          if (mi !== prev) seenIds += 1;
          prev = mi;
        }
        // Every mass in the archetype produced at least one vertex (every
        // shipped mass has positive radii and a non-degenerate axis, so
        // addTube alone guarantees this) and hence exactly one run.
        expect(seenIds, `${id} s${stage} run count`).toBe(massCount);
      });
    }
  }
});

describe('buildActorPayload — pivots', () => {
  for (const id of FACTION_IDS) {
    it(`${id}: pivots is pivotsOf's own output, unmodified, at both stages`, () => {
      const p0 = buildActorPayload(id, 0);
      const p1 = buildActorPayload(id, 1);
      // Pivots derive from the mass table alone (never the mesh), so they
      // must be identical across stages — same joints, same topology.
      expect(JSON.stringify(p0.pivots)).toBe(JSON.stringify(p1.pivots));
      expect(p0.pivots.length).toBeGreaterThan(0);
    });
  }
});

describe('determinism — the multiplayer contract extends to actors', () => {
  for (const id of FACTION_IDS) {
    it(`${id}: same archetype+stage builds byte-identical payloads, both stages`, () => {
      for (let stage = 0; stage < 2; stage++) {
        const a = buildActorPayload(id, stage);
        const b = buildActorPayload(id, stage);
        expect(a.positions).toEqual(b.positions);
        expect(a.normals).toEqual(b.normals);
        expect(a.colors).toEqual(b.colors);
        expect(a.indices).toEqual(b.indices);
        expect(a.massIndex).toEqual(b.massIndex);
        expect(JSON.stringify(a.pivots)).toBe(JSON.stringify(b.pivots));
      }
    });
  }
});

describe('the stage-invariant-envelope claim — fewer triangles, same silhouette bounds', () => {
  // "Tight" relative to propGen's 10% envelope gate: the mass list here is
  // IDENTICAL at every stage (no crown-blob dropping, no fork-depth cutoff),
  // so the only source of envelope drift is the far stage's coarser
  // tessellation nudging a terminal cap's extreme vertex — the effect
  // FAR_COMP exists to bound, not eliminate. Measured across the roster
  // (task-4-report.md): worst height delta 1.38% (orghon), worst radius
  // delta 2.35% (legion) — comfortably inside this 5% ceiling, with enough
  // margin below propGen's own 10% gate that a real regression (e.g. a mass
  // silently dropped at the far stage) would still trip this test.
  const ENVELOPE_TOLERANCE = 0.05;

  for (const id of FACTION_IDS) {
    it(`${id}: far stage has strictly fewer triangles than near, envelope holds within ${ENVELOPE_TOLERANCE * 100}%`, () => {
      const near = buildActorPayload(id, 0);
      const far = buildActorPayload(id, 1);

      expect(far.triCount, `${id} far triCount`).toBeLessThan(near.triCount);
      expect(far.vertCount, `${id} far vertCount`).toBeLessThan(near.vertCount);

      expect(
        Math.abs(far.heightM - near.heightM) / near.heightM,
        `${id} heightM drifted between stages`,
      ).toBeLessThanOrEqual(ENVELOPE_TOLERANCE);
      expect(
        Math.abs(far.radiusM - near.radiusM) / near.radiusM,
        `${id} radiusM drifted between stages`,
      ).toBeLessThanOrEqual(ENVELOPE_TOLERANCE);
    });
  }

  it('is a real gate, not vacuous — a fabricated stage that drops masses fails it', () => {
    // Proof the tolerance above has teeth: reproduce the exact failure mode
    // the brief calls out (dropping masses at the far stage — the props
    // phase tried it with crown blobs and always dented width) as a
    // black-box payload built with the SAME primitives and SAME near-stage
    // tessellation as the real one, over a truncated mass list, and confirm
    // the envelope assertion above would actually catch it.
    //
    // Unbound's hypertrophied graft arm (graftUpper, graftFore, fist) is the
    // mass that defines its horizontal extent — dropping it moves radiusM by
    // 57.6%, far past ENVELOPE_TOLERANCE, so this is not a vacuous gate that
    // would pass no matter what is built.
    const arch = archetypeById('unbound');
    const near = buildActorPayload('unbound', 0);

    const truncated = arch.masses.filter((m) => !['graftUpper', 'graftFore', 'fist'].includes(m.id));
    expect(truncated.length).toBeLessThan(arch.masses.length);

    const acc = newAccumulator();
    for (const mass of truncated) addMass(acc, mass, { segments: SEG[0], capLevel: CAP_LEVEL[0], comp: 1 });
    const mangled = finalize(acc);

    const radiusDelta = Math.abs(mangled.radiusM - near.radiusM) / near.radiusM;
    expect(
      radiusDelta,
      'dropping the graft-arm masses must move radiusM enough for the envelope gate to notice',
    ).toBeGreaterThan(ENVELOPE_TOLERANCE);
  });
});
