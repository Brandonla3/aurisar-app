import { describe, expect, it } from 'vitest';
import { GRADIENT_DEF, emitGradientBsl, evalGradientJs, skyStateFrom } from './skyModel.js';
import { STANCES, playlistStateAt } from './skyPlaylist.js';

const NOON_STOPS = STANCES.find((s) => s.id === 'high-noon').stops;

describe('evalGradientJs', () => {
  it('returns the horizon stop at elevation 0 (no glow)', () => {
    const c = evalGradientJs(0, 0, NOON_STOPS);
    for (let i = 0; i < 3; i++) expect(c[i]).toBeCloseTo(NOON_STOPS.horizon[i], 10);
  });

  it('returns the zenith stop at elevation 1', () => {
    const c = evalGradientJs(1, 0, NOON_STOPS);
    for (let i = 0; i < 3; i++) expect(c[i]).toBeCloseTo(NOON_STOPS.zenith[i], 10);
  });

  it('is continuous — no banding steps between adjacent elevations', () => {
    for (let i = 0; i < 200; i++) {
      const a = evalGradientJs(i / 200, 0.3, NOON_STOPS);
      const b = evalGradientJs((i + 1) / 200, 0.3, NOON_STOPS);
      for (let c = 0; c < 3; c++) expect(Math.abs(a[c] - b[c])).toBeLessThan(0.02);
    }
  });

  it('glow warms the sky toward the sun and dies by glowMaxElevation', () => {
    const stops = STANCES.find((s) => s.id === 'dawnfire').stops;
    const atSun = evalGradientJs(0.05, 1, stops);
    const awaySun = evalGradientJs(0.05, 0, stops);
    expect(atSun[0]).toBeGreaterThan(awaySun[0]); // red channel lifts at the sun

    const high = evalGradientJs(GRADIENT_DEF.glowMaxElevation + 0.01, 1, stops);
    const highNoGlow = evalGradientJs(GRADIENT_DEF.glowMaxElevation + 0.01, 0, stops);
    for (let i = 0; i < 3; i++) expect(high[i]).toBeCloseTo(highNoGlow[i], 10);
  });

  it('clamps out-of-range elevation instead of extrapolating', () => {
    expect(evalGradientJs(-2, 0, NOON_STOPS)).toEqual(evalGradientJs(0, 0, NOON_STOPS));
    expect(evalGradientJs(7, 0, NOON_STOPS)).toEqual(evalGradientJs(1, 0, NOON_STOPS));
  });
});

describe('emitGradientBsl', () => {
  it('stamps every GRADIENT_DEF constant into the source', () => {
    // The one-definition guarantee: a def change that misses the emitter is
    // impossible, because the emitted source embeds the numbers themselves.
    const src = emitGradientBsl();
    for (const value of Object.values(GRADIENT_DEF)) {
      expect(src).toContain(value.toFixed(4));
    }
  });

  it('is stable — the emitted source only changes when the def does', () => {
    expect(emitGradientBsl()).toMatchInlineSnapshot(`
      "
          float e = clamp(elev, 0.0, 1.0);
          float mid = smoothstep(0.0400, 0.4200, e);
          float zen = smoothstep(0.3800, 0.9500, e);
          vec3 base = mix(horizonC, midC, mid);
          vec3 c = mix(base, zenithC, zen);
          float glow = pow(max(sunDot, 0.0), 5.0000) * (1.0 - smoothstep(0.0, 0.3500, e));
          return c + glowC * glow;"
    `);
  });

  it('contains no ternaries — the BSL transpiler requires bracketed ones', () => {
    expect(emitGradientBsl()).not.toContain('?');
  });
});

describe('skyStateFrom — THE identity', () => {
  it('fogColor IS the gradient at the horizon, for every playlist moment', () => {
    // The whole point of the unified model: fog and sky cannot seam because
    // fog is defined as sky-at-h=0. Swept across two full cycles.
    for (let m = 0; m < 80; m++) {
      const stance = playlistStateAt(m * 60_000);
      const state = skyStateFrom(stance);
      const horizon = evalGradientJs(0, 0, stance.stops);
      expect(state.fogColor).toEqual(horizon);
      expect(state.clearColor).toEqual(state.fogColor);
    }
  });

  it('carries every field the view layer needs, as plain numbers', () => {
    const state = skyStateFrom(playlistStateAt(0));
    for (const key of ['fogColor', 'fogDensity', 'sunDir', 'moonDir', 'sunTint',
      'sunIntensity', 'ambient', 'ambientIntensity', 'starVisibility']) {
      expect(state[key], key).toBeDefined();
    }
    expect(state.sunDir).toHaveLength(3);
    expect(Number.isFinite(state.fogDensity)).toBe(true);
  });
});
