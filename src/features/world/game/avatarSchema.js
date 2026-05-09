/**
 * AvatarConfig schema and defaults.
 *
 * All morph values are normalised 0–1.
 * Mesh slot values are asset keys (matched against AssetLibrary keys)
 * or null for empty slots.
 */

export const DEFAULT_AVATAR = {
  version:  1,
  body:     { gender: 'neutral', height: 0.5, weight: 0.5, muscle: 0.5, age: 0.3, shoulderWidth: 0.5, hipWidth: 0.5 },
  face:     { jaw: 0.5, eyeSize: 0.5, noseWidth: 0.5, browHeight: 0.5, cheekFullness: 0.5, lipSize: 0.5 },
  skin:     { tone: '#C68642', marking: null },
  species:  { earMorph: 0, hornMesh: null, tailMesh: null },
  hair:     { style: 'hair_short', color: '#2C1B0A' },
  clothing: { top: 'top_tunic', bottom: 'bottom_trousers', shoes: 'shoes_boots' },
  gear:     { helmet: null, chest: null, weapon: null },
};

/** Asset keys for each clothing/gear slot. */
export const CLOTHING_SLOTS = ['top', 'bottom', 'shoes'];
export const GEAR_SLOTS     = ['helmet', 'chest', 'weapon'];

/**
 * Legacy → fantasy clothing key migration. Configs persisted before the
 * fantasy-only wardrobe rollout reference modern keys (top_casual, bottom_jeans
 * …) that no longer exist in the manifest. Without remapping, those slots
 * silently render empty. Applied inside `mergeConfig` so every load path
 * (Supabase, localStorage, world sync) gets the upgrade for free.
 */
const LEGACY_CLOTHING_ALIAS = {
  top_casual:    'top_cloth_shirt',
  top_hoodie:    'top_gambeson',
  top_tank:      'top_leather_vest',
  top_jacket:    'top_chainmail',
  bottom_jeans:  'bottom_leather_pants',
  bottom_shorts: 'bottom_breeches',
  bottom_skirt:  'bottom_cloth_skirt',
  shoes_sneakers:'shoes_leather_wraps',
};

function migrateClothing(clothing) {
  if (!clothing) return clothing;
  const out = { ...clothing };
  for (const slot of CLOTHING_SLOTS) {
    const key = out[slot];
    if (key && LEGACY_CLOTHING_ALIAS[key]) out[slot] = LEGACY_CLOTHING_ALIAS[key];
  }
  return out;
}

/** Merge a partial config over the defaults — safe for partial saves. */
export function mergeConfig(partial) {
  if (!partial) return structuredClone(DEFAULT_AVATAR);
  return {
    version:  partial.version  ?? DEFAULT_AVATAR.version,
    body:     { ...DEFAULT_AVATAR.body,     ...partial.body },
    face:     { ...DEFAULT_AVATAR.face,     ...partial.face },
    skin:     { ...DEFAULT_AVATAR.skin,     ...partial.skin },
    species:  { ...DEFAULT_AVATAR.species,  ...partial.species },
    hair:     { ...DEFAULT_AVATAR.hair,     ...partial.hair },
    clothing: migrateClothing({ ...DEFAULT_AVATAR.clothing, ...partial.clothing }),
    gear:     { ...DEFAULT_AVATAR.gear,     ...partial.gear },
  };
}

/** All morph name → MPFB shape key name mappings. */
export const MORPH_KEYS = {
  // Body
  height:        'BodyHeight',
  weight:        'BodyWeight',
  muscle:        'BodyMuscle',
  age:           'BodyAge',
  shoulderWidth: 'BodyShoulderWidth',
  hipWidth:      'BodyHipWidth',
  // Face
  jaw:           'FaceJaw',
  eyeSize:       'FaceEyeSize',
  noseWidth:     'FaceNoseWidth',
  browHeight:    'FaceBrowHeight',
  cheekFullness: 'FaceCheekFullness',
  lipSize:       'FaceLipSize',
  // Species
  earMorph:      'EarElf',
};

/** Bone names (post-rename from mixamorig: prefix strip). */
export const BONES = {
  head:      'Head',
  rightHand: 'RightHand',
  leftHand:  'LeftHand',
  spine:     'Spine1',
  hips:      'Hips',
};
