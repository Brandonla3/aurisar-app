/**
 * RealmEngine — creates the Babylon engine, and nothing else.
 *
 * The layer below this (settings/rendererChoice) decides WHICH backend; this
 * module only builds it and keeps it alive across context loss. Keeping creation
 * separate from the scene is what lets a boot failure be reported as a boot
 * failure rather than a blank canvas.
 *
 * Two hard-won constraints from the stack this replaces:
 *  - `powerPreference: 'high-performance'` is desktop-only. Requesting the
 *    discrete GPU on mobile is at best ignored and at worst a battery/thermal
 *    problem that surfaces as a mid-session framerate collapse.
 *  - Engine construction can throw on constrained devices. A second attempt with
 *    minimal options succeeds often enough to be worth the twelve lines.
 */

/* global BABYLON */

import { RENDERER } from '../settings/rendererChoice.js';

/** Options we ask for when the device looks capable. */
function richOptions(isMobile) {
  return {
    stencil: true,
    antialias: true,
    // Never preserve the drawing buffer: it forces a readback path and costs
    // real framerate. Screenshots go through Babylon's own capture instead.
    preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: false,
    ...(isMobile ? {} : { powerPreference: 'high-performance' }),
  };
}

/** Last-resort options — no AA, no stencil. Used only after a failed attempt. */
const MINIMAL_OPTIONS = {
  stencil: false,
  antialias: false,
  preserveDrawingBuffer: false,
  failIfMajorPerformanceCaveat: false,
};

/**
 * A canvas can only ever hand out ONE kind of rendering context. Once
 * `getContext('webgpu')` has succeeded, `getContext('webgl2')` on that same
 * element returns null forever. So if WebGPU init fails *after* acquiring the
 * context — which is exactly what a configuration failure looks like — falling
 * back on the same canvas is guaranteed to fail too, turning a degraded-but-
 * working boot into a dead one.
 *
 * Swapping in a clone (attributes and id preserved, no children) gives WebGL2 an
 * unbound element to work with.
 */
function replaceCanvas(canvas) {
  const fresh = canvas.cloneNode(false);
  if (canvas.parentNode) canvas.parentNode.replaceChild(fresh, canvas);
  return fresh;
}

/**
 * @returns {Promise<{engine: object, renderer: string, canvas: object, degraded: boolean}>}
 *   `degraded` is true when we fell back to minimal options or to WebGL2 after a
 *   WebGPU failure — the caller surfaces it rather than hiding it. `canvas` is
 *   returned because the fallback may have had to swap the element; callers that
 *   bind input (camera.attachControl) must use the one handed back, not the one
 *   they passed in.
 */
export async function createRealmEngine(canvas, { renderer = RENDERER.WEBGL2, isMobile = false } = {}) {
  if (!canvas) throw new Error('[RealmEngine] a canvas is required');

  if (renderer === RENDERER.WEBGPU) {
    let gpuEngine = null;
    try {
      gpuEngine = new BABYLON.WebGPUEngine(canvas, { stencil: true, antialias: true });
      await gpuEngine.initAsync();
      return { engine: gpuEngine, renderer: RENDERER.WEBGPU, canvas, degraded: false };
    } catch (err) {
      // WebGPU is opt-in, so a failure here is a preference we could not honour,
      // not a fatal error. Fall through to WebGL2 and report it.
      console.warn('[RealmEngine] WebGPU init failed, falling back to WebGL2:', err?.message ?? err);
      // Release whatever the half-built engine grabbed before abandoning it.
      try { gpuEngine?.dispose(); } catch { /* best effort — it never fully initialised */ }
      const freshCanvas = replaceCanvas(canvas);
      const { engine } = createWebGL2(freshCanvas, isMobile);
      return { engine, renderer: RENDERER.WEBGL2, canvas: freshCanvas, degraded: true };
    }
  }

  const { engine, degraded } = createWebGL2(canvas, isMobile);
  return { engine, renderer: RENDERER.WEBGL2, canvas, degraded };
}

function createWebGL2(canvas, isMobile) {
  try {
    return { engine: new BABYLON.Engine(canvas, true, richOptions(isMobile), true), degraded: false };
  } catch (err) {
    console.warn('[RealmEngine] engine creation failed, retrying minimal:', err?.message ?? err);
    return { engine: new BABYLON.Engine(canvas, false, MINIMAL_OPTIONS, false), degraded: true };
  }
}

/**
 * Wire context-loss handling. WebGL contexts are lost on GPU driver resets, tab
 * backgrounding on some mobile browsers, and memory pressure. Babylon restores
 * most state itself; the callbacks exist so the app can pause simulation and
 * tell the player something rather than presenting a frozen world.
 *
 * @returns {() => void} teardown
 */
export function bindContextLoss(engine, { onLost, onRestored } = {}) {
  const lost = () => { onLost?.(); };
  const restored = () => { onRestored?.(); };
  engine.onContextLostObservable.add(lost);
  engine.onContextRestoredObservable.add(restored);
  return () => {
    engine.onContextLostObservable.removeCallback(lost);
    engine.onContextRestoredObservable.removeCallback(restored);
  };
}
