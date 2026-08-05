/**
 * propBudget.test.js — the customs audit: declared costs must equal actual
 * generated costs, both directions, exactly. When a genome deliberately
 * changes, this test's failure output logs the new actuals to paste into
 * the manifest — drift is a one-line fix, but never a silent one.
 */
import { describe, expect, it } from 'vitest';
import { buildPrototypePayload } from '../gen/propGen.js';
import { PROTOTYPES } from './propGenomes.js';
import { PROP_MANIFEST, BUDGET_CEILINGS } from './propBudget.js';
import { silhouetteAreaM2 } from './silhouette.js';

describe('manifest completeness — both directions', () => {
  it('every prototype has a manifest entry with the right stage count', () => {
    for (const proto of PROTOTYPES) {
      const entry = PROP_MANIFEST[proto.id];
      expect(entry, `${proto.id} missing from PROP_MANIFEST`).toBeTruthy();
      expect(entry.length, `${proto.id} stage count`).toBe(proto.stages);
    }
  });

  it('every manifest key is a real prototype — no ghost cargo', () => {
    const ids = new Set(PROTOTYPES.map((p) => p.id));
    for (const key of Object.keys(PROP_MANIFEST)) {
      expect(ids.has(key), `manifest entry "${key}" has no prototype`).toBe(true);
    }
  });
});

describe('declared costs equal generated costs', () => {
  for (const proto of PROTOTYPES) {
    for (let stage = 0; stage < proto.stages; stage++) {
      it(`${proto.id} stage ${stage} matches its declaration`, () => {
        const payload = buildPrototypePayload(proto.id, stage);
        const declared = PROP_MANIFEST[proto.id][stage];
        const actualSilhouette = Number(silhouetteAreaM2(payload).toFixed(2));
        // On mismatch, say exactly what to paste.
        const actual = { tris: payload.triCount, verts: payload.vertCount, silhouetteM2: actualSilhouette };
        expect(actual, `${proto.id}[${stage}] drifted — update PROP_MANIFEST to ${JSON.stringify(actual)}`).toEqual(declared);
      });
    }
  }
});

describe('ceilings are sane', () => {
  it('all ceilings are positive finite numbers', () => {
    for (const [k, v] of Object.entries(BUDGET_CEILINGS)) {
      expect(Number.isFinite(v), k).toBe(true);
      expect(v, k).toBeGreaterThan(0);
    }
  });
});
