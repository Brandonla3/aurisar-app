/**
 * FogDriver — THE single writer of atmosphere state onto the scene.
 *
 * One evaluation per frame: playlist → skyState → everything. Fog color,
 * fog density, clear color, dome uniforms, sun light, ambient light — all
 * copied from ONE skyState object, so no two consumers can disagree about
 * what moment it is. The prior stack's production bug (two writers fighting
 * over scene.fogColor, one reallocating the object out from under a shader)
 * is structurally impossible here: nothing else writes, and this driver
 * only MUTATES the existing Color3/Color4 instances, never replaces them.
 *
 * Deliberately free of the BABYLON global: it calls methods on objects it is
 * handed (scene, lights, the dome's applyState). Zero retained GPU state —
 * context restore is "the next update() re-derives everything from time".
 */

import { playlistStateAt } from '../../model/skyPlaylist.js';
import { skyStateFrom } from '../../model/skyModel.js';

export class FogDriver {
  /**
   * @param {object} scene
   * @param {object} rig { sunLight, ambientLight, applyDomeState } — all optional
   * @param {object} opts { epochMs, timeScale } — timeScale warps the cycle for
   *   dev verification (?timewarp=40 → full day in 60s). 1 in production.
   */
  constructor(scene, rig = {}, { epochMs = 0, timeScale = 1 } = {}) {
    this._scene = scene;
    this._rig = rig;
    this._epochMs = epochMs;
    this._timeScale = timeScale;
    this._lastState = null;
  }

  /** Evaluate the playlist at `nowMs` and write everything. Idempotent. */
  update(nowMs) {
    const stance = playlistStateAt(nowMs * this._timeScale, this._epochMs);
    const s = skyStateFrom(stance);
    this._lastState = s;

    const scene = this._scene;
    // Mutate in place — replacing scene.fogColor is the historical bug.
    scene.fogColor.copyFromFloats(s.fogColor[0], s.fogColor[1], s.fogColor[2]);
    scene.fogDensity = s.fogDensity;
    scene.clearColor.copyFromFloats(s.clearColor[0], s.clearColor[1], s.clearColor[2]);

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
}
