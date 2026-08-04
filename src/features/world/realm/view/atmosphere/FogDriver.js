/**
 * FogDriver — THE single writer of atmosphere state onto the scene.
 *
 * One evaluation per frame: playlist → skyState → cloud-dimmed → everything.
 * Fog color, fog density, clear color, dome uniforms, sun light, ambient
 * light — all copied from ONE state object, so no two consumers can disagree
 * about what moment it is. The prior stack's production bug (two writers
 * fighting over scene.fogColor, one reallocating the object out from under a
 * shader) is structurally impossible here: nothing else writes, and this
 * driver only MUTATES the existing Color3/Color4 instances, never replaces
 * them.
 *
 * P4c folds cloud dimming (model/cloudShadow.js) into this evaluation: the
 * playlist's raw stance color is no longer the whole story, so `state` below
 * is a cloud-dimmed derivative, not skyStateFrom's direct output. This is a
 * deliberate scope change — the earlier "the driver adds no opinion"
 * invariant is gone on purpose, see FogDriver.test.js.
 *
 * Deliberately free of the BABYLON global: it calls methods on objects it is
 * handed (scene, lights, the dome's applyState). Zero retained GPU state —
 * context restore is "the next update() re-derives everything from time".
 */

import { playlistStateAt } from '../../model/skyPlaylist.js';
import { skyStateFrom } from '../../model/skyModel.js';
import { cloudFactorAt, applyCloudDimming } from '../../model/cloudShadow.js';

export class FogDriver {
  /**
   * @param {object} scene
   * @param {object} rig { sunLight, ambientLight, applyDomeState } — all optional
   * @param {object} opts { epochMs, timeScale } — timeScale warps the cycle for
   *   dev verification (?timewarp=40 → full day in 60s). 1 in production.
   *   NOTE: timeScale multiplies nowMs only; epochMs is therefore in the
   *   WARPED time domain. Anchoring to a real server epoch and warping at the
   *   same time is unsupported by design — timewarp is a dev-only lens.
   */
  constructor(scene, rig = {}, { epochMs = 0, timeScale = 1 } = {}) {
    this._scene = scene;
    this._rig = rig;
    this._epochMs = epochMs;
    this._timeScale = timeScale;
    this._lastState = null;
    this._lastCloudFactor = null;
  }

  /** Evaluate the playlist at `nowMs` and write everything. Idempotent. */
  update(nowMs) {
    const stance = playlistStateAt(nowMs * this._timeScale, this._epochMs);
    const rawState = skyStateFrom(stance);
    // nowMs, not the warped/epoched playlist time: clouds are weather, not
    // time-of-day — they drift on their own clock, independent of timewarp
    // (a ?timewarp=40 dev session should compress day/night, not also speed
    // up or slow down how fast clouds pass).
    const cloudFactor = cloudFactorAt(nowMs);
    const s = applyCloudDimming(rawState, cloudFactor);
    this._lastState = s;
    this._lastCloudFactor = cloudFactor;

    const scene = this._scene;
    // Mutate in place — replacing scene.fogColor is the historical bug.
    scene.fogColor.copyFromFloats(s.fogColor[0], s.fogColor[1], s.fogColor[2]);
    scene.fogDensity = s.fogDensity;
    // Alpha passed explicitly: clearColor is a Color4, and relying on a 3-arg
    // copyFromFloats to leave alpha alone is a bet on Babylon internals.
    scene.clearColor.copyFromFloats(s.clearColor[0], s.clearColor[1], s.clearColor[2], 1);

    const { sunLight, ambientLight, applyDomeState } = this._rig;
    if (sunLight) {
      // Light direction points FROM the sun TOWARD the scene.
      sunLight.direction.copyFromFloats(-s.sunDir[0], -s.sunDir[1], -s.sunDir[2]);
      sunLight.intensity = s.sunIntensity;
      sunLight.diffuse.copyFromFloats(s.sunTint[0], s.sunTint[1], s.sunTint[2]);
    }
    if (ambientLight) {
      ambientLight.intensity = s.ambientIntensity;
      ambientLight.diffuse.copyFromFloats(s.ambient[0], s.ambient[1], s.ambient[2]);
    }
    if (applyDomeState) applyDomeState(s);

    return s;
  }

  /** The last evaluated snapshot — the "mood bus" read for audio/UI later. */
  get state() {
    return this._lastState;
  }

  /** The last evaluated cloud factor (1 = clear) — cloudPuffs.js's per-puff
   *  tint desync samples this same function at an offset, not a copy of it. */
  get cloudFactor() {
    return this._lastCloudFactor;
  }
}
