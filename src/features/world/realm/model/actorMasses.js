/**
 * actorMasses — what a MASS is, and everything derived from a list of them.
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
 * THIS FILE IS THE PUBLIC ENTRY POINT for the actor genome. The four faction
 * tables live in model/actorArchetypes.js — split out when the combined file
 * reached 394 lines against a 400 ceiling, with Task 5 due to paste
 * re-measured band evidence into those tables next. `ARCHETYPES` is
 * re-exported below, so Tasks 4, 5 and 6 import EVERYTHING from here:
 *
 *     import { ARCHETYPES, archetypeById, pivotsOf, SEG, CAP_LEVEL, FAR_COMP }
 *       from '../model/actorMasses.js';
 *
 * The split is deliberately invisible downstream. actorArchetypes.js is a
 * zero-import leaf and this file depends on it one way; nothing should import
 * it directly, and nothing needs to.
 *
 * NO SQUASH PARAMETER, deliberately. Flattened organs (Legion's face-plate,
 * Orghon's hip slab) are SHORT WIDE CAPSULES — a horizontal axis with a large
 * radius — not a sphere plus a squash multiplier. A capped mass' extent is
 * |b - a| + r0 + r1 along its axis and 2·max(r) across it, so "squashed" is
 * expressible as geometry; a squash field would put the same shape in two
 * places and hand a future edit a proportion knob to reach for.
 */

import { ARCHETYPES } from './actorArchetypes.js';

export { ARCHETYPES };

/**
 * Per-stage tube tessellation: radial segments around each mass. Stage 0 is
 * near (full), stage 1 is far. Two stages only, matching RENDERED_STAGES: a
 * third stage would be geometry nothing could ever select, because
 * `tierForDistance` (view/actor/ActorRig.js) only ever returns NEAR or MID
 * and `ActorPrototypes.stageFor` clamps anything beyond the archetype's last
 * stage.
 *
 * NOTHING CULLS ACTORS BY DISTANCE, and this comment said otherwise until the
 * P6 final review. The sentence it carried ("beyond the mid ring actors are
 * culled outright") is propGenomes.js's justification for PROPS, where FAR
 * genuinely drop-ships to zero instances. Actors have no such branch: there
 * is no setEnabled(false), no maxRenderDistance and no cull radius anywhere
 * in view/actor/, ActorRig._applyTier unconditionally enables its mesh, and
 * ActorRig.test.js pins `tierForDistance(5000) === MID` — an actor 5 km away
 * still draws its full MID mesh. The two-stage decision is right; the
 * mechanism cited for it was invented, and a later phase deciding whether
 * actors need an impostor stage or a cull radius must not read this and
 * believe the engine already stops drawing them.
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
 * Per-stage rounded-cap tessellation, as sphereFaces levels. NEVER 0 — but
 * for a reason that has to be scoped honestly, because the version of this
 * comment that shipped through P6 over-generalised it.
 *
 * The area loss is real and reproduces: an octahedron's axis projection is a
 * square of 2r² against the sphere's pi*r², = 63.66%, and measured through
 * `sphereFaces` a free-standing blob's silhouetteAreaM2 goes 0.728 m² (level
 * 2) -> 0.453 m² (level 0), = 62.3%.
 *
 * FATAL WHERE THE BLOB IS THE OUTLINE. A free-standing blob at level 0
 * against its own level 2 measures meanIoU 0.610, worst-yaw 0.492, width
 * delta 0.273 — annihilated by the 0.85/0.82/0.10 trio. That is the case
 * propGenomes.js's cragpine `blobLevel` comment is about, and where "fatal"
 * is literally true.
 *
 * NOT FATAL FOR AN END CAP, which is what this constant governs. Most of a
 * cap is interior to its own tube's outline, so the loss dilutes: rebuilding
 * every far stage at capLevel 0 measures unbound 0.906/0.876/0.032, legion
 * 0.908/0.877/0.085, magistari 0.948/0.890/0.030, orghon 0.888/0.866/0.073 —
 * mean down ~0.04, width up to 3.6x, and every one of them still GREEN
 * against the LOD gates. So do not read this constant as "the silhouette
 * gates will catch a cap regression". They will register it (orghon's width
 * goes 0.020 -> 0.073) without rejecting it.
 *
 * What actually holds the ban is a constant guard, which is the correct shape
 * for a plan-level banned value (task-2-brief.md: "`CAP_LEVEL` must never be
 * 0"): actorMasses.test.js's `expect(CAP_LEVEL).not.toContain(0)`, its
 * monotone-coarsening assertion, and all four ACTOR_MANIFEST triangle-count
 * audits, which move 372->228, 448->280, 228->156 and 352->220. Six tests,
 * none of them a silhouette gate.
 *
 * Level 1 (icosahedron) is the coarse floor, the same floor cragpine's
 * blobLevel uses.
 */
export const CAP_LEVEL = Object.freeze([2, 1]);

/**
 * Far-stage width compensation — the direct analogue of propGen's
 * MID_BLOB_COMP = 1.08, applied to RADII only (never length), so the far
 * stage recovers the width its coarser tessellation inscribes away.
 *
 * The loss is Cauchy-predictable for the tubes: an n-gon inscribed in a
 * circle of radius r has mean projected width perimeter/pi, so 8 segments
 * read 1.949r and 6 read 1.910r — a 2.01% narrowing before the caps drop
 * from 80 faces to 20. Measured, the minimax over the roster lands at
 * 1.03-1.035 (max widthDeltaFrac 0.0371 at 1.030, 0.0359 at 1.035, rising
 * again to 0.0400 by 1.040), agreeing with that derivation to well inside
 * the flatness of the curve.
 *
 * WHAT 1.03 IS NOT. It is not where the four archetypes cluster most tightly
 * — measured, the spread across the roster is 0.0176 at 1.030 and 0.0149 at
 * 1.000, so comp actually SPREADS them slightly on the way to its minimax.
 * That claim was in this comment until the P6 final review and does not
 * reproduce. What 1.03 is, is the near-minimum of the WORST archetype, which
 * is the statistic the gate reads.
 *
 * Not tuned to sit ON the gate, and the trap is real here, not hypothetical:
 * FAR_COMP = 1.10 measures widthDeltaFrac 0.100 against a 0.10 gate —
 * literally the gate, the same coin-flip-dressed-as-a-pass propGen documents
 * for its own area-exact 1.146 (0.10000002). 1.03 measures 0.037, 37% of it,
 * on LEGION — legion, not magistari, is what binds at the shipped comp, and
 * the per-archetype figures are [unbound 0.025, legion 0.037, magistari
 * 0.030, orghon 0.020]. The advertised headroom is therefore 0.063, not the
 * 0.070 a "30%" reading suggests: a retune to 1.06 already puts legion and
 * magistari at 0.060, and 1.08 puts both at 0.080.
 */
export const FAR_COMP = 1.03;

/**
 * Map-backed, built once at module load. propGenomes' 7-entry linear `find`
 * is fine at 7; a roster spanning species x class x faction is not, and the
 * lookup is on the per-actor spawn path.
 */
const ARCHETYPE_BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));

/** @returns the archetype, or undefined — same contract as prototypeById. */
export const archetypeById = (id) => ARCHETYPE_BY_ID.get(id);

/** Endpoints closer than this are the same joint. Every joint in the roster
 *  is authored EXACTLY equal, so today the tolerance is never the deciding
 *  factor; it exists so a future derived or scaled table does not silently
 *  lose a pivot to float drift. Because nothing in the shipped data exercises
 *  it, actorMasses.test.js pins it from both sides with a synthetic fixture —
 *  an unexercised constant is one a mutation can set to anything. */
export const PIVOT_EPS = 1e-4;

/** Two radii are the same radius. Same scale as PIVOT_EPS and for the same
 *  reason: the shipped table types them equal, so this never decides
 *  anything today; it exists so a derived roster does not lose a weld to
 *  float drift. */
const RADIUS_EPS = 1e-4;

/** |dot| of two unit axes must reach this for them to be the same LINE. */
const AXIS_PARALLEL_MIN = 1 - 1e-4;

const unitAxis = (m) => {
  const d = [m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
};

/** Every mass end landing on `at`, with the radius and cap flag of THAT end. */
function endsAt(masses, at) {
  const out = [];
  const near = (p) => Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) <= PIVOT_EPS;
  for (const m of masses) {
    const axis = unitAxis(m);
    if (near(m.a)) out.push({ id: m.id, r: m.r0, axis, capped: m.capA });
    if (near(m.b)) out.push({ id: m.id, r: m.r1, axis, capped: m.capB });
  }
  return out;
}

/**
 * WHICH MECHANISM HOLDS A JOINT SHUT — 'cap', 'ring', or null for neither.
 * Pure data; model/actorArchetypes.js's header describes both mechanisms and
 * gen/actorPrimitives.js's describes what they mean for P7.
 *
 * 'cap' takes precedence when both apply, because that is the distinction
 * that MATTERS downstream: a cap is a closed sphere sitting at the joint, so
 * it keeps filling the gap when a rigid segment rotates about it. An exact
 * ring weld only holds in the authored pose — rotate either side and the two
 * rings separate and the joint opens.
 *
 * The ring test is EQUAL RADIUS + SAME AXIS LINE rather than a literal
 * vertex-by-vertex comparison, deliberately: `basisFor` (gen/propPrimitives.js)
 * is a function of the axis direction alone, so parallel axes at equal radius
 * produce IDENTICAL ring vertices whatever that function is, and this file
 * stays a pure leaf instead of reaching into gen/ for it. OPPOSED axes are
 * the case with a condition attached — the two rings map onto each other
 * under t -> pi - t, which is the same vertex SET only for even `segments` —
 * so those are rejected outright unless every SEG stage is even. The claim
 * that the vertices really do coincide is not left to this reasoning:
 * gen/actorSeal.test.js re-derives every 'ring' joint's rings from the REAL
 * addMass output and fails if any vertex is more than 1e-4 from its twin.
 */
export function closureAt(masses, at) {
  const ends = endsAt(masses, at);
  if (ends.some((e) => e.capped)) return 'cap';
  const evenSeg = SEG.every((n) => n % 2 === 0);
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      if (ends[i].id === ends[j].id) continue;
      if (Math.abs(ends[i].r - ends[j].r) > RADIUS_EPS) continue;
      const [p, q] = [ends[i].axis, ends[j].axis];
      const dot = p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      if (Math.abs(dot) < AXIS_PARALLEL_MIN) continue;
      if (dot < 0 && !evenSeg) continue;
      return 'ring';
    }
  }
  return null;
}

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
    .map((g, i) => ({
      pivotId: `${pivotIdPrefix}.p${i}`,
      at: g.at,
      massIds: g.massIds,
      closure: closureAt(masses, g.at),
    }));
}

/**
 * The joint table, derived from COINCIDENT MASS ENDPOINTS — masses whose a
 * or b land within PIVOT_EPS of each other share a pivot.
 *
 * This is pure data: {pivotId, at: [x, y, z], massIds: [...], closure}.
 * `closure` is 'cap' or 'ring' (see closureAt) and is the field a P7 consumer
 * has to read BEFORE rotating anything: a 'ring' joint is POSE-LOCKED and
 * tears open on the first animated frame. It is P7's
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
