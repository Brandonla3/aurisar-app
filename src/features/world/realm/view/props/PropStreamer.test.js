/**
 * PropStreamer.test.js — streaming, tiering, and sprout semantics under
 * NullEngine (buffers and clones are CPU-side; nothing here needs pixels).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { PROP_TIER } from '../../model/propLod.js';
import { placeChunkProps } from '../../model/propPlacement.js';

let PropPrototypes, PropStreamer, buildPropMaterial, createTerrainField;
let engine;
let field;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  ({ PropPrototypes } = await import('./PropPrototypes.js'));
  ({ PropStreamer } = await import('./PropStreamer.js'));
  ({ buildPropMaterial } = await import('../materials/propNME.js'));
  ({ createTerrainField } = await import('../../model/terrainField.js'));
  field = createTerrainField();
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

async function rig() {
  const scene = new BABYLON.Scene(engine);
  new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -1, 0), scene);
  const { material } = await buildPropMaterial(scene);
  const prototypes = new PropPrototypes(scene, material);
  return { scene, material, prototypes };
}

describe('streaming and carriers', () => {
  it('builds carriers for the chunk underfoot, with counts matching placement exactly', async () => {
    const { scene, prototypes } = await rig();
    try {
      const s = new PropStreamer(scene, field, prototypes, { radius: 0, buildBudgetPerTick: 1 });
      s.update(32, 32, 1000);
      const placed = placeChunkProps(field, { cx: 0, cz: 0 });
      const expectedBuckets = Object.keys(placed.instances).length;
      expect(s.carrierCount()).toBe(expectedBuckets);
      const expectedInstances = Object.values(placed.instances).reduce((n, b) => n + b.count, 0);
      expect(s.instanceCount()).toBe(expectedInstances);
      s.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('respects the per-tick placement budget', async () => {
    const { scene, prototypes } = await rig();
    try {
      const s = new PropStreamer(scene, field, prototypes, { radius: 1, buildBudgetPerTick: 1 });
      const r1 = s.update(32, 32, 0);
      expect(r1.placed).toBe(1);
      expect(r1.pending).toBeGreaterThan(0);
      const r2 = s.update(32, 32, 16);
      expect(r2.placed).toBe(1);
      s.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('unloads a chunk\'s carriers when the player leaves', async () => {
    const { scene, prototypes } = await rig();
    try {
      const s = new PropStreamer(scene, field, prototypes, { radius: 0, buildBudgetPerTick: 4 });
      s.update(32, 32, 0);
      expect(s.carrierCount()).toBeGreaterThan(0);
      // Far away: old chunk falls outside radius+slack and unloads.
      s.update(100_000, 100_000, 16);
      s.update(100_000, 100_000, 32);
      expect(s.tierOfChunk(0, 0)).toBeNull();
      s.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('tier semantics', () => {
  it('the chunk underfoot is NEAR; walking far demotes it through MID', async () => {
    const { scene, prototypes } = await rig();
    try {
      const s = new PropStreamer(scene, field, prototypes, { radius: 3, buildBudgetPerTick: 64 });
      s.update(32, 32, 0);
      expect(s.tierOfChunk(0, 0)).toBe(PROP_TIER.NEAR);
      expect(s.tierOfChunk(2, 0)).toBe(PROP_TIER.MID);
      expect(s.tierOfChunk(3, 0)).toBe(PROP_TIER.FAR);
      s.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('FAR chunks keep their placement data but own zero carriers', async () => {
    const { scene, prototypes } = await rig();
    try {
      const s = new PropStreamer(scene, field, prototypes, { radius: 3, buildBudgetPerTick: 64 });
      s.update(32, 32, 0);
      // Count carriers belonging to far chunks: none may exist.
      const farIds = [];
      for (let cx = -3; cx <= 3; cx++) {
        for (let cz = -3; cz <= 3; cz++) {
          if (s.tierOfChunk(cx, cz) === PROP_TIER.FAR) farIds.push(`${cx},${cz}`);
        }
      }
      expect(farIds.length).toBeGreaterThan(0);
      for (const id of farIds) {
        expect(s._built.has(id)).toBe(false);
      }
      s.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('spinning in place (same camera cell) rebuilds nothing', async () => {
    const { scene, prototypes } = await rig();
    try {
      const s = new PropStreamer(scene, field, prototypes, { radius: 1, buildBudgetPerTick: 64 });
      s.update(33, 33, 0);
      const before = [...s._built.values()].flatMap((b) => b.carriers);
      s.update(34.5, 33.9, 16); // still inside the same 8m camera cell
      const after = [...s._built.values()].flatMap((b) => b.carriers);
      expect(after).toEqual(before); // same mesh OBJECTS — nothing rebuilt
      s.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('sprout semantics', () => {
  it('a fresh chunk\'s births are staggered from nowMs — a ripple, not a block', async () => {
    const { scene, prototypes } = await rig();
    try {
      const s = new PropStreamer(scene, field, prototypes, { radius: 0, buildBudgetPerTick: 1 });
      s.update(32, 32, 5000);
      const carrier = [...s._built.values()][0].carriers[0];
      const births = carrier._userThinInstanceBuffersStorage.data.sproutBirth;
      let min = Infinity;
      let max = -Infinity;
      for (const b of births) {
        min = Math.min(min, b);
        max = Math.max(max, b);
      }
      expect(min).toBeGreaterThanOrEqual(5000);
      expect(max).toBeLessThanOrEqual(5150);
      if (births.length > 3) expect(max).toBeGreaterThan(min); // genuinely staggered
      s.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('a tier swap rebuilds with births of 0 — LOD changes never replay growth', async () => {
    const { scene, prototypes } = await rig();
    try {
      const s = new PropStreamer(scene, field, prototypes, { radius: 3, buildBudgetPerTick: 64 });
      s.update(32, 32, 1000);
      // Walk so chunk (0,0) demotes NEAR -> MID (past 96m + hysteresis).
      s.update(32 + 130, 32, 2000);
      expect(s.tierOfChunk(0, 0)).toBe(PROP_TIER.MID);
      const built = s._built.get('0,0');
      expect(built).toBeTruthy();
      const births = built.carriers[0]._userThinInstanceBuffersStorage.data.sproutBirth;
      for (const b of births) expect(b).toBe(0);
      s.dispose();
    } finally {
      scene.dispose();
    }
  });
});
