/**
 * AnimationController — shared skeletal-animation driver for players,
 * remote players, NPCs and mobs (docs/world-design-plan.md, Batch A).
 *
 * Replaces the per-consumer idle/walk weight juggling (the old
 * CharacterAvatar._animateGLB and its duplicated clip resolvers) with one
 * engine-agnostic controller:
 *
 *  - Clip resolution from a name map ({ idle: /idle/i, ... }) over the
 *    instance's AnimationGroups — resolved once at construction.
 *  - Continuous idle/walk/run locomotion blended from a SPEED (m/s), not a
 *    boolean, with frame-rate-independent exponential weight easing
 *    (tau ≈ 120 ms — the old `weight += 0.08 per frame` blended twice as
 *    fast at 120 fps as at 60).
 *  - Stride matching: walk/run playback rate scales with actual speed over
 *    the clip's authored reference speed (clamped so extremes never read
 *    as slow motion or thrashing).
 *  - One-shots (attack / hit / death) that take over the rig, then hand
 *    back to locomotion; death holds its final frame instead of resuming.
 *  - suspend()/resume() for distance gating — pausing the underlying
 *    groups stops Babylon's per-frame animatable evaluation, which is the
 *    actual skeletal CPU cost at crowd scale.
 *
 * The controller only touches the AnimationGroup interface (play/stop/
 * pause/weight/speedRatio/goToFrame/to/onAnimationGroupEndObservable), so
 * unit tests can drive it with plain mock objects — no Babylon import.
 */

// Weight-easing time constant. ~63% of the remaining blend closes every
// 120 ms regardless of frame rate.
const BLEND_TAU_MS = 120;

// Below this speed the rig is considered standing.
const IDLE_EPSILON_MPS = 0.15;

/** Frame-rate-independent exponential approach factor for a timestep. */
export function blendAlpha(dtMs, tauMs = BLEND_TAU_MS) {
  if (dtMs <= 0) return 0;
  return 1 - Math.exp(-dtMs / tauMs);
}

/**
 * Resolve a clip map of { key: RegExp | string } against animation groups.
 * Strings match case-insensitively against the END of the group name
 * (instantiated groups arrive prefixed, e.g. "Clone of Idle" or
 * "npc_x Walk"). First match wins; unresolved keys are simply absent.
 */
export function resolveClips(animGroups, clipMap) {
  const out = {};
  if (!animGroups?.length || !clipMap) return out;
  for (const [key, matcher] of Object.entries(clipMap)) {
    if (matcher == null) continue;
    const found = animGroups.find((ag) =>
      matcher instanceof RegExp
        ? matcher.test(ag.name)
        : ag.name.toLowerCase().endsWith(String(matcher).toLowerCase())
    );
    if (found) out[key] = found;
  }
  return out;
}

export class AnimationController {
  /**
   * @param {Array} animGroups  the instance's AnimationGroups
   * @param {Object} clipMap    { idle, walk, run, attack, hit, death } →
   *                            RegExp or exact-suffix string (null = absent)
   * @param {Object} [opts]
   * @param {number} [opts.runThresholdMps]  speed where walk hands to run
   * @param {number} [opts.walkRefMps]  authored walk-cycle ground speed
   * @param {number} [opts.runRefMps]   authored run-cycle ground speed
   */
  constructor(animGroups, clipMap, opts = {}) {
    this.clips = resolveClips(animGroups, clipMap);
    this._runThreshold = opts.runThresholdMps ?? 5.5;
    this._walkRef = opts.walkRefMps ?? 1.8;
    this._runRef = opts.runRefMps ?? 6.0;

    this._speed = 0;          // smoothed locomotion input (m/s)
    this._oneShot = null;     // currently-playing one-shot group
    this._dead = false;
    this._suspended = false;

    // Every locomotion clip starts stopped at weight 0; idle fades in on
    // the first update. (Callers previously started Idle at weight 1 —
    // the fade-in is imperceptible at tau 120 ms and keeps one code path.)
    for (const key of ['idle', 'walk', 'run']) {
      const ag = this.clips[key];
      if (!ag) continue;
      ag.stop();
      ag.weight = 0;
    }
  }

  /** True when a given semantic clip resolved to a real group. */
  has(key) { return !!this.clips[key]; }

  /** Feed the measured planar speed (m/s). Call once per frame. */
  setLocomotionSpeed(mps) {
    this._speed = Math.max(0, mps);
  }

  /**
   * Play a one-shot (attack/hit). Locomotion weights ease to 0 while it
   * runs and recover when it ends. A one-shot already in flight is
   * replaced (a hit reaction interrupting a wind-up reads correctly).
   * Returns true if the clip exists and was started.
   */
  playOneShot(key) {
    if (this._dead || this._suspended) return false;
    const ag = this.clips[key];
    if (!ag) return false;
    this._stopOneShot();
    this._oneShot = ag;
    ag.stop();
    ag.weight = 1;
    ag.loopAnimation = false;
    ag.speedRatio = 1;
    const obs = ag.onAnimationGroupEndObservable?.add?.(() => {
      ag.onAnimationGroupEndObservable?.remove?.(obs);
      if (this._oneShotObs === obs) this._oneShotObs = null;
      if (this._oneShot === ag) this._oneShot = null;
    });
    this._oneShotObs = obs ?? null;
    ag.play(false);
    return true;
  }

  /**
   * Play the death clip and hold its final frame (no hand-back to
   * locomotion). Returns the clip length estimate in ms (fallback 900)
   * so the caller can schedule the deferred dispose.
   */
  playDeath() {
    this._dead = true;
    this._stopOneShot();
    for (const key of ['idle', 'walk', 'run']) {
      const ag = this.clips[key];
      if (ag) { ag.stop(); ag.weight = 0; }
    }
    const ag = this.clips.death;
    if (!ag) return 0;
    ag.stop();
    ag.weight = 1;
    ag.loopAnimation = false;
    ag.speedRatio = 1;
    const obs = ag.onAnimationGroupEndObservable?.add?.(() => {
      ag.onAnimationGroupEndObservable?.remove?.(obs);
      if (this._deathObs === obs) this._deathObs = null;
      // Freeze on the last frame — a stopped group would snap the pose.
      ag.play(false);
      ag.goToFrame?.(ag.to);
      ag.pause?.();
    });
    this._deathObs = obs ?? null;
    this._deathGroup = ag;
    ag.play(false);
    const fps = 60; // glTF groups carry frame units at 60 fps
    const frames = (ag.to ?? 0) - (ag.from ?? 0);
    return frames > 0 ? (frames / fps) * 1000 : 900;
  }

  /** Distance gating: freeze all evaluation at the current pose. */
  suspend() {
    if (this._suspended || this._dead) return;
    this._suspended = true;
    this._stopOneShot();
    for (const ag of Object.values(this.clips)) ag.pause?.();
  }

  resume() {
    if (!this._suspended || this._dead) return;
    this._suspended = false;
    for (const key of ['idle', 'walk', 'run']) {
      const ag = this.clips[key];
      if (ag && ag.weight > 0) ag.play(true);
    }
  }

  get suspended() { return this._suspended; }

  /** Advance blending. dtMs = engine.getDeltaTime(). */
  update(dtMs) {
    if (this._dead || this._suspended) return;

    const a = blendAlpha(dtMs);
    const speed = this._speed;
    const oneShotActive = !!this._oneShot;

    // Target weights: one active locomotion state, or none under a one-shot.
    let tIdle = 0, tWalk = 0, tRun = 0;
    if (!oneShotActive) {
      if (speed < IDLE_EPSILON_MPS) tIdle = 1;
      else if (speed >= this._runThreshold && this.clips.run) tRun = 1;
      else if (this.clips.walk) tWalk = 1;
      else tIdle = 1; // moving but no walk clip — better grounded than frozen
    }

    this._ease('idle', tIdle, a);
    this._ease('walk', tWalk, a, speed / this._walkRef);
    this._ease('run',  tRun,  a, speed / this._runRef);
  }

  _ease(key, target, a, strideRatio) {
    const ag = this.clips[key];
    if (!ag) return;
    const w = (ag.weight ?? 0) + (target - (ag.weight ?? 0)) * a;
    ag.weight = w < 0.001 && target === 0 ? 0 : w;
    if (ag.weight > 0) {
      if (!ag.isPlaying) { ag.loopAnimation = true; ag.play(true); }
      if (strideRatio !== undefined && target > 0) {
        ag.speedRatio = Math.min(1.6, Math.max(0.6, strideRatio));
      }
    } else if (ag.isPlaying) {
      ag.stop();
    }
  }

  _stopOneShot() {
    if (!this._oneShot) return;
    // An interrupted one-shot never reaches its end observer — remove it
    // here so no closure stays pinned to the group.
    if (this._oneShotObs) {
      this._oneShot.onAnimationGroupEndObservable?.remove?.(this._oneShotObs);
      this._oneShotObs = null;
    }
    this._oneShot.stop();
    this._oneShot.weight = 0;
    this._oneShot = null;
  }

  dispose() {
    this._stopOneShot();
    if (this._deathObs) {
      this._deathGroup?.onAnimationGroupEndObservable?.remove?.(this._deathObs);
      this._deathObs = null;
    }
    // Groups are owned by whoever instantiated the container; stopping is
    // enough here (CharacterAvatar and the mob entry dispose the groups).
    for (const ag of Object.values(this.clips)) ag.stop?.();
    this.clips = {};
  }
}
