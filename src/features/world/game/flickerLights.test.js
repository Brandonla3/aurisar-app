import { describe, it, expect } from 'vitest';
import { FlickerLights } from './flickerLights.js';

// Minimal mock of the bits FlickerLights touches on a Babylon scene: a single
// onBeforeRenderObservable whose add/remove record the callback, plus a tick()
// helper to drive one frame. add() returns the callback itself (FlickerLights
// only ever passes back to remove() whatever add() returned).
function makeScene() {
  const observers = new Set();
  return {
    _observers: observers,
    onBeforeRenderObservable: {
      add(cb) { observers.add(cb); return cb; },
      remove(cb) { return observers.delete(cb); },
    },
    tick() { for (const cb of observers) cb(); },
  };
}

// Minimal mock light: intensity + isEnabled + a fireable onDisposeObservable.
function makeLight({ enabled = true } = {}) {
  const disposeCbs = [];
  return {
    intensity: 0,
    _enabled: enabled,
    isEnabled() { return this._enabled; },
    onDisposeObservable: { add(cb) { disposeCbs.push(cb); } },
    dispose() { for (const cb of disposeCbs) cb(); },
  };
}

const TORCH = { kind: 'torch', intensity: 10, speed: 8, amount: 0.18, phase: 0.5 };
const ACCENT = { kind: 'accent', intensity: 20, speed: 2, amount: 0.15, phase: 0.5 };

describe('FlickerLights', () => {
  it('does not throw registering the first light (regression: list must live with the registry)', () => {
    const scene = makeScene();
    const fl = new FlickerLights(scene, () => 0);
    expect(() => fl.register(makeLight(), TORCH)).not.toThrow();
    expect(() => scene.tick()).not.toThrow();
  });

  it('lazily creates exactly one shared observer regardless of light count', () => {
    const scene = makeScene();
    const fl = new FlickerLights(scene, () => 0);
    expect(scene._observers.size).toBe(0);
    fl.register(makeLight(), TORCH);
    fl.register(makeLight(), ACCENT);
    expect(scene._observers.size).toBe(1);
  });

  it('drives torch (two-sine) and accent (single-sine) intensity from the shared tick', () => {
    const scene = makeScene();
    const fl = new FlickerLights(scene, () => 1000); // nowMs -> t = 1.0s
    const torch = makeLight();
    const accent = makeLight();
    fl.register(torch, TORCH);
    fl.register(accent, ACCENT);
    scene.tick();
    // Same maths as the original per-light observers.
    const noise = Math.sin(8 * 1 + 0.5) * 0.6 + Math.sin(8 * 2.37 * 1 + 0.5 * 1.7) * 0.4;
    expect(torch.intensity).toBeCloseTo(10 * (1 + noise * 0.18), 10);
    expect(accent.intensity).toBeCloseTo(20 * (1 + Math.sin(2 * 1 + 0.5) * 0.15), 10);
  });

  it('skips disabled lights', () => {
    const scene = makeScene();
    const fl = new FlickerLights(scene, () => 1000);
    const light = makeLight({ enabled: false });
    light.intensity = 999;
    fl.register(light, TORCH);
    scene.tick();
    expect(light.intensity).toBe(999); // untouched
  });

  it('drops a light from the tick once it is disposed', () => {
    const scene = makeScene();
    const fl = new FlickerLights(scene, () => 1000);
    const light = makeLight();
    fl.register(light, TORCH);
    light.dispose();      // fires onDispose -> splice
    light.intensity = 999;
    scene.tick();
    expect(light.intensity).toBe(999); // no longer updated
  });

  it('dispose() removes the shared observer', () => {
    const scene = makeScene();
    const fl = new FlickerLights(scene, () => 0);
    fl.register(makeLight(), TORCH);
    expect(scene._observers.size).toBe(1);
    fl.dispose();
    expect(scene._observers.size).toBe(0);
  });
});
