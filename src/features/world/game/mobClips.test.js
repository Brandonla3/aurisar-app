/**
 * MOB_CLIPS truthfulness — the table in MobAnimator.js must only name
 * animation clips that actually exist inside the GLB each mob type maps to.
 * The mob type → GLB path resolves through the content graph's `glbKey`
 * and the generated `mobs.manifest.json` (scripts/assets_pipeline.mjs), so
 * this test also pins the whole mobType → glbKey → file → clip-inventory
 * chain — the Batch B rig/clip contract in seed form.
 */
import { describe, expect, it } from 'vitest';
import mobsManifest from '../../../../public/assets/manifest/mobs.manifest.json';
import { MOB_CLIPS } from './MobAnimator.js';
import { MOBS } from '../content/index';

// The manifest already carries each GLB's clip inventory (parsed at emit
// time), so the shipped bytes and the test agree by construction.
const clipInventory = (glbKey) => new Set(mobsManifest.assets[glbKey]?.clips ?? []);
const glbKeyFor = (mobType) => MOBS[mobType]?.glbKey ?? null;

describe('MOB_CLIPS ↔ generated mob manifest clip inventories', () => {
  it('every keyed mob type resolves to an asset in the manifest', () => {
    for (const mobType of Object.keys(MOB_CLIPS)) {
      const glbKey = glbKeyFor(mobType);
      expect(glbKey, `${mobType} has no MobDef.glbKey`).toBeTruthy();
      expect(mobsManifest.assets[glbKey], `${mobType} → ${glbKey} missing from mobs.manifest.json`).toBeDefined();
    }
  });

  for (const [mobType, clips] of Object.entries(MOB_CLIPS)) {
    it(`${mobType}: every named clip exists in its GLB`, () => {
      const glbKey = glbKeyFor(mobType);
      const names = clipInventory(glbKey);
      for (const [key, clip] of Object.entries(clips)) {
        if (clip == null) continue;
        expect(names.has(clip), `${mobType}.${key} → "${clip}" not in ${glbKey}.glb`).toBe(true);
      }
    });
  }

  it('clipless GLBs are deliberately absent (procedural fallback covers them)', () => {
    // wolf.glb ships zero clips — the wolf family must NOT be in the table,
    // or MobAnimator would build a controller that resolves nothing and skip
    // the procedural fallback life entirely.
    for (const mobType of ['forest_wolf', 'old_greyjaw']) {
      expect(MOB_CLIPS[mobType], `${mobType} should use the procedural fallback`).toBeUndefined();
      expect(clipInventory(glbKeyFor(mobType)).size).toBe(0);
    }
  });
});
