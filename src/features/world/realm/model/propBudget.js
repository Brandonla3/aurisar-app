/**
 * propBudget — every prototype's DECLARED cost, plus the world's ceilings.
 *
 * PURE data: the bill of lading. Freight moves on trusted paperwork, not by
 * opening every crate — the headless budget census (realmBudget.test.js)
 * sums these declarations over a worst-case chunk census without a GPU,
 * and the runtime reads the same numbers. A prototype that ships without a
 * manifest entry fails CI (the census refuses undeclared cargo), and a
 * manifest that drifts from what gen/propGen.js actually emits fails the
 * audit test (propBudget.test.js regenerates and compares) — so the
 * paperwork cannot lie in either direction.
 *
 * `silhouetteM2` is the mean projected silhouette area (model/silhouette.js)
 * — the analytic fill-rate bill. Triangle ceilings can't catch a two-
 * triangle canopy plane the size of a house; projected area can, and that
 * class of regression (leaf-card overdraw) was the old world's #1 mobile
 * killer.
 */

/** Per-prototype, per-stage declared costs. Regenerate via the audit test's
 *  logged actuals when a genome deliberately changes. */
export const PROP_MANIFEST = Object.freeze({
  valeoak: [
    { tris: 888, verts: 2328, silhouetteM2: 8.41 },
    { tris: 230, verts: 590, silhouetteM2: 7.56 },
  ],
  cragpine: [
    { tris: 332, verts: 972, silhouetteM2: 6.06 },
    { tris: 90, verts: 250, silhouetteM2: 5.4 },
  ],
  cragpine_hardy: [
    { tris: 332, verts: 972, silhouetteM2: 4.63 },
    { tris: 90, verts: 250, silhouetteM2: 4.19 },
  ],
  cragpine_krum: [
    { tris: 332, verts: 972, silhouetteM2: 2.95 },
    { tris: 90, verts: 250, silhouetteM2: 2.71 },
  ],
  boulder: [
    { tris: 80, verts: 240, silhouetteM2: 1.86 },
  ],
  bramble: [
    { tris: 68, verts: 188, silhouetteM2: 0.44 },
  ],
  tuft: [
    { tris: 8, verts: 16, silhouetteM2: 0.07 },
  ],
});

/**
 * The world ceilings the census asserts, set from the measured worst case
 * plus ~25-30% headroom — so a regression has to be REAL to trip them, and
 * a deliberate content expansion has to raise them consciously, in review.
 *
 * Measured actuals (2026-08-05, after PR review corrected the census MODEL
 * itself — sticky-NEAR hysteresis billing instead of cold-start tiers, the
 * shipping camera's real 0.8 rad FOV instead of an assumed 60 degrees,
 * chunk-CENTER cameras added since corners are the LOW-resident config
 * under Chebyshev streaming, and a diagonal rebuild march): drawCalls
 * worst 117 (belt 4-corner deep), triangles worst 567,602 (belt corner),
 * fillScreens worst 6.6 (crag chunk-center — the underfoot chunk bills its
 * whole prop field at the 8m distance floor with no frustum culling, which
 * biases HIGH: acceptable for a regression ceiling, unusable as a
 * human-readable "screens of overdraw" figure), rebuilds worst 32. The
 * prior generation of these numbers (91/357k/0.71/19) measured a camera
 * state the renderer never occupies; before that, hand-guessed ceilings
 * were 3-50x too loose. Each retune has been evidence replacing folklore.
 */
export const BUDGET_CEILINGS = Object.freeze({
  /** Live (prototype, chunk) thin-instance draw calls, worst camera. */
  drawCalls: 150,
  /** Summed instance-count x per-stage tris, worst camera. */
  triangles: 740_000,
  /** Carriers rebuilt by one worst-case (diagonal) camera-cell crossing. */
  rebuildsPerCrossing: 42,
  /** Analytic fill proxy at the worst camera (census screenM2 formula:
   *  0.8 rad vertical FOV, 16:9, chunk-center distance, 8m floor, no
   *  frustum culling — a conservative upper bound, not a literal screen
   *  count). */
  fillScreens: 8.5,
});
