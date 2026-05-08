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
    clothing: { ...DEFAULT_AVATAR.clothing, ...partial.clothing },
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

/** Asset keys for each clothing/gear slot. */
export const CLOTHING_SLOTS = ['top', 'bottom', 'shoes'];
export const GEAR_SLOTS     = ['helmet', 'chest', 'weapon'];
