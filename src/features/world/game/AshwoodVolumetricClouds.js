/**
 * AshwoodVolumetricClouds — raymarched volumetric cloud layer (Phase 6).
 *
 * High-tier only and opt-in via the game menu (BabylonWorldScene owns the
 * setting + lifecycle). A camera-anchored BACKSIDE dome raymarches a flat
 * slab of 3D value-noise FBM between two altitudes: 22 primary steps with a
 * per-ray jitter to hide banding, 2 sun-ward samples per step for
 * self-shadowing, Beer–Lambert extinction with a powder term for the bright
 * cauliflower edges. Sky-pixels only (fragments below the horizon discard),
 * so the cost is bounded by how much sky is on screen.
 *
 * When active, AshwoodSky reads scene.metadata.ashwood.volumetricClouds and
 * fades its cheap 2D deck to a thin haze so the two layers never double up.
 *
 * Lighting follows the LightingManager via the metadata seam (same pattern
 * as the water/grass): sun direction and a day/dusk/night-graded sun+ambient
 * color pair are pushed per frame; coverage tracks the weather's wetness and
 * drift tracks its wind, like the 2D deck it replaces.
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
uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 ambCol;
uniform float time; uniform float cover; uniform float night;

const float Y0 = 170.0;   // slab bottom (m above camera)
const float Y1 = 390.0;   // slab top
const int   STEPS = 22;
const float SIGMA = 0.055; // extinction per meter of density

float h31(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(h31(i),                      h31(i + vec3(1.0, 0.0, 0.0)), u.x);
  float b = mix(h31(i + vec3(0.0, 1.0, 0.0)), h31(i + vec3(1.0, 1.0, 0.0)), u.x);
  float c = mix(h31(i + vec3(0.0, 0.0, 1.0)), h31(i + vec3(1.0, 0.0, 1.0)), u.x);
  float d = mix(h31(i + vec3(0.0, 1.0, 1.0)), h31(i + vec3(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
float fbm3(vec3 p) {
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise3(p);
    p = p * 2.13 + vec3(11.7, 5.3, 7.9);
    a *= 0.5;
  }
  return v;
}

// Cloud density at a world-ish point (camera-relative; wind drift baked into
// the sample position). Flattened noise domain -> stratocumulus-ish shapes;
// the vertical profile rounds bases and tops off inside the slab.
float density(vec3 p) {
  float hf = (p.y - Y0) / (Y1 - Y0);
  float profile = smoothstep(0.0, 0.22, hf) * (1.0 - smoothstep(0.5, 1.0, hf));
  vec3 q = p * vec3(0.0032, 0.0058, 0.0032) + vec3(time * 0.012, 0.0, time * 0.004);
  float base = fbm3(q);
  float th = mix(0.66, 0.42, cover);          // coverage slides the threshold
  return smoothstep(th, th + 0.16, base * profile) * 0.85;
}

void main() {
  vec3 d = normalize(vP);
  if (d.y < 0.025) discard;                    // below the cloud horizon

  float t0 = Y0 / d.y;
  float t1 = min(Y1 / d.y, 6500.0);
  float dt = (t1 - t0) / float(STEPS);
  // per-ray jitter breaks slice banding into imperceptible noise
  float jit = h31(d * 977.0);

  vec3 sunN = normalize(sunDir);
  float T = 1.0;                               // transmittance
  vec3 C = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    float t = t0 + (float(i) + jit) * dt;
    vec3 p = d * t;
    float dens = density(p);
    if (dens <= 0.002) continue;
    // two-tap sun march for self-shadowing
    float occ = density(p + sunN * 26.0) * 0.6 + density(p + sunN * 78.0) * 0.4;
    float lit = exp(-occ * 2.6);
    float powder = 1.0 - exp(-dens * 9.0);     // bright cauliflower rims
    vec3 sample_ = sunCol * (lit * powder) + ambCol;
    float aStep = 1.0 - exp(-dens * SIGMA * dt);
    C += T * aStep * sample_;
    T *= 1.0 - aStep;
    if (T < 0.02) break;
  }

  float alpha = 1.0 - T;
  // dissolve at the horizon line and haze far cloud toward the ambient sky
  alpha *= smoothstep(0.025, 0.11, d.y);
  C = mix(C, ambCol * alpha, clamp(t0 / 5200.0, 0.0, 0.55));
  gl_FragColor = vec4(C, alpha * 0.96);
}
`;

export class AshwoodVolumetricClouds {
  constructor(scene) {
    this.scene = scene;

    BABYLON.Effect.ShadersStore['ashwoodVolCloudsVertexShader'] = VERT;
    BABYLON.Effect.ShadersStore['ashwoodVolCloudsFragmentShader'] = FRAG;

    this.material = new BABYLON.ShaderMaterial('ashwoodVolCloudsMat', scene, 'ashwoodVolClouds', {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'sunDir', 'sunCol', 'ambCol',
                 'time', 'cover', 'night'],
      needAlphaBlending: true,
    });
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.fogEnabled = false;
    this.material.alphaMode = BABYLON.Constants.ALPHA_COMBINE;

    // Slightly smaller than the AshwoodSky dome (1200) and created after it:
    // equal camera distance means Babylon's transparent sort ties, and the
    // stable sort then keeps creation order — clouds composite over the sky
    // gradient. Terrain still occludes both via the depth test.
    this.dome = BABYLON.MeshBuilder.CreateSphere('ashwoodVolCloudsDome', {
      diameter: 1150,
      segments: 16,
      sideOrientation: BABYLON.Mesh.BACKSIDE,
    }, scene);
    this.dome.material = this.material;
    this.dome.infiniteDistance = true;
    this.dome.isPickable = false;
    this.dome.applyFog = false;

    this._time = 0;
    this._cover = 0.35;
    this._sunDir = new BABYLON.Vector3(0, 1, 0);
    // one scratch Color3 per uniform — setColor3 stores by reference
    this._c3Sun = new BABYLON.Color3();
    this._c3Amb = new BABYLON.Color3();

    this._observer = scene.onBeforeRenderObservable.add(() => this._update());
  }

  _update() {
    const lm = this.scene.metadata?.ashwood?.lm;
    const inOverworld = lm ? lm.profile === 'overworld' && !lm._transition : true;
    this.dome.setEnabled(inOverworld);
    if (!inOverworld) return;

    const dt = this.scene.getEngine().getDeltaTime() / 1000;
    const weather = this.scene.metadata?.ashwood?.weather;
    // drift with the wind; thicken toward overcast as wetness rises
    this._time += dt * (0.6 + (weather?.windStrength ?? 1) * 0.6);
    const coverTarget = 0.35 + (weather?.wet ?? 0) * 0.4;
    this._cover += (coverTarget - this._cover) * Math.min(1, dt * 0.2);

    const dayF = lm?.dayFactor ?? 1;
    const dusk = lm?.duskFactor ?? 0;
    const night = Math.max(0, Math.min(1, 1 - dayF * 1.5));
    // Prefer the shared atmosphere sunDir (AshwoodSky's single source of truth)
    // so the cloud layer agrees with the sky, fog, grass, and water on one sun
    // direction; fall back to the key light before the first overworld frame.
    const atmo = this.scene.metadata?.ashwood?.atmosphere;
    if (atmo?.sunDir) {
      this._sunDir.copyFrom(atmo.sunDir);
    } else if (lm?.key) {
      this._sunDir.copyFrom(lm.key.direction).scaleInPlace(-1);
    }

    const m = this.material;
    m.setFloat('time', this._time);
    m.setFloat('cover', this._cover);
    m.setFloat('night', night);
    m.setVector3('sunDir', this._sunDir);
    // sun-lit face: warm white by day, amber through dusk, moon-slate at night
    m.setColor3('sunCol', this._c3Sun.copyFromFloats(
      (1.0 - 0.25 * dusk) * dayF + 0.10 * night,
      (0.95 - 0.42 * dusk) * dayF + 0.11 * night,
      (0.90 - 0.55 * dusk) * dayF + 0.16 * night,
    ));
    // ambient/shadowed face: sky-blue by day, deep slate at night
    m.setColor3('ambCol', this._c3Amb.copyFromFloats(
      0.34 * dayF + 0.020 * night + 0.10 * dusk,
      0.40 * dayF + 0.024 * night + 0.05 * dusk,
      0.50 * dayF + 0.036 * night,
    ));
  }

  dispose() {
    if (this._observer) this.scene.onBeforeRenderObservable.remove(this._observer);
    this.dome?.dispose();
    this.material?.dispose();
  }
}
