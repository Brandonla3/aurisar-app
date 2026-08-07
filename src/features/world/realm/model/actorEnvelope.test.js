/**
 * actorEnvelope.test.js — the customs audit for the posed-culling envelope.
 *
 * Same shape as actorBudget.test.js: declared numbers must equal generated
 * numbers, both directions, exactly, with paste-ready actuals on drift. The
 * declaration is what `view/actor/ActorRig.js` spends at runtime, so unlike
 * ACTOR_MANIFEST's costs this one is not a ceiling a test defends in private —
 * a stale number here is a limb that gets culled on screen.
 *
 * PURE: no NullEngine, no BABYLON. The live half — that a real cloned mesh's
 * bounding box actually contains every posed vertex — is
 * view/actor/ActorRigSkin.test.js's, because only there is there a mesh.
 *
 * ANTI-VACUITY, stated because this file could so easily be written without
 * it: `overhangM` is 0 on both magistari stages (its one non-root bone barely
 * reaches past the robe), so a bug that measured nothing at all would still
 * match two of the eight declarations. The `travelM` column is measured on the
 * same pass and is non-zero everywhere, and the sanity block below asserts the
 * roster's worst overhang is a real distance rather than a rounding artefact.
 */
import { describe, expect, it } from 'vitest';
import { buildActorPayload } from '../gen/actorGen.js';
import { skinPayload } from '../gen/actorSkin.js';
import { ARCHETYPES } from './actorMasses.js';
import { buildActorRig, evaluatePose } from './actorRig.js';
import { CANARY_POSE } from './actorCanary.js';
import { ACTOR_POSE_MARGIN_M, POSE_ENVELOPE_MANIFEST } from './actorEnvelope.js';

/**
 * The two measured metres for one master, exactly as the manifest declares
 * them: the largest distance a posed vertex sits outside the REST box (over
 * all six faces), and the largest distance any vertex moves.
 */
function measure(archetypeId, stage) {
  const payload = buildActorPayload(archetypeId, stage);
  const rig = buildActorRig(archetypeId);
  const posed = skinPayload(payload, rig, evaluatePose(rig, CANARY_POSE[archetypeId])).positions;
  const rest = payload.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < rest.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      if (rest[i + a] < min[a]) min[a] = rest[i + a];
      if (rest[i + a] > max[a]) max[a] = rest[i + a];
    }
  }
  let overhang = 0;
  let travel = 0;
  for (let i = 0; i < posed.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      overhang = Math.max(overhang, min[a] - posed[i + a], posed[i + a] - max[a]);
    }
    travel = Math.max(travel, Math.hypot(
      posed[i] - rest[i], posed[i + 1] - rest[i + 1], posed[i + 2] - rest[i + 2],
    ));
  }
  return { overhangM: Number(overhang.toFixed(4)), travelM: Number(travel.toFixed(4)) };
}

const PAIRS = ARCHETYPES.flatMap((a) => (
  Array.from({ length: a.stages }, (_, stage) => ({ id: a.id, stage }))
));

describe('manifest completeness — both directions', () => {
  it('every archetype has an envelope entry with the right stage count', () => {
    for (const arch of ARCHETYPES) {
      const entry = POSE_ENVELOPE_MANIFEST[arch.id];
      expect(entry, `${arch.id} missing from POSE_ENVELOPE_MANIFEST`).toBeTruthy();
      expect(entry.length, `${arch.id} stage count`).toBe(arch.stages);
    }
  });

  it('every manifest key is a real archetype — no ghost cargo', () => {
    const ids = new Set(ARCHETYPES.map((a) => a.id));
    for (const key of Object.keys(POSE_ENVELOPE_MANIFEST)) {
      expect(ids.has(key), `envelope entry "${key}" has no archetype`).toBe(true);
    }
  });
});

describe('declared envelope equals measured envelope', () => {
  for (const { id, stage } of PAIRS) {
    it(`${id} stage ${stage} matches its declaration`, () => {
      const actual = measure(id, stage);
      expect(
        actual,
        `${id}[${stage}] drifted — update POSE_ENVELOPE_MANIFEST to ${JSON.stringify(actual)}`,
      ).toEqual(POSE_ENVELOPE_MANIFEST[id][stage]);
    });
  }
});

describe('the margin covers the envelope', () => {
  const all = PAIRS.map(({ id, stage }) => ({ id, stage, ...POSE_ENVELOPE_MANIFEST[id][stage] }));

  it('covers the roster-wide worst OVERHANG, with headroom', () => {
    // The basis, as an assertion. OVERHANG is the quantity both consumers need
    // — culling asks "does the box contain every posed vertex", the
    // auto-extended shadow ortho asks "does it cover the posed shadow extent";
    // both are envelope questions.
    const worstOverhang = Math.max(...all.map((e) => e.overhangM));
    expect(
      ACTOR_POSE_MARGIN_M,
      `margin ${ACTOR_POSE_MARGIN_M} m no longer covers the roster's worst posed OVERHANG `
      + `(${worstOverhang} m). See actorEnvelope.js's REVISIT TRIGGER: raise the constant, and `
      + 'price BOTH consumers when you do — the frustum culler (cheap, linear) and '
      + "DirectionalLight's auto-extended shadow ortho (quadratic in this number: 0.40 already "
      + "costs 3.28x the shadow area of no margin at all, i.e. 70% of the character's texel "
      + 'density on a fixed 1024-square map).',
    ).toBeGreaterThan(worstOverhang);
    // Headroom, so the constant is not sitting on the measurement.
    expect(ACTOR_POSE_MARGIN_M / worstOverhang, 'headroom over the measured worst overhang').toBeGreaterThan(1.2);
  });

  it('is deliberately BELOW the worst TRAVEL — the basis that was rejected', () => {
    // An INVERTED pin, and it is the point of this test rather than a
    // curiosity. `travelM` is the tight aim-independent ceiling on overhang
    // (a vertex starts inside the box, so overhang <= travel), and an earlier
    // version of this file sized the margin at 0.85 m on exactly that
    // argument. It is the ceiling of the WRONG QUANTITY: it prices a re-aiming
    // no pose in the roster performs against a cost function that is quadratic
    // in the margin, and pays 7.39x shadow area for it against 0.40's 3.28x.
    // Anyone "restoring" the travel basis raises the constant past this line,
    // and this is where they find out what it costs.
    const worstTravel = Math.max(...all.map((e) => e.travelM));
    const worstOverhang = Math.max(...all.map((e) => e.overhangM));
    expect(worstTravel, 'travel must still exceed overhang, or the algebra above is wrong').toBeGreaterThan(worstOverhang);
    expect(
      ACTOR_POSE_MARGIN_M,
      `margin ${ACTOR_POSE_MARGIN_M} m has reached the worst posed-vertex TRAVEL (${worstTravel} m). `
      + 'If that is deliberate, re-read actorEnvelope.js on the second consumer first: sizing on '
      + "travel measured 7.39x the shadow ortho area and 86% of the character's texel density.",
    ).toBeLessThan(worstTravel);
  });

  it('covers every single master with room to spare', () => {
    for (const e of all) {
      expect(e.overhangM, `${e.id}[${e.stage}] overhangs the margin`).toBeLessThan(ACTOR_POSE_MARGIN_M);
    }
  });

  it('the fault it exists for is REAL — the roster genuinely overhangs its rest box', () => {
    // Anti-vacuity for the whole file. If this ever reads ~0 the production
    // expansion has become dead weight and should be argued for again, not
    // kept because a green test says nothing.
    const worstOverhang = Math.max(...all.map((e) => e.overhangM));
    expect(worstOverhang, 'no master overhangs at all — why is there a margin?').toBeGreaterThan(0.1);
    expect(PAIRS.length, 'the roster shrank; re-read this file before trusting it').toBe(8);
  });

  it('is a plain positive finite number of metres', () => {
    expect(Number.isFinite(ACTOR_POSE_MARGIN_M)).toBe(true);
    expect(ACTOR_POSE_MARGIN_M).toBeGreaterThan(0);
  });
});
