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
uniform float night; uniform float dusk; uniform float skyAlpha;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Normalized Henyey-Greenstein phase function (integrates to 1 over the
// sphere) — gives Mie forward-scattering its correct asymmetric falloff: a
// tight bright core toward the sun with a long physically-shaped tail,
// instead of a bare pow() halo.
float hgPhase(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

void main() {
  vec3 d = normalize(vP);
  float h = d.y;

  // Rayleigh-style zenith falloff: an exponential optical-depth curve reads
  // like real atmosphere (steep near the horizon, saturating quickly toward
  // the zenith) in place of the previous linear-ish clamp(h*1.3). Same
  // artist-tuned topCol/midCol/botCol drive the palette — only the blend
  // curve between them changes. Steeper than the initial pass (3.4 vs 2.2)
  // so more of the frame reaches the richer top blue sooner — the camera's
  // ~51 deg downward pitch means most of a normal shot sits at low h, where
  // the old curve lingered near the paler horizon color too long.
  float zenith = 1.0 - exp(-max(h, 0.0) * 3.4);
  vec3 c = h < 0.0 ? mix(midCol, botCol, clamp(-h * 3.0, 0.0, 1.0))
                   : mix(midCol, topCol, zenith);

  vec3 sunN = normalize(sunDir);
  // sun disc + halo
  float sd = max(dot(d, sunN), 0.0);
  c += sunCol * pow(sd, 1200.0) * 4.0;

  // Mie forward-scattering glow around the sun. The asymmetry factor g rises
  // at low sun elevation (dusk/dawn) — a tighter, more forward-peaked lobe,
  // mimicking the longer path length through denser low-altitude haze.
  float mieG = mix(0.76, 0.9, dusk);
  float mie = hgPhase(sd, mieG);
  // Fades out smoothly once the sun drops well below the horizon (no sun
  // left to scatter off) instead of a hard cutoff.
  float mieVisibility = smoothstep(-0.12, 0.02, sunN.y);
  c += sunCol * mie * 0.14 * mieVisibility;

  // golden-hour horizon band toward the sun's azimuth
  float az = max(dot(d.xz / max(length(d.xz), 1e-4),
                     sunN.xz / max(length(sunN.xz), 1e-4)), 0.0);
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
  // skyAlpha cross-fades the dome over the HDRI skybox behind it: ~0 by day
  // (HDRI shows through), rising through dusk, opaque at night (moon/stars/
  // gradient own the sky). When no skybox exists it is forced to 1.
  gl_FragColor = vec4(c, skyAlpha);
}
`;

// Ashwood palette (prototype updateDayNight). Day and night colors were
// bumped brighter/more saturated from the original prototype values — the
// original D_BOT (#c9d8e6) read as near-white at the camera's ~51 deg
// downward pitch (most of a normal shot sits near the horizon, not the
// zenith), and the original N_TOP/N_BOT read as near-black, too dark to
// play by. Night now targets a "bright dusk" rather than true darkness.
const N_TOP = { r: 0x1e / 255, g: 0x2c / 255, b: 0x4a / 255 };
const D_TOP = { r: 0x2b / 255, g: 0x5a / 255, b: 0xac / 255 };
const N_BOT = { r: 0x30 / 255, g: 0x34 / 255, b: 0x44 / 255 };
const D_BOT = { r: 0x86 / 255, g: 0xb2 / 255, b: 0xdd / 255 };
const GOLD  = { r: 0xe8 / 255, g: 0x93 / 255, b: 0x4a / 255 };

const FOG_DENSITY_DAY   = 0.0060;
// Night fog used to be denser than day fog (0.0078 vs 0.0060) — backwards
// for playability, since it fogged out distant terrain sooner exactly when
// the scene is already dimmer. Now lighter than day fog.
const FOG_DENSITY_NIGHT = 0.0045;
// Biome-tinted horizon fog blend, dynamic per weather (see _update): weak on
// clear days so the sky reads blue, stronger while raining/overcast for
// atmosphere.
const BIOME_FOG_BLEND_CLEAR = 0.16;
const BIOME_FOG_BLEND_WET   = 0.55;

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
                 'sunDir', 'sunCol', 'moonDir', 'night', 'dusk', 'skyAlpha'],
    });
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.fogEnabled = false;
    // Alpha-blend the dome over the HDRI skybox (driven by the skyAlpha uniform
    // each frame). Always on: at full night skyAlpha=1 → opaque-equivalent, and
    // without a skybox the fallback forces skyAlpha=1 so the dome stays solid.
    this.material.alphaMode = BABYLON.Constants.ALPHA_COMBINE;
    this.material.needAlphaBlending = () => true;

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
    // Mid sits closer to the saturated top blue (was 0.55 toward bot) — mid
    // is what fills most of the visible band at normal camera pitches, so
    // weighting it toward bot muted the whole sky toward the pale horizon.
    mixInto(this._mid, this._top, this._bot, 0.38);

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
    // Cross-fade: invisible by day (HDRI skybox shows), opaque at night. If no
    // skybox loaded (env assets missing) the dome is the only sky → stay solid.
    const hasSkybox = !!this.lm.skybox;
    m.setFloat('skyAlpha', hasSkybox ? Math.max(0, Math.min(1, night + dusk)) : 1);

    // Fog: horizon color blended toward the biome fog at the player. Blend
    // strength scales with weather wetness (same wet signal AshwoodGrass
    // already reads for wind) — a clear day stays close to the sky's own
    // horizon color instead of being pulled toward the biome's ground tint,
    // while rain/overcast leans harder into it for atmosphere.
    const p = this.getPlayerPos?.();
    let fr = this._bot.r, fg = this._bot.g, fb = this._bot.b;
    if (p) {
      const wet = this.scene.metadata?.ashwood?.weather?.wet ?? 0;
      const blend = BIOME_FOG_BLEND_CLEAR + (BIOME_FOG_BLEND_WET - BIOME_FOG_BLEND_CLEAR) * wet;
      this.wg.biomeFogAt(p.x, p.z, this._biome);
      fr += (this._biome.r - fr) * blend;
      fg += (this._biome.g - fg) * blend;
      fb += (this._biome.b - fb) * blend;
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
