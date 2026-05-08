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

import { mergeConfig, MORPH_KEYS, BONES, CLOTHING_SLOTS } from './avatarSchema.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToColor3(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new BABYLON.Color3(r, g, b);
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
    this._useFallback  = false;
    this._fallbackLimbs = null;
    this._animTime      = 0;
    this._wasMoving     = null;
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
    if (this._idleAnim) { this._idleAnim.loopAnimation = true; this._idleAnim.play(); }

    // Apply morph targets and materials from stored config
    this._applyAllMorphs();
    this._applySkinMaterial();

    // Attach modular pieces
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
    if (this.isMoving === this._wasMoving) return;
    this._wasMoving = this.isMoving;
    if (this.isMoving) {
      this._idleAnim?.stop();
      if (this._walkAnim) { this._walkAnim.loopAnimation = true; this._walkAnim.play(); }
    } else {
      this._walkAnim?.stop();
      if (this._idleAnim) { this._idleAnim.loopAnimation = true; this._idleAnim.play(); }
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
    // Tint the first material found on skin meshes — actual PBR skin texture
    // will replace this once baked textures are available.
    for (const mesh of this._bodyMeshes) {
      if (mesh.material) {
        mesh.material.albedoColor = color;
      }
    }
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
    // Reassign skeleton so hair skinning follows the body rig
    inst.rootNodes.flatMap(n => n.getChildMeshes ? n.getChildMeshes(false) : [])
      .forEach(m => { if (this._skeleton) m.skeleton = this._skeleton; });
    this._applyHairColor(inst);
    this._slots['hair'] = { nodes: inst.rootNodes, animGroups: inst.animationGroups };
  }

  _applyHairColor(inst) {
    const color = hexToColor3(this._config.hair.color);
    inst.rootNodes
      .flatMap(n => n.getChildMeshes ? n.getChildMeshes(false) : [])
      .forEach(m => { if (m.material) m.material.albedoColor = color; });
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
      inst.rootNodes.flatMap(n => n.getChildMeshes ? n.getChildMeshes(false) : [])
        .forEach(m => { m.skeleton = this._skeleton; });
    } else {
      const hipsBone = findBone(this._skeleton, BONES.hips);
      const refMesh  = this._bodyMeshes[0] ?? null;
      inst.rootNodes.forEach(n => {
        if (hipsBone && refMesh) n.attachToBone(hipsBone, refMesh);
        else                      n.parent = this.root;
      });
    }
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
    // Reassign skeleton so clothing skinning follows the body rig
    inst.rootNodes.flatMap(n => n.getChildMeshes ? n.getChildMeshes(false) : [])
      .forEach(m => { if (this._skeleton) m.skeleton = this._skeleton; });
    this._slots[`clothing_${slot}`] = { nodes: inst.rootNodes, animGroups: inst.animationGroups };
  }

  // ── Gear (bone-attached, gameplay items) ───────────────────────────────────

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
    const boneName = { helmet: BONES.head, chest: BONES.spine, weapon: BONES.rightHand }[slot];
    const bone = findBone(this._skeleton, boneName);
    const refMesh = this._bodyMeshes[0] ?? null;
    inst.rootNodes.forEach(n => {
      if (bone && refMesh) n.attachToBone(bone, refMesh);
      else n.parent = this.root;
    });
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
      plane.material      = lm;
      plane.position.set(0, labelY, 0);
      plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      plane.parent        = this.root;
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
