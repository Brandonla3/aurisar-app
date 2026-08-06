/**
 * actorMasses — the four faction archetypes, authored as MASS ALLOCATION.
 *
 * PURE data + tiny derivations. The canonical genome output is a MASS LIST —
 * an ordered array of swept segments — not a mesh. Both LOD stages render
 * this same list at different tessellation, exactly as growConifer renders
 * genome-fixed tierHeights/tierRadii at two densities. That is what makes
 * distance readability true by construction rather than by tuning: a far
 * actor cannot be a different body, only a coarser one.
 *
 * A mass is {id, a, b, r0, r1, color, capA, capB} — a capsule from a to b,
 * radius r0 at a and r1 at b, with each end optionally closed by a rounded
 * cap. Nothing here knows what a mesh is (gen/actorPrimitives.js turns one
 * mass into triangles; gen/actorGen.js walks the list).
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
 * What THIS table measures, against ACTOR_WINDOW at GATE_PITCH_RAD and
 * GATE_RES: worst pair 0.506 near / 0.501 far (Magistari vs Orghon, the two
 * bottom-heavy bodies), best-separated pair 0.270 (Legion vs Orghon, the
 * roster's two histogram opposites). The gate is 0.72 and the probe's
 * demonstrated benchmark was 0.678, so the roster clears the bar by
 * reallocating mass further than the probe did, not by relaxing anything.
 * gen/actorSilhouette.test.js is what keeps that true.
 *
 * NO SQUASH PARAMETER, deliberately. Flattened organs (Legion's face-plate,
 * Orghon's hip slab) are SHORT WIDE CAPSULES — a horizontal axis with a large
 * radius — not a sphere plus a squash multiplier. A capped mass' extent is
 * |b - a| + r0 + r1 along its axis and 2·max(r) across it, so "squashed" is
 * expressible as geometry; a squash field would put the same shape in two
 * places and hand a future edit a proportion knob to reach for.
 *
 * Object.freeze is SHALLOW — see freezeArchetype. Without the deep freeze,
 * any spread-based derivation aliases the base's mass array AND every
 * [x, y, z] inside it, so one stray write retunes several archetypes at once.
 * propGenomes.js needs the identical discipline for the identical reason.
 */

/**
 * Per-stage tube tessellation: radial segments around each mass. Stage 0 is
 * near (full), stage 1 is far. Two stages only, matching RENDERED_STAGES —
 * beyond the mid ring actors are culled outright, so a third stage would be
 * geometry generated for nobody.
 *
 * The far stage is 6, NOT the plan's 4 — and the reason is MARGIN, not
 * impossibility. Swept at 0.0025 granularity, a 4-segment far stage does pass
 * all three LOD gates, but only for FAR_COMP in 1.0875-1.0975: a window 0.01
 * wide, inside which Magistari's widthDeltaFrac sits at 0.098-0.100 against a
 * 0.100 gate and its worst-yaw IoU at 0.828 against a 0.820 floor. Two gates
 * at 98-99% of limit, with Legion joining Magistari in failing the moment
 * comp reaches 1.100 — the same coin-flip-dressed-as-a-pass FAR_COMP refuses
 * twelve lines below, reached from the other direction.
 *
 * The cause is the cross-section: a square's projected width swings 1.414r
 * (flat-on) to 2.000r (corner-on), a 29% range a single scalar comp can
 * centre but never remove, and widthDeltaFrac is a max over yaws. A hexagon
 * swings 1.732r-2.000r and passes across the whole range 1.00-1.095, worst
 * gate at 37% of limit at the shipped comp.
 *
 * Five ALSO works (width 0.068, worst-yaw 0.903 at comp 1.03) and costs 90
 * fewer triangles — this is a choice between working options, not a rescue.
 * Six wins on the wider passing band, on left-right symmetry (an odd ring
 * makes a limb read subtly lopsided), and on matching the ring count the
 * props already use at their NEAR stage. Cost over the plan's 4 is 180
 * triangles across the whole roster (1220 -> 1400 far tris): caps dominate a
 * far actor's budget, not rings, so ring segments here are nearly free.
 */
export const SEG = Object.freeze([8, 6]);

/**
 * Per-stage rounded-cap tessellation, as sphereFaces levels. NEVER 0: an
 * octahedron's filled projection is a diamond at ~64% of the equivalent
 * sphere's area — measured, and fatal to anything silhouette-gated, because
 * a cap that loses a third of its area at range moves the outline. Level 1
 * (icosahedron) is the coarse floor, the same floor cragpine's blobLevel
 * uses.
 */
export const CAP_LEVEL = Object.freeze([2, 1]);

/**
 * Far-stage width compensation — the direct analogue of propGen's
 * MID_BLOB_COMP = 1.08, applied to RADII only (never length), so the far
 * stage recovers the width its coarser tessellation inscribes away.
 *
 * The loss is Cauchy-predictable for the tubes: an n-gon inscribed in a
 * circle of radius r has mean projected width perimeter/pi, so 8 segments
 * read 1.949r and 6 read 1.910r — a 2.05% narrowing before the caps drop
 * from 80 faces to 20. Measured, the minimax over the roster lands at
 * 1.02-1.03, agreeing with that derivation; 1.03 is where all four
 * archetypes' widthDeltaFrac sit closest together (0.020-0.037), which is
 * what "one constant serves the whole roster" looks like when it is true.
 *
 * Not tuned to sit ON the gate, and the trap is real here, not hypothetical:
 * FAR_COMP = 1.10 measures widthDeltaFrac 0.100 against a 0.10 gate —
 * literally the gate, the same coin-flip-dressed-as-a-pass propGen documents
 * for its own area-exact 1.146 (0.10000002). 1.03 measures 0.030, 30% of it.
 */
export const FAR_COMP = 1.03;

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
 * of quietly retuning the roster.
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
      // opposed tubes on a common ring close each other with no cap.
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

/**
 * Map-backed, built once at module load. propGenomes' 7-entry linear `find`
 * is fine at 7; a roster spanning species x class x faction is not, and the
 * lookup is on the per-actor spawn path.
 */
const ARCHETYPE_BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));

/** @returns the archetype, or undefined — same contract as prototypeById. */
export const archetypeById = (id) => ARCHETYPE_BY_ID.get(id);

/** Endpoints closer than this are the same joint. Every joint in the table
 *  above is authored EXACTLY equal, so today the tolerance is never the
 *  deciding factor; it exists so a future derived or scaled table does not
 *  silently lose a pivot to float drift. Because nothing in the shipped data
 *  exercises it, actorMasses.test.js pins it from both sides with a synthetic
 *  fixture — an unexercised constant is one a mutation can set to anything. */
export const PIVOT_EPS = 1e-4;

/**
 * Group a mass list's coincident endpoints into joints. Exported separately
 * from pivotsOf ONLY so PIVOT_EPS is testable: the shipped archetypes all
 * meet exactly, so a fixture is the only way to prove 5e-5 joins and 2e-4
 * does not, and an untestable constant is the kind that drifts.
 *
 * Grouping is TRANSITIVE (union-find), not greedy first-match. The greedy
 * version compared each endpoint against the first-seen member of a cluster,
 * so an A-B-C chain with A~B and B~C but A!~C split one physical joint into
 * two depending on table order — invisible while every coordinate is typed
 * exactly, and a mysteriously disconnected limb the moment one is computed,
 * which is precisely what a derived roster does. Verified behaviour-identical
 * to the greedy version on all four shipped archetypes.
 *
 * `at` is the first endpoint of the group in table order, never the cluster
 * average: averaging would move the pivot off the authored coordinate the
 * geometry actually meets at.
 */
export function pivotsOfMasses(masses, pivotIdPrefix) {
  const pts = [];
  for (const m of masses) pts.push({ at: m.a, id: m.id }, { at: m.b, id: m.id });

  const parent = pts.map((_, i) => i);
  const find = (i) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) { const next = parent[i]; parent[i] = r; i = next; }
    return r;
  };
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(
        pts[i].at[0] - pts[j].at[0], pts[i].at[1] - pts[j].at[1], pts[i].at[2] - pts[j].at[2],
      );
      if (d > PIVOT_EPS) continue;
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[a] = b;
    }
  }

  const groups = new Map();
  for (let i = 0; i < pts.length; i++) {
    const root = find(i);
    let g = groups.get(root);
    if (!g) {
      g = { at: [pts[i].at[0], pts[i].at[1], pts[i].at[2]], massIds: [] };
      groups.set(root, g);
    }
    if (!g.massIds.includes(pts[i].id)) g.massIds.push(pts[i].id);
  }
  return [...groups.values()]
    .filter((g) => g.massIds.length > 1)
    .map((g, i) => ({ pivotId: `${pivotIdPrefix}.p${i}`, at: g.at, massIds: g.massIds }));
}

/**
 * The joint table, derived from COINCIDENT MASS ENDPOINTS — masses whose a
 * or b land within PIVOT_EPS of each other share a pivot.
 *
 * This is pure data: {pivotId, at: [x, y, z], massIds: [...]}. It is P7's
 * skeleton topology obtained for free from data P6 needs anyway, and it is
 * deliberately NOT skinning — no bones, no weights, no classes. P7 maps
 * these to bones and swaps actorGen's per-vertex massIndex for bone indices
 * with rigid 1.0 weights, with no remesh. Implementing any of that here
 * would bake a rig decision into the phase that measures silhouettes.
 *
 * Endpoints touched by only one mass are not pivots: a wrist that nothing
 * else meets cannot rotate anything relative to anything.
 */
export function pivotsOf(archetypeId) {
  const arch = archetypeById(archetypeId);
  if (!arch) throw new Error(`[actorMasses] unknown archetype "${archetypeId}"`);
  return pivotsOfMasses(arch.masses, archetypeId);
}
