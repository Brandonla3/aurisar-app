/**
 * BabylonWorldScene — 3D multiplayer world renderer.
 *
 * Babylon.js is loaded as a UMD CDN script by WorldGame.jsx — NOT imported
 * here. This sidesteps Vite's circular-module issue (MatrixTrackPrecisionChange)
 * that occurs with any @babylonjs/core import path.
 *
 * Coordinate mapping (SpacetimeDB pixel-space <-> 3D world units):
 *   STDB center = 1600 px  ->  3D origin = (0, 0, 0)
 *   1 world unit = 32 STDB px
 */

/* global BABYLON */

// ── Coordinate helpers ──────────────────────────────────────────────────────
const SCALE       = 32;
const STDB_CENTER = 1600;

function toWorld(v) { return (v - STDB_CENTER) / SCALE; }
function toStdb(v)  { return Math.round(v * SCALE + STDB_CENTER); }

// ── Math helpers (used by day/night cycle) ──────────────────────────────────
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp    = (a, b, t) => a + (b - a) * t;
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

    this._init();
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  _init() {
    this.engine = new BABYLON.Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      adaptToDeviceRatio: true,
    });

    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.07, 0.10, 0.18, 1);
    this.scene.fogMode    = BABYLON.Scene.FOGMODE_EXP2;
    // Thinner fog now that the day/night cycle drives its color & a real sky
    // sits behind it. Color is overwritten each frame by _tickDayNight.
    this.scene.fogDensity = 0.0018;
    this.scene.fogColor   = new BABYLON.Color3(0.74, 0.84, 0.96);

    // ACES tone-mapping + slight contrast lift for richer PBR response
    const ip = this.scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType    = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure           = 1.0;
    ip.contrast           = 1.08;

    this._setupEnvironment();
    this._setupLighting();
    this._setupShadows();
    this._setupDayNight();

    // Lighting profile state (overworld is the default; dungeon disables the
    // day/night tick and replaces the rig with torches + magic accents).
    this._lightingProfile = 'overworld';
    this._torches         = [];
    this._magicLights     = [];
    this._dungeonEnv      = null;
    this._buildTerrain();
    this._buildHub();
    this._buildTrees();
    this._buildRocks();
    this._buildPaths();
    this._buildLocalPlayer();
    this._setupCamera();
    this._setupPostProcessing();
    this._bindKeys();

    this.engine.runRenderLoop(() => {
      this._tick();
      this.scene.render();
    });

    this._onResize = () => this.engine.resize();
    window.addEventListener('resize', this._onResize);
  }

  // ── Environment IBL (day + night) ──────────────────────────────────────────
  // Drop prefiltered .env files at /public/env/overworld_day.env and
  // /public/env/overworld_night.env. Each is HEAD-checked first because Vite's
  // SPA fallback returns index.html for missing assets, which Babylon then
  // logs as "Not a babylon environment map". The day/night cycle handles the
  // texture swap; if a file is missing the cycle still runs (just no skybox
  // or IBL contribution from that side).

  _setupEnvironment() {
    this._envDay   = null;
    this._envNight = null;
    this._skybox   = null;

    this._loadEnv('/env/overworld_day.env').then(env => {
      if (!env) return;
      this._envDay = env;
      // Seed scene env to day so first-frame PBR isn't black before _tickDayNight runs
      this.scene.environmentTexture  = env;
      this.scene.environmentIntensity = 0.85;
      this._skybox = this.scene.createDefaultSkybox(env, true, 1500, 0.35);
    });

    this._loadEnv('/env/overworld_night.env').then(env => {
      if (env) this._envNight = env;
    });
  }

  _loadEnv(url) {
    return fetch(url, { method: 'HEAD' })
      .then(r => {
        const ct = r.headers.get('content-type') ?? '';
        if (!r.ok || ct.includes('text/html')) return null;
        return BABYLON.CubeTexture.CreateFromPrefilteredData(url, this.scene);
      })
      .catch(() => null);
  }

  // ── Lighting (3-point RPG rig) ─────────────────────────────────────────────

  _setupLighting() {
    // Key light (sun) — primary directional, also the shadow source
    const key = new BABYLON.DirectionalLight(
      'key', new BABYLON.Vector3(-0.6, -1.0, -0.35), this.scene
    );
    key.position  = new BABYLON.Vector3(12, 20, 8);
    key.intensity = 2.2;
    key.diffuse   = new BABYLON.Color3(0.95, 0.88, 0.75);
    this._keyLight = key;

    // Fill — cool hemispheric to lift shadows. Intensity + groundColor are
    // animated each frame by the day/night cycle.
    const fill = new BABYLON.HemisphericLight(
      'fill', new BABYLON.Vector3(0, 1, 0), this.scene
    );
    fill.intensity   = 0.35;
    fill.groundColor = new BABYLON.Color3(0.15, 0.18, 0.22);
    this._fill = fill;

    // Rim — cool point light for silhouette readability in combat. Stored so
    // the dungeon profile can disable it (we use torches/magic accents there).
    const rim = new BABYLON.PointLight(
      'rim', new BABYLON.Vector3(-2, 2.2, -2.5), this.scene
    );
    rim.diffuse   = new BABYLON.Color3(0.55, 0.62, 0.95);
    rim.intensity = 50;
    rim.range     = 10;
    this._rim = rim;
  }

  // ── Shadows ────────────────────────────────────────────────────────────────

  _setupShadows() {
    const sg = new BABYLON.ShadowGenerator(2048, this._keyLight);
    sg.useBlurExponentialShadowMap = true;
    sg.blurKernel  = 24;
    sg.bias        = 0.0005;
    sg.normalBias  = 0.02;
    this._shadowGen = sg;
  }

  _castShadow(mesh) {
    if (this._shadowGen && mesh) this._shadowGen.addShadowCaster(mesh, true);
  }

  // ── Day / night cycle ──────────────────────────────────────────────────────
  // Drives sun direction/color, moon, fill, ambient, fog, exposure/contrast,
  // and (when env files are present) the skybox + IBL swap. Default cycle is
  // 15 in-game minutes per real second... no wait — 24 in-game hours per 15
  // real minutes, starting at 09:00.

  _setupDayNight() {
    this._timeOfDay    = 9.0;
    this._dayLengthSec = 900;          // real seconds for a full 24h cycle
    this._hoursPerSec  = 24 / this._dayLengthSec;

    const moon = new BABYLON.DirectionalLight(
      'moon', new BABYLON.Vector3(0.3, -1.0, 0.2), this.scene
    );
    moon.intensity = 0;
    moon.diffuse   = new BABYLON.Color3(0.55, 0.62, 0.90);
    moon.specular  = new BABYLON.Color3(0.25, 0.30, 0.45);
    this._moon = moon;

    this._dayNight = {
      sunDay:           new BABYLON.Color3(1.00, 0.97, 0.92),
      sunSunset:        new BABYLON.Color3(1.00, 0.72, 0.48),
      ambientDay:       new BABYLON.Color3(0.62, 0.70, 0.80),
      ambientNight:     new BABYLON.Color3(0.10, 0.13, 0.20),
      fogDay:           new BABYLON.Color3(0.74, 0.84, 0.96),
      fogNight:         new BABYLON.Color3(0.06, 0.08, 0.12),
      fillGroundDay:    new BABYLON.Color3(0.22, 0.24, 0.26),
      fillGroundNight:  new BABYLON.Color3(0.05, 0.06, 0.08),
    };
  }

  _tickDayNight(dtMs) {
    const dn = this._dayNight;
    if (!dn) return;

    this._timeOfDay = (this._timeOfDay + (dtMs / 1000) * this._hoursPerSec) % 24;

    // Sun phase: 0 at midnight, 0.5 at noon
    const phase    = this._timeOfDay / 24;
    const sunTheta = phase * Math.PI * 2 - Math.PI / 2;
    const sunDir   = new BABYLON.Vector3(
      Math.cos(sunTheta) * 0.35,
      -Math.sin(sunTheta),
       Math.sin(sunTheta) * 0.65
    ).normalize();

    this._keyLight.direction.copyFrom(sunDir);

    const sunHeight = -sunDir.y;                                          // >0 above horizon
    const dayFactor = clamp01((sunHeight + 0.08) / 0.22);                 // smooth dawn/dusk
    const sunset    = clamp01(1 - Math.abs(sunHeight) / 0.22) * dayFactor;

    // Sun
    this._keyLight.intensity = lerp(0.05, 2.4, dayFactor);
    this._keyLight.diffuse   = lerpColor3(dn.sunSunset, dn.sunDay, clamp01(dayFactor * 1.25));

    // Moon (inverse direction, ramps in at night)
    this._moon.direction.copyFrom(sunDir.scale(-1));
    this._moon.intensity = lerp(0, 0.65, 1 - dayFactor);

    // Fill / ambient
    this._fill.intensity   = lerp(0.18, 0.40, dayFactor);
    this._fill.groundColor = lerpColor3(dn.fillGroundNight, dn.fillGroundDay, dayFactor);
    this.scene.ambientColor = lerpColor3(dn.ambientNight, dn.ambientDay, dayFactor);

    // Image processing (slightly warmer contrast at sunset)
    const ip = this.scene.imageProcessingConfiguration;
    ip.exposure = lerp(0.65, 1.05, dayFactor);
    ip.contrast = lerp(1.03, 1.10, sunset);

    // Fog
    this.scene.fogColor = lerpColor3(dn.fogNight, dn.fogDay, dayFactor);

    // Env + skybox (hard switch at noon/midnight; only swaps when env loaded)
    if (dayFactor > 0.5) {
      if (this._envDay && this.scene.environmentTexture !== this._envDay) {
        this.scene.environmentTexture = this._envDay;
        if (this._skybox?.material) this._skybox.material.reflectionTexture = this._envDay;
      }
      this.scene.environmentIntensity = lerp(0.35, 0.95, dayFactor);
    } else {
      if (this._envNight && this.scene.environmentTexture !== this._envNight) {
        this.scene.environmentTexture = this._envNight;
        if (this._skybox?.material) this._skybox.material.reflectionTexture = this._envNight;
      }
      this.scene.environmentIntensity = lerp(0.25, 0.50, dayFactor);
    }
  }

  // ── Lighting profile switcher ──────────────────────────────────────────────
  // Public entry point. `'overworld'` re-enables the day/night cycle; `'dungeon'`
  // freezes it and reconfigures the rig with low ambient + warm torch points
  // (with flicker) + cool magic accents and denser fog.

  setLightingProfile(profile) {
    if (profile === this._lightingProfile) return;
    this._teardownProfile();
    this._lightingProfile = profile;
    if (profile === 'dungeon')   this._applyDungeonProfile();
    else                          this._applyOverworldProfile();
  }

  _teardownProfile() {
    this._torches.forEach(({ light, observer }) => {
      this.scene.onBeforeRenderObservable.remove(observer);
      light.dispose();
    });
    this._torches = [];
    this._magicLights.forEach(({ light, observer }) => {
      this.scene.onBeforeRenderObservable.remove(observer);
      light.dispose();
    });
    this._magicLights = [];
    if (this._dungeonEnv) {
      this._dungeonEnv.dispose();
      this._dungeonEnv = null;
    }
  }

  _applyOverworldProfile() {
    const scene = this.scene;
    scene.clearColor   = new BABYLON.Color4(0.07, 0.10, 0.18, 1);
    scene.fogDensity   = 0.0018;
    this._rim.setEnabled(true);
    this._moon.setEnabled(true);
    if (this._envDay) {
      scene.environmentTexture  = this._envDay;
      scene.environmentIntensity = 0.85;
    } else {
      scene.environmentTexture = null;
    }
    // Day/night cycle resumes on the next _tick and re-drives key/fill/moon,
    // ambient, fog color, exposure and contrast.
  }

  _applyDungeonProfile() {
    const scene = this.scene;
    scene.clearColor   = new BABYLON.Color4(0.03, 0.035, 0.045, 1);
    scene.ambientColor = new BABYLON.Color3(0.06, 0.07, 0.09);
    scene.fogDensity   = 0.018;
    scene.fogColor     = new BABYLON.Color3(0.06, 0.07, 0.085);

    const ip = scene.imageProcessingConfiguration;
    ip.exposure = 0.82;
    ip.contrast = 1.12;

    // Repurpose the key directional as a soft "bounce" so unlit faces stay
    // readable without flooding the scene.
    this._keyLight.direction.copyFromFloats(0.3, -1.0, 0.1);
    this._keyLight.intensity = 0.25;
    this._keyLight.diffuse   = new BABYLON.Color3(0.34, 0.36, 0.42);

    // Soft global fill, cool top / warm-ish ground
    this._fill.intensity   = 0.12;
    this._fill.diffuse     = new BABYLON.Color3(0.24, 0.27, 0.32);
    this._fill.groundColor = new BABYLON.Color3(0.06, 0.05, 0.05);

    // Disable overworld-only lights
    this._moon.setEnabled(false);
    this._rim.setEnabled(false);

    // Optional dungeon IBL (HEAD-checked; reflections still matter for metals)
    this._loadEnv('/env/dungeon_dim.env').then(env => {
      // Bail if the user already switched back before the load resolved.
      if (!env || this._lightingProfile !== 'dungeon') {
        if (env) env.dispose();
        return;
      }
      this._dungeonEnv          = env;
      scene.environmentTexture  = env;
      scene.environmentIntensity = 0.35;
    });

    // Warm torches at the four pillar caps
    [[-8, -8], [8, -8], [-8, 8], [8, 8]].forEach(([x, z], i) => {
      this._torches.push(this._createTorchLight(
        new BABYLON.Vector3(x, 5.0, z),
        { name: `torch${i}` }
      ));
    });

    // Cool magic accent on the obelisk gem
    this._magicLights.push(this._createMagicAccent(
      new BABYLON.Vector3(0, 11, 0),
      { name: 'magicGem', intensity: 18, range: 10,
        color: new BABYLON.Color3(0.40, 0.50, 1.00) }
    ));
  }

  _createTorchLight(position, opts = {}) {
    const {
      color         = new BABYLON.Color3(1.0, 0.58, 0.22),
      intensity     = 35,
      range         = 11,
      flickerSpeed  = 8.0,
      flickerAmount = 0.18,
      name          = 'torch',
    } = opts;

    const light = new BABYLON.PointLight(name, position.clone(), this.scene);
    light.diffuse   = color;
    light.specular  = new BABYLON.Color3(0.12, 0.08, 0.04);
    light.intensity = intensity;
    light.range     = range;

    const phase = Math.random() * Math.PI * 2;
    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() * 0.001;
      const noise =
        Math.sin(t * flickerSpeed         + phase)       * 0.6 +
        Math.sin(t * flickerSpeed * 2.37  + phase * 1.7) * 0.4;
      light.intensity = intensity * (1 + noise * flickerAmount);
    });

    return { light, observer };
  }

  _createMagicAccent(position, opts = {}) {
    const {
      color       = new BABYLON.Color3(0.35, 0.55, 1.0),
      intensity   = 22,
      range       = 8,
      pulseSpeed  = 2.0,
      pulseAmount = 0.15,
      name        = 'magicAccent',
    } = opts;

    const light = new BABYLON.PointLight(name, position.clone(), this.scene);
    light.diffuse   = color;
    light.specular  = color.scale(0.5);
    light.intensity = intensity;
    light.range     = range;

    const phase = Math.random() * Math.PI * 2;
    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() * 0.001;
      light.intensity = intensity * (1.0 + Math.sin(t * pulseSpeed + phase) * pulseAmount);
    });

    return { light, observer };
  }

  // ── Terrain ────────────────────────────────────────────────────────────────

  _buildTerrain() {
    const ground = BABYLON.MeshBuilder.CreateGround('ground', {
      width: 200, height: 200, subdivisions: 2,
    }, this.scene);
    const m = this._stdMat('groundMat', new BABYLON.Color3(0.18, 0.30, 0.12));
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.material        = m;
    ground.receiveShadows  = true;
  }

  // ── Hub ────────────────────────────────────────────────────────────────────

  _buildHub() {
    const stone = this._stdMat('stone', new BABYLON.Color3(0.48, 0.48, 0.52));
    const dark  = this._stdMat('dark',  new BABYLON.Color3(0.22, 0.22, 0.28));

    const plat = BABYLON.MeshBuilder.CreateCylinder('platform', {
      diameter: 22, height: 0.6, tessellation: 12,
    }, this.scene);
    plat.position.y = 0.3;
    plat.material   = stone;
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

    this._createMagicAccent(new BABYLON.Vector3(0, 11, 0), {
      name: 'gemLight', intensity: 22, range: 20,
      color: new BABYLON.Color3(0.3, 0.5, 1.0),
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

  // ── Local player ───────────────────────────────────────────────────────────

  _buildLocalPlayer() {
    const ct    = this.playerInfo?.classType ?? 'warrior';
    const color = classColor(ct);
    this._local = this._makeHumanoid('local', color, this.playerInfo?.username ?? 'You', ct);
    this._local.root.position.set(0, 0, 0);
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
    cam.attachControl(this.canvas, true);
    this._camera = cam;
  }

  // ── Post-processing ────────────────────────────────────────────────────────
  // DefaultRenderingPipeline: MSAA + mild bloom for magic/highlights, FXAA to
  // tame shimmer, light sharpen. SSAO2 layered on top for grounding contact
  // shadows; gated on a WebGL2 context so it skips on legacy fallback.

  _setupPostProcessing() {
    const pipe = new BABYLON.DefaultRenderingPipeline(
      'rpgPipe', true, this.scene, [this._camera]
    );
    pipe.samples = 4;

    pipe.bloomEnabled   = true;
    pipe.bloomThreshold = 0.88;
    pipe.bloomWeight    = 0.25;
    pipe.bloomKernel    = 64;
    pipe.bloomScale     = 0.5;

    pipe.fxaaEnabled    = true;

    pipe.sharpenEnabled = true;
    pipe.sharpen.colorAmount = 0.2;
    pipe.sharpen.edgeAmount  = 0.15;

    this._pipeline = pipe;

    // SSAO2 requires WebGL2 — guard before creating to avoid console errors
    // on contexts that fell back to WebGL1.
    if (this.engine.webGLVersion >= 2) {
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
  }

  // ── PBR character material template ────────────────────────────────────────
  // Helper for when humanoids get authored albedo/normal/ORM textures. ORM is
  // the glTF-standard packed map: R=AO, G=Roughness, B=Metallic.

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
    const dt = this.engine.getDeltaTime();
    if (this._lightingProfile === 'overworld') this._tickDayNight(dt);
    if (!this._local) return;

    this._moveLocal(dt);
    this._animate(this._local, dt);
    this._trackCamera();
    this._syncStdb();

    this._remotePlayers.forEach(rp => {
      this._lerpRemote(rp, dt);
      this._animate(rp, dt);
    });
  }

  _moveLocal(dt) {
    if (this._chatOpen) { this._local.isMoving = false; return; }

    const w = this._keys['KeyW'] || this._keys['ArrowUp'];
    const s = this._keys['KeyS'] || this._keys['ArrowDown'];
    const a = this._keys['KeyA'] || this._keys['ArrowLeft'];
    const d = this._keys['KeyD'] || this._keys['ArrowRight'];

    this._local.isMoving = w || s || a || d;
    if (!this._local.isMoving) return;

    // alpha points FROM target TO camera, so add PI to get the true forward direction
    const speed = 0.012;
    const alpha = this._camera.alpha + Math.PI;
    const fwd   = new BABYLON.Vector3(Math.cos(alpha), 0, Math.sin(alpha));
    const right = new BABYLON.Vector3(Math.cos(alpha + Math.PI / 2), 0, Math.sin(alpha + Math.PI / 2));

    const dir = BABYLON.Vector3.Zero();
    if (w) dir.addInPlace(fwd);
    if (s) dir.subtractInPlace(fwd);
    if (a) dir.addInPlace(right);
    if (d) dir.subtractInPlace(right);
    if (dir.lengthSquared() < 0.001) return;
    dir.normalize();

    const pos = this._local.root.position;
    pos.addInPlace(dir.scale(speed * dt));
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

    if (this._remotePlayers.has(row.identity)) {
      const rp    = this._remotePlayers.get(row.identity);
      rp._targetX = toWorld(row.x);
      rp._targetZ = toWorld(row.y);
      rp.isMoving = row.isMoving;
    } else {
      const rp = this._makeHumanoid(row.identity, classColor(row.classType), row.username, row.classType);
      rp._targetX = toWorld(row.x);
      rp._targetZ = toWorld(row.y);
      rp.root.position.set(rp._targetX, 0, rp._targetZ);
      this._remotePlayers.set(row.identity, rp);
    }
  }

  _removeRemote(id) {
    const rp = this._remotePlayers.get(id);
    if (!rp) return;
    rp.root.getChildMeshes().forEach(m => m.dispose());
    rp.root.dispose();
    this._remotePlayers.delete(id);
  }

  _lerpRemote(rp, dt) {
    const f = 1 - Math.pow(0.04, dt / 100);
    rp.root.position.x = BABYLON.Scalar.Lerp(rp.root.position.x, rp._targetX, f);
    rp.root.position.z = BABYLON.Scalar.Lerp(rp.root.position.z, rp._targetZ, f);
    rp.root.position.y = 0;
  }

  // ── Humanoid factory ───────────────────────────────────────────────────────

  _makeHumanoid(id, color, username, classType = 'warrior') {
    const root = new BABYLON.TransformNode(`${id}_root`, this.scene);

    const bodyMat = new BABYLON.StandardMaterial(`${id}_body`, this.scene);
    bodyMat.diffuseColor = color;

    const darkMat = new BABYLON.StandardMaterial(`${id}_dark`, this.scene);
    darkMat.diffuseColor = new BABYLON.Color3(
      color.r * 0.35, color.g * 0.35, color.b * 0.35
    );

    const box = (name, w, h, d, px, py, pz, mat) => {
      const m = BABYLON.MeshBuilder.CreateBox(`${id}_${name}`, {
        width: w, height: h, depth: d,
      }, this.scene);
      m.position.set(px, py, pz);
      m.material = mat ?? bodyMat;
      m.parent   = root;
      this._castShadow(m);
      return m;
    };

    const torso = box('torso', 0.52, 0.68, 0.30,  0,     1.04, 0);
    const head  = box('head',  0.42, 0.42, 0.38,  0,     1.64, 0);
    const larm  = box('larm',  0.20, 0.58, 0.20, -0.38,  1.04, 0, darkMat);
    const rarm  = box('rarm',  0.20, 0.58, 0.20,  0.38,  1.04, 0, darkMat);
    const lleg  = box('lleg',  0.22, 0.68, 0.22, -0.14,  0.34, 0, darkMat);
    const rleg  = box('rleg',  0.22, 0.68, 0.22,  0.14,  0.34, 0, darkMat);

    this._addClassGear(id, classType, root);
    this._makeLabel(id, username, root);

    return { root, head, torso, larm, rarm, lleg, rleg,
             animTime: 0, isMoving: false, _targetX: 0, _targetZ: 0 };
  }

  // ── Class-specific gear ────────────────────────────────────────────────────

  _addClassGear(id, classType, root) {
    // Helper: create a named StandardMaterial
    const mat = (name, r, g, b) => {
      const m = new BABYLON.StandardMaterial(`${id}_${name}`, this.scene);
      m.diffuseColor  = new BABYLON.Color3(r, g, b);
      m.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
      return m;
    };

    // Helper: create a mesh (box / cylinder / sphere), position, parent to root
    const mesh = (name, opts, px, py, pz, material, rx = 0, ry = 0, rz = 0) => {
      let n;
      if (opts.cyl)      n = BABYLON.MeshBuilder.CreateCylinder(`${id}_${name}`, opts.cyl, this.scene);
      else if (opts.sph) n = BABYLON.MeshBuilder.CreateSphere(`${id}_${name}`, opts.sph, this.scene);
      else               n = BABYLON.MeshBuilder.CreateBox(`${id}_${name}`, opts.box ?? opts, this.scene);
      n.position.set(px, py, pz);
      if (rx || ry || rz) n.rotation.set(rx, ry, rz);
      n.material = material;
      n.parent   = root;
      this._castShadow(n);
      return n;
    };

    switch (classType) {

      // ── Warrior: steel helmet + pauldrons + sword ─────────────────────────
      case 'warrior': {
        const steel  = mat('steel',  0.58, 0.60, 0.65);
        const silver = mat('silver', 0.80, 0.82, 0.88);
        // Helmet
        mesh('helm',  { box: { width: 0.50, height: 0.22, depth: 0.46 } },  0,     1.90,  0,    steel);
        mesh('visor', { box: { width: 0.36, height: 0.07, depth: 0.06 } },  0,     1.78,  0.23, steel);
        // Pauldrons
        mesh('padL',  { box: { width: 0.30, height: 0.14, depth: 0.30 } }, -0.50,  1.38,  0,    steel);
        mesh('padR',  { box: { width: 0.30, height: 0.14, depth: 0.30 } },  0.50,  1.38,  0,    steel);
        // Sword blade + crossguard
        mesh('blade', { box: { width: 0.07, height: 0.72, depth: 0.03 } },  0.60,  0.70,  0,    silver);
        mesh('guard', { box: { width: 0.26, height: 0.05, depth: 0.06 } },  0.60,  1.07,  0,    steel);
        break;
      }

      // ── Mage: wizard hat + glowing staff ─────────────────────────────────
      case 'mage': {
        const hatMat   = mat('hat',  0.22, 0.08, 0.42);
        const staffMat = mat('stf',  0.42, 0.28, 0.12);
        const orbMat   = new BABYLON.StandardMaterial(`${id}_orb`, this.scene);
        orbMat.diffuseColor  = new BABYLON.Color3(0.55, 0.25, 1.00);
        orbMat.emissiveColor = new BABYLON.Color3(0.35, 0.15, 0.80);
        // Hat brim + cone
        mesh('brim',  { cyl: { diameter: 0.72, height: 0.06, tessellation: 10 } },           0, 1.87, 0, hatMat);
        mesh('cone',  { cyl: { diameterTop: 0, diameterBottom: 0.52, height: 0.70, tessellation: 8 } }, 0, 2.27, 0, hatMat);
        // Staff shaft + glowing orb
        mesh('shaft', { cyl: { diameter: 0.058, height: 1.55, tessellation: 6 } }, -0.56, 0.86, 0, staffMat);
        mesh('orb',   { sph: { diameter: 0.22, segments: 6 } },                    -0.56, 1.68, 0, orbMat);
        break;
      }

      // ── Archer: leather hood + quiver + bow ──────────────────────────────
      case 'archer': {
        const leatherMat = mat('lth', 0.38, 0.24, 0.10);
        const bowMat     = mat('bow', 0.50, 0.32, 0.12);
        // Hood (squashed sphere)
        const hood = BABYLON.MeshBuilder.CreateSphere(`${id}_hood`, { diameter: 0.52, segments: 6 }, this.scene);
        hood.scaling.y = 0.70;
        hood.position.set(0, 1.70, 0);
        hood.material = leatherMat;
        hood.parent   = root;
        this._castShadow(hood);
        // Quiver on back
        mesh('quiv',  { cyl: { diameter: 0.13, height: 0.50, tessellation: 6 } }, 0.10, 1.20, -0.22, leatherMat, 0.28);
        // Bow — two angled limb cylinders + center grip
        mesh('limbT', { cyl: { diameter: 0.045, height: 0.46, tessellation: 5 } }, -0.62, 1.30, 0, bowMat,  0.36);
        mesh('limbB', { cyl: { diameter: 0.045, height: 0.46, tessellation: 5 } }, -0.62, 0.78, 0, bowMat, -0.36);
        mesh('grip',  { cyl: { diameter: 0.062, height: 0.20, tessellation: 5 } }, -0.62, 1.04, 0, leatherMat);
        break;
      }

      // ── Rogue: dark cap + dual daggers ────────────────────────────────────
      case 'rogue': {
        const capMat    = mat('cap',    0.10, 0.10, 0.12);
        const daggerMat = mat('dagger', 0.80, 0.82, 0.86);
        // Cap crown + brim
        mesh('crown', { cyl: { diameterTop: 0.38, diameterBottom: 0.44, height: 0.18, tessellation: 8 } }, 0, 1.88, 0, capMat);
        mesh('cbrim', { cyl: { diameter: 0.56, height: 0.05, tessellation: 8 } },                          0, 1.80, 0, capMat);
        // Dual daggers at hips
        mesh('dagL',  { box: { width: 0.055, height: 0.36, depth: 0.030 } }, -0.44, 0.64, -0.12, daggerMat, 0.3);
        mesh('dagR',  { box: { width: 0.055, height: 0.36, depth: 0.030 } },  0.44, 0.64, -0.12, daggerMat, 0.3);
        break;
      }

      default: break;
    }
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

  // ── Animation ──────────────────────────────────────────────────────────────

  _animate(h, dt) {
    if (h.isMoving) {
      h.animTime += dt * 0.007;
      const s       = Math.sin(h.animTime) * 0.45;
      h.larm.rotation.x =  s;
      h.rarm.rotation.x = -s;
      h.lleg.rotation.x = -s;
      h.rleg.rotation.x =  s;
    } else {
      h.animTime = 0;
      const t = 0.12;
      h.larm.rotation.x = BABYLON.Scalar.Lerp(h.larm.rotation.x, 0, t);
      h.rarm.rotation.x = BABYLON.Scalar.Lerp(h.rarm.rotation.x, 0, t);
      h.lleg.rotation.x = BABYLON.Scalar.Lerp(h.lleg.rotation.x, 0, t);
      h.rleg.rotation.x = BABYLON.Scalar.Lerp(h.rleg.rotation.x, 0, t);
    }
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
    [...this._remotePlayers.keys()].forEach(id => this._removeRemote(id));
    this._teardownProfile?.();
    this.engine.stopRenderLoop();
    this.engine.dispose();
  }
}
