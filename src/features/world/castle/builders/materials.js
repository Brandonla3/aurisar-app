/**
 * Castle materials — ~16 shared StandardMaterials for every castle mesh.
 *
 * Builders never create materials; they tag meshes with a matKey and the
 * merge pass assigns these. Diffuse detail comes from small procedural
 * DynamicTextures (hash2-based, deterministic — no Math.random) so stone
 * reads as stone and wood as wood without shipping texture assets.
 *
 * Desktop uses 256px textures + procedural bump maps; mobile stays at 128px
 * with diffuse only to protect fill rate.
 */

/* global BABYLON */

import { hash2 } from '../../worldgen/rng.js';

const MAX_LIGHTS = 10;
const MOBILE_TEX = 128;
const DESKTOP_TEX = 256;

/** Shared height field 0..1 for diffuse + bump generation. */
function sampleNoise(x, y, mode, seed) {
  if (mode === 'wood') {
    const wob = hash2(seed, y * 0.13) * 4;
    return hash2(seed + Math.floor((y + wob) / 10), x * 0.055) * 0.55 +
           hash2(seed * 3.7, x * 0.9 + y * 7.1) * 0.20;
  }
  if (mode === 'marble') {
    const vein = Math.abs(Math.sin(x * 0.11 + hash2(seed, Math.floor(y / 7)) * 6.28 + y * 0.03));
    return (vein > 0.94 ? 0.85 : 0) + hash2(seed + x * 0.51, y * 0.47) * 0.16;
  }
  if (mode === 'fabric') {
    const warp = (Math.sin(x * 2.5 + hash2(seed, y) * 0.8) + 1) * 0.5;
    const weft = (Math.sin(y * 2.5 + hash2(seed * 3, x) * 0.8) + 1) * 0.5;
    return warp * 0.45 + weft * 0.45 + hash2(seed * 1.9 + x * 0.4, y * 0.4) * 0.14;
  }
  if (mode === 'plaster') {
    return hash2(seed + Math.floor(x / 22), Math.floor(y / 18)) * 0.18 +
           hash2(seed * 2.1 + x * 0.7, y * 0.6) * 0.14 +
           hash2(seed * 5.3 + x * 0.22, y * 0.18) * 0.08;
  }
  const cell = hash2(seed + Math.floor(x / 16), Math.floor(y / 12)) * 0.4;
  const fine = hash2(seed * 1.7 + x * 0.83, y * 0.71) * 0.35;
  const joint = (x % 16 < 1 || y % 12 < 1) ? 0.5 : 0;
  return cell + fine + joint * 0.6;
}

function noiseTexture(scene, name, base, accent, mode, seed, size) {
  const tex = new BABYLON.DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext();
  const [br, bg, bb] = base, [ar, ag, ab] = accent;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = Math.min(1, Math.max(0, sampleNoise(x, y, mode, seed)));
      const i = (y * size + x) * 4;
      img.data[i]     = Math.round(255 * (br + (ar - br) * t));
      img.data[i + 1] = Math.round(255 * (bg + (ag - bg) * t));
      img.data[i + 2] = Math.round(255 * (bb + (ab - bb) * t));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Grayscale height map for StandardMaterial.bumpTexture. */
function bumpTexture(scene, name, mode, seed, size, strength = 1) {
  const tex = new BABYLON.DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext();
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = Math.min(1, Math.max(0, sampleNoise(x, y, mode, seed + 17.3)));
      const v = Math.round(255 * (0.42 + (t - 0.5) * 0.55 * strength));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  return tex;
}

function mat(scene, name, { diffuse, texture = null, bump = null, bumpScale = 0.35,
  specular = [0.03, 0.03, 0.03], emissive = null, alpha = 1, uv = 0.35,
  lit = true, backFace = true }) {
  const m = new BABYLON.StandardMaterial(name, scene);
  if (texture) {
    m.diffuseTexture = texture;
    texture.uScale = texture.vScale = uv;
  }
  if (bump) {
    m.bumpTexture = bump;
    bump.uScale = bump.vScale = uv;
    m.bumpTexture.level = bumpScale;
  }
  m.diffuseColor  = new BABYLON.Color3(...diffuse);
  m.specularColor = new BABYLON.Color3(...specular);
  if (emissive) m.emissiveColor = new BABYLON.Color3(...emissive);
  else if (lit) {
    m.emissiveColor = new BABYLON.Color3(
      diffuse[0] * 0.05, diffuse[1] * 0.055, diffuse[2] * 0.065);
  }
  if (alpha < 1) m.alpha = alpha;
  m.backFaceCulling = backFace;
  if (lit) m.maxSimultaneousLights = MAX_LIGHTS;
  return m;
}

/** @param {{ isMobile?: boolean }} [opts] */
export function createCastleMaterials(scene, opts = {}) {
  const size = opts.isMobile ? MOBILE_TEX : DESKTOP_TEX;
  const withBump = !opts.isMobile;
  const T = (name, base, accent, mode, seed) =>
    noiseTexture(scene, name, base, accent, mode, seed, size);
  const B = (name, mode, seed, strength) =>
    withBump ? bumpTexture(scene, name, mode, seed, size, strength) : null;
  const texPair = (name, base, accent, mode, seed, bumpStrength = 0.35) => ({
    texture: T(`castle_tex_${name}`, base, accent, mode, seed),
    bump: B(`castle_bump_${name}`, mode, seed, bumpStrength),
  });

  const stone = texPair('stone', [0.50, 0.49, 0.46], [0.38, 0.37, 0.35], 'stone', 23);
  const extStone = texPair('extStone', [0.44, 0.42, 0.38], [0.30, 0.29, 0.27], 'stone', 11, 0.42);
  const darkStone = texPair('darkStone', [0.50, 0.56, 0.68], [0.36, 0.41, 0.53], 'stone', 37);
  const marble = texPair('marble', [0.80, 0.78, 0.74], [0.93, 0.92, 0.88], 'marble', 5, 0.22);
  const marbleDark = texPair('marbleDark', [0.30, 0.30, 0.34], [0.44, 0.44, 0.50], 'marble', 9, 0.2);
  const woodFloor = texPair('woodFloor', [0.38, 0.25, 0.14], [0.26, 0.16, 0.08], 'wood', 41, 0.45);
  const woodDark = texPair('woodDark', [0.24, 0.15, 0.08], [0.15, 0.09, 0.045], 'wood', 53, 0.4);
  const plaster = texPair('plaster', [0.60, 0.58, 0.54], [0.52, 0.50, 0.46], 'plaster', 83, 0.28);

  const mats = {
    extStone: mat(scene, 'castle_extStone', {
      diffuse: [0.96, 0.94, 0.90], ...extStone, uv: 0.18,
    }),
    stone: mat(scene, 'castle_stone', {
      diffuse: [0.97, 0.95, 0.92], ...stone, uv: 0.3,
    }),
    darkStone: mat(scene, 'castle_darkStone', {
      diffuse: [0.86, 0.90, 0.98], ...darkStone, uv: 0.28,
    }),
    marble: mat(scene, 'castle_marble', {
      diffuse: [0.97, 0.96, 0.93], ...marble,
      specular: [0.32, 0.32, 0.31], uv: 0.2, bumpScale: 0.18,
    }),
    marbleDark: mat(scene, 'castle_marbleDark', {
      diffuse: [0.95, 0.95, 1.0], ...marbleDark,
      specular: [0.28, 0.28, 0.30], uv: 0.2, bumpScale: 0.16,
    }),
    woodFloor: mat(scene, 'castle_woodFloor', {
      diffuse: [1.0, 0.94, 0.86], ...woodFloor,
      specular: [0.08, 0.06, 0.04], uv: 0.4,
    }),
    woodDark: mat(scene, 'castle_woodDark', {
      diffuse: [1.0, 0.92, 0.84], ...woodDark,
      specular: [0.10, 0.07, 0.05], uv: 0.5,
    }),
    gold: mat(scene, 'castle_gold', {
      diffuse: [0.86, 0.62, 0.22], specular: [0.95, 0.78, 0.38],
    }),
    iron: mat(scene, 'castle_iron', {
      diffuse: [0.10, 0.10, 0.115], specular: [0.30, 0.30, 0.34],
    }),
    ironRust: mat(scene, 'castle_ironRust', {
      diffuse: [0.14, 0.10, 0.08], specular: [0.10, 0.09, 0.08],
    }),
    redFabric: mat(scene, 'castle_redFabric', {
      diffuse: [1.0, 0.94, 0.92],
      texture: T('castle_tex_redFabric', [0.38, 0.04, 0.06], [0.30, 0.03, 0.05], 'fabric', 67),
      specular: [0.02, 0.01, 0.01], uv: 0.45,
    }),
    blueFabric: mat(scene, 'castle_blueFabric', {
      diffuse: [0.94, 0.96, 1.0],
      texture: T('castle_tex_blueFabric', [0.09, 0.14, 0.34], [0.07, 0.10, 0.28], 'fabric', 73),
      specular: [0.02, 0.02, 0.03], uv: 0.45,
    }),
    linen: mat(scene, 'castle_linen', {
      diffuse: [1.0, 0.98, 0.94],
      texture: T('castle_tex_linen', [0.76, 0.72, 0.62], [0.68, 0.64, 0.54], 'fabric', 79),
      specular: [0.02, 0.02, 0.02], uv: 0.55,
    }),
    carpet: mat(scene, 'castle_carpet', {
      diffuse: [0.98, 0.92, 0.92],
      texture: T('castle_tex_carpet', [0.40, 0.08, 0.10], [0.28, 0.05, 0.07], 'fabric', 61),
      specular: [0, 0, 0], uv: 0.45,
    }),
    carpetBlue: mat(scene, 'castle_carpetBlue', {
      diffuse: [0.92, 0.94, 1.0],
      texture: T('castle_tex_carpetBlue', [0.09, 0.14, 0.34], [0.07, 0.10, 0.28], 'fabric', 89),
      specular: [0, 0, 0], uv: 0.45,
    }),
    windowGlow: mat(scene, 'castle_windowGlow', {
      diffuse: [0.1, 0.06, 0.02], emissive: [1.35, 0.82, 0.38], lit: false,
    }),
    windowCool: mat(scene, 'castle_windowCool', {
      diffuse: [0.04, 0.05, 0.08], emissive: [0.35, 0.45, 0.70], lit: false,
    }),
    flame: mat(scene, 'castle_flame', {
      diffuse: [0, 0, 0], emissive: [1.65, 0.95, 0.34], lit: false, backFace: false,
    }),
    ember: mat(scene, 'castle_ember', {
      diffuse: [0.1, 0.03, 0.01], emissive: [1.2, 0.42, 0.10], lit: false,
    }),
    candleGlow: mat(scene, 'castle_candleGlow', {
      diffuse: [0, 0, 0], emissive: [1.3, 0.85, 0.45], lit: false, backFace: false,
    }),
    books: mat(scene, 'castle_books', {
      diffuse: [1.0, 0.95, 0.9],
      texture: T('castle_tex_books', [0.35, 0.16, 0.12], [0.14, 0.24, 0.32], 'wood', 71),
      uv: 1.2,
    }),
    water: mat(scene, 'castle_water', {
      diffuse: [0.25, 0.42, 0.48], specular: [0.5, 0.55, 0.6], alpha: 0.72,
    }),
    plaster: mat(scene, 'castle_plaster', {
      diffuse: [0.98, 0.96, 0.92], ...plaster, uv: 0.25,
    }),
  };

  mats.disposeAll = () => {
    for (const m of Object.values(mats)) {
      if (m && typeof m.dispose === 'function') {
        m.diffuseTexture?.dispose();
        m.bumpTexture?.dispose();
        m.dispose();
      }
    }
  };
  return mats;
}

/** Evening bias 0..1 — drives warm window emissive intensity. */
export function applyWindowWarmth(mats, eveningBias) {
  if (!mats?.windowGlow) return;
  const b = Math.min(1, Math.max(0, eveningBias));
  mats.windowGlow.emissiveColor = new BABYLON.Color3(
    0.85 + b * 0.65, 0.45 + b * 0.5, 0.18 + b * 0.25);
  mats.windowCool.emissiveColor = new BABYLON.Color3(
    0.55 - b * 0.25, 0.62 - b * 0.22, 0.85 - b * 0.2);
}
