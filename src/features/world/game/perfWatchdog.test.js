import { describe, it, expect } from 'vitest';
import { createPerfState, samplePerf, PERF_DEFAULTS as P } from './perfWatchdog.js';

// Drive the machine with a sample every `stepMs`, returning how many sheds fired.
function run(state, { fps, from, forMs, stepMs = 1000, hidden = false }) {
  let s = state;
  let sheds = 0;
  for (let t = from; t <= from + forMs; t += stepMs) {
    const r = samplePerf(s, { fps, nowMs: t, hidden });
    s = r.state;
    if (r.shed) sheds += 1;
  }
  return { state: s, sheds };
}

const AFTER_GRACE = P.graceMs + 1000;

describe('samplePerf', () => {
  it('sheds once after the drop is sustained', () => {
    const { sheds, state } = run(createPerfState(0), {
      fps: 12, from: AFTER_GRACE, forMs: P.sustainMs,
    });
    expect(sheds).toBe(1);
    expect(state.steps).toBe(1);
  });

  it('does not shed on a spike shorter than the sustain window', () => {
    const { sheds } = run(createPerfState(0), {
      fps: 12, from: AFTER_GRACE, forMs: P.sustainMs - 2000,
    });
    expect(sheds).toBe(0);
  });

  it('ignores everything during the load grace period', () => {
    // A machine that stalls hard through load — asset streaming and shader
    // compilation do this on every device — must not be downgraded for it.
    const { sheds } = run(createPerfState(0), { fps: 3, from: 0, forMs: P.graceMs - 1000 });
    expect(sheds).toBe(0);
  });

  it('ignores a backgrounded tab, where rAF throttling looks like a dying GPU', () => {
    const { sheds } = run(createPerfState(0), {
      fps: 1, from: AFTER_GRACE, forMs: P.sustainMs * 3, hidden: true,
    });
    expect(sheds).toBe(0);
  });

  it('resets the window when the framerate recovers', () => {
    let s = createPerfState(0);
    ({ state: s } = run(s, { fps: 12, from: AFTER_GRACE, forMs: P.sustainMs - 2000 }));
    // One good sample clears the accumulated evidence...
    ({ state: s } = run(s, { fps: 60, from: AFTER_GRACE + P.sustainMs, forMs: 0 }));
    expect(s.badSince).toBeNull();
    // ...so the next bad run needs its own full window.
    const after = run(s, { fps: 12, from: AFTER_GRACE + P.sustainMs + 1000, forMs: P.sustainMs - 2000 });
    expect(after.sheds).toBe(0);
  });

  it('requires a fresh sustain window per step rather than firing every sample', () => {
    // Held at a bad framerate throughout. Each step costs a full sustain window
    // plus the sample that re-arms it, so three steps take 3 × (sustain + step)
    // — the point being it paces, rather than shedding on every sample once the
    // first window closes.
    const stepMs = 1000;
    const { sheds } = run(createPerfState(0), {
      fps: 12, from: AFTER_GRACE, forMs: (P.sustainMs + stepMs) * 3, stepMs,
    });
    expect(sheds).toBe(3);
  });

  it('stops at maxSteps', () => {
    const { state, sheds } = run(createPerfState(0), {
      fps: 5, from: AFTER_GRACE, forMs: P.sustainMs * (P.maxSteps + 4),
    });
    expect(sheds).toBe(P.maxSteps);
    expect(state.steps).toBe(P.maxSteps);
  });

  it('treats a missing framerate reading as no signal', () => {
    for (const fps of [0, NaN, Infinity]) {
      const { sheds } = run(createPerfState(0), { fps, from: AFTER_GRACE, forMs: P.sustainMs * 2 });
      expect(sheds).toBe(0);
    }
  });
});
