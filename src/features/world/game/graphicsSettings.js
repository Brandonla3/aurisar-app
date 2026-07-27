/**
 * graphicsSettings — the world's graphics preference store and effect resolver.
 *
 * Deliberately PURE: no `BABYLON`, no React, no DOM beyond localStorage and a
 * throwaway WebGL probe. That is the whole point of the module. The graphics
 * panel used to live only inside the running scene, which meant the one player
 * who most needs it — someone whose GPU cannot run the tier the sniff picked —
 * was the one who could never reach it. Both the pre-world hub and the in-world
 * menu now render from this module, and the hub needs to work with no engine
 * alive at all.
 *
 * Three layers stack to produce the effective settings for a load:
 *
 *   1. QUALITY TIER  ('high' | 'low' | 'mobile') — what this machine can build.
 *      Chosen by GPU sniff or an explicit player preset, then stepped down by
 *      the crash-driven safe-mode ladder.
 *   2. TIER DEFAULTS — exactly what each tier hardcoded before this module
 *      existed, so a fresh install renders identically to before.
 *   3. PER-SETTING OVERRIDES — the player's individual choices.
 *
 * Overrides may only REDUCE cost relative to the tier, never raise it. The tier
 * decides what can be *constructed* (SSAO2 and cascaded shadow maps both need
 * float/MRT render targets), and safeLevel is a record of this machine actually
 * losing its WebGL context. Letting a preference outrank either would let a
 * player pin themselves to a configuration that cannot boot. `clampToCeiling`
 * is where that invariant is enforced, and it is the reason every option list
 * below is ordered HEAVIEST FIRST — the ceiling is an index into that order.
 */

// ── Persistence ──────────────────────────────────────────────────────────────
// One blob for every graphics pref. Shape:
//   { safeLevel, qualityPref, settings: {...}, bootPending,
//     reflections, volumetricClouds }   <- legacy booleans, migrated on read
export const GFX_PREFS_KEY = 'aurisar.world.gfx.v1';

export function loadGfxPrefs() {
  try { return JSON.parse(localStorage.getItem(GFX_PREFS_KEY)) ?? {}; }
  catch { return {}; }
}

export function saveGfxPrefs(prefs) {
  try { localStorage.setItem(GFX_PREFS_KEY, JSON.stringify(prefs)); }
  catch { /* quota / private mode */ }
}

function patchGfxPrefs(patch) {
  saveGfxPrefs({ ...loadGfxPrefs(), ...patch });
}

// ── Safe-mode ladder ─────────────────────────────────────────────────────────
// Escalates on each unrecovered WebGL context loss and is persisted, so a reload
// comes back lighter until the world is stable; decays again after a crash-free
// run so capable machines drift back to full quality.
//   0 = full (tier as chosen)   1 = one tier down   2 = pin to mobile path
//   3 = + no shadows + lower resolution
export const MAX_SAFE_LEVEL = 3;

export function loadSafeLevel() {
  const v = Number(loadGfxPrefs().safeLevel);
  return Number.isFinite(v) ? Math.max(0, Math.min(MAX_SAFE_LEVEL, Math.round(v))) : 0;
}

export function saveSafeLevel(level) {
  patchGfxPrefs({ safeLevel: Math.max(0, Math.min(MAX_SAFE_LEVEL, level)) });
}

// ── Quality preset ───────────────────────────────────────────────────────────
// The GPU sniff reasons about a renderer string browsers increasingly mask (a
// masked string falls through to the maximal stack). This is the player's
// override of that guess. It does NOT defeat the safe-mode ladder — see the
// module header.
export const QUALITY_PREFS = Object.freeze(['auto', 'high', 'balanced', 'low']);
export const PREF_TO_TIER  = Object.freeze({ high: 'high', balanced: 'low', low: 'mobile' });

export function loadQualityPref() {
  const v = loadGfxPrefs().qualityPref;
  return QUALITY_PREFS.includes(v) ? v : 'auto';
}

export function saveQualityPref(pref) {
  patchGfxPrefs({ qualityPref: QUALITY_PREFS.includes(pref) ? pref : 'auto' });
}

// ── Setting definitions ──────────────────────────────────────────────────────
// Both panels map over this list, so adding a setting is a one-object change
// with no JSX edits. `scope` is what the UI needs to know: 'live' applies on the
// spot, 'reload' stages behind a single Apply button because the tier-shaped
// resources are built once at scene construction.
//
// OPTIONS ARE ORDERED HEAVIEST → LIGHTEST. clampToCeiling depends on it.
export const SETTING_DEFS = Object.freeze([
  {
    id: 'shadows',
    label: 'Shadows',
    hint: 'Cascaded maps pack detail near your character; simple is one map for the whole scene.',
    scope: 'reload',
    options: [
      { id: 'cascaded',  label: 'Cascaded' },
      { id: 'simple',    label: 'Simple' },
      { id: 'simpleLow', label: 'Simple (low-res)' },
      { id: 'off',       label: 'Off' },
    ],
  },
  {
    id: 'postFx',
    label: 'Post-processing',
    hint: 'Bloom, film grain and vignette. Minimal drops the full pipeline for a lightweight glow pass.',
    scope: 'reload',
    options: [
      { id: 'full',    label: 'Full' },
      { id: 'basic',   label: 'Basic' },
      { id: 'minimal', label: 'Minimal' },
    ],
  },
  {
    id: 'terrainDetail',
    label: 'Terrain detail',
    hint: 'Ground shader complexity — procedural relief, detail normals and triplanar blending.',
    scope: 'reload',
    options: [
      { id: 'high',   label: 'High' },
      { id: 'medium', label: 'Medium' },
      { id: 'low',    label: 'Low' },
    ],
  },
  {
    id: 'foliage',
    label: 'Grass & foliage',
    hint: 'Blade density, grass draw distance and leaf-card size.',
    // Partially live — the grass field rebuilds on the next cell crossing, but
    // leaf and prop density is baked into each tile as it streams in. Staged as
    // 'reload' so the world is consistent rather than half-applied.
    scope: 'reload',
    options: [
      { id: 'full',    label: 'Full' },
      { id: 'reduced', label: 'Reduced' },
      { id: 'sparse',  label: 'Sparse' },
    ],
  },
  {
    id: 'ambientOcclusion',
    label: 'Ambient occlusion',
    hint: 'Contact shading in creases and under objects.',
    scope: 'live',
    options: [
      { id: 'on',  label: 'On' },
      { id: 'off', label: 'Off' },
    ],
  },
  {
    id: 'reflections',
    label: 'Water reflections',
    hint: 'Renders the scene a second time into the lake surface — the single most expensive effect.',
    scope: 'live',
    // Turning reflections OFF is genuinely live (fade the shader term, park the
    // mirror). Turning them back ON is not: the MirrorTexture and the water
    // shader's `#define REFLECT` are both decided when the lake material is
    // built, so if this scene booted without them there is nothing to fade in.
    // Without this the control would report On while the lake stayed flat.
    isLive: (value, state) => value !== 'on' || !!state?.reflectionsSupported,
    options: [
      { id: 'on',  label: 'On' },
      { id: 'off', label: 'Off' },
    ],
  },
  {
    id: 'volumetricClouds',
    label: 'Volumetric clouds',
    hint: 'Raymarched clouds overhead. Off by default even on capable machines.',
    scope: 'live',
    options: [
      { id: 'on',  label: 'On' },
      { id: 'off', label: 'Off' },
    ],
  },
  {
    id: 'renderScale',
    label: 'Render resolution',
    hint: 'Renders below your display resolution and lets the browser upscale. The bluntest way to buy frames.',
    scope: 'live',
    options: [
      { id: 'full',         label: '100%' },
      { id: 'threeQuarter', label: '75%' },
      { id: 'half',         label: '50%' },
    ],
  },
  {
    id: 'fog',
    label: 'Distance fog',
    hint: 'Atmospheric haze. Turning it off also removes the cover that hides terrain streaming in at the horizon.',
    scope: 'live',
    options: [
      { id: 'full',    label: 'Full' },
      { id: 'reduced', label: 'Reduced' },
      { id: 'off',     label: 'Off' },
    ],
  },
]);

const DEF_BY_ID = Object.freeze(Object.fromEntries(SETTING_DEFS.map((d) => [d.id, d])));

export function getSettingDef(id) { return DEF_BY_ID[id] ?? null; }

/**
 * Whether changing `def` to `value` can take effect without rebuilding the
 * scene, given the current scene state.
 *
 * Most settings are statically one or the other, but a few depend on what the
 * running scene actually allocated — see `reflections`. Both panels route
 * through this so a control can never claim to be live when it isn't.
 */
export function scopeFor(def, value, state) {
  if (def.scope !== 'live') return 'reload';
  if (typeof def.isLive === 'function' && !def.isLive(value, state)) return 'reload';
  return 'live';
}

/** Ordered option ids for a setting, heaviest first. */
function optionIds(id) { return DEF_BY_ID[id].options.map((o) => o.id); }

// ── Per-tier ceilings ────────────────────────────────────────────────────────
// The heaviest value each tier is allowed to reach. This is capability, not
// taste: 'high' is the only tier whose float/MRT render targets SSAO2, the HDR
// pipeline and cascaded shadow maps require, and the mirror texture is
// allocated only there.
const CEILINGS = Object.freeze({
  high: Object.freeze({
    shadows: 'cascaded', postFx: 'full', terrainDetail: 'high', foliage: 'full',
    ambientOcclusion: 'on', reflections: 'on', volumetricClouds: 'on',
    renderScale: 'full', fog: 'full',
  }),
  low: Object.freeze({
    shadows: 'simple', postFx: 'basic', terrainDetail: 'medium', foliage: 'reduced',
    ambientOcclusion: 'off', reflections: 'off', volumetricClouds: 'off',
    renderScale: 'full', fog: 'full',
  }),
  mobile: Object.freeze({
    shadows: 'simple', postFx: 'minimal', terrainDetail: 'low', foliage: 'sparse',
    ambientOcclusion: 'off', reflections: 'off', volumetricClouds: 'off',
    renderScale: 'full', fog: 'full',
  }),
});

// Tier defaults equal the ceiling for everything except volumetric clouds,
// which have always been opt-in even on machines that can afford them.
const DEFAULTS_BY_TIER = Object.freeze(Object.fromEntries(
  Object.entries(CEILINGS).map(([tier, ceil]) => [
    tier, Object.freeze({ ...ceil, volumetricClouds: 'off' }),
  ])
));

export function defaultsForTier(tier) {
  return DEFAULTS_BY_TIER[tier] ?? DEFAULTS_BY_TIER.high;
}

/**
 * Ceilings for a load, after the safe-mode ladder has had its say.
 *
 * safeLevel 1 and 2 are already expressed by stepping the TIER down before this
 * is called (applySafeStepDown), so only level 3 adds a setting-level cap: it is
 * the "just keep rendering" tier and drops the shadow pass entirely.
 */
export function ceilingsForTier(tier, safeLevel = 0) {
  const base = CEILINGS[tier] ?? CEILINGS.high;
  if ((safeLevel ?? 0) >= MAX_SAFE_LEVEL) return Object.freeze({ ...base, shadows: 'off' });
  return base;
}

/** Clamp `value` so it is no heavier than `ceiling`, using the option order. */
function clampToCeiling(id, value, ceiling) {
  const ids = optionIds(id);
  const vi = ids.indexOf(value);
  const ci = ids.indexOf(ceiling);
  if (vi < 0) return ceiling;          // unknown value — fall back to the cap
  if (ci < 0) return value;            // unknown ceiling — leave the choice alone
  return vi < ci ? ceiling : value;    // lower index = heavier
}

// ── Overrides ────────────────────────────────────────────────────────────────

/**
 * The player's stored per-setting choices, with unknown ids and unknown values
 * dropped so a stale blob from an older build can never produce an undefined
 * effect value downstream.
 *
 * Also migrates the two standalone booleans this store replaced, so players who
 * had already turned reflections off (or clouds on) keep that choice.
 */
// The standalone booleans this store replaced. loadSettingOverrides still reads
// them so an upgrading player keeps their choices, which means clear/reset have
// to actively delete them — otherwise every read resurrects the override.
const LEGACY_PREF_KEYS = Object.freeze(['reflections', 'volumetricClouds']);

export function loadSettingOverrides() {
  const prefs = loadGfxPrefs();
  const raw = prefs.settings;
  const out = {};

  if (raw && typeof raw === 'object') {
    for (const [id, value] of Object.entries(raw)) {
      if (DEF_BY_ID[id] && optionIds(id).includes(value)) out[id] = value;
    }
  }

  // Legacy booleans (pre-SETTING_DEFS). Only seed where the player had actively
  // moved off the default — `reflections !== false` was the old read.
  if (out.reflections === undefined && prefs.reflections === false) out.reflections = 'off';
  if (out.volumetricClouds === undefined && prefs.volumetricClouds === true) {
    out.volumetricClouds = 'on';
  }

  return out;
}

/** Persist one override. `null`/`undefined` clears it back to the tier default. */
export function saveSettingOverride(id, value) {
  const def = DEF_BY_ID[id];
  if (!def) return;
  const settings = { ...loadSettingOverrides() };
  if (value == null) delete settings[id];
  else if (optionIds(id).includes(value)) settings[id] = value;
  else return;
  patchGfxPrefs({ settings });
}

/**
 * Drop every override, returning the player to pure tier defaults.
 *
 * Must also delete the legacy booleans. loadSettingOverrides re-synthesizes an
 * override from them on every read, so wiping `settings` alone left Reset
 * lying to anyone upgrading from a build that used those keys: the reflections
 * and clouds choices would silently come straight back.
 */
export function clearSettingOverrides() {
  const prefs = loadGfxPrefs();
  for (const key of LEGACY_PREF_KEYS) delete prefs[key];
  saveGfxPrefs({ ...prefs, settings: {} });
}

// ── Resolution ───────────────────────────────────────────────────────────────

/**
 * Merge tier defaults with the player's overrides, clamped to what the tier can
 * actually build.
 *
 * @param {'high'|'low'|'mobile'} tier
 * @param {Record<string,string>} overrides
 * @param {number} safeLevel
 * Returns every setting under its own id, plus the derived scalars the render
 * code actually wants. The scalars are deliberately named apart from the ids
 * (`renderScaleFactor`, not `renderScale`) so neither can shadow the other.
 *
 * @returns {{ceilings:object, isCustom:boolean, fogScale:number,
 *   renderScaleFactor:number, foliageCfg:object}}
 */
export function resolveGraphicsSettings(tier, overrides = {}, safeLevel = 0) {
  const defaults = defaultsForTier(tier);
  const ceilings = ceilingsForTier(tier, safeLevel);
  const settings = {};
  let isCustom = false;

  for (const def of SETTING_DEFS) {
    const requested = overrides[def.id] ?? defaults[def.id];
    const value = clampToCeiling(def.id, requested, ceilings[def.id]);
    settings[def.id] = value;
    // "Custom" tracks the player's stored INTENT, not the clamped result. A
    // request the hardware refused still reads as custom — it is a choice they
    // made and will get back on a machine that can honour it, so hiding it
    // would make Reset look like a no-op.
    if (overrides[def.id] !== undefined && overrides[def.id] !== defaults[def.id]) {
      isCustom = true;
    }
  }

  return Object.freeze({
    ...settings,
    ceilings,
    isCustom,
    fogScale: FOG_SCALE[settings.fog] ?? 1,
    renderScaleFactor: RENDER_SCALE[settings.renderScale] ?? 1,
    foliageCfg: FOLIAGE_LEVELS[settings.foliage] ?? FOLIAGE_LEVELS.full,
  });
}

// ── Value tables consumed by the render code ─────────────────────────────────

/** Multiplier applied to every scene.fogDensity write. */
export const FOG_SCALE = Object.freeze({ full: 1, reduced: 0.55, off: 0 });

/** Fraction of the display resolution to render at. */
export const RENDER_SCALE = Object.freeze({ full: 1, threeQuarter: 0.75, half: 0.5 });

/**
 * Foliage levels → the existing per-tier tables in AshwoodGrass and
 * ashwoodPropMeshes. `grass` keys AshwoodGrass.TIERS.
 *
 * Note the tables disagree about which of the two light levels is lighter: the
 * grass row named 'low' is sparser than the one named 'mobile', while 'mobile'
 * leaf cards are smaller than 'low' ones. That inversion predates this module —
 * these mappings reproduce each tier's current look exactly rather than
 * silently retuning two tiers while adding a settings panel.
 */
export const FOLIAGE_LEVELS = Object.freeze({
  full:    Object.freeze({ grass: 'high',   leafScale: 1,    detailScale: 1 }),
  reduced: Object.freeze({ grass: 'low',    leafScale: 0.6,  detailScale: 0.7 }),
  sparse:  Object.freeze({ grass: 'mobile', leafScale: 0.45, detailScale: 0.55 }),
});

/**
 * Foliage level for a scene, for callers that read the metadata seam directly.
 *
 * Falls back to the tier's own default when `gfx` is absent — the dev viewer,
 * the QA harness and the unit tests all build scenes with nothing but
 * `qualityTier` on the seam, and those must keep rendering at their tier's
 * density rather than silently jumping to full.
 */
export function foliageForScene(scene) {
  const gfx = scene?.metadata?.ashwood?.gfx;
  if (gfx?.foliageCfg) return gfx.foliageCfg;
  const tier = scene?.metadata?.ashwood?.qualityTier;
  return FOLIAGE_LEVELS[defaultsForTier(tier ?? 'high').foliage] ?? FOLIAGE_LEVELS.full;
}

/** Terrain detail level → the key in terrainMaterial's TERRAIN_TIERS. */
export const TERRAIN_DETAIL_TO_TIER = Object.freeze({
  high: 'high', medium: 'low', low: 'mobile',
});

/**
 * Apply a fog density write through the player's fog setting.
 *
 * scene.fogDensity is rewritten every frame by AshwoodSky and reassigned again
 * at zone transitions, so a one-shot write from the settings panel would be
 * clobbered within a frame. Every writer goes through here instead.
 *
 * At scale 0 the fog MODE is switched off too — a density of 0 still pays for
 * the fog term in every fragment shader.
 */
export function writeFogDensity(scene, base) {
  if (!scene) return;
  const scale = scene.metadata?.ashwood?.gfx?.fogScale ?? 1;
  scene.fogDensity = base * scale;
  const FOGMODE_NONE = 0;   // BABYLON.Scene.FOGMODE_NONE
  const FOGMODE_EXP2 = 3;   // BABYLON.Scene.FOGMODE_EXP2
  const wanted = scale > 0 ? FOGMODE_EXP2 : FOGMODE_NONE;
  if (scene.fogMode !== wanted) scene.fogMode = wanted;
}

// ── Tier detection ───────────────────────────────────────────────────────────

/**
 * The GPU heuristic, extracted from BabylonWorldScene so the hub can show the
 * player which tier they are about to enter at WITHOUT constructing an engine.
 *
 * WebGL2 feature checks alone can't tell an RTX card from an Intel iGPU or a
 * software rasterizer — they all report the same caps — so the renderer string
 * is sniffed too. When the browser masks the string this is a no-op and the
 * context-loss watchdog is the fallback safety net.
 *
 * @param {{isMobile:boolean, gpuRenderer:string|null, canHeavy:boolean}} probe
 */
export function tierFromProbe({ isMobile, gpuRenderer, canHeavy }) {
  if (isMobile) return 'mobile';
  const r = (gpuRenderer ?? '').toLowerCase();
  const isSoftware = /swiftshader|llvmpipe|softpipe|basic render|microsoft basic|software|paravirtual/.test(r);
  // Shared-memory Intel integrated graphics (the UHD/HD line) can't sustain
  // SSAO2 + cascaded shadows + the heavy terrain shader together. Iris Xe / Arc
  // and discrete GPUs don't match and keep 'high'.
  const isWeakIntegrated = /intel.*\b(uhd|hd)\s*graphics/.test(r);

  let tier = 'high';
  if (!canHeavy || isWeakIntegrated) tier = 'low';
  if (isSoftware) tier = 'mobile';
  return tier;
}

const TIER_LADDER = Object.freeze(['high', 'low', 'mobile']);

/** Step a tier down once per safe level (see the ladder comment above). */
export function applySafeStepDown(baseTier, safeLevel = 0) {
  const i = TIER_LADDER.indexOf(baseTier);
  if (i < 0) return baseTier;
  return TIER_LADDER[Math.min(TIER_LADDER.length - 1, i + Math.max(0, safeLevel ?? 0))];
}

/**
 * Resolve the tier the way the scene will, given a capability probe. Shared by
 * BabylonWorldScene (probe from the live engine) and the hub (probe from a
 * throwaway context), so the two can never disagree about what the player is
 * about to get.
 */
export function resolveTier(probe) {
  const safeLevel = probe.safeLevel ?? loadSafeLevel();
  if (probe.isMobile) return 'mobile';
  const pref = probe.qualityPref ?? loadQualityPref();
  const base = pref !== 'auto' ? PREF_TO_TIER[pref] : tierFromProbe(probe);
  return applySafeStepDown(base, safeLevel);
}

/**
 * Probe the device without an engine: a throwaway WebGL2 context, read for its
 * renderer string and float-render support, then discarded. Used by the hub.
 *
 * @returns {{tier:string, gpuRenderer:string|null, isMobile:boolean}}
 */
export function probeDevice() {
  const isMobile = typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  let gpuRenderer = null;
  let canHeavy = false;

  if (!isMobile && typeof document !== 'undefined') {
    let gl = null;
    try {
      const canvas = document.createElement('canvas');
      // Ask for the SAME GPU the engine will. BabylonWorldScene._createEngine
      // requests powerPreference 'high-performance' on desktop; without it here,
      // a switchable-graphics laptop hands the probe its INTEGRATED GPU, so the
      // hub would sniff an iGPU renderer string, predict a lower tier and pin a
      // lower ceiling than the world actually runs on. Mobile has one GPU, so
      // the hint buys nothing and is omitted there — matching _createEngine.
      gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' });
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) gpuRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? null;
        // drawBuffers is core in WebGL2; the float/half-float RENDER targets
        // SSAO2 and the HDR pipeline need are the extensions.
        canHeavy = !!(gl.getExtension('EXT_color_buffer_half_float') ||
                      gl.getExtension('EXT_color_buffer_float'));
      }
    } catch { /* probe is best-effort — fall through to the conservative read */ }
    finally {
      // Release the context immediately. Browsers cap simultaneous WebGL
      // contexts (~16), and the hub can be opened repeatedly without ever
      // entering the world; leaking one per visit would eventually starve the
      // real engine.
      try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
    }
  }

  const safeLevel = loadSafeLevel();
  return {
    tier: resolveTier({ isMobile, gpuRenderer, canHeavy, safeLevel }),
    gpuRenderer,
    isMobile,
    safeLevel,
  };
}

// ── Boot sentinel ────────────────────────────────────────────────────────────
// A flag raised when scene construction starts and lowered on the first rendered
// frame. If it is still raised the next time the hub opens, the previous attempt
// never reached a frame — a GPU hang, an OOM, or a throw — and the hub offers to
// enter in a lighter configuration.
//
// Advisory only, never blocking: a player who simply closed the tab mid-load
// trips it too, and the cost of a false positive is one dismissible banner.

export function markBootStarted() { patchGfxPrefs({ bootPending: true }); }
export function markBootSucceeded() { patchGfxPrefs({ bootPending: false }); }
export function didLastBootFail() { return loadGfxPrefs().bootPending === true; }

/**
 * The configuration the hub's "Start in Safe Mode" button writes: the lightest
 * preset, no shadows, and a reduced render resolution. Deliberately does not
 * touch safeLevel — that number means "this machine lost its context", and a
 * player choosing safe mode has not made that true.
 */
export function applySafeModePreset() {
  saveQualityPref('low');
  saveSettingOverride('shadows', 'off');
  saveSettingOverride('renderScale', 'threeQuarter');
  saveSettingOverride('reflections', 'off');
  saveSettingOverride('volumetricClouds', 'off');
}

/**
 * Full escape hatch: clear the preset, every override, the legacy booleans and
 * the safe ladder. Deliberately rebuilt from a bare object rather than spread
 * over the old one — this is the one call that must leave nothing behind, and a
 * spread silently preserves any key a future version adds.
 */
export function resetGraphicsPrefs() {
  const { bootPending } = loadGfxPrefs();
  saveGfxPrefs({ qualityPref: 'auto', safeLevel: 0, settings: {}, bootPending: !!bootPending });
}
