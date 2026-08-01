// @vitest-environment jsdom
/**
 * RealmEngine.test.js — engine selection and the WebGPU fallback.
 *
 * Uses a stubbed BABYLON rather than the real one: the behaviour under test is
 * OUR failure handling, and neither WebGPU nor WebGL exists in jsdom, so a real
 * engine could never be constructed here anyway.
 *
 * The case that matters is the canvas swap. A canvas can only ever hand out one
 * kind of context — once `getContext('webgpu')` succeeds it will never return a
 * WebGL2 context — so a WebGPU init that fails *after* acquiring the context
 * poisons the element. Falling back on it would turn "degraded but playable"
 * into a dead boot, and it would only reproduce on machines where WebGPU
 * half-works, which is the worst possible place to find out.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let createRealmEngine, RENDERER;
let disposed;

class FakeWebGPUEngineOk {
  constructor(canvas) { this.canvas = canvas; }
  async initAsync() {}
  dispose() { disposed.push('webgpu'); }
}
class FakeWebGPUEngineFails {
  constructor(canvas) { this.canvas = canvas; }
  async initAsync() { throw new Error('device lost during configure'); }
  dispose() { disposed.push('webgpu'); }
}
class FakeEngine {
  constructor(canvas) { this.canvas = canvas; }
  dispose() { disposed.push('webgl2'); }
}

beforeEach(async () => {
  disposed = [];
  globalThis.BABYLON = { Engine: FakeEngine, WebGPUEngine: FakeWebGPUEngineOk };
  ({ createRealmEngine } = await import('./RealmEngine.js'));
  ({ RENDERER } = await import('../settings/rendererChoice.js'));
  document.body.innerHTML = '<canvas id="c"></canvas>';
});

afterEach(() => { delete globalThis.BABYLON; });

const theCanvas = () => document.getElementById('c');

describe('createRealmEngine', () => {
  it('returns the same canvas on the normal WebGL2 path', async () => {
    const canvas = theCanvas();
    const res = await createRealmEngine(canvas, { renderer: RENDERER.WEBGL2 });

    expect(res.renderer).toBe(RENDERER.WEBGL2);
    expect(res.degraded).toBe(false);
    expect(res.canvas).toBe(canvas);
  });

  it('keeps the canvas when WebGPU succeeds', async () => {
    const canvas = theCanvas();
    const res = await createRealmEngine(canvas, { renderer: RENDERER.WEBGPU });

    expect(res.renderer).toBe(RENDERER.WEBGPU);
    expect(res.canvas).toBe(canvas);
    expect(res.degraded).toBe(false);
  });

  it('swaps in a fresh canvas when WebGPU init fails', async () => {
    globalThis.BABYLON.WebGPUEngine = FakeWebGPUEngineFails;
    const original = theCanvas();

    const res = await createRealmEngine(original, { renderer: RENDERER.WEBGPU });

    expect(res.renderer).toBe(RENDERER.WEBGL2);
    expect(res.degraded).toBe(true);

    // A different element, carrying the original's attributes, actually mounted
    // in place of it — otherwise the fallback engine draws to a detached canvas.
    expect(res.canvas).not.toBe(original);
    expect(res.canvas.id).toBe('c');
    expect(res.canvas.isConnected).toBe(true);
    expect(original.isConnected).toBe(false);
    // And the fallback engine must be bound to the fresh one, not the poisoned one.
    expect(res.engine.canvas).toBe(res.canvas);
  });

  it('disposes the half-built WebGPU engine before falling back', async () => {
    globalThis.BABYLON.WebGPUEngine = FakeWebGPUEngineFails;
    await createRealmEngine(theCanvas(), { renderer: RENDERER.WEBGPU });

    // Whatever the failed init grabbed is released rather than leaked.
    expect(disposed).toContain('webgpu');
  });

  it('rejects a missing canvas rather than failing later and vaguely', async () => {
    await expect(createRealmEngine(null)).rejects.toThrow(/canvas is required/);
  });
});
