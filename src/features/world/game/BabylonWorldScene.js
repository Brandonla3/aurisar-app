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
import { AshwoodSky }        from './AshwoodSky.js';
import { AshwoodGrass }      from './AshwoodGrass.js';
import { AshwoodWildlife }   from './AshwoodWildlife.js';
import { AshwoodWeather }    from './AshwoodWeather.js';
import { AshwoodVolumetricClouds } from './AshwoodVolumetricClouds.js';
import {
  TileLoader,
  GlbTileProvider,
  FallbackTileProvider,
  AshwoodTileProvider,
  buildTileIndex,
  streamingParams,
} from '../streaming/index.js';
import { createWorldgen } from '../worldgen/index.js';
import { locationLabelAt } from '../mapRender.js';
// Direct JSON import: keeps ajv out of the world-runtime bundle. Schema
// validation runs in CI via src/features/world/config/validators.js.
import worldBuildConfig from '../config/world_build_config.json' with { type: 'json' };
// P1: zone 1 replaces Ashwood as the playable map. ashwood_world.json
// stays in the repo as a dev/test world — swap the import to get it back
// locally.
import zone1WorldConfig from '../config/zone1_world.json' with { type: 'json' };
import { NpcSystem } from '../systems/NpcSystem.js';
import { PropsSystem } from '../systems/PropsSystem.js';
import { CastleSystem } from '../castle/CastleSystem.js';
import { ENTRY as CASTLE_ENTRY } from '../castle/castlePlan.js';
import { MOBS as MOB_DEFS } from '../content/index';

// The authored flat tiles (T_03_03) predate the Ashwood heightfield and
// would z-fight/clip against it. Re-enable once the Phase-5 bake pipeline
// regenerates them from the heightfield itself.
const USE_GLB_TILES = false;

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
    this._qualityTier = options.qualityTier ?? (this._isMobile ? 'mobile' : 'high');

    this.options = {
      dayLengthSec:  options.dayLengthSec  ?? 900,
      startTimeOfDay: options.startTimeOfDay ?? 9.0,
      env: {
        overworldDay:   options.env?.overworldDay   ?? '/env/overworld_day.env',
        overworldNight: options.env?.overworldNight ?? '/env/overworld_night.env',
        dungeon:        options.env?.dungeon        ?? '/env/dungeon_dim.env',
      },
      // Optional color-grading LUTs (.3dl / .cube). When the file is absent the
      // HEAD guard in _loadColorGradingSafe no-ops and the scene renders with
      // tone mapping only — dropping a LUT into /public activates grading with
      // zero code change. Overworld = warm/vibrant, dungeon = cold/desaturated.
      colorGrading: {
        overworld: options.colorGrading?.overworld ?? '/luts/overworld.3dl',
        dungeon:   options.colorGrading?.dungeon   ?? '/luts/dungeon.3dl',
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
    this._nightGround  = new BABYLON.Color3(0.20, 0.22, 0.28);
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

  /**
   * Interior mood override for the dungeon profile — lets an interior
   * (Castle Ashwood) warm or darken the rig without touching scene-global
   * state itself. { fogColor: [r,g,b], fogDensity, exposure } | null.
   * The LM stays the sole writer of scene fog/exposure.
   */
  setDungeonMood(mood) {
    this._dungeonMood = mood ?? null;
    // moods can opt out of the dungeon LUT (noGrading); re-apply live when
    // the profile is already settled on dungeon
    if (this.profile === 'dungeon' && !this._transition) {
      this._applyColorGrading(this._dungeonMood?.noGrading ? null : this._lutDungeon);
    }
  }

  setTimeOfDay(hours24) { this.timeOfDay = ((hours24 % 24) + 24) % 24; }
  // Testing aid: when frozen, _updateOverworld stops advancing the clock so a
  // chosen time of day holds steady.
  setTimeFrozen(f) { this._timeFrozen = !!f; }

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
    this._lutOverworld?.dispose();
    this._lutDungeon?.dispose();

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

    // Prefer the configured day env; if it's absent, try the .hdr sibling so a
    // user can drop in *either* overworld_day.env or overworld_day.hdr. When
    // both are missing the AshwoodSky gradient dome stays the only sky.
    const dayUrl = this.options.env.overworldDay;
    this._loadEnvSafe(dayUrl)
      .then(t => t ?? this._loadEnvSafe(dayUrl.replace(/\.env(\?|$)/i, '.hdr')))
      .then(t => {
        if (!t || this._disposed) return;
        this.envDay = t;
        if (this.profile === 'overworld' && !this._transition) {
          this._setEnvironment(t, this.scene.environmentIntensity || 0.9);
          if (!this.skybox) {
            this.skybox = this.scene.createDefaultSkybox(t, true, 1500, 0.35);
            // Keep the HDRI blue crisp — fog would wash the daytime sky grey.
            if (this.skybox) {
              this.skybox.applyFog = false;
              if (this.skybox.material) this.skybox.material.fogEnabled = false;
            }
          }
        }
      });
    // Night/dungeon get the same .env → .hdr fallback as day (the authored
    // Phase 0 assets ship as .hdr; HDRCubeTexture prefilters them on load).
    const envOrHdr = (url) => this._loadEnvSafe(url)
      .then(t => t ?? this._loadEnvSafe(url.replace(/\.env(\?|$)/i, '.hdr')));
    envOrHdr(this.options.env.overworldNight).then(t => {
      if (t && !this._disposed) this.envNight = t;
    });
    envOrHdr(this.options.env.dungeon).then(t => {
      if (t && !this._disposed) this.envDungeon = t;
    });

    this._dungeonTorches = [];
    this._dungeonMagic   = [];

    // Color-grading LUTs. Applied inside the shared imageProcessingConfiguration
    // block, so a single 3D-texture tap grades BOTH the desktop pipeline and the
    // mobile ImageProcessingPostProcess path — grading works on every tier. The
    // active LUT is swapped per zone in _updateOverworld / _updateDungeon.
    this._lutOverworld = null;
    this._lutDungeon   = null;
    this._loadColorGradingSafe(this.options.colorGrading.overworld).then(t => {
      if (!t || this._disposed) return;
      this._lutOverworld = t;
      if (this.profile === 'overworld') this._applyColorGrading(t);
    });
    this._loadColorGradingSafe(this.options.colorGrading.dungeon).then(t => {
      if (!t || this._disposed) return;
      this._lutDungeon = t;
      // If it arrives while the player is already underground, apply it now —
      // otherwise the dungeon would keep the overworld grade until the next
      // zone switch.
      if (this.profile === 'dungeon') this._applyColorGrading(t);
    });
  }

  // HEAD-guarded LUT loader — mirrors _loadEnvSafe so a missing LUT file (or the
  // Vite SPA HTML fallback) silently no-ops instead of throwing a texture error.
  _loadColorGradingSafe(url) {
    if (!url) return Promise.resolve(null);
    return fetch(url, { method: 'HEAD' })
      .then(r => {
        const ct = r.headers.get('content-type') ?? '';
        if (!r.ok || ct.includes('text/html')) return null;
        const lut = new BABYLON.ColorGradingTexture(url, this.scene);
        return lut;
      })
      .catch(() => null);
  }

  // Apply (or clear) grading on the shared image-processing config. Passing a
  // null LUT disables grading — so a zone whose LUT is absent or still loading
  // renders with tone mapping only instead of inheriting the other zone's grade.
  _applyColorGrading(lut) {
    const ipc = this.scene.imageProcessingConfiguration;
    if (lut) {
      ipc.colorGradingTexture = lut;
      ipc.colorGradingEnabled = true;
    } else {
      ipc.colorGradingTexture = null;
      ipc.colorGradingEnabled = false;
    }
  }

  _setupOverworldRig() {
    this.key = new BABYLON.DirectionalLight('lm_key', new BABYLON.Vector3(-0.6, -1, -0.35), this.scene);
    this.key.position  = new BABYLON.Vector3(12, 20, 8);
    this.key.intensity = 2.2;

    this.moon = new BABYLON.DirectionalLight('lm_moon', new BABYLON.Vector3(0.3, -1, 0.2), this.scene);
    this.moon.diffuse  = new BABYLON.Color3(0.62, 0.68, 0.92);
    this.moon.specular = new BABYLON.Color3(0.32, 0.36, 0.5);
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
    this.scene.ambientColor = new BABYLON.Color3(0.14, 0.16, 0.20);
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

        // High tier only: subtle cinematic polish. Grain breaks up flat-color
        // banding in the sky/fog; a gentle vignette focuses the eye on the
        // third-person character. Both are cheap and skipped on 'low'/'mobile'.
        if (this._qualityTier === 'high') {
          p.grainEnabled     = true;
          p.grain.intensity  = 6;
          p.grain.animated   = true;
          p.imageProcessing.vignetteEnabled = true;
          p.imageProcessing.vignetteWeight  = 1.4;
          p.imageProcessing.vignetteColor   = new BABYLON.Color4(0, 0, 0, 0);
        }
        return p;
      } catch (_) { /* try next tier */ }
    }
    return null;
  }

  _loadEnvSafe(url) {
    if (!url) return Promise.resolve(null);
    return fetch(url, { method: 'HEAD' })
      .then(r => {
        const ct = r.headers.get('content-type') ?? '';
        if (!r.ok || ct.includes('text/html')) return null;
        // Equirectangular .hdr panoramas load as an HDRCubeTexture; prefiltered
        // .env DDS load as a CubeTexture. Both are cube textures downstream, so
        // _setEnvironment / createDefaultSkybox treat them identically.
        if (/\.hdr(\?|$)/i.test(url)) {
          return new BABYLON.HDRCubeTexture(url, this.scene, 256, false, true, false, true);
        }
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
    if (!this._timeFrozen) this.timeOfDay = (this.timeOfDay + dt * this._hoursPerSec) % 24;

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

    // Published for AshwoodSky (sky dome + fog palette reads these).
    this.dayFactor  = dayFactor;
    this.duskFactor = sunset;

    // Daytime key intensity stepped down again — the previous 1.4 still read
    // too bright on lit characters after the tone-map swap let more color
    // through. 1.0 sits in line with mobile games of this scale.
    this.key.intensity = lerp(0.05, 1.0, dayFactor);
    lerpColor3Into(this.key.diffuse, this._nightDiffuse, this._dayDiffuse, clamp01(dayFactor * 1.25));
    // Moon ceiling raised (was 0.30) — night targets a "bright dusk" rather
    // than true darkness so players can actually see to play.
    this.moon.intensity = lerp(0.0, 0.70, 1.0 - dayFactor);

    // Unified curve for desktop and mobile. Night-side floor raised (was
    // 0.22) alongside the moon/ambient/exposure lift below; day-side (0.28)
    // is untouched.
    this.fillOverworld.intensity = lerp(0.42, 0.28, dayFactor);
    lerpColor3Into(this.fillOverworld.groundColor, this._nightGround, this._dayGround, dayFactor);

    // Day exposure pulled down slightly (was 0.88) so the HDRI skybox blue
    // doesn't blow out behind the cross-faded gradient dome. Night-side
    // raised (was 0.78) so tone-mapped brightness compensates for the
    // dimmer actual scene lighting at night — part of the "bright dusk"
    // night target.
    this.scene.imageProcessingConfiguration.exposure = lerp(0.92, 0.82, dayFactor);
    this.scene.imageProcessingConfiguration.contrast = lerp(1.03, 1.10, sunset);

    this.scene.fogDensity = lerp(0.0022, 0.0016, dayFactor);
    lerpColor3Into(this.scene.fogColor, this._nightFog, this._dayFog, dayFactor);

    // Dynamic ambient: raise at night to keep geometry readable when the key
    // is dim; keep day-side low so the directional light still defines form.
    // Night-side values raised further (were 0.24/0.26/0.32) for playability.
    this.scene.ambientColor.copyFromFloats(
      lerp(0.38, 0.14, dayFactor),
      lerp(0.40, 0.16, dayFactor),
      lerp(0.46, 0.20, dayFactor)
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

    const mood = this._dungeonMood;
    this.scene.imageProcessingConfiguration.exposure = mood?.exposure ?? 0.98;
    this.scene.imageProcessingConfiguration.contrast = 1.12;
    this.fillDungeon.intensity = mood?.fill ?? 0.12;

    this.scene.fogDensity = mood?.fogDensity ?? 0.018;
    if (mood?.fogColor) {
      this.scene.fogColor.copyFromFloats(mood.fogColor[0], mood.fogColor[1], mood.fogColor[2]);
    } else {
      this.scene.fogColor.copyFrom(this._dungeonFog);
    }

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

    // Swap the color-grading LUT to match the zone mood. Passing the (possibly
    // null) target-zone LUT clears grading when that zone's asset is missing or
    // still loading, so a zone never inherits the other zone's grade.
    this._applyColorGrading(overworld
      ? this._lutOverworld
      : (this._dungeonMood?.noGrading ? null : this._lutDungeon));

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

// Persisted graphics prefs (currently just the Phase 6 volumetric-clouds
// opt-in). Read at scene init and written by setVolumetricClouds, so the
// choice sticks across sessions and the dev viewer alike.
const GFX_PREFS_KEY = 'aurisar.world.gfx.v1';
function loadGfxPrefs() {
  try { return JSON.parse(localStorage.getItem(GFX_PREFS_KEY)) ?? {}; }
  catch { return {}; }
}
function saveGfxPrefs(prefs) {
  try { localStorage.setItem(GFX_PREFS_KEY, JSON.stringify(prefs)); }
  catch { /* quota / private mode */ }
}

// ── Dungeon entrance constants ───────────────────────────────────────────────
const DUNGEON_ENTRANCE      = Object.freeze({ x: 0, z: -37 });
const DUNGEON_ENTER_DIST_SQ = 3.5 * 3.5;
const DUNGEON_EXIT_DIST_SQ  = 5.5 * 5.5; // hysteresis band prevents rapid toggling

// Chest pickup: walk within this radius of an unopened chest to loot it.
const CHEST_OPEN_DIST_SQ = 2.5 * 2.5;
const CHEST_SCAN_MS      = 250; // how often to scan (chest count is small)

// ── Main export ──────────────────────────────────────────────────────────────
export class BabylonWorldScene {
  /**
   * @param {object} options  { dayLengthSec?, startTimeOfDay? } — defaults
   *   stay real-time-synced so all players roughly share lighting; the dev
   *   world viewer overrides them for render iteration.
   */
  constructor(canvas, playerInfo, callbacks, options = {}) {
    this.canvas      = canvas;
    this.playerInfo  = playerInfo;
    this.callbacks   = callbacks;
    this.options     = options;

    this._remotePlayers = new Map();
    this._mobs          = new Map(); // mobId(BigInt) -> { root, body, head, hpFill, hpBar, lastHp, maxHp, dead }
    this._campfires     = new Map(); // campfireId(BigInt) -> { root, light, ps, ph }
    this._lastCampfireBuildAt = 0;
    this._lastAttackAt  = 0;          // ms timestamp; throttles spacebar
    this._myIdentity    = null;
    this._keys          = {};
    this._lastPos       = { x: 0, z: 0 };
    this._lastMoving    = false;
    this._lastSentAt    = 0;
    this._chatOpen      = false;
    this._inDungeon     = false;
    this._local         = null;
    this._openedChests  = new Set(); // chest indices already looted this session
    this._lastChestScanAt = 0;       // throttle the proximity scan (~4 Hz)
    this._pendingUpdates    = []; // remote rows queued while _local is loading
    this._pendingMobUpdates = []; // mob rows queued while MobAssetLibrary is loading
    this._spawning          = new Set(); // identity IDs currently being async-spawned

    // Slice 5c: local-player liveness. The server pushes hp / deadUntil
    // through the player row; we mirror them here so `_handleAttackInput`
    // and `_moveLocal` can gate inputs while dead. `_localWasDead` flips
    // false→true on death (so we can snap to the server's authoritative
    // death spot) and true→false on respawn (so we snap to origin where
    // `respawnPlayer` placed us).
    this._localHp        = 100;
    this._localMaxHp     = 100;
    this._localDead      = false;
    this._localWasDead   = false;

    // Mobile touch state — written by setJoystick() from WorldGame's React layer
    this._joyDx = 0;
    this._joyDy = 0;
    // Camera touches (right-half of screen, managed internally by
    // _bindTouchControls): pointerId → {x, y}. 1 pointer orbits, 2 pinch-zoom.
    this._camTouches = new Map();

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

    // Quality tier: single source of truth for how expensive an effect stack a
    // device gets. 'mobile' → no HDR pipeline (GlowLayer fallback), classic
    // shadow map, no SSAO. 'low' → desktop lacking float/MRT render targets:
    // pipeline still builds (non-HDR) but SSAO2/CSM are skipped. 'high' →
    // desktop with the render-target support SSAO2 + cascaded shadows need.
    // Overridable via options.qualityTier for QA/forcing a tier.
    this._qualityTier = this._resolveQualityTier();

    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.07, 0.10, 0.18, 1);

    // Pure-math world model (heightfield, biomes, trails, sites).
    // Deterministic from the canon seed — every client computes the same
    // world, which multiplayer requires. All entity Y placement must go
    // through this._worldgen.surfaceY(x, z); the server only knows 2D.
    this._worldgen = createWorldgen(zone1WorldConfig);

    // Camera must exist before LightingManager — its pipelines need a target
    this._setupCamera();

    // Seed the day/night cycle from the device's real local time so the
    // world matches the player's actual time of day, then run at real speed
    // (1 real-time second = 1 game-time second).
    const now = new Date();
    const realHour = now.getHours() + now.getMinutes() / 60;
    this._lm = new LightingManager(this.scene, this._camera, this.engine, {
      isMobile: this._isMobile,
      qualityTier: this._qualityTier,
      startTimeOfDay: this.options.startTimeOfDay ?? realHour,
      dayLengthSec:   this.options.dayLengthSec   ?? 86400,
    });

    // Ashwood sky dome + fog palette (registered after the LM so its fog
    // writes win the frame). The metadata seam lets tile providers (water
    // shader) read the lighting state without a direct reference.
    this._sky = new AshwoodSky(this.scene, this._lm, this._worldgen,
      () => this._local?.root?.position ?? null);
    this.scene.metadata = {
      ...(this.scene.metadata || {}),
      ashwood: {
        lm: this._lm,
        worldgen: this._worldgen,
        castShadow: (mesh) => this._castShadow(mesh),
        qualityTier: this._qualityTier,
      },
    };

    this._setupShadows();
    this._setupSSAO();

    // Phase 6 (opt-in): raymarched volumetric clouds. High tier only, off by
    // default, persisted via the graphics prefs — the game-menu toggle calls
    // setVolumetricClouds(). Created after the metadata seam exists (its
    // observer reads lm/weather from there).
    this._volClouds = null;
    if (this._qualityTier === 'high' && loadGfxPrefs().volumetricClouds) {
      this.setVolumetricClouds(true);
    }

    this._setupTileStreaming();
    this._buildDungeonEntrance();

    // Player-following vegetation + ambient life (one draw call grass).
    // The old AshwoodAtmosphere billboard motes/fireflies are gone — the
    // glowing orbs orbiting the player read as visual bugs, and clouds now
    // live in the AshwoodSky dome shader.
    const playerPos = () => this._local?.root?.position ?? null;
    this._grass = new AshwoodGrass(this.scene, this._worldgen, playerPos);
    this._wildlife = new AshwoodWildlife(this.scene, this._worldgen, playerPos);
    this._weather = new AshwoodWeather(this.scene, this._lm, playerPos);

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
      AssetLibrary,
    );
    this._local.root.position.set(0, this._worldgen.surfaceY(0, 0), 0);
    // Flush remote updates that arrived while we were loading.
    // Mobs first — they can spawn independently of `_local` once
    // MobAssetLibrary is ready, and we want them visible ASAP.
    const pendingMobs = this._pendingMobUpdates.splice(0);
    for (const row of pendingMobs) this.applyMobUpdate(row);
    const pending = this._pendingUpdates.splice(0);
    for (const row of pending) this.applyPlayerUpdate(row);

    // P1: content-defined hub NPCs. Not load-critical — quest UI degrades
    // to the quest log if a model fails. Markers set by React may have
    // arrived before init finished; re-apply them.
    this._npcs = new NpcSystem(this.scene, this._worldgen, AssetLibrary);
    this._npcs.init()
      .then(() => {
        if (this._pendingNpcMarkers) this._npcs?.setMarkers(this._pendingNpcMarkers);
      })
      .catch((err) => console.warn('[NpcSystem] init failed:', err));

    // Hub settlement + camp props (CC0 GLBs). Independent of NPC
    // loading; missing files skip silently.
    this._props = new PropsSystem(this.scene, this._worldgen);
    this._props.init().catch((err) => console.warn('[PropsSystem] init failed:', err));

    // Castle Ashwood: exterior shell on the terrain + enterable interior
    // "instance" in the flat far-east interiors region. Built async,
    // chunked per level, so first render never blocks. While the player is
    // inside, castle nav replaces the terrain snap in _moveLocal.
    this._castle = new CastleSystem(this.scene, this._worldgen, this._lm, {
      isMobile: this._isMobile,
      castShadow: (m) => this._castShadow(m),
      getPlayerPos: () => this._local?.root?.position ?? null,
      getAvatarMeshes: () => this._local?.root?.getChildMeshes?.() ?? [],
      teleportPlayer: (x, y, z, yaw) => this._teleportLocal(x, y, z, yaw),
      cameraEnter: (t, yaw) => this._castleCameraSet(t, yaw, true),
      cameraExit: (t = null, yaw = 0) => this._castleCameraSet(t, yaw, false),
      onZoneChange: (zone) => this.callbacks.onZoneChange?.(zone),
      onNearbyDoor: (info) => this.callbacks.onNearbyDoor?.(info),
    });
    this._castle.init().catch((err) => console.warn('[CastleSystem] init failed:', err));
  }

  /** React → scene: per-NPC quest markers ('!' / '?' / null). */
  setNpcMarkers(markers) {
    this._pendingNpcMarkers = markers;
    this._npcs?.setMarkers(markers);
  }

  /** Local player position in world meters (for waypoint checks). */
  getLocalPosition() {
    const p = this._local?.root?.position;
    return p ? { x: p.x, z: p.z } : null;
  }

  // Throttled proximity scan for the "Talk" prompt. Fires the callback only
  // on change so React state stays quiet while idle.
  _pollNearbyNpc() {
    const now = performance.now();
    if (now - (this._lastNpcPoll ?? 0) < 200) return;
    this._lastNpcPoll = now;
    const p = this._local?.root?.position;
    if (!p || !this._npcs) return;
    const npc = this._npcs.nearestInRange(p.x, p.z, 5);
    const id = npc?.id ?? null;
    if (id !== this._nearbyNpcId) {
      this._nearbyNpcId = id;
      this.callbacks.onNearbyNpc?.(id);
    }
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  // Resolve the device quality tier. Mobile is always its own tier (the
  // DefaultRenderingPipeline is skipped there regardless). On desktop, SSAO2
  // and cascaded shadows both need float/half-float render targets and MRT;
  // where those are missing we drop to 'low' so those effects are skipped but
  // the rest of the stack still runs.
  _resolveQualityTier() {
    if (this.options.qualityTier) return this.options.qualityTier;
    if (this._isMobile) return 'mobile';
    const caps = this.engine?.getCaps?.() ?? null;
    const canHeavy = !!caps &&
      (caps.textureHalfFloatRender || caps.textureFloatRender) &&
      !!caps.drawBuffersExtension;
    return canHeavy ? 'high' : 'low';
  }

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
    cam.upperRadiusLimit     = 34;
    cam.lowerBetaLimit       = 0.25;
    // Initial cap only — _trackCamera raises it dynamically (terrain-aware)
    // every frame so the player can tilt up past the horizon to see the sky
    // without the camera dipping under the ground.
    cam.upperBetaLimit       = Math.PI / 2.1;
    cam.wheelPrecision       = 60;
    // 0.01 (1%/notch) needed ~120 wheel notches for a full zoom-out — read
    // as "zoom doesn't work". 5%/notch covers the range in ~2 flicks.
    cam.wheelDeltaPercentage = 0.05;
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

    // Right-half pointers, insertion-ordered: pointerId → {x, y}. One pointer
    // orbits, two pinch-zoom. The previous version tracked the two fingers
    // asymmetrically (a "camera" finger + a "pinch" finger) and only zoomed
    // when the SECOND finger moved — anchoring it and moving the first read
    // as "zoom is stuck" — and lifting the first finger mid-pinch cleared
    // both trackers while the second was still on the glass, dead-ending the
    // gesture until every finger lifted. Both fingers are now equal peers:
    // distance is recomputed on either finger's move, and when one lifts the
    // survivor keeps orbiting seamlessly (its stored position is current, so
    // there's no positional jump either).
    const touches = this._camTouches;
    touches.clear();
    let pinchDist = 0;

    const distance = () => {
      const [a, b] = touches.values();
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const onDown = (e) => {
      const rect = canvas.getBoundingClientRect();
      // Left-half touches belong to the React joystick overlay; a 3rd+
      // right-half finger is ignored rather than hijacking the pinch.
      if (e.clientX - rect.left < rect.width / 2 || touches.size >= 2) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) pinchDist = distance();
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const onMove = (e) => {
      const t = touches.get(e.pointerId);
      if (!t) return;
      if (touches.size === 1) {
        cam.alpha -= (e.clientX - t.x) * 0.006;
        cam.beta   = Math.max(cam.lowerBetaLimit,
                     Math.min(cam.upperBetaLimit, cam.beta + (e.clientY - t.y) * 0.006));
      }
      t.x = e.clientX;
      t.y = e.clientY;
      if (touches.size === 2) {
        const dist = distance();
        cam.radius = Math.max(cam.lowerRadiusLimit,
                     Math.min(cam.upperRadiusLimit, cam.radius + (pinchDist - dist) * 0.075));
        pinchDist = dist;
      }
      e.preventDefault();
    };

    const onUp = (e) => {
      if (touches.delete(e.pointerId)) e.preventDefault();
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
    // High tier: cascaded shadow maps. Multiple cascades pack resolution near
    // the third-person character where it reads, and hold up across the
    // streamed terrain instead of one blurry map. stabilizeCascades is the
    // critical setting for this camera — it kills the shadow "swimming" that
    // an ArcRotateCamera orbit would otherwise cause. shadowMaxZ is capped to
    // the fog horizon so cascades don't waste texels on invisible distance.
    if (this._qualityTier === 'high') {
      try {
        const csm = new BABYLON.CascadedShadowGenerator(2048, this._lm.key);
        csm.numCascades              = 4;
        csm.lambda                   = 0.8;   // logarithmic split (near detail)
        csm.stabilizeCascades        = true;
        csm.shadowMaxZ               = 80;
        csm.cascadeBlendPercentage   = 0.1;
        csm.depthClamp               = true;
        csm.usePercentageCloserFiltering = true;
        csm.filteringQuality         = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
        csm.bias                     = 0.001;
        csm.normalBias               = 0.02;
        this._shadowGen = csm;
        return;
      } catch { /* fall through to the classic single-map path */ }
    }

    // Low / mobile (or CSM construction failure): classic single shadow map.
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
    // High tier only. SSAO2 needs the float/MRT render targets that the mobile
    // path can't rely on, so it is skipped on 'low' and 'mobile'. The previous
    // disable was a blanket perf cut; the retune below halves the AO buffer
    // (ssaoRatio 0.5), drops to 8 samples, and caps maxZ at the fog horizon so
    // distant tiles pay no AO cost — the combination that made it affordable.
    if (this._qualityTier !== 'high') { this._ssao = null; return; }

    try {
      const ssao = new BABYLON.SSAO2RenderingPipeline(
        'ssao', this.scene,
        { ssaoRatio: 0.5, blurRatio: 1 },
        [this._camera]
      );
      ssao.radius        = 1.2;   // world units — small contact-AO radius
      ssao.totalStrength = 1.0;
      ssao.expensiveBlur = false;
      ssao.samples       = 8;
      ssao.maxZ          = 60;    // matches fog falloff
      ssao.minZAspect    = 0.2;
      this._ssao = ssao;
    } catch {
      // SSAO2 unavailable (missing GPU support) — scene still renders.
      this._ssao = null;
    }
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
    if (this._castle?.isInside()) return; // castle owns the lighting profile
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

  // Client-side chest looting. Mirrors _checkDungeonProximity's squared-distance
  // pattern but throttled to CHEST_SCAN_MS since chests don't move and the count
  // is small. Walking onto an unopened chest fires onChestOpen({ id, seed }) once;
  // React (useInventory) rolls deterministic loot from the seed.
  _checkChestProximity() {
    if (!this._local || this._localDead) return;
    const chests = this._worldgen?.sites?.chests;
    if (!chests || !chests.length) return;

    const now = performance.now();
    if (now - this._lastChestScanAt < CHEST_SCAN_MS) return;
    this._lastChestScanAt = now;

    const { x, z } = this._local.root.position;
    for (let i = 0; i < chests.length; i++) {
      if (this._openedChests.has(i)) continue;
      const c = chests[i];
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < CHEST_OPEN_DIST_SQ) {
        this._openedChests.add(i);
        this.callbacks.onChestOpen?.({ id: i, seed: c.seed });
      }
    }
  }

  // ── Tile streaming ─────────────────────────────────────────────────────────
  // World geometry comes from the tile streamer driven by
  // world_build_config.tiling_streaming. Tiles are generated on demand by
  // AshwoodTileProvider, which evaluates the deterministic Ashwood
  // heightfield/biome math (src/features/world/worldgen/) per tile — the
  // same model on every client. When USE_GLB_TILES is on, baked .glb tiles
  // from /assets/tiles/ take priority and the provider is the 404 fallback.

  _setupTileStreaming() {
    const ashwood = new AshwoodTileProvider(worldBuildConfig, this._worldgen);
    const provider = USE_GLB_TILES
      ? new FallbackTileProvider(new GlbTileProvider(), ashwood)
      : ashwood;
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

    // Base the gate on the Ashwood terrain at the entrance.
    const gy = this._worldgen.surfaceY(x, z);

    // Pillars
    const pL = BABYLON.MeshBuilder.CreateBox('dunPillarL', { width: 0.9, height: 5.2, depth: 0.9 }, this.scene);
    pL.position.set(x - 2.1, gy + 2.6, z);
    pL.material = stone;
    this._castShadow(pL);

    const pR = BABYLON.MeshBuilder.CreateBox('dunPillarR', { width: 0.9, height: 5.2, depth: 0.9 }, this.scene);
    pR.position.set(x + 2.1, gy + 2.6, z);
    pR.material = stone;
    this._castShadow(pR);

    // Lintel
    const lintel = BABYLON.MeshBuilder.CreateBox('dunLintel', { width: 5.1, height: 0.75, depth: 0.9 }, this.scene);
    lintel.position.set(x, gy + 5.575, z);
    lintel.material = stone;
    this._castShadow(lintel);

    // Portal plane — emissive, slightly transparent
    const portalMat = new BABYLON.StandardMaterial('dunPortalMat', this.scene);
    portalMat.diffuseColor    = new BABYLON.Color3(0.15, 0.10, 0.35);
    portalMat.emissiveColor   = new BABYLON.Color3(0.20, 0.10, 0.55);
    portalMat.alpha           = 0.45;
    portalMat.backFaceCulling = false;

    const portal = BABYLON.MeshBuilder.CreatePlane('dunPortal', { width: 3.3, height: 4.8 }, this.scene);
    portal.position.set(x, gy + 2.6, z);
    portal.material = portalMat;

    // Pulsing accent light in the gateway
    const gLight = new BABYLON.PointLight('dunGateLight', new BABYLON.Vector3(x, gy + 2.5, z), this.scene);
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
    labelRoot.position.set(x, gy + 6.8, z);
    this._makeLabel('dunEntrance', 'Dungeon Entrance', labelRoot);
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
    this._checkChestProximity();
    this._castle?.checkProximity();
    this._streamTiles();
    this._handleAttackInput();
    this._handleCampfireInput();
    this._trackCamera();
    this._syncStdb();

    this._remotePlayers.forEach(rp => {
      this._lerpRemote(rp, dt);
      rp.update(dt);
    });

    // NPCs: idle animation pump + proximity scan for the talk prompt.
    this._npcs?.update(dt);
    this._pollNearbyNpc();

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
    m.root.position.y = this._worldgen.surfaceY(m.root.position.x, m.root.position.z);

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
    // GLB path first; EVERY mob type gets a primitive fallback otherwise
    // (quadruped with a per-type palette, humanoid for bandits). A server
    // row must never be invisible — its AI can still attack and quests
    // need it killable. (Codex P1 on #219.)
    const hasGlb = MobAssetLibrary.hasContainer(row.mobType);

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
    // Bipedal families read wrong as quadrupeds — use the humanoid
    // composite with a per-family palette.
    const family = MOB_DEFS[row.mobType]?.family ?? 'beast';
    const HUMANOID_TINTS = {
      humanoid: { leather: [0.23, 0.18, 0.14], cloth: [0.16, 0.16, 0.20], skin: [0.62, 0.48, 0.36] },
      kobold:   { leather: [0.35, 0.24, 0.10], cloth: [0.30, 0.20, 0.08], skin: [0.61, 0.39, 0.05] },
      undead:   { leather: [0.55, 0.57, 0.55], cloth: [0.35, 0.37, 0.36], skin: [0.84, 0.86, 0.86] },
      murloc:   { leather: [0.20, 0.45, 0.28], cloth: [0.15, 0.35, 0.22], skin: [0.32, 0.75, 0.50] },
    };
    if (HUMANOID_TINTS[family]) {
      this._buildHumanoidPrimitive(row, visual, HUMANOID_TINTS[family]);
      return;
    }

    // Quadruped composite with a per-type palette. Placeholder whenever a
    // mob type's GLB is missing from public/assets/mobs/.
    const LOOKS = {
      forest_wolf: { body: [0.28, 0.26, 0.24], pale: [0.55, 0.50, 0.44], dark: [0.12, 0.11, 0.10], scale: [1, 1, 1] },
      old_greyjaw: { body: [0.20, 0.21, 0.22], pale: [0.45, 0.46, 0.46], dark: [0.10, 0.10, 0.10], scale: [1.25, 1.25, 1.25] },
      wild_boar:   { body: [0.38, 0.27, 0.18], pale: [0.66, 0.58, 0.46], dark: [0.20, 0.13, 0.08], scale: [1.25, 0.85, 1.05] },
      webwood_spider: { body: [0.29, 0.14, 0.35], pale: [0.45, 0.30, 0.50], dark: [0.12, 0.06, 0.15], scale: [1.1, 0.6, 1.1] },
    };
    const look = LOOKS[row.mobType] ?? LOOKS.forest_wolf;
    visual.scaling.set(look.scale[0], look.scale[1], look.scale[2]);

    const bodyMat = this._stdMat(`mob_${row.mobType}_body`, new BABYLON.Color3(...look.body));
    const pale    = this._stdMat(`mob_${row.mobType}_pale`, new BABYLON.Color3(...look.pale));
    const dark    = this._stdMat(`mob_${row.mobType}_dark`, new BABYLON.Color3(...look.dark));

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

  // Hooded-humanoid primitive (bipedal families). Same placeholder posture
  // as the quadruped: static composite under `visual`, swapped out the
  // moment a GLB lands in public/assets/mobs/.
  _buildHumanoidPrimitive(row, visual, tints) {
    const family  = MOB_DEFS[row.mobType]?.family ?? 'humanoid';
    const leather = this._stdMat(`mob_${family}_leather`, new BABYLON.Color3(...tints.leather));
    const cloth   = this._stdMat(`mob_${family}_cloth`,   new BABYLON.Color3(...tints.cloth));
    const skin    = this._stdMat(`mob_${family}_skin`,    new BABYLON.Color3(...tints.skin));

    // Torso
    const torso = BABYLON.MeshBuilder.CreateBox(`mob_torso_${row.mobId}`, {
      width: 0.52, height: 0.70, depth: 0.30,
    }, this.scene);
    torso.parent = visual;
    torso.position.set(0, 1.05, 0);
    torso.material = leather;
    this._castShadow(torso);

    // Head + hood
    const head = BABYLON.MeshBuilder.CreateBox(`mob_head_${row.mobId}`, {
      width: 0.28, height: 0.28, depth: 0.28,
    }, this.scene);
    head.parent = visual;
    head.position.set(0, 1.56, 0);
    head.material = skin;
    this._castShadow(head);

    const hood = BABYLON.MeshBuilder.CreateCylinder(`mob_hood_${row.mobId}`, {
      diameterTop: 0.06, diameterBottom: 0.40, height: 0.34, tessellation: 6,
    }, this.scene);
    hood.parent = visual;
    hood.position.set(0, 1.74, -0.02);
    hood.material = cloth;

    // Legs
    for (const sign of [-1, 1]) {
      const leg = BABYLON.MeshBuilder.CreateCylinder(`mob_hleg_${row.mobId}_${sign}`, {
        diameter: 0.16, height: 0.70, tessellation: 6,
      }, this.scene);
      leg.parent = visual;
      leg.position.set(sign * 0.14, 0.35, 0);
      leg.material = cloth;
      this._castShadow(leg);
    }

    // Arms
    for (const sign of [-1, 1]) {
      const arm = BABYLON.MeshBuilder.CreateCylinder(`mob_arm_${row.mobId}_${sign}`, {
        diameter: 0.13, height: 0.60, tessellation: 6,
      }, this.scene);
      arm.parent = visual;
      arm.position.set(sign * 0.34, 1.10, 0);
      arm.rotation.z = sign * 0.12;
      arm.material = leather;
      this._castShadow(arm);
    }
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
    if (this._localDead) return;            // slice 5c: dead players can't swing
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
    // Chat no longer blocks movement — only WASD is gated while typing (see
    // _bindKeys), so keyboard input can't leak into the chat box, but the
    // touch joystick (and any already-held keys) keep moving the player.
    if (this._localDead) { this._local.isMoving = false; return; }   // slice 5c: dead can't walk

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
    const prevX = pos.x, prevZ = pos.z;
    pos.addInPlace(this._moveDir.scale(speed * dt * speedScale));
    if (this._castle?.isInside()) {
      // Castle interior: the nav grid owns walls, floors and stairs. The
      // radial world clamp is intentionally bypassed — the interior sits at
      // x≈840, far outside the overworld disc; its walls are the containment.
      this._castle.nav.resolveMove(prevX, prevZ, pos);
    } else {
      // Keep inside the Ashwood world disc (the prototype's keepInWorld) and
      // stand on the terrain — height is a pure client-side function of (x,z).
      const maxR = this._worldgen.config.radius - 2;
      const rr = Math.hypot(pos.x, pos.z);
      if (rr > maxR) {
        pos.x *= maxR / rr;
        pos.z *= maxR / rr;
      }
      // the castle's exterior walls are solid — no walking into the shell
      this._castle?.resolveShellCollision(prevX, prevZ, pos);
      pos.y = this._worldgen.surfaceY(pos.x, pos.z);
    }

    const target = Math.atan2(this._moveDir.x, this._moveDir.z);
    this._local.root.rotation.y = this._lerpAngle(
      this._local.root.rotation.y, target, 0.18
    );
  }

  // ── Castle bridge ───────────────────────────────────────────────────────────

  /** Ground height for entity pinning: castle nav while inside, else terrain. */
  _groundYFor(x, z, currentY) {
    if (this._castle?.isInside()) {
      const s = this._castle.nav.surfaceAt(x, z, currentY + 0.5);
      if (s) return s.y;
    }
    return this._worldgen.surfaceY(x, z);
  }

  /** Instant client-side teleport (castle door). _lastPos is left at the old
   *  position so _syncStdb's moved-enough check fires immediately and the
   *  server learns the new position on the next tick. */
  _teleportLocal(x, y, z, yaw) {
    if (!this._local) return;
    this._local.root.position.set(x, y, z);
    this._local.root.rotation.y = yaw;
    this._local.isMoving = false;
    this._streamTiles();
  }

  /** Snap the camera across a castle enter/exit (never lerp 700 m) and
   *  switch wall handling. Indoors the ENGINE's camera collision takes
   *  over (against the castle's invisible proxy boxes): it slides the view
   *  along walls and recovers by itself, and it never mutates radius/beta
   *  state — so zoom and orbit cannot get stuck. No per-frame camera math.
   */
  _castleCameraSet(target, yaw, interior) {
    const cam = this._camera;
    if (interior) {
      if (this._savedUpperRadius == null) {
        this._savedUpperRadius = cam.upperRadiusLimit;
        this._savedLowerRadius = cam.lowerRadiusLimit;
      }
      cam.upperRadiusLimit = 18; // the big halls deserve a real zoom range
      cam.lowerRadiusLimit = 0.9; // LOS clamp can pull to a near close-up
      // static generous tilt window — per-frame floor/ceiling caps could go
      // degenerate on stairs and lock rotation entirely
      cam.lowerBetaLimit = 0.35;
      cam.upperBetaLimit = 1.54;
      if (cam.radius > 6.5) cam.radius = 6; // start close; player zooms freely after
      this._camUserRadius = cam.radius;
      this._lastCamWritten = cam.radius;
    } else if (this._savedUpperRadius != null) {
      cam.upperRadiusLimit = this._savedUpperRadius;
      cam.lowerRadiusLimit = this._savedLowerRadius ?? 2.5;
      cam.lowerBetaLimit = 0.25;
      this._savedUpperRadius = null;
      this._savedLowerRadius = null;
      this._camUserRadius = null;
      this._lastCamWritten = null;
      cam.radius = Math.min(9, cam.upperRadiusLimit);
    }
    if (target) {
      this._camTarget.set(target.x, target.y, target.z);
      cam.target.copyFrom(this._camTarget);
      cam.alpha = -Math.PI / 2 - yaw; // orbit behind the avatar's new facing
      cam.beta = Math.PI / 3.5;
    }
  }

  /** React → scene: press-E on a castle door prompt. */
  useDoor(id) { this._castle?.useDoor(id); }

  /** Menu testing aid: drop the player in front of the castle gates,
   *  facing them (inside the press-E prompt radius). forceExit resets
   *  interior state without its own teleport, so the single teleport
   *  below covers both the outside and inside starting cases. */
  fastTravelToCastle() {
    if (!this._local || !this._worldgen) return;
    this._castle?.forceExit();
    const g = CASTLE_ENTRY.gateWorld;
    const gy = this._worldgen.surfaceY(g.x, g.z);
    this._teleportLocal(g.x, gy, g.z, Math.PI / 2); // face the gates (+x)
    this._castleCameraSet({ x: g.x, y: gy + 1.2, z: g.z }, Math.PI / 2, false);
  }

  _trackCamera() {
    const p = this._local.root.position;
    this._camTarget.set(p.x, p.y + 1.2, p.z);
    BABYLON.Vector3.LerpToRef(this._camera.target, this._camTarget, 0.12, this._camera.target);

    // Terrain-aware look-up limit. beta = PI/2 is horizontal; the old fixed
    // cap of PI/2.1 meant the camera could never tilt above the horizon, so
    // the upper sky was unviewable and an upward drag hit a dead stop. The
    // cap is now the beta at which the camera would sink to ~0.4 m above the
    // terrain under it (cos(beta) = camY-targetY over radius, solved for the
    // ground height) — zoomed in this allows ~110 deg+ of upward tilt for sky
    // gazing, and it tightens automatically as the radius grows so the camera
    // never clips under the ground. One surfaceY sample + acos per frame.
    const cam = this._camera;
    const camPos = cam.globalPosition;
    if (this._castle?.isInside()) {
      // ── Memoryless third-person camera (the WoW model) ──────────────────
      // The rendered orbit distance is min(userRadius, lineOfSight) computed
      // fresh every frame. userRadius belongs to the PLAYER: it only ever
      // changes by the zoom delta the engine applied since our last write,
      // so no wall interaction can steal the zoom, and the camera can never
      // sit beyond (or inside) a wall — there is no state to get stuck.
      const nav = this._castle.nav;
      if (this._camUserRadius == null) {
        this._camUserRadius = cam.radius;
        this._lastCamWritten = cam.radius;
      } else {
        const delta = cam.radius - this._lastCamWritten; // user zoom since last frame
        if (delta !== 0) {
          this._camUserRadius = Math.min(cam.upperRadiusLimit,
            Math.max(cam.lowerRadiusLimit, this._camUserRadius + delta));
        }
      }
      const tx = cam.target.x, ty = cam.target.y, tz = cam.target.z;
      const dirX = Math.cos(cam.alpha) * Math.sin(cam.beta);
      const dirY = Math.cos(cam.beta);
      const dirZ = Math.sin(cam.alpha) * Math.sin(cam.beta);
      let open = this._camUserRadius;
      const steps = Math.max(2, Math.ceil(this._camUserRadius / 0.35));
      for (let k = 1; k <= steps; k++) {
        const d = (k / steps) * this._camUserRadius;
        const sx = tx + dirX * d, sy = ty + dirY * d, sz = tz + dirZ * d;
        if (!nav.isOpenBelow(sx, sz, sy) ||
            sy > this._castle.ceilingYAt(sx, sz, ty)) {
          open = Math.max(cam.lowerRadiusLimit, d - 0.4);
          break;
        }
      }
      const write = Math.min(this._camUserRadius, open);
      cam.radius = write;
      this._lastCamWritten = write;
    } else {
      // outdoors: terrain-aware upward tilt cap (pre-castle behavior)
      const groundY = this._worldgen.surfaceY(camPos.x, camPos.z) + 0.4;
      const cosCap = Math.max(-1, Math.min(1, (groundY - cam.target.y) / cam.radius));
      cam.upperBetaLimit = Math.max(Math.PI / 2.1, Math.min(2.0, Math.acos(cosCap)));
    }
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
    if (key === this._myIdentity) {
      this._applyLocalPlayerUpdate(row);
      return;
    }
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

  // Slice 5c: handle the local player's own row updates. We don't lerp
  // position from the server (the local avatar is client-authoritative
  // for smoothness while moving), but we DO snap on death/respawn
  // transitions so the "you died" overlay shows over the right spot and
  // respawn puts the camera at origin.
  _applyLocalPlayerUpdate(row) {
    this._localHp    = row.hp ?? this._localMaxHp;
    this._localMaxHp = row.maxHp ?? this._localMaxHp;

    const now = (typeof BigInt === 'function' ? BigInt(Date.now()) * 1000n : 0n);
    const isDead = (row.hp ?? this._localMaxHp) <= 0 ||
                   (typeof row.deadUntil === 'bigint' && row.deadUntil > now);

    if (isDead && !this._localWasDead) {
      // Just died — pin the local avatar at the server's death position
      // so the death overlay covers a static scene. Without this, the
      // client's keyboard-driven _moveLocal could keep walking the corpse.
      if (this._local) {
        this._local.root.position.x = toWorld(row.x);
        this._local.root.position.z = toWorld(row.y);
        // castle-aware: dying on an upper floor pins the corpse to that
        // floor, not to the flat terrain under the interior region
        this._local.root.position.y = this._groundYFor(
          this._local.root.position.x, this._local.root.position.z,
          this._local.root.position.y);
        this._local.isMoving = false;
      }
    } else if (!isDead && this._localWasDead) {
      // Just respawned — server moved us to origin, snap the local avatar
      // there too so movement input picks up from the new position.
      // Leaving the castle interior first resets lighting, camera limits
      // and the light pool so the player is never stranded in interior mode.
      this._castle?.forceExit();
      if (this._local) {
        this._local.root.position.x = toWorld(row.x);
        this._local.root.position.z = toWorld(row.y);
        this._local.root.position.y = this._worldgen.surfaceY(
          this._local.root.position.x, this._local.root.position.z);
        this._local.isMoving = false;
      }
      // Reset our last-sent cache so the next movePlayer call doesn't
      // get suppressed by the "barely moved" diff check.
      this._lastPos = { x: this._local?.root?.position?.x ?? 0,
                        z: this._local?.root?.position?.z ?? 0 };
      // Snap the camera to the respawn point — the 0.12 target lerp would
      // otherwise sweep it across the world from wherever we died.
      if (this._local) {
        const rp = this._local.root.position;
        this._camTarget.set(rp.x, rp.y + 1.2, rp.z);
        this._camera.target.copyFrom(this._camTarget);
      }
    }
    this._localDead    = isDead;
    this._localWasDead = isDead;

    // Forward to the React layer for HUD HP bar + death overlay rendering.
    this.callbacks?.onLocalPlayerUpdate?.({
      hp:        this._localHp,
      maxHp:     this._localMaxHp,
      dead:      this._localDead,
      deadUntil: row.deadUntil ?? 0n,
    });
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
      // Pass the RAW parsed config — CharacterAvatar merges defaults itself,
      // and null must stay null so unconfigured players render as the bare
      // base-body GLB (no default clothing).
      const rp = await CharacterAvatar.create(
        row.identity, row.username, parsedConfig, this.scene, AssetLibrary,
      );
      if (this._remotePlayers.has(key)) {
        rp.dispose(); // another update already spawned this player
      } else {
        rp._targetX = toWorld(row.x);
        rp._targetZ = toWorld(row.y);
        rp.root.position.set(
          rp._targetX,
          this._worldgen.surfaceY(rp._targetX, rp._targetZ),
          rp._targetZ,
        );
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
    rp.root.position.y = this._worldgen.surfaceY(rp.root.position.x, rp.root.position.z);
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

  // Read-only handle on the deterministic world model for the React map layer
  // (minimap + World Map). Cached: same reference each call so React effects
  // don't re-run. worldgen is built synchronously in the constructor.
  getMapData() {
    return (this._mapData ??= {
      worldgen: this._worldgen,
      config:   this._worldgen.config,
      sites:    this._worldgen.sites,
    });
  }

  // Chest manifest (world units) for optional map plotting.
  getChests() {
    return this._worldgen?.sites?.chests ?? [];
  }

  // Current named location for the minimap / map header readout. Combines the
  // live dungeon state with the geographic label resolver in mapRender.
  getLocation() {
    const p = this._local?.root?.position;
    if (!p) return '';
    if (this._castle?.isInside()) {
      return this._worldgen.config?.interiors?.ashwoodCastle?.name ?? 'Castle Ashwood';
    }
    return locationLabelAt(this._worldgen, p.x, p.z, { inDungeon: this._inDungeon });
  }

  // ── Campfires ──────────────────────────────────────────────────────────────
  // Shared world state: rows arrive from the `campfire` table (every client
  // sees every burning fire) and disappear when the server's burn timer
  // deletes them. Visual is the prototype's buildFire (~3008): log pile,
  // stone ring, glowing coals, rising embers, flickering point light.

  _handleCampfireInput() {
    if (!this._keys['KeyF']) return;
    this.requestBuildCampfire();
  }

  // Public entry shared by the F-key and the on-screen Fire action button.
  // Returns 'built' on a successful reducer call, 'cooldown' if still within
  // the 10s build window, or null when blocked (chat open / dead / no avatar).
  requestBuildCampfire() {
    if (this._chatOpen || this._localDead) return null;
    const now = performance.now();
    // matches the server-side build cadence so held keys don't spam reducer
    // calls that would just be dropped
    if (now - this._lastCampfireBuildAt < 10_000) return 'cooldown';
    const root = this._local?.root;
    if (!root) return null;
    this._lastCampfireBuildAt = now;
    const yaw = root.rotation.y; // avatar faces (sin(yaw), cos(yaw))
    const fx = root.position.x + Math.sin(yaw) * 2.2;
    const fz = root.position.z + Math.cos(yaw) * 2.2;
    this.callbacks.onBuildCampfire?.(toStdb(fx), toStdb(fz));
    return 'built';
  }

  // ── Day/night testing controls ─────────────────────────────────────────────
  // Scrub or freeze the time of day (hours, 0–24). Freezing holds the lighting
  // steady so foliage/water/sky can be evaluated at a chosen time.
  setTimeOfDay(hours, freeze = true) {
    if (!this._lm) return;
    this._lm.setTimeOfDay(hours);
    this._lm.setTimeFrozen(freeze);
  }
  setDayNightFrozen(frozen) { this._lm?.setTimeFrozen(frozen); }
  getTimeOfDay() { return this._lm?.timeOfDay ?? 12; }

  // ── Graphics settings (game menu) ──────────────────────────────────────────

  // Raymarched clouds cost real GPU time — only offered where the rest of the
  // high-tier stack (SSAO2, CSM) already runs.
  supportsVolumetricClouds() { return this._qualityTier === 'high'; }
  getVolumetricClouds() { return !!this._volClouds; }

  setVolumetricClouds(on) {
    saveGfxPrefs({ ...loadGfxPrefs(), volumetricClouds: !!on });
    if (on && !this._volClouds && this._qualityTier === 'high') {
      this._volClouds = new AshwoodVolumetricClouds(this.scene);
    } else if (!on && this._volClouds) {
      this._volClouds.dispose();
      this._volClouds = null;
    }
    // AshwoodSky reads this each frame and fades its 2D deck to a thin haze
    // while the volumetric layer is active, so clouds never double up.
    if (this.scene.metadata?.ashwood) {
      this.scene.metadata.ashwood.volumetricClouds = !!this._volClouds;
    }
  }

  // Snapshot of burning campfires in world units. A campfire only exists in
  // this map while it is lit — the server deletes the row when its burn timer
  // ends — so "near a campfire" is equivalent to "near a lit campfire".
  getCampfires() {
    const out = [];
    this._campfires.forEach((f) => {
      const p = f.root?.position;
      if (p) out.push({ x: p.x, z: p.z });
    });
    return out;
  }

  applyCampfireUpdate(row) {
    if (!this.scene) return;
    if (this._campfires.has(row.campfireId)) return; // rows are immutable; inserts only
    this._spawnCampfire(row);
  }

  _removeCampfire(campfireId) {
    const f = this._campfires.get(campfireId);
    if (!f) return;
    f.ps.dispose();
    f.light.dispose();
    f.root.dispose(false, true);
    this._campfires.delete(campfireId);
    if (this._campfires.size === 0 && this._campfireObserver) {
      this.scene.onBeforeRenderObservable.remove(this._campfireObserver);
      this._campfireObserver = null;
    }
  }

  _campfireMaterials() {
    if (this._campfireShared) return this._campfireShared;
    const mk = (name, hex) => {
      const m = new BABYLON.StandardMaterial(name, this.scene);
      m.diffuseColor = BABYLON.Color3.FromHexString(hex);
      m.specularColor = new BABYLON.Color3(0, 0, 0);
      return m;
    };
    const coal = mk('fire_coal', '#1a0d06');
    coal.emissiveColor = BABYLON.Color3.FromHexString('#ff8030').scale(0.8);
    // soft radial blob for the ember particles
    const tex = new BABYLON.DynamicTexture('fire_spark_tex', { width: 32, height: 32 }, this.scene, false);
    tex.hasAlpha = true;
    const c = tex.getContext();
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    tex.update();
    this._campfireShared = { wood: mk('fire_wood', '#3a2a18'), stone: mk('fire_stone', '#55585c'), coal, tex };
    return this._campfireShared;
  }

  _spawnCampfire(row) {
    const mats = this._campfireMaterials();
    const wx = toWorld(row.x);
    const wz = toWorld(row.y);
    const gy = this._worldgen ? this._worldgen.surfaceY(wx, wz) : 0;

    const root = new BABYLON.TransformNode(`campfire_${row.campfireId}`, this.scene);
    root.position.set(wx, gy, wz);

    // log pile: 5 horizontal logs fanned around the center
    const logs = [];
    for (let i = 0; i < 5; i++) {
      const log = BABYLON.MeshBuilder.CreateCylinder(`cf_log${i}`, {
        diameter: 0.2, height: 0.9, tessellation: 5,
      }, this.scene);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = i * (6.28 / 5);
      log.position.y = 0.12;
      logs.push(log);
    }
    const logPile = BABYLON.Mesh.MergeMeshes(logs, true, true, undefined, false, false);
    logPile.name = `cf_logs_${row.campfireId}`;
    logPile.material = mats.wood;
    logPile.parent = root;
    logPile.isPickable = false;
    this._castShadow(logPile);

    // stone ring
    const stones = [];
    for (let i = 0; i < 6; i++) {
      const st = BABYLON.MeshBuilder.CreateIcoSphere(`cf_st${i}`, { radius: 0.18, subdivisions: 1 }, this.scene);
      st.convertToFlatShadedMesh();
      const a = i * 1.05;
      st.position.set(Math.cos(a) * 0.6, 0.1, Math.sin(a) * 0.6);
      stones.push(st);
    }
    const stoneRing = BABYLON.Mesh.MergeMeshes(stones, true, true, undefined, false, false);
    stoneRing.name = `cf_stones_${row.campfireId}`;
    stoneRing.material = mats.stone;
    stoneRing.parent = root;
    stoneRing.isPickable = false;

    // glowing coal bed
    const coals = BABYLON.MeshBuilder.CreateSphere(`cf_coals_${row.campfireId}`, { diameter: 0.5, segments: 4 }, this.scene);
    coals.scaling.y = 0.35;
    coals.position.y = 0.14;
    coals.material = mats.coal;
    coals.parent = root;
    coals.isPickable = false;

    // rising embers
    const ps = new BABYLON.ParticleSystem(`cf_ps_${row.campfireId}`, 30, this.scene);
    ps.particleTexture = mats.tex;
    ps.emitter = new BABYLON.Vector3(wx, gy + 0.3, wz);
    ps.minEmitBox = new BABYLON.Vector3(-0.2, 0, -0.2);
    ps.maxEmitBox = new BABYLON.Vector3(0.2, 0.15, 0.2);
    ps.color1 = BABYLON.Color4.FromHexString('#ff9a30ff');
    ps.color2 = BABYLON.Color4.FromHexString('#ff5a18ff');
    ps.colorDead = new BABYLON.Color4(0.2, 0.05, 0, 0);
    ps.minSize = 0.1; ps.maxSize = 0.28;
    ps.minLifeTime = 0.4; ps.maxLifeTime = 0.8;
    ps.emitRate = 16;
    ps.direction1 = new BABYLON.Vector3(-0.4, 1.5, -0.4);
    ps.direction2 = new BABYLON.Vector3(0.4, 2.8, 0.4);
    ps.gravity = new BABYLON.Vector3(0, -1.5, 0);
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ONEONE;
    ps.start();

    // flickering warm light
    const light = new BABYLON.PointLight(`cf_light_${row.campfireId}`, new BABYLON.Vector3(wx, gy + 1.2, wz), this.scene);
    light.diffuse = BABYLON.Color3.FromHexString('#ff8030');
    light.range = 18;
    light.intensity = 1.0;

    this._campfires.set(row.campfireId, { root, light, ps, ph: Math.random() * 6.28 });

    if (!this._campfireObserver) {
      this._campfireObserver = this.scene.onBeforeRenderObservable.add(() => {
        const t = performance.now() / 1000;
        this._campfires.forEach((f) => {
          f.light.intensity = 1.0 + Math.sin(t * 12 + f.ph) * 0.18 + Math.random() * 0.12;
        });
      });
    }
  }

  // ── Dispose ────────────────────────────────────────────────────────────────

  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup',   this._ku);
    window.removeEventListener('resize',  this._onResize);
    this._touchCleanup?.();
    [...this._remotePlayers.keys()].forEach(id => this._removeRemote(id));
    [...this._mobs.keys()].forEach(id => this._removeMob(id));
    [...this._campfires.keys()].forEach(id => this._removeCampfire(id));
    this._npcs?.dispose();
    this._npcs = null;
    this._props?.dispose();
    this._props = null;
    this._castle?.dispose();
    this._castle = null;
    this._local?.dispose();
    AssetLibrary.dispose();
    MobAssetLibrary.dispose();
    this._tileLoader?.dispose();
    this._grass?.dispose();
    this._wildlife?.dispose();
    this._weather?.dispose();
    this._volClouds?.dispose();
    this._sky?.dispose();
    this._ssao?.dispose();
    this._shadowGen?.dispose();
    this._lm?.dispose();
    this.engine.stopRenderLoop();
    this.engine.dispose();
  }
}
