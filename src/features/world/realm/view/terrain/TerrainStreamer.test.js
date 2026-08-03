/**
 * TerrainStreamer.test.js — NullEngine smoke, focused on the fade contract
 * (structural pop-in concealment) that this streamer had no coverage for at
 * all before P4b.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { CHUNK_FADE_MS } from '../../model/chunkFade.js';
import { DEFAULT_STREAM_RADIUS_CHUNKS } from '../../model/chunkMath.js';

let TerrainStreamer;
let engine;
let field;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  ({ TerrainStreamer } = await import('./TerrainStreamer.js'));
  const { createTerrainField } = await import('../../model/terrainField.js');
  field = createTerrainField();
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

describe('TerrainStreamer fade contract', () => {
  it('a freshly built chunk starts invisible', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const s = new TerrainStreamer(scene, field, { radius: 0, buildBudgetPerTick: 1 });
      s.update(0, 0, 1000);
      const mesh = [...scene.meshes].find((m) => m.name.startsWith('terrain_'));
      expect(mesh.visibility).toBe(0);
      expect(s.isSettledVisually()).toBe(false);
    } finally {
      scene.dispose();
    }
  });

  it('ramps to fully visible after fadeMs and then stops tracking it', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const s = new TerrainStreamer(scene, field, { radius: 0, buildBudgetPerTick: 1 });
      s.update(0, 0, 1000);
      const mesh = [...scene.meshes].find((m) => m.name.startsWith('terrain_'));

      s.update(0, 0, 1000 + CHUNK_FADE_MS / 2);
      expect(mesh.visibility).toBeCloseTo(0.5, 6);
      expect(s.isSettledVisually()).toBe(false);

      s.update(0, 0, 1000 + CHUNK_FADE_MS);
      expect(mesh.visibility).toBe(1);
      expect(s.isSettledVisually()).toBe(true);
    } finally {
      scene.dispose();
    }
  });

  it('a fully-settled chunk is not touched by later ticks (no visible re-fade)', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const s = new TerrainStreamer(scene, field, { radius: 0, buildBudgetPerTick: 1 });
      s.update(0, 0, 0);
      s.update(0, 0, CHUNK_FADE_MS + 1);
      const mesh = [...scene.meshes].find((m) => m.name.startsWith('terrain_'));
      mesh.visibility = 0.77; // simulate something else touching it — streamer must not clobber it back
      s.update(0, 0, CHUNK_FADE_MS + 5000);
      expect(mesh.visibility).toBe(0.77);
    } finally {
      scene.dispose();
    }
  });

  it('disposing a chunk mid-fade does not throw and stops tracking it', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const s = new TerrainStreamer(scene, field, { radius: 0, buildBudgetPerTick: 1 });
      s.update(0, 0, 0); // chunk (0,0) born, fading
      // Move far enough that (0,0) unloads before its fade completes.
      expect(() => s.update(100_000, 100_000, 50)).not.toThrow();
      s.update(100_000, 100_000, 50); // let the new center's own chunk build/fade
      expect(s.isSettledVisually()).toBe(false); // the NEW chunk is now fading
    } finally {
      scene.dispose();
    }
  });

  it('fadeMs = 0 makes chunks instantly visible', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const s = new TerrainStreamer(scene, field, { radius: 0, buildBudgetPerTick: 1, fadeMs: 0 });
      s.update(0, 0, 0);
      const mesh = [...scene.meshes].find((m) => m.name.startsWith('terrain_'));
      expect(mesh.visibility).toBe(1);
      expect(s.isSettledVisually()).toBe(true);
    } finally {
      scene.dispose();
    }
  });
});

describe('TerrainStreamer.update — unchanged behaviour', () => {
  it('still reports built/unloaded/pending as before', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const s = new TerrainStreamer(scene, field, { radius: 1, buildBudgetPerTick: 2 });
      const r = s.update(0, 0, 0);
      expect(r.built).toBe(2);
      expect(r.pending).toBeGreaterThan(0);
    } finally {
      scene.dispose();
    }
  });

  it('nowMs defaults to a real clock, not a frozen 0, so fade-in actually completes', () => {
    // Real bug this pins: `nowMs = 0` as a default meant a caller who never
    // passes a timestamp leaves every chunk's birth AND every later "now"
    // pinned to the same value — the fade ratio (now - birth) / fadeMs never
    // moves, and chunks stay invisible forever. performance.now() as the
    // default makes the common no-timestamp case actually work.
    const scene = new BABYLON.Scene(engine);
    try {
      const s = new TerrainStreamer(scene, field, { radius: 0, buildBudgetPerTick: 1, fadeMs: 1 });
      s.update(0, 0); // no nowMs passed
      const t0 = performance.now();
      while (performance.now() - t0 < 5) { /* busy-wait past the 1ms fade */ }
      s.update(0, 0); // no nowMs passed again — must observe real elapsed time
      expect(s.isSettledVisually()).toBe(true);
    } finally {
      scene.dispose();
    }
  });
});

describe('TerrainStreamer — self-shadow vertex colors reach the real mesh', () => {
  it('a built chunk carries the baked color buffer, not just positions/normals', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const s = new TerrainStreamer(scene, field, { radius: 0, buildBudgetPerTick: 1 });
      s.update(0, 0, 0);
      const mesh = [...scene.meshes].find((m) => m.name.startsWith('terrain_'));
      const colors = mesh.getVerticesData(BABYLON.VertexBuffer.ColorKind);
      expect(colors).toBeTruthy();
      expect(colors.length).toBeGreaterThan(0);
    } finally {
      scene.dispose();
    }
  });
});

describe('TerrainStreamer default radius', () => {
  it('reads DEFAULT_STREAM_RADIUS_CHUNKS — the same constant horizonRings.js reads', () => {
    // Not a hardcoded 49: derived from the shared constant, so this test's
    // own expectation moves if the constant ever does, the same way the ring
    // radii do.
    const scene = new BABYLON.Scene(engine);
    try {
      const s = new TerrainStreamer(scene, field, { buildBudgetPerTick: 999 }); // no radius override
      s.update(0, 0, 0);
      const n = DEFAULT_STREAM_RADIUS_CHUNKS;
      expect(s.residentCount()).toBe((2 * n + 1) ** 2);
    } finally {
      scene.dispose();
    }
  });
});
