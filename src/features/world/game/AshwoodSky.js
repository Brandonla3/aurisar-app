/**
 * AshwoodSky — gradient sky dome + Ashwood day/night palette.
 *
 * Ports the prototype's sky ShaderMaterial (sun disc + halo, golden-hour
 * horizon band, moon, twinkling stars — public/reference/ashwood.html lines
 * ~712-744) and the sky/fog color curves from its updateDayNight()
 * (lines ~1970-2001) to Babylon.
 *
 * Division of labor with LightingManager: the LM keeps driving the actual
 * lights, exposure and ambient from its own day/night phase; this module
 * reads the LM's sun state (key light direction, dayFactor/duskFactor) and
 * takes over the *visuals* — sky dome colors and scene fog. Its observer is
 * registered after the LM's, so its fog writes win the frame.
 *
 * Fog also blends 40% toward the biome fog color at the player's position
 * (the prototype's updateBiomeFog), which doubles as the curtain hiding the
 * tile-streaming ring edge.
 */

/* global BABYLON */

const VERT = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vP;
void main() {
  vP = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec3 vP;
uniform vec3 topCol; uniform vec3 midCol; uniform vec3 botCol;
uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 moonDir;
uniform float night; uniform float dusk;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vP);
  float h = d.y;
  vec3 c = h < 0.0 ? mix(midCol, botCol, clamp(-h * 3.0, 0.0, 1.0))
                   : mix(midCol, topCol, clamp(h * 1.3, 0.0, 1.0));
  // sun disc + halo
  float sd = max(dot(d, normalize(sunDir)), 0.0);
  c += sunCol * pow(sd, 1200.0) * 4.0 + sunCol * pow(sd, 14.0) * 0.22;
  // golden-hour horizon band toward the sun's azimuth
  float az = max(dot(d.xz / max(length(d.xz), 1e-4),
                     sunDir.xz / max(length(sunDir.xz), 1e-4)), 0.0);
  float horiz = 1.0 - clamp(abs(h) * 2.4, 0.0, 1.0);
  c += vec3(1.0, 0.42, 0.16) * pow(az, 3.0) * horiz * dusk * 0.9;
  c += vec3(0.85, 0.50, 0.32) * horiz * dusk * 0.22;
  // moon
  float md = max(dot(d, normalize(moonDir)), 0.0);
  c += vec3(0.8, 0.85, 1.0) * pow(md, 1600.0) * 2.2 * night
     + vec3(0.4, 0.45, 0.6) * pow(md, 40.0) * 0.15 * night;
  // twinkling stars
  if (night > 0.02 && h > 0.05) {
    vec2 g = floor(d.xz / max(h, 0.18) * 140.0);
    float s = h21(g);
    float tw = 0.6 + 0.4 * sin(s * 100.0);
    c += vec3(step(0.9955, s)) * night * tw * h;
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

// Ashwood palette (prototype updateDayNight)
const N_TOP = { r: 0x0a / 255, g: 0x10 / 255, b: 0x20 / 255 };
const D_TOP = { r: 0x35 / 255, g: 0x63 / 255, b: 0x9f / 255 };
const N_BOT = { r: 0x14 / 255, g: 0x16 / 255, b: 0x1f / 255 };
const D_BOT = { r: 0xc9 / 255, g: 0xd8 / 255, b: 0xe6 / 255 };
const GOLD  = { r: 0xe8 / 255, g: 0x93 / 255, b: 0x4a / 255 };

const FOG_DENSITY_DAY   = 0.0060;
const FOG_DENSITY_NIGHT = 0.0078;
const BIOME_FOG_BLEND   = 0.4;     // prototype updateBiomeFog blend

function mixInto(out, a, b, t) {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
}

export class AshwoodSky {
  /**
   * @param {BABYLON.Scene} scene
   * @param {LightingManager} lm        exposes key light, dayFactor, duskFactor, profile
   * @param {object} worldgen           for biomeFogAt
   * @param {function} getPlayerPos     () => {x,z}|null
   */
  constructor(scene, lm, worldgen, getPlayerPos) {
    this.scene = scene;
    this.lm = lm;
    this.wg = worldgen;
    this.getPlayerPos = getPlayerPos;

    BABYLON.Effect.ShadersStore['ashwoodSkyVertexShader'] = VERT;
    BABYLON.Effect.ShadersStore['ashwoodSkyFragmentShader'] = FRAG;

    this.material = new BABYLON.ShaderMaterial('ashwoodSkyMat', scene, 'ashwoodSky', {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'topCol', 'midCol', 'botCol',
                 'sunDir', 'sunCol', 'moonDir', 'night', 'dusk'],
    });
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.fogEnabled = false;

    this.dome = BABYLON.MeshBuilder.CreateSphere('ashwoodSkyDome', {
      diameter: 1200,
      segments: 24,
      sideOrientation: BABYLON.Mesh.BACKSIDE,
    }, scene);
    this.dome.material = this.material;
    this.dome.infiniteDistance = true;   // follows the camera, ignores translation
    this.dome.isPickable = false;
    this.dome.applyFog = false;

    // Scratch colors (no per-frame allocation)
    this._top = { r: 0, g: 0, b: 0 };
    this._bot = { r: 0, g: 0, b: 0 };
    this._mid = { r: 0, g: 0, b: 0 };
    this._biome = { r: 0, g: 0, b: 0 };
    this._sunDir = new BABYLON.Vector3();
    this._moonDir = new BABYLON.Vector3();
    this._c3 = new BABYLON.Color3();

    this._observer = scene.onBeforeRenderObservable.add(() => this._update());
  }

  _update() {
    const lm = this.lm;
    const inOverworld = lm.profile === 'overworld' && !lm._transition;
    this.dome.setEnabled(inOverworld);
    if (!inOverworld) return; // dungeon profile owns its own fog

    const dayF = lm.dayFactor ?? 1;
    const dusk = lm.duskFactor ?? 0;
    const night = Math.max(0, Math.min(1, 1 - dayF * 1.5));

    // Sun/moon directions from the LM's key light (points sun→ground).
    this._sunDir.copyFrom(lm.key.direction).scaleInPlace(-1);
    this._moonDir.set(-this._sunDir.x, Math.abs(this._sunDir.y) * 0.6 + 0.25, -this._sunDir.z);
    this._moonDir.normalize();

    // Palette curves (prototype updateDayNight)
    mixInto(this._top, N_TOP, D_TOP, dayF);
    mixInto(this._bot, N_BOT, D_BOT, dayF);
    mixInto(this._bot, this._bot, GOLD, dusk * 0.7);
    mixInto(this._mid, this._top, this._bot, 0.55);

    const m = this.material;
    m.setColor3('topCol', this._c3.copyFromFloats(this._top.r, this._top.g, this._top.b));
    m.setColor3('midCol', this._c3.copyFromFloats(this._mid.r, this._mid.g, this._mid.b));
    m.setColor3('botCol', this._c3.copyFromFloats(this._bot.r, this._bot.g, this._bot.b));
    m.setVector3('sunDir', this._sunDir);
    m.setVector3('moonDir', this._moonDir);
    // Sun disc color warms through the golden hour; vanishes below horizon.
    const sunOn = dayF > 0.03 ? 1 : 0;
    m.setColor3('sunCol', this._c3.copyFromFloats(
      1.0 * sunOn, (0.92 - 0.42 * dusk) * sunOn, (0.82 - 0.55 * dusk) * sunOn));
    m.setFloat('night', night);
    m.setFloat('dusk', dusk);

    // Fog: horizon color blended toward the biome fog at the player.
    const p = this.getPlayerPos?.();
    let fr = this._bot.r, fg = this._bot.g, fb = this._bot.b;
    if (p) {
      this.wg.biomeFogAt(p.x, p.z, this._biome);
      fr += (this._biome.r - fr) * BIOME_FOG_BLEND;
      fg += (this._biome.g - fg) * BIOME_FOG_BLEND;
      fb += (this._biome.b - fb) * BIOME_FOG_BLEND;
      // biome fog colors are daylit tones — pull them down with the night
      const k = 0.25 + 0.75 * dayF;
      fr *= k; fg *= k; fb *= k;
    }
    this.scene.fogColor.copyFromFloats(fr, fg, fb);
    this.scene.fogDensity = FOG_DENSITY_NIGHT + (FOG_DENSITY_DAY - FOG_DENSITY_NIGHT) * dayF;
  }

  dispose() {
    if (this._observer) this.scene.onBeforeRenderObservable.remove(this._observer);
    this.dome?.dispose();
    this.material?.dispose();
  }
}
