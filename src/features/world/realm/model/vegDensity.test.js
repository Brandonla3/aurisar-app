/**
 * vegDensity.test.js — the placement-density curve and its BSL twin's
 * shared-constants contract.
 */
import { describe, expect, it } from 'vitest';
import { CANOPY_DENSITY_DEF, canopyDensityJs, emitCanopyDensityBsl } from './vegDensity.js';
import { DEFAULT_TERRAIN } from './terrainField.js';

describe('canopyDensityJs', () => {
  it('is deterministic and bounded to [0, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const x = (i * 37.3) % 600 - 300;
      const z = (i * 91.7) % 600 - 300;
      const masks = { mountainMask: (i % 11) / 10, valeMask: (i % 7) / 6 };
      const d = canopyDensityJs(x, z, masks);
      expect(d).toBe(canopyDensityJs(x, z, masks));
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('the forest belt outgrows the open meadow, which outgrows the vale clearing', () => {
    // Average over many grove-noise samples so clumping washes out and the
    // BAND term — the part the far tint shares — is what's measured.
    const avg = (masks) => {
      let sum = 0;
      const n = 400;
      for (let i = 0; i < n; i++) {
        sum += canopyDensityJs(i * 13.7, i * 7.1, masks);
      }
      return sum / n;
    };
    const belt = avg({ mountainMask: CANOPY_DENSITY_DEF.beltPeak, valeMask: 0 });
    const meadow = avg({ mountainMask: 0, valeMask: 0 });
    const vale = avg({ mountainMask: 0, valeMask: 1 });
    expect(belt).toBeGreaterThan(meadow * 2);
    expect(meadow).toBeGreaterThan(vale * 2);
  });

  it('the high crags fall back toward the hardy floor, not to zero', () => {
    const avg = (mask) => {
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += canopyDensityJs(i * 13.7, i * 7.1, { mountainMask: mask, valeMask: 0 });
      return sum / 400;
    };
    const peak = avg(CANOPY_DENSITY_DEF.beltPeak);
    const high = avg(1);
    expect(high).toBeLessThan(peak);
    expect(high).toBeGreaterThan(peak * CANOPY_DENSITY_DEF.beltHighFloor * 0.6);
  });
});

describe('emitCanopyDensityBsl — the shared-constants contract', () => {
  const src = emitCanopyDensityBsl();

  it('stamps every band constant byte-for-byte via toFixed', () => {
    const d = CANOPY_DENSITY_DEF;
    for (const n of [d.beltIn, d.beltPeak, d.beltOut, d.meadowBase, d.valeClear, d.groveLo, d.groveHi, d.groveFreq]) {
      expect(src).toContain(n.toFixed(4));
    }
  });

  it('stamps the terrain field\'s OWN mountain-band numbers — one source for where the world changes', () => {
    expect(src).toContain(DEFAULT_TERRAIN.mountainStartM.toFixed(4));
    expect(src).toContain(DEFAULT_TERRAIN.mountainFullM.toFixed(4));
    expect(src).toContain(DEFAULT_TERRAIN.valeRadiusM.toFixed(4));
  });

  it('uses the cosmetic shader noise, per the documented carve-out — never imul hashes', () => {
    expect(src).toContain('realmVnoise');
    expect(src).not.toMatch(/imul|hash2/);
  });
});
