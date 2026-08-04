import { describe, expect, it } from 'vitest';
import { valueNoise2, fbm2, ridged2, hash2 } from './noise.js';
import { createTerrainField, DEFAULT_TERRAIN } from './terrainField.js';

describe('noise', () => {
  it('is deterministic — the multiplayer contract', () => {
    // Same (x, z, seed) must give the same value on every client and the
    // server, forever. There is no ground sync; this IS the ground.
    expect(valueNoise2(12.34, 56.78, 42)).toBe(valueNoise2(12.34, 56.78, 42));
    expect(fbm2(3.3, 4.4, { seed: 7 })).toBe(fbm2(3.3, 4.4, { seed: 7 }));
    expect(hash2(100, -200, 5)).toBe(hash2(100, -200, 5));
  });

  it('different seeds give different terrain', () => {
    expect(fbm2(10, 10, { seed: 1 })).not.toBe(fbm2(10, 10, { seed: 2 }));
  });

  it('stays within its documented range', () => {
    for (let i = 0; i < 500; i++) {
      const x = (i * 7.3) % 100 - 50;
      const z = (i * 13.7) % 100 - 50;
      const v = fbm2(x, z, { seed: 9 });
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      const r = ridged2(x, z, { seed: 9 });
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('is continuous — no cliffs between adjacent samples', () => {
    // A lattice discontinuity would tessellate into a visible tear. Adjacent
    // millimetre samples must be within a millimetre-scale delta.
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const a = fbm2(x, 5, { seed: 3 });
      const b = fbm2(x + 0.001, 5, { seed: 3 });
      expect(Math.abs(a - b)).toBeLessThan(0.01);
    }
  });
});

describe('createTerrainField', () => {
  const field = createTerrainField();

  it('surfaceY is deterministic across instances', () => {
    const other = createTerrainField();
    for (const [x, z] of [[0, 0], [123.4, -56.7], [500, 500], [-321, 89]]) {
      expect(field.surfaceY(x, z)).toBe(other.surfaceY(x, z));
    }
  });

  it('golden probes — the world cannot move without failing this test', () => {
    // Pinned actual values. If any of these change, every placed object,
    // every stored player position, and the server's view of the ground all
    // shift — which is allowed, but only as a deliberate RESHUFFLE decision.
    const probes = [
      [0, 0], [50, 0], [0, 120], [300, 300], [-400, 200], [640, -640],
    ];
    const snapshot = probes.map(([x, z]) => field.surfaceY(x, z).toFixed(6));
    expect(snapshot).toMatchInlineSnapshot(`
      [
        "-0.693008",
        "-2.576046",
        "2.759316",
        "33.688087",
        "30.426100",
        "23.881030",
      ]
    `);
  });

  it('the spawn vale is gentle ground', () => {
    // New players must arrive on walkable terrain. Within the vale radius the
    // height variation and slope stay small.
    for (let a = 0; a < 12; a++) {
      const x = Math.cos((a / 12) * Math.PI * 2) * 25;
      const z = Math.sin((a / 12) * Math.PI * 2) * 25;
      expect(Math.abs(field.surfaceY(x, z))).toBeLessThan(2.5);
      expect(field.slopeAt(x, z)).toBeLessThan(0.25);
    }
  });

  it('mountains rise beyond the band, vale stays low', () => {
    // Sample max heights in the vale vs the mountain ring: the ring must be
    // dramatically higher — that is the whole "vale ringed by crags" read.
    let valeMax = -Infinity;
    let ringMax = -Infinity;
    for (let a = 0; a < 32; a++) {
      const t = (a / 32) * Math.PI * 2;
      valeMax = Math.max(valeMax, field.surfaceY(Math.cos(t) * 30, Math.sin(t) * 30));
      ringMax = Math.max(ringMax, field.surfaceY(Math.cos(t) * 500, Math.sin(t) * 500));
    }
    expect(ringMax).toBeGreaterThan(valeMax + 15);
  });

  it('normals are unit length and mostly upward on walkable ground', () => {
    for (const [x, z] of [[10, 10], [80, -40], [200, 150]]) {
      const n = field.normalAt(x, z);
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 6);
    }
    // Flat vale ground: normal is nearly straight up.
    expect(field.normalAt(5, 5).y).toBeGreaterThan(0.95);
  });

  it('slopeAt agrees with normalAt', () => {
    const n = field.normalAt(300, 300);
    expect(field.slopeAt(300, 300)).toBeCloseTo(1 - n.y, 10);
  });

  it('config overrides replace numbers without touching math', () => {
    const flat = createTerrainField({ baseAmplitudeM: 0, mountainAmplitudeM: 0, ravineDepthM: 0 });
    expect(flat.surfaceY(123, 456)).toBe(0);
    expect(flat.config.seed).toBe(DEFAULT_TERRAIN.seed);
  });
});

describe('shadeProxyAt — the self-shadow bake input', () => {
  const field = createTerrainField();

  it('is deterministic and stays within [0, 1]', () => {
    for (const [x, z] of [[0, 0], [50, 0], [0, 120], [300, 300], [-400, 200], [640, -640]]) {
      const v = field.shadeProxyAt(x, z);
      expect(v).toBe(field.shadeProxyAt(x, z));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('open rolling ground well inside the mountain band reads near zero', () => {
    // Flat vale ground (already asserted gentle by the spawn-vale test above):
    // no ravine channel, no mountain mask, so both recess terms are ~0.
    for (let a = 0; a < 8; a++) {
      const x = Math.cos((a / 8) * Math.PI * 2) * 25;
      const z = Math.sin((a / 8) * Math.PI * 2) * 25;
      expect(field.shadeProxyAt(x, z)).toBeLessThan(0.15);
    }
  });

  it('reads darker on average out in the mountain band than in the open vale', () => {
    // Not every mountain-band sample is a lee trough (some sit near a ridge
    // crest, which reads bright by design) — assert the AVERAGE, matching how
    // the existing "mountains rise" test compares regions rather than points.
    let valeSum = 0;
    let ringSum = 0;
    const n = 32;
    for (let a = 0; a < n; a++) {
      const t = (a / n) * Math.PI * 2;
      valeSum += field.shadeProxyAt(Math.cos(t) * 25, Math.sin(t) * 25);
      ringSum += field.shadeProxyAt(Math.cos(t) * 500, Math.sin(t) * 500);
    }
    expect(ringSum / n).toBeGreaterThan(valeSum / n);
  });
});

describe('sampleSurface — the shared gen-time entry point', () => {
  const field = createTerrainField();

  it('agrees exactly with calling surfaceY and shadeProxyAt separately', () => {
    // The two must never disagree — sampleSurface exists to share ONE
    // computeLayers() call, not to compute a different answer.
    for (const [x, z] of [[0, 0], [50, 0], [0, 120], [300, 300], [-400, 200], [640, -640]]) {
      const { y, shade } = field.sampleSurface(x, z);
      expect(y).toBe(field.surfaceY(x, z));
      expect(shade).toBe(field.shadeProxyAt(x, z));
    }
  });

  it('is deterministic', () => {
    const a = field.sampleSurface(123.4, -56.7);
    const b = field.sampleSurface(123.4, -56.7);
    expect(a).toEqual(b);
  });
});
