import { describe, expect, it } from 'vitest';
import { selfShadowStrength } from './selfShadow.js';

describe('selfShadowStrength', () => {
  it('is deterministic', () => {
    expect(selfShadowStrength(0.4)).toBe(selfShadowStrength(0.4));
  });

  it('stays within its documented [0.15, 0.85] range across a wide sweep', () => {
    for (let i = -20; i <= 20; i++) {
      const y = i / 10; // -2..2, well past both real and pathological inputs
      const s = selfShadowStrength(y);
      expect(s).toBeGreaterThanOrEqual(0.15);
      expect(s).toBeLessThanOrEqual(0.85);
    }
  });

  it('is strongest at a grazing or below-horizon sun', () => {
    expect(selfShadowStrength(-0.4)).toBeCloseTo(0.85, 6); // moonwash-like
    expect(selfShadowStrength(0.1)).toBeCloseTo(0.85, 6); // dawnfire/gloaming-like
  });

  it('is weakest at a high overhead sun', () => {
    expect(selfShadowStrength(0.95)).toBeCloseTo(0.15, 6); // high-noon-like
  });

  it('never bottoms out to exactly zero even at high noon — recesses stay a little darker', () => {
    expect(selfShadowStrength(1.0)).toBeGreaterThan(0);
  });

  it('decreases monotonically as the sun climbs', () => {
    const ys = [-0.3, 0, 0.25, 0.5, 0.7, 0.85, 1];
    const strengths = ys.map(selfShadowStrength);
    for (let i = 1; i < strengths.length; i++) {
      expect(strengths[i]).toBeLessThanOrEqual(strengths[i - 1]);
    }
  });
});
