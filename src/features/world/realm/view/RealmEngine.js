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
 * @returns {Promise<{engine: object, renderer: string, degraded: boolean}>}
 *   `degraded` is true when we fell back to minimal options or to WebGL2 after a
 *   WebGPU failure — the caller surfaces it rather than hiding it.
 */
export async function createRealmEngine(canvas, { renderer = RENDERER.WEBGL2, isMobile = false } = {}) {
  if (!canvas) throw new Error('[RealmEngine] a canvas is required');

  if (renderer === RENDERER.WEBGPU) {
    try {
      const engine = new BABYLON.WebGPUEngine(canvas, { stencil: true, antialias: true });
      await engine.initAsync();
      return { engine, renderer: RENDERER.WEBGPU, degraded: false };
    } catch (err) {
      // WebGPU is opt-in, so a failure here is a preference we could not honour,
      // not a fatal error. Fall through to WebGL2 and report it.
      console.warn('[RealmEngine] WebGPU init failed, falling back to WebGL2:', err?.message ?? err);
      const { engine } = createWebGL2(canvas, isMobile);
      return { engine, renderer: RENDERER.WEBGL2, degraded: true };
    }
  }

  const { engine, degraded } = createWebGL2(canvas, isMobile);
  return { engine, renderer: RENDERER.WEBGL2, degraded };
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
