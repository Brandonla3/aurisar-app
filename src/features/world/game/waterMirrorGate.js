/**
 * Lake reflection gating policy.
 *
 * The lake's planar reflection is a `MirrorTexture` pushed into
 * `scene.customRenderTargets` (see `streaming/ashwoodTileProvider.js`). Babylon
 * renders every entry in that array once per frame *unconditionally* — it does
 * not check whether the mesh sampling the texture is visible, on screen, or
 * even loaded. With `renderList = null` the mirror re-renders the WHOLE scene,
 * so the high tier was paying a second full scene traversal every frame while
 * standing on the far side of the map, and inside Castle Ashwood where there is
 * no water at all.
 *
 * Tier-gating (high only) was already in place; this is the missing gate
 * *within* the tier. The policy is pure so the thresholds can be tested without
 * a GPU, and lives apart from the scene because the scene owns the inputs
 * (player position, interior state) while the tile provider owns the texture.
 *
 * "Off" freezes the last rendered contents rather than blanking them, which is
 * why the ranges are generous: a stale reflection is only wrong if you can see
 * it, and the fog horizon (~60-80 m, matching `ssao.maxZ` / `csm.shadowMaxZ`)
 * puts the lake surface well past legibility before we stop refreshing.
 */

/** Refresh rate meaning "render one more frame, then hold that image". */
export const MIRROR_OFF = 0;

export const MIRROR_GATE_DEFAULTS = Object.freeze({
  /** Distance past the water edge that still refreshes every frame. */
  fullRange: 35,
  /** ...every other frame. */
  halfRange: 70,
  /** ...every third frame. Beyond this the mirror stops refreshing. */
  quarterRange: 110,
  /**
   * Once off, require coming this much closer than `quarterRange` before
   * refreshing again, so a player walking the boundary can't toggle a full
   * scene render on and off every frame.
   */
  hysteresis: 12,
});

/**
 * @param {object}  p
 * @param {number}  p.distance       Planar distance from the viewer to the lake centre (m).
 * @param {number} [p.waterRadius]   Lake surface radius (m) — ranges are measured from its edge.
 * @param {boolean}[p.indoors]       Castle interior or dungeon instance: no water is visible at all.
 * @param {boolean}[p.wasOff]        Previous resolved state, for hysteresis on the on/off edge.
 * @param {object} [p.tuning]
 * @returns {number} A Babylon `RenderTargetTexture.refreshRate`: 0 = hold, 1 = every
 *   frame, N = every Nth frame.
 */
export function resolveMirrorRefreshRate({
  distance,
  waterRadius = 0,
  indoors = false,
  wasOff = false,
  tuning = MIRROR_GATE_DEFAULTS,
}) {
  // No water is rendered in an interior, so the reflection can never be seen.
  if (indoors) return MIRROR_OFF;
  // No usable position yet (avatar still loading): hold rather than pay for a
  // reflection nobody is looking at. Load is exactly when the frame budget is
  // tightest.
  if (!Number.isFinite(distance)) return MIRROR_OFF;

  const edge = Math.max(0, distance - Math.max(0, waterRadius));
  const offAt = tuning.quarterRange - (wasOff ? tuning.hysteresis : 0);

  if (edge > offAt) return MIRROR_OFF;
  if (edge <= tuning.fullRange) return 1;
  if (edge <= tuning.halfRange) return 2;
  return 3;
}
