/**
 * rendererChoice — decide which Babylon engine backend to create.
 *
 * PURE. No BABYLON, no DOM. Probing the device is somebody else's job (see
 * realmProbe); this module only turns facts into a decision, so the decision is
 * unit-testable and the graphics panel can preview it without an engine alive.
 *
 * Policy (locked): WebGL2 is what everybody ships on. WebGPU is opt-in behind a
 * graphics-panel flag — never selected by 'auto' — because the Realm's custom
 * materials transpile to both backends and a silent WGSL compile difference is
 * exactly the kind of bug that only reproduces on someone else's hardware.
 */

export const RENDERER = Object.freeze({
  WEBGL2: 'webgl2',
  WEBGPU: 'webgpu',
});

/** Values the graphics panel may persist. */
export const RENDERER_PREF = Object.freeze({
  AUTO: 'auto',
  WEBGL2: 'webgl2',
  WEBGPU: 'webgpu',
});

/**
 * @param {object} facts
 * @param {'auto'|'webgl2'|'webgpu'} [facts.pref]  player preference
 * @param {boolean} [facts.hasWebGPU]              navigator.gpu present
 * @param {boolean} [facts.isIOS]                  iOS/iPadOS Safari
 * @returns {{renderer: string, reason: string, requestedFallback: boolean}}
 *   `requestedFallback` is true when the player asked for WebGPU and could not
 *   have it — the UI should say so rather than silently showing "WebGL2".
 */
export function chooseRenderer({ pref = RENDERER_PREF.AUTO, hasWebGPU = false, isIOS = false } = {}) {
  if (pref === RENDERER_PREF.WEBGL2) {
    return { renderer: RENDERER.WEBGL2, reason: 'explicit-webgl2', requestedFallback: false };
  }

  if (pref === RENDERER_PREF.WEBGPU) {
    if (!hasWebGPU) {
      return { renderer: RENDERER.WEBGL2, reason: 'webgpu-unavailable', requestedFallback: true };
    }
    // iOS Safari's WebGPU is new enough that we let it through only on an
    // explicit request, and still record why, so a bug report can be read.
    return {
      renderer: RENDERER.WEBGPU,
      reason: isIOS ? 'explicit-webgpu-ios' : 'explicit-webgpu',
      requestedFallback: false,
    };
  }

  // AUTO — and anything unrecognised — is WebGL2. Deliberately not "best
  // available": auto must be the boring, universally-tested path.
  return { renderer: RENDERER.WEBGL2, reason: 'auto-default', requestedFallback: false };
}
