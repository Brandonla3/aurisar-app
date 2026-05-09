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
import { CharacterAvatar } from './CharacterAvatar.js';
import { mergeConfig }     from './avatarSchema.js';

// ── Coordinate helpers ──────────────────────────────────────────────────────
const SCALE       = 32;
const STDB_CENTER = 1600;

function toWorld(v) { return (v - STDB_CENTER) / SCALE; }
function toStdb(v)  { return Math.round(v * SCALE + STDB_CENTER); }

// ── Math helpers ────────────────────────────────────────────────────────────
const clamp01    = (v) => Math.max(0, Math.min(1, v));
const lerp       = (a, b, t) => a + (b - a) * t;
const lerpColor3 = (a, b, t) => new BABYLON.Color3(
  lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t)
);

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
    this.scene.imageProcessingConfiguration.toneMappingType =
      BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;

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
      this.pipeOverworld = this._tryBuildPipeline('lm_overworld_pipe', {
        bloomThreshold: 0.88, bloomWeight: 0.22, bloomKernel: 64, bloomScale: 0.5,
        sharpenColor: 0.20, sharpenEdge: 0.15,
      });
      this.pipeDungeon = this._tryBuildPipeline('lm_dungeon_pipe', {
        bloomThreshold: 0.90, bloomWeight: 0.30, bloomKernel: 64, bloomScale: 0.5,
        sharpenColor: 0.15, sharpenEdge: 0.10,
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

    // Ambient floor. On mobile there is no IBL from .env files, so this term
    // is the sole contributor to shadowed-surface brightness — set it higher
    // than the desktop value where IBL provides the ambient fill.
    this.scene.ambientColor = this._isMobile
      ? new BABYLON.Color3(0.40, 0.44, 0.50)
      : new BABYLON.Color3(0.22, 0.25, 0.30);
  }

  // Try HDR pipeline first (best quality), fall back to non-HDR (mobile-safe),
  // return null only if both fail.
  _tryBuildPipeline(name, opts) {
    for (const hdr of [true, false]) {
      try {
        const p = new BABYLON.DefaultRenderingPipeline(name, hdr, this.scene, [this.camera]);
        p.samples        = hdr ? 4 : 1;
        p.fxaaEnabled    = true;
        p.bloomEnabled   = true;
        p.bloomThreshold = opts.bloomThreshold;
        p.bloomWeight    = opts.bloomWeight;
        p.bloomKernel    = hdr ? opts.bloomKernel : 32; // smaller kernel on mobile
        p.bloomScale     = opts.bloomScale;
        p.sharpenEnabled = hdr; // skip sharpen on the non-HDR fallback
        if (hdr) {
          p.sharpen.colorAmount = opts.sharpenColor;
          p.sharpen.edgeAmount  = opts.sharpenEdge;
        }
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

    const sunDir = new BABYLON.Vector3(
      Math.cos(sunTheta) * 0.35,
      -Math.sin(sunTheta),
       Math.sin(sunTheta) * 0.65
    ).normalize();

    this.key.direction.copyFrom(sunDir);
    this.moon.direction.copyFrom(sunDir.scale(-1));

    const sunHeight = -sunDir.y;
    const dayFactor = clamp01((sunHeight + 0.08) / 0.22);
    const sunset    = clamp01(1 - Math.abs(sunHeight) / 0.22) * dayFactor;

    // ImageProcessingPostProcess (or DefaultRenderingPipeline) now provides
    // proper ACES tone-mapping on every tier, so desktop and mobile use the
    // same raw light intensity values. No device-specific multipliers needed.
    this.key.intensity = lerp(0.05, 2.4, dayFactor);
    this.key.diffuse   = lerpColor3(
      new BABYLON.Color3(1.0, 0.72, 0.48),
      new BABYLON.Color3(1.0, 0.97, 0.92),
      clamp01(dayFactor * 1.25)
    );
    // Moon is brighter (0.60 vs old 0.45) so night is always legible.
    this.moon.intensity = lerp(0.0, 0.60, 1.0 - dayFactor);

    // Fill never fully dims at night — keeps geometry readable without
    // destroying the nighttime atmosphere.
    const fillMin = this._isMobile ? 0.50 : 0.20;
    const fillMax = this._isMobile ? 0.80 : 0.40;
    this.fillOverworld.intensity   = lerp(fillMin, fillMax, dayFactor);
    this.fillOverworld.groundColor = lerpColor3(
      new BABYLON.Color3(0.10, 0.12, 0.18),
      new BABYLON.Color3(0.34, 0.36, 0.40),
      dayFactor
    );

    // Night exposure raised from 0.65 → 0.82 so the tone-mapper keeps dark
    // scenes bright enough to navigate; day cap slightly higher on mobile.
    const exposureMax = this._isMobile ? 1.30 : 1.05;
    this.scene.imageProcessingConfiguration.exposure = lerp(0.82, exposureMax, dayFactor);
    this.scene.imageProcessingConfiguration.contrast = lerp(1.03, 1.10, sunset);

    this.scene.fogDensity = lerp(0.0022, 0.0016, dayFactor);
    this.scene.fogColor   = lerpColor3(
      new BABYLON.Color3(0.06, 0.08, 0.12),
      new BABYLON.Color3(0.74, 0.84, 0.96),
      dayFactor
    );

    // Animate the background sky colour through day / night. When an env-based
    // skybox mesh is present it covers clearColor completely; when the .env
    // files are absent (our current setup) this IS the sky.
    const sky = lerpColor3(
      new BABYLON.Color3(0.06, 0.08, 0.18),  // night — deep navy, not black
      new BABYLON.Color3(0.42, 0.58, 0.78),  // day  — sky blue
      dayFactor
    );
    this.scene.clearColor.r = sky.r;
    this.scene.clearColor.g = sky.g;
    this.scene.clearColor.b = sky.b;

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

    this.scene.imageProcessingConfiguration.exposure = this._isMobile ? 1.10 : 0.82;
    this.scene.imageProcessingConfiguration.contrast = 1.12;

    this.scene.fogDensity = 0.018;
    this.scene.fogColor   = new BABYLON.Color3(0.06, 0.07, 0.085);

    this._setEnvironment(this.envDungeon, 0.35);
  }

  _updateCombatRim() {
    const target = this.camera.getTarget ? this.camera.getTarget() : BABYLON.Vector3.Zero();
    const camPos = this.camera.globalPosition ?? this.camera.position ?? new BABYLON.Vector3(0, 2, -4);
    const backDir = target.subtract(camPos).normalize().scale(-1);

    this.rimCombat.position.copyFrom(
      target.add(backDir.scale(2.5)).add(new BABYLON.Vector3(0, 1.8, 0))
    );

    const base       = this.combatMode ? 35 : 0;
    const profileMul = this.profile === 'dungeon' ? 1.15 : 1.0;
    this.rimCombat.intensity = base * profileMul;
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
    this._myIdentity    = null;
    this._keys          = {};
    this._lastPos       = { x: 0, z: 0 };
    this._lastMoving    = false;
    this._lastSentAt    = 0;
    this._chatOpen      = false;
    this._inDungeon     = false;
    this._local         = null;
    this._pendingUpdates = []; // remote rows queued while _local is loading
    this._spawning       = new Set(); // identity IDs currently being async-spawned

    // Mobile touch state — written by setJoystick() from WorldGame's React layer
    this._joyDx = 0;
    this._joyDy = 0;
    // Camera drag touch (right-half of screen, managed internally)
    this._camTouch = null; // { id, lastX, lastY }

    this._isMobile = typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse)').matches;

    this._initSync();
    this._initCharactersAsync();
  }

  // ── Sync bootstrap (terrain, engine — no characters yet) ──────────────────

  _initSync() {
    this.engine = new BABYLON.Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      adaptToDeviceRatio: true,
    });

    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.07, 0.10, 0.18, 1);

    // Camera must exist before LightingManager — its pipelines need a target
    this._setupCamera();

    // Seed the day/night cycle from the device's real local time so the
    // world matches the player's actual time of day, then run at real speed.
    const now = new Date();
    const realHour = now.getHours() + now.getMinutes() / 60;
    this._lm = new LightingManager(this.scene, this._camera, this.engine, {
      isMobile: this._isMobile,
      startTimeOfDay: realHour,
      dayLengthSec: 86400, // one real second = one game second
    });

    this._setupShadows();
    this._setupSSAO();

    this._buildTerrain();
    this._buildHub();
    this._buildTrees();
    this._buildRocks();
    this._buildPaths();
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
    await AssetLibrary.init(this.scene);
    this._local = await CharacterAvatar.create(
      'local',
      this.playerInfo?.username ?? 'You',
      this.playerInfo?.avatarConfig ?? null,
      this.scene,
      AssetLibrary
    );
    this._local.root.position.set(0, 0, 0);
    // Flush remote updates that arrived while we were loading
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
    // Try high-quality 2048 shadow map first; mobile GPUs often cap at 1024,
    // so fall back gracefully rather than crashing the whole render loop.
    for (const size of [2048, 1024, 512]) {
      try {
        const sg = new BABYLON.ShadowGenerator(size, this._lm.key);
        sg.useBlurExponentialShadowMap = size >= 1024;
        sg.blurKernel = size >= 1024 ? 24 : 8;
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
    // SSAO2 can conflict with other render passes on mobile WebGL2 and produces
    // incorrect (black) output on several iOS/Android implementations.
    if (this._isMobile) return;
    if (this.engine.webGLVersion < 2) return;
    try {
      const ssao = new BABYLON.SSAO2RenderingPipeline('ssao2', this.scene, {
        ssaoRatio: 0.5, blurRatio: 1.0,
      });
      ssao.radius        = 2.0;
      ssao.base          = 0.05;
      ssao.totalStrength = 0.9;
      this.scene.postProcessRenderPipelineManager
        .attachCamerasToRenderPipeline('ssao2', this._camera);
      this._ssao = ssao;
    } catch (_) { /* SSAO2 unavailable — skip silently */ }
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

  // ── Terrain ────────────────────────────────────────────────────────────────

  _buildTerrain() {
    const ground = BABYLON.MeshBuilder.CreateGround('ground', {
      width: 200, height: 200, subdivisions: 2,
    }, this.scene);
    const m = this._stdMat('groundMat', new BABYLON.Color3(0.18, 0.30, 0.12));
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.material       = m;
    ground.receiveShadows = true;
  }

  // ── Hub ────────────────────────────────────────────────────────────────────

  _buildHub() {
    const stone = this._stdMat('stone', new BABYLON.Color3(0.48, 0.48, 0.52));
    const dark  = this._stdMat('dark',  new BABYLON.Color3(0.22, 0.22, 0.28));

    const plat = BABYLON.MeshBuilder.CreateCylinder('platform', {
      diameter: 22, height: 0.6, tessellation: 12,
    }, this.scene);
    plat.position.y     = 0.3;
    plat.material       = stone;
    plat.receiveShadows = true;
    this._castShadow(plat);

    [[-8, -8], [8, -8], [-8, 8], [8, 8]].forEach(([x, z], i) => {
      const p = BABYLON.MeshBuilder.CreateBox(`p${i}`, {
        width: 1.2, height: 4, depth: 1.2,
      }, this.scene);
      p.position.set(x, 2.6, z);
      p.material = stone;
      this._castShadow(p);

      const cap = BABYLON.MeshBuilder.CreateCylinder(`cap${i}`, {
        diameter: 1.6, height: 0.5, tessellation: 8,
      }, this.scene);
      cap.position.set(x, 4.85, z);
      cap.material = stone;
      this._castShadow(cap);
    });

    const ob = BABYLON.MeshBuilder.CreateBox('obelisk', {
      width: 1.2, height: 8, depth: 1.2,
    }, this.scene);
    ob.position.set(0, 4.6, 0);
    ob.material = dark;
    this._castShadow(ob);

    const tip = BABYLON.MeshBuilder.CreateCylinder('obeliskTip', {
      diameterTop: 0, diameterBottom: 1.6, height: 2, tessellation: 4,
    }, this.scene);
    tip.position.set(0, 9.6, 0);
    tip.material = dark;
    this._castShadow(tip);

    const gem = BABYLON.MeshBuilder.CreateSphere('gem', { diameter: 0.9, segments: 8 }, this.scene);
    gem.position.set(0, 11, 0);
    const gemMat = new BABYLON.StandardMaterial('gemMat', this.scene);
    gemMat.diffuseColor  = new BABYLON.Color3(0.2, 0.4, 1.0);
    gemMat.emissiveColor = new BABYLON.Color3(0.15, 0.35, 0.9);
    gem.material = gemMat;

    // Gem glow — always-on, independent of zone profile
    const gemLight = new BABYLON.PointLight('gemLight', new BABYLON.Vector3(0, 11, 0), this.scene);
    gemLight.diffuse   = new BABYLON.Color3(0.3, 0.5, 1.0);
    gemLight.specular  = new BABYLON.Color3(0.15, 0.25, 0.5);
    gemLight.intensity = 22;
    gemLight.range     = 20;
    const gPhase = Math.random() * Math.PI * 2;
    this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() * 0.001;
      gemLight.intensity = 22 * (1.0 + Math.sin(t * 2.0 + gPhase) * 0.15);
    });
  }

  // ── Trees ──────────────────────────────────────────────────────────────────

  _buildTrees() {
    const trunkMat = this._stdMat('trunk', new BABYLON.Color3(0.35, 0.22, 0.10));
    const leafA    = this._stdMat('leafA', new BABYLON.Color3(0.14, 0.42, 0.14));
    const leafB    = this._stdMat('leafB', new BABYLON.Color3(0.10, 0.32, 0.10));

    const positions = [
      [18, 12], [-15, 22], [28, -18], [-22, -12], [10, 34],
      [38,  8], [-32, 18], [22, -34], [ -8, -28], [42, 28],
      [-40, -5], [14, -40], [-28, 38], [35, -25], [-18, -42],
      [50, 15], [-45, 20], [12, 48], [-50, -30], [25, 50],
    ];

    positions.forEach(([x, z], i) => {
      const h = 2.8 + (i % 3) * 0.7;
      const r = 1.0 + (i % 4) * 0.12;

      const trunk = BABYLON.MeshBuilder.CreateCylinder(`trunk${i}`, {
        diameterTop: 0.25, diameterBottom: 0.45, height: h, tessellation: 6,
      }, this.scene);
      trunk.position.set(x, h / 2, z);
      trunk.material = trunkMat;
      this._castShadow(trunk);

      [[0, r * 1.4, leafA], [1.5, r, leafB]].forEach(([yOff, diam, mat], j) => {
        const c = BABYLON.MeshBuilder.CreateCylinder(`leaf${i}_${j}`, {
          diameterTop: 0, diameterBottom: diam, height: 2.2, tessellation: 6,
        }, this.scene);
        c.position.set(x, h + yOff, z);
        c.material = mat;
        this._castShadow(c);
      });
    });
  }

  // ── Rocks ──────────────────────────────────────────────────────────────────

  _buildRocks() {
    const mat = this._stdMat('rock', new BABYLON.Color3(0.42, 0.42, 0.44));
    [
      [12, 10], [-9, 18], [20, -10], [-17, -22], [32, -6],
      [-25, 6], [7, -32], [-38, 25], [28, 38], [-12, 45],
    ].forEach(([x, z], i) => {
      const d    = 0.8 + (i % 3) * 0.5;
      const rock = BABYLON.MeshBuilder.CreateSphere(`rock${i}`, {
        diameter: d, segments: 3,
      }, this.scene);
      rock.position.set(x, d * 0.25, z);
      rock.scaling.y  = 0.55;
      rock.rotation.y = i * 0.9;
      rock.material   = mat;
      this._castShadow(rock);
    });
  }

  // ── Paths ──────────────────────────────────────────────────────────────────

  _buildPaths() {
    const mat = this._stdMat('path', new BABYLON.Color3(0.38, 0.38, 0.40));
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dz], di) => {
      for (let i = 1; i <= 8; i++) {
        const s = BABYLON.MeshBuilder.CreateBox(`stone${di}_${i}`, {
          width: 1.8, height: 0.08, depth: 1.8,
        }, this.scene);
        s.position.set(dx * (12 + i * 3), 0.04, dz * (12 + i * 3));
        s.rotation.y = (i * 0.2) % 0.3;
        s.material   = mat;
      }
    });
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
    this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() * 0.001;
      const pulse = 1 + Math.sin(t * 1.8 + gPhase) * 0.20;
      gLight.intensity = 18 * pulse;
      portalMat.emissiveColor = new BABYLON.Color3(
        0.20 + Math.sin(t * 1.5 + gPhase) * 0.05,
        0.10,
        0.55 + Math.sin(t * 1.8 + gPhase) * 0.10
      );
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
    this._trackCamera();
    this._syncStdb();

    this._remotePlayers.forEach(rp => {
      this._lerpRemote(rp, dt);
      rp.update(dt);
    });
  }

  _moveLocal(dt) {
    if (this._chatOpen) { this._local.isMoving = false; return; }

    const w = this._keys['KeyW'] || this._keys['ArrowUp'];
    const s = this._keys['KeyS'] || this._keys['ArrowDown'];
    const a = this._keys['KeyA'] || this._keys['ArrowLeft'];
    const d = this._keys['KeyD'] || this._keys['ArrowRight'];

    // alpha points FROM target TO camera, so add PI to get the true forward direction
    const speed = 0.012;
    const alpha  = this._camera.alpha + Math.PI;
    const fwd    = new BABYLON.Vector3(Math.cos(alpha), 0, Math.sin(alpha));
    const right  = new BABYLON.Vector3(Math.cos(alpha + Math.PI / 2), 0, Math.sin(alpha + Math.PI / 2));

    const dir = BABYLON.Vector3.Zero();

    // Keyboard input
    if (w) dir.addInPlace(fwd);
    if (s) dir.subtractInPlace(fwd);
    if (a) dir.addInPlace(right);
    if (d) dir.subtractInPlace(right);

    // Virtual joystick input (mobile)
    // _joyDx / _joyDy are normalised [-1, 1] from WorldGame's React overlay.
    // Screen +X = camera right, screen +Y = camera backward.
    let joyScale = 1;
    const JOY_DEAD = 0.12; // normalised deadzone
    const joyLen = Math.hypot(this._joyDx, this._joyDy);
    if (joyLen > JOY_DEAD) {
      joyScale = Math.min(1, (joyLen - JOY_DEAD) / (1 - JOY_DEAD));
      const nx = this._joyDx / joyLen;
      const ny = this._joyDy / joyLen;
      dir.addInPlace(right.scale(-nx)); // -nx: screen left = strafe left
      dir.addInPlace(fwd.scale(-ny));   // -ny: screen up   = move forward
    }

    this._local.isMoving = dir.lengthSquared() > 0.001;
    if (!this._local.isMoving) return;
    dir.normalize();

    const speedScale = (joyLen > JOY_DEAD && !w && !s && !a && !d) ? joyScale : 1;
    const pos = this._local.root.position;
    pos.addInPlace(dir.scale(speed * dt * speedScale));
    pos.x = Math.max(-95, Math.min(95, pos.x));
    pos.z = Math.max(-95, Math.min(95, pos.z));
    pos.y = 0;

    const target = Math.atan2(dir.x, dir.z);
    this._local.root.rotation.y = this._lerpAngle(
      this._local.root.rotation.y, target, 0.18
    );
  }

  _trackCamera() {
    const p   = this._local.root.position;
    const tgt = new BABYLON.Vector3(p.x, 1.2, p.z);
    BABYLON.Vector3.LerpToRef(this._camera.target, tgt, 0.12, this._camera.target);
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

  setMyIdentity(id) { this._myIdentity = id; }

  applyPlayerUpdate(row) {
    if (row.identity === this._myIdentity) return;
    if (!row.online) { this._removeRemote(row.identity); return; }
    if (!this._local) { this._pendingUpdates.push(row); return; }

    if (this._remotePlayers.has(row.identity)) {
      const rp    = this._remotePlayers.get(row.identity);
      rp._targetX = toWorld(row.x);
      rp._targetZ = toWorld(row.y);
      rp.isMoving = row.isMoving;
    } else {
      this._spawnRemote(row);
    }
  }

  async _spawnRemote(row) {
    if (this._spawning.has(row.identity)) return;
    this._spawning.add(row.identity);
    try {
      let parsedConfig = null;
      if (row.avatarConfig) {
        try { parsedConfig = JSON.parse(row.avatarConfig); } catch { parsedConfig = null; }
      }
      const config = mergeConfig(parsedConfig);
      const rp = await CharacterAvatar.create(
        row.identity, row.username, config, this.scene, AssetLibrary
      );
      if (this._remotePlayers.has(row.identity)) {
        rp.dispose(); // another update already spawned this player
      } else {
        rp._targetX = toWorld(row.x);
        rp._targetZ = toWorld(row.y);
        rp.root.position.set(rp._targetX, 0, rp._targetZ);
        this._remotePlayers.set(row.identity, rp);
      }
    } finally {
      this._spawning.delete(row.identity);
    }
  }

  _removeRemote(id) {
    const rp = this._remotePlayers.get(id);
    if (!rp) return;
    rp.dispose();
    this._remotePlayers.delete(id);
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
    m.ambientColor = color.clone();
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

  // ── Dispose ────────────────────────────────────────────────────────────────

  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup',   this._ku);
    window.removeEventListener('resize',  this._onResize);
    this._touchCleanup?.();
    [...this._remotePlayers.keys()].forEach(id => this._removeRemote(id));
    this._local?.dispose();
    AssetLibrary.dispose();
    this._lm?.dispose();
    this.engine.stopRenderLoop();
    this.engine.dispose();
  }
}
