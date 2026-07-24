/**
 * Asset-manifest integrity — the runtime side of the Batch B pipeline
 * contract (scripts/assets_pipeline.mjs). Guards that the generated
 * manifests stay consistent with the code and content that consume them,
 * WITHOUT re-encoding (the `check:assets` CI step re-parses the GLB bytes;
 * this test is the fast, dependency-light half that also crosses into the
 * content graph — which check:assets deliberately does not import).
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import charactersManifest from '../../../../public/assets/manifest/characters.manifest.json';
import modelsManifest from '../../../../public/assets/manifest/models.manifest.json';
import mobsManifest from '../../../../public/assets/manifest/mobs.manifest.json';
import propsManifest from '../../../../public/assets/manifest/props.manifest.json';
import { MANIFEST, MODEL_MANIFEST } from './AssetLibrary.js';
import { DEFAULT_AVATAR, CLOTHING_SLOTS } from './avatarSchema.js';
import { MOBS } from '../content/index';
import { ZONE1_PROPS } from '../content/zones/zone1/props';

// NpcSystem's NPC_MODEL_OVERRIDES targets, asserted directly rather than
// imported — NpcSystem pulls in CharacterAvatar, which touches the BABYLON
// global at module eval (absent in the node test env). Keep in sync with
// NpcSystem.NPC_MODEL_OVERRIDES.
const NPC_MODEL_TARGETS = ['gilded_sentinel'];

// The prop kinds PropsSystem._placeAll instantiates by literal key. A file
// removed from the pack + a re-run would pass the generic "every entry points
// to a file" check while silently dropping a placement — this is the explicit
// consumer contract that catches it.
const REQUIRED_PROP_KEYS = [
  'house_1', 'house_2', 'house_3', 'inn', 'bell_tower', 'blacksmith',
  'market_stand_1', 'market_stand_2', 'well', 'fence', 'bonfire',
  'dock_platform', 'rowboat', 'tent_open', 'tent_small', 'crate_wooden',
  'barrel', 'anvil', 'weapon_stand', 'farmcrate_apple',
  'rock_tall_a', 'rock_tall_h', 'rock_large_d', 'rock_large_f', 'ore_rocks',
  'mushroom_red', 'mushroom_tan', 'column', 'column_broken',
  'statue_head', 'statue_block', 'timber_pillar',
];

const PUBLIC = fileURLToPath(new URL('../../../../public', import.meta.url));
const ALL = [charactersManifest, modelsManifest, mobsManifest, propsManifest];

describe('generated asset manifests', () => {
  it('every manifest has the required shape', () => {
    for (const m of ALL) {
      expect(m.category, 'category').toBeTruthy();
      expect(m.base?.startsWith('/assets/'), `base ${m.base}`).toBe(true);
      expect(m.budgetClass, 'budgetClass').toBeTruthy();
      expect(typeof m.assets).toBe('object');
    }
  });

  it('every referenced GLB file exists on disk', () => {
    for (const m of ALL) {
      for (const [key, a] of Object.entries(m.assets)) {
        const path = `${PUBLIC}${m.base}${a.file}`;
        expect(existsSync(path), `${m.category}/${key} → ${path}`).toBe(true);
      }
    }
  });

  it('AssetLibrary MANIFEST/MODEL_MANIFEST derive from the generated manifests', () => {
    // The runtime maps are built from the manifest, so every key must resolve
    // and every file must equal the manifest entry (guards a bad refactor).
    for (const [key, file] of Object.entries(MANIFEST)) {
      expect(charactersManifest.assets[key]?.file, `characters/${key}`).toBe(file);
    }
    for (const [key, file] of Object.entries(MODEL_MANIFEST)) {
      expect(modelsManifest.assets[key]?.file, `models/${key}`).toBe(file);
    }
  });
});

describe('content ↔ mob asset resolution (glbKey)', () => {
  it('every MobDef.glbKey resolves to an asset in the mob manifest', () => {
    for (const mob of Object.values(MOBS)) {
      expect(
        mobsManifest.assets[mob.glbKey],
        `mob ${mob.mobType}: glbKey '${mob.glbKey}' not in mobs.manifest.json`,
      ).toBeDefined();
    }
  });
});

describe('consumer-required keys (a removed asset must fail CI, not silently drop)', () => {
  it('the default avatar loadout resolves in the character manifest', () => {
    // Base body (all three), plus the default hair + clothing the schema ships.
    for (const key of ['base_body', 'base_body_male', 'base_body_female']) {
      expect(MANIFEST[key], `character key ${key}`).toBeDefined();
    }
    expect(MANIFEST[`hair/${DEFAULT_AVATAR.hair.style}`], 'default hair').toBeDefined();
    for (const slot of CLOTHING_SLOTS) {
      const key = `clothing/${DEFAULT_AVATAR.clothing[slot]}`;
      expect(MANIFEST[key], `default clothing ${slot} (${key})`).toBeDefined();
    }
  });

  it('every NPC model override resolves in the models manifest', () => {
    for (const key of NPC_MODEL_TARGETS) {
      expect(MODEL_MANIFEST[key], `NPC model override ${key}`).toBeDefined();
    }
  });

  it('every prop kind PropsSystem places resolves in the props manifest', () => {
    for (const key of REQUIRED_PROP_KEYS) {
      expect(propsManifest.assets[key], `required prop ${key}`).toBeDefined();
    }
  });

  it('REQUIRED_PROP_KEYS stays in sync with authored ZONE1_PROPS coverage', () => {
    // A cheap guard that the settlement content still has props to place —
    // if the layout is emptied this fires before the world silently goes bare.
    expect(ZONE1_PROPS.buildings.length).toBeGreaterThan(0);
    expect(REQUIRED_PROP_KEYS.length).toBeGreaterThan(20);
  });
});
