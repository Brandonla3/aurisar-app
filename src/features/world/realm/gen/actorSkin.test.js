/**
 * actorSkin.test.js — the CPU skinning twin, held to seven things it has to
 * be true about: an exact no-op at rest, genuine motion under the canary
 * pose (and ONLY where a bone says motion belongs), a fingerprint that names
 * the bone a vertex actually moved with, positions and normals that agree
 * with two INDEPENDENTLY written reference formulas, unit-length normals,
 * genuine per-step fp32 rounding (not none, not once at the end), and a
 * promise that none of this reads by mutating what it was handed.
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
 *
 * REVIEW ROUND 1 FOUND A GAP THIS LIST DID NOT COVER: nothing here checked
 * WHERE a vertex moved to, only THAT it moved. A translation-offset mutation
 * (reading elements 3/7/11 instead of 12/13/14 — the exact row/column
 * confusion the palette layout convention exists to prevent) passed all 58
 * tests that existed at the time, with a measured worst error of 1.6892 m —
 * roughly a body length. The `skinPayload — positions` block below closes
 * that hole with `applyAffine`, an independently written full-affine
 * reference (copied verbatim from model/actorRig.test.js and
 * model/actorCanary.test.js, never imported from actorSkin.js). The same
 * round found that replacing every `Math.fround` with the identity function
 * — deleting the module's entire reason to exist as an "emulated-fp32
 * golden model" — also passed all 58 tests, silently mis-sizing exactly the
 * tolerance Task 4's oracle is supposed to be built around. The `skinPayload
 * — fp32 rounding discipline is falsifiable` block closes that hole with a
 * second independent reference, `applyAffineFp32`, that rounds after every
 * step rather than never or once at the end.
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

/**
 * Independent reference for the FULL AFFINE transform (rotation +
 * translation), copied VERBATIM from model/actorRig.test.js:57-62 and
 * model/actorCanary.test.js:56-62 (both files carry this identical helper
 * under the name `apply`) rather than imported from actorSkin.js, so
 * agreement between the two is evidence about the module, not a restatement
 * of it. Float64 throughout, no fround, no zero-skipping. Row-vector
 * convention: p' = p·M, translation in elements 12..14.
 */
function applyAffine(palette, i, p) {
  const o = i * 16;
  return [
    p[0] * palette[o] + p[1] * palette[o + 4] + p[2] * palette[o + 8] + palette[o + 12],
    p[0] * palette[o + 1] + p[1] * palette[o + 5] + p[2] * palette[o + 9] + palette[o + 13],
    p[0] * palette[o + 2] + p[1] * palette[o + 6] + p[2] * palette[o + 10] + palette[o + 14],
  ];
}

/**
 * Independent PER-STEP-fp32 reference for the same affine transform —
 * `Math.fround` after every individual multiply and every individual
 * running-sum add, mirroring actorSkin.js's OWN documented discipline but
 * written fresh here (never calling into `dotColumn`), so exact agreement
 * is evidence the module actually follows the rounding discipline its
 * header claims, rather than merely landing on the same final Float32Array
 * bits some other way (e.g. rounding once at the very end).
 */
function applyAffineFp32(palette, i, p) {
  const o = i * 16;
  const column = (col) => {
    const a = Math.fround(p[0] * palette[o + col]);
    const ab = Math.fround(a + Math.fround(p[1] * palette[o + 4 + col]));
    const abc = Math.fround(ab + Math.fround(p[2] * palette[o + 8 + col]));
    return Math.fround(abc + palette[o + 12 + col]);
  };
  return [column(0), column(1), column(2)];
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

  it('a synthetic negative-zero POSITION component also round-trips exactly (the roster authors none today)', () => {
    // FIX (review round 1, minor): the `extra !== 0` skip in `dotColumn`
    // protects a genuine -0 surviving component from being sign-flipped by
    // an added +0 translation — the same mechanism the 134 real -0 NORMAL
    // components above prove for the `cy`/`cz` skips. But the roster's own
    // payload authors zero -0 POSITION components (measured, all four
    // archetypes, both stages: see actorSkin.js's header), so nothing in
    // this file's real-data tests would fail if that specific skip were
    // removed. Constructed by hand instead, so the branch is load-bearing
    // rather than merely reachable.
    const rig = { boneOfMass: new Uint16Array([0]) };
    // Literal identity, 16 floats, translation exactly +0 — the same shape
    // evaluatePose(rig, {}) produces, spelled out here so this fixture does
    // not depend on evaluatePose to exist correctly.
    const palette = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    const payload = {
      positions: new Float32Array([-0, 2.5, -3.25]),
      normals: new Float32Array([1, 0, 0]),
      massIndex: new Uint16Array([0]),
    };
    const { positions } = skinPayload(payload, rig, palette);
    expect(Object.is(positions[0], -0), `expected -0, got ${positions[0]}`).toBe(true);
    expect(positions[1]).toBe(2.5);
    expect(positions[2]).toBe(-3.25);
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

describe('skinPayload — positions', () => {
  for (const id of IDS) {
    for (const stage of STAGES) {
      it(`${id} stage ${stage}: canary positions equal the bone-transformed authored positions`, () => {
        // CRITICAL FIX (review round 1). Before this block existed, a
        // mutation that swapped the translation read from elements
        // 12/13/14 to 3/7/11 — the exact row/column confusion the palette
        // layout convention exists to prevent — passed all 58 tests then in
        // the file. It hid behind three facts landing at once: the identity
        // palette has zeros at both locations, so the identity gate stayed
        // green; evaluatePose always zeroes elements 3/7/11 (the top-right
        // block of an affine matrix's homogeneous row), so the mutant
        // degraded to "rotate about the origin" rather than something
        // NaN-shaped, and rotation-about-origin still moves most vertices,
        // so canary-motion and the per-mass surface floor stayed green too;
        // and the fingerprint test compares skinPayload's output to
        // skinPayload's own output on a mini-payload, so a CONSISTENTLY
        // wrong translation read is invisible to a test built entirely out
        // of self-comparison. Measured worst error under that mutation:
        // 1.6892 m (unbound stage 0 vertex 2402) — roughly a body length.
        // This test closes the hole with a genuinely independent formula
        // (`applyAffine`, above) that reads the translation from the
        // correct offsets on its own, and as a side effect gives the 3x3
        // rotation read a second point of independence beyond the normals
        // test below (retiring the single-point-of-failure the transpose
        // mutation exposed in review).
        const rig = buildActorRig(id);
        const palette = evaluatePose(rig, CANARY_POSE[id]);
        const payload = buildActorPayload(id, stage);
        const { positions } = skinPayload(payload, rig, palette);
        for (let v = 0; v < payload.massIndex.length; v++) {
          const bone = rig.boneOfMass[payload.massIndex[v]];
          const i = v * 3;
          const ref = applyAffine(palette, bone, [payload.positions[i], payload.positions[i + 1], payload.positions[i + 2]]);
          for (let k = 0; k < 3; k++) {
            expect(positions[i + k], `${id} stage ${stage} vertex ${v} axis ${k}`).toBeCloseTo(ref[k], 5);
          }
        }
      });
    }
  }
});

describe('skinPayload — fp32 rounding discipline is falsifiable', () => {
  for (const id of IDS) {
    for (const stage of STAGES) {
      it(`${id} stage ${stage}: at least one position component proves per-step fp32 rounding, not none or once-at-the-end`, () => {
        // IMPORTANT FIX (review round 1). Replacing every Math.fround in
        // actorSkin.js with the identity function — deleting the module's
        // entire reason to call itself an "emulated-fp32 golden model" —
        // passed all 58 tests that existed before this block. Measured:
        // 28.31% of position components changed bitwise under that
        // mutation, max delta 2.384e-7 m. Nothing asserted that per-step
        // rounding was actually happening, which is exactly the number
        // actorSkin.js's own header says Task 4's oracle tolerance must be
        // sized around — a silently mis-sized tolerance is worse than a
        // loud test failure here.
        //
        // A FIRST DRAFT OF THIS TEST WAS ITSELF VACUOUS, and the fix is
        // worth recording: comparing `skinPayload`'s output against
        // `applyAffineFp32` (rounds every step) and separately against
        // `applyAffine` (rounds never) is not enough, because `positions`
        // is a `Float32Array` — ANY value written to it is rounded to fp32
        // ONCE at the point of assignment, regardless of what happens
        // inside `dotColumn`. Under the fr=identity mutation, `dotColumn`
        // still computes the same float64 chain in the same order as
        // `applyAffine`, so the STORED value is exactly
        // `Math.fround(applyAffine(...))` — round-once, not "no rounding at
        // all" — which still legitimately differs from the float64
        // reference at nearly every component. A "differs from float64 AND
        // matches the fp32 chain" test therefore found a match constantly
        // even under the mutation, because round-once and round-every-step
        // AGREE on the ~72% of components where rounding order does not
        // change the bits. The fix: only look at components where the two
        // STRATEGIES genuinely disagree (`roundOnce !== fp32Chain`, using
        // `Math.fround` on the float64 reference to build `roundOnce`), and
        // require the actual output to match the per-step chain there. That
        // is where the mutation is actually observable, and it is where it
        // is caught: verified empirically before shipping that the correct
        // implementation matches `fp32Chain` at 100% of these divergent
        // points (89 to 3251 of them per archetype/stage) while the
        // fr=identity mutant matches at 0% of them, every case.
        const rig = buildActorRig(id);
        const palette = evaluatePose(rig, CANARY_POSE[id]);
        const payload = buildActorPayload(id, stage);
        const { positions } = skinPayload(payload, rig, palette);
        let divergentPoints = 0;
        let found = false;
        for (let v = 0; v < payload.massIndex.length; v++) {
          const bone = rig.boneOfMass[payload.massIndex[v]];
          const p = [payload.positions[v * 3], payload.positions[v * 3 + 1], payload.positions[v * 3 + 2]];
          const float64Ref = applyAffine(palette, bone, p);
          const fp32Ref = applyAffineFp32(palette, bone, p);
          const i = v * 3;
          for (let k = 0; k < 3; k++) {
            const roundOnce = Math.fround(float64Ref[k]);
            if (Object.is(roundOnce, fp32Ref[k])) continue; // not a divergence point
            divergentPoints++;
            if (Object.is(positions[i + k], fp32Ref[k])) found = true;
          }
        }
        // Anti-vacuity: there must actually BE points where the two
        // rounding strategies disagree, or "found" would be checking nothing.
        expect(divergentPoints, `${id} stage ${stage}: round-once and round-every-step never disagree, so this gate cannot see the difference`).toBeGreaterThan(0);
        expect(found, `${id} stage ${stage}: at every point where round-once and round-every-step disagree, the actual output matched round-once instead — rounding discipline is unfalsified`).toBe(true);
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
