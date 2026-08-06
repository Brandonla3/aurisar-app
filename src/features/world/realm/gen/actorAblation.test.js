/**
 * actorAblation.test.js — group 5 of P6's exit bar: the gate is EARNED, and
 * it can go red.
 *
 * Split out of gen/actorSilhouette.test.js in the P6 final fix round. That
 * file was at 653 of its 700-line ceiling and the ledger's standing
 * instruction was that the next substantive addition splits by concern rather
 * than trimming coverage. Ablation is the natural seam: groups 1-4, 6 and 7
 * measure the SHIPPED roster, while this one measures FIXTURES built from
 * modified mass lists — a different kind of claim, with a different failure
 * mode (a fixture that is silently not the thing it says it is).
 *
 * Two proofs, because they answer different objections.
 *
 * (a) HERALD ABLATION answers "is the pass earned by the faction organs, or
 *     by the chassis?". Strip each archetype's organ and re-measure. The pair
 *     that matters is unbound x legion, the two near-identical biped chassis:
 *     real 0.483 near / 0.486 far, ablated 0.692 / 0.689. The graft arm and
 *     the mask stack are carrying ~0.21 of IoU separation between them, and
 *     without them the pair sits 0.03 under the gate. Two assertions come out
 *     of that, and they are different claims: an ABSOLUTE ceiling on the
 *     ablated roster's worst pair (the chassis headroom itself,
 *     ABLATED_WORST_MAX) and a SAME-PAIR delta on unbound x legion (the
 *     heralds must still be doing the separating). Together they stop a
 *     future edit quietly moving unbound and legion apart with radius
 *     multipliers instead of mass.
 *
 * (b) PROPORTION ROSTER answers "can this gate ever fail?". Removal alone
 *     cannot answer it — measured, the worst ablated pair reaches 0.692,
 *     which still PASSES 0.72. So the fixture goes the whole way and rebuilds
 *     the design model/actorArchetypes.js's header documents rejecting: one
 *     chassis, four "factions" separated only by a single proportion
 *     multiplier each. Every pair of that roster measures 0.819-0.932 near /
 *     0.821-0.929 far, i.e. the gate rejects all six — matching the probe's
 *     0.941 finding that proportions are not identity.
 *
 *     KNOW ITS BOUND. Because the fixture's WEAKEST pair is 0.819, this test
 *     only defends ACTOR_PAIR_IOU_MAX above ~0.819: loosening the gate from
 *     0.72 to 0.81 would leave it green. (It does bite hard where it was
 *     aimed — review confirmed that moving the gate to 0.95, which makes
 *     group 3 pass silently, turns this red.) Pinning the 0.72 value itself
 *     is group 3's job against the real roster's 0.506; this one pins that
 *     the gate still rejects proportion-only identity at all.
 *
 * WHY THE FIXTURE ITSELF IS GATED FIRST. `ablatedChassis` is a set
 * subtraction over mass ids, and the ids it names live in a DIFFERENT file
 * (model/actorArchetypes.js) which is explicitly documented as growing. Until
 * the P6 final review nothing checked that a herald id resolved: renaming
 * magistari's `cowlL` while retuning the cowl would have made its "ablated
 * chassis" the intact magistari, and the whole ablation for that archetype
 * would silently stop being computed. Demonstrated — breaking magistari's or
 * orghon's list left all 55 tests green, because only unbound and legion are
 * defended downstream by the HERALD_CONTRIBUTION_MIN pair. So group 0 below
 * runs first and validates the fixture before anything measures with it.
 */
import { describe, expect, it } from 'vitest';
import { buildActorPayload } from './actorGen.js';
import { addMass } from './actorPrimitives.js';
import { finalize, newAccumulator } from './propPrimitives.js';
import {
  ARCHETYPES, CAP_LEVEL, FAR_COMP, SEG, archetypeById,
} from '../model/actorMasses.js';
import { ACTOR_WINDOW, canonicalStats, fitsWindow } from '../model/silhouette.js';
import {
  ACTOR_PAIR_IOU_MAX, GATE_PITCH_RAD, GATE_RES,
} from '../model/silhouetteGates.js';

const IDS = ARCHETYPES.map((a) => a.id);
const STAGES = [0, 1];
const STAGE_NAME = ['near', 'far'];
const YAWS = 8;

/** The same options bag gen/actorSilhouette.test.js uses — a common yardstick
 *  is what makes "is A closer to B than to C?" a valid question at all. */
const PAIR_OPTS = {
  bounds: ACTOR_WINDOW, yawCount: YAWS, res: GATE_RES, pitchRad: GATE_PITCH_RAD,
};

const PAYLOAD = STAGES.map((s) => Object.fromEntries(IDS.map((id) => [id, buildActorPayload(id, s)])));
const PAIRS = IDS.flatMap((a, i) => IDS.slice(i + 1).map((b) => [a, b]));
const pairIoU = (a, b) => canonicalStats(a, b, PAIR_OPTS);

/** Build a payload from an arbitrary mass list, at a shipped stage's exact
 *  tessellation — same primitives, same SEG/CAP_LEVEL/FAR_COMP as the real
 *  generator, only the mass list differs. So a fixture that scores badly does
 *  so because of its MASSES, never because a different code path built it. */
function buildFromMasses(masses, stage) {
  const acc = newAccumulator();
  for (const mass of masses) {
    addMass(acc, mass, {
      segments: SEG[stage], capLevel: CAP_LEVEL[stage], comp: stage === 0 ? 1 : FAR_COMP,
    });
  }
  return finalize(acc);
}

const f3 = (n) => n.toFixed(3);
const log = (line) => console.log(`[silhouette] ${line}`);
const pad = (s, n) => String(s).padEnd(n);

/**
 * The masses that carry each faction's identity — the organ that would sit
 * behind a `heraldScale` knob if this roster had one. Everything NOT listed
 * here is the shared bipedal (or, for magistari, robed) chassis.
 */
const HERALD_MASSES = {
  unbound: ['graftUpper', 'graftFore', 'fist'],
  legion: ['faceL', 'faceR', 'crown', 'crestL', 'crestR', 'spike'],
  magistari: ['cowlL', 'cowlR', 'spine'],
  orghon: ['hipL', 'hipR'],
};

/** `heraldScale = 0`: the archetype with its faction organ gone.
 *
 *  Both failure modes throw a DIRECTED error rather than a TypeError or a
 *  silent no-op — an author adding a fifth faction meets a sentence naming
 *  the file and the declaration to write, not
 *  "Cannot read properties of undefined (reading 'includes')" eight lines
 *  below a literal they have never seen. */
function ablatedChassis(id) {
  const heralds = HERALD_MASSES[id];
  if (!heralds) {
    throw new Error(
      `[ablation] archetype "${id}" declares no HERALD_MASSES entry. Add one to `
      + 'gen/actorAblation.test.js listing its faction-defining masses (the organ a `heraldScale` knob '
      + 'would have scaled); everything not listed counts as shared chassis.',
    );
  }
  const arch = archetypeById(id);
  const present = new Set(arch.masses.map((m) => m.id));
  const missing = heralds.filter((h) => !present.has(h));
  if (missing.length) {
    throw new Error(
      `[ablation] "${id}" HERALD_MASSES names ${missing.join(', ')}, which model/actorArchetypes.js does not `
      + `declare. Its masses are: ${arch.masses.map((m) => m.id).join(', ')}. A herald id that matches nothing `
      + 'ablates nothing, so this archetype would be measured INTACT while claiming to be stripped.',
    );
  }
  return arch.masses.filter((m) => !heralds.includes(m.id));
}

/** unbound's pelvis — where its legs meet its torso, and so the joint a
 *  "longer legs" proportion multiplier has to hinge about. */
const HIP_Y = 0.88;

/**
 * The rejected design, reconstructed: ONE chassis, per-faction PROPORTION
 * MULTIPLIERS. `legLen` stretches everything below the hip (and carries the
 * body above it along, so the actor stays connected), `torsoLen` stretches
 * everything above, `girth` scales radii and lateral offsets together.
 */
function proportionTweak(masses, { legLen = 1, torsoLen = 1, girth = 1 }) {
  const moveY = (y) => (y <= HIP_Y ? y * legLen : HIP_Y * legLen + (y - HIP_Y) * torsoLen);
  const movePt = (p) => [p[0] * girth, moveY(p[1]), p[2] * girth];
  return masses.map((m) => ({
    ...m, a: movePt(m.a), b: movePt(m.b), r0: m.r0 * girth, r1: m.r1 * girth,
  }));
}

const PROPORTION_ROSTER = {
  'baseline': {},
  'legs +12%': { legLen: 1.12 },
  'torso +12%': { torsoLen: 1.12 },
  'girth +12%': { girth: 1.12 },
};

/** Minimum IoU that removing an archetype's faction-defining masses must add
 *  to a pair's score. Applied to ONE named pair (unbound x legion), never
 *  across pairs — see the file header. Measured 0.203-0.209. */
const HERALD_CONTRIBUTION_MIN = 0.15;

/**
 * Ceiling on the herald-ablated roster's WORST pair — the chassis-only
 * headroom, defended as an absolute rather than as a difference.
 *
 * This is the roster's real safety margin: strip every faction organ and
 * unbound x legion measures 0.692 near / 0.689 far against the 0.72
 * distinctness gate. 4% of headroom, not 40%. Held at 0.70 so a chassis
 * convergence has to be tiny to pass and obvious to fail.
 *
 * A FIXED ceiling, deliberately, replacing a floating `worstAblated -
 * worstReal >= 0.15` this suite shipped first. That form took a max over
 * pairs on each side INDEPENDENTLY, so its two operands were routinely
 * different pairs (real worst = magistari x orghon, ablated worst = unbound x
 * legion) — a coherent roster-health scalar, but one whose red pointed an
 * author at heralds when the edit might have been anywhere. Demonstrated in
 * review: retuning magistari's hem radius 0.42 -> 0.32 left every readability
 * gate green (pairwise 0.542, band 0.055, identification >= 0.41) and turned
 * only that test red, at 0.1493 against its 0.15 floor.
 *
 * Worse, the floating form is blind in the direction that matters. Narrowing
 * unbound's torso toward legion's (0.20/0.23 -> 0.14/0.17) drives the ablated
 * pair to 0.738 near / 0.731 far, past this ceiling — while the floating
 * delta RISES from its 0.186 baseline to 0.232 near / 0.230 far and stays
 * green. (That edit's SAME-PAIR delta on unbound x legion is 0.239, which is
 * a different statistic and the one this comment misattributed to the
 * floating form until the P6 final review re-ran it. Both are stated here so
 * a reader reproducing the edit can tell which number they are looking at.)
 */
const ABLATED_WORST_MAX = 0.70;

// ── 0. FIXTURE VALIDITY ─────────────────────────────────────────────────────

describe('0. the ablation fixture is the thing it claims to be', () => {
  it('every archetype declares heralds, and every herald names a real mass', () => {
    // Runs before anything measures, for the same reason group 1 of
    // actorSilhouette.test.js runs first: a fixture that silently ablates
    // NOTHING does not error, it returns a plausible number for the wrong
    // body. Only unbound and legion have a second line of defence (the
    // HERALD_CONTRIBUTION_MIN pair below); magistari's and orghon's lists are
    // consumed exclusively by the roster-wide argmax, where a no-op ablation
    // moves nothing that is asserted.
    expect(Object.keys(HERALD_MASSES).sort(), 'HERALD_MASSES must cover exactly the shipped roster')
      .toEqual([...IDS].sort());
    for (const id of IDS) {
      const declared = archetypeById(id).masses.map((m) => m.id);
      for (const herald of HERALD_MASSES[id]) {
        expect(declared, `"${id}" herald "${herald}" matches no mass in model/actorArchetypes.js`)
          .toContain(herald);
      }
      expect(
        ablatedChassis(id).length,
        `"${id}" ablation removed ${declared.length - ablatedChassis(id).length} masses, not the `
        + `${HERALD_MASSES[id].length} it declares — the subtraction is not doing what it says`,
      ).toBe(declared.length - HERALD_MASSES[id].length);
      expect(ablatedChassis(id).length, `"${id}" has no chassis left after ablation`).toBeGreaterThan(0);
    }
  });

  it('an undeclared archetype fails by NAME, not with a TypeError', () => {
    // The fifth-faction path. Every other group in actorSilhouette.test.js
    // auto-enrols a new archetype by iterating ARCHETYPES; HERALD_MASSES is
    // the one per-archetype declaration living in a different file from the
    // roster, so an author has no local cue it exists. It used to greet them
    // with "Cannot read properties of undefined (reading 'includes')" in the
    // same run as the ABLATED_WORST_MAX result they most needed.
    expect(() => ablatedChassis('wardens')).toThrow(/declares no HERALD_MASSES entry/);
  });
});

// ── 5. ABLATION ─────────────────────────────────────────────────────────────

describe('5. ablation — the gate is earned by mass allocation, and it can go red', () => {
  for (const stage of STAGES) {
    it(`${STAGE_NAME[stage]}: the herald-ablated roster's worst pair stays under ${ABLATED_WORST_MAX}`, () => {
      // The chassis-only headroom, as an absolute. See ABLATED_WORST_MAX for
      // why this is a fixed ceiling and not the cross-pair difference this
      // suite shipped first.
      //
      // Note what is NOT asserted: per-pair monotonicity ("no herald ever
      // makes a pair more distinct") is measurably FALSE, and the exception
      // is instructive rather than a bug — legion x magistari reads 0.417
      // real and 0.408 ablated, because BOTH of their heralds (the mask
      // stack; the cowl and spine) live above the shoulders, so removing
      // both deletes shared area from the same band.
      const ablated = Object.fromEntries(IDS.map((id) => [id, buildFromMasses(ablatedChassis(id), stage)]));
      let worst = { iou: -1, pair: '' };
      for (const [a, b] of PAIRS) {
        const iou = pairIoU(ablated[a], ablated[b]).meanIoU;
        if (iou > worst.iou) worst = { iou, pair: `${a} x ${b}` };
      }
      expect(
        worst.iou,
        `s${stage}: with every faction organ removed, ${worst.pair} scores ${f3(worst.iou)} against the `
        + `${ACTOR_PAIR_IOU_MAX} distinctness gate — that PAIR is the one that moved, and its chassis alone is `
        + 'now doing so little of the separating that its faction organ is all that keeps it legible. '
        + 'Reallocate mass in one of those two bodies; do not raise this ceiling.',
      ).toBeLessThanOrEqual(ABLATED_WORST_MAX);
    });
  }

  for (const stage of STAGES) {
    it(`${STAGE_NAME[stage]}: unbound x legion — the heralds carry at least ${HERALD_CONTRIBUTION_MIN} of the separation`, () => {
      const ablated = Object.fromEntries(['unbound', 'legion'].map((id) => [id, buildFromMasses(ablatedChassis(id), stage)]));
      const real = pairIoU(PAYLOAD[stage].unbound, PAYLOAD[stage].legion).meanIoU;
      const abl = pairIoU(ablated.unbound, ablated.legion).meanIoU;
      expect(
        abl - real,
        `unbound x legion s${stage}: real ${f3(real)}, herald-ablated ${f3(abl)} — the graft arm and mask stack `
        + 'are no longer what separates these two, so their chassis proportions are doing the work instead',
      ).toBeGreaterThanOrEqual(HERALD_CONTRIBUTION_MIN);
    });
  }

  for (const stage of STAGES) {
    it(`${STAGE_NAME[stage]}: a proportion-multiplier roster FAILS the gate on every pair`, () => {
      const base = ablatedChassis('unbound'); // the roster's plain biped
      const keys = Object.keys(PROPORTION_ROSTER);
      const built = Object.fromEntries(
        keys.map((k) => [k, buildFromMasses(proportionTweak(base, PROPORTION_ROSTER[k]), stage)]),
      );
      // Fixture validity: a clipped fixture would score high for the wrong
      // reason, so it is held to the same window rule as the real roster.
      for (const k of keys) {
        const fit = fitsWindow(built[k], { bounds: ACTOR_WINDOW, yawCount: YAWS, pitchRad: GATE_PITCH_RAD });
        expect(fit.fits, `proportion fixture "${k}" clips the window`).toBe(true);
      }
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const iou = pairIoU(built[keys[i]], built[keys[j]]).meanIoU;
          expect(
            iou,
            `"${keys[i]}" vs "${keys[j]}" s${stage} scored ${f3(iou)} — a roster separated only by proportion `
            + 'multipliers must NOT clear the distinctness gate; if it does, the gate has gone blind',
          ).toBeGreaterThan(ACTOR_PAIR_IOU_MAX);
        }
      }
    });
  }

  it('report: the ablation comparison (no assertion — see the file header)', () => {
    log('ablation: real vs herald-ablated (heraldScale = 0), far stage');
    const ablated = Object.fromEntries(IDS.map((id) => [id, buildFromMasses(ablatedChassis(id), 1)]));
    for (const [a, b] of PAIRS) {
      const real = pairIoU(PAYLOAD[1][a], PAYLOAD[1][b]).meanIoU;
      const abl = pairIoU(ablated[a], ablated[b]).meanIoU;
      log(`  ${pad(`${a} x ${b}`, 24)} real ${f3(real)}  ablated ${f3(abl)}  herald contribution ${f3(abl - real)}`);
    }
  });
});
