/**
 * cloudShadow — clouds without a cloud renderer.
 *
 * PURE. The core P4c trick: a passing cloud is felt as a slow drift in light
 * and fog, not rendered as an occluding object at all — the classic flight-
 * sim "invisible cloud shadow." Two independent ADHD divergent branches
 * (framed a decade apart: "a curious 10-year-old" and "one hour, no team")
 * converged on this exact idea unprompted, which is the signal that made it
 * the P4c pick over a geometry-first approach.
 *
 * `cloudFactorAt` is a pure function of time only — two incommensurate-period
 * sine waves summed and remapped, so the "weather" never exactly repeats on
 * a short loop, and never fully clears (1) or fully overcasts (MIN_FACTOR):
 * the vale is never in flat, shadowless light nor plunged into total gloom.
 *
 * `applyCloudDimming` is a pure transform: given a base skyState (from
 * skyModel.js's skyStateFrom) and a cloudFactor, it returns a NEW state with
 * sun/ambient dimmed and fog/clear nudged toward neutral gray. It never
 * mutates its input — FogDriver decides whether and how to write the result,
 * same separation of concerns as every other model/ pure function here.
 *
 * Deliberately NOT spatially correlated with cloudPuffs.js's visible geometry
 * — no XZ lookup ties "a puff is here" to "the world dims here". Coupling is
 * temporal only (same nowMs, comparable period), which the P4c design pass
 * judged sufficient: a dip-and-a-drifting-puff coinciding often enough reads
 * as one phenomenon without paying for a ground/sky correlation pass.
 */

/** Two incommensurate periods so the combined pattern doesn't visibly repeat
 *  on a short loop (a session is 40 minutes per skyPlaylist's CYCLE_MS; these
 *  are short enough that "weather" visibly changes many times per cycle). */
const PERIOD_A_MS = 47_000;
const PERIOD_B_MS = 71_000;

/** Deepest dimming: the vale is never fully overcast. Exported so consumers
 *  (cloudPuffs.js's visibility formula) can normalize against the ACTUAL
 *  achievable range instead of duplicating these numbers a second place they
 *  could silently drift from. */
export const MIN_FACTOR = 0.55;
/** Brightest: clear sky, zero dimming. */
export const MAX_FACTOR = 1.0;

/**
 * @param {number} nowMs wall-clock-ish time, any monotonic ms source.
 * @returns {number} in [MIN_FACTOR, MAX_FACTOR]. 1 = clear sky.
 */
export function cloudFactorAt(nowMs) {
  const a = Math.sin((nowMs / PERIOD_A_MS) * Math.PI * 2);
  const b = Math.sin((nowMs / PERIOD_B_MS) * Math.PI * 2);
  const t = ((a + b) / 2 + 1) / 2; // -1..1 -> 0..1
  return MIN_FACTOR + t * (MAX_FACTOR - MIN_FACTOR);
}

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (rgb, toward, t) => [
  lerp(rgb[0], toward[0], t), lerp(rgb[1], toward[1], t), lerp(rgb[2], toward[2], t),
];

/** Neutral overcast gray — what fog/clear color nudge toward as cover deepens. */
const OVERCAST_GRAY = [0.55, 0.56, 0.58];
/** How far toward OVERCAST_GRAY full cover pulls fog/clear — a nudge, not a repaint. */
const FOG_TINT_MAX = 0.35;

/**
 * @param {object} state a skyModel.js skyStateFrom(...) result (or anything
 *   with the same shape — sunIntensity, ambientIntensity, fogColor,
 *   clearColor). Never mutated.
 * @param {number} cloudFactor cloudFactorAt(...)'s output, 1 = clear.
 * @returns {object} a NEW state with sun/ambient dimmed and fog/clear nudged
 *   toward gray. At cloudFactor === MAX_FACTOR this is an identity transform
 *   (every field numerically unchanged).
 */
export function applyCloudDimming(state, cloudFactor) {
  const overcast = 1 - cloudFactor;
  return {
    ...state,
    sunIntensity: state.sunIntensity * cloudFactor,
    ambientIntensity: state.ambientIntensity * cloudFactor,
    fogColor: lerp3(state.fogColor, OVERCAST_GRAY, overcast * FOG_TINT_MAX),
    clearColor: lerp3(state.clearColor, OVERCAST_GRAY, overcast * FOG_TINT_MAX),
  };
}
