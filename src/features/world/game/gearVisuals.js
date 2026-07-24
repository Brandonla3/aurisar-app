/**
 * gearVisuals — how an equipped item looks on the avatar (Batch C).
 *
 * The gear-loop payoff is seeing earned gear on your character and on other
 * players. This module is the itemId → visual resolver:
 *
 *   - WEAPONS render as procedural meshes socketed to the RightHand bone
 *     (built here from primitives, tinted by rarity). Real weapon GLBs drop
 *     in later via the Batch B asset manifest — see resolveGearVisual: a
 *     `modelKey` present in the gear manifest takes precedence over the
 *     procedural shape, so no call-site changes when art lands.
 *   - ARMOR (chest/legs/hands/head/feet) is skinned to the body rig and is
 *     Phase B (Batch G) — those slots have no asset yet and no-op cleanly.
 *
 * Kept free of top-level BABYLON access so it can be imported in Node tests;
 * the mesh builders take the BABYLON namespace + scene as arguments.
 */

/** Rarity → tint + emissive strength (visual language, common→epic). The
 *  emissive drives the existing glow/bloom layers directly (rare/epic read as
 *  lit); no separate glow flag. Particle FX for epics land in Batch H. */
export const RARITY = {
  common:   { tint: [0.62, 0.62, 0.66], emissive: 0.0 },
  uncommon: { tint: [0.55, 0.72, 0.48], emissive: 0.05 },
  rare:     { tint: [0.42, 0.60, 0.92], emissive: 0.18 },
  epic:     { tint: [0.72, 0.46, 0.92], emissive: 0.30 },
};

/** Class → starter clothing tint (cheap layer-1 identity, 11 classes). Wired
 *  into avatar clothing in a later class-identity pass; exported + tested now
 *  so the table stays in sync with the class roster. */
export const CLASS_TINTS = {
  warrior:   '#7a3b2e', gladiator: '#8a2f2f', warden:  '#3f5a34',
  phantom:   '#2e2f3a', tempest:   '#356b7a', warlord: '#5a2f5a',
  druid:     '#4a5a2a', oracle:    '#6a5a2f', titan:   '#4a4a52',
  striker:   '#7a5a2a', alchemist: '#2f6a4a',
};

/**
 * Weapon itemId → procedural shape + grip offset in the RightHand bone's
 * local space. `shape` selects a builder below; the emoji icon in the item
 * def is the design hint. Unlisted weapons fall back to 'sword'.
 */
const WEAPON_SHAPE = {
  worn_shortsword: 'sword', wolfsbane_blade: 'sword', arming_sword: 'sword',
  marshals_blade: 'sword', militia_vest: null, // (non-weapon, guard)
  carving_knife: 'knife', bronzework_mace: 'mace',
  hunting_bow: 'bow', gnarled_staff: 'staff', hickory_shortstaff: 'staff',
};

/**
 * Resolve how an item should appear. Returns null when the item has no
 * avatar visual yet (armor without a fitted GLB, off-hand, trinket).
 *   { kind: 'weapon', shape, socket: 'rightHand', rarity }
 *   { kind: 'armor',  modelKey, rarity }   // future GLB path
 * @param item  ItemDef (needs id, type, slot, quality)
 * @param hasGearModel (key)=>bool — AssetLibrary gear-manifest probe
 */
export function resolveGearVisual(item, hasGearModel = () => false) {
  if (!item) return null;
  const rarity = item.quality ?? 'common';
  const modelKey = `gear/${item.id}`;
  // A real fitted GLB always wins over the procedural placeholder.
  if (hasGearModel(modelKey)) {
    return { kind: item.slot === 'mainHand' ? 'weaponModel' : 'armor', modelKey, rarity, socket: 'rightHand' };
  }
  if (item.type === 'weapon' || item.slot === 'mainHand') {
    const shape = WEAPON_SHAPE[item.id] ?? 'sword';
    if (!shape) return null;
    return { kind: 'weapon', shape, socket: 'rightHand', rarity };
  }
  return null; // armor: Phase B
}

// ── Procedural weapon builders ───────────────────────────────────────────────
// Each returns a single merged mesh whose GRIP is at the local origin and whose
// length runs +Y, so attachToBone(RightHand) + a small local rotation seats it
// in the palm. Built from cheap primitives, one material, rarity-tinted.

function mat(BABYLON, scene, id, rarity) {
  const r = RARITY[rarity] ?? RARITY.common;
  const m = new BABYLON.StandardMaterial(id, scene);
  m.diffuseColor = new BABYLON.Color3(...r.tint);
  m.specularColor = new BABYLON.Color3(0.3, 0.3, 0.34);
  m.ambientColor = new BABYLON.Color3(1, 1, 1);
  if (r.emissive > 0) m.emissiveColor = new BABYLON.Color3(...r.tint).scale(r.emissive);
  return m;
}

function buildSword(BABYLON, scene, rarity, id) {
  const blade = BABYLON.MeshBuilder.CreateBox(`${id}_blade`, { width: 0.06, height: 0.62, depth: 0.015 }, scene);
  blade.position.y = 0.46;
  const guard = BABYLON.MeshBuilder.CreateBox(`${id}_guard`, { width: 0.20, height: 0.04, depth: 0.05 }, scene);
  guard.position.y = 0.14;
  const grip = BABYLON.MeshBuilder.CreateCylinder(`${id}_grip`, { height: 0.16, diameter: 0.035, tessellation: 8 }, scene);
  grip.position.y = 0.05;
  return [blade, guard, grip];
}
function buildKnife(BABYLON, scene, rarity, id) {
  const blade = BABYLON.MeshBuilder.CreateBox(`${id}_blade`, { width: 0.045, height: 0.30, depth: 0.012 }, scene);
  blade.position.y = 0.26;
  const grip = BABYLON.MeshBuilder.CreateCylinder(`${id}_grip`, { height: 0.12, diameter: 0.03, tessellation: 8 }, scene);
  grip.position.y = 0.06;
  return [blade, grip];
}
function buildMace(BABYLON, scene, rarity, id) {
  const head = BABYLON.MeshBuilder.CreateBox(`${id}_head`, { width: 0.12, height: 0.12, depth: 0.12 }, scene);
  head.position.y = 0.5;
  const shaft = BABYLON.MeshBuilder.CreateCylinder(`${id}_shaft`, { height: 0.46, diameter: 0.035, tessellation: 8 }, scene);
  shaft.position.y = 0.24;
  return [head, shaft];
}
function buildStaff(BABYLON, scene, rarity, id) {
  const shaft = BABYLON.MeshBuilder.CreateCylinder(`${id}_shaft`, { height: 1.05, diameter: 0.035, tessellation: 8 }, scene);
  shaft.position.y = 0.5;
  const orb = BABYLON.MeshBuilder.CreateSphere(`${id}_orb`, { diameter: 0.10, segments: 8 }, scene);
  orb.position.y = 1.02;
  return [shaft, orb];
}
function buildBow(BABYLON, scene, rarity, id) {
  const bow = BABYLON.MeshBuilder.CreateTorus(`${id}_bow`, { diameter: 0.7, thickness: 0.025, tessellation: 16 }, scene);
  bow.rotation.z = Math.PI / 2;
  bow.scaling.x = 0.4;
  bow.position.y = 0.35;
  return [bow];
}

const BUILDERS = { sword: buildSword, knife: buildKnife, mace: buildMace, staff: buildStaff, bow: buildBow };

/**
 * Build a procedural weapon mesh (grip at origin, +Y length). Caller
 * attaches it to the RightHand bone. Returns a merged mesh (one draw call)
 * or a parent TransformNode fallback if merge is unavailable.
 */
export function buildProceduralWeapon(BABYLON, scene, spec, itemId) {
  const build = BUILDERS[spec.shape] ?? buildSword;
  const parts = build(BABYLON, scene, spec.rarity, itemId);
  const material = mat(BABYLON, scene, `${itemId}_wmat`, spec.rarity);
  parts.forEach((p) => { p.material = material; p.isPickable = false; });
  const merged = BABYLON.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  const mesh = merged ?? parts[0];
  if (mesh) { mesh.name = `weapon_${itemId}`; mesh.material = material; mesh.isPickable = false; }
  return mesh;
}
