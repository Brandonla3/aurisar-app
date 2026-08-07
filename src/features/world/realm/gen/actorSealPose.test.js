/**
 * actorSealPose.test.js — you cannot see through a POSED actor either, and
 * its normals do not silently stay in rest pose. The first tests in this
 * project's history to measure a DEFORMED character rather than a rest-pose
 * one; every gate before this posed `skinPayload`'s output against nothing.
 *
 * GROUP 1 IS TWO GATES, NOT ONE, AND THEY SEE DIFFERENT THINGS. The two-sided
 * ray criterion (a ray that meets NO triangle going forward AND none going
 * backward) is what gen/actorSeal.test.js already trusts at rest, reused here
 * at CANARY_POSE. Measured over this task: it is a PIPELINE-LIVENESS check
 * (did skinPayload actually run and roughly place the body — a harness bug
 * that leaves a mass's sample point at its rest location fails this on all
 * four archetypes, 218-2872 leaked rays each) and a GROSS-DISLOCATION
 * detector, NOT a joint-tear detector: review measured +0.30 m off a joint's
 * true pivot trips it, +0.05 m does not, and cranking any single canary angle
 * to 179 degrees (or the whole pose to 10x scale) never trips it at all,
 * because every joint here closes by a mechanism — a rotation-invariant cap
 * sphere, or a ring weld fused onto one shared bone — that stays sealed at
 * ANY angle. A torn ring weld is a ONE-SIDED aperture (you can see the
 * actor's dark interior through the gap, but the ray is still blocked going
 * the other way), and the two-sided criterion is blind to that BY
 * CONSTRUCTION: review measured a real torn weld (ring pivots un-fused, so
 * two masses that should share one bone get their own) and the two-sided
 * count stayed exactly 0 while the one-sided ("reaches open surface" on
 * exactly one side) count went 24 -> 1570 at a 1652-direction sweep, and
 * 0 -> 22 / 384 -> 414 (orghon/magistari) on the shipped 26-direction grid.
 * So this file runs THREE things under "the posed seal": the two-sided
 * liveness/dislocation check (kept — it is not worthless, it was mislabelled
 * as a joint-tear detector), a one-sided-escape count pinned against a
 * recorded per-archetype baseline (the criterion that CAN see a tear), and —
 * Group 4, below — a direct coincidence check on the ring-weld vertex pairs
 * themselves, which is the cleanest detector of the actual failure and does
 * not depend on a ray grid finding it by chance.
 *
 * GROUP 2 closes the blind spot every position-only gate has: it cannot see
 * a normal that stayed in rest pose while its vertex moved. That is exactly
 * the shape of bug a future GPU splice could introduce (skin positions on
 * the GPU, forget the normal), and it would pass gen/actorSeal.test.js, this
 * file's own Group 1, every silhouette and winding gate — geometry alone
 * does not care which way a normal points. The Lambert-sign check is the
 * headless stand-in for what a shader would actually show a player: shade a
 * triangle by a fixed light and ask whether the correctly-posed mesh and the
 * actually-produced mesh agree on lit-vs-shadowed, not just on the normal's
 * exact value.
 *
 * GROUP 3 is the anti-vacuity pair the P7 plan calls for by name: an empty
 * two-sided list from Group 1 must mean "sealed", not "the harness measured
 * nothing" (rest, run through the twin, must equal rest run raw — both the
 * pass-through LIST and the twin's raw POSITIONS), and it must mean "sealed
 * under real motion", not "the pose was never applied" (canary must move the
 * overwhelming majority of non-root vertices and clear the measured per-mass
 * surface floor). Both sit in one describe because neither claim means
 * anything without the other sitting next to it.
 *
 * GROUP 4 is the ring-weld coincidence gate: for every 'ring'-closure pivot
 * in the shipped roster, the cross-mass vertex pairs that are rest-coincident
 * must STAY coincident under CANARY_POSE. Both masses at a ring weld are
 * fused onto one bone by construction (model/actorRig.js's header), so they
 * transform rigidly together and their shared vertices move identically —
 * any measured separation means that fusion broke. This is the gate the
 * un-fuse mutation (Task 1's own mutation, `closure === 'cap' || closure ===
 * 'ring'` in actorRig.js) is aimed at, and it is the one that names the
 * broken pivot directly rather than inferring a tear from a ray count.
 *
 * Independence discipline, same as gen/actorSkin.test.js: every reference
 * formula here (`apply`, `applyRotationOnly`) is copied verbatim rather than
 * imported from gen/actorSkin.js, so agreement between the twin and the
 * reference is evidence ABOUT the twin, not a restatement of it. Only the
 * ray-cast machinery is shared (gen/rayFan.js) — that machinery does not
 * implement skinning, so importing it cannot make this file circular with
 * what it is checking.
 *
 * Deterministic throughout: fixed canary pose, fixed light direction, fixed
 * ray-fan grid. No randomness, no time, no hashing.
 */
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, SEG, archetypeById, pivotsOf,
} from '../model/actorMasses.js';
import { buildActorRig, evaluatePose } from '../model/actorRig.js';
import { CANARY_POSE } from '../model/actorCanary.js';
import { buildActorPayload } from './actorGen.js';
import { skinPayload } from './actorSkin.js';
import {
  AZIMUTHS, AXIAL, DIRECTIONS, RADIAL, crossings, interiorPoints,
} from './rayFan.js';

const IDS = ARCHETYPES.map((a) => a.id);
/** Every group here works at the near stage only, matching model/actorCanary.js's
 *  own measurements and gen/actorSeal.test.js group 1's grid — far-stage
 *  position/normal correctness is already covered, at both stages, by
 *  gen/actorSkin.test.js. */
const STAGE = 0;

/** Row-vector transform of a point by bone `i`'s palette entry: p' = p·M.
 *  Copied verbatim from model/actorRig.test.js / model/actorCanary.test.js /
 *  gen/actorSkin.test.js (all three carry this identical helper under the
 *  name `apply`), not imported, for the same independence reason. */
function apply(palette, i, p) {
  const o = i * 16;
  return [
    p[0] * palette[o] + p[1] * palette[o + 4] + p[2] * palette[o + 8] + palette[o + 12],
    p[0] * palette[o + 1] + p[1] * palette[o + 5] + p[2] * palette[o + 9] + palette[o + 13],
    p[0] * palette[o + 2] + p[1] * palette[o + 6] + p[2] * palette[o + 10] + palette[o + 14],
  ];
}

/** Rotation-only reference for a normal, n' = n·R — copied verbatim from
 *  gen/actorSkin.test.js's `applyRotationOnly`, never imported from
 *  gen/actorSkin.js: this is the independent half of Group 2's equality
 *  check, and importing the thing under test would make it circular. */
function applyRotationOnly(M, o, n) {
  return [
    n[0] * M[o] + n[1] * M[o + 4] + n[2] * M[o + 8],
    n[0] * M[o + 1] + n[1] * M[o + 5] + n[2] * M[o + 9],
    n[0] * M[o + 2] + n[1] * M[o + 6] + n[2] * M[o + 10],
  ];
}

const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

/** {rig, palette, payload, twin} at CANARY_POSE, near stage, for one archetype. */
function posedFixture(id) {
  const rig = buildActorRig(id);
  const palette = evaluatePose(rig, CANARY_POSE[id]);
  const payload = buildActorPayload(id, STAGE);
  const twin = skinPayload(payload, rig, palette);
  return {
    rig, palette, payload, twin,
  };
}

// ── 1. THE POSED SEAL: LIVENESS, DISLOCATION, AND THE TEAR BASELINE ────────

/**
 * One measurement pass over the posed ray fan, both criteria at once (so
 * they can never silently drift out of sync with each other's grid):
 *
 *  - `twoSided`: the clean-pass-through list gen/actorSeal.test.js already
 *    trusts at rest — a rest-pose interior point, carried through its OWN
 *    mass's bone transform (valid because every vertex of a mass shares one
 *    bone — gen/actorSkin.test.js's fingerprint gate proves this, so a mass
 *    moves as one rigid body and a point interior to it stays interior after
 *    the same transform), then cast against the posed mesh. Liveness and
 *    gross-dislocation only — see file header for why.
 *  - `oneSidedCount`: rays that reach open surface on EXACTLY one side
 *    (`(f === 0) !== (b === 0)`) — the criterion that can actually see a
 *    torn ring weld, per the file header's measurement.
 *  - `rays`: the ACTUAL number of crossings() calls made, accumulated during
 *    the real run rather than derived from the grid constants afterward — so
 *    a future loop bug that quietly under-casts rays fails the size check
 *    below instead of passing on a stale expected total.
 */
function posedRayMetrics(id) {
  const {
    rig, palette, payload, twin,
  } = posedFixture(id);
  const posedPayload = { positions: twin.positions, indices: payload.indices };
  const masses = archetypeById(id).masses;
  const twoSided = [];
  let oneSidedCount = 0;
  let rays = 0;
  for (let ord = 0; ord < masses.length; ord++) {
    const bone = rig.boneOfMass[ord];
    for (const p of interiorPoints(masses[ord], STAGE)) {
      const at = apply(palette, bone, p.at);
      for (const d of DIRECTIONS) {
        const [f, b] = crossings(posedPayload, at, d);
        rays++;
        if (f === 0 && b === 0) {
          twoSided.push(`${p.label} bone=${bone} dir=[${d.map((n) => n.toFixed(2)).join(',')}]`);
        } else if ((f === 0) !== (b === 0)) {
          oneSidedCount++;
        }
      }
    }
  }
  return {
    twoSided, oneSidedCount, rays,
  };
}

describe('1a. posed seal — two-sided: pipeline liveness and gross dislocation only', () => {
  for (const id of IDS) {
    it(`${id} near: no ray crosses the posed body clean through (NOT a joint-tear detector — see file header)`, () => {
      const { twoSided, rays } = posedRayMetrics(id);
      expect(rays, `${id}: expected a nonzero ray count from posedRayMetrics`).toBeGreaterThan(0);
      expect(
        twoSided,
        `${id} at CANARY_POSE: ${twoSided.length} of ${rays} rays start inside a posed mass — carried through `
        + "that mass's own bone transform — and cross NO triangle in EITHER direction. This is a liveness "
        + "check (did skinPayload run and roughly place the body) and a gross-dislocation detector, not a "
        + "joint-tear detector: a torn ring weld is a ONE-SIDED aperture this two-sided criterion cannot see "
        + "by construction (see '1b' and Group 4 below, which can). First few:\n"
        + `  ${twoSided.slice(0, 12).join('\n  ')}`,
      ).toEqual([]);
    });
  }

  it('the grid is big enough to be worth trusting, checked against the ACTUAL cast count', () => {
    // Anti-vacuity: same shape as gen/actorSeal.test.js's own grid-size check.
    // The second expect is the fix over a constants-only version — it sums
    // the REAL per-archetype ray counters posedRayMetrics returns, so a loop
    // that silently under-casts (e.g. an off-by-one on DIRECTIONS) fails
    // here even though the constants below would still multiply out correctly.
    const perMass = AXIAL.length * (1 + (RADIAL.length - 1) * AZIMUTHS);
    const masses = ARCHETYPES.reduce((n, a) => n + a.masses.length, 0);
    expect(perMass).toBe(51);
    expect(masses).toBe(45);
    expect(masses * perMass * DIRECTIONS.length).toBe(59670);
    const actualTotal = IDS.reduce((n, id) => n + posedRayMetrics(id).rays, 0);
    expect(actualTotal, 'actual cast ray count drifted from the grid-constant total').toBe(59670);
  });
});

/**
 * One-sided escape count at CANARY_POSE, shipped (fused) rig, near stage,
 * the 26-direction/51-point grid — RE-MEASURED for this fix round, not
 * copied from the review: unbound 0, legion 4, magistari 384, orghon 0.
 * Legion's 4 and magistari's 384 are not zero even on the healthy, fused
 * roster — a one-sided ray can graze an authored gap that "sealed" never
 * promised to close (gen/actorSeal.test.js's own header: this project's
 * actors are not watertight) without any weld tearing. What this baseline
 * catches is DRIFT from that healthy number, in either direction, pinned
 * exactly the way ACTOR_MANIFEST pins geometry costs in model/actorBudget.test.js.
 */
const ONE_SIDED_BASELINE = {
  unbound: 0, legion: 4, magistari: 384, orghon: 0,
};

describe('1b. posed seal — one-sided: the criterion that can actually see a torn weld', () => {
  for (const id of IDS) {
    it(`${id} near: one-sided escape count matches the recorded fused baseline`, () => {
      const { oneSidedCount } = posedRayMetrics(id);
      // On mismatch, say exactly what to paste (same convention as
      // model/actorBudget.test.js).
      expect(
        oneSidedCount,
        `${id}: one-sided escapes drifted from the recorded baseline ${ONE_SIDED_BASELINE[id]} to `
        + `${oneSidedCount} — update ONE_SIDED_BASELINE.${id} to ${oneSidedCount} if this is an intentional `
        + 'geometry change; otherwise a ring weld likely tore. Cross-check against Group 4, which names the '
        + 'pivot directly.',
      ).toBe(ONE_SIDED_BASELINE[id]);
    });
  }
});

// ── 2. NORMALS UNDER POSE ───────────────────────────────────────────────────

/** A fixed, arbitrary-but-deterministic light direction, unit length. Chosen
 *  off-axis from every coordinate plane so it is not accidentally
 *  perpendicular to a suspiciously large share of the roster's normals. */
const LIGHT = (() => {
  const v = [0.37, 0.81, -0.45];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

describe('2. normals under pose — equal to the bone-rotated authored normal, and Lambert-sign correct', () => {
  for (const id of IDS) {
    it(`${id} near: skinned normals match the independent reference, and per-triangle Lambert sign agrees`, () => {
      const {
        rig, palette, payload, twin,
      } = posedFixture(id);
      const { normals } = twin;

      // (a) EQUALITY, vertex by vertex. Mirrors gen/actorSkin.test.js's own
      // "canary normals equal the bone-rotated authored normals", restated
      // here so the seal file stands on its own and so Group 2's Lambert
      // check below is built on a claim this same test already proved.
      for (let v = 0; v < payload.massIndex.length; v++) {
        const bone = rig.boneOfMass[payload.massIndex[v]];
        const o = bone * 16;
        const i = v * 3;
        const ref = applyRotationOnly(palette, o, [payload.normals[i], payload.normals[i + 1], payload.normals[i + 2]]);
        for (let k = 0; k < 3; k++) {
          expect(normals[i + k], `${id} vertex ${v} axis ${k}`).toBeCloseTo(ref[k], 5);
        }
      }

      // (b) LAMBERT SIGN, triangle by triangle. A face's shading sign is the
      // sum of its three corner normals dotted with LIGHT — the smooth-shaded
      // stand-in for "does this triangle read as lit or shadowed" a real
      // shader would compute. Comparing the SIGN (not the value) against the
      // independent reference is what a future bug that left normals in rest
      // pose while positions moved would flip: the twin's dot and the
      // reference's dot would disagree on which side of zero they land.
      // Near-zero reference dots (light nearly grazing the triangle) are
      // skipped — both formulas agree to ~1e-5 there (part (a) above), so a
      // sign flip at that scale is fp32 noise, not a defect — the anti-vacuity
      // count below proves the skip does not eat the whole test.
      let checked = 0;
      for (let t = 0; t < payload.indices.length; t += 3) {
        const refSum = [0, 0, 0];
        const twinSum = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          const v = payload.indices[t + c];
          const bone = rig.boneOfMass[payload.massIndex[v]];
          const i = v * 3;
          const ref = applyRotationOnly(palette, bone * 16, [payload.normals[i], payload.normals[i + 1], payload.normals[i + 2]]);
          for (let k = 0; k < 3; k++) { refSum[k] += ref[k]; twinSum[k] += normals[i + k]; }
        }
        const refDot = dot(refSum, LIGHT);
        if (Math.abs(refDot) < 1e-4) continue;
        checked++;
        const twinDot = dot(twinSum, LIGHT);
        expect(
          Math.sign(twinDot),
          `${id} triangle ${t / 3}: twin's Lambert dot ${twinDot} disagrees in sign with the independent `
          + `reference's ${refDot} — a normal desynced from its vertex's position would show up here first.`,
        ).toBe(Math.sign(refDot));
      }
      expect(checked, `${id}: no triangle had a decisive reference Lambert sign to check against`).toBeGreaterThan(0);
    });
  }
});

// ── 3. THE ANTI-VACUITY PAIR ────────────────────────────────────────────────

/** gen/actorSeal.test.js's own rest-pose pass-through count, over an
 *  explicit payload/masses pair rather than re-deriving them, so this can be
 *  run once on the raw payload and once on the twin's rest-pose output. */
function restPassThroughs(payload, masses) {
  const found = [];
  for (const mass of masses) {
    for (const p of interiorPoints(mass, STAGE)) {
      for (const d of DIRECTIONS) {
        const [f, b] = crossings(payload, p.at, d);
        if (f === 0 && b === 0) found.push(`${p.label} dir=[${d.map((n) => n.toFixed(2)).join(',')}]`);
      }
    }
  }
  return found;
}

/** Established floor: every non-root mass's real mesh surface must move at
 *  least this far under the canary pose (gen/actorSkin.test.js measures a
 *  roster-wide minimum of 0.0277 m; this floor carries headroom under it). */
const MIN_SURFACE_TRAVEL = 0.02;

describe('3. anti-vacuity pair — rest is a genuine no-op, canary is genuine motion', () => {
  for (const id of IDS) {
    it(`${id}: rest-pose ray fan gives the identical result through the twin as on the raw payload, and the twin's positions are bit-exact`, () => {
      const rig = buildActorRig(id);
      const identityPalette = evaluatePose(rig, {});
      const payload = buildActorPayload(id, STAGE);
      const { positions } = skinPayload(payload, rig, identityPalette);
      // The describe name promises "rest is a genuine no-op" — assert that
      // directly on the POSITIONS (bit-exact, Float32Array element-wise,
      // catching -0 too — the same claim actorSkin.test.js's own identity
      // gate makes), not only on the derived ray-fan list below. A twin that
      // silently perturbed positions by an amount too small to flip any ray's
      // f/b crossing count would still pass the list-equality check.
      expect(positions, `${id}: identity-palette twin is not a bit-exact no-op`).toEqual(payload.positions);
      const twinPayload = { positions, indices: payload.indices };
      const masses = archetypeById(id).masses;
      const rawFound = restPassThroughs(payload, masses);
      const twinFound = restPassThroughs(twinPayload, masses);
      expect(twinFound, 'the twin at the identity palette must report exactly what the raw payload reports').toEqual(rawFound);
      expect(rawFound, 'and gen/actorSeal.test.js already establishes that this is the empty list').toEqual([]);
    });

    it(`${id}: CANARY_POSE moves every non-root mass's surface past ${MIN_SURFACE_TRAVEL} m, and >95% of non-root vertices`, () => {
      const rig = buildActorRig(id);
      const palette = evaluatePose(rig, CANARY_POSE[id]);
      const payload = buildActorPayload(id, STAGE);
      const { positions } = skinPayload(payload, rig, palette);
      const massCount = archetypeById(id).masses.length;
      const worstByMass = new Array(massCount).fill(0);
      const boneByMass = new Array(massCount).fill(-1);
      let nonRootChecked = 0;
      let nonRootMoved = 0;
      for (let v = 0; v < payload.massIndex.length; v++) {
        const m = payload.massIndex[v];
        const bone = rig.boneOfMass[m];
        boneByMass[m] = bone;
        const i = v * 3;
        const moved = Math.hypot(
          positions[i] - payload.positions[i],
          positions[i + 1] - payload.positions[i + 1],
          positions[i + 2] - payload.positions[i + 2],
        );
        if (moved > worstByMass[m]) worstByMass[m] = moved;
        if (bone !== 0) {
          nonRootChecked++;
          if (moved > 1e-6) nonRootMoved++;
        }
      }
      let massesChecked = 0;
      for (let m = 0; m < massCount; m++) {
        if (boneByMass[m] === 0) continue; // root masses are meant to stay put
        massesChecked++;
        expect(worstByMass[m], `${id} mass ${m} (bone ${boneByMass[m]}) never moved its surface`).toBeGreaterThanOrEqual(MIN_SURFACE_TRAVEL);
      }
      // Anti-vacuity: both loops above must actually have run something.
      expect(massesChecked, `${id} has no non-root masses to check`).toBeGreaterThan(0);
      expect(nonRootChecked, `${id} has no non-root vertices to check`).toBeGreaterThan(0);
      expect(nonRootMoved / nonRootChecked, `${id}: too few non-root vertices moved under the canary pose`).toBeGreaterThan(0.95);
    });
  }
});

// ── 4. RING-WELD COINCIDENCE UNDER POSE ─────────────────────────────────────

/** {first, count} per mass ordinal, recovered from massIndex — same
 *  contiguity-trusting pattern gen/actorSkin.test.js's own helper uses. */
function massVertexRanges(massIndex, massCount) {
  const ranges = Array.from({ length: massCount }, () => ({ first: -1, count: 0 }));
  for (let v = 0; v < massIndex.length; v++) {
    const m = massIndex[v];
    if (ranges[m].first === -1) ranges[m].first = v;
    ranges[m].count++;
  }
  return ranges;
}

/** Global vertex indices of one end ring of a mass, in the REAL composed
 *  payload: addTube interleaves ringStart[s]/ringEnd[s] per segment, so `a`'s
 *  ring is the even offsets within the mass's own contiguous range and `b`'s
 *  the odd ones — the same convention gen/actorSeal.test.js's ring-closure
 *  group reads off a standalone addMass build; here it is read off the
 *  mass's own slice of the real multi-mass payload instead. */
function ringVertexIndices(firstVertex, end, segCount) {
  const out = [];
  for (let s = 0; s < segCount; s++) out.push(firstVertex + 2 * s + (end === 'a' ? 0 : 1));
  return out;
}

/**
 * For every 'ring'-closure pivot in `id`'s roster, the cross-mass vertex
 * PAIRS that are rest-coincident — nearest-neighbour matched, the same way
 * gen/actorSeal.test.js's `ringGap` measures the gap, but keeping the GLOBAL
 * vertex indices (not just the coordinates) so a caller can look up the same
 * vertices' POSED positions afterward.
 *
 * Deliberately scoped to `closure === 'ring'` only. A `closure === 'cap'`
 * pivot's coincident ends are ALLOWED to separate under pose — the sphere
 * covers them, not vertex coincidence — and review measured 36 such pairs on
 * unbound alone that separate under CANARY_POSE and are perfectly healthy;
 * including cap pivots here would fail on geometry that was never promised
 * to stay welded.
 */
function ringWeldPairs(id) {
  const payload = buildActorPayload(id, STAGE);
  const masses = archetypeById(id).masses;
  const massOrdinalById = new Map(masses.map((m, i) => [m.id, i]));
  const ranges = massVertexRanges(payload.massIndex, masses.length);
  const segCount = SEG[STAGE];
  const groups = [];
  for (const pivot of pivotsOf(id).filter((p) => p.closure === 'ring')) {
    const near = (p) => Math.hypot(p[0] - pivot.at[0], p[1] - pivot.at[1], p[2] - pivot.at[2]) <= 1e-4;
    const ends = [];
    for (const m of masses) {
      if (near(m.a)) ends.push({ m, end: 'a', r: m.r0 });
      if (near(m.b)) ends.push({ m, end: 'b', r: m.r1 });
    }
    // The welded pair is the widest equal-radius pair at this joint — same
    // rule gen/actorSeal.test.js's group 4 uses to pick it out.
    const widest = Math.max(...ends.map((e) => e.r));
    const [eA, eB] = ends.filter((e) => Math.abs(e.r - widest) < 1e-4);
    const idxA = ringVertexIndices(ranges[massOrdinalById.get(eA.m.id)].first, eA.end, segCount);
    const idxB = ringVertexIndices(ranges[massOrdinalById.get(eB.m.id)].first, eB.end, segCount);
    const pairs = idxA.map((ia) => {
      const ax = payload.positions[ia * 3];
      const ay = payload.positions[ia * 3 + 1];
      const az = payload.positions[ia * 3 + 2];
      let bestIb = -1;
      let bestD = Infinity;
      for (const ib of idxB) {
        const d = Math.hypot(
          ax - payload.positions[ib * 3],
          ay - payload.positions[ib * 3 + 1],
          az - payload.positions[ib * 3 + 2],
        );
        if (d < bestD) { bestD = d; bestIb = ib; }
      }
      return { ia, ib: bestIb, restGap: bestD };
    });
    groups.push({
      pivotId: pivot.pivotId, massA: eA.m.id, massB: eB.m.id, pairs,
    });
  }
  return groups;
}

/** Flattened once at module load, like gen/actorSeal.test.js's own
 *  `ringPivots` — five ring pivots across the roster (legion.p4, magistari's
 *  three, orghon.p4); unbound has none and contributes nothing here. */
const RING_PIVOTS = IDS.flatMap((id) => ringWeldPairs(id).map((group) => ({ id, group })));

describe('4. ring-weld coincidence — the gate that can actually name a torn weld', () => {
  it('there are ring welds to check at all', () => {
    // Anti-vacuity, same shape as gen/actorSeal.test.js's own "there are
    // ring joints to check at all" — an empty list would make every case
    // below pass by checking nothing.
    expect(RING_PIVOTS.length).toBe(5);
  });

  for (const { id, group } of RING_PIVOTS) {
    it(`${id} ${group.pivotId} (${group.massA}/${group.massB}): stays coincident under CANARY_POSE`, () => {
      const rig = buildActorRig(id);
      const palette = evaluatePose(rig, CANARY_POSE[id]);
      const payload = buildActorPayload(id, STAGE);
      const { positions } = skinPayload(payload, rig, palette);
      // Sanity on the REST pairing itself — gen/actorSeal.test.js already
      // proves every ring joint welds at rest; re-checked here so a bug in
      // THIS file's own vertex-index arithmetic cannot silently validate
      // itself against a pairing that was never actually coincident.
      for (const { restGap } of group.pairs) {
        expect(restGap, `${id} ${group.pivotId} rest gap unexpectedly large`).toBeLessThan(1e-4);
      }
      let worst = 0;
      for (const { ia, ib } of group.pairs) {
        const d = Math.hypot(
          positions[ia * 3] - positions[ib * 3],
          positions[ia * 3 + 1] - positions[ib * 3 + 1],
          positions[ia * 3 + 2] - positions[ib * 3 + 2],
        );
        if (d > worst) worst = d;
      }
      expect(
        worst,
        `${id} ring pivot ${group.pivotId} (${group.massA}/${group.massB}) separated by ${worst.toFixed(5)} m `
        + 'under CANARY_POSE. Both masses at a ring weld must share exactly one bone (buildActorRigOfMasses '
        + 'fuses the far side into the bone we arrived on — model/actorRig.js) so they transform rigidly '
        + 'together; any separation means that fusion broke.',
      ).toBeLessThan(1e-4);
    });
  }
});
