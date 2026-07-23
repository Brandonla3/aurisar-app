/**
 * FlickerLights — one shared onBeforeRender observer that animates the intensity
 * of every registered dungeon light (torches + magic accents), instead of one
 * observer per light (up to 12 torches + 10 accents in a fully-lit dungeon).
 *
 * The registry owns ALL of its own state — the light list, the single lazily
 * created observer, and per-light cleanup — so it can't be split across classes
 * (the bug that shipped when the list lived on a different object than the
 * methods that pushed to it). The flicker maths is unchanged from the original
 * per-light observers: torch = two-sine noise, accent = single-sine pulse,
 * sampled once per frame.
 */
export class FlickerLights {
  /**
   * @param {object} scene   Babylon scene (needs `onBeforeRenderObservable`).
   * @param {() => number} [nowMs]  time source in ms; injectable for tests.
   */
  constructor(scene, nowMs = () => performance.now()) {
    this._scene = scene;
    this._nowMs = nowMs;
    this._lights = [];   // { light, kind, intensity, speed, amount, phase }
    this._observer = null;
  }

  /**
   * @param {object} light  Babylon light (needs `isEnabled()`, `intensity`,
   *                        `onDisposeObservable`).
   * @param {{kind:'torch'|'accent', intensity:number, speed:number,
   *          amount:number, phase:number}} entry
   */
  register(light, entry) {
    const e = { light, ...entry };
    this._lights.push(e);
    if (!this._observer) {
      this._observer = this._scene.onBeforeRenderObservable.add(() => this._tick());
    }
    // Drop the entry when its light is disposed (e.g. leaving a dungeon), so the
    // tick never touches a dead light. The shared observer stays (it early-outs
    // on an empty list) until dispose().
    light.onDisposeObservable.add(() => {
      const i = this._lights.indexOf(e);
      if (i >= 0) this._lights.splice(i, 1);
    });
  }

  _tick() {
    const arr = this._lights;
    if (!arr.length) return;
    const t = this._nowMs() * 0.001;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (!f.light.isEnabled()) continue;
      if (f.kind === 'torch') {
        const noise =
          Math.sin(t * f.speed        + f.phase)       * 0.6 +
          Math.sin(t * f.speed * 2.37 + f.phase * 1.7) * 0.4;
        f.light.intensity = f.intensity * (1 + noise * f.amount);
      } else { // 'accent' — single-sine pulse
        f.light.intensity = f.intensity * (1 + Math.sin(t * f.speed + f.phase) * f.amount);
      }
    }
  }

  dispose() {
    if (this._observer) {
      this._scene.onBeforeRenderObservable.remove(this._observer);
      this._observer = null;
    }
    this._lights.length = 0;
  }
}
