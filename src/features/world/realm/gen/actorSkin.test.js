/**
 * actorSkin.test.js — the CPU skinning twin, held to five things it has to be
 * true about: an exact no-op at rest, genuine motion under the canary pose
 * (and ONLY where a bone says motion belongs), a fingerprint that names the
 * bone a vertex actually moved with, unit-length normals, and a promise that
 * none of this reads by mutating what it was handed.
 *
 * NONE OF THESE ARE VACUOUS BY ACCIDENT. The identity gate is not "nothing
 * happened, so nothing failed" — the roster's own near/far payloads carry 134
 * vertex normals (0 in positions, ever, measured across all four archetypes
 * and both stages) whose authored value is `-0`, and a naive fp32 dot product
 * silently turns every one of them into `+0` (see actorSkin.js's header for
 * the IEEE 754 mechanism). This file's identity test would catch that
 * regression because Vitest's `toEqual` on a `Float32Array` — confirmed
 * directly against this project's own Vitest install, not assumed — treats
 * `-0` and `+0` as different, the same fact model/actorRig.js's palette
 * canonicalisation comment relies on. The fingerprint gate is not "some mass
 * moved" either: it is checked against EVERY bone in the rig, not just the
 * true one, so a vertex that happens to move under its own bone's matrix
 * AND under some other bone's matrix would still be caught.
 */
import { describe, expect, it } from 'vitest';
import { ARCHETYPES, archetypeById } from '../model/actorMasses.js';
import { buildActorRig, evaluatePose } from '../model/actorRig.js';
import { CANARY_POSE } from '../model/actorCanary.js';
import { buildActorPayload } from './actorGen.js';
import { skinPayload } from './actorSkin.js';

const IDS = ['unbound', 'legion', 'magistari', 'orghon'];
/** Both shipped LOD stages — matches actorGen.test.js's own hardcoded `< 2`. */
const STAGES = [0, 1];

/**
 * Same floor actorCanary.test.js holds its synthetic ring samples to. Here it
 * is checked against the REAL generated mesh (actorGen's actual tube-ring and
 * cap vertices, not a hand-rolled 8-azimuth sample), and the measured minimum
 * across the whole roster is 0.0277 m (unbound, far stage) — headroom over
 * this floor, not a number sitting on it.
 */
const MIN_SURFACE_TRAVEL = 0.02;

/**
 * Worst measured unit-length error under the canary pose is 1.04e-7
 * (unbound) — fp32-rounding scale. This floor carries ~100x headroom so it
 * catches an actually-broken normal (a raw pass-through, or a scaled palette)
 * without flaking on ordinary fp32 noise.
 */
const NORMAL_LEN_EPS = 1e-5;

/**
 * `{first, count}` per mass ordinal, recovered from `massIndex` rather than
 * re-derived from `addMass`'s ranges (which `buildActorPayload` does not
 * expose). Asserts the contiguity gen/actorPrimitives.js documents as
 * load-bearing, rather than silently trusting it: a future generator that
 * interleaved two masses' vertices would corrupt this helper's ranges, and
 * this is where that corruption would first be visible.
 */
function massVertexRanges(massIndex, massCount) {
  const ranges = Array.from({ length: massCount }, () => ({ first: -1, count: 0 }));
  for (let v = 0; v < massIndex.length; v++) {
    const m = massIndex[v];
    if (ranges[m].first === -1) ranges[m].first = v;
    ranges[m].count++;
  }
  for (let m = 0; m < massCount; m++) {
    const { first, count } = ranges[m];
    for (let v = first; v < first + count; v++) {
      if (massIndex[v] !== m) throw new Error(`mass ${m}'s vertices are not contiguous in massIndex`);
    }
  }
  return ranges;
}

/** Elementwise `Object.is` over two equal-length typed arrays. */
function sameArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/**
 * Independent reference for "rotate this normal by this bone", written
 * WITHOUT actorSkin.js's zero-skipping fp32 idiom, float64 throughout, no
 * fround anywhere — a different codepath computing the same transform, so
 * agreement between the two is evidence about the module rather than a
 * restatement of it. Row-vector convention: n' = n·R (rotation part only).
 */
function applyRotationOnly(M, o, n) {
  return [
    n[0] * M[o] + n[1] * M[o + 4] + n[2] * M[o + 8],
    n[0] * M[o + 1] + n[1] * M[o + 5] + n[2] * M[o + 9],
    n[0] * M[o + 2] + n[1] * M[o + 6] + n[2] * M[o + 10],
  ];
}

const dist3 = (ax, ay, az, bx, by, bz) => Math.hypot(ax - bx, ay - by, az - bz);

describe('actorSkin — test roster', () => {
  it('covers the whole shipped archetype list', () => {
    // Guards every it()/for-loop below: a renamed or trimmed roster would
    // otherwise make every subsequent case silently test fewer archetypes.
    expect(ARCHETYPES.map((a) => a.id).sort()).toEqual([...IDS].sort());
  });
});

describe('skinPayload — identity palette is a bit-exact Float32 no-op', () => {
  it('the roster actually authors negative-zero normals, so this gate is not vacuous', () => {
    let negZero = 0;
    for (const id of IDS) {
      for (const stage of STAGES) {
        const { normals } = buildActorPayload(id, stage);
        for (let i = 0; i < normals.length; i++) if (Object.is(normals[i], -0)) negZero++;
      }
    }
    expect(negZero).toBeGreaterThan(0);
  });

  for (const id of IDS) {
    for (const stage of STAGES) {
      it(`${id} stage ${stage}: positions and normals round-trip exactly`, () => {
        const rig = buildActorRig(id);
        const palette = evaluatePose(rig, {});
        const payload = buildActorPayload(id, stage);
        const { positions, normals } = skinPayload(payload, rig, palette);
        expect(positions).toEqual(payload.positions);
        expect(normals).toEqual(payload.normals);
      });
    }
  }
});

describe('skinPayload — canary motion', () => {
  for (const id of IDS) {
    for (const stage of STAGES) {
      it(`${id} stage ${stage}: every root-bone vertex is bit-identical, and non-root motion is not vacuous`, () => {
        // NOT a per-vertex "every non-root vertex moves > 1e-6" claim — that
        // is measurably FALSE on real geometry, not merely "near-vacuous".
        // A rotation fixes every point exactly on its own axis, and a
        // tessellated ring occasionally lands a vertex there: e.g. unbound
        // stage 0 vertex 1008 (bone 2) measures EXACTLY 0 displacement under
        // this canary pose, same as a root-bone vertex would. That is
        // correct rotation behaviour, not a skinning bug, so asserting motion
        // per vertex would make this test wrong about real data (measured:
        // 0.00-0.83% of non-root vertices per case sit at <1e-6 across the
        // roster). The claim this test actually stands behind is twofold:
        // root-bone vertices are bit-identical, ALWAYS, and non-root motion
        // is the overwhelming majority, not a token few — the genuine
        // per-mass floor lives in the next test.
        const rig = buildActorRig(id);
        const palette = evaluatePose(rig, CANARY_POSE[id]);
        const payload = buildActorPayload(id, stage);
        const { positions } = skinPayload(payload, rig, palette);
        let rootChecked = 0;
        let nonRootChecked = 0;
        let nonRootMoved = 0;
        for (let v = 0; v < payload.massIndex.length; v++) {
          const bone = rig.boneOfMass[payload.massIndex[v]];
          const i = v * 3;
          const moved = dist3(
            positions[i], positions[i + 1], positions[i + 2],
            payload.positions[i], payload.positions[i + 1], payload.positions[i + 2],
          );
          if (bone === 0) {
            rootChecked++;
            expect(moved, `${id} stage ${stage} vertex ${v} (root bone) drifted`).toBe(0);
          } else {
            nonRootChecked++;
            if (moved > 1e-6) nonRootMoved++;
          }
        }
        // Anti-vacuity: both branches above must actually have run.
        expect(rootChecked, `${id} stage ${stage} has no root-bone vertices to check`).toBeGreaterThan(0);
        expect(nonRootChecked, `${id} stage ${stage} has no non-root vertices to check`).toBeGreaterThan(0);
        // At most a handful of axis-coincident vertices may sit still; the
        // roster's measured worst is 0.83% (unbound, far stage).
        expect(nonRootMoved / nonRootChecked, `${id} stage ${stage} too few non-root vertices moved`).toBeGreaterThan(0.95);
      });
    }
  }

  for (const id of IDS) {
    for (const stage of STAGES) {
      it(`${id} stage ${stage}: every non-root mass has a real SURFACE vertex that moved`, () => {
        // Keyed on the REAL mesh's own vertices (actorGen's tube rings and
        // caps), not a synthetic sample — endpoint travel alone is close to
        // vacuous for a mass whose canary axis is near-parallel to its own
        // direction (actorCanary.test.js measures orghon's hipL endpoint
        // travel at 0.0049 m under this exact pose), so this floor is
        // deliberately keyed on the widest-swinging vertex per mass instead.
        const rig = buildActorRig(id);
        const palette = evaluatePose(rig, CANARY_POSE[id]);
        const payload = buildActorPayload(id, stage);
        const { positions } = skinPayload(payload, rig, palette);
        const massCount = archetypeById(id).masses.length;
        const worstByMass = new Array(massCount).fill(0);
        const boneByMass = new Array(massCount).fill(-1);
        for (let v = 0; v < payload.massIndex.length; v++) {
          const m = payload.massIndex[v];
          boneByMass[m] = rig.boneOfMass[m];
          const i = v * 3;
          const moved = dist3(
            positions[i], positions[i + 1], positions[i + 2],
            payload.positions[i], payload.positions[i + 1], payload.positions[i + 2],
          );
          if (moved > worstByMass[m]) worstByMass[m] = moved;
        }
        let checked = 0;
        for (let m = 0; m < massCount; m++) {
          if (boneByMass[m] === 0) continue; // root masses are meant to stay put
          checked++;
          expect(worstByMass[m], `${id} stage ${stage} mass ${m} (bone ${boneByMass[m]}) never moved its surface`).toBeGreaterThanOrEqual(MIN_SURFACE_TRAVEL);
        }
        expect(checked, `${id} stage ${stage} has no non-root masses to check`).toBeGreaterThan(0);
      });
    }
  }
});

describe('skinPayload — fingerprint (a mass moves ONLY as its own bone would move it)', () => {
  for (const id of IDS) {
    for (const stage of STAGES) {
      it(`${id} stage ${stage}: each mass's output matches its own bone and no other`, () => {
        const rig = buildActorRig(id);
        const palette = evaluatePose(rig, CANARY_POSE[id]);
        const payload = buildActorPayload(id, stage);
        const real = skinPayload(payload, rig, palette);
        const massCount = archetypeById(id).masses.length;
        const ranges = massVertexRanges(payload.massIndex, massCount);
        let pairsChecked = 0;
        for (let m = 0; m < massCount; m++) {
          const { first, count } = ranges[m];
          expect(count, `${id} stage ${stage} mass ${m} has no vertices`).toBeGreaterThan(0);
          const miniPayload = {
            positions: payload.positions.subarray(first * 3, (first + count) * 3),
            normals: payload.normals.subarray(first * 3, (first + count) * 3),
            massIndex: new Uint16Array(count), // every entry 0: one synthetic mass ordinal
          };
          const realPos = real.positions.subarray(first * 3, (first + count) * 3);
          const realNrm = real.normals.subarray(first * 3, (first + count) * 3);
          const trueBone = rig.boneOfMass[m];
          for (let b = 0; b < rig.bones.length; b++) {
            pairsChecked++;
            const out = skinPayload(miniPayload, { boneOfMass: new Uint16Array([b]) }, palette);
            const matches = sameArray(out.positions, realPos) && sameArray(out.normals, realNrm);
            expect(
              matches,
              `${id} stage ${stage} mass ${m}: bone ${b} ${b === trueBone ? 'should' : 'should NOT'} reproduce the twin's output (true bone is ${trueBone})`,
            ).toBe(b === trueBone);
          }
        }
        // Anti-vacuity: this loop must actually have exercised more than one
        // candidate bone per mass, or "iff" collapses to a single check.
        expect(pairsChecked).toBeGreaterThan(massCount);
      });
    }
  }
});

describe('skinPayload — normals', () => {
  for (const id of IDS) {
    for (const stage of STAGES) {
      it(`${id} stage ${stage}: canary normals stay unit length`, () => {
        const rig = buildActorRig(id);
        const palette = evaluatePose(rig, CANARY_POSE[id]);
        const payload = buildActorPayload(id, stage);
        const { normals } = skinPayload(payload, rig, palette);
        for (let v = 0; v < normals.length / 3; v++) {
          const i = v * 3;
          const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
          expect(Math.abs(len - 1), `${id} stage ${stage} vertex ${v} normal length ${len}`).toBeLessThan(NORMAL_LEN_EPS);
        }
      });

      it(`${id} stage ${stage}: canary normals equal the bone-rotated authored normals`, () => {
        const rig = buildActorRig(id);
        const palette = evaluatePose(rig, CANARY_POSE[id]);
        const payload = buildActorPayload(id, stage);
        const { normals } = skinPayload(payload, rig, palette);
        for (let v = 0; v < payload.massIndex.length; v++) {
          const bone = rig.boneOfMass[payload.massIndex[v]];
          const o = bone * 16;
          const i = v * 3;
          const ref = applyRotationOnly(palette, o, [payload.normals[i], payload.normals[i + 1], payload.normals[i + 2]]);
          for (let k = 0; k < 3; k++) {
            expect(normals[i + k], `${id} stage ${stage} vertex ${v} axis ${k}`).toBeCloseTo(ref[k], 5);
          }
        }
      });
    }
  }
});

describe('skinPayload — purity', () => {
  for (const id of IDS) {
    for (const stage of STAGES) {
      it(`${id} stage ${stage}: never mutates payload, rig, or palette`, () => {
        const rig = buildActorRig(id);
        const palette = evaluatePose(rig, CANARY_POSE[id]);
        const payload = buildActorPayload(id, stage);
        const positionsCopy = Float32Array.from(payload.positions);
        const normalsCopy = Float32Array.from(payload.normals);
        const massIndexCopy = Uint16Array.from(payload.massIndex);
        const boneOfMassCopy = Uint16Array.from(rig.boneOfMass);
        const paletteCopy = Float32Array.from(palette);

        skinPayload(payload, rig, palette);

        expect(payload.positions).toEqual(positionsCopy);
        expect(payload.normals).toEqual(normalsCopy);
        expect(payload.massIndex).toEqual(massIndexCopy);
        expect(rig.boneOfMass).toEqual(boneOfMassCopy);
        expect(palette).toEqual(paletteCopy);
      });
    }
  }
});
