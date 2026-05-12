/**
 * BabylonWorldScene — 3D multiplayer world renderer.
 *
 * Babylon.js is loaded as a bundled npm package by WorldGame.jsx (sets window.BABYLON).
 * This file references only the global — no direct babylonjs imports.
 *
 * Coordinate mapping (SpacetimeDB pixel-space <-> 3D world units):
 *   STDB center = 1600 px  ->  3D origin = (0, 0, 0)
 *   1 world unit = 32 STDB px
 *
 * Character rendering is fully delegated to CharacterAvatar + AssetLibrary.
 * Box-primitive fallback is used automatically when GLB assets are absent.
 */

/* global BABYLON */

import { AssetLibrary }    from './AssetLibrary.js';
import { MobAssetLibrary } from './MobAssetLibrary.js';
import { CharacterAvatar } from './CharacterAvatar.js';
import { mergeConfig }     from './avatarSchema.js';
import {
  TileLoader,
  GlbTileProvider,
  ProceduralTileProvider,
  FallbackTileProvider,
  buildTileIndex,
  streamingParams,
} from '../streaming/index.js';
// Direct JSON import: keeps ajv out of the world-runtime bundle. Schema
// validation runs in CI via src/features/world/config/validators.js.
import worldBuildConfig from '../config/world_build_config.json' with { type: 'json' };

// ── Coordinate helpers ──────────────────────────────────────────────────────
const SCALE       = 32;
const STDB_CENTER = 1600;

function toWorld(v) { return (v - STDB_CENTER) / SCALE; }
function toStdb(v)  { return Math.round(v * SCALE + STDB_CENTER); }

// SpacetimeDB `Identity` is a class instance, not a primitive — every callback
// constructs a fresh instance for the same logical player, so using the raw
// object as a Map/Set key (reference equality) caused duplicate spawns and a
// dead-end `=== this._myIdentity` check that never matched. Canonicalize to
// hex on every key/comparison boundary.
function idKey(id) {
  if (!id) return '';
  return typeof id.toHexString === 'function' ? id.toHexString() : String(id);
}

// ── Math helpers ────────────────────────────────────────────────────────────
const clamp01    = (v) => Math.max(0, Math.min(1, v));
const lerp       = (a, b, t) => a + (b - a) * t;
const lerpColor3 = (a, b, t) => new BABYLON.Color3(
  lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t)
);
function lerpColor3Into(out, a, b, t) {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
}

// ── Class colours (built at call-time after BABYLON is on window) ────────────
function classColor(ct) {
  const map = {
    warrior: new BABYLON.Color3(0.85, 0.12, 0.12),
    mage:    new BABYLON.Color3(0.50, 0.10, 0.88),
    archer:  new BABYLON.Color3(0.10, 0.72, 0.20),
    rogue:   new BABYLON.Color3(0.90, 0.58, 0.05),
  };
  return map[ct] ?? new BABYLON.Color3(0.35, 0.55, 1.0);
}

// ── LightingManager ──────────────────────────────────────────────────────────
// Owns all lighting, day/night cycle, zone transitions, and render pipelines.
// Registered on scene.onBeforeRenderObservable — no per-frame calls needed
// from the outside.

class LightingManager {
  /**
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.Camera} camera
   * @param {BABYLON.Engine} engine
   * @param {object} options
   */
  constructor(scene, camera, engine, options = {}) {
    this.scene  = scene;
    this.camera = camera;
    this.engine = engine;

    this._isMobile = options.isMobile ?? false;

    this.options = {
      dayLengthSec:  options.dayLengthSec  ?? 900,
      startTimeOfDay: options.startTimeOfDay ?? 9.0,
      env: {
        overworldDay:   options.env?.overworldDay   ?? '/env/overworld_day.env',
        overworldNight: options.env?.overworldNight ?? '/env/overworld_night.env',
        dungeon:        options.env?.dungeon        ?? '/env/dungeon_dim.env',
      },
      maxDungeonTorches:      options.maxDungeonTorches      ?? 12,
      maxDungeonMagicAccents: options.maxDungeonMagicAccents ?? 10,
    };

    this.profile    = 'overworld'; // 'overworld' | 'dungeon'
    this.combatMode = false;
    this.timeOfDay  = this.options.startTimeOfDay;
    this._hoursPerSec = 24 / this.options.dayLengthSec;

    this._transition = null; // { from, to, duration, elapsed }
    this._disposed   = false;

    // Pre-allocated scratch objects — prevents ~13 GC-able allocations per frame
    this._scratchDir   = new BABYLON.Vector3();
    this._scratchColor = new BABYLON.Color3();
    this._nightDiffuse = new BABYLON.Color3(1.0, 0.72, 0.48);
    this._dayDiffuse   = new BABYLON.Color3(1.0, 0.97, 0.92);
    this._nightGround  = new BABYLON.Color3(0.10, 0.12, 0.18);
    this._dayGround    = new BABYLON.Color3(0.34, 0.36, 0.40);
    this._nightFog     = new BABYLON.Color3(0.06, 0.08, 0.12);
    this._dayFog       = new BABYLON.Color3(0.62, 0.78, 0.94);  // bluer, less wash
    this._nightSky     = new BABYLON.Color3(0.06, 0.08, 0.18);
    this._daySky       = new BABYLON.Color3(0.32, 0.58, 0.92);  // more saturated daytime sky
    this._dungeonFog   = new BABYLON.Color3(0.06, 0.07, 0.085);

    this._setupCore();
    this._setupOverworldRig();
    this._setupDungeonRig();
    this._setupPipelines();

    this._setActiveProfileImmediate('overworld');
    this._observer = this.scene.onBeforeRenderObservable.add(() => this._update());
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setZone(zone, transitionSec = 1.25) {
    if (zone !== 'overworld' && zone !== 'dungeon') {
      console.warn(`[LightingManager] Unknown zone "${zone}"`);
      return;
    }
    if (zone === this.profile && !this._transition) return;

    this._transition = {
      from:     this.profile,
      to:       zone,
      duration: Math.max(0.01, transitionSec),
      elapsed:  0,
    };
  }

  setCombatMode(enabled) { this.combatMode = !!enabled; }

  setTimeOfDay(hours24) { this.timeOfDay = ((hours24 % 24) + 24) % 24; }

  addDungeonTorch(position, opts = {}) {
    if (this._dungeonTorches.length >= this.options.maxDungeonTorches) {
      console.warn('[LightingManager] Torch cap reached');
      return null;
    }
    const torch = this._createTorchLight(position, opts);
    this._dungeonTorches.push(torch);
    return torch;
  }

  addDungeonMagicAccent(position, opts = {}) {
    if (this._dungeonMagic.length >= this.options.maxDungeonMagicAccents) {
      console.warn('[LightingManager] Magic accent cap reached');
      return null;
    }
    const accent = this._createMagicAccent(position, opts);
    this._dungeonMagic.push(accent);
    return accent;
  }

  clearDungeonLocalLights() {
    for (const l of this._dungeonTorches) l.dispose();
    for (const l of this._dungeonMagic)   l.dispose();
    this._dungeonTorches.length = 0;
    this._dungeonMagic.length   = 0;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    if (this._observer) {
      this.scene.onBeforeRenderObservable.remove(this._observer);
      this._observer = null;
    }

    this.clearDungeonLocalLights();

    [
      this.key, this.moon, this.fillOverworld,
      this.fillDungeon, this.bounceDungeon, this.rimCombat,
    ].forEach(l => l?.dispose());

    this._disposePipeline(this.pipeOverworld);
    this._disposePipeline(this.pipeDungeon);
    this._imagePP?.dispose();
    this._glowLayer?.dispose();

    [this.envDay, this.envNight, this.envDungeon].forEach(t => t?.dispose());

    if (this.skybox) this.skybox.dispose();
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  _setupCore() {
    this.scene.imageProcessingConfiguration.toneMappingEnabled = true;
    // KHR PBR Neutral preserves color saturation in midtones, where ACES
    // visibly desaturated the sky (read as grey-white instead of blue) and
    // ground (read as olive-grey instead of green). Both maps cost the same
    // per pixel.
    this.scene.imageProcessingConfiguration.toneMappingType =
      BABYLON.ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;

    this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;

    // Replace the near-black scene default with a visible sky colour right
    // away. This shows through until the env-based skybox loads; if the
    // .env files are absent it stays as the permanent background and is
    // animated per-frame in _updateOverworld / _updateDungeon.
    this.scene.clearColor = new BABYLON.Color4(0.42, 0.58, 0.78, 1);

    // Env textures loaded asynchronously with a HEAD/content-type guard so
    // missing files (or the Vite SPA HTML fallback) don't produce
    // "Not a babylon environment map" errors on startup.
    this.envDay     = null;
    this.envNight   = null;
    this.envDungeon = null;
    this.skybox     = null;

    this._loadEnvSafe(this.options.env.overworldDay).then(t => {
      if (!t || this._disposed) return;
      this.envDay = t;
      if (this.profile === 'overworld' && !this._transition) {
        this._setEnvironment(t, this.scene.environmentIntensity || 0.9);
        if (!this.skybox) this.skybox = this.scene.createDefaultSkybox(t, true, 1500, 0.35);
      }
    });
    this._loadEnvSafe(this.options.env.overworldNight).then(t => {
      if (t && !this._disposed) this.envNight = t;
    });
    this._loadEnvSafe(this.options.env.dungeon).then(t => {
      if (t && !this._disposed) this.envDungeon = t;
    });

    this._dungeonTorches = [];
    this._dungeonMagic   = [];
  }

  _setupOverworldRig() {
    this.key = new BABYLON.DirectionalLight('lm_key', new BABYLON.Vector3(-0.6, -1, -0.35), this.scene);
    this.key.position  = new BABYLON.Vector3(12, 20, 8);
    this.key.intensity = 2.2;

    this.moon = new BABYLON.DirectionalLight('lm_moon', new BABYLON.Vector3(0.3, -1, 0.2), this.scene);
    this.moon.diffuse  = new BABYLON.Color3(0.55, 0.62, 0.9);
    this.moon.specular = new BABYLON.Color3(0.25, 0.3, 0.45);
    this.moon.intensity = 0.0;

    this.fillOverworld = new BABYLON.HemisphericLight('lm_fill_overworld', new BABYLON.Vector3(0, 1, 0), this.scene);
    this.fillOverworld.intensity   = 0.35;
    this.fillOverworld.groundColor = new BABYLON.Color3(0.2, 0.22, 0.25);
  }

  _setupDungeonRig() {
    this.fillDungeon = new BABYLON.HemisphericLight('lm_fill_dungeon', new BABYLON.Vector3(0, 1, 0), this.scene);
    this.fillDungeon.intensity   = 0.12;
    this.fillDungeon.diffuse     = new BABYLON.Color3(0.24, 0.27, 0.32);
    this.fillDungeon.groundColor = new BABYLON.Color3(0.06, 0.05, 0.05);

    this.bounceDungeon = new BABYLON.DirectionalLight('lm_bounce_dungeon', new BABYLON.Vector3(0.3, -1, 0.1), this.scene);
    this.bounceDungeon.intensity = 0.25;
    this.bounceDungeon.diffuse   = new BABYLON.Color3(0.34, 0.36, 0.42);

    this.rimCombat = new BABYLON.PointLight('lm_rim_combat', new BABYLON.Vector3(0, 2.2, -2.5), this.scene);
    this.rimCombat.diffuse   = new BABYLON.Color3(0.6, 0.66, 0.95);
    this.rimCombat.range     = 12;
    this.rimCombat.intensity = 0;
  }

  _setupPipelines() {
    this._noPipeline = true;
    this._imagePP    = null;
    this._glowLayer  = null;

    // DefaultRenderingPipeline is desktop-only. On mobile WebGL2 it may succeed
    // in construction (no exception) but produce a black render at frame time
    // due to missing half-float / float render-target extensions. Skip it
    // entirely on mobile and go straight to the lightweight fallback path.
    if (!this._isMobile) {
      // High bloom threshold + low weight so daylight scene surfaces don't
      // trigger bloom — only intentional emissives (portal, magic accents)
      // pass the threshold. The earlier 0.88 threshold was lifted from a
      // pre-PR tuning that assumed HDR + IBL; without IBL it bloomed the
      // entire sky and character at midday.
      this.pipeOverworld = this._tryBuildPipeline('lm_overworld_pipe', {
        bloomThreshold: 1.20, bloomWeight: 0.12, bloomScale: 0.5,
      });
      this.pipeDungeon = this._tryBuildPipeline('lm_dungeon_pipe', {
        bloomThreshold: 0.95, bloomWeight: 0.25, bloomScale: 0.5,
      });
      this._noPipeline = !this.pipeOverworld && !this.pipeDungeon;
    } else {
      this.pipeOverworld = null;
      this.pipeDungeon   = null;
    }

    if (this._noPipeline) {
      // ImageProcessingPostProcess: attaches directly to the camera using only
      // standard 8-bit RGBA render targets (always supported on mobile WebGL2).
      // Inherits scene.imageProcessingConfiguration — gives us ACES tone-mapping,
      // exposure, and contrast without requiring any special GPU extensions.
      try {
        this._imagePP = new BABYLON.ImageProcessingPostProcess(
          'imgPP', 1.0, this.camera,
          BABYLON.Texture.BILINEAR_SAMPLINGMODE, this.engine, false,
          BABYLON.Constants.TEXTURETYPE_UNSIGNED_INT
        );
        this._noPipeline = false;
      } catch (_) { /* truly no post-processing */ }

      // GlowLayer: lightweight bloom using a downsampled 8-bit texture.
      // Works on all WebGL2 devices including mobile.
      try {
        this._glowLayer = new BABYLON.GlowLayer('glow', this.scene, {
          mainTextureFixedSize: 256,
          blurKernelSize: 16,
        });
        this._glowLayer.intensity = 0.4;
      } catch (_) { /* skip bloom */ }
    }

    // Ambient floor. The IBL .env files referenced by _loadEnvSafe
    // (overworld_day / overworld_night / dungeon_dim) are not in /public/env,
    // so scene.environmentTexture stays null on every device and the IBL fill
    // desktop used to rely on never arrives. Day value is set here; night
    // raises it dynamically in _updateOverworld so geometry stays readable.
    this.scene.ambientColor = new BABYLON.Color3(0.20, 0.22, 0.26);
  }

  // Try HDR pipeline first (best quality), fall back to non-HDR (mobile-safe),
  // return null only if both fail.
  _tryBuildPipeline(name, opts) {
    for (const hdr of [true, false]) {
      try {
        const p = new BABYLON.DefaultRenderingPipeline(name, hdr, this.scene, [this.camera]);
        // No MSAA — FXAA alone is ~10× cheaper on integrated GPUs and the
        // difference is imperceptible at the camera distances used here.
        p.samples        = 1;
        p.fxaaEnabled    = true;
        p.bloomEnabled   = true;
        p.bloomThreshold = opts.bloomThreshold;
        p.bloomWeight    = opts.bloomWeight;
        p.bloomKernel    = 16;            // halved — full pipeline cost
        p.bloomScale     = opts.bloomScale;
        p.sharpenEnabled = false;         // sharpen was a marginal-quality, full-cost pass
        return p;
      } catch (_) { /* try next tier */ }
    }
    return null;
  }

  _loadEnvSafe(url) {
    return fetch(url, { method: 'HEAD' })
      .then(r => {
        const ct = r.headers.get('content-type') ?? '';
        if (!r.ok || ct.includes('text/html')) return null;
        return BABYLON.CubeTexture.CreateFromPrefilteredData(url, this.scene);
      })
      .catch(() => null);
  }

  // ── Frame update ──────────────────────────────────────────────────────────

  _update() {
    const dt = this.engine.getDeltaTime() / 1000;

    if (this._transition) {
      this._transition.elapsed += dt;
      const t = clamp01(this._transition.elapsed / this._transition.duration);
      if (t >= 1) {
        this._setActiveProfileImmediate(this._transition.to);
        this._transition = null;
      } else {
        this._blendProfiles(this._transition.from, this._transition.to, t);
      }
    } else {
      if (this.profile === 'overworld') this._updateOverworld(dt);
      else                               this._updateDungeon();
    }

    this._updateCombatRim();
  }

  _updateOverworld(dt) {
    this.timeOfDay = (this.timeOfDay + dt * this._hoursPerSec) % 24;

    const phase    = this.timeOfDay / 24;
    const sunTheta = phase * Math.PI * 2 - Math.PI / 2;

    // Reuse pre-allocated scratch Vector3 — avoids one new Vector3 per frame
    this._scratchDir.set(
      Math.cos(sunTheta) * 0.35,
      -Math.sin(sunTheta),
       Math.sin(sunTheta) * 0.65
    );
    this._scratchDir.normalize();
    this.key.direction.copyFrom(this._scratchDir);
    this._scratchDir.scaleInPlace(-1);
    this.moon.direction.copyFrom(this._scratchDir);

    const sunHeight = -this.key.direction.y;
    const dayFactor = clamp01((sunHeight + 0.08) / 0.22);
    const sunset    = clamp01(1 - Math.abs(sunHeight) / 0.22) * dayFactor;

    // Daytime key intensity dropped from 2.4 → 1.4. Combined with the missing
    // IBL contribution (env textures aren't shipped), 2.4 was over-saturating
    // PBR characters and pushing surface luminance past the bloom threshold.
    this.key.intensity = lerp(0.05, 1.4, dayFactor);
    lerpColor3Into(this.key.diffuse, this._nightDiffuse, this._dayDiffuse, clamp01(dayFactor * 1.25));
    this.moon.intensity = lerp(0.0, 0.40, 1.0 - dayFactor);

    // Unified curve for desktop and mobile. Cut across the board from the
    // previous pass — at midday the scene was reading "insanely bright"
    // because key + fill + ambient + exposure were all near their max
    // simultaneously, stacking into ~saturated luminance on lit surfaces.
    this.fillOverworld.intensity = lerp(0.28, 0.38, dayFactor);
    lerpColor3Into(this.fillOverworld.groundColor, this._nightGround, this._dayGround, dayFactor);

    this.scene.imageProcessingConfiguration.exposure = lerp(0.85, 1.00, dayFactor);
    this.scene.imageProcessingConfiguration.contrast = lerp(1.03, 1.10, sunset);

    this.scene.fogDensity = lerp(0.0022, 0.0016, dayFactor);
    lerpColor3Into(this.scene.fogColor, this._nightFog, this._dayFog, dayFactor);

    // Dynamic ambient: raise at night to keep geometry readable when the key
    // is dim; keep day-side low so the directional light still defines form.
    this.scene.ambientColor.copyFromFloats(
      lerp(0.30, 0.20, dayFactor),
      lerp(0.33, 0.22, dayFactor),
      lerp(0.40, 0.26, dayFactor)
    );

    // Sky background — mutate clearColor in-place via scratch to avoid allocation
    lerpColor3Into(this._scratchColor, this._nightSky, this._daySky, dayFactor);
    this.scene.clearColor.r = this._scratchColor.r;
    this.scene.clearColor.g = this._scratchColor.g;
    this.scene.clearColor.b = this._scratchColor.b;

    if (dayFactor > 0.5) {
      this._setEnvironment(this.envDay,   lerp(0.35, 0.95, dayFactor));
    } else {
      this._setEnvironment(this.envNight, lerp(0.25, 0.50, dayFactor));
    }
  }

  _updateDungeon() {
    // Zero key intensity — bounceDungeon owns the directional look.
    // key stays *enabled* so ShadowGenerator keeps casting shadows.
    this.key.intensity = 0;

    this.scene.imageProcessingConfiguration.exposure = 0.98;
    this.scene.imageProcessingConfiguration.contrast = 1.12;

    this.scene.fogDensity = 0.018;
    this.scene.fogColor.copyFrom(this._dungeonFog);

    this._setEnvironment(this.envDungeon, 0.35);
  }

  _updateCombatRim() {
    if (!this.combatMode) { this.rimCombat.intensity = 0; return; }
    const target = this.camera.getTarget ? this.camera.getTarget() : BABYLON.Vector3.Zero();
    const camPos = this.camera.globalPosition ?? this.camera.position ?? new BABYLON.Vector3(0, 2, -4);
    const backDir = target.subtract(camPos).normalize().scale(-1);
    this.rimCombat.position.copyFrom(
      target.add(backDir.scale(2.5)).add(new BABYLON.Vector3(0, 1.8, 0))
    );
    const profileMul = this.profile === 'dungeon' ? 1.15 : 1.0;
    this.rimCombat.intensity = 35 * profileMul;
  }

  // ── Profile switching ─────────────────────────────────────────────────────

  _setActiveProfileImmediate(profile) {
    this.profile = profile;
    const overworld = profile === 'overworld';

    // key stays enabled in both profiles — it is the ShadowGenerator source.
    // In dungeon, _updateDungeon() zeroes its intensity instead.
    this.key.setEnabled(true);
    this.moon.setEnabled(overworld);
    this.fillOverworld.setEnabled(overworld);

    this.fillDungeon.setEnabled(!overworld);
    this.bounceDungeon.setEnabled(!overworld);

    this._setPipelineEnabled(this.pipeOverworld, overworld);
    this._setPipelineEnabled(this.pipeDungeon,  !overworld);

    for (const l of this._dungeonTorches) l.setEnabled(!overworld);
    for (const l of this._dungeonMagic)   l.setEnabled(!overworld);

    if (overworld) this._updateOverworld(0);
    else           this._updateDungeon();
  }

  _blendProfiles(from, to, t) {
    this.key.setEnabled(true);
    this.moon.setEnabled(true);
    this.fillOverworld.setEnabled(true);
    this.fillDungeon.setEnabled(true);
    this.bounceDungeon.setEnabled(true);

    const prevProfile = this.profile;

    this.profile = from;
    if (from === 'overworld') this._updateOverworld(0);
    else                       this._updateDungeon();
    const fromState = this._captureState();

    this.profile = to;
    if (to === 'overworld') this._updateOverworld(0);
    else                     this._updateDungeon();
    const toState = this._captureState();

    this.profile = prevProfile;

    this.scene.imageProcessingConfiguration.exposure = lerp(fromState.exposure, toState.exposure, t);
    this.scene.imageProcessingConfiguration.contrast = lerp(fromState.contrast, toState.contrast, t);
    this.scene.fogDensity          = lerp(fromState.fogDensity, toState.fogDensity, t);
    this.scene.fogColor            = lerpColor3(fromState.fogColor, toState.fogColor, t);
    this.scene.environmentIntensity = lerp(fromState.envIntensity, toState.envIntensity, t);

    const half = t > 0.5;
    this._setEnvironment(half ? toState.envTex : fromState.envTex, this.scene.environmentIntensity);
    this._setPipelineEnabled(this.pipeOverworld, (half ? to : from) === 'overworld');
    this._setPipelineEnabled(this.pipeDungeon,   (half ? to : from) === 'dungeon');

    this.fillOverworld.intensity = lerp(fromState.fillOverworldI, toState.fillOverworldI, t);
    this.fillDungeon.intensity   = lerp(fromState.fillDungeonI,   toState.fillDungeonI,   t);
    this.key.intensity           = lerp(fromState.keyIntensity,   toState.keyIntensity,   t);

    const dungeonActive = (half ? to : from) === 'dungeon';
    for (const l of this._dungeonTorches) l.setEnabled(dungeonActive);
    for (const l of this._dungeonMagic)   l.setEnabled(dungeonActive);
  }

  _captureState() {
    return {
      exposure:      this.scene.imageProcessingConfiguration.exposure,
      contrast:      this.scene.imageProcessingConfiguration.contrast,
      fogDensity:    this.scene.fogDensity,
      fogColor:      this.scene.fogColor.clone(),
      envIntensity:  this.scene.environmentIntensity,
      envTex:        this.scene.environmentTexture,
      fillOverworldI: this.fillOverworld.intensity,
      fillDungeonI:   this.fillDungeon.intensity,
      keyIntensity:   this.key.intensity,
    };
  }

  // ── Dungeon local lights ──────────────────────────────────────────────────

  _createTorchLight(position, opts = {}) {
    const color        = opts.color        ?? new BABYLON.Color3(1.0, 0.58, 0.22);
    const intensity    = opts.intensity    ?? 35;
    const range        = opts.range        ?? 11;
    const flickerSpeed  = opts.flickerSpeed  ?? 8.0;
    const flickerAmount = opts.flickerAmount ?? 0.18;

    const light = new BABYLON.PointLight(opts.name ?? 'torch', position.clone(), this.scene);
    light.diffuse   = color;
    light.specular  = new BABYLON.Color3(0.12, 0.08, 0.04);
    light.intensity = intensity;
    light.range     = range;
    light.setEnabled(this.profile === 'dungeon');

    const phase = Math.random() * Math.PI * 2;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      if (!light.isEnabled()) return;
      const t = performance.now() * 0.001;
      const noise =
        Math.sin(t * flickerSpeed         + phase)       * 0.6 +
        Math.sin(t * flickerSpeed * 2.37  + phase * 1.7) * 0.4;
      light.intensity = intensity * (1 + noise * flickerAmount);
    });
    light.onDisposeObservable.add(() => this.scene.onBeforeRenderObservable.remove(obs));

    return light;
  }

  _createMagicAccent(position, opts = {}) {
    const color       = opts.color       ?? new BABYLON.Color3(0.35, 0.55, 1.0);
    const intensity   = opts.intensity   ?? 22;
    const range       = opts.range       ?? 8;
    const pulseSpeed  = opts.pulseSpeed  ?? 2.0;
    const pulseAmount = opts.pulseAmount ?? 0.15;

    const light = new BABYLON.PointLight(opts.name ?? 'magicAccent', position.clone(), this.scene);
    light.diffuse   = color;
    light.specular  = color.scale(0.5);
    light.intensity = intensity;
    light.range     = range;
    light.setEnabled(this.profile === 'dungeon');

    const phase = Math.random() * Math.PI * 2;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      if (!light.isEnabled()) return;
      const t = performance.now() * 0.001;
      light.intensity = intensity * (1 + Math.sin(t * pulseSpeed + phase) * pulseAmount);
    });
    light.onDisposeObservable.add(() => this.scene.onBeforeRenderObservable.remove(obs));

    return light;
  }

  // ── Utils ─────────────────────────────────────────────────────────────────

  _setEnvironment(envTex, intensity) {
    if (!envTex) return; // still loading or file unavailable — skip cleanly
    if (this.scene.environmentTexture !== envTex) {
      this.scene.environmentTexture = envTex;
      if (this.skybox?.material?.reflectionTexture) {
        this.skybox.material.reflectionTexture = envTex;
      }
    }
    this.scene.environmentIntensity = intensity;
  }

  _setPipelineEnabled(pipe, enabled) {
    if (!pipe) return;
    if (typeof pipe.setEnabled === 'function') pipe.setEnabled(enabled);
  }
  _disposePipeline(pipe) { if (pipe) pipe.dispose(); }
}

// ── Dungeon entrance constants ───────────────────────────────────────────────
const DUNGEON_ENTRANCE      = Object.freeze({ x: 0, z: -37 });
const DUNGEON_ENTER_DIST_SQ = 3.5 * 3.5;
const DUNGEON_EXIT_DIST_SQ  = 5.5 * 5.5; // hysteresis band prevents rapid toggling

// ── Main export ──────────────────────────────────────────────────────────────
export class BabylonWorldScene {
  constructor(canvas, playerInfo, callbacks) {
    this.canvas      = canvas;
    this.playerInfo  = playerInfo;
    this.callbacks   = callbacks;

    this._remotePlayers = new Map();
    this._mobs          = new Map(); // mobId(BigInt) -> { root, body, head, hpFill, hpBar, lastHp, maxHp, dead }
    this._lastAttackAt  = 0;          // ms timestamp; throttles spacebar
    this._myIdentity    = null;
    this._keys          = {};
    this._lastPos       = { x: 0, z: 0 };
    this._lastMoving    = false;
    this._lastSentAt    = 0;
    this._chatOpen      = false;
    this._inDungeon     = false;
    this._local         = null;
    this._pendingUpdates    = []; // remote rows queued while _local is loading
    this._pendingMobUpdates = []; // mob rows queued while MobAssetLibrary is loading
    this._spawning          = new Set(); // identity IDs currently being async-spawned

    // Mobile touch state — written by setJoystick() from WorldGame's React layer
    this._joyDx = 0;
    this._joyDy = 0;
    // Camera drag touch (right-half of screen, managed internally)
    this._camTouch = null; // { id, lastX, lastY }

    // Pre-allocated movement scratch vectors — avoids 4 allocations per frame
    this._moveFwd   = new BABYLON.Vector3();
    this._moveRight = new BABYLON.Vector3();
    this._moveDir   = new BABYLON.Vector3();
    this._camTarget = new BABYLON.Vector3(0, 1.2, 0);

    this._isMobile = typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse)').matches;

    this._initSync();
    this._initCharactersAsync();
  }

  // ── Sync bootstrap (terrain, engine — no characters yet) ──────────────────

  _initSync() {
    this.engine = new BABYLON.Engine(this.canvas, true, {
      stencil: true,
      adaptToDeviceRatio: true,
    });

    // Desktop only: cap effective DPR. Uncapped, a 4K / Retina display renders
    // at native device-pixel-ratio (often 2× or higher), quadrupling per-frame
    // pixel work and tipping the HDR pipeline + shadow blur passes into
    // mid-teen fps on integrated GPUs. Mobile is left at the device DPR — it
    // already performs fine and capping there is a visible quality regression
    // (Codex P2 on #193).
    if (!this._isMobile) {
      const dpr = Math.min(
        (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
        1.5
      );
      this.engine.setHardwareScalingLevel(1 / dpr);
    }

    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.07, 0.10, 0.18, 1);

    // Camera must exist before LightingManager — its pipelines need a target
    this._setupCamera();

    // Pin the world to mid-morning until the full day/night lighting story
    // (incl. IBL .env files) ships. Wall-clock time was making the world
    // unplayably dark in the evening, and dayLengthSec=86400 meant the cycle
    // barely moved while you played. A slow 1h cycle starting at 10am keeps
    // typical sessions firmly in daylight while leaving the cycle code alive.
    this._lm = new LightingManager(this.scene, this._camera, this.engine, {
      isMobile: this._isMobile,
      startTimeOfDay: 10.0,
      dayLengthSec:   3600,
    });

    this._setupShadows();
    this._setupSSAO();

    this._setupTileStreaming();
    this._buildDungeonEntrance();
    this._bindKeys();

    // Render loop guards on _local until CharacterAvatar is ready
    this.engine.runRenderLoop(() => {
      if (this._local) this._tick();
      this.scene.render();
    });

    this._onResize = () => this.engine.resize();
    window.addEventListener('resize', this._onResize);
  }

  // ── Async character bootstrap ──────────────────────────────────────────────

  async _initCharactersAsync() {
    // Load both asset libraries in parallel — mob GLBs are not load-critical
    // (missing ones fall back to primitives), but starting their fetch here
    // means the first mob spawn doesn't pay a network roundtrip.
    await Promise.all([
      AssetLibrary.init(this.scene),
      MobAssetLibrary.init(this.scene),
    ]);
    this._local = await CharacterAvatar.create(
      'local',
      this.playerInfo?.username ?? 'You',
      this.playerInfo?.avatarConfig ?? null,
      this.scene,
      AssetLibrary
    );
    this._local.root.position.set(0, 0, 0);
    // Flush remote updates that arrived while we were loading.
    // Mobs first — they can spawn independently of `_local` once
    // MobAssetLibrary is ready, and we want them visible ASAP.
    const pendingMobs = this._pendingMobUpdates.splice(0);
    for (const row of pendingMobs) this.applyMobUpdate(row);
    const pending = this._pendingUpdates.splice(0);
    for (const row of pending) this.applyPlayerUpdate(row);
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  _setupCamera() {
    const cam = new BABYLON.ArcRotateCamera(
      'cam',
      -Math.PI / 2,  // alpha: behind player
      Math.PI / 3.5, // beta: ~51 deg elevation
      6.5,           // radius
      new BABYLON.Vector3(0, 1.2, 0),
      this.scene
    );
    cam.lowerRadiusLimit     = 2.5;
    cam.upperRadiusLimit     = 22;
    cam.lowerBetaLimit       = 0.25;
    cam.upperBetaLimit       = Math.PI / 2.1;
    cam.wheelPrecision       = 60;
    cam.wheelDeltaPercentage = 0.01;
    cam.panningSensibility   = 0;
    cam.minZ                 = 0.1;

    if (this._isMobile) {
      // On mobile we manage all pointer events manually so the left-half
      // joystick overlay and right-half camera drag don't conflict.
      this._bindTouchControls(cam);
    } else {
      cam.attachControl(this.canvas, true);
    }

    this._camera = cam;
  }

  // ── Mobile pointer controls ────────────────────────────────────────────────
  // Left half  → joystick (handled externally by WorldGame via setJoystick())
  // Right half → camera orbit (alpha / beta from drag delta)
  // Pinch on right half → zoom (radius)

  _bindTouchControls(cam) {
    const canvas = this.canvas;

    // Track a second touch for pinch-zoom
    this._pinchTouch = null; // { id, lastDist }

    const onDown = (e) => {
      const rect   = canvas.getBoundingClientRect();
      const cx     = e.clientX - rect.left;
      const isRight = cx >= rect.width / 2;

      if (isRight) {
        if (!this._camTouch && !this._pinchTouch) {
          this._camTouch = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
        } else if (this._camTouch && !this._pinchTouch) {
          // Second finger on right = start pinch
          const dx = e.clientX - this._camTouch.lastX;
          const dy = e.clientY - this._camTouch.lastY;
          this._pinchTouch = {
            id: e.pointerId,
            lastDist: Math.hypot(dx, dy),
          };
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
        }
      }
      // Left-half touches are captured by the React joystick overlay,
      // so they never reach the canvas.
    };

    const onMove = (e) => {
      if (this._camTouch && e.pointerId === this._camTouch.id) {
        if (!this._pinchTouch) {
          const dx = e.clientX - this._camTouch.lastX;
          const dy = e.clientY - this._camTouch.lastY;
          cam.alpha -= dx * 0.006;
          cam.beta   = Math.max(cam.lowerBetaLimit,
                       Math.min(cam.upperBetaLimit, cam.beta + dy * 0.006));
        }
        this._camTouch.lastX = e.clientX;
        this._camTouch.lastY = e.clientY;
        e.preventDefault();
      } else if (this._pinchTouch && e.pointerId === this._pinchTouch.id) {
        const dx   = e.clientX - this._camTouch.lastX;
        const dy   = e.clientY - this._camTouch.lastY;
        const dist = Math.hypot(dx, dy);
        const delta = this._pinchTouch.lastDist - dist;
        cam.radius = Math.max(cam.lowerRadiusLimit,
                     Math.min(cam.upperRadiusLimit, cam.radius + delta * 0.05));
        this._pinchTouch.lastDist = dist;
        e.preventDefault();
      }
    };

    const onUp = (e) => {
      if (this._camTouch && e.pointerId === this._camTouch.id) {
        this._camTouch  = null;
        this._pinchTouch = null;
        e.preventDefault();
      } else if (this._pinchTouch && e.pointerId === this._pinchTouch.id) {
        this._pinchTouch = null;
        e.preventDefault();
      }
    };

    canvas.addEventListener('pointerdown',   onDown, { passive: false });
    canvas.addEventListener('pointermove',   onMove, { passive: false });
    canvas.addEventListener('pointerup',     onUp,   { passive: false });
    canvas.addEventListener('pointercancel', onUp,   { passive: false });

    this._touchCleanup = () => {
      canvas.removeEventListener('pointerdown',   onDown, { passive: false });
      canvas.removeEventListener('pointermove',   onMove, { passive: false });
      canvas.removeEventListener('pointerup',     onUp,   { passive: false });
      canvas.removeEventListener('pointercancel', onUp,   { passive: false });
    };
  }

  // Called by WorldGame's React joystick overlay each frame
  setJoystick(dx, dy) {
    this._joyDx = dx;
    this._joyDy = dy;
  }

  // ── Shadows ────────────────────────────────────────────────────────────────

  _setupShadows() {
    // Start at 1024 — 4× cheaper shadow pass vs 2048 with minimal visual difference.
    for (const size of [1024, 512]) {
      try {
        const sg = new BABYLON.ShadowGenerator(size, this._lm.key);
        sg.useBlurExponentialShadowMap = true;
        // Blur kernel halved — the previous 16-tap pass was the second-largest
        // per-frame GPU cost behind SSAO2. 8 taps is visually similar.
        sg.blurKernel = size >= 1024 ? 8 : 4;
        sg.bias       = 0.0005;
        sg.normalBias = 0.02;
        this._shadowGen = sg;
        return;
      } catch (_) { /* try smaller size */ }
    }
    this._shadowGen = null; // shadows unavailable — scene still renders
  }

  _castShadow(mesh) {
    if (this._shadowGen && mesh) this._shadowGen.addShadowCaster(mesh, true);
  }

  // ── SSAO ───────────────────────────────────────────────────────────────────

  _setupSSAO() {
    // SSAO2 is currently disabled. Combined with the HDR DefaultRenderingPipeline
    // and blur-ESM shadows it was the dominant per-frame GPU cost on integrated
    // GPUs, and the visual contribution at the camera angles used here is
    // marginal. Re-enabling is a single early-return removal once we have
    // budget to retune it.
    return;
  }

  // ── Lighting profile (public compatibility wrapper) ────────────────────────

  setLightingProfile(profile) {
    const zone = profile === 'dungeon' ? 'dungeon' : 'overworld';
    this._inDungeon = zone === 'dungeon';
    this._lm.setZone(zone);
  }

  // ── Dungeon proximity trigger ──────────────────────────────────────────────

  _checkDungeonProximity() {
    if (!this._local) return;
    const { x, z } = this._local.root.position;
    const dx = x - DUNGEON_ENTRANCE.x;
    const dz = z - DUNGEON_ENTRANCE.z;
    const distSq = dx * dx + dz * dz;

    if (!this._inDungeon && distSq < DUNGEON_ENTER_DIST_SQ) {
      this._inDungeon = true;
      this._lm.setZone('dungeon', 1.25);
      this.callbacks.onZoneChange?.('dungeon');
    } else if (this._inDungeon && distSq > DUNGEON_EXIT_DIST_SQ) {
      this._inDungeon = false;
      this._lm.setZone('overworld', 1.25);
      this.callbacks.onZoneChange?.('overworld');
    }
  }

  // ── Tile streaming ─────────────────────────────────────────────────────────
  // World geometry comes from the tile streamer driven by
  // world_build_config.tiling_streaming. The primary GlbTileProvider loads
  // authored .glb tiles from /assets/tiles/. Any tile whose .glb isn't
  // present (404) falls back transparently to the ProceduralTileProvider,
  // which builds a deterministic grass/tree/rock scatter from tile_id using
  // the same RNG seed as the authored placeholders — so the boundary
  // between authored and procedural tiles is visually seamless.

  _setupTileStreaming() {
    const provider = new FallbackTileProvider(
      new GlbTileProvider(),
      new ProceduralTileProvider(worldBuildConfig),
    );
    const params = streamingParams(worldBuildConfig);
    const tileIndex = buildTileIndex(params, {
      render:   (id) => `/assets/tiles/${id}_render.glb`,
      gameplay: (id) => `/assets/tiles/${id}_gameplay.json`,
    });
    this._tileLoader = new TileLoader(this.scene, worldBuildConfig, tileIndex, provider);

    // Seed the initial ring synchronously enough to be visible on first frame.
    this._tileLoader.stream({ x: 0, z: 0 });
  }

  // ── Dungeon entrance ───────────────────────────────────────────────────────
  // Gate sits at the end of the north path (z = -37). Two stone pillars, a
  // lintel, and a faintly pulsing portal plane mark the trigger zone.

  _buildDungeonEntrance() {
    const { x, z } = DUNGEON_ENTRANCE;

    const stone = this._stdMat('dunGate', new BABYLON.Color3(0.32, 0.30, 0.38));

    // Pillars
    const pL = BABYLON.MeshBuilder.CreateBox('dunPillarL', { width: 0.9, height: 5.2, depth: 0.9 }, this.scene);
    pL.position.set(x - 2.1, 2.6, z);
    pL.material = stone;
    this._castShadow(pL);

    const pR = BABYLON.MeshBuilder.CreateBox('dunPillarR', { width: 0.9, height: 5.2, depth: 0.9 }, this.scene);
    pR.position.set(x + 2.1, 2.6, z);
    pR.material = stone;
    this._castShadow(pR);

    // Lintel
    const lintel = BABYLON.MeshBuilder.CreateBox('dunLintel', { width: 5.1, height: 0.75, depth: 0.9 }, this.scene);
    lintel.position.set(x, 5.575, z);
    lintel.material = stone;
    this._castShadow(lintel);

    // Portal plane — emissive, slightly transparent
    const portalMat = new BABYLON.StandardMaterial('dunPortalMat', this.scene);
    portalMat.diffuseColor    = new BABYLON.Color3(0.15, 0.10, 0.35);
    portalMat.emissiveColor   = new BABYLON.Color3(0.20, 0.10, 0.55);
    portalMat.alpha           = 0.45;
    portalMat.backFaceCulling = false;

    const portal = BABYLON.MeshBuilder.CreatePlane('dunPortal', { width: 3.3, height: 4.8 }, this.scene);
    portal.position.set(x, 2.6, z);
    portal.material = portalMat;

    // Pulsing accent light in the gateway
    const gLight = new BABYLON.PointLight('dunGateLight', new BABYLON.Vector3(x, 2.5, z), this.scene);
    gLight.diffuse   = new BABYLON.Color3(0.35, 0.20, 0.85);
    gLight.intensity = 18;
    gLight.range     = 9;
    const gPhase = Math.random() * Math.PI * 2;
    const _portalEmissive = new BABYLON.Color3(0.20, 0.10, 0.55);
    portalMat.emissiveColor = _portalEmissive;
    this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() * 0.001;
      gLight.intensity = 18 * (1 + Math.sin(t * 1.8 + gPhase) * 0.20);
      _portalEmissive.r = 0.20 + Math.sin(t * 1.5 + gPhase) * 0.05;
      _portalEmissive.b = 0.55 + Math.sin(t * 1.8 + gPhase) * 0.10;
      // .g = 0.10 is constant — no update needed
    });

    // Floating label
    const labelRoot = new BABYLON.TransformNode('dunEntranceLabelRoot', this.scene);
    labelRoot.position.set(x, 6.8, z);
    this._makeLabel('dunEntrance', 'Dungeon Entrance', labelRoot);
  }

  // ── Post-processing (PBR character material template) ──────────────────────
  // Helper for when humanoids get authored albedo/normal/ORM textures.

  _createCharacterPBR(name, texBasePath) {
    const mat = new BABYLON.PBRMaterial(name, this.scene);
    mat.albedoTexture   = new BABYLON.Texture(`${texBasePath}/albedo.png`, this.scene);
    mat.bumpTexture     = new BABYLON.Texture(`${texBasePath}/normal.png`, this.scene);
    mat.metallicTexture = new BABYLON.Texture(`${texBasePath}/orm.png`, this.scene);
    mat.useAmbientOcclusionFromMetallicTextureRed = true;
    mat.useRoughnessFromMetallicTextureGreen      = true;
    mat.useMetallnessFromMetallicTextureBlue      = true;
    mat.roughness            = 1.0;
    mat.metallic             = 1.0;
    mat.environmentIntensity = 1.0;
    mat.indexOfRefraction    = 1.5;
    mat.albedoColor          = BABYLON.Color3.White();
    mat.backFaceCulling      = true;
    return mat;
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  _bindKeys() {
    this._kd = (e) => {
      if (this._chatOpen) return;
      this._keys[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    };
    this._ku = (e) => { this._keys[e.code] = false; };
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup',   this._ku);
  }

  // ── Per-frame ──────────────────────────────────────────────────────────────

  _tick() {
    // LightingManager self-updates via scene.onBeforeRenderObservable
    const dt = this.engine.getDeltaTime();
    this._moveLocal(dt);
    this._local.update(dt);
    this._checkDungeonProximity();
    this._streamTiles();
    this._handleAttackInput();
    this._trackCamera();
    this._syncStdb();

    this._remotePlayers.forEach(rp => {
      this._lerpRemote(rp, dt);
      rp.update(dt);
    });

    // Make mob HP bars face the camera each frame.
    this._mobs.forEach(m => { m.hpBar?.lookAt(this._camera.position); });
  }

  // stream() is a no-op while the player stays inside the current tile —
  // safe to call every frame.
  _streamTiles() {
    const p = this._local?.root?.position;
    if (!p || !this._tileLoader) return;
    this._tileLoader.stream({ x: p.x, z: p.z });
  }

  // ── Mobs (slice 5a) ────────────────────────────────────────────────────────
  // Mob rows arrive from useSpacetimeWorld -> WorldGame -> applyMobUpdate.
  // Position is server-side in STDB px; we toWorld() it for Babylon coords.

  applyMobUpdate(row) {
    if (!this.scene) return; // pre-init race; server will resend on resubscribe
    // Queue until MobAssetLibrary finishes loading. _spawnMob's GLB-vs-primitive
    // decision is made once at first sight, so rows that arrive before assets
    // are ready would otherwise be baked as primitives and never upgrade —
    // subsequent updates find the mob already in `_mobs` and skip `_spawnMob`
    // entirely. Flush happens in `_initCharactersAsync` after both libraries
    // resolve. (Codex P1 on #191.)
    if (!MobAssetLibrary.isReady()) { this._pendingMobUpdates.push(row); return; }
    let m = this._mobs.get(row.mobId);
    if (!m) m = this._spawnMob(row);
    if (!m) return;

    m.root.position.x = toWorld(row.x);
    m.root.position.z = toWorld(row.y);

    // HP bar — scale fill to current/max ratio. Hide entire bar on death.
    m.maxHp = row.maxHp;
    m.lastHp = row.hp;
    const dead = row.state !== 'alive' || row.hp <= 0;
    if (dead && !m.dead) {
      m.dead = true;
      m.visual.setEnabled(false);
      m.hpBar.setEnabled(false);
    } else if (!dead) {
      const ratio = Math.max(0, Math.min(1, row.hp / Math.max(1, row.maxHp)));
      m.hpFill.scaling.x = ratio;
      // Re-center fill since pivot is at center: shift left by half the missing width.
      m.hpFill.position.x = -(1 - ratio) * 0.5;
    }
  }

  _removeMob(mobId) {
    const m = this._mobs.get(mobId);
    if (!m) return;
    m.root.dispose(false, true);
    this._mobs.delete(mobId);
  }

  _spawnMob(row) {
    // GLB path first; primitive fallback only for known mob types (wolf
    // today). Unknown mob types with no GLB return null so the row stays
    // invisible until either a GLB is authored or a primitive case is added.
    const hasGlb = MobAssetLibrary.hasContainer(row.mobType);
    if (!hasGlb && row.mobType !== 'wolf') return null;

    const root = new BABYLON.TransformNode(`mob_${row.mobId}`, this.scene);
    // Visual subtree — everything that should hide on death lives under here.
    // Hiding `visual` keeps the HP bar parent intact (it's hidden separately)
    // and lets us swap GLB vs primitive geometry without touching the HP bar
    // or root-position wiring.
    const visual = new BABYLON.TransformNode(`mob_visual_${row.mobId}`, this.scene);
    visual.parent = root;

    if (hasGlb) {
      this._buildMobVisualFromGlb(row, visual);
    } else {
      this._buildMobVisualPrimitive(row, visual);
    }

    const { hpBar, hpFill } = this._buildMobHpBar(row, root);

    const entry = {
      root, visual, hpBar, hpFill,
      maxHp: row.maxHp, lastHp: row.hp, dead: false,
    };
    this._mobs.set(row.mobId, entry);
    return entry;
  }

  // Instantiate the mob's GLB AssetContainer under `visual`. Mirrors the
  // pattern from CharacterAvatar._buildGLB — `cloneMaterials: false` is
  // intentional (shared materials across mob instances; revisit when we
  // need per-mob tinting like alpha-wolf darker etc.).
  _buildMobVisualFromGlb(row, visual) {
    const container = MobAssetLibrary.getContainer(row.mobType);
    const inst = container.instantiateModelsToScene(
      (name) => `mob_${row.mobId}_${name}`,
      false, // share materials
    );
    for (const node of inst.rootNodes) {
      node.parent = visual;
    }
    // Cast shadows from every freshly-instantiated mesh in the hierarchy.
    for (const node of inst.rootNodes) {
      const meshes = node.getChildMeshes ? node.getChildMeshes(false) : [];
      for (const mesh of meshes) {
        if (mesh instanceof BABYLON.Mesh) this._castShadow(mesh);
      }
    }
  }

  // Build the quadruped composite from MeshBuilder primitives. Used when no
  // wolf.glb is available (e.g., asset deleted, build:glb not yet run).
  // Wolf faces +Z; later AI slice can `root.rotation.y = atan2(vx, vz)`.
  _buildMobVisualPrimitive(row, visual) {
    const bodyMat = this._stdMat('mobWolfBody',  new BABYLON.Color3(0.28, 0.26, 0.24));
    const pale    = this._stdMat('mobWolfPale',  new BABYLON.Color3(0.55, 0.50, 0.44));
    const dark    = this._stdMat('mobWolfDark',  new BABYLON.Color3(0.12, 0.11, 0.10));

    // Torso
    const body = BABYLON.MeshBuilder.CreateBox(`mob_body_${row.mobId}`, {
      width: 0.55, height: 0.45, depth: 1.0,
    }, this.scene);
    body.parent = visual;
    body.position.set(0, 0.65, 0);
    body.material = bodyMat;
    this._castShadow(body);

    // Head + snout
    const head = BABYLON.MeshBuilder.CreateBox(`mob_head_${row.mobId}`, {
      width: 0.40, height: 0.38, depth: 0.40,
    }, this.scene);
    head.parent = visual;
    head.position.set(0, 0.82, 0.62);
    head.material = bodyMat;
    this._castShadow(head);

    const snout = BABYLON.MeshBuilder.CreateBox(`mob_snout_${row.mobId}`, {
      width: 0.22, height: 0.20, depth: 0.28,
    }, this.scene);
    snout.parent = visual;
    snout.position.set(0, 0.72, 0.90);
    snout.material = pale;

    // Ears
    for (const sign of [-1, 1]) {
      const ear = BABYLON.MeshBuilder.CreateCylinder(`mob_ear_${row.mobId}_${sign}`, {
        diameterTop: 0, diameterBottom: 0.14, height: 0.18, tessellation: 4,
      }, this.scene);
      ear.parent = visual;
      ear.position.set(sign * 0.13, 1.08, 0.55);
      ear.material = dark;
    }

    // Legs
    const legPositions = [
      [ 0.18, 0.30,  0.36],
      [-0.18, 0.30,  0.36],
      [ 0.18, 0.30, -0.36],
      [-0.18, 0.30, -0.36],
    ];
    for (let i = 0; i < legPositions.length; i++) {
      const [x, y, z] = legPositions[i];
      const leg = BABYLON.MeshBuilder.CreateCylinder(`mob_leg_${row.mobId}_${i}`, {
        diameter: 0.14, height: 0.60, tessellation: 6,
      }, this.scene);
      leg.parent = visual;
      leg.position.set(x, y, z);
      leg.material = dark;
      this._castShadow(leg);
    }

    // Tail
    const tail = BABYLON.MeshBuilder.CreateCylinder(`mob_tail_${row.mobId}`, {
      diameterTop: 0.06, diameterBottom: 0.14, height: 0.45, tessellation: 6,
    }, this.scene);
    tail.parent = visual;
    tail.position.set(0, 0.75, -0.62);
    tail.rotation.x = -Math.PI / 4;
    tail.material = bodyMat;
  }

  // HP bar — two flat planes (bg + fill) parented to the mob root. The
  // planes use BILLBOARDMODE_ALL so they face the camera at any angle. The
  // fill plane's X scale is set in applyMobUpdate based on hp ratio.
  _buildMobHpBar(row, root) {
    const hpBar = new BABYLON.TransformNode(`mob_hpbar_${row.mobId}`, this.scene);
    hpBar.parent = root;
    hpBar.position.y = 1.6;

    const hpBgMat = new BABYLON.StandardMaterial('mobHpBg', this.scene);
    hpBgMat.emissiveColor = new BABYLON.Color3(0.08, 0.08, 0.08);
    hpBgMat.disableLighting = true;
    const hpBg = BABYLON.MeshBuilder.CreatePlane(`mob_hpbg_${row.mobId}`, {
      width: 1.0, height: 0.12,
    }, this.scene);
    hpBg.parent = hpBar;
    hpBg.material = hpBgMat;
    hpBg.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

    const hpFillMat = new BABYLON.StandardMaterial('mobHpFill', this.scene);
    hpFillMat.emissiveColor = new BABYLON.Color3(0.85, 0.18, 0.18);
    hpFillMat.disableLighting = true;
    const hpFill = BABYLON.MeshBuilder.CreatePlane(`mob_hpfill_${row.mobId}`, {
      width: 1.0, height: 0.10,
    }, this.scene);
    hpFill.parent = hpBar;
    hpFill.material = hpFillMat;
    hpFill.position.z = -0.001; // sit just in front of background
    hpFill.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

    return { hpBar, hpFill };
  }

  // ── Combat input ───────────────────────────────────────────────────────────

  _handleAttackInput() {
    if (this._chatOpen) return;
    if (!this._keys['Space']) return;
    const now = performance.now();
    if (now - this._lastAttackAt < 350) return; // soft cooldown — matches damage cadence

    const target = this._findNearestAliveMobInRange(3.0); // 3 world units = matches server MELEE_RANGE_PX
    if (!target) return;
    this._lastAttackAt = now;
    this.callbacks.onCastAbility?.(target.mobId);
  }

  _findNearestAliveMobInRange(maxRange) {
    const p = this._local?.root?.position;
    if (!p) return null;
    let bestId = null;
    let bestSq = maxRange * maxRange;
    this._mobs.forEach((m, mobId) => {
      if (m.dead) return;
      const dx = m.root.position.x - p.x;
      const dz = m.root.position.z - p.z;
      const dsq = dx * dx + dz * dz;
      if (dsq < bestSq) { bestSq = dsq; bestId = mobId; }
    });
    return bestId ? { mobId: bestId } : null;
  }

  _moveLocal(dt) {
    if (this._chatOpen) { this._local.isMoving = false; return; }

    const w = this._keys['KeyW'] || this._keys['ArrowUp'];
    const s = this._keys['KeyS'] || this._keys['ArrowDown'];
    const a = this._keys['KeyA'] || this._keys['ArrowLeft'];
    const d = this._keys['KeyD'] || this._keys['ArrowRight'];

    const joyLen    = Math.hypot(this._joyDx, this._joyDy);
    const joyActive = joyLen > 0.12;

    // Early exit before any Vector3 allocation when there is no input
    if (!w && !s && !a && !d && !joyActive) { this._local.isMoving = false; return; }

    const speed = 0.012;
    const alpha  = this._camera.alpha + Math.PI;
    this._moveFwd.set(Math.cos(alpha), 0, Math.sin(alpha));
    this._moveRight.set(Math.cos(alpha + Math.PI / 2), 0, Math.sin(alpha + Math.PI / 2));
    this._moveDir.setAll(0);

    if (w) this._moveDir.addInPlace(this._moveFwd);
    if (s) this._moveDir.subtractInPlace(this._moveFwd);
    if (a) this._moveDir.addInPlace(this._moveRight);
    if (d) this._moveDir.subtractInPlace(this._moveRight);

    let joyScale = 1;
    if (joyActive) {
      joyScale = Math.min(1, (joyLen - 0.12) / (1 - 0.12));
      const nx = this._joyDx / joyLen;
      const ny = this._joyDy / joyLen;
      this._moveDir.addInPlace(this._moveRight.scale(-nx));
      this._moveDir.addInPlace(this._moveFwd.scale(-ny));
    }

    this._local.isMoving = this._moveDir.lengthSquared() > 0.001;
    if (!this._local.isMoving) return;
    this._moveDir.normalize();

    const speedScale = (joyActive && !w && !s && !a && !d) ? joyScale : 1;
    const pos = this._local.root.position;
    pos.addInPlace(this._moveDir.scale(speed * dt * speedScale));
    pos.x = Math.max(-95, Math.min(95, pos.x));
    pos.z = Math.max(-95, Math.min(95, pos.z));
    pos.y = 0;

    const target = Math.atan2(this._moveDir.x, this._moveDir.z);
    this._local.root.rotation.y = this._lerpAngle(
      this._local.root.rotation.y, target, 0.18
    );
  }

  _trackCamera() {
    const p = this._local.root.position;
    this._camTarget.set(p.x, 1.2, p.z);
    BABYLON.Vector3.LerpToRef(this._camera.target, this._camTarget, 0.12, this._camera.target);
  }

  _syncStdb() {
    const now = Date.now();
    if (now - this._lastSentAt < 50) return;

    const { x, z } = this._local.root.position;
    const dx = x - this._lastPos.x;
    const dz = z - this._lastPos.z;

    if (Math.sqrt(dx * dx + dz * dz) > 0.04 || this._local.isMoving !== this._lastMoving) {
      this.callbacks.onMove?.(toStdb(x), toStdb(z), this._dir(), this._local.isMoving);
      this._lastPos    = { x, z };
      this._lastMoving = this._local.isMoving;
      this._lastSentAt = now;
    }
  }

  _dir() {
    const a = ((this._local.root.rotation.y * 180 / Math.PI) % 360 + 360) % 360;
    if (a < 45 || a >= 315) return 0;
    if (a < 135) return 3;
    if (a < 225) return 1;
    return 2;
  }

  // ── Remote players ─────────────────────────────────────────────────────────

  // Store as canonical hex so subsequent comparisons against row.identity
  // (which is a fresh Identity instance each callback) actually match.
  setMyIdentity(id) { this._myIdentity = idKey(id); }

  applyPlayerUpdate(row) {
    const key = idKey(row.identity);
    if (key === this._myIdentity) return;
    if (!row.online) { this._removeRemote(row.identity); return; }
    if (!this._local) { this._pendingUpdates.push(row); return; }

    if (this._remotePlayers.has(key)) {
      const rp    = this._remotePlayers.get(key);
      rp._targetX = toWorld(row.x);
      rp._targetZ = toWorld(row.y);
      rp.isMoving = row.isMoving;
    } else {
      this._spawnRemote(row);
    }
  }

  async _spawnRemote(row) {
    const key = idKey(row.identity);
    if (this._spawning.has(key)) return;
    this._spawning.add(key);
    try {
      let parsedConfig = null;
      if (row.avatarConfig) {
        try { parsedConfig = JSON.parse(row.avatarConfig); } catch { parsedConfig = null; }
      }
      const config = mergeConfig(parsedConfig);
      const rp = await CharacterAvatar.create(
        row.identity, row.username, config, this.scene, AssetLibrary
      );
      if (this._remotePlayers.has(key)) {
        rp.dispose(); // another update already spawned this player
      } else {
        rp._targetX = toWorld(row.x);
        rp._targetZ = toWorld(row.y);
        rp.root.position.set(rp._targetX, 0, rp._targetZ);
        this._remotePlayers.set(key, rp);
      }
    } finally {
      this._spawning.delete(key);
    }
  }

  // Accepts either a raw Identity (from STDB callbacks) or a canonical hex
  // string (from the disposal loop in dispose()).
  _removeRemote(id) {
    const key = typeof id === 'string' ? id : idKey(id);
    const rp = this._remotePlayers.get(key);
    if (!rp) return;
    rp.dispose();
    this._remotePlayers.delete(key);
  }

  _lerpRemote(rp, dt) {
    const f = 1 - Math.pow(0.04, dt / 100);
    rp.root.position.x = BABYLON.Scalar.Lerp(rp.root.position.x, rp._targetX, f);
    rp.root.position.z = BABYLON.Scalar.Lerp(rp.root.position.z, rp._targetZ, f);
    rp.root.position.y = 0;
  }

  // ── Name label ─────────────────────────────────────────────────────────────

  _makeLabel(id, text, parent) {
    if (!text) return;
    try {
      const W = 256, H = 48;
      const dt = new BABYLON.DynamicTexture(`${id}_tex`, { width: W, height: H }, this.scene, false);
      dt.hasAlpha = true;

      const ctx = dt.getContext();
      ctx.clearRect(0, 0, W, H);
      ctx.font = 'bold 22px Inter, system-ui, sans-serif';
      const tw = ctx.measureText(text).width + 18;
      const bx = (W - tw) / 2;
      const by = (H - 30) / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, tw, 30, 5);
      else               ctx.rect(bx, by, tw, 30);
      ctx.fill();
      ctx.fillStyle    = '#e2e8f0';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, W / 2, H / 2);
      dt.update();

      const plane = BABYLON.MeshBuilder.CreatePlane(`${id}_label`, { width: 1.6, height: 0.3 }, this.scene);
      const lm = new BABYLON.StandardMaterial(`${id}_lmat`, this.scene);
      lm.diffuseTexture  = dt;
      lm.emissiveTexture = dt;
      lm.useAlphaFromDiffuseTexture = true;
      lm.backFaceCulling = false;
      lm.disableLighting = true;
      plane.material      = lm;
      plane.position.set(0, 2.15, 0);
      plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      plane.parent        = parent;
    } catch (_) { /* non-critical */ }
  }

  // ── Chat ───────────────────────────────────────────────────────────────────

  setChatOpen(open) {
    this._chatOpen = open;
    if (open) this._keys = {};
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  _stdMat(name, color) {
    const m = new BABYLON.StandardMaterial(name + '_mat', this.scene);
    m.diffuseColor  = color;
    m.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    // Required: ambientColor must be non-zero for scene.ambientColor to
    // contribute — StandardMaterial ignores the scene-wide ambient term when
    // this is black (the default).
    m.ambientColor = new BABYLON.Color3(1, 1, 1);
    // Emissive self-illumination is only applied when ALL post-processing has
    // failed (DefaultRenderingPipeline AND ImageProcessingPostProcess both
    // threw). This is essentially impossible on any device supporting WebGL2,
    // but kept as an absolute last resort.
    if (this._lm?._noPipeline) {
      m.emissiveColor = color.scale(0.25).add(new BABYLON.Color3(0.04, 0.04, 0.05));
    }
    return m;
  }

  _lerpAngle(from, to, t) {
    let diff = to - from;
    while (diff >  Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return from + diff * t;
  }

  // ── Pose accessors (used by TestingHud for compass + minimap) ──────────────
  // Cheap to call every frame — no allocation hot path. Returns null until
  // the local avatar finishes loading.

  getPose() {
    const p = this._local?.root?.position;
    if (!p) return null;
    // Camera-relative forward heading: where pressing W would move you,
    // projected onto the XZ plane. atan2(forward.x, forward.z) so 0 = +Z
    // (south), increases clockwise.
    let yaw = 0;
    if (this._camera) {
      const fwdX = this._camTarget.x - this._camera.position.x;
      const fwdZ = this._camTarget.z - this._camera.position.z;
      yaw = Math.atan2(fwdX, fwdZ);
    }
    return { x: p.x, z: p.z, yaw };
  }

  // Snapshots mob positions in world units. Used by the minimap each frame.
  // Returns a fresh array — caller may iterate freely.
  getMobs() {
    const out = [];
    this._mobs.forEach((m, mobId) => {
      out.push({
        mobId,
        x: m.root.position.x,
        z: m.root.position.z,
        dead: !!m.dead,
      });
    });
    return out;
  }

  // ── Dispose ────────────────────────────────────────────────────────────────

  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup',   this._ku);
    window.removeEventListener('resize',  this._onResize);
    this._touchCleanup?.();
    [...this._remotePlayers.keys()].forEach(id => this._removeRemote(id));
    [...this._mobs.keys()].forEach(id => this._removeMob(id));
    this._local?.dispose();
    AssetLibrary.dispose();
    MobAssetLibrary.dispose();
    this._tileLoader?.dispose();
    this._lm?.dispose();
    this.engine.stopRenderLoop();
    this.engine.dispose();
  }
}
