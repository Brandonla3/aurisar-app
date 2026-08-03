import { describe, expect, it } from 'vitest';
import {
  classifyShadowCadence, refreshRateForBucket,
  DEFAULT_NEAR_RADIUS_M, DEFAULT_HYSTERESIS_M, NEAR_REFRESH_RATE, FAR_REFRESH_RATE,
} from './shadowCadence.js';

describe('classifyShadowCadence — no prior bucket', () => {
  it('classifies directly against nearRadiusM', () => {
    expect(classifyShadowCadence(5, null)).toBe('near');
    expect(classifyShadowCadence(DEFAULT_NEAR_RADIUS_M - 1, null)).toBe('near');
    expect(classifyShadowCadence(DEFAULT_NEAR_RADIUS_M + 1, null)).toBe('far');
  });
});

describe('classifyShadowCadence — hysteresis', () => {
  it('a "near" caster tolerates drifting past nearRadiusM, up to +hysteresis', () => {
    const justPast = DEFAULT_NEAR_RADIUS_M + DEFAULT_HYSTERESIS_M - 0.1;
    expect(classifyShadowCadence(justPast, 'near')).toBe('near');
  });

  it('a "near" caster flips to far once it crosses nearRadiusM + hysteresis', () => {
    const justOver = DEFAULT_NEAR_RADIUS_M + DEFAULT_HYSTERESIS_M + 0.1;
    expect(classifyShadowCadence(justOver, 'near')).toBe('far');
  });

  it('a "far" caster does NOT snap back to near just by crossing nearRadiusM inward', () => {
    // This is the actual hysteresis contract: 'far' requires crossing
    // INWARD past nearRadiusM - hysteresis, not merely past nearRadiusM —
    // a narrower re-entry than exit, same shape as chunkMath's load/unload rings.
    const justInsideNear = DEFAULT_NEAR_RADIUS_M - 0.1;
    expect(classifyShadowCadence(justInsideNear, 'far')).toBe('far');
  });

  it('a "far" caster flips to near once it crosses nearRadiusM - hysteresis', () => {
    const wellInside = DEFAULT_NEAR_RADIUS_M - DEFAULT_HYSTERESIS_M - 0.1;
    expect(classifyShadowCadence(wellInside, 'far')).toBe('near');
  });

  it('never thrashes for a caster orbiting exactly at nearRadiusM', () => {
    // The whole point: a caster sitting exactly on the boundary distance,
    // sampled every tick, must not flip buckets tick over tick.
    let bucket = null;
    for (let i = 0; i < 50; i++) {
      const distance = DEFAULT_NEAR_RADIUS_M + (i % 2 === 0 ? 0.01 : -0.01);
      const next = classifyShadowCadence(distance, bucket);
      if (bucket !== null) expect(next).toBe(bucket); // must hold, never flip
      bucket = next;
    }
  });

  it('DOES eventually flip for a caster that genuinely moves far away and stays there', () => {
    let bucket = classifyShadowCadence(2, null); // starts near, close to the focus point
    expect(bucket).toBe('near');
    bucket = classifyShadowCadence(500, bucket); // genuinely far now
    expect(bucket).toBe('far');
  });

  it('respects custom nearRadiusM/hysteresisM options', () => {
    expect(classifyShadowCadence(45, null, { nearRadiusM: 50 })).toBe('near');
    expect(classifyShadowCadence(52, 'near', { nearRadiusM: 50, hysteresisM: 1 })).toBe('far');
    expect(classifyShadowCadence(52, 'near', { nearRadiusM: 50, hysteresisM: 10 })).toBe('near');
  });
});

describe('refreshRateForBucket', () => {
  it('near is always-fresh (Babylon\'s own default), far is throttled', () => {
    expect(refreshRateForBucket('near')).toBe(NEAR_REFRESH_RATE);
    expect(refreshRateForBucket('far')).toBe(FAR_REFRESH_RATE);
    expect(NEAR_REFRESH_RATE).toBe(1);
    expect(FAR_REFRESH_RATE).toBeGreaterThan(1);
  });
});
