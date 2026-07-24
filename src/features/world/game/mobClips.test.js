/**
 * MOB_CLIPS truthfulness — the table in MobAnimator.js must only name
 * animation clips that actually exist inside the GLB each mob type maps to
 * (MobAssetLibrary MANIFEST). Parses the glTF JSON chunk straight out of
 * the shipped .glb files so the contract can never silently drift when an
 * asset is replaced (design-plan Batch B formalizes this as the pipeline's
 * rig/clip contract; this is the Batch A seed of it).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOB_CLIPS } from './MobAnimator.js';
import { MANIFEST } from './MobAssetLibrary.js';

const MOBS_DIR = fileURLToPath(new URL('../../../../public/assets/mobs/', import.meta.url));

function glbAnimationNames(file) {
  const buf = readFileSync(MOBS_DIR + file);
  // GLB container: 12-byte header, then chunks; chunk 0 is the JSON blob.
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  return new Set((gltf.animations ?? []).map((a) => a.name));
}

describe('MOB_CLIPS ↔ shipped GLB clip inventories', () => {
  it('maps only mob types that exist in the MobAssetLibrary manifest', () => {
    for (const mobType of Object.keys(MOB_CLIPS)) {
      expect(MANIFEST[mobType], `${mobType} missing from MobAssetLibrary MANIFEST`).toBeDefined();
    }
  });

  for (const [mobType, clips] of Object.entries(MOB_CLIPS)) {
    it(`${mobType}: every named clip exists in ${MANIFEST[mobType]}`, () => {
      const names = glbAnimationNames(MANIFEST[mobType]);
      for (const [key, clip] of Object.entries(clips)) {
        if (clip == null) continue;
        expect(names.has(clip), `${mobType}.${key} → "${clip}" not in ${MANIFEST[mobType]}`).toBe(true);
      }
    });
  }

  it('clipless GLBs are deliberately absent (procedural fallback covers them)', () => {
    // wolf.glb ships zero animations — the wolf family must NOT be in the
    // table, or MobAnimator would build a controller that resolves nothing
    // and skip the fallback life entirely.
    for (const mobType of ['forest_wolf', 'old_greyjaw', 'wolf']) {
      expect(MOB_CLIPS[mobType], `${mobType} should use the procedural fallback`).toBeUndefined();
      expect(glbAnimationNames(MANIFEST[mobType]).size).toBe(0);
    }
  });
});
