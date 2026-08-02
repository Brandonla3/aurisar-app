/**
 * chunkFade — the fade-in progress math for a just-streamed chunk.
 *
 * PURE. Structural pop-in concealment: a chunk fades in over a fixed duration
 * instead of hiding behind scene.fogDensity. This is what frees fogDensity
 * from concealment duty — see view/terrain/TerrainStreamer.js for the other
 * half (mesh.visibility wiring) and model/horizonRings.js + view/materials/
 * horizonRingNME.js for how the freed density budget gets spent (far crag
 * rings that were previously washed out by a near-tuned density).
 */

/** Default fade duration. Long enough to read as intentional, short enough
 *  that a sprinting player never outruns it into a hard edge. */
export const CHUNK_FADE_MS = 300;

/**
 * @returns visibility in [0, 1] for a mesh born at `birthMs`, evaluated at `nowMs`.
 */
export function chunkFadeVisibility(nowMs, birthMs, fadeMs = CHUNK_FADE_MS) {
  if (fadeMs <= 0) return 1;
  const t = (nowMs - birthMs) / fadeMs;
  return Math.min(Math.max(t, 0), 1);
}

/** True once a chunk born at `birthMs` has fully materialized. */
export function isFadeComplete(nowMs, birthMs, fadeMs = CHUNK_FADE_MS) {
  return nowMs - birthMs >= fadeMs;
}
