import { describe, it, expect } from 'vitest';
import { buildWorldMapCanvas, locationLabelAt } from './mapRender.js';

// Minimal worldgen stub: locationLabelAt only touches config + the
// inMountain/inForest/biomeAt predicates (no canvas), so it's pure-testable.
const baseWorldgen = () => ({
  config: {
    interiors: {
      ashwoodCastle:   { cx: 840,  cz: 0, name: 'Castle Ashwood' },
      hollowDeep:      { cx: 1000, cz: 0, name: 'The Hollow Crypt' },
      frostspireHalls: { cx: 1300, cz: 0, name: 'The Frostspire Halls' },
    },
    lake: { x: -92, z: 88, waterR: 27, name: 'Stillmere' },
  },
  inMountain: () => false,
  inForest: () => false,
  biomeAt: () => ({ name: 'Meadow' }),
});

describe('locationLabelAt — dungeon gate label', () => {
  // `inDungeon` is set ONLY by proximity to the north dungeon gate at (0,-37)
  // (BabylonWorldScene DUNGEON_ENTRANCE); the castle has its own isInside()
  // path before this. So the label must reflect that gate — NOT the nearest
  // interior anchor by x (Castle Ashwood at cx 840 is nearest to the gate's
  // x≈0, which is the regression this guards against).
  it('names the hub dungeon gate (0,-37) the Hollow Crypt, not Castle Ashwood', () => {
    const wg = baseWorldgen();
    const label = locationLabelAt(wg, 0, -37, { inDungeon: true });
    expect(label).toBe('The Hollow Crypt');
    expect(label).not.toBe('Castle Ashwood');
  });

  it('dungeon wins over overworld geography (even on the mountain)', () => {
    const wg = baseWorldgen();
    wg.inMountain = () => true;
    expect(locationLabelAt(wg, 0, -37, { inDungeon: true })).toBe('The Hollow Crypt');
  });

  it('falls back to "Dungeon" when hollowDeep is absent', () => {
    const wg = baseWorldgen();
    delete wg.config.interiors.hollowDeep;
    expect(locationLabelAt(wg, 0, -37, { inDungeon: true })).toBe('Dungeon');
  });
});

describe('locationLabelAt — geographic priority (lake > mountain > forest > biome)', () => {
  it('lake by proximity to the water', () => {
    const wg = baseWorldgen();
    expect(locationLabelAt(wg, -92, 88)).toBe('Stillmere');           // at the lake center
    expect(locationLabelAt(wg, 8, 88)).not.toBe('Stillmere');         // 100 m away
  });

  it('mountain, then forest, then biome, then the final fallback', () => {
    const wg = baseWorldgen();
    wg.inMountain = () => true;
    expect(locationLabelAt(wg, 0, 0)).toBe('The Mountain');
    wg.inMountain = () => false; wg.inForest = () => true;
    expect(locationLabelAt(wg, 0, 0)).toBe('Wildwood');
    wg.inForest = () => false;
    expect(locationLabelAt(wg, 0, 0)).toBe('Meadow');                 // biome name
    wg.biomeAt = () => null;
    expect(locationLabelAt(wg, 0, 0)).toBe('The Wilds');              // final fallback
  });

  it('an absent worldgen returns an empty string', () => {
    expect(locationLabelAt(null, 0, 0)).toBe('');
  });
});

// ── Map orientation ─────────────────────────────────────────────────────────
// +z is north and north is the top of the map (worldSpace.js). Nothing pinned
// this before, which is how the renderer drifted to the opposite of the
// content: the zone-2 gate is named `z1_north_pass` at z = +170, and the wolf
// quests point "up the north road" at camps around z = +55…+95, while the
// compass labelled yaw 0 (facing +z) as south. A player following the compass
// north walked ~125 m the wrong way.
describe('map orientation — +z is north, north is up', () => {
  // buildWorldMapCanvas needs a 2D context; jsdom has none, and the bake's
  // pixel loop is irrelevant here — only the projection is under test.
  function withStubCanvas(fn) {
    const orig = globalThis.document;
    globalThis.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          putImageData: () => {},
        }),
      }),
    };
    try { return fn(); } finally { globalThis.document = orig; }
  }

  const bounds = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };
  const wg = () => ({
    ...baseWorldgen(),
    config: { radius: 100, lake: null },
    biomeColorAt: (x, z, out) => { out.r = 0.3; out.g = 0.4; out.b = 0.2; return out; },
    lakeWaterDepthAt: () => 0,
    surfaceY: () => 0,
  });

  const build = () => withStubCanvas(
    () => buildWorldMapCanvas(wg(), { size: 16, bounds }),
  );

  it('maps a MORE-northern point to a SMALLER canvas y', () => {
    const m = build();
    const north = m.worldToPx(0, 80);
    const south = m.worldToPx(0, -80);
    expect(north.py).toBeLessThan(south.py);
    // ...and leaves x untouched: +x is east, drawn rightward.
    expect(m.worldToPx(80, 0).px).toBeGreaterThan(m.worldToPx(-80, 0).px);
  });

  it('puts maxZ at the top edge and minZ at the bottom', () => {
    const m = build();
    expect(m.worldToPx(0, bounds.maxZ).py).toBeCloseTo(0, 6);
    expect(m.worldToPx(0, bounds.minZ).py).toBeCloseTo(m.size, 6);
  });

  it('round-trips through pxToWorld', () => {
    const m = build();
    for (const [x, z] of [[0, 0], [37, -12], [-88, 64]]) {
      const p = m.worldToPx(x, z);
      const w = m.pxToWorld(p.px, p.py);
      expect(w.x).toBeCloseTo(x, 6);
      expect(w.z).toBeCloseTo(z, 6);
    }
  });
});
