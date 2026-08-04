/**
 * selfShadow — how strongly terrainField.js's baked recess proxy should read
 * right now.
 *
 * Deliberately decoupled from the proxy itself: shadeProxyAt is baked once
 * per vertex at chunk-gen time and never changes, because it is derived from
 * terrain shape alone. Strength is evaluated every frame from the CURRENT sun
 * elevation and multiplies the baked value in the shader. Splitting them
 * means a stance transition or a time-of-day change never touches geometry —
 * only the uniform terrainNME.js reads moves.
 *
 * Grazing light (dawnfire, gloaming) reads recesses at their deepest; a high
 * sun flattens the effect toward — but never quite to — zero, so a ravine
 * floor still reads a little darker than open ground even at high-noon.
 */

const MIN_STRENGTH = 0.15;
const MAX_STRENGTH = 0.85;

/** Sun elevation (sin) below which strength is already maxed — a grazing sun. */
const GRAZING_Y = 0.25;
/** Sun elevation above which strength has bottomed out — a high, overhead sun. */
const OVERHEAD_Y = 0.85;

const smoothstep = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * @param {number} sunDirY sin(elevation) — a skyState's `sunDir[1]`. Can be
 *   negative (sun below the horizon, e.g. moonwash); the curve saturates at
 *   MAX_STRENGTH rather than continuing to grow, so a night stance reads the
 *   same deep self-shadow as a grazing dawn rather than something stranger.
 * @returns {number} in [MIN_STRENGTH, MAX_STRENGTH].
 */
export function selfShadowStrength(sunDirY) {
  // Inverted smoothstep: low/negative sunDirY (grazing or below horizon) ->
  // t near 1 -> MAX_STRENGTH. High sunDirY (overhead) -> t near 0 -> MIN_STRENGTH.
  const t = smoothstep(OVERHEAD_Y, GRAZING_Y, sunDirY);
  return MIN_STRENGTH + t * (MAX_STRENGTH - MIN_STRENGTH);
}
