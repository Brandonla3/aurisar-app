/**
 * CastleLightPool — a handful of real PointLights that follow the player
 * between the plan's ~120 light anchors. Every anchor has an emissive flame
 * mesh; only the nearest few are "real" at any moment, so the whole castle
 * glows while staying inside StandardMaterial's light budget.
 *
 * Pool lights are created once and stay ENABLED forever (intensity 0 when
 * idle): toggling setEnabled would change shader defines and break frozen
 * castle materials. Flicker phases come from hash2 — deterministic, no
 * Math.random (worldgen convention).
 */

/* global BABYLON */

import { hash2 } from '../worldgen/rng.js';

// StandardMaterial point lights attenuate LINEARLY with range — against
// the castle's bright materials (marble/plaster diffuse ~0.8) anything
// above ~4 blows whole rooms out to white. Warm pools, no overexposure.
const KIND_STYLE = {
  torch:      { color: [1.0, 0.70, 0.42], intensity: 2.4, range: 11, flicker: 0.16, speed: 8.0 },
  chandelier: { color: [1.0, 0.78, 0.52], intensity: 3.0, range: 18, flicker: 0.06, speed: 3.0 },
  fireplace:  { color: [1.0, 0.55, 0.26], intensity: 2.4, range: 13, flicker: 0.20, speed: 6.5 },
  candle:     { color: [1.0, 0.80, 0.52], intensity: 1.0, range: 8,  flicker: 0.12, speed: 5.0 },
  brazier:    { color: [1.0, 0.60, 0.28], intensity: 2.2, range: 12, flicker: 0.18, speed: 7.0 },
};

const RETHINK_MS = 250;   // anchor re-ranking cadence
const FADE_MS    = 320;   // cross-fade on reassignment
const Y_WINDOW   = 16;    // vertical sanity cap (ballroom chandeliers hang ~13 m up)

export class CastleLightPool {
  /**
   * @param {BABYLON.Scene} scene
   * @param {Array} anchors  world-space [{kind, x, y, z, priority}]
   * @param {number} size    pool size (6 desktop / 3 mobile)
   */
  constructor(scene, anchors, size) {
    this.scene = scene;
    this.anchors = anchors;
    this._lights = [];
    this._lastThink = 0;
    for (let i = 0; i < size; i++) {
      const l = new BABYLON.PointLight(`castlePool_${i}`, BABYLON.Vector3.Zero(), scene);
      l.diffuse = new BABYLON.Color3(1, 0.6, 0.25);
      l.specular = new BABYLON.Color3(0.14, 0.09, 0.05);
      l.intensity = 0;
      l.range = 10;
      this._lights.push({
        light: l,
        anchor: null,
        base: 0,           // target base intensity multiplier
        current: 0,        // faded intensity multiplier 0..1
        phase: hash2(i * 3.7, i * 1.3) * Math.PI * 2,
        style: KIND_STYLE.torch,
      });
    }
    this._obs = scene.onBeforeRenderObservable.add(() => this._update());
    this._active = false;
    this._playerPos = null;
  }

  /** Restrict pool lights to the castle's merged meshes: world materials
   *  never see these lights (no scene-wide shader recompiles when the pool
   *  is created) and castle materials are guaranteed to pick them. */
  setIncludedMeshes(meshes) {
    for (const s of this._lights) s.light.includedOnlyMeshes = [...meshes];
  }

  /** Hand the pool the live player position provider; toggles with interior mode. */
  setActive(active, playerPosFn = null) {
    this._active = active;
    if (playerPosFn) this._playerPos = playerPosFn;
    if (!active) {
      for (const s of this._lights) { s.anchor = null; s.base = 0; }
    }
  }

  _think(p, level) {
    // rank anchors near the player — SAME LEVEL only. Point lights don't
    // shadow, so an anchor on another floor would bleed straight through
    // the slab; level filtering is the occlusion model.
    const ranked = [];
    for (const a of this.anchors) {
      if (level != null && a.level != null && a.level !== level) continue;
      const dy = Math.abs(a.y - (p.y + 1.4));
      if (dy > Y_WINDOW) continue;
      const d2 = (a.x - p.x) ** 2 + (a.z - p.z) ** 2;
      if (d2 > 30 * 30) continue;
      ranked.push({ a, score: d2 / (a.priority ?? 1) });
    }
    ranked.sort((q, r) => q.score - r.score);
    const want = ranked.slice(0, this._lights.length).map((r) => r.a);

    // keep lights already on a wanted anchor; reassign the rest
    const kept = new Set();
    for (const s of this._lights) {
      if (s.anchor && want.includes(s.anchor)) kept.add(s.anchor);
      else s.base = 0; // fade out, then free
    }
    const free = this._lights.filter((s) => !s.anchor || !kept.has(s.anchor));
    for (const a of want) {
      if (kept.has(a)) continue;
      const slot = free.shift();
      if (!slot) break;
      slot.anchor = a;
      slot.style = KIND_STYLE[a.kind] ?? KIND_STYLE.torch;
      slot.light.position.set(a.x, a.y, a.z);
      slot.light.diffuse.set(...slot.style.color);
      slot.light.range = slot.style.range;
      slot.base = 1;
    }
  }

  _update() {
    const now = performance.now();
    const dt = this.scene.getEngine().getDeltaTime();
    if (this._active && this._playerPos) {
      const st = this._playerPos(); // { pos, level } | Vector3 | null
      const p = st?.pos ?? st;
      if (p && now - this._lastThink > RETHINK_MS) {
        this._lastThink = now;
        this._think(p, st?.level ?? null);
      }
    }
    const t = now * 0.001;
    for (const s of this._lights) {
      const target = this._active && s.anchor ? s.base : 0;
      const step = dt / FADE_MS;
      s.current += Math.sign(target - s.current) * Math.min(step, Math.abs(target - s.current));
      if (s.current <= 0.001) {
        s.light.intensity = 0;
        if (s.base === 0) s.anchor = null;
        continue;
      }
      const st = s.style;
      const noise =
        Math.sin(t * st.speed + s.phase) * 0.6 +
        Math.sin(t * st.speed * 2.37 + s.phase * 1.7) * 0.4;
      s.light.intensity = st.intensity * s.current * (1 + noise * st.flicker);
    }
  }

  dispose() {
    this.scene.onBeforeRenderObservable.remove(this._obs);
    for (const s of this._lights) s.light.dispose();
    this._lights.length = 0;
  }
}
