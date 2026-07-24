import { describe, expect, it } from 'vitest';
import { createAtmosphereState, sunElevationDeg } from './atmosphereState.js';

describe('createAtmosphereState', () => {
  it('stores sunDir and fogColor by reference (live) with clear-day scalar defaults', () => {
    const sunDir = { x: 0, y: 1, z: 0 };
    const fogColor = { r: 0.1, g: 0.2, b: 0.3 };
    const a = createAtmosphereState(sunDir, fogColor);

    expect(a.sunDir).toBe(sunDir); // same reference, not a copy
    expect(a.fogColor).toBe(fogColor);
    expect(a).toMatchObject({
      sunVisibility: 1, fogDensity: 0, dayFactor: 1, duskFactor: 0, night: 0, facingWeight: 0,
    });

    // Mutating the referenced vectors is visible through the state (the writer
    // mutates in place each frame; readers see the live value with no copy).
    sunDir.y = 0.5;
    fogColor.r = 0.9;
    expect(a.sunDir.y).toBe(0.5);
    expect(a.fogColor.r).toBe(0.9);
  });
});

describe('sunElevationDeg', () => {
  it('is 90° at the zenith, 0° at the horizon, -90° below', () => {
    expect(sunElevationDeg({ y: 1 })).toBeCloseTo(90, 5);
    expect(sunElevationDeg({ y: 0 })).toBeCloseTo(0, 5);
    expect(sunElevationDeg({ y: -1 })).toBeCloseTo(-90, 5);
  });

  it('clamps a slightly out-of-range y instead of returning NaN', () => {
    const e = sunElevationDeg({ y: 1.0001 });
    expect(Number.isFinite(e)).toBe(true);
    expect(e).toBeCloseTo(90, 5);
  });

  it('returns 0 for null / non-finite input', () => {
    expect(sunElevationDeg(null)).toBe(0);
    expect(sunElevationDeg({ y: NaN })).toBe(0);
  });
});
