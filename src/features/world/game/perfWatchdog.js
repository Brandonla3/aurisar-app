/**
 * Sustained-low-framerate detector.
 *
 * The existing graphics safe-mode ladder (`BabylonWorldScene._handleContextLost`)
 * only reacts to WebGL *context loss*, and its one framerate check is `fps < 1`
 * — i.e. "the GPU has stopped". A machine rendering the high tier at 12 fps is
 * perfectly stable by that definition and never steps down, which is precisely
 * the "barely playable on desktop" case: the tier sniffer guessed too high and
 * nothing ever revises the guess.
 *
 * This is the missing signal. It is a pure state machine so the thresholds are
 * testable headlessly; the scene owns what to actually shed when it fires.
 *
 * Deliberately conservative — a false positive silently downgrades a player who
 * was fine:
 *   - a grace period covers load, where asset streaming and shader compilation
 *     stall frames on every machine;
 *   - a backgrounded tab is ignored entirely (rAF throttles to ~1 fps there,
 *     which would otherwise read as a dying GPU);
 *   - the drop must be *sustained*, not a spike.
 */

export const PERF_DEFAULTS = Object.freeze({
  /** Below this sustained framerate the stack is considered too heavy. */
  minFps: 25,
  /** How long it must stay below `minFps` before shedding. */
  sustainMs: 8000,
  /** Ignore everything this long after scene start (load stalls, shader compiles). */
  graceMs: 12000,
  /** Never shed more than this many steps in one session. */
  maxSteps: 3,
});

/**
 * @param {number} nowMs
 * @param {object} [tuning]
 */
export function createPerfState(nowMs, tuning = PERF_DEFAULTS) {
  return { startedAt: nowMs, badSince: null, steps: 0, tuning };
}

/**
 * Fold one framerate sample into the state.
 *
 * @param {object} state   From `createPerfState` (treated as immutable).
 * @param {object} sample
 * @param {number} sample.fps
 * @param {number} sample.nowMs
 * @param {boolean} [sample.hidden]  Document hidden / tab backgrounded.
 * @returns {{ state: object, shed: boolean }} `shed` is true on the single
 *   sample that crosses the threshold; the caller sheds one step.
 */
export function samplePerf(state, { fps, nowMs, hidden = false }) {
  const t = state.tuning ?? PERF_DEFAULTS;
  const clear = () => (state.badSince === null ? { state, shed: false }
    : { state: { ...state, badSince: null }, shed: false });

  // A backgrounded tab is rAF-throttled, not slow. Never judge it.
  if (hidden) return clear();
  // Load window: streaming + shader compilation stall frames everywhere.
  if (nowMs - state.startedAt < t.graceMs) return clear();
  // Already shed everything this session is allowed to.
  if (state.steps >= t.maxSteps) return clear();
  // Engine reports 0 / Infinity before the first frames land — no signal.
  if (!Number.isFinite(fps) || fps <= 0) return clear();

  if (fps >= t.minFps) return clear();

  const badSince = state.badSince ?? nowMs;
  if (nowMs - badSince < t.sustainMs) {
    return { state: state.badSince === null ? { ...state, badSince } : state, shed: false };
  }

  // Sustained. Shed one step and restart the window, so the next step needs its
  // own full `sustainMs` of evidence rather than firing on the following sample.
  return { state: { ...state, badSince: null, steps: state.steps + 1 }, shed: true };
}
