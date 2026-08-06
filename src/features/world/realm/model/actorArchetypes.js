/**
 * actorArchetypes — the four faction rosters, authored as MASS ALLOCATION.
 *
 * PURE data. This file is the DESIGN: the four tables below and the measured
 * evidence attached to them are the whole aesthetic decision of P6, and
 * everything downstream only renders them.
 *
 * IMPORT SURFACE: do not import this file directly. `model/actorMasses.js` is
 * the public entry point and re-exports `ARCHETYPES`; it also owns
 * `archetypeById`, `pivotsOf`, and the stage constants. This file exists as a
 * separate module only because the combined one reached 394 lines against a
 * 400 ceiling, and the next thing that happens here is Task 5 pasting
 * re-measured band evidence in — comments in this file grow by design.
 *
 * It is deliberately a ZERO-IMPORT LEAF, which is why `freezeArchetype` lives
 * here rather than with the rest of the vocabulary in actorMasses.js. The
 * alternative — helper there, tables here — is a genuine ESM cycle whose
 * failure is order-dependent: importing actorMasses.js first happens to work
 * (hoisted function declaration), while importing THIS file first throws
 * `ReferenceError: Cannot access 'ARCHETYPES' before initialization` when
 * actorMasses builds its lookup Map. Verified, not theorised. A leaf cannot
 * have that problem in either order.
 *
 * WHY MASS ALLOCATION, MEASURED. A probe built these same four factions the
 * obvious way — one shared humanoid skeleton, per-faction proportion
 * multipliers, plus a small bolted-on faction organ — and measured worst-pair
 * canonical silhouette IoU 0.941. For scale, the shipped tree props measure
 * 0.200 across species: 0.941 is "these are the same character in four
 * colours". Re-authoring the identical four by REALLOCATING MASS ACROSS
 * WORLD-Y BANDS pulled the worst pair to 0.678. So faction identity lives in
 * WHERE the mass is, never in how tall or how thick a shared body is. If a
 * future edit distinguishes two archetypes by making one 15% taller or one
 * limb 20% thicker, it is rebuilding the 0.941 roster.
 *
 * What THESE tables measure, against ACTOR_WINDOW at GATE_PITCH_RAD and
 * GATE_RES: worst pair 0.506 near / 0.501 far (Magistari vs Orghon, the two
 * bottom-heavy bodies), best-separated pair 0.270 (Legion vs Orghon, the
 * roster's two histogram opposites). The gate is 0.72 and the probe's
 * demonstrated benchmark was 0.678, so the roster clears the bar by
 * reallocating mass further than the probe did, not by relaxing anything.
 * gen/actorSilhouette.test.js is what keeps that true.
 */

/** Faction palettes. Colour is silhouette-irrelevant by design (the exit bar
 *  includes a colour-blindness control proving the gate cannot be satisfied
 *  by tint) — it exists so an actor reads as its faction up close too. */
const UNBOUND_HIDE = [0.60, 0.51, 0.43];
const UNBOUND_WRAP = [0.42, 0.35, 0.29];
const UNBOUND_GRAFT = [0.33, 0.29, 0.27];
const LEGION_LACQUER = [0.15, 0.15, 0.19];
const LEGION_BONE = [0.82, 0.78, 0.68];
const LEGION_CREST = [0.52, 0.12, 0.14];
const MAGISTARI_ROBE = [0.22, 0.24, 0.42];
const MAGISTARI_TRIM = [0.72, 0.60, 0.26];
const MAGISTARI_PALE = [0.70, 0.66, 0.60];
const ORGHON_HIDE = [0.38, 0.40, 0.32];
const ORGHON_PLATE = [0.30, 0.26, 0.22];
const ORGHON_HEAD = [0.47, 0.43, 0.35];

/**
 * Object.freeze is shallow: freezing an archetype leaves its `masses` array,
 * every mass object in it, and every [x, y, z] triple inside those writable.
 * This walks the whole tree so a stray write throws in strict mode instead
 * of quietly retuning the roster. Without it, any spread-based derivation
 * aliases the base's mass array AND every coordinate inside it, so one write
 * retunes several archetypes at once — propGenomes.js needs the identical
 * discipline for the identical reason.
 */
function freezeArchetype(a) {
  for (const m of a.masses) {
    Object.freeze(m.a);
    Object.freeze(m.b);
    Object.freeze(m.color);
    Object.freeze(m);
  }
  Object.freeze(a.masses);
  Object.freeze(a.bandTargets);
  return Object.freeze(a);
}

/**
 * The roster. `id` and `factionId` are separate fields even though they are
 * equal today: P6 ships exactly one archetype per faction, but the roster
 * this table is shaped for spans species x class x faction, at which point
 * many archetype ids map to one factionId.
 *
 * `bandTargets` are [belowWaist, torso, aboveShoulder] fractions of filled
 * silhouette area, MEASURED from bandOccupancy against [WAIST_Y, SHOULDER_Y]
 * in ACTOR_WINDOW — not design intent. The band histogram is the LEADING
 * indicator of roster separation and pairwise IoU is the lagging one, so
 * these numbers are what an author edits against; gen/actorSilhouette.test.js
 * holds them to a declared tolerance.
 *
 * MASSES ARE AUTHORED AS A CHAIN OF SHARED ENDPOINTS. A limb's `a` is
 * literally its parent's joint coordinate, so pivotsOf finds the skeleton
 * without anyone declaring one. The first draft of this table placed limbs
 * where they looked right instead, and pivotsOf returned 0 pivots for Legion
 * and 1 for Magistari — the "P7 topology for free" claim was false, and the
 * caps had nothing to nest inside either. Both problems have the same fix.
 *
 * CAPS: one per joint, carried by the WIDEST mass meeting there (the
 * narrower neighbours' open rings end up buried inside that sphere), plus
 * every terminal end — feet, hands, head, crest tips. Two tubes meeting at a
 * shared ring of equal radius and opposite axis (Legion's face-plate halves)
 * close each other and need no cap at all.
 */
export const ARCHETYPES = Object.freeze([
  /**
   * The Unbound — OFF-AXIS ASYMMETRY, and the roster's only TORSO-heavy body.
   * A baseline biped narrowed to almost nothing above the shoulders, carrying
   * one hypertrophied arm that sweeps down and out to a fist hanging at waist
   * height. It is the only archetype whose silhouette is not left-right
   * symmetric, so its outline changes with yaw while the other three barely
   * do — a signature the band histogram cannot even see, which is why it also
   * carries the roster's highest torso band (0.484, next highest 0.343).
   */
  freezeArchetype({
    id: 'unbound',
    factionId: 'unbound',
    displayName: 'The Unbound',
    stages: 2,
    bandTargets: [0.370, 0.484, 0.146],
    masses: [
      { id: 'torso', a: [0, 0.88, 0], b: [0, 1.40, 0], r0: 0.20, r1: 0.23, color: UNBOUND_HIDE, capA: true, capB: true },
      { id: 'legL', a: [0, 0.88, 0], b: [-0.15, 0.09, 0], r0: 0.155, r1: 0.095, color: UNBOUND_WRAP, capA: false, capB: true },
      { id: 'legR', a: [0, 0.88, 0], b: [0.15, 0.09, 0], r0: 0.155, r1: 0.095, color: UNBOUND_WRAP, capA: false, capB: true },
      { id: 'yokeL', a: [0, 1.40, 0], b: [-0.26, 1.44, 0], r0: 0.16, r1: 0.11, color: UNBOUND_HIDE, capA: false, capB: true },
      { id: 'yokeR', a: [0, 1.40, 0], b: [0.30, 1.42, 0], r0: 0.16, r1: 0.19, color: UNBOUND_HIDE, capA: false, capB: false },
      { id: 'armL', a: [-0.26, 1.44, 0], b: [-0.32, 0.88, 0.02], r0: 0.075, r1: 0.055, color: UNBOUND_WRAP, capA: false, capB: true },
      { id: 'graftUpper', a: [0.30, 1.42, 0], b: [0.54, 1.10, 0.06], r0: 0.21, r1: 0.18, color: UNBOUND_GRAFT, capA: true, capB: true },
      { id: 'graftFore', a: [0.54, 1.10, 0.06], b: [0.64, 0.86, 0.10], r0: 0.18, r1: 0.16, color: UNBOUND_GRAFT, capA: false, capB: false },
      { id: 'fist', a: [0.64, 0.86, 0.10], b: [0.68, 0.78, 0.10], r0: 0.20, r1: 0.20, color: UNBOUND_GRAFT, capA: true, capB: true },
      { id: 'neck', a: [0, 1.40, 0], b: [0, 1.52, 0], r0: 0.09, r1: 0.09, color: UNBOUND_WRAP, capA: false, capB: false },
      { id: 'head', a: [0, 1.52, 0], b: [0, 1.64, 0.01], r0: 0.11, r1: 0.11, color: UNBOUND_HIDE, capA: true, capB: true },
    ],
  }),

  /**
   * Legion of Masks — EVERYTHING ABOVE THE SHOULDERS. Slender legs, narrow
   * waist, thin arms; then a broad horizontal face-plate, a wider crest bar
   * above it and a spike carrying the outline past 2.1 m. Read as a band
   * histogram it is the roster's inverse of Orghon, which is the point.
   */
  freezeArchetype({
    id: 'legion',
    factionId: 'legion',
    displayName: 'Legion of Masks',
    stages: 2,
    bandTargets: [0.248, 0.337, 0.415],
    masses: [
      { id: 'torso', a: [0, 0.86, 0], b: [0, 1.42, 0], r0: 0.12, r1: 0.15, color: LEGION_LACQUER, capA: true, capB: true },
      { id: 'legL', a: [0, 0.86, 0], b: [-0.11, 0.055, 0], r0: 0.10, r1: 0.06, color: LEGION_LACQUER, capA: false, capB: true },
      { id: 'legR', a: [0, 0.86, 0], b: [0.11, 0.055, 0], r0: 0.10, r1: 0.06, color: LEGION_LACQUER, capA: false, capB: true },
      { id: 'yokeL', a: [0, 1.42, 0], b: [-0.28, 1.48, 0], r0: 0.12, r1: 0.12, color: LEGION_LACQUER, capA: false, capB: true },
      { id: 'yokeR', a: [0, 1.42, 0], b: [0.28, 1.48, 0], r0: 0.12, r1: 0.12, color: LEGION_LACQUER, capA: false, capB: true },
      { id: 'armL', a: [-0.28, 1.48, 0], b: [-0.34, 0.88, 0.02], r0: 0.055, r1: 0.045, color: LEGION_LACQUER, capA: false, capB: true },
      { id: 'armR', a: [0.28, 1.48, 0], b: [0.34, 0.88, 0.02], r0: 0.055, r1: 0.045, color: LEGION_LACQUER, capA: false, capB: true },
      { id: 'neck', a: [0, 1.42, 0], b: [0, 1.74, 0.04], r0: 0.09, r1: 0.10, color: LEGION_LACQUER, capA: false, capB: false },
      // The face-plate is TWO half masses meeting at the mask's centre ring,
      // not one bar: the shared centre is what makes it a pivot, and two
      // opposed tubes on a common ring close each other with no cap. Legion
      // is the ROSTER'S ONLY archetype built this way — every other joint
      // uses a cap, not a mutual ring closure. The closure is EXACT (not
      // merely close enough to look right), and specifically because SEG
      // (gen/actorPrimitives.js's addMass tessellation) is even at both
      // stages, [8, 6]: an even-n ring's vertex directions are symmetric
      // under 180-degree rotation about the shared axis, so faceL's end ring
      // and faceR's end ring land on IDENTICAL vertex positions. An odd SEG
      // value would visibly crack this seam open — the one archetype it
      // would break silently, since nothing else in the roster depends on
      // ring parity at all.
      { id: 'faceL', a: [0, 1.74, 0.04], b: [-0.17, 1.74, 0.04], r0: 0.20, r1: 0.18, color: LEGION_BONE, capA: false, capB: true },
      { id: 'faceR', a: [0, 1.74, 0.04], b: [0.17, 1.74, 0.04], r0: 0.20, r1: 0.18, color: LEGION_BONE, capA: false, capB: true },
      { id: 'crown', a: [0, 1.74, 0.04], b: [0, 1.96, 0.01], r0: 0.13, r1: 0.07, color: LEGION_LACQUER, capA: false, capB: false },
      { id: 'crestL', a: [0, 1.96, 0.01], b: [-0.30, 1.98, 0], r0: 0.06, r1: 0.05, color: LEGION_CREST, capA: false, capB: true },
      { id: 'crestR', a: [0, 1.96, 0.01], b: [0.30, 1.98, 0], r0: 0.06, r1: 0.05, color: LEGION_CREST, capA: false, capB: true },
      { id: 'spike', a: [0, 1.96, 0.01], b: [0, 2.16, 0], r0: 0.07, r1: 0.03, color: LEGION_CREST, capA: true, capB: true },
    ],
  }),

  /**
   * Magistari Council — LEGLESS SYMMETRIC CONE. One wide robe cone standing
   * on the ground, two short sleeves off the centreline, a cowl, a small head
   * and a spine carrying the outline to 2.22 m. No legs at all: the negative
   * space between two legs is a large share of a biped's projected outline at
   * range, so removing it is a bigger silhouette move than any amount of limb
   * re-proportioning. Bottom-heavy like Orghon (0.538 vs 0.655 below the
   * waist) but with a real above-shoulder band where Orghon has none.
   */
  freezeArchetype({
    id: 'magistari',
    factionId: 'magistari',
    displayName: 'Magistari Council',
    stages: 2,
    bandTargets: [0.538, 0.298, 0.163],
    masses: [
      // capA false on purpose. A rounded cap at the hem bottoms out at
      // y = -0.42, which does NOT clip ACTOR_WINDOW's minY of -0.45 — it does
      // something quieter and worse: it collapses Magistari's window margin
      // from 0.079 to 0.010 at pitch 0 and 0.006 at gate pitch, against a
      // 0.05 target. A margin that thin is a clip waiting for the next
      // half-centimetre of retune, and it buys a cap nobody can see. The hem
      // is buried in the ground, exactly like a prop trunk's open base.
      { id: 'robeLower', a: [0, 0, 0], b: [0, 1.14, 0], r0: 0.42, r1: 0.20, color: MAGISTARI_ROBE, capA: false, capB: false },
      { id: 'robeUpper', a: [0, 1.14, 0], b: [0, 1.40, 0], r0: 0.20, r1: 0.17, color: MAGISTARI_ROBE, capA: false, capB: false },
      { id: 'sleeveL', a: [0, 1.40, 0], b: [-0.40, 1.10, 0.02], r0: 0.13, r1: 0.09, color: MAGISTARI_TRIM, capA: false, capB: true },
      { id: 'sleeveR', a: [0, 1.40, 0], b: [0.40, 1.10, 0.02], r0: 0.13, r1: 0.09, color: MAGISTARI_TRIM, capA: false, capB: true },
      { id: 'cowlStem', a: [0, 1.40, 0], b: [0, 1.56, 0], r0: 0.16, r1: 0.14, color: MAGISTARI_ROBE, capA: false, capB: false },
      // The cowl is mass MOVED above the shoulders, not an ornament: without
      // it Magistari's band histogram sat within a hair of Orghon's in two of
      // three bands (both are bottom-heavy), and the band histogram is the
      // leading indicator the roster is authored against.
      { id: 'cowlL', a: [0, 1.56, 0], b: [-0.17, 1.56, 0], r0: 0.15, r1: 0.13, color: MAGISTARI_ROBE, capA: false, capB: true },
      { id: 'cowlR', a: [0, 1.56, 0], b: [0.17, 1.56, 0], r0: 0.15, r1: 0.13, color: MAGISTARI_ROBE, capA: false, capB: true },
      { id: 'head', a: [0, 1.56, 0], b: [0, 1.76, 0], r0: 0.12, r1: 0.11, color: MAGISTARI_PALE, capA: false, capB: true },
      { id: 'spine', a: [0, 1.76, 0], b: [0, 2.19, -0.02], r0: 0.05, r1: 0.03, color: MAGISTARI_TRIM, capA: false, capB: true },
    ],
  }),

  /**
   * Orghon — EVERYTHING BELOW THE WAIST. Massive thighs under a hip slab
   * (two opposed masses off one pelvis pivot), a torso hunched forward off
   * it, a low head topping out at 1.44 m, and arms long enough to reach past
   * the knees. Its above-shoulder band measures 0.001 — the whole body ends
   * below where Legion's face-plate begins, and that single number is what
   * separates it from Magistari, the only other bottom-heavy archetype.
   */
  freezeArchetype({
    id: 'orghon',
    factionId: 'orghon',
    displayName: 'Orghon',
    stages: 2,
    bandTargets: [0.655, 0.343, 0.001],
    masses: [
      { id: 'hipL', a: [0, 0.80, 0], b: [-0.22, 0.76, 0], r0: 0.30, r1: 0.28, color: ORGHON_PLATE, capA: true, capB: true },
      { id: 'hipR', a: [0, 0.80, 0], b: [0.22, 0.76, 0], r0: 0.30, r1: 0.28, color: ORGHON_PLATE, capA: false, capB: true },
      { id: 'thighL', a: [0, 0.80, 0], b: [-0.22, 0.16, 0], r0: 0.26, r1: 0.17, color: ORGHON_HIDE, capA: false, capB: true },
      { id: 'thighR', a: [0, 0.80, 0], b: [0.22, 0.16, 0], r0: 0.26, r1: 0.17, color: ORGHON_HIDE, capA: false, capB: true },
      { id: 'torso', a: [0, 0.80, 0], b: [0, 1.06, 0.12], r0: 0.26, r1: 0.24, color: ORGHON_HIDE, capA: false, capB: true },
      { id: 'armLUpper', a: [0, 1.06, 0.12], b: [-0.44, 0.62, 0.10], r0: 0.15, r1: 0.11, color: ORGHON_HIDE, capA: false, capB: true },
      { id: 'armRUpper', a: [0, 1.06, 0.12], b: [0.44, 0.62, 0.10], r0: 0.15, r1: 0.11, color: ORGHON_HIDE, capA: false, capB: true },
      { id: 'armLFore', a: [-0.44, 0.62, 0.10], b: [-0.46, 0.26, 0.14], r0: 0.11, r1: 0.10, color: ORGHON_HIDE, capA: false, capB: true },
      { id: 'armRFore', a: [0.44, 0.62, 0.10], b: [0.46, 0.26, 0.14], r0: 0.11, r1: 0.10, color: ORGHON_HIDE, capA: false, capB: true },
      { id: 'neck', a: [0, 1.06, 0.12], b: [0, 1.20, 0.26], r0: 0.20, r1: 0.17, color: ORGHON_HIDE, capA: false, capB: false },
      { id: 'head', a: [0, 1.20, 0.26], b: [0, 1.28, 0.32], r0: 0.17, r1: 0.16, color: ORGHON_HEAD, capA: false, capB: true },
    ],
  }),
]);
