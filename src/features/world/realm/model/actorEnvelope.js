/**
 * actorEnvelope — how far a POSED actor's skin reaches OUTSIDE the box its
 * REST geometry implies, and the culling margin that covers it.
 *
 * PURE, and deliberately IMPORT-FREE. The numbers below are a DECLARATION,
 * audited against the real generator by actorEnvelope.test.js in exactly the
 * bill-of-lading pattern model/actorBudget.js's ACTOR_MANIFEST uses: both
 * directions, generated-vs-declared, paste-ready JSON on drift.
 *
 * ── THE BUG THIS CLOSES ────────────────────────────────────────────────────
 *
 * Babylon frustum-culls a mesh against `mesh.getBoundingInfo()`, and for a
 * GPU-skinned actor that box is the REST pose FOREVER. The deformation happens
 * in the vertex shader (view/materials/actorNME.js's BonesBlock); nothing ever
 * writes a posed position back to the vertex buffer, so posing an actor moves
 * its skin and not its box. Bend a limb outward, walk to the edge of frame, and
 * the culler tests a box the arm has already left: the whole actor pops out of
 * existence while a hand is still on screen. One draw call vanishing is not a
 * flicker on one triangle — it is a character disappearing, and it only happens
 * near the screen edge, which is exactly where nobody is looking when they
 * take the screenshot that signs a phase off.
 *
 * REJECTED: `Mesh.refreshBoundingInfo(true)`, Babylon's own apply-the-skeleton
 * recompute. It is correct — measured on unbound near stage it reports
 * max.x = 1.1868 against the rest box's 0.880, i.e. the same 0.3068 m overhang
 * the pure twin below measures, which is a pleasant independent corroboration
 * of these numbers — but it costs a full CPU pass over every vertex of every
 * actor, and it is only right for the pose it was called at. P7 poses once at
 * construction; P9 animates, and "recompute the bounds of 24 actors every time
 * a clip advances a frame" is a per-frame CPU cost paid to avoid a static
 * margin whose entire price is a few extra draw calls at the screen edge.
 *
 * ── THE NUMBERS, AND WHY THE MARGIN IS THE ONE IT IS ───────────────────────
 *
 * `POSE_ENVELOPE_MANIFEST[id][stage]` carries two measured metres per master,
 * both taken through `skinPayload(payload, rig, evaluatePose(rig,
 * CANARY_POSE[id]))` — the same CPU skinning twin every other gate in P7
 * compares the engine against:
 *
 *   `overhangM` — the largest distance any posed vertex sits OUTSIDE the
 *     axis-aligned box of the same master's REST positions, over all six
 *     faces. This is the fault itself, measured. Roster worst: 0.3265 m
 *     (unbound, far stage).
 *
 *   `travelM` — the largest distance any single vertex MOVES between rest and
 *     posed. Roster worst: 0.8298 m (unbound, far stage).
 *
 * The margin is sized off `travelM`, not off `overhangM`, and that is the
 * whole of the headroom argument — no multiplier is guessed anywhere.
 * OVERHANG CAN NEVER EXCEED TRAVEL: a vertex starts inside the box, so on any
 * axis `posed - max <= posed - rest <= |posed - rest|`, and symmetrically for
 * the min face. So `travelM` is not a bigger number chosen for comfort; it is
 * the TIGHT ceiling on how far a pose of this magnitude could overhang if its
 * rotations were aimed differently — which is precisely the thing a single
 * measured pose cannot tell us. Ship the ceiling and the aim stops mattering.
 *
 *   measured worst overhang   0.3265 m   (what actually happens today)
 *   measured worst travel     0.8298 m   (the aim-independent ceiling)
 *   SHIPPED MARGIN            0.85   m   (2.60x the overhang, 1.024x the ceiling)
 *
 * ISOTROPIC — the same margin on all six faces — because a per-face margin
 * would encode the canary's aim into the culler, and the aim is the part that
 * is not general. Its cost is that an actor stays visible to the culler up to
 * 0.85 m past its true silhouette: at the LOD band edge (96 m) that is 0.51
 * degrees, ~16 px at 1080p/60-degree FOV, against a ceiling of 24 simultaneous
 * actors (model/actorBudget.js). A handful of edge-of-frame draw calls.
 *
 * ── WHAT THIS MARGIN DOES *NOT* COVER, AND WHEN P9 MUST REVISIT ────────────
 *
 * `setPose` accepts ANY table of unit-axis rotations. The margin is measured
 * at ONE point in that space — `CANARY_POSE`, the prime-degree ladder
 * 7/11/13/17/19/23/29 (model/actorCanary.js) — and everything beyond that
 * point is UNMEASURED, not bounded. A pose with larger angles, or one that
 * compounds further down unbound's four-joint graft chain, will exceed it.
 *
 * REVISIT TRIGGER, concretely: the first P9 clip whose worst posed-vertex
 * travel exceeds 0.85 m on ANY (archetype, stage). That is a checkable
 * condition, not a judgement call — actorEnvelope.test.js already asserts
 * `travelM <= ACTOR_POSE_MARGIN_M` for the canary, and P9's clip tables belong
 * in that same audit the day they exist. When it fires, raise this constant to
 * the new roster-wide worst travel; do NOT switch to per-archetype margins
 * without re-arguing the aim-independence above.
 */

/**
 * Measured per (archetype, stage) under `CANARY_POSE`, in metres, rounded to
 * 4 decimals so the audit's `toEqual` is stable across runs (the same
 * declaration discipline ACTOR_MANIFEST's `silhouetteM2` uses). Regenerate
 * from actorEnvelope.test.js's logged actuals when a genome or the canary
 * deliberately changes. Measured 2026-08-07.
 */
export const POSE_ENVELOPE_MANIFEST = Object.freeze({
  unbound: [
    { overhangM: 0.3068, travelM: 0.8222 },
    { overhangM: 0.3265, travelM: 0.8298 },
  ],
  legion: [
    { overhangM: 0.1559, travelM: 0.2224 },
    { overhangM: 0.1657, travelM: 0.2205 },
  ],
  magistari: [
    { overhangM: 0, travelM: 0.0562 },
    { overhangM: 0, travelM: 0.0558 },
  ],
  orghon: [
    { overhangM: 0.035, travelM: 0.3079 },
    { overhangM: 0.0519, travelM: 0.3029 },
  ],
});

/**
 * Metres added to every face of a live actor mesh's bounding box, so the
 * frustum culler tests a box a POSED actor still fits inside.
 *
 * Applied to the CLONE, in `view/actor/ActorRig.js`'s `_applyTier`, and NOT to
 * ActorPrototypes' master — see that call site for the measured engine fact
 * that forces it there.
 *
 * See the header for the derivation (0.3265 measured overhang, 0.8298
 * aim-independent ceiling) and for the P9 revisit trigger.
 */
export const ACTOR_POSE_MARGIN_M = 0.85;
