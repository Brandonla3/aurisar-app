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
import { MOBS } from '../content/index';

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
