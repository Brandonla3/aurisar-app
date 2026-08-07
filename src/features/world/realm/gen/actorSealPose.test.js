/**
 * actorSealPose.test.js — you cannot see through a POSED actor either, and
 * its normals do not silently stay in rest pose. The first tests in this
 * project's history to measure a DEFORMED character rather than a rest-pose
 * one; every gate before this posed `skinPayload`'s output against nothing.
 *
 * GROUP 1 reuses gen/actorSeal.test.js's exact ray-cast/interior-point
 * machinery (gen/rayFan.js) but at CANARY_POSE instead of rest. A point
 * provably inside a mass's rest-pose solid is carried through the SAME rigid
 * transform (`evaluatePose`'s palette entry for that mass's own bone) the
 * mesh itself underwent — every vertex of a mass shares one bone
 * (gen/actorSkin.test.js's fingerprint gate proves this), so the mass moves
 * as one rigid body and a point interior to it stays interior after the
 * transform. This is the FIRST measured point in the "how far can a joint
 * rotate before the surface opens" problem model/actorCanary.js's header
 * calls out — and the validator CANARY_POSE's angles have to survive.
 *
 * GROUP 2 closes the blind spot every OTHER gate in this phase has:
 * position-only checks cannot see a normal that stayed in rest pose while
 * its vertex moved. That is exactly the shape of bug a future GPU splice
 * could introduce (skin positions on the GPU, forget the normal), and it
 * would pass gen/actorSeal.test.js, this file's own Group 1, every
 * silhouette and winding gate — geometry alone does not care which way a
 * normal points. The Lambert-sign check is the headless stand-in for what a
 * shader would actually show a player: shade a triangle by a fixed light and
 * ask whether the correctly-posed mesh and the actually-produced mesh agree
 * on lit-vs-shadowed, not just on the normal's exact value.
 *
 * GROUP 3 is the anti-vacuity pair the P7 plan calls for by name: an empty
 * `found` list from Group 1 must mean "sealed", not "the harness measured
 * nothing" (rest, run through the twin, must equal rest run raw), and it
 * must mean "sealed under real motion", not "the pose was never applied"
 * (canary must move the overwhelming majority of non-root vertices and clear
 * the measured per-mass surface floor). Both sit in one describe because
 * neither claim means anything without the other sitting next to it.
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
import { ARCHETYPES, archetypeById } from '../model/actorMasses.js';
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

// ── 1. THE POSED SEAL ───────────────────────────────────────────────────────

/** Every clean pass-through the posed ray grid finds: rest-pose interior
 *  points, each carried through its OWN mass's bone transform before the ray
 *  is cast against the POSED mesh. See file header for why that is valid. */
function posedLeaks(id) {
  const {
    rig, palette, payload, twin,
  } = posedFixture(id);
  const posedPayload = { positions: twin.positions, indices: payload.indices };
  const masses = archetypeById(id).masses;
  const found = [];
  for (let ord = 0; ord < masses.length; ord++) {
    const bone = rig.boneOfMass[ord];
    for (const p of interiorPoints(masses[ord], STAGE)) {
      const at = apply(palette, bone, p.at);
      for (const d of DIRECTIONS) {
        const [f, b] = crossings(posedPayload, at, d);
        if (f === 0 && b === 0) {
          found.push(`${p.label} bone=${bone} dir=[${d.map((n) => n.toFixed(2)).join(',')}]`);
        }
      }
    }
  }
  return found;
}

describe('1. the posed seal — no ray crosses the canary-posed actor either', () => {
  for (const id of IDS) {
    it(`${id} near: ${DIRECTIONS.length} directions from every posed interior sample`, () => {
      const found = posedLeaks(id);
      expect(
        found,
        `${id} at CANARY_POSE: these rays start inside a mass — carried through that mass's own bone `
        + 'transform — and leave the POSED body having crossed NO triangle. Two aligned holes opened '
        + `under this joint's rotation. If this fails, SHRINK the offending joint's canary angle in `
        + `model/actorCanary.js's CANARY_LADDER_DEG (never skip the joint). ${found.length} of them:\n`
        + `  ${found.slice(0, 12).join('\n  ')}`,
      ).toEqual([]);
    });
  }

  it('the grid is big enough to be worth trusting', () => {
    // Anti-vacuity: same shape as gen/actorSeal.test.js's own grid-size check,
    // over the same shared constants — an empty ARCHETYPES or a broken
    // interiorPoints would make every case above pass by measuring nothing.
    const perMass = AXIAL.length * (1 + (RADIAL.length - 1) * AZIMUTHS);
    const masses = ARCHETYPES.reduce((n, a) => n + a.masses.length, 0);
    expect(perMass).toBe(51);
    expect(masses).toBe(45);
    expect(masses * perMass * DIRECTIONS.length).toBe(59670);
  });
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
    it(`${id}: rest-pose ray fan gives the identical result through the twin as on the raw payload`, () => {
      const rig = buildActorRig(id);
      const identityPalette = evaluatePose(rig, {});
      const payload = buildActorPayload(id, STAGE);
      const { positions } = skinPayload(payload, rig, identityPalette);
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
