import { describe, expect, it } from 'vitest';
import { aerialFogWeight, applyAerialFog } from './aerialPerspective.js';

// A representative mid-warm golden-hour base fog colour for the apply tests.
const BASE = { r: 0.45, g: 0.42, b: 0.40 };

function tint(base, w) {
  return applyAerialFog({ r: 0, g: 0, b: 0 }, base.r, base.g, base.b, w);
}

describe('aerialFogWeight', () => {
  it('is warmer toward the sun than the baseline (positive weight raises R, lowers B)', () => {
    const w = aerialFogWeight(1, 0.4, 1, 0); // facing sun, golden hour, clear
    expect(w).toBeGreaterThan(0);
    const out = tint(BASE, w);
    expect(out.r).toBeGreaterThan(BASE.r);
    expect(out.b).toBeLessThan(BASE.b);
  });

  it('keeps the away side a much smaller, cooler correction (asymmetric lobe)', () => {
    const toward = aerialFogWeight(1, 0.4, 1, 0);
    const away = aerialFogWeight(-1, 0.4, 1, 0);
    expect(away).toBeLessThan(0); // cools rather than warms
    expect(Math.abs(away)).toBeLessThan(toward * 0.5); // dominated by the warm lobe
    const out = tint(BASE, away);
    expect(out.b).toBeGreaterThan(BASE.b); // cooler
    expect(out.r).toBeLessThan(BASE.r);
    expect(BASE.r - out.r).toBeLessThan(0.12); // a gentle correction, not a big swing
  });

  it('returns exactly the baseline at night (dayF=0, dusk=0 → weight 0)', () => {
    const w = aerialFogWeight(1, 0, 0, 0);
    expect(w).toBe(0);
    expect(tint(BASE, w)).toEqual(BASE);
  });

  it('attenuates toward neutral as weather wetness rises (overcast hides the sun)', () => {
    const dry = aerialFogWeight(1, 0.4, 1, 0);
    const damp = aerialFogWeight(1, 0.4, 1, 0.5);
    const soaked = aerialFogWeight(1, 0.4, 1, 1);
    expect(damp).toBeLessThan(dry);
    expect(soaked).toBeLessThan(damp);
    expect(soaked).toBeGreaterThanOrEqual(0); // a small diffuse residual, never inverted
  });

  it('stays finite for degenerate facing (zero-length view or sun vector → NaN) and clamps to 0', () => {
    expect(aerialFogWeight(NaN, 0.4, 1, 0)).toBe(0);
    expect(Number.isFinite(aerialFogWeight(0, 0.4, 1, 0))).toBe(true);
  });

  it('treats a non-finite wetness as clear weather rather than poisoning the result', () => {
    expect(Number.isFinite(aerialFogWeight(1, 0.4, 1, NaN))).toBe(true);
  });
});

describe('applyAerialFog', () => {
  it('keeps every channel within [0,1] even for out-of-range weights', () => {
    const hot = applyAerialFog({ r: 0, g: 0, b: 0 }, 0.9, 0.9, 0.2, 5);
    const cold = applyAerialFog({ r: 0, g: 0, b: 0 }, 0.1, 0.1, 0.9, -5);
    for (const c of [hot.r, hot.g, hot.b, cold.r, cold.g, cold.b]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('writes into the provided object (allocation-free) and returns it', () => {
    const out = { r: 0, g: 0, b: 0 };
    const ret = applyAerialFog(out, 0.4, 0.4, 0.4, 0);
    expect(ret).toBe(out);
    expect(out).toEqual({ r: 0.4, g: 0.4, b: 0.4 });
  });
});
