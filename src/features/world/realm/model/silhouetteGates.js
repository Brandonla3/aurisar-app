/**
 * silhouetteGates — the actor silhouette contract's numbers, in one place.
 *
 * PURE data. Nothing in THIS task consumes these constants — the harness
 * they gate (model/silhouette.js's canonicalStats/fitsWindow/bandOccupancy)
 * ships here, and later P6 tasks spend it: building the four faction
 * archetypes, then asserting each one's own LOD stages stay above the LOD
 * gates and every archetype stays below the pair gate against every other
 * archetype. Splitting the numbers out now — before anything reads them —
 * means the values and their evidence land in review as their own small,
 * readable diff, the same discipline propBudget.js's BUDGET_CEILINGS uses:
 * every constant below carries the measurement that justifies it, so a
 * future retune reads numbers, not folklore.
 */

/** Same LOD contract shape props already pass: mean IoU between an
 *  archetype's adjacent LOD stages must clear this bar. */
export const ACTOR_LOD_IOU_MIN = 0.85;

/** The worst SINGLE yaw's IoU must also clear a bar — a crown (or, for
 *  actors, a limb) collapsing at one camera angle must not hide inside an
 *  otherwise-healthy mean. Same shape as propGen.test.js's per-yaw floor. */
export const ACTOR_LOD_WORST_YAW_MIN = 0.82;

/** Max allowed crown-width pop between adjacent LOD stages, silhouetteStats'
 *  widthDeltaFrac. Matches the props' gate exactly. */
export const ACTOR_LOD_WIDTH_DELTA_MAX = 0.10;

/** Ceiling on canonicalStats meanIoU between any two DIFFERENT archetypes —
 *  the four factions must read as different silhouettes, not just different
 *  textures.
 *
 *  CALIBRATED at 0.678 + 0.042 headroom, which is how the 0.72 was arrived
 *  at in Task 1 — but 0.678 is the OUT-OF-TREE probe's mass-reallocated
 *  benchmark, authored before any archetype in this repo existed, and this
 *  comment called it "measured worst pair (closest two of the four)" until
 *  the P6 final review. The shipped roster's worst pair is magistari x orghon
 *  at 0.506 near / 0.501 far, so the real headroom is 0.214, not 0.042.
 *  Anyone reading this before moving the constant should read that number:
 *  the roster is nowhere near this gate, and tightening toward 0.68 on the
 *  belief that it is would be tightening against a number no test in this
 *  repo computes. gen/actorSilhouette.test.js logs the live worst pair and
 *  its live headroom on every CI run. */
export const ACTOR_PAIR_IOU_MAX = 0.72;

/** An archetype's self-match (same archetype, compared to itself or its own
 *  other LOD stage) must beat its best cross-archetype impostor score by at
 *  least this much — the actual "can a player tell these apart" bar, not
 *  just "is the pair score below a ceiling". */
export const ACTOR_ID_MARGIN_MIN = 0.15;

/** World-Y band edge: waist height, meters. Splits the lowest bandOccupancy
 *  band (legs) from the middle one (torso). */
export const WAIST_Y = 0.85;

/** World-Y band edge: shoulder height, meters. Splits the middle
 *  bandOccupancy band (torso) from the top one (head/shoulders). */
export const SHOULDER_Y = 1.45;

/** Pitch, in radians, the actor gates render silhouettes at — the chase
 *  camera's eye. A camera looking level (pitch 0) is not the view players
 *  actually judge an actor's silhouette from; the chase rig looks down at
 *  this angle, which is also why ACTOR_WINDOW's minY has to clear the
 *  resulting depth term.
 *
 *  Derived, not measured-and-hardcoded, and deliberately so — but derived
 *  from the DEV SPIKE's chase camera (an ArcRotateCamera built in
 *  view/dev/spike.js — the ONE layer allowed to name the render engine,
 *  this file stays engine-free by only naming its angle constant), which is
 *  explicitly "a scaffold, not architecture" per that file's own header,
 *  dev/preview only, never production. It is used here as a STAND-IN
 *  because it is the only chase-camera geometry that exists in the repo
 *  today, not because it is the final gameplay camera. It is constructed
 *  with beta = Math.PI / 3.1; that camera type's beta is measured from +Y
 *  (directly overhead is beta=0; level with the target is beta=PI/2), so
 *  its downward declination from the horizon is PI/2 - beta.
 *
 *  THE PI/3.1 BELOW IS A DUPLICATED LITERAL, NOT A SHARED CONSTANT. It
 *  cannot be shared: model/ may not import view/ (boundary.test.js), and
 *  spike.js cannot be imported at all without the engine global. This
 *  comment used to claim the two "cannot silently drift apart from EACH
 *  OTHER while both exist", which was simply false — they were two magic
 *  numbers with nothing between them, and retuning the spike's beta left
 *  every gate green while the phrase kept promising otherwise. The link is
 *  now real but it is a SOURCE SCAN, not an import:
 *  model/silhouetteGates.test.js reads view/dev/spike.js's text and fails if
 *  its beta literal stops matching the one below. Retuning the camera is
 *  therefore allowed and loud, which is the behaviour the sentence was
 *  reaching for.
 *
 *  Consequence for later work: when RealmWorld's real gameplay camera lands
 *  (the P13 switchover, per the spike's own header), THIS constant must be
 *  re-derived from that camera's actual beta — carrying spike.js's PI/3.1
 *  forward unexamined past that point means the actor silhouette gates
 *  would keep measuring an eye the shipped game no longer uses.
 *
 *  Measured value: PI/2 - PI/3.1 ≈ 0.5574 rad ≈ 31.9° above horizontal. */
export const GATE_PITCH_RAD = Math.PI / 2 - Math.PI / 3.1;

/** Mask resolution the actor gates rasterize at. Actors read roughly 38
 *  cells tall at ACTOR_WINDOW's span — comparable to their on-screen pixel
 *  height at the LOD switch distance, the same reasoning propGen.test.js's
 *  32-res gate uses for props sized nearer that resolution. */
export const GATE_RES = 48;
