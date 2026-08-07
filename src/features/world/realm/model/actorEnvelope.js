/**
 * actorEnvelope — how far a POSED actor's skin reaches OUTSIDE the box its
 * REST geometry implies, and the margin that covers it.
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
 * margin.
 *
 * ── THE MEASUREMENTS ───────────────────────────────────────────────────────
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
 *     posed. Roster worst: 0.8298 m (unbound, far stage). RETAINED AS A
 *     MEASUREMENT, NOT USED AS THE BASIS — see the sizing argument below, and
 *     do not "restore" it as the margin: actorEnvelope.test.js pins the margin
 *     BELOW it on purpose.
 *
 * ── THE MARGIN HAS TWO CONSUMERS, AND THE SECOND ONE IS QUADRATIC ──────────
 *
 * The box `view/actor/ActorRig.js` inflates is not read by the frustum culler
 * alone. `DirectionalLight._setDefaultAutoExtendShadowProjectionMatrix`
 * derives its orthographic shadow extents from the shadow render list's
 * `getBoundingInfo().boundingBox.vectorsWorld` — the SAME box — and the
 * spike's key light runs on defaults (`autoUpdateExtends` true,
 * `shadowFrustumSize` 0) with actors as its only casters. So every metre of
 * margin also widens the shadow frustum, and the shadow map is a FIXED
 * 1024-square: widening it does not cost a draw call, it costs TEXEL DENSITY
 * on the character, as area, which is the square of the margin's linear cost.
 *
 * Measured headless (NullEngine, key light (-0.55, -1, 0.35), one near caster,
 * unbound stage 0 posed with the canary, `ShadowGenerator.getTransformMatrix`
 * driving Babylon's own auto-extend):
 *
 *     margin   ortho W x H     area     vs margin 0   texels/m at 1024^2
 *     0.0000   1.121 x 2.084    2.336     1.00x        914 x 491
 *     0.2000   1.673 x 2.765    4.626     1.98x        612 x 370
 *     0.3265   2.022 x 3.196    6.463     2.77x        506 x 320
 *     0.4000   2.225 x 3.446    7.668     3.28x        460 x 297
 *     0.8500   3.468 x 4.978   17.264     7.39x        295 x 206
 *
 * The extents grow LINEARLY in the margin — exactly `2 * margin * k` per axis,
 * with k = 1.380 (W) and 1.702 (H) measured constant across every row above.
 * Those k are the light-space axis loadings of the box's own axes and are
 * bounded by sqrt(3); the point is that AREA, and therefore texel density,
 * goes as the SQUARE. That is the whole reason the sizing argument below
 * changed.
 *
 * ── HOW THE MARGIN IS SIZED, AND THE BASIS THAT WAS REJECTED ───────────────
 *
 * SHIPPED: 0.40 m, isotropic on all six faces, from the measured worst CANARY
 * OVERHANG of 0.3265 m with 1.22x headroom.
 *
 * OVERHANG IS WHAT BOTH CONSUMERS ACTUALLY NEED. Culling asks "does the box
 * contain every posed vertex"; the auto-extended shadow ortho asks "does the
 * box cover the posed shadow extent". Both are ENVELOPE questions, and the
 * envelope is `overhangM`.
 *
 * The first version of this file sized the margin at 0.85 m off `travelM`
 * instead, on the argument that overhang can never exceed travel (true: a
 * vertex starts inside the box, so on any axis `posed - max <= posed - rest <=
 * |posed - rest|`) and that travel is therefore the tight, aim-independent
 * ceiling on how far a pose of this magnitude COULD overhang if aimed
 * differently. The algebra is sound and the conclusion was still wrong,
 * because it is the ceiling of the WRONG QUANTITY: it prices the worst case of
 * a re-aimed pose against a cost function that is quadratic in the margin, and
 * pays 7.39x shadow area (86% of the character's texel density) for a
 * re-aiming that no pose in the roster performs. 0.40 pays 3.28x for the same
 * containment. Both numbers are in the table above; the trade is visible.
 *
 * The headroom itself costs 2.77x -> 3.28x area, i.e. ~18% more shadow area
 * than sizing exactly on 0.3265 with no headroom at all. That is the price of
 * not sitting on the measured number, and it is worth paying; the travel
 * ceiling's extra 4.1x was not.
 *
 * CONTAINMENT AT 0.40 IS MEASURED, NOT ASSUMED. The mutation run that shrank
 * this constant to 0.4 left every live containment assertion in
 * view/actor/ActorRigSkin.test.js GREEN — 0.40 > the roster's worst overhang
 * 0.3265 on all eight masters — and tripped only this file's audit, which is
 * the gate on the headroom argument rather than on containment.
 *
 * ISOTROPIC and ROSTER-WIDE rather than per-face or per-archetype: a per-face
 * margin bakes the canary's particular AIM into two consumers, and a
 * per-archetype margin would hand magistari a margin of 0 on the strength of
 * one measured pose.
 *
 * ── WHAT THIS MARGIN DOES *NOT* COVER, AND WHEN P9 MUST REVISIT ────────────
 *
 * `setPose` accepts ANY table of unit-axis rotations. The margin is measured
 * at ONE point in that space — `CANARY_POSE`, the prime-degree ladder
 * 7/11/13/17/19/23/29 (model/actorCanary.js) — and everything beyond that
 * point is UNMEASURED, not bounded. A pose with larger angles, or one that
 * compounds further down unbound's four-joint graft chain, will exceed it.
 *
 * REVISIT TRIGGER, concretely: the first P9 clip whose measured OVERHANG
 * exceeds 0.40 m on ANY (archetype, stage). Not travel — overhang; see the
 * sizing argument. That is a checkable condition, not a judgement call, and
 * actorEnvelope.test.js already asserts it for the canary. P9's clip tables
 * belong in that same audit the day they exist.
 *
 * WHOEVER RE-SIZES THIS MUST PRICE BOTH CONSUMERS. The frustum culler is the
 * obvious one and it is the cheap one. The other is the auto-extended
 * directional-light shadow ortho described above, whose cost in character
 * texel density goes as the square of whatever number is written below.
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
 * Metres added to every face of a live actor mesh's bounding box.
 *
 * TWO CONSUMERS READ THIS, and the second one's cost is quadratic: the frustum
 * culler (so a POSED actor is not culled with a limb on screen) and
 * `DirectionalLight`'s auto-extended shadow ortho (so raising this number
 * spends the character's shadow-map texel density). See the header for the
 * measured table, the 0.3265 m worst overhang it is derived from, and the P9
 * revisit trigger.
 *
 * Applied to the CLONE, in `view/actor/ActorRig.js`'s `_applyTier`, and NOT to
 * ActorPrototypes' master — see that call site for the measured engine fact
 * that forces it there.
 */
export const ACTOR_POSE_MARGIN_M = 0.40;
