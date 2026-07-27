// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  GFX_PREFS_KEY,
  MAX_SAFE_LEVEL,
  SETTING_DEFS,
  applySafeModePreset,
  applySafeStepDown,
  ceilingsForTier,
  clearSettingOverrides,
  defaultsForTier,
  didLastBootFail,
  foliageForScene,
  loadQualityPref,
  loadSafeLevel,
  loadSettingOverrides,
  markBootStarted,
  markBootSucceeded,
  resetGraphicsPrefs,
  resolveGraphicsSettings,
  resolveTier,
  saveSettingOverride,
  scopeFor,
  tierFromProbe,
  writeFogDensity,
} from './graphicsSettings.js';

const write = (blob) => localStorage.setItem(GFX_PREFS_KEY, JSON.stringify(blob));
const read = () => JSON.parse(localStorage.getItem(GFX_PREFS_KEY));

beforeEach(() => localStorage.clear());

describe('tier defaults', () => {
  // The guard against this module quietly changing how the world looks. Each
  // value is what the corresponding subsystem hardcoded for that tier before
  // graphicsSettings existed — see the tables in BabylonWorldScene
  // (_setupShadows / _setupSSAO / _tryBuildPipeline), terrainMaterial and
  // AshwoodGrass.
  it.each([
    ['high', {
      shadows: 'cascaded', postFx: 'full', terrainDetail: 'high', foliage: 'full',
      ambientOcclusion: 'on', reflections: 'on', volumetricClouds: 'off',
      renderScale: 'full', fog: 'full',
    }],
    ['low', {
      shadows: 'simple', postFx: 'basic', terrainDetail: 'medium', foliage: 'reduced',
      ambientOcclusion: 'off', reflections: 'off', volumetricClouds: 'off',
      renderScale: 'full', fog: 'full',
    }],
    ['mobile', {
      shadows: 'simple', postFx: 'minimal', terrainDetail: 'low', foliage: 'sparse',
      ambientOcclusion: 'off', reflections: 'off', volumetricClouds: 'off',
      renderScale: 'full', fog: 'full',
    }],
  ])('%s reproduces the pre-existing hardcoded stack', (tier, expected) => {
    expect(defaultsForTier(tier)).toEqual(expected);
  });

  it('resolves to exactly the tier defaults when no overrides are stored', () => {
    for (const tier of ['high', 'low', 'mobile']) {
      const resolved = resolveGraphicsSettings(tier, {}, 0);
      for (const [id, value] of Object.entries(defaultsForTier(tier))) {
        expect(resolved[id], `${tier}.${id}`).toBe(value);
      }
      expect(resolved.isCustom).toBe(false);
    }
  });

  it('falls back to the high-tier table for an unknown tier', () => {
    expect(defaultsForTier('nonsense')).toEqual(defaultsForTier('high'));
  });
});

describe('ceiling clamping', () => {
  it('clamps an override heavier than the tier allows', () => {
    const r = resolveGraphicsSettings('mobile', { shadows: 'cascaded' }, 0);
    expect(r.shadows).toBe('simple');
  });

  it('honours an override lighter than the tier default', () => {
    const r = resolveGraphicsSettings('high', { shadows: 'off' }, 0);
    expect(r.shadows).toBe('off');
    expect(r.isCustom).toBe(true);
  });

  it('refuses to enable high-tier-only effects on a lower tier', () => {
    const r = resolveGraphicsSettings('low', {
      ambientOcclusion: 'on', reflections: 'on', volumetricClouds: 'on', postFx: 'full',
    }, 0);
    expect(r.ambientOcclusion).toBe('off');
    expect(r.reflections).toBe('off');
    expect(r.volumetricClouds).toBe('off');
    expect(r.postFx).toBe('basic');
  });

  it('forces shadows off at the deepest safe level regardless of the override', () => {
    const r = resolveGraphicsSettings('high', { shadows: 'cascaded' }, MAX_SAFE_LEVEL);
    expect(r.shadows).toBe('off');
    expect(ceilingsForTier('high', MAX_SAFE_LEVEL).shadows).toBe('off');
  });

  it('does not mark an override equal to the tier default as custom', () => {
    const r = resolveGraphicsSettings('mobile', { shadows: 'simple' }, 0);
    expect(r.shadows).toBe('simple');
    expect(r.isCustom).toBe(false);
  });

  it('still reads as custom when the request was clamped away', () => {
    // isCustom tracks stored INTENT, not the clamped result: the player will get
    // this back on a machine that can honour it, so Reset must stay offered.
    const r = resolveGraphicsSettings('mobile', { shadows: 'cascaded' }, 0);
    expect(r.shadows).toBe('simple');   // clamped
    expect(r.isCustom).toBe(true);      // but the choice is still theirs
  });

  it('exposes derived scalars under names that cannot shadow the option ids', () => {
    const r = resolveGraphicsSettings('high', { fog: 'off', renderScale: 'half' }, 0);
    expect(r.fog).toBe('off');
    expect(r.renderScale).toBe('half');
    expect(r.fogScale).toBe(0);
    expect(r.renderScaleFactor).toBe(0.5);
    expect(r.foliageCfg).toMatchObject({ grass: 'high', leafScale: 1, detailScale: 1 });
  });
});

describe('override persistence', () => {
  it('round-trips a valid override', () => {
    saveSettingOverride('fog', 'reduced');
    expect(loadSettingOverrides()).toEqual({ fog: 'reduced' });
  });

  it('drops unknown ids and unknown values from a stale blob', () => {
    write({ settings: { shadows: 'simple', bloomAmount: 'high', fog: 'ultra' } });
    expect(loadSettingOverrides()).toEqual({ shadows: 'simple' });
  });

  it('ignores an attempt to store a value outside the option list', () => {
    saveSettingOverride('fog', 'sideways');
    expect(loadSettingOverrides().fog).toBeUndefined();
  });

  it('clears an override back to the tier default with null', () => {
    saveSettingOverride('fog', 'off');
    saveSettingOverride('fog', null);
    expect(loadSettingOverrides().fog).toBeUndefined();
  });

  it('migrates the legacy standalone booleans', () => {
    write({ reflections: false, volumetricClouds: true });
    expect(loadSettingOverrides()).toEqual({ reflections: 'off', volumetricClouds: 'on' });
  });

  it('does not migrate legacy booleans that were already at their default', () => {
    write({ reflections: true, volumetricClouds: false });
    expect(loadSettingOverrides()).toEqual({});
  });

  it('lets an explicit override win over the legacy boolean', () => {
    write({ reflections: false, settings: { reflections: 'on' } });
    expect(loadSettingOverrides().reflections).toBe('on');
  });

  it('survives a corrupt blob', () => {
    localStorage.setItem(GFX_PREFS_KEY, '{not json');
    expect(loadSettingOverrides()).toEqual({});
    expect(loadSafeLevel()).toBe(0);
    expect(loadQualityPref()).toBe('auto');
  });

  it('preserves sibling prefs when writing an override', () => {
    write({ safeLevel: 2, qualityPref: 'balanced' });
    saveSettingOverride('fog', 'off');
    expect(read()).toMatchObject({ safeLevel: 2, qualityPref: 'balanced', settings: { fog: 'off' } });
  });

  it('clears every override at once', () => {
    saveSettingOverride('fog', 'off');
    saveSettingOverride('shadows', 'off');
    clearSettingOverrides();
    expect(loadSettingOverrides()).toEqual({});
  });

  // Regression: clearing only `settings` left the legacy booleans in place, and
  // loadSettingOverrides re-synthesizes an override from them on EVERY read — so
  // Reset silently handed the old choices straight back to anyone upgrading.
  it('clearing also drops the legacy booleans so they cannot resurrect', () => {
    write({ reflections: false, volumetricClouds: true, settings: {} });
    expect(loadSettingOverrides()).toEqual({ reflections: 'off', volumetricClouds: 'on' });
    clearSettingOverrides();
    expect(loadSettingOverrides()).toEqual({});
    expect(read().reflections).toBeUndefined();
    expect(read().volumetricClouds).toBeUndefined();
  });

  it('reset drops legacy booleans too', () => {
    write({ reflections: false, volumetricClouds: true, qualityPref: 'low', safeLevel: 2 });
    resetGraphicsPrefs();
    expect(loadSettingOverrides()).toEqual({});
    expect(loadQualityPref()).toBe('auto');
    expect(loadSafeLevel()).toBe(0);
  });

  it('reset preserves the boot sentinel — it describes the last run, not a pref', () => {
    markBootStarted();
    resetGraphicsPrefs();
    expect(didLastBootFail()).toBe(true);
  });
});

describe('foliageForScene', () => {
  it('prefers the resolved gfx seam when the scene has one', () => {
    const scene = { metadata: { ashwood: {
      qualityTier: 'high',
      gfx: { foliageCfg: { grass: 'mobile', leafScale: 0.45, detailScale: 0.55 } },
    } } };
    expect(foliageForScene(scene).grass).toBe('mobile');
  });

  it("falls back to the tier's own density when gfx is absent", () => {
    // The dev viewer, the QA harness and the prop-mesh unit tests all build
    // scenes with nothing but qualityTier on the seam. Those must keep their
    // tier's density rather than silently jumping to full.
    expect(foliageForScene({ metadata: { ashwood: { qualityTier: 'mobile' } } }))
      .toMatchObject({ grass: 'mobile', leafScale: 0.45, detailScale: 0.55 });
    expect(foliageForScene({ metadata: { ashwood: { qualityTier: 'low' } } }))
      .toMatchObject({ grass: 'low', leafScale: 0.6, detailScale: 0.7 });
    expect(foliageForScene({ metadata: { ashwood: { qualityTier: 'high' } } }))
      .toMatchObject({ grass: 'high', leafScale: 1, detailScale: 1 });
  });

  it('falls back to full for a scene with no metadata at all', () => {
    expect(foliageForScene(null).leafScale).toBe(1);
    expect(foliageForScene({}).leafScale).toBe(1);
  });
});

describe('scopeFor', () => {
  const def = (id) => SETTING_DEFS.find((d) => d.id === id);

  it('reports reload-scoped settings as reload regardless of state', () => {
    expect(scopeFor(def('shadows'), 'off', { reflectionsSupported: true })).toBe('reload');
  });

  it('reports plainly live settings as live', () => {
    expect(scopeFor(def('fog'), 'off', {})).toBe('live');
    expect(scopeFor(def('renderScale'), 'half', {})).toBe('live');
  });

  // Regression: reflections were declared 'live', but the MirrorTexture and the
  // water shader's `#define REFLECT` are decided when the lake material is
  // built. Turning them ON in a scene that booted without them did nothing while
  // the control happily reported On.
  it('treats turning reflections ON as reload when no mirror was allocated', () => {
    expect(scopeFor(def('reflections'), 'on', { reflectionsSupported: false })).toBe('reload');
    expect(scopeFor(def('reflections'), 'on', { reflectionsSupported: true })).toBe('live');
  });

  it('keeps turning reflections OFF live either way — the fade always works', () => {
    expect(scopeFor(def('reflections'), 'off', { reflectionsSupported: false })).toBe('live');
    expect(scopeFor(def('reflections'), 'off', { reflectionsSupported: true })).toBe('live');
  });
});

describe('tier resolution', () => {
  it('sniffs known-slow GPUs down from high', () => {
    const probe = { isMobile: false, canHeavy: true };
    expect(tierFromProbe({ ...probe, gpuRenderer: 'NVIDIA GeForce RTX 4070' })).toBe('high');
    expect(tierFromProbe({ ...probe, gpuRenderer: 'Intel(R) UHD Graphics 630' })).toBe('low');
    expect(tierFromProbe({ ...probe, gpuRenderer: 'Google SwiftShader' })).toBe('mobile');
    expect(tierFromProbe({ ...probe, gpuRenderer: null })).toBe('high');
    expect(tierFromProbe({ ...probe, canHeavy: false, gpuRenderer: null })).toBe('low');
  });

  it('keeps Iris Xe and Arc on high (only the UHD/HD line steps down)', () => {
    const probe = { isMobile: false, canHeavy: true };
    expect(tierFromProbe({ ...probe, gpuRenderer: 'Intel(R) Iris(R) Xe Graphics' })).toBe('high');
    expect(tierFromProbe({ ...probe, gpuRenderer: 'Intel(R) Arc(TM) A770' })).toBe('high');
  });

  it('steps down one tier per safe level and floors at mobile', () => {
    expect(applySafeStepDown('high', 0)).toBe('high');
    expect(applySafeStepDown('high', 1)).toBe('low');
    expect(applySafeStepDown('high', 2)).toBe('mobile');
    expect(applySafeStepDown('high', 9)).toBe('mobile');
    expect(applySafeStepDown('low', 1)).toBe('mobile');
  });

  it('lets an explicit preset replace the sniff but not the safe ladder', () => {
    const probe = { isMobile: false, canHeavy: true, gpuRenderer: 'Google SwiftShader' };
    expect(resolveTier({ ...probe, qualityPref: 'high', safeLevel: 0 })).toBe('high');
    expect(resolveTier({ ...probe, qualityPref: 'high', safeLevel: 1 })).toBe('low');
    expect(resolveTier({ ...probe, qualityPref: 'auto', safeLevel: 0 })).toBe('mobile');
  });

  it('pins mobile devices to the mobile tier whatever the preset says', () => {
    expect(resolveTier({ isMobile: true, qualityPref: 'high', safeLevel: 0 })).toBe('mobile');
  });
});

describe('fog writes', () => {
  const FOGMODE_NONE = 0;
  const FOGMODE_EXP2 = 3;
  const sceneWith = (fogScale) => ({
    fogDensity: 0, fogMode: FOGMODE_EXP2,
    metadata: { ashwood: { gfx: { fogScale } } },
  });

  it('scales the density and keeps exp2 mode', () => {
    const scene = sceneWith(0.55);
    writeFogDensity(scene, 0.02);
    expect(scene.fogDensity).toBeCloseTo(0.011);
    expect(scene.fogMode).toBe(FOGMODE_EXP2);
  });

  it('switches the fog mode off entirely at scale 0', () => {
    // Density 0 alone still pays for the fog term in every fragment shader.
    const scene = sceneWith(0);
    writeFogDensity(scene, 0.02);
    expect(scene.fogDensity).toBe(0);
    expect(scene.fogMode).toBe(FOGMODE_NONE);
  });

  it('restores exp2 when fog is turned back on', () => {
    const scene = sceneWith(0);
    writeFogDensity(scene, 0.02);
    scene.metadata.ashwood.gfx.fogScale = 1;
    writeFogDensity(scene, 0.02);
    expect(scene.fogMode).toBe(FOGMODE_EXP2);
    expect(scene.fogDensity).toBe(0.02);
  });

  it('passes the base value through when no gfx metadata exists yet', () => {
    const scene = { fogDensity: 0, fogMode: FOGMODE_EXP2, metadata: {} };
    writeFogDensity(scene, 0.018);
    expect(scene.fogDensity).toBe(0.018);
  });

  it('is a no-op on a null scene', () => {
    expect(() => writeFogDensity(null, 0.02)).not.toThrow();
  });
});

describe('boot sentinel', () => {
  it('round-trips start → success', () => {
    expect(didLastBootFail()).toBe(false);
    markBootStarted();
    expect(didLastBootFail()).toBe(true);
    markBootSucceeded();
    expect(didLastBootFail()).toBe(false);
  });

  it('leaves the flag raised when a boot never reaches a frame', () => {
    markBootStarted();
    // no markBootSucceeded — the tab died here
    expect(didLastBootFail()).toBe(true);
  });

  it('does not disturb the other prefs', () => {
    write({ safeLevel: 1, settings: { fog: 'off' } });
    markBootStarted();
    markBootSucceeded();
    expect(read()).toMatchObject({ safeLevel: 1, settings: { fog: 'off' } });
  });
});

describe('presets', () => {
  it('safe mode writes a light configuration without inventing a context loss', () => {
    applySafeModePreset();
    expect(loadQualityPref()).toBe('low');
    expect(loadSettingOverrides()).toMatchObject({
      shadows: 'off', renderScale: 'threeQuarter', reflections: 'off',
    });
    // safeLevel means "this machine lost its WebGL context". Choosing safe mode
    // has not made that true.
    expect(loadSafeLevel()).toBe(0);
  });

  it('reset clears the preset, every override and the safe ladder', () => {
    write({ safeLevel: 2, qualityPref: 'low', settings: { fog: 'off' } });
    resetGraphicsPrefs();
    expect(loadQualityPref()).toBe('auto');
    expect(loadSafeLevel()).toBe(0);
    expect(loadSettingOverrides()).toEqual({});
  });
});

describe('setting definitions', () => {
  it('gives every setting a unique id, a scope and at least two options', () => {
    const ids = SETTING_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of SETTING_DEFS) {
      expect(['live', 'reload']).toContain(def.scope);
      expect(def.options.length).toBeGreaterThanOrEqual(2);
      expect(def.label).toBeTruthy();
    }
  });

  it('covers every setting in each tier default and ceiling', () => {
    for (const tier of ['high', 'low', 'mobile']) {
      for (const def of SETTING_DEFS) {
        const ids = def.options.map((o) => o.id);
        expect(ids, `${tier}.${def.id} default`).toContain(defaultsForTier(tier)[def.id]);
        expect(ids, `${tier}.${def.id} ceiling`).toContain(ceilingsForTier(tier)[def.id]);
      }
    }
  });

  it('never defaults a tier to a value heavier than its own ceiling', () => {
    for (const tier of ['high', 'low', 'mobile']) {
      const defaults = defaultsForTier(tier);
      const ceilings = ceilingsForTier(tier);
      for (const def of SETTING_DEFS) {
        const ids = def.options.map((o) => o.id);
        expect(ids.indexOf(defaults[def.id]), `${tier}.${def.id}`)
          .toBeGreaterThanOrEqual(ids.indexOf(ceilings[def.id]));
      }
    }
  });
});
