/**
 * Castle materials — ~16 shared StandardMaterials for every castle mesh.
 *
 * Builders never create materials; they tag meshes with a matKey and the
 * merge pass assigns these. Diffuse detail comes from small procedural
 * DynamicTextures (hash2-based, deterministic — no Math.random) so stone
 * reads as stone and wood as wood without shipping texture assets.
 *
 * maxSimultaneousLights is raised to 8 on lit materials: the CastleLightPool
 * runs up to 6 warm PointLights near the player on top of the scene's
 * hemispheric/directional fills (StandardMaterial's default cap is 4).
 */

/* global BABYLON */

import { hash2 } from '../../worldgen/rng.js';

const MAX_LIGHTS = 8;

/**
 * 128px procedural diffuse texture. mode:
 *  'stone'  — block speckle + mortar-ish darker joints
 *  'wood'   — lengthwise plank streaks
 *  'marble' — soft light field with faint veins
 */
function noiseTexture(scene, name, base, accent, mode, seed = 1) {
  const SIZE = 128;
  const tex = new BABYLON.DynamicTexture(name, { width: SIZE, height: SIZE }, scene, true);
  const ctx = tex.getContext();
  const [br, bg, bb] = base, [ar, ag, ab] = accent;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let t;
      if (mode === 'wood') {
        // plank streaks along x with per-row waviness
        const wob = hash2(seed, y * 0.13) * 4;
        t = hash2(seed + Math.floor((y + wob) / 10), x * 0.055) * 0.55 +
            hash2(seed * 3.7, x * 0.9 + y * 7.1) * 0.20;
      } else if (mode === 'marble') {
        const vein = Math.abs(Math.sin(x * 0.11 + hash2(seed, Math.floor(y / 7)) * 6.28 + y * 0.03));
        t = (vein > 0.94 ? 0.85 : 0) + hash2(seed + x * 0.51, y * 0.47) * 0.16;
      } else {
        // stone: coarse cells + fine speckle
        const cell = hash2(seed + Math.floor(x / 16), Math.floor(y / 12)) * 0.4;
        const fine = hash2(seed * 1.7 + x * 0.83, y * 0.71) * 0.35;
        const joint = (x % 16 < 1 || y % 12 < 1) ? 0.5 : 0;
        t = cell + fine + joint * 0.6;
      }
      t = Math.min(1, Math.max(0, t));
      const i = (y * SIZE + x) * 4;
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

function mat(scene, name, { diffuse, texture = null, specular = [0.03, 0.03, 0.03],
  emissive = null, alpha = 1, uv = 0.35, lit = true, backFace = true }) {
  const m = new BABYLON.StandardMaterial(name, scene);
  if (texture) {
    m.diffuseTexture = texture;
    texture.uScale = texture.vScale = uv;
  }
  m.diffuseColor  = new BABYLON.Color3(...diffuse);
  m.specularColor = new BABYLON.Color3(...specular);
  if (emissive) m.emissiveColor = new BABYLON.Color3(...emissive);
  else if (lit) {
    // faint self-glow floor: interiors between torch pools stay readable
    // (never pitch black) without washing out the lighting mood
    m.emissiveColor = new BABYLON.Color3(
      diffuse[0] * 0.09, diffuse[1] * 0.09, diffuse[2] * 0.10);
  }
  if (alpha < 1) m.alpha = alpha;
  m.backFaceCulling = backFace;
  if (lit) m.maxSimultaneousLights = MAX_LIGHTS;
  return m;
}

/** Create the full shared material set. Call once; dispose via disposeAll(). */
export function createCastleMaterials(scene) {
  const T = (name, base, accent, mode, seed) => noiseTexture(scene, name, base, accent, mode, seed);

  const mats = {
    // ── stone family ──
    extStone: mat(scene, 'castle_extStone', {
      diffuse: [0.96, 0.94, 0.90],
      texture: T('castle_tex_extStone', [0.44, 0.42, 0.38], [0.30, 0.29, 0.27], 'stone', 11),
      uv: 0.18,
    }),
    stone: mat(scene, 'castle_stone', {
      diffuse: [1.0, 0.97, 0.92],
      texture: T('castle_tex_stone', [0.52, 0.49, 0.45], [0.38, 0.36, 0.34], 'stone', 23),
      uv: 0.3,
    }),
    darkStone: mat(scene, 'castle_darkStone', {
      diffuse: [0.85, 0.86, 0.90],
      texture: T('castle_tex_darkStone', [0.26, 0.25, 0.26], [0.15, 0.15, 0.17], 'stone', 37),
      uv: 0.28,
    }),
    marble: mat(scene, 'castle_marble', {
      diffuse: [1.0, 0.99, 0.96],
      texture: T('castle_tex_marble', [0.78, 0.76, 0.71], [0.92, 0.91, 0.88], 'marble', 5),
      specular: [0.32, 0.32, 0.30], uv: 0.2,
    }),
    marbleDark: mat(scene, 'castle_marbleDark', {
      diffuse: [0.95, 0.95, 1.0],
      texture: T('castle_tex_marbleDark', [0.30, 0.30, 0.34], [0.44, 0.44, 0.50], 'marble', 9),
      specular: [0.28, 0.28, 0.30], uv: 0.2,
    }),
    // ── wood family ──
    woodFloor: mat(scene, 'castle_woodFloor', {
      diffuse: [1.0, 0.94, 0.86],
      texture: T('castle_tex_woodFloor', [0.38, 0.25, 0.14], [0.26, 0.16, 0.08], 'wood', 41),
      specular: [0.08, 0.06, 0.04], uv: 0.4,
    }),
    woodDark: mat(scene, 'castle_woodDark', {
      diffuse: [1.0, 0.92, 0.84],
      texture: T('castle_tex_woodDark', [0.24, 0.15, 0.08], [0.15, 0.09, 0.045], 'wood', 53),
      specular: [0.10, 0.07, 0.05], uv: 0.5,
    }),
    // ── metal ──
    gold: mat(scene, 'castle_gold', {
      diffuse: [0.86, 0.62, 0.22], specular: [0.95, 0.78, 0.38],
    }),
    iron: mat(scene, 'castle_iron', {
      diffuse: [0.10, 0.10, 0.115], specular: [0.30, 0.30, 0.34],
    }),
    // ── fabric ──
    redFabric: mat(scene, 'castle_redFabric', {
      diffuse: [0.44, 0.05, 0.07], specular: [0.02, 0.01, 0.01],
    }),
    blueFabric: mat(scene, 'castle_blueFabric', {
      diffuse: [0.10, 0.16, 0.38], specular: [0.02, 0.02, 0.03],
    }),
    linen: mat(scene, 'castle_linen', {
      diffuse: [0.82, 0.78, 0.68], specular: [0.02, 0.02, 0.02],
    }),
    carpet: mat(scene, 'castle_carpet', {
      diffuse: [0.38, 0.07, 0.09],
      texture: T('castle_tex_carpet', [0.40, 0.08, 0.10], [0.28, 0.05, 0.07], 'stone', 61),
      specular: [0, 0, 0], uv: 0.6,
    }),
    // ── glow (unlit — pure emissive, cheap) ──
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
    // ── misc ──
    books: mat(scene, 'castle_books', {
      diffuse: [1.0, 0.95, 0.9],
      texture: T('castle_tex_books', [0.35, 0.16, 0.12], [0.14, 0.24, 0.32], 'wood', 71),
      uv: 1.2,
    }),
    water: mat(scene, 'castle_water', {
      diffuse: [0.25, 0.42, 0.48], specular: [0.5, 0.55, 0.6], alpha: 0.72,
    }),
    plaster: mat(scene, 'castle_plaster', {
      diffuse: [1.0, 0.97, 0.9],
      texture: T('castle_tex_plaster', [0.62, 0.58, 0.50], [0.54, 0.50, 0.44], 'marble', 83),
      uv: 0.25,
    }),
  };

  mats.disposeAll = () => {
    for (const m of Object.values(mats)) {
      if (m && typeof m.dispose === 'function') {
        m.diffuseTexture?.dispose();
        m.dispose();
      }
    }
  };
  return mats;
}
