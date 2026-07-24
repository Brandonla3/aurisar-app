/**
 * grassBlades — shared thin-blade geometry + material for every grass layer
 * (the player-following field in AshwoodGrass and the per-tile tuft/fern
 * understory in ashwoodPropMeshes).
 *
 * Each INSTANCE is a single thin, pointed grass blade (1-2 crossed planes,
 * tapered to a tip). Grass-like density comes from scattering MANY blades —
 * tens of thousands near the player — not from big cards. Textureless: a
 * root→tip color ramp plus per-blade/clump tint variation does the work.
 *
 * Wind is a circular-arc rooted bend in world space: the root is pinned (bend
 * angle is 0 at the base) while the tip rides a preserved-length arc, driven by
 * travelling gust fronts plus a per-blade chop and tip flutter.
 *
 * The material is a StandardMaterial + a MaterialPlugin (GrassWindPlugin). The
 * plugin injects the world-space wind (vertex) and the root→tip darkening
 * (fragment); StandardMaterial owns lighting, SHADOW RECEIVING (mesh.receiveShadows),
 * and built-in fog. This is the reason for the rewrite from a hand-written
 * ShaderMaterial: a custom shader can't receive the scene's CascadedShadowGenerator
 * / blur-ESM shadows without hand-rolling cascade sampling, whereas StandardMaterial
 * gets both for free. The per-blade tint rides the thin-instance color buffer
 * (Babylon's INSTANCESCOLOR path); alpha in that buffer is a wind seed, not
 * opacity, so the material forces opaque via needAlphaBlending.
 */

/* global BABYLON */

// ── geometry ────────────────────────────────────────────────────────────────

/**
 * A single thin grass blade: `planes` crossed vertical strips, each tapered to
 * a point, `segments` rows tall (enough to curve under wind).
 * @param {object} o { planes, segments, height, width, lean }
 * @returns {{positions:number[], indices:number[], normals:number[], uvs:number[], maxH:number}}
 */
export function buildBladeClusterVertexData(o = {}) {
  const planes = o.planes ?? 2;
  const segments = o.segments ?? 3;
  const height = o.height ?? 0.5;
  const width = o.width ?? 0.022; // half-width at the base
  const lean = o.lean ?? 0.1;

  const positions = [];
  const indices = [];
  const normals = [];
  const uvs = [];
  let vbase = 0;

  for (let pl = 0; pl < planes; pl++) {
    const ang = pl * (Math.PI / Math.max(planes, 1)); // planes=2 → 0°, 90° (crossed)
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const wx = ca, wz = -sa;           // width axis (horizontal)
    const lx = sa, lz = ca;           // lean axis (blade curls this way)
    let nx = sa, ny = 0.4, nz = ca;   // Y-biased normal → soft grass lighting
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    const rowStart = vbase;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      // Substantial blade that tapers to a soft point (not a needle-thin wisp).
      const hw = width * (0.22 + 0.78 * Math.pow(1 - t, 0.6));
      const y = t * height;
      const z = Math.pow(t, 1.7) * lean; // gentle forward curl toward the tip
      const cx = lx * z, cz = lz * z;
      positions.push(cx - wx * hw, y, cz - wz * hw);
      positions.push(cx + wx * hw, y, cz + wz * hw);
      normals.push(nx, ny, nz, nx, ny, nz);
      uvs.push(0, t, 1, t); // uv.y = t drives the root→tip ramp and wind bladeT
    }
    for (let s = 0; s < segments; s++) {
      const a = rowStart + s * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    vbase += (segments + 1) * 2;
  }

  return { positions, indices, normals, uvs, maxH: height };
}

// ── shared per-scene wind clock ───────────────────────────────────────────────
// One clock per scene advances the wind time + a slowly-drifting coherent wind
// direction (so gust fronts sweep the whole field the same way; weather only
// supplies strength). The plugin reads it in bindForSubMesh — no per-material
// observer. NOT constructed at module scope: this module can be evaluated (via
// the static import chain) before window.BABYLON is assigned.

const _clocks = new WeakMap(); // scene -> { time, windX, windZ, obs }

function _ensureClock(scene) {
  let c = _clocks.get(scene);
  if (!c) {
    c = { time: 0, windX: 0.8, windZ: 0.6, obs: null };
    c.obs = scene.onBeforeRenderObservable.add(() => {
      c.time += scene.getEngine().getDeltaTime() / 1000;
      const ang = 0.7 + Math.sin(c.time * 0.04) * 0.25;
      c.windX = Math.cos(ang);
      c.windZ = Math.sin(ang);
    });
    _clocks.set(scene, c);
  }
  return c;
}

// ── material plugin ───────────────────────────────────────────────────────────
// Lazily defined (needs BABYLON at runtime, not module-eval time) and cached.

let _GrassWindPlugin = null;

function _grassWindPluginClass() {
  if (_GrassWindPlugin) return _GrassWindPlugin;

  _GrassWindPlugin = class GrassWindPlugin extends BABYLON.MaterialPluginBase {
    constructor(material, maxH) {
      // name, priority (>100 so it runs after the base passes), defines
      super(material, 'GrassWind', 200, { GRASSWIND: false });
      this._maxH = maxH;
      this._isEnabled = false;
      this.isEnabled = true;
    }

    get isEnabled() { return this._isEnabled; }
    set isEnabled(v) {
      if (this._isEnabled === v) return;
      this._isEnabled = v;
      this.markAllDefinesAsDirty();
      this._enable(v);
    }

    prepareDefines(defines) { defines.GRASSWIND = this._isEnabled; }

    getClassName() { return 'GrassWindPlugin'; }

    getUniforms() {
      return {
        ubo: [
          { name: 'grassTime', size: 1, type: 'float' },
          { name: 'grassWind', size: 1, type: 'float' },
          { name: 'grassWindDir', size: 2, type: 'vec2' },
          { name: 'grassWindSpeed', size: 1, type: 'float' },
          { name: 'grassGustScale', size: 1, type: 'float' },
          { name: 'grassMaxH', size: 1, type: 'float' },
        ],
        vertex: `#ifdef GRASSWIND
          uniform float grassTime;
          uniform float grassWind;
          uniform vec2 grassWindDir;
          uniform float grassWindSpeed;
          uniform float grassGustScale;
          uniform float grassMaxH;
        #endif`,
      };
    }

    bindForSubMesh(uniformBuffer, scene) {
      if (!this._isEnabled) return;
      const c = _ensureClock(scene);
      const md = scene.metadata?.ashwood;
      const wind = Math.max(0.2, Math.min(3, md?.weather?.windStrength ?? 1));
      uniformBuffer.updateFloat('grassTime', c.time);
      uniformBuffer.updateFloat('grassWind', wind);
      uniformBuffer.updateFloat2('grassWindDir', c.windX, c.windZ);
      uniformBuffer.updateFloat('grassWindSpeed', 1.0);
      uniformBuffer.updateFloat('grassGustScale', 0.12);
      uniformBuffer.updateFloat('grassMaxH', this._maxH);
    }

    getCustomCode(shaderType) {
      if (shaderType === 'vertex') {
        return {
          CUSTOM_VERTEX_DEFINITIONS: 'varying float vGrassBladeT;',
          // World-space wind: modify worldPos AFTER the instance transform so the
          // gust fronts + sway direction stay in world space (an object-space
          // displacement would be rotated by each blade's random Y rotation).
          CUSTOM_VERTEX_UPDATE_WORLDPOS: `
            #ifdef GRASSWIND
            {
              vec2 aOrigin = vec2(finalWorld[3].x, finalWorld[3].z);
              float bladeT = clamp(positionUpdated.y / grassMaxH, 0.0, 1.0);
              vGrassBladeT = bladeT;
              #ifdef INSTANCESCOLOR
                float seed = instanceColor.a;
              #else
                float seed = 0.5;
              #endif
              vec2 windDir = normalize(grassWindDir);
              vec2 sideDir = vec2(-windDir.y, windDir.x);
              float along = dot(aOrigin, windDir);
              float jitter = fract(sin(dot(aOrigin, vec2(12.9898, 78.233))) * 43758.5453);
              float gust = pow(sin(along * grassGustScale - grassTime * grassWindSpeed * 0.6 + jitter * 6.2831) * 0.5 + 0.5, 1.6);
              float chop = sin(along * grassGustScale * 2.7 - grassTime * grassWindSpeed * 1.3 + seed * 6.2831) * 0.5 + 0.5;
              float ampVar = 0.65 + fract(seed * 7.0) * 0.7;
              float phi = clamp(grassWind * (0.18 + gust * 0.5 + chop * 0.12) * ampVar * 0.55, 0.0, 0.8);
              float yScale = length(vec3(finalWorld[1].x, finalWorld[1].y, finalWorld[1].z));
              float worldH = grassMaxH * yScale;
              float a = phi * pow(bladeT, 1.5);
              float radius = worldH / max(phi, 1e-3);
              float arc = radius * (1.0 - cos(a));
              float drop = radius * sin(a) - positionUpdated.y * yScale;
              float flutter = sin(grassTime * 10.0 + seed * 18.0 + along * 0.8) * 0.04 * smoothstep(0.55, 1.0, bladeT);
              worldPos.x += windDir.x * arc + sideDir.x * flutter;
              worldPos.z += windDir.y * arc + sideDir.y * flutter;
              worldPos.y += drop;
            }
            #endif
          `,
        };
      }
      if (shaderType === 'fragment') {
        return {
          CUSTOM_FRAGMENT_DEFINITIONS: 'varying float vGrassBladeT;',
          // Root→tip ramp: darker at the base (fake AO / ground contact), brighter
          // toward the tip. Multiplicative on the tinted diffuse (from the
          // thin-instance color), so it composes regardless of where the base
          // applies the vertex/instance color.
          CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
            #ifdef GRASSWIND
              diffuseColor *= mix(0.55, 1.18, pow(clamp(vGrassBladeT, 0.0, 1.0), 1.1));
            #endif
          `,
        };
      }
      return null;
    }
  };

  return _GrassWindPlugin;
}

/**
 * Build a grass StandardMaterial with the wind/ramp plugin. maxH must match the
 * geometry's height so the wind bladeT normalizes correctly. The mesh should set
 * `receiveShadows = true` to pick up the scene's shadows; the per-blade tint
 * rides the thin-instance color buffer.
 */
export function createGrassMaterial(scene, opts = {}) {
  const maxH = opts.maxH ?? 0.5;
  const name = opts.name ?? 'grassBladeMat';

  const mat = new BABYLON.StandardMaterial(name, scene);
  // Tint comes from the per-instance color (INSTANCESCOLOR); diffuse stays white
  // so it is not double-multiplied. Grass is matte (no specular highlight) and
  // two-sided (thin blades seen from both faces).
  mat.diffuseColor = new BABYLON.Color3(1, 1, 1);
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  // The thin-instance color's alpha channel is a per-blade wind seed, NOT
  // opacity — force the material opaque so it is never read as transparency.
  mat.needAlphaBlending = () => false;

  // Attach the wind/ramp plugin (registers itself via the base constructor).
  const Plugin = _grassWindPluginClass();
  // eslint-disable-next-line no-new -- the plugin registers on the material in its ctor
  new Plugin(mat, maxH);

  _ensureClock(scene);
  return mat;
}
