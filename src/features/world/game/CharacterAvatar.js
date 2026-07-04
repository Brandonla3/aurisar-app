/**
 * CharacterAvatar — one player's full 3D character instance.
 *
 * Supports two rendering paths:
 *   GLB path  — when AssetLibrary has base_body loaded (MPFB character)
 *   Box path  — neutral box humanoid fallback until GLB assets exist
 *
 * Public API used by BabylonWorldScene:
 *   CharacterAvatar.create(id, username, config, scene, assetLibrary)
 *   avatar.root            — TransformNode for position/rotation
 *   avatar.isMoving        — set by scene movement code each frame
 *   avatar.update(dt)      — call every frame from tick
 *   avatar.setBodyMorph(key, value)
 *   avatar.setFaceMorph(key, value)
 *   avatar.setSpeciesMorph(value)
 *   avatar.setHair(style, color)
 *   avatar.setHornMesh(hornName)
 *   avatar.setClothing(slot, meshName)
 *   avatar.setSkinTone(hex)
 *   avatar.toConfig()
 *   avatar.dispose()
 */

/* global BABYLON */

import { mergeConfig, MORPH_KEYS, BONES, CLOTHING_SLOTS, GEAR_SLOTS } from './avatarSchema.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToColor3(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new BABYLON.Color3(r, g, b);
}

// Default albedo per clothing slot. The Blender-authored clothing GLBs ship
// with no baseColorFactor (per scripts/blender/README.md: "runtime-tinted via
// albedoColor"), which makes them render pure white otherwise — appearing as
// bright humanoid-shaped meshes overlaid on the character.
const CLOTHING_DEFAULTS = {
  top:    new BABYLON.Color3(0.55, 0.42, 0.31), // leather tan
  bottom: new BABYLON.Color3(0.31, 0.23, 0.15), // dark trousers
  shoes:  new BABYLON.Color3(0.18, 0.13, 0.09), // dark boot leather
};

const SPECIES_DEFAULTS = {
  horns: new BABYLON.Color3(0.75, 0.65, 0.50),  // bone / ivory
  tail:  new BABYLON.Color3(0.40, 0.30, 0.18),  // warm brown fur
};

function tintInstance(inst, color) {
  inst.rootNodes
    .flatMap(n => n.getChildMeshes ? n.getChildMeshes(false) : [])
    .forEach(m => {
      if (!m.material) return;
      m.material.albedoColor = color;
      // GLB pieces load as PBRMaterial; widen roughness under high-frequency
      // curvature so skinned edges don't sparkle as the rig animates.
      if ('enableSpecularAntiAliasing' in m.material) {
        m.material.enableSpecularAntiAliasing = true;
      }
    });
}

// ── Optional authored skin maps ──────────────────────────────────────────────
// Baked character textures (Phase 1 asset pipeline) are user-supplied and may
// not exist yet. Each map loads with a graceful 404 fallback (same pattern as
// the tree textures in ashwoodPropMeshes): a missing file quietly reverts to
// the flat albedo tint instead of rendering a broken material. invertY=false —
// these are authored against the glTF UV convention of the body meshes.
const SKIN_TEX_BASE = '/assets/textures/character/skin';

function applyOptionalPBRTexture(material, prop, url, scene, onLoad) {
  const tex = new BABYLON.Texture(
    url, scene, false, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
    onLoad ?? null,
    () => {                 // onError → drop the map, keep the tint fallback
      if (material[prop] === tex) material[prop] = null;
      tex.dispose();
    },
  );
  material[prop] = tex;
}

function findMorph(manager, name) {
  if (!manager) return null;
  for (let i = 0; i < manager.numTargets; i++) {
    if (manager.getTarget(i).name === name) return manager.getTarget(i);
  }
  return null;
}

function findBone(skeleton, name) {
  return skeleton?.bones.find(b => b.name === name) ?? null;
}

// ── CharacterAvatar ──────────────────────────────────────────────────────────

export class CharacterAvatar {
  constructor(id, username, config, scene) {
    this._id       = id;
    this._username = username;
    // No config = the bare base-body GLB, full stop. Default hair/clothing
    // only applies to avatars with an EXPLICIT config (saved player configs,
    // NPCs, the avatar creator) — an unconfigured player must render as the
    // plain test GLB, not in starter clothes.
    this._bareBody = config == null;
    this._config   = mergeConfig(config);
    this._scene    = scene;

    this.root      = null;
    this.isMoving  = false;

    // GLB state
    this._nodes      = [];
    this._skeleton   = null;
    this._animGroups = null;
    this._idleAnim   = null;
    this._walkAnim   = null;
    this._morphMgr   = null;
    this._bodyMeshes = [];   // main skinned meshes (share skeleton with clothing)
    this._slots      = {};   // slot key → { nodes, meshes }

    // Box fallback state
    this._useFallback   = false;
    this._fallbackLimbs = null;
    this._animTime      = 0;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static async create(id, username, config, scene, assetLibrary) {
    const av = new CharacterAvatar(id, username, config, scene);
    if (assetLibrary.hasBaseBody()) {
      await av._buildGLB(assetLibrary);
    } else {
      av._buildBox();
    }
    av._makeLabel(username);
    return av;
  }

  // ── GLB build ──────────────────────────────────────────────────────────────

  /** Pick the right base-body container based on the configured gender.
   *  Falls back to the neutral `base_body` container if the gendered variant
   *  isn't loaded (e.g. file missing on disk). */
  _resolveBaseBody(assetLibrary) {
    const gender = this._config.body.gender;
    if (gender === 'female') {
      return assetLibrary.getContainer('base_body_female')
          ?? assetLibrary.getContainer('base_body');
    }
    if (gender === 'male') {
      return assetLibrary.getContainer('base_body_male')
          ?? assetLibrary.getContainer('base_body');
    }
    return assetLibrary.getContainer('base_body');
  }

  async _buildGLB(assetLibrary) {
    const bodyContainer = this._resolveBaseBody(assetLibrary);
    if (!bodyContainer) { this._buildBox(); return; }
    const inst = bodyContainer.instantiateModelsToScene(
      name => `${this._id}_body_${name}`,
      false   // share materials
    );

    this.root = new BABYLON.TransformNode(`${this._id}_root`, this._scene);
    inst.rootNodes.forEach(n => { n.parent = this.root; });

    this._nodes    = inst.rootNodes;
    this._skeleton = inst.skeletons[0] ?? null;

    // Index the body's transform nodes by their unprefixed glTF names.
    // Modular pieces (hair/clothing/tail/gear) relink their skeleton bones
    // onto these nodes — see _bindInstanceToRig for why.
    this._rigNodeByName = new Map();
    const bodyPrefix = `${this._id}_body_`;
    const allBodyNodes = inst.rootNodes.flatMap(n => [
      n, ...(n.getChildTransformNodes ? n.getChildTransformNodes(false) : []),
    ]);
    for (const node of allBodyNodes) {
      const short = node.name.startsWith(bodyPrefix)
        ? node.name.slice(bodyPrefix.length)
        : node.name;
      if (!this._rigNodeByName.has(short)) this._rigNodeByName.set(short, node);
    }

    // Collect all skinned meshes from the hierarchy
    this._bodyMeshes = inst.rootNodes.flatMap(n =>
      n.getChildMeshes ? n.getChildMeshes(false) : []
    );

    // Find MorphTargetManager on the first mesh that has one
    this._morphMgr = this._bodyMeshes.find(m => m.morphTargetManager)
      ?.morphTargetManager ?? null;

    // Animations
    this._animGroups = inst.animationGroups;
    this._idleAnim   = this._animGroups.find(ag => /idle/i.test(ag.name)) ?? null;
    this._walkAnim   = this._animGroups.find(ag => /walk/i.test(ag.name)) ?? null;
    this._animGroups.forEach(ag => ag.stop());
    if (this._idleAnim) {
      this._idleAnim.loopAnimation = true;
      this._idleAnim.weight = 1;
      this._idleAnim.play(true);
    }
    if (this._walkAnim) { this._walkAnim.weight = 0; }

    // Apply morph targets and materials from stored config
    this._applyAllMorphs();
    this._applySkinMaterial();

    // Unconfigured avatars stop here: bare base-body GLB, no modular pieces.
    if (this._bareBody) return;

    // Attach modular pieces. The slot-gating workaround introduced earlier
    // in this PR is gone now that main shipped the regenerated GLBs (correct
    // GLTF Y-up → Blender Z-up axis, clean auto-weights). Loading is back to
    // unconditional — the avatar in-world renders with full hair / clothing /
    // species / gear loadout, same as the avatar creator.
    await this._rebuildHair(assetLibrary);
    for (const slot of CLOTHING_SLOTS) {
      await this._rebuildClothingSlot(slot, assetLibrary);
    }
    if (this._config.species.hornMesh) {
      await this._rebuildHorns(assetLibrary);
    }
    if (this._config.species.tailMesh) {
      await this._rebuildTail(assetLibrary);
    }
    for (const slot of GEAR_SLOTS) {
      const meshName = this._config.gear[slot];
      if (meshName) await this.setGear(slot, meshName, assetLibrary);
    }
  }

  /**
   * Retarget a modular piece's skeleton(s) onto the body rig.
   *
   * glTF skinned vertices index into the PIECE's own joint list, so the
   * old `mesh.skeleton = bodySkeleton` reassignment scrambles deformation
   * whenever a piece's joint ORDER differs from the body's (vertices end
   * up weighted to the wrong bones — the "crumpled clothing at the feet"
   * bug). Instead each piece keeps its own skeleton (correct indices +
   * inverse binds) and every bone is relinked by NAME to the body's
   * animated transform node, so the piece follows the body pose exactly,
   * independent of joint order.
   */
  _bindInstanceToRig(inst) {
    this._normalizePieceOrientation(inst);
    if (!this._rigNodeByName?.size) return;
    for (const skel of inst.skeletons ?? []) {
      for (const bone of skel.bones) {
        const node = this._rigNodeByName.get(bone.name);
        if (node) bone.linkTransformNode(node);
      }
    }
  }

  /**
   * Heal mis-oriented piece exports. The rig's bind space runs along -Z
   * (head at z≈-1.7; the armature node's +90° X rotation stands it up),
   * and the hair set is authored that way — but the clothing set shipped
   * with a 90° X object-rotation left UNAPPLIED to the vertex data, so
   * its geometry runs along -Y instead. Skin weights are correct, so the
   * skinned result is the garment rotated 90° at the hips — the
   * "crumpled clothing at the avatar's feet" bug.
   *
   * Detect the wrong dominant axis per mesh and bake the +90° X
   * correction into positions+normals. Correctly exported pieces fail
   * the check and pass through untouched, so re-exported assets can land
   * later with no code change.
   */
  _normalizePieceOrientation(inst) {
    const meshes = inst.rootNodes.flatMap(n =>
      n.getChildMeshes ? n.getChildMeshes(false) : []
    );
    for (const mesh of meshes) {
      if (!mesh.getBoundingInfo) continue;
      const bb = mesh.getBoundingInfo().boundingBox;
      const centerY = (bb.maximum.y + bb.minimum.y) / 2;
      const centerZ = (bb.maximum.z + bb.minimum.z) / 2;
      const extentY = bb.maximum.y - bb.minimum.y;
      const extentZ = bb.maximum.z - bb.minimum.z;
      if (Math.abs(centerY) > Math.abs(centerZ) && extentY >= extentZ) {
        mesh.bakeTransformIntoVertices(BABYLON.Matrix.RotationX(Math.PI / 2));
        mesh.refreshBoundingInfo();
      }
    }
  }

  // ── Box fallback build ─────────────────────────────────────────────────────

  _buildBox() {
    this._useFallback = true;
    this.root = new BABYLON.TransformNode(`${this._id}_root`, this._scene);

    const mat = new BABYLON.StandardMaterial(`${this._id}_boxmat`, this._scene);
    mat.diffuseColor = new BABYLON.Color3(0.55, 0.55, 0.60);
    const dark = new BABYLON.StandardMaterial(`${this._id}_boxdark`, this._scene);
    dark.diffuseColor = new BABYLON.Color3(0.28, 0.28, 0.32);

    const box = (name, w, h, d, px, py, pz, m) => {
      const mesh = BABYLON.MeshBuilder.CreateBox(`${this._id}_${name}`,
        { width: w, height: h, depth: d }, this._scene);
      mesh.position.set(px, py, pz);
      mesh.material = m ?? mat;
      mesh.parent   = this.root;
      return mesh;
    };

    const larm = box('larm', 0.20, 0.58, 0.20, -0.38, 1.04, 0, dark);
    const rarm = box('rarm', 0.20, 0.58, 0.20,  0.38, 1.04, 0, dark);
    const lleg = box('lleg', 0.22, 0.68, 0.22, -0.14, 0.34, 0, dark);
    const rleg = box('rleg', 0.22, 0.68, 0.22,  0.14, 0.34, 0, dark);
    box('torso', 0.52, 0.68, 0.30, 0, 1.04, 0);
    box('head',  0.42, 0.42, 0.38, 0, 1.64, 0);
    this._fallbackLimbs = { larm, rarm, lleg, rleg };
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(dt) {
    if (this._useFallback) {
      this._animateBox(dt);
    } else {
      this._animateGLB();
    }
  }

  _animateBox(dt) {
    const { larm, rarm, lleg, rleg } = this._fallbackLimbs ?? {};
    if (!larm) return;
    if (this.isMoving) {
      this._animTime += dt * 0.007;
      const s = Math.sin(this._animTime) * 0.45;
      larm.rotation.x =  s;
      rarm.rotation.x = -s;
      lleg.rotation.x = -s;
      rleg.rotation.x =  s;
    } else {
      this._animTime = 0;
      const t = 0.12;
      larm.rotation.x = BABYLON.Scalar.Lerp(larm.rotation.x, 0, t);
      rarm.rotation.x = BABYLON.Scalar.Lerp(rarm.rotation.x, 0, t);
      lleg.rotation.x = BABYLON.Scalar.Lerp(lleg.rotation.x, 0, t);
      rleg.rotation.x = BABYLON.Scalar.Lerp(rleg.rotation.x, 0, t);
    }
  }

  _animateGLB() {
    const BLEND = 0.08;
    if (this.isMoving) {
      if (this._walkAnim && !this._walkAnim.isPlaying) {
        this._walkAnim.weight = 0;
        this._walkAnim.loopAnimation = true;
        this._walkAnim.play(true);
      }
      if (this._walkAnim) this._walkAnim.weight = Math.min(1, (this._walkAnim.weight ?? 0) + BLEND);
      if (this._idleAnim) {
        this._idleAnim.weight = Math.max(0, (this._idleAnim.weight ?? 1) - BLEND);
        if (this._idleAnim.weight <= 0 && this._idleAnim.isPlaying) this._idleAnim.stop();
      }
    } else {
      if (this._idleAnim && !this._idleAnim.isPlaying) {
        this._idleAnim.weight = 0;
        this._idleAnim.loopAnimation = true;
        this._idleAnim.play(true);
      }
      if (this._idleAnim) this._idleAnim.weight = Math.min(1, (this._idleAnim.weight ?? 0) + BLEND);
      if (this._walkAnim) {
        this._walkAnim.weight = Math.max(0, (this._walkAnim.weight ?? 1) - BLEND);
        if (this._walkAnim.weight <= 0 && this._walkAnim.isPlaying) this._walkAnim.stop();
      }
    }
  }

  // ── Morph controls ─────────────────────────────────────────────────────────

  setBodyMorph(key, value) {
    this._config.body[key] = value;
    this._applyMorph(MORPH_KEYS[key], value);
  }

  setFaceMorph(key, value) {
    this._config.face[key] = value;
    this._applyMorph(MORPH_KEYS[key], value);
  }

  setSpeciesMorph(value) {
    this._config.species.earMorph = value;
    this._applyMorph(MORPH_KEYS.earMorph, value);
  }

  _applyMorph(shapeName, value) {
    const target = findMorph(this._morphMgr, shapeName);
    if (target) target.influence = value;
  }

  _applyAllMorphs() {
    for (const [key, val] of Object.entries(this._config.body)) {
      this._applyMorph(MORPH_KEYS[key], val);
    }
    for (const [key, val] of Object.entries(this._config.face)) {
      this._applyMorph(MORPH_KEYS[key], val);
    }
    this._applyMorph(MORPH_KEYS.earMorph, this._config.species.earMorph);
  }

  // ── Skin ───────────────────────────────────────────────────────────────────

  setSkinTone(hex) {
    this._config.skin.tone = hex;
    this._applySkinMaterial();
  }

  setMarking(key) {
    this._config.skin.marking = key;
    // Texture overlay applied once baked skin textures are available (Phase 1 asset pipeline).
  }

  _applySkinMaterial() {
    if (!this._bodyMeshes.length) return;
    const color = hexToColor3(this._config.skin.tone);
    for (const mesh of this._bodyMeshes) {
      if (mesh.material) {
        mesh.material.albedoColor = color;
        this._wireSkinPBR(mesh.material);
      }
    }
  }

  /**
   * One-time PBR wiring per body material: matte dielectric response tuned
   * for skin, specular AA, and the albedo/normal/ORM maps if the authored
   * textures exist. Materials are SHARED across avatar instances
   * (instantiateModelsToScene cloneMaterials=false), so this runs once per
   * material, not per avatar — guarded via material.metadata. The skin-tone
   * tint above keeps multiplying into albedo whether or not maps load.
   */
  _wireSkinPBR(mat) {
    if (!(mat instanceof BABYLON.PBRMaterial) || mat.metadata?.ashSkinWired) return;
    (mat.metadata ??= {}).ashSkinWired = true;

    mat.metallic  = 0;
    mat.roughness = 0.65;
    mat.enableSpecularAntiAliasing = true;

    applyOptionalPBRTexture(mat, 'albedoTexture', `${SKIN_TEX_BASE}/albedo.png`, this._scene);
    applyOptionalPBRTexture(mat, 'bumpTexture',   `${SKIN_TEX_BASE}/normal.png`, this._scene);
    // ORM (occlusion/roughness/metallic packed). The scalar metallic/roughness
    // above act as multipliers once a metallicTexture is present, so they are
    // reset to 1 on successful load to hand full control to the map; on 404
    // the onError path drops the texture and the scalars keep governing.
    applyOptionalPBRTexture(mat, 'metallicTexture', `${SKIN_TEX_BASE}/orm.png`, this._scene,
      () => { mat.metallic = 1; mat.roughness = 1; });
    mat.useAmbientOcclusionFromMetallicTextureRed = true;
    mat.useRoughnessFromMetallicTextureGreen      = true;
    mat.useMetallnessFromMetallicTextureBlue      = true;
  }

  // ── Hair ───────────────────────────────────────────────────────────────────

  async setHair(style, color, assetLibrary) {
    this._config.hair.style = style;
    this._config.hair.color = color;
    await this._rebuildHair(assetLibrary);
  }

  async _rebuildHair(assetLibrary) {
    this._disposeSlot('hair');
    const key = `hair/${this._config.hair.style}`;
    const container = assetLibrary.getContainer(key);
    if (!container) return;
    const inst = container.instantiateModelsToScene(
      name => `${this._id}_hair_${name}`, false
    );
    inst.rootNodes.forEach(n => { n.parent = this.root; });
    // Relink the hair's bones onto the body rig (order-independent).
    this._bindInstanceToRig(inst);
    this._applyHairColor(inst);
    this._slots['hair'] = { nodes: inst.rootNodes, animGroups: inst.animationGroups };
  }

  _applyHairColor(inst) {
    tintInstance(inst, hexToColor3(this._config.hair.color));
  }

  // ── Horns ──────────────────────────────────────────────────────────────────

  async setHornMesh(hornName, assetLibrary) {
    this._config.species.hornMesh = hornName;
    await this._rebuildHorns(assetLibrary);
  }

  async _rebuildHorns(assetLibrary) {
    this._disposeSlot('horns');
    if (!this._config.species.hornMesh) return;
    const key = `species/${this._config.species.hornMesh}`;
    const container = assetLibrary.getContainer(key);
    if (!container) return;
    const inst = container.instantiateModelsToScene(
      name => `${this._id}_horns_${name}`, false
    );
    // Parent horn root to Head bone so it follows head rotation
    const headBone = findBone(this._skeleton, BONES.head);
    const headMesh = this._bodyMeshes[0] ?? null;
    inst.rootNodes.forEach(n => {
      if (headBone && headMesh) {
        n.attachToBone(headBone, headMesh);
      } else {
        n.parent = this.root;
      }
    });
    tintInstance(inst, SPECIES_DEFAULTS.horns);
    this._slots['horns'] = { nodes: inst.rootNodes, animGroups: inst.animationGroups };
  }

  // ── Tail ───────────────────────────────────────────────────────────────────

  async setTailMesh(tailName, assetLibrary) {
    this._config.species.tailMesh = tailName;
    await this._rebuildTail(assetLibrary);
  }

  async _rebuildTail(assetLibrary) {
    this._disposeSlot('tail');
    if (!this._config.species.tailMesh) return;
    const key = `species/${this._config.species.tailMesh}`;
    const container = assetLibrary.getContainer(key);
    if (!container) return;
    const inst = container.instantiateModelsToScene(
      name => `${this._id}_tail_${name}`, false
    );
    // If the tail GLB ships with skinned weights to Hips/Spine, share the body
    // skeleton so it deforms with the rig. Otherwise parent rigidly to Hips.
    const tailHasSkin = inst.rootNodes
      .flatMap(n => n.getChildMeshes ? n.getChildMeshes(false) : [])
      .some(m => m.skeleton);
    if (tailHasSkin && this._skeleton) {
      inst.rootNodes.forEach(n => { n.parent = this.root; });
      this._bindInstanceToRig(inst);
    } else {
      const hipsBone = findBone(this._skeleton, BONES.hips);
      const refMesh  = this._bodyMeshes[0] ?? null;
      inst.rootNodes.forEach(n => {
        if (hipsBone && refMesh) n.attachToBone(hipsBone, refMesh);
        else                      n.parent = this.root;
      });
    }
    tintInstance(inst, SPECIES_DEFAULTS.tail);
    this._slots['tail'] = { nodes: inst.rootNodes, animGroups: inst.animationGroups };
  }

  // ── Clothing ───────────────────────────────────────────────────────────────

  async setClothing(slot, meshName, assetLibrary) {
    this._config.clothing[slot] = meshName;
    await this._rebuildClothingSlot(slot, assetLibrary);
  }

  async _rebuildClothingSlot(slot, assetLibrary) {
    this._disposeSlot(`clothing_${slot}`);
    const meshName = this._config.clothing[slot];
    if (!meshName) return;
    const key = `clothing/${meshName}`;
    const container = assetLibrary.getContainer(key);
    if (!container) return;
    const inst = container.instantiateModelsToScene(
      name => `${this._id}_${slot}_${name}`, false
    );
    inst.rootNodes.forEach(n => { n.parent = this.root; });
    // Relink the clothing's bones onto the body rig (order-independent).
    this._bindInstanceToRig(inst);
    // Tint the GLB's blank material so the piece doesn't render pure white.
    tintInstance(inst, CLOTHING_DEFAULTS[slot] ?? CLOTHING_DEFAULTS.top);
    this._slots[`clothing_${slot}`] = { nodes: inst.rootNodes, animGroups: inst.animationGroups };
  }

  // ── Gear (skinned to body rig — armor; weapons TBD) ────────────────────────

  async setGear(slot, meshName, assetLibrary) {
    this._config.gear[slot] = meshName;
    this._disposeSlot(`gear_${slot}`);
    if (!meshName) return;
    const key = `gear/${meshName}`;
    const container = assetLibrary.getContainer(key);
    if (!container) return;
    const inst = container.instantiateModelsToScene(
      name => `${this._id}_gear_${slot}_${name}`, false
    );
    // Armor pieces are authored as skinned meshes bound to the shared MPFB rig
    // (same pattern as clothing): parent to character root, then relink each
    // piece's bones onto the body rig so animations drive the armor too.
    // The piece KEEPS its own skeleton (vertex bone-indices reference its own
    // joint list — see _bindInstanceToRig), so the old dispose-duplicate-
    // skeletons step is gone; _disposeSlot tears the piece down whole.
    // TODO(weapons): when rigid weapon assets land, detect meshes without skin
    // weights and fall back to attachToBone(rightHand) for those.
    inst.rootNodes.forEach(n => { n.parent = this.root; });
    this._bindInstanceToRig(inst);
    // Gear ships through the same blank-material pipeline as clothing — tint
    // so it doesn't render white. Steel/iron baseline; per-piece colors can
    // ride on the config later.
    tintInstance(inst, new BABYLON.Color3(0.62, 0.62, 0.66));
    this._slots[`gear_${slot}`] = { nodes: inst.rootNodes, animGroups: inst.animationGroups };
  }

  // ── Slot disposal ──────────────────────────────────────────────────────────

  _disposeSlot(key) {
    const slot = this._slots[key];
    if (!slot) return;
    slot.animGroups?.forEach(ag => { ag.stop(); ag.dispose(); });
    slot.nodes?.forEach(n => n.dispose(false, false));
    delete this._slots[key];
  }

  // ── Label ──────────────────────────────────────────────────────────────────

  _makeLabel(text) {
    if (!text || !this.root) return;
    const labelY = this._useFallback ? 2.15 : 2.2;
    try {
      const W = 256, H = 48;
      const dt = new BABYLON.DynamicTexture(`${this._id}_tex`,
        { width: W, height: H }, this._scene, false);
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
      const plane = BABYLON.MeshBuilder.CreatePlane(`${this._id}_label`,
        { width: 1.6, height: 0.3 }, this._scene);
      const lm = new BABYLON.StandardMaterial(`${this._id}_lmat`, this._scene);
      lm.diffuseTexture  = dt;
      lm.emissiveTexture = dt;
      lm.useAlphaFromDiffuseTexture = true;
      lm.backFaceCulling = false;
      lm.disableLighting = true;
      // Draw the nameplate in an overlay rendering group so world geometry —
      // the sky dome and the terrain/hill silhouette at the horizon — can never
      // occlude it. Babylon clears the depth buffer between rendering groups by
      // default, so group 1 renders on top of group 0; disabling depth writes
      // keeps the label from polluting depth for anything drawn after it.
      lm.disableDepthWrite = true;
      plane.material        = lm;
      plane.position.set(0, labelY, 0);
      plane.billboardMode   = BABYLON.Mesh.BILLBOARDMODE_ALL;
      plane.renderingGroupId = 1;
      plane.parent          = this.root;
    } catch (_) { /* non-critical */ }
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  toConfig() {
    return structuredClone(this._config);
  }

  // ── Dispose ────────────────────────────────────────────────────────────────

  dispose() {
    Object.keys(this._slots).forEach(k => this._disposeSlot(k));
    this._animGroups?.forEach(ag => { ag.stop(); ag.dispose(); });
    this._nodes.forEach(n => n.dispose(false, false));
    this.root?.getChildMeshes?.()?.forEach(m => m.dispose());
    this.root?.dispose?.();
  }
}
