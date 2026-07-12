/**
 * grassBlades — shared thin-blade geometry + emergency-stable material for
 * every grass layer.
 *
 * PR #253 is now a desktop-stability recovery. The previous ShaderMaterial used
 * custom thin-instance GLSL and is a likely source of the remaining WebGL
 * `program not linked` crash on desktop previews. Keep the blade geometry and
 * scatter contracts intact, but render blades with a vanilla Babylon material
 * until the custom grass shader can be validated in a dedicated follow-up.
 */

/* global BABYLON */

// ── geometry ────────────────────────────────────────────────────────────────

/**
 * A single thin grass blade: `planes` crossed vertical strips, each tapered to
 * a point, `segments` rows tall.
 * @param {object} o { planes, segments, height, width, lean }
 * @returns {{positions:number[], indices:number[], normals:number[], uvs:number[], maxH:number}}
 */
export function buildBladeClusterVertexData(o = {}) {
  const planes = o.planes ?? 2;
  const segments = o.segments ?? 3;
  const height = o.height ?? 0.5;
  const width = o.width ?? 0.022;
  const lean = o.lean ?? 0.1;

  const positions = [];
  const indices = [];
  const normals = [];
  const uvs = [];
  let vbase = 0;

  for (let pl = 0; pl < planes; pl++) {
    const ang = pl * (Math.PI / Math.max(planes, 1));
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const wx = ca, wz = -sa;
    const lx = sa, lz = ca;
    let nx = sa, ny = 0.4, nz = ca;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    const rowStart = vbase;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const hw = width * (0.22 + 0.78 * Math.pow(1 - t, 0.6));
      const y = t * height;
      const z = Math.pow(t, 1.7) * lean;
      const cx = lx * z, cz = lz * z;
      positions.push(cx - wx * hw, y, cz - wz * hw);
      positions.push(cx + wx * hw, y, cz + wz * hw);
      normals.push(nx, ny, nz, nx, ny, nz);
      uvs.push(0, t, 1, t);
    }
    for (let s = 0; s < segments; s++) {
      const a = rowStart + s * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    vbase += (segments + 1) * 2;
  }

  return { positions, indices, normals, uvs, maxH: height };
}

/**
 * Compatibility no-op retained for existing callers. The retired shader path
 * used this to push wind/light uniforms each frame; StandardMaterial needs no
 * per-frame uniform pump.
 */
export function registerGrassMaterial(_scene, _mat) {}

/**
 * Build a stable grass material without custom GLSL.
 *
 * This deliberately gives up animated blade bending and per-instance tint while
 * desktop stability is being recovered. The geometry/scatter path remains
 * active, so the world keeps its grass coverage without risking a shader-link
 * crash in the main render loop.
 */
export function createGrassMaterial(scene, opts = {}) {
  const name = opts.name ?? 'grassBladeMat';
  const mat = new BABYLON.StandardMaterial(name, scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(opts.color ?? '#5f7f3a');
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  mat.emissiveColor = BABYLON.Color3.FromHexString(opts.emissive ?? '#18230f');
  mat.backFaceCulling = false;
  mat.disableLighting = false;
  return mat;
}
