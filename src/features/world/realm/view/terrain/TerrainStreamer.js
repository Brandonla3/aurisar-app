/**
 * TerrainStreamer — keep the right chunks resident as the player moves.
 *
 * The policy (which chunks, in what order, with what hysteresis) is pure and
 * lives in model/chunkMath.js. This class is the thin stateful shell that calls
 * it and owns the meshes.
 *
 * Build budget: at most `buildBudgetPerTick` chunks are generated per tick.
 * Chunk generation is CPU work on the main thread; building a whole ring in
 * one frame is a visible hitch. The needed-set is ordered center-out, so the
 * ground underfoot always wins the budget.
 */

import {
  CHUNK_SIZE_M, TERRAIN_SUBDIVISIONS, diffChunks, neededChunksAround, worldToChunk,
} from '../../model/chunkMath.js';
import { generateTerrainChunk } from '../../gen/terrainChunkGen.js';
import { buildTerrainChunkMesh } from './TerrainChunk.js';

export class TerrainStreamer {
  constructor(scene, field, {
    radius = 3,
    subdivisions = TERRAIN_SUBDIVISIONS,
    chunkSize = CHUNK_SIZE_M,
    buildBudgetPerTick = 2,
    material = null,
  } = {}) {
    this._scene = scene;
    this._field = field;
    this._radius = radius;
    this._subdivisions = subdivisions;
    this._chunkSize = chunkSize;
    this._budget = buildBudgetPerTick;
    this._material = material;
    /** id -> mesh */
    this._resident = new Map();
  }

  /** Call once per sim tick with the player position. */
  update(x, z) {
    const center = worldToChunk(x, z, this._chunkSize);
    const needed = neededChunksAround(x, z, this._radius, this._chunkSize);
    const { toLoad, toUnload } = diffChunks(new Set(this._resident.keys()), needed, {
      radius: this._radius,
      center,
    });

    // Unload is cheap (dispose) — do all of it. Load is budgeted.
    for (const id of toUnload) {
      this._resident.get(id)?.dispose(false, false);
      this._resident.delete(id);
    }

    let built = 0;
    for (const c of toLoad) {
      if (built >= this._budget) break;
      const payload = generateTerrainChunk(this._field, {
        cx: c.cx, cz: c.cz, size: this._chunkSize, subdivisions: this._subdivisions,
      });
      this._resident.set(c.id, buildTerrainChunkMesh(this._scene, payload, this._material));
      built++;
    }

    return { built, unloaded: toUnload.length, pending: toLoad.length - built };
  }

  /** True once every chunk in radius is resident — the "safe to spawn" gate. */
  isSettled(x, z) {
    return neededChunksAround(x, z, this._radius, this._chunkSize)
      .every((c) => this._resident.has(c.id));
  }

  residentCount() {
    return this._resident.size;
  }

  dispose() {
    for (const mesh of this._resident.values()) mesh.dispose(false, false);
    this._resident.clear();
  }
}
