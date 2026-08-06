/**
 * actorBudget.test.js — the customs audit, actor edition: mirrors
 * propBudget.test.js exactly. Declared costs must equal actual generated
 * costs, both directions, exactly. When a genome deliberately changes, this
 * test's failure output logs the new actuals to paste into ACTOR_MANIFEST —
 * drift is a one-line fix, but never a silent one.
 */
import { describe, expect, it } from 'vitest';
import { buildActorPayload } from '../gen/actorGen.js';
import { ARCHETYPES } from './actorMasses.js';
import { ACTOR_MANIFEST, ACTOR_CEILINGS } from './actorBudget.js';
import { silhouetteAreaM2 } from './silhouette.js';

describe('manifest completeness — both directions', () => {
  it('every archetype has a manifest entry with the right stage count', () => {
    for (const arch of ARCHETYPES) {
      const entry = ACTOR_MANIFEST[arch.id];
      expect(entry, `${arch.id} missing from ACTOR_MANIFEST`).toBeTruthy();
      expect(entry.length, `${arch.id} stage count`).toBe(arch.stages);
    }
  });

  it('every manifest key is a real archetype — no ghost cargo', () => {
    const ids = new Set(ARCHETYPES.map((a) => a.id));
    for (const key of Object.keys(ACTOR_MANIFEST)) {
      expect(ids.has(key), `manifest entry "${key}" has no archetype`).toBe(true);
    }
  });
});

describe('declared costs equal generated costs', () => {
  for (const arch of ARCHETYPES) {
    for (let stage = 0; stage < arch.stages; stage++) {
      it(`${arch.id} stage ${stage} matches its declaration`, () => {
        const payload = buildActorPayload(arch.id, stage);
        const declared = ACTOR_MANIFEST[arch.id][stage];
        const actualSilhouette = Number(silhouetteAreaM2(payload).toFixed(2));
        // On mismatch, say exactly what to paste.
        const actual = { tris: payload.triCount, verts: payload.vertCount, silhouetteM2: actualSilhouette };
        expect(actual, `${arch.id}[${stage}] drifted — update ACTOR_MANIFEST to ${JSON.stringify(actual)}`).toEqual(declared);
      });
    }
  }
});

describe('ceilings are sane', () => {
  it('maxSimultaneousActors is a positive finite integer', () => {
    const n = ACTOR_CEILINGS.maxSimultaneousActors;
    expect(Number.isFinite(n)).toBe(true);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });
});
