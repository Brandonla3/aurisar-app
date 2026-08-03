import { describe, expect, it } from 'vitest';
import { cloudFactorAt, applyCloudDimming } from './cloudShadow.js';

describe('cloudFactorAt', () => {
  it('is deterministic', () => {
    expect(cloudFactorAt(12_345)).toBe(cloudFactorAt(12_345));
  });

  it('stays within [0.55, 1.0] across a wide sweep', () => {
    for (let ms = 0; ms < 600_000; ms += 977) { // odd step, avoids aliasing with the periods
      const f = cloudFactorAt(ms);
      expect(f).toBeGreaterThanOrEqual(0.55);
      expect(f).toBeLessThanOrEqual(1.0);
    }
  });

  it('actually varies over time — this is "moving", not a constant', () => {
    const samples = new Set();
    for (let ms = 0; ms < 200_000; ms += 5_000) samples.add(cloudFactorAt(ms).toFixed(4));
    expect(samples.size).toBeGreaterThan(10);
  });

  it('reaches both ends of its range somewhere in one 40-minute session (skyPlaylist.CYCLE_MS)', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let ms = 0; ms < 40 * 60_000; ms += 500) {
      const f = cloudFactorAt(ms);
      min = Math.min(min, f);
      max = Math.max(max, f);
    }
    expect(min).toBeLessThan(0.65);
    expect(max).toBeGreaterThan(0.9);
  });
});

describe('applyCloudDimming', () => {
  const baseState = {
    sunIntensity: 1.25,
    ambientIntensity: 0.4,
    fogColor: [0.7, 0.75, 0.8],
    clearColor: [0.7, 0.75, 0.8],
    stops: { horizon: [1, 1, 1] }, // unrelated field — must pass through untouched
  };

  it('never mutates its input', () => {
    const snapshot = JSON.parse(JSON.stringify(baseState));
    applyCloudDimming(baseState, 0.6);
    expect(baseState).toEqual(snapshot);
  });

  it('is an identity transform at cloudFactor = 1 (clear sky)', () => {
    const out = applyCloudDimming(baseState, 1);
    expect(out.sunIntensity).toBe(baseState.sunIntensity);
    expect(out.ambientIntensity).toBe(baseState.ambientIntensity);
    expect(out.fogColor).toEqual(baseState.fogColor);
    expect(out.clearColor).toEqual(baseState.clearColor);
  });

  it('dims sun and ambient proportionally to cloudFactor', () => {
    const out = applyCloudDimming(baseState, 0.6);
    expect(out.sunIntensity).toBeCloseTo(1.25 * 0.6, 10);
    expect(out.ambientIntensity).toBeCloseTo(0.4 * 0.6, 10);
  });

  it('nudges fog/clear color toward neutral gray as cover deepens, never repaints it fully', () => {
    const out = applyCloudDimming(baseState, 0.55); // deepest cover (cloudFactorAt's MIN_FACTOR)
    // Nudged toward [0.55, 0.56, 0.58], but not equal to it — a nudge, not a repaint.
    expect(out.fogColor[0]).toBeLessThan(baseState.fogColor[0]);
    expect(out.fogColor[0]).toBeGreaterThan(0.55);
  });

  it('passes unrelated fields through untouched', () => {
    const out = applyCloudDimming(baseState, 0.6);
    expect(out.stops).toBe(baseState.stops); // same reference — a shallow spread, not a deep clone
  });

  it('returns a NEW object, not the same reference', () => {
    expect(applyCloudDimming(baseState, 1)).not.toBe(baseState);
  });
});
