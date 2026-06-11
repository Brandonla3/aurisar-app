/**
 * ashwoodPropMeshes — template meshes + per-tile thin-instance builders for
 * all Ashwood props: overworld trees (broadleaf / pine / dead), rocks,
 * bushes, ground details, chests, ruins, caves, the Wildwood forest (trunks,
 * leaf blobs, undergrowth, fallen logs) and per-tile understory.
 *
 * Recipes ported from the prototype (spawnTree ~2345, spawnRock ~2404,
 * spawnRuin ~2441, spawnCave ~2491,
 * buildForest ~1639, buildUnderstory ~1076), simplified where a merged
 * template keeps the silhouette at a fraction of the draw calls. Every
 * scattered element is a thin instance of a shared template — a tile costs
 * one draw call per non-empty template.
 *
 * Determinism: per-site visual variance derives from mulberry32(site.seed);
 * understory derives from mulberry32(worldSeed ^ tileSeed). No Math.random.
 */

/* global BABYLON */

import { mulberry32, hash2 } from '../worldgen/index.js';
import { parseTileId } from './tileMath.js';

const rand = (rng, a, b) => a + rng() * (b - a);

// ── leaf wind sway ──────────────────────────────────────────────────────────
// The prototype rocks each canopy group ±0.012 rad per frame (updateTrees
// ~3920). Canopies here are thin instances of shared templates, so per-frame
// CPU rotation would mean rebuilding matrix buffers; instead a material
// plugin displaces vertices in world space after the instance matrix is
// applied (CUSTOM_VERTEX_UPDATE_WORLDPOS), giving every instance its own
// phase from its world position. Time/wind come from the weather system's
// metadata seam, so storms whip the canopies just like the grass.
class LeafSwayPlugin extends BABYLON.MaterialPluginBase {
  constructor(material) {
    super(material, 'AshwoodLeafSway', 200, { ASH_LEAFSWAY: false });
    this._enable(true);
  }
  getClassName() { return 'AshwoodLeafSwayPlugin'; }
  prepareDefines(defines) { defines.ASH_LEAFSWAY = true; }
  getUniforms() {
    return {
      ubo: [
        { name: 'ashSwayTime', size: 1, type: 'float' },
        { name: 'ashSwayWind', size: 1, type: 'float' },
      ],
      vertex: 'uniform float ashSwayTime;\nuniform float ashSwayWind;',
    };
  }
  bindForSubMesh(uniformBuffer) {
    const w = this._material?.getScene()?.metadata?.ashwood?.weather;
    uniformBuffer.updateFloat('ashSwayTime', w?.time ?? performance.now() * 0.001);
    uniformBuffer.updateFloat('ashSwayWind', Math.max(0.2, Math.min(3, w?.windStrength ?? 1)));
  }
  getCustomCode(shaderType) {
    if (shaderType !== 'vertex') return null;
    return {
      CUSTOM_VERTEX_UPDATE_WORLDPOS: `
#ifdef ASH_LEAFSWAY
{
  float ashPh = worldPos.x * 0.15 + worldPos.z * 0.17;
  // Height-weighted so trunks barely move and tall canopies swing; the cap was
  // 2.5 (clamping out anything above ~knee height on a 6m tree) and is now 5.0
  // so the whole crown actually rides the wind.
  float ashK = ashSwayWind * clamp(positionUpdated.y + 0.6, 0.0, 5.0);
  worldPos.x += (sin(ashSwayTime * 0.6 + ashPh) * 0.10
               + sin(ashSwayTime * 2.3 + ashPh * 1.7) * 0.035) * ashK;
  worldPos.z += cos(ashSwayTime * 0.5 + ashPh) * 0.09 * ashK;
}
#endif
`,
    };
  }
}

// ── geometry helpers ────────────────────────────────────────────────────────

// Displaced icosphere — the prototype's organic blob/boulder silhouette.
function displacedIcoSphere(name, scene, opts) {
  const m = BABYLON.MeshBuilder.CreateIcoSphere(name, { radius: 1, subdivisions: 2, updatable: true }, scene);
  const pos = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const nf = opts.base + opts.amp * hash2((x + opts.seed) * 3.1, (z - opts.seed) * 2.7)
             + 0.12 * Math.sin(y * 4 + opts.seed);
    pos[i] = x * nf; pos[i + 1] = y * nf; pos[i + 2] = z * nf;
  }
  m.setVerticesData(BABYLON.VertexBuffer.PositionKind, pos, false);
  m.convertToFlatShadedMesh();
  if (opts.moss) {
    // moss on upward faces, baked as vertex color (prototype spawnRock)
    const p2 = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const n2 = m.getVerticesData(BABYLON.VertexBuffer.NormalKind);
    const cols = new Float32Array((p2.length / 3) * 4);
    for (let i = 0; i < p2.length / 3; i++) {
      const k = Math.max(0, (n2[i * 3 + 1] - 0.35) / 0.65);
      cols[i * 4]     = 0.95 * (1 - k) + 0.18 * k;
      cols[i * 4 + 1] = 0.95 * (1 - k) + 0.48 * k;
      cols[i * 4 + 2] = 0.95 * (1 - k) + 0.14 * k;
      cols[i * 4 + 3] = 1;
    }
    m.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols, false, 4);
  }
  return m;
}

function mergeKeep(name, meshes) {
  const merged = BABYLON.Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
  merged.name = name;
  return merged;
}

// ── templates (built once per scene, never rendered directly) ───────────────

// Optional surface texture loader with graceful 404 fallback. The album of
// tree textures is user-supplied and may be absent; if a file is missing we
// quietly drop the map and fall back to the flat diffuseColor (and existing
// vertex tints) rather than throwing or rendering a broken-texture material.
// Albedo authoring is desaturated so per-instance HSL tints still read.
function applyOptionalTexture(material, prop, url, scene, { uScale = 1, vScale = 1, level } = {}) {
  const tex = new BABYLON.Texture(
    url, scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
    null,
    () => {                 // onError → revert to flat-color fallback
      if (material[prop] === tex) material[prop] = null;
      tex.dispose();
    },
  );
  tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  tex.uScale = uScale;
  tex.vScale = vScale;
  if (level != null) tex.level = level;
  material[prop] = tex;
}

const TEX_BASE = '/assets/textures';

export function buildPropTemplates(scene, opts = {}) {
  const mat = (name, hex) => {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.diffuseColor = BABYLON.Color3.FromHexString(hex);
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    return m;
  };

  const bark   = mat('ash_bark', '#46331f');
  const leaf   = mat('ash_leaf', '#4a6e29'); // base; per-instance HSL tints multiply in
  const pine   = mat('ash_pine', '#9ab080');
  const rockM  = mat('ash_rock', '#8a8d88');
  const bushM  = mat('ash_bush', '#35451f');
  const wood   = mat('ash_wood', '#5a3b22');
  const green  = mat('ash_green', '#ffffff'); // tinted per instance
  const fTrunkM = mat('ash_ftrunk', '#8a6a48');
  const fLeafM  = mat('ash_fleaf', '#ffffff'); // HSL variance per instance

  // canopy + undergrowth foliage sways in the wind
  for (const m of [leaf, pine, bushM, fLeafM]) new LeafSwayPlugin(m);

  // Bark surface texture (tileable). The leaf art is a cutout *card*, not a
  // tiling texture, so it is NOT applied to the solid blob/cone canopies — it
  // drives the alpha-cutout leaf quads built below. Skipped in bake mode (the
  // GLB contract is plain geometry + vertex colors); each load is fallback-safe.
  let leafCardMat = null;
  if (!opts.bake) {
    // Bark: albedo + normal. Trunks are tall + thin, so the bark repeats
    // vertically. (Normals are .jpg to match the supplied texture pack.)
    applyOptionalTexture(bark, 'diffuseTexture', `${TEX_BASE}/bark_albedo.jpg`, scene, { uScale: 1, vScale: 3 });
    applyOptionalTexture(bark, 'bumpTexture',   `${TEX_BASE}/bark_normal.jpg`, scene, { uScale: 1, vScale: 3, level: 0.8 });
    applyOptionalTexture(fTrunkM, 'diffuseTexture', `${TEX_BASE}/bark_albedo.jpg`, scene, { uScale: 1, vScale: 3 });
    applyOptionalTexture(fTrunkM, 'bumpTexture',   `${TEX_BASE}/bark_normal.jpg`, scene, { uScale: 1, vScale: 3, level: 0.8 });

    // Broadleaf canopy material: an alpha-cutout leaf card. The card's black
    // background is keyed to transparency from luminance (the JPG has no alpha
    // channel), then alpha-TESTED so there's no transparency-sorting cost.
    leafCardMat = new BABYLON.StandardMaterial('ash_leafcard', scene);
    leafCardMat.diffuseColor  = new BABYLON.Color3(1, 1, 1); // per-instance tint multiplies
    leafCardMat.specularColor = new BABYLON.Color3(0, 0, 0);
    leafCardMat.backFaceCulling = false;
    leafCardMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHATESTMODE;
    // Higher cutoff trims the black-background bleed (the dark fringe/halo) at
    // leaf edges; the lost coverage is bought back with more/bigger cards.
    leafCardMat.alphaCutOff = 0.32;
    new LeafSwayPlugin(leafCardMat);

    const sm = BABYLON.Texture.TRILINEAR_SAMPLINGMODE;
    const card = new BABYLON.Texture(
      `${TEX_BASE}/leaf_albedo.jpg`, scene, false, true, sm, null,
      () => {                       // no leaf art → hide cards; the core blob remains
        leafCardMat.alpha = 0;
        leafCardMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      });
    card.wrapU = card.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE; // cards don't tile
    leafCardMat.diffuseTexture = card;
    // Opacity keyed from the (alpha-less) RGB luminance: black bg → transparent.
    const op = new BABYLON.Texture(`${TEX_BASE}/leaf_albedo.jpg`, scene, false, true, sm);
    op.wrapU = op.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    op.getAlphaFromRGB = true;
    leafCardMat.opacityTexture = op;
    // Optional leaf surface relief.
    const ln = new BABYLON.Texture(
      `${TEX_BASE}/leaf_normal.jpg`, scene, false, true, sm, null,
      () => { if (leafCardMat.bumpTexture === ln) leafCardMat.bumpTexture = null; ln.dispose(); });
    ln.wrapU = ln.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    ln.level = 0.5; // soften relief so wrong-facing edge normals don't darken leaves
    leafCardMat.bumpTexture = ln;
  }

  const T = {};

  // overworld tree trunk: unit height, scaled (w, h, w) per instance
  T.trunk = BABYLON.MeshBuilder.CreateCylinder('tpl_trunk', {
    diameterTop: 0.55, diameterBottom: 1.0, height: 1, tessellation: 8,
  }, scene);
  T.trunk.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 0.5, 0));
  T.trunk.material = bark;

  // broadleaf canopy blob — still used as a darker inner core under the leaf
  // cards (and as the full canopy in bake mode / if the leaf art is missing)
  T.blob = displacedIcoSphere('tpl_blob', scene, { base: 0.8, amp: 0.3, seed: 17 });
  T.blob.material = leaf;

  // broadleaf leaf card: a single quad; the ~1.83:1 aspect of the card is set
  // per-instance via (sx, sy) scale. Only exists when the leaf art loaded.
  if (leafCardMat) {
    T.leafCard = BABYLON.MeshBuilder.CreatePlane('tpl_leafcard', {
      size: 1, sideOrientation: BABYLON.Mesh.DOUBLESIDE,
    }, scene);
    T.leafCard.material = leafCardMat;
  }

  // pine canopy: 5 stacked cones merged, unit-ish (≈2.4 wide, ≈6 tall)
  {
    const cones = [];
    for (let i = 0; i < 5; i++) {
      const cr = Math.max(0.5, 2.4 - i * 0.42), ch = 1.9;
      const c = BABYLON.MeshBuilder.CreateCylinder(`pc${i}`, {
        diameterTop: 0, diameterBottom: cr * 2, height: ch, tessellation: 8,
      }, scene);
      c.position.y = i * ch * 0.62 + ch / 2;
      cones.push(c);
    }
    T.pineCanopy = mergeKeep('tpl_pine', cones);
    T.pineCanopy.material = pine;
  }

  // dead-tree branch crown: 4 bare angled branches merged
  {
    const brs = [];
    for (let i = 0; i < 4; i++) {
      const ba = (i / 4) * 6.28 + 0.7;
      const br = BABYLON.MeshBuilder.CreateCylinder(`db${i}`, {
        diameterTop: 0.08, diameterBottom: 0.26, height: 2.0, tessellation: 5,
      }, scene);
      br.position.set(Math.cos(ba) * 0.3, i * 0.5, Math.sin(ba) * 0.3);
      br.rotation.z = -Math.cos(ba) * 1.1;
      br.rotation.x = Math.sin(ba) * 1.1;
      brs.push(br);
    }
    T.deadCrown = mergeKeep('tpl_dead', brs);
    T.deadCrown.material = bark;
  }

  // rock boulder with baked moss vertex colors
  T.rock = displacedIcoSphere('tpl_rock', scene, { base: 0.78, amp: 0.34, seed: 41, moss: true });
  T.rock.material = rockM;

  // bush
  T.bush = BABYLON.MeshBuilder.CreateSphere('tpl_bush', { diameter: 2, segments: 5 }, scene);
  T.bush.bakeTransformIntoVertices(BABYLON.Matrix.Scaling(1, 0.7, 1).multiply(BABYLON.Matrix.Translation(0, 0.55, 0)));
  T.bush.material = bushM;

  // ground details / understory
  T.tuft = BABYLON.MeshBuilder.CreateCylinder('tpl_tuft', { diameterTop: 0, diameterBottom: 0.8, height: 1.05, tessellation: 5 }, scene);
  T.tuft.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 0.52, 0));
  T.tuft.material = green;
  T.fern = BABYLON.MeshBuilder.CreateCylinder('tpl_fern', { diameterTop: 0, diameterBottom: 1.48, height: 0.5, tessellation: 6 }, scene);
  T.fern.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 0.25, 0));
  T.fern.material = green;
  T.flower = BABYLON.MeshBuilder.CreateIcoSphere('tpl_flower', { radius: 0.3, subdivisions: 1 }, scene);
  T.flower.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 0.3, 0));
  T.flower.convertToFlatShadedMesh();
  T.flower.material = green;

  // chest: body + lid merged
  {
    const body = BABYLON.MeshBuilder.CreateBox('cb', { width: 1.0, height: 0.6, depth: 0.65 }, scene);
    body.position.y = 0.3;
    const lid = BABYLON.MeshBuilder.CreateCylinder('cl', {
      diameter: 0.65, height: 1.0, tessellation: 8, arc: 0.5,
    }, scene);
    lid.rotation.z = Math.PI / 2;
    lid.position.y = 0.6;
    T.chest = mergeKeep('tpl_chest', [body, lid]);
    T.chest.material = wood;
  }

  // Wildwood forest: trunk (unit, scaled (w,h,w)), leaf blob sphere, brush cone
  T.fTrunk = BABYLON.MeshBuilder.CreateCylinder('tpl_ftrunk', {
    diameterTop: 1.4, diameterBottom: 2.4, height: 1, tessellation: 8,
  }, scene);
  T.fTrunk.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 0.5, 0));
  T.fTrunk.material = fTrunkM;
  T.fLeaf = BABYLON.MeshBuilder.CreateSphere('tpl_fleaf', { diameterX: 2, diameterY: 1.8, diameterZ: 2, segments: 6 }, scene);
  T.fLeaf.material = fLeafM;
  T.fBrush = BABYLON.MeshBuilder.CreateCylinder('tpl_fbrush', { diameterTop: 0, diameterBottom: 1.2, height: 1.0, tessellation: 5 }, scene);
  T.fBrush.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 0.5, 0));
  T.fBrush.material = bushM;
  T.log = BABYLON.MeshBuilder.CreateCylinder('tpl_log', { diameterTop: 1.2, diameterBottom: 1.4, height: 1, tessellation: 8 }, scene);
  T.log.material = fTrunkM;

  // ── ruins & caves (prototype spawnRuin ~2441, spawnCave ~2491) ──
  const stone   = mat('ash_stone', '#8c8b86');
  const boulderM = mat('ash_boulder', '#ffffff'); // grey shades per instance

  // unit stone box, center origin: walls, caps, arch legs, lintels
  T.stoneBox = BABYLON.MeshBuilder.CreateBox('tpl_stonebox', { size: 1 }, scene);
  T.stoneBox.material = stone;

  // ruin column, unit height, center origin (toppled ones lie on their side)
  T.column = BABYLON.MeshBuilder.CreateCylinder('tpl_column', {
    diameterTop: 0.8, diameterBottom: 0.92, height: 1, tessellation: 10,
  }, scene);
  T.column.material = stone;

  // plain boulder (no moss) — ruin rubble, cave ring, cave roof slab
  T.boulder = displacedIcoSphere('tpl_boulder', scene, { base: 0.78, amp: 0.34, seed: 23 });
  T.boulder.material = boulderM;

  // stalagmite cone, unit radius/height, center origin
  T.stalag = BABYLON.MeshBuilder.CreateCylinder('tpl_stalag', {
    diameterTop: 0, diameterBottom: 2, height: 1, tessellation: 6,
  }, scene);
  T.stalag.convertToFlatShadedMesh();
  T.stalag.material = mat('ash_stalag', '#5a5a60');

  // eerie cave crystal — emissive teal cone
  {
    const crysM = new BABYLON.StandardMaterial('ash_crystal', scene);
    crysM.diffuseColor  = BABYLON.Color3.FromHexString('#2a6b66');
    crysM.emissiveColor = BABYLON.Color3.FromHexString('#39c8b0').scale(0.9);
    crysM.specularColor = new BABYLON.Color3(0, 0, 0);
    T.crystal = BABYLON.MeshBuilder.CreateCylinder('tpl_crystal', {
      diameterTop: 0, diameterBottom: 2, height: 1, tessellation: 5,
    }, scene);
    T.crystal.convertToFlatShadedMesh();
    T.crystal.material = crysM;
  }

  // glowing mushroom — stem + cap merged under one soft-emissive material
  {
    const shroomM = new BABYLON.StandardMaterial('ash_shroom', scene);
    shroomM.diffuseColor  = BABYLON.Color3.FromHexString('#3aa0b8');
    shroomM.emissiveColor = BABYLON.Color3.FromHexString('#2aa0c0').scale(0.6);
    shroomM.specularColor = new BABYLON.Color3(0, 0, 0);
    const stem = BABYLON.MeshBuilder.CreateCylinder('shs', { diameterTop: 0.08, diameterBottom: 0.1, height: 0.3, tessellation: 5 }, scene);
    stem.position.y = 0.15;
    const cap = BABYLON.MeshBuilder.CreateSphere('shc', { diameter: 0.28, segments: 4, slice: 0.6 }, scene);
    cap.position.y = 0.3;
    T.shroom = mergeKeep('tpl_shroom', [stem, cap]);
    T.shroom.material = shroomM;
  }

  // cave void dome — inward-facing near-black hemisphere; the open mouth of
  // the boulder ring reads as a real opening into darkness. Fog must not
  // wash it out or the illusion breaks.
  {
    const voidM = new BABYLON.StandardMaterial('ash_cavevoid', scene);
    voidM.diffuseColor  = BABYLON.Color3.FromHexString('#04050a');
    voidM.emissiveColor = BABYLON.Color3.FromHexString('#04050a');
    voidM.specularColor = new BABYLON.Color3(0, 0, 0);
    voidM.disableLighting = true;
    voidM.fogEnabled = false;
    T.caveDome = BABYLON.MeshBuilder.CreateSphere('tpl_cavedome', {
      diameter: 2, segments: 8, slice: 0.52,
      sideOrientation: BABYLON.Mesh.BACKSIDE,
    }, scene);
    T.caveDome.material = voidM;
  }

  for (const key of Object.keys(T)) {
    T[key].setEnabled(false);
    T[key].isPickable = false;
  }
  return T;
}

// ── per-tile thin-instance accumulation ─────────────────────────────────────

class Acc {
  constructor() { this.mats = []; this.cols = []; }
  push(px, py, pz, rx, ry, rz, sx, sy, sz, col) {
    const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
    const m = BABYLON.Matrix.Compose(new BABYLON.Vector3(sx, sy, sz), q, new BABYLON.Vector3(px, py, pz));
    for (let i = 0; i < 16; i++) this.mats.push(m.m[i]);
    if (col) this.cols.push(col.r, col.g, col.b, 1);
  }
  realize(name, template, scene, container, castShadow) {
    if (!this.mats.length) return;
    const mesh = template.clone(name);
    // CRITICAL: thinInstanceSetBuffer stores world0-3 in the GEOMETRY, and
    // clone() shares geometry with the template (and so with every other
    // tile's clone). Without a unique geometry, all tiles fight over one
    // instance buffer and stale counts render giant garbage triangles.
    mesh.makeGeometryUnique();
    mesh.setEnabled(true);
    mesh.isPickable = false;
    mesh.thinInstanceSetBuffer('matrix', new Float32Array(this.mats), 16, true);
    if (this.cols.length) mesh.thinInstanceSetBuffer('color', new Float32Array(this.cols), 4, true);
    mesh.thinInstanceRefreshBoundingInfo();
    container.meshes.push(mesh);
    if (castShadow) castShadow(mesh);
  }
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

/**
 * Build all prop thin-instance meshes for one tile.
 * @param {function} inBounds  (x,z) => bool for this tile
 * @param {object}   opts      { lights?: boolean } — cave point lights are
 *   skipped in bake mode (the GLB contract is geometry + vertex colors).
 */
export function buildTileProps(meta, scene, wg, templates, container, inBounds, castShadow, opts = {}) {
  const surfaceY = wg.surfaceY;
  const s = wg.sites;
  const acc = {
    trunk: new Acc(), blob: new Acc(), leafCard: new Acc(), pineCanopy: new Acc(), deadCrown: new Acc(),
    rock: new Acc(), bush: new Acc(), tuft: new Acc(), fern: new Acc(),
    flower: new Acc(), chest: new Acc(),
    stoneBox: new Acc(), column: new Acc(), boulder: new Acc(),
    stalag: new Acc(), crystal: new Acc(), shroom: new Acc(), caveDome: new Acc(),
    fTrunk: new Acc(), fLeaf: new Acc(), fBrush: new Acc(), log: new Acc(),
  };

  // ── overworld trees (prototype spawnTree) ──
  for (const t of s.trees) {
    if (!inBounds(t.x, t.z)) continue;
    const rng = mulberry32(t.seed);
    const gy = surfaceY(t.x, t.z);
    const th = rand(rng, 5, 8.5), tr = rand(rng, 0.3, 0.55);
    const yaw = rng() * 6.28;
    acc.trunk.push(t.x, gy, t.z, 0, yaw, 0, tr * 2, th, tr * 2, null);
    if (t.kind === 'pine') {
      acc.pineCanopy.push(t.x, gy + th * 0.42, t.z, 0, yaw, 0, 1, 1, 1, null);
    } else if (t.kind === 'dead') {
      acc.deadCrown.push(t.x, gy + th * 0.5, t.z, 0, yaw, 0, 1, th / 7, 1, null);
    } else {
      const cy = gy + th * 0.92;
      if (templates.leafCard) {
        // Cards OWN the silhouette; the cores are small gap-fillers strictly
        // inside the card shell (a core larger than the card cloud pokes out
        // as a bare faceted icosphere and reads as the old geometric canopy).
        const cores = 2;
        for (let i = 0; i < cores; i++) {
          const br = rand(rng, 1.2, 1.7);
          acc.blob.push(
            t.x + rand(rng, -0.7, 0.7), cy + rand(rng, 0.0, 1.0), t.z + rand(rng, -0.7, 0.7),
            rand(rng, 0, 3), rand(rng, 0, 6), rand(rng, 0, 3),
            br, br * rand(rng, 0.8, 1.0), br,
            hslToRgb(0.28 + rng() * 0.04, 0.42, 0.30 + rng() * 0.08),
          );
        }
        // Cards placed as a loose shell — biased outward from the canopy
        // center so the leafy edges form the outline, dense enough to overlap.
        const cards = 24 + ((rng() * 8) | 0);
        for (let i = 0; i < cards; i++) {
          const w = rand(rng, 3.2, 4.6);
          const ang = rng() * 6.28;
          const rr = 1.0 + Math.sqrt(rng()) * 1.7;       // outward bias, max ~2.7
          acc.leafCard.push(
            t.x + Math.cos(ang) * rr, cy + rand(rng, -0.8, 3.0), t.z + Math.sin(ang) * rr,
            rand(rng, -0.5, 0.5), rng() * 6.28, rand(rng, -0.5, 0.5),
            w, w * 0.55, w,    // card aspect ≈ 1.83:1; z (plane depth) unused
            hslToRgb(0.25 + rng() * 0.06, 0.2, 0.82 + rng() * 0.14), // bright tint; texture carries the color
          );
        }
      } else {
        const blobs = 4 + ((rng() * 3) | 0);
        for (let i = 0; i < blobs; i++) {
          const br = rand(rng, 1.6, 2.7);
          acc.blob.push(
            t.x + rand(rng, -1.3, 1.3), cy + rand(rng, -0.4, 1.9), t.z + rand(rng, -1.3, 1.3),
            rand(rng, 0, 3), rand(rng, 0, 6), rand(rng, 0, 3),
            br, br * rand(rng, 0.8, 1.1), br,
            hslToRgb(0.28 + rng() * 0.04, 0.4, 0.22 + rng() * 0.1),
          );
        }
      }
    }
  }

  // ── rocks ──
  for (const r of s.rocks) {
    if (!inBounds(r.x, r.z)) continue;
    if (wg.inMountain(r.x, r.z) || wg.inForest(r.x, r.z)) continue; // zones dress themselves
    const rng = mulberry32(r.seed);
    const rr = rand(rng, 0.9, 2.6);
    acc.rock.push(r.x, surfaceY(r.x, r.z) + rr * 0.4, r.z,
      rand(rng, 0, 0.4), rand(rng, 0, 6), rand(rng, 0, 0.4), rr, rr, rr, null);
  }

  // ── bushes ──
  for (const b of s.bushes) {
    if (!inBounds(b.x, b.z)) continue;
    const rng = mulberry32(b.seed);
    const sc = rand(rng, 0.5, 1.1);
    acc.bush.push(b.x, surfaceY(b.x, b.z), b.z, 0, rng() * 6.28, 0, sc, sc, sc, null);
  }

  // ── ground details: fern / mushroom-tuft / flower by biome ──
  for (const d of s.details) {
    if (!inBounds(d.x, d.z)) continue;
    const rng = mulberry32(d.seed);
    const gy = surfaceY(d.x, d.z);
    const pick = rng();
    const sc = rand(rng, 0.6, 1.3);
    const bi = wg.config.biomes[d.biome];
    const gc = bi.grassCol;
    const col = { r: gc[0] + 0.1 * rng(), g: gc[1] + 0.14 * rng(), b: gc[2] + 0.05 * rng() };
    if (pick < 0.45) acc.fern.push(d.x, gy, d.z, 0, rng() * 6.28, 0, sc, sc * 0.85, sc, col);
    else if (pick < 0.8) acc.tuft.push(d.x, gy, d.z, 0, rng() * 6.28, 0, sc, sc, sc, col);
    else acc.flower.push(d.x, gy, d.z, 0, rng() * 6.28, 0, sc, sc, sc,
      [{ r: 0.78, g: 0.64, b: 0.24 }, { r: 0.85, g: 0.56, b: 0.69 }, { r: 0.71, g: 0.44, b: 0.69 }, { r: 0.85, g: 0.85, b: 0.78 }][(rng() * 4) | 0]);
  }

  // ── chests ──
  for (const c of s.chests) {
    if (!inBounds(c.x, c.z)) continue;
    const rng = mulberry32(c.seed);
    acc.chest.push(c.x, surfaceY(c.x, c.z), c.z, 0, rng() * 6.28, 0, 1, 1, 1, null);
  }

  // ── ruins: broken wall ring, columns, archway, rubble (spawnRuin) ──
  // Loot chests / monster guards from the prototype are server-side concerns
  // (the manifest already places chests); only the dressing renders here.
  const RUBBLE = { r: 0.49, g: 0.486, b: 0.467 };  // #7d7c77
  for (const u of s.ruins) {
    if (!inBounds(u.x, u.z)) continue;
    if (wg.inMountain(u.x, u.z)) continue;
    const rng = mulberry32(u.seed);
    const segs = 9, rr = rand(rng, 5.5, 7.5);
    for (let i = 0; i < segs; i++) {
      // draw every roll even for skipped gaps so layout is order-stable
      const gap = rng() < 0.32;
      const ang = (i / segs) * Math.PI * 2;
      const wx = u.x + Math.cos(ang) * rr, wz = u.z + Math.sin(ang) * rr;
      const wh = rand(rng, 1.0, 3.8), ww = rand(rng, 1.8, 3.0);
      const wyaw = ang + Math.PI / 2 + rand(rng, -0.15, 0.15);
      const cap = rng() < 0.5;
      if (gap) continue;
      const wy = surfaceY(wx, wz);
      acc.stoneBox.push(wx, wy + wh / 2, wz, 0, wyaw, 0, ww, wh, 0.6, null);
      if (cap) acc.stoneBox.push(wx, wy + wh + 0.45, wz, 0, wyaw, 0, ww * 0.5, 0.5, 0.7, null);
    }
    const ncol = 3 + ((rng() * 3) | 0);
    for (let i = 0; i < ncol; i++) {
      const a = rng() * 6.28, d = rand(rng, 1.5, 4.5);
      const px = u.x + Math.cos(a) * d, pz = u.z + Math.sin(a) * d;
      const pgy = surfaceY(px, pz);
      const ch = rand(rng, 1.5, 4.0), toppled = rng() < 0.4;
      if (toppled) acc.column.push(px, pgy + 0.42, pz, 0, rng() * 6.28, Math.PI / 2, 1, ch, 1, null);
      else acc.column.push(px, pgy + ch / 2, pz, 0, 0, 0, 1, ch, 1, null);
    }
    // archway: two legs + lintel near the center
    const aa = rng() * 6.28;
    const ax = u.x + Math.cos(aa) * 2.2, az = u.z + Math.sin(aa) * 2.2;
    for (const off of [-1, 1]) {
      const lx = ax + Math.cos(aa + Math.PI / 2) * off;
      const lz = az + Math.sin(aa + Math.PI / 2) * off;
      acc.stoneBox.push(lx, surfaceY(lx, lz) + 1.6, lz, 0, aa + Math.PI / 2, 0, 0.5, 3.2, 0.5, null);
    }
    acc.stoneBox.push(ax, surfaceY(ax, az) + 3.4, az, 0, aa + Math.PI / 2, 0, 2.8, 0.6, 0.6, null);
    for (let i = 0; i < 8; i++) {
      const a = rng() * 6.28, d = rng() * 6;
      const rx = u.x + Math.cos(a) * d, rz = u.z + Math.sin(a) * d;
      const sc = rand(rng, 0.3, 0.7);
      acc.boulder.push(rx, surfaceY(rx, rz) + 0.2, rz, 0, rng() * 6.28, 0, sc, sc, sc, RUBBLE);
    }
  }

  // ── caves: boulder horseshoe, void dome, stalagmites, crystals (spawnCave) ──
  const CAVE_RING = { r: 0.298, g: 0.298, b: 0.329 };  // #4c4c54
  const CAVE_ROOF = { r: 0.243, g: 0.243, b: 0.275 };  // #3e3e46
  for (const cv of s.caves) {
    if (!inBounds(cv.x, cv.z)) continue;
    if (wg.inMountain(cv.x, cv.z)) continue;
    const rng = mulberry32(cv.seed);
    const gy = surfaceY(cv.x, cv.z);
    const facing = rng() * 6.28;
    const ringR = 5.2;
    for (let i = 0; i < 11; i++) {
      const ang = (i / 11) * Math.PI * 2;
      const br = rand(rng, 2.2, 3.4);
      // keep a ~70° arc open at the entrance
      const da = Math.abs((((ang - facing + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      if (da < 0.6) continue;
      const bx = cv.x + Math.cos(ang) * ringR, bz = cv.z + Math.sin(ang) * ringR;
      acc.boulder.push(bx, surfaceY(bx, bz) + br * 0.3, bz, 0, rng() * 6.28, 0, br, br * 1.4, br, CAVE_RING);
    }
    // back overhang slab
    const ox = cv.x - Math.cos(facing) * 2.4, oz = cv.z - Math.sin(facing) * 2.4;
    acc.boulder.push(ox, surfaceY(ox, oz) + 5.0, oz, 0, facing, 0, 4.2 * 1.4, 4.2 * 0.5, 4.2 * 1.4, CAVE_ROOF);
    // dark void dome under the slab
    acc.caveDome.push(cv.x, gy + 0.02, cv.z, 0, 0, 0, 3.8, 3.8 * 1.2, 3.8, null);
    // stalagmites framing the entrance
    for (let i = 0; i < 4; i++) {
      const sa = facing + rand(rng, -0.85, 0.85), sd = rand(rng, 3.4, 4.6);
      const sx = cv.x + Math.cos(sa) * sd, sz = cv.z + Math.sin(sa) * sd;
      acc.stalag.push(sx, surfaceY(sx, sz) + 0.2, sz,
        rand(rng, -0.12, 0.12), rng() * 6, rand(rng, -0.12, 0.12),
        rand(rng, 0.22, 0.4), rand(rng, 1.1, 2.3), rand(rng, 0.22, 0.4), null);
    }
    // eerie crystals + glowing mushrooms
    for (let i = 0; i < 5; i++) {
      const a = rng() * 6.28, d = rand(rng, 0.5, 3.5);
      const kx = cv.x + Math.cos(a) * d, kz = cv.z + Math.sin(a) * d;
      acc.crystal.push(kx, surfaceY(kx, kz) + 0.4, kz,
        rand(rng, -0.3, 0.3), rng() * 6, rand(rng, -0.3, 0.3),
        rand(rng, 0.12, 0.26), rand(rng, 0.6, 1.4), rand(rng, 0.12, 0.26), null);
    }
    for (let i = 0; i < 6; i++) {
      const a = rng() * 6.28, d = rand(rng, 0.5, 4);
      const mx = cv.x + Math.cos(a) * d, mz = cv.z + Math.sin(a) * d;
      acc.shroom.push(mx, surfaceY(mx, mz), mz, 0, rng() * 6.28, 0, 1, 1, 1, null);
    }
    if (opts.lights) {
      const light = new BABYLON.PointLight(
        `tile_${meta.id}_cavelight_${cv.seed}`,
        new BABYLON.Vector3(cv.x, gy + 1.6, cv.z), scene);
      light.diffuse = BABYLON.Color3.FromHexString('#66ccbb');
      light.intensity = 0.8;
      light.range = 16;
      container.lights.push(light);
    }
  }

  // ── Wildwood forest (prototype buildForest) ──
  for (const t of s.forestTrees) {
    if (!inBounds(t.x, t.z)) continue;
    const rng = mulberry32(t.seed);
    const y = surfaceY(t.x, t.z);
    acc.fTrunk.push(t.x, y, t.z, t.lean, t.yaw, t.lean * 0.6, t.w, t.h, t.w,
      hslToRgb(0.08 + rng() * 0.02, 0.34, 0.18 + rng() * 0.08));
    const cby = y + t.h * (0.72 + rng() * 0.08);
    const ch = t.h * (0.5 + rng() * 0.15);
    const cr = t.w * (2.6 + rng() * 1.8) + t.h * 0.12;
    const hue = t.arch === 0 ? 0.28 + rng() * 0.03 : t.arch === 1 ? 0.30 + rng() * 0.03 : 0.26 + rng() * 0.04;
    if (templates.leafCard) {
      // Same card-over-core treatment as the overworld broadleafs, scaled by
      // the canopy radius — otherwise the Wildwood stays a wall of smooth
      // geometric spheres behind the carded overworld trees.
      for (let c = 0; c < 3; c++) {
        const ang = rng() * 6.28, spread = cr * (0.1 + rng() * 0.35);
        const bs = cr * (0.38 + rng() * 0.18);
        acc.fLeaf.push(
          t.x + Math.cos(ang) * spread, cby + (c / 3 - 0.2) * ch * 0.7, t.z + Math.sin(ang) * spread,
          rng() * 0.3, rng() * 6.28, rng() * 0.3,
          bs, bs * (0.8 + rng() * 0.2), bs,
          hslToRgb(hue, 0.38 + rng() * 0.12, 0.28 + rng() * 0.08),
        );
      }
      const cards = Math.min(34, 12 + (cr * 2.5) | 0);
      for (let c = 0; c < cards; c++) {
        const ang = rng() * 6.28;
        const rr = cr * (0.35 + Math.sqrt(rng()) * 0.65);   // outward bias to the rim
        const w = cr * rand(rng, 0.7, 1.05);
        acc.leafCard.push(
          t.x + Math.cos(ang) * rr,
          cby + rand(rng, -0.35, 0.75) * ch,
          t.z + Math.sin(ang) * rr,
          rand(rng, -0.5, 0.5), rng() * 6.28, rand(rng, -0.5, 0.5),
          w, w * 0.55, w,
          hslToRgb(hue, 0.22, 0.74 + rng() * 0.18),
        );
      }
    } else {
      for (let c = 0; c < 7; c++) {
        const layer = c / 7, ang = rng() * 6.28;
        const spread = cr * (0.2 + rng() * 0.9);
        const k = 0.45 + (1 - layer) * 0.45;
        acc.fLeaf.push(
          t.x + Math.cos(ang) * spread * k,
          cby + (layer - 0.25) * ch + (rng() - 0.5) * ch * 0.2,
          t.z + Math.sin(ang) * spread * k,
          rng() * 0.3, rng() * 6.28, rng() * 0.3,
          cr * (0.65 + rng() * 0.55), cr * (0.45 + rng() * 0.45), cr * (0.65 + rng() * 0.55),
          hslToRgb(hue, 0.34 + rng() * 0.16, 0.24 + rng() * 0.14),
        );
      }
    }
  }
  for (const b of s.forestBrush ?? []) {
    if (!inBounds(b.x, b.z)) continue;
    const rng = mulberry32(b.seed);
    acc.fBrush.push(b.x, surfaceY(b.x, b.z), b.z, 0, rng() * 6.28, 0,
      b.sc * (0.8 + rng() * 0.6), b.sc, b.sc * (0.8 + rng() * 0.6),
      hslToRgb(0.25 + rng() * 0.07, 0.4 + rng() * 0.2, 0.16 + rng() * 0.12));
  }
  for (const l of s.forestLogs ?? []) {
    if (!inBounds(l.x, l.z)) continue;
    acc.log.push(l.x, surfaceY(l.x, l.z) + 0.55, l.z, 0, l.yaw, Math.PI / 2, 1, l.len, 1, null);
  }

  // ── understory: dense decor scatter, deterministic per tile ──
  {
    const { col, row } = parseTileId(meta.id);
    const tileSeed = ((col * 73856093) ^ (row * 19349663)) >>> 0;
    const rng = mulberry32((wg.config.seed ^ tileSeed) >>> 0);
    const R2 = wg.config.radius * wg.config.radius;
    for (let i = 0; i < 260; i++) {
      const x = meta.min.x + rng() * (meta.max.x - meta.min.x);
      const z = meta.min.z + rng() * (meta.max.z - meta.min.z);
      if (x * x + z * z > R2 * 0.94) continue;
      if (wg.inMountain(x, z) || wg.inForest(x, z)) continue;
      if (wg.lakeWaterDepthAt(x, z) > 0.02) continue;
      const bi = wg.biomeAt(x, z);
      if (rng() > bi.grass * 0.85 + 0.08) continue;
      if (wg.trailDirtAt(x, z) > 0.1) continue;
      const sc = rand(rng, 0.5, 1.25);
      const gc = bi.grassCol;
      const col2 = { r: gc[0] * 1.3 + 0.08 * rng(), g: gc[1] * 1.3 + 0.1 * rng(), b: gc[2] * 1.2 };
      acc.tuft.push(x, surfaceY(x, z), z, 0, rng() * 6.28, 0, sc, sc * (0.8 + rng() * 0.7), sc, col2);
    }
  }

  acc.trunk.realize(`tile_${meta.id}_trunks`, templates.trunk, scene, container, castShadow);
  acc.blob.realize(`tile_${meta.id}_blobs`, templates.blob, scene, container, castShadow);
  // Leaf cards skip shadow casting — alpha-tested cards would otherwise drop
  // solid square shadows unless the shadow map is also alpha-aware.
  if (templates.leafCard) acc.leafCard.realize(`tile_${meta.id}_leafcards`, templates.leafCard, scene, container, null);
  acc.pineCanopy.realize(`tile_${meta.id}_pines`, templates.pineCanopy, scene, container, castShadow);
  acc.deadCrown.realize(`tile_${meta.id}_dead`, templates.deadCrown, scene, container, castShadow);
  acc.rock.realize(`tile_${meta.id}_rocks`, templates.rock, scene, container, castShadow);
  acc.bush.realize(`tile_${meta.id}_bushes`, templates.bush, scene, container, null);
  acc.tuft.realize(`tile_${meta.id}_tufts`, templates.tuft, scene, container, null);
  acc.fern.realize(`tile_${meta.id}_ferns`, templates.fern, scene, container, null);
  acc.flower.realize(`tile_${meta.id}_flowers`, templates.flower, scene, container, null);
  acc.chest.realize(`tile_${meta.id}_chests`, templates.chest, scene, container, castShadow);
  acc.stoneBox.realize(`tile_${meta.id}_ruinstone`, templates.stoneBox, scene, container, castShadow);
  acc.column.realize(`tile_${meta.id}_ruincols`, templates.column, scene, container, castShadow);
  acc.boulder.realize(`tile_${meta.id}_boulders`, templates.boulder, scene, container, castShadow);
  acc.stalag.realize(`tile_${meta.id}_stalags`, templates.stalag, scene, container, castShadow);
  acc.crystal.realize(`tile_${meta.id}_crystals`, templates.crystal, scene, container, null);
  acc.shroom.realize(`tile_${meta.id}_shrooms`, templates.shroom, scene, container, null);
  acc.caveDome.realize(`tile_${meta.id}_cavedomes`, templates.caveDome, scene, container, null);
  acc.fTrunk.realize(`tile_${meta.id}_ftrunks`, templates.fTrunk, scene, container, castShadow);
  acc.fLeaf.realize(`tile_${meta.id}_fleaves`, templates.fLeaf, scene, container, castShadow);
  acc.fBrush.realize(`tile_${meta.id}_fbrush`, templates.fBrush, scene, container, null);
  acc.log.realize(`tile_${meta.id}_logs`, templates.log, scene, container, castShadow);
}
