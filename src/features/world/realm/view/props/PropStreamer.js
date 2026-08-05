/**
 * PropStreamer — keep each resident chunk's prop field built, tiered, and
 * cheap. The TerrainStreamer's shape, one level up the stack.
 *
 * Three responsibilities, all policy-free (the policies are pure):
 *  1. STREAM placement fields chunk-by-chunk on a small per-tick budget
 *     (model/propPlacement.js does the thinking; ~8-20ms per chunk measured,
 *     which is exactly why the budget defaults to 1 and trails terrain's 2 —
 *     ground appears first, props sprout a tick later, and the sprout makes
 *     that ordering read as intended).
 *  2. TIER resident chunks through the camera-cell policy (model/propLod.js)
 *     — carriers exist only for NEAR/MID chunks; FAR renders nothing and
 *     the terrain shader's vegetation tint takes over.
 *  3. Own the CARRIERS: one clone of the right master per (prototype,
 *     chunk), thin-instance buffers straight from the placement payload.
 *
 * Sprout semantics: a chunk's FIRST build stamps per-instance births
 * staggered over ~150ms from `nowMs` (a spatial ripple, precomputed on the
 * CPU — zero shader cost); a TIER SWAP rebuilds with births of 0, which the
 * material's fail-open contract reads as "fully grown" — LOD changes must
 * never replay the growth animation.
 */

import {
  DEFAULT_STREAM_RADIUS_CHUNKS, chunkId, diffChunks, neededChunksAround, worldToChunk,
} from '../../model/chunkMath.js';
import { PROP_TIER, cameraCellOf, diffTiers } from '../../model/propLod.js';
import { placeChunkProps } from '../../model/propPlacement.js';

export class PropStreamer {
  /**
   * @param {object} scene
   * @param {object} field terrainField
   * @param {object} prototypes PropPrototypes
   * @param {object} opts { radius, buildBudgetPerTick }
   */
  constructor(scene, field, prototypes, {
    radius = DEFAULT_STREAM_RADIUS_CHUNKS,
    buildBudgetPerTick = 1,
  } = {}) {
    this._scene = scene;
    this._field = field;
    this._prototypes = prototypes;
    this._radius = radius;
    this._budget = buildBudgetPerTick;
    /** id -> placement result ({ instances }) */
    this._fields = new Map();
    /** id -> { tier, carriers: mesh[] } */
    this._built = new Map();
    /** id -> tier (the pure policy's memory, fed back for hysteresis) */
    this._tiers = new Map();
    this._lastCell = null;
  }

  update(x, z, nowMs = typeof performance !== 'undefined' ? performance.now() : 0) {
    const center = worldToChunk(x, z);
    const needed = neededChunksAround(x, z, this._radius);
    const { toLoad, toUnload } = diffChunks(new Set(this._fields.keys()), needed, {
      radius: this._radius,
      center,
    });

    for (const id of toUnload) {
      this._disposeCarriers(id);
      this._fields.delete(id);
      this._tiers.delete(id);
    }

    let placed = 0;
    for (const c of toLoad) {
      if (placed >= this._budget) break;
      this._fields.set(c.id, placeChunkProps(this._field, { cx: c.cx, cz: c.cz }));
      placed++;
    }

    // Tier pass: re-evaluate on camera-cell change OR when new fields exist.
    const cell = cameraCellOf(x, z);
    const cellChanged = !this._lastCell
      || cell.cellX !== this._lastCell.cellX || cell.cellZ !== this._lastCell.cellZ;
    if (cellChanged || placed > 0) {
      this._lastCell = cell;
      const residents = [...this._fields.keys()].map((id) => {
        const [cx, cz] = id.split(',').map(Number);
        return { cx, cz, id };
      });
      const { next, changes } = diffTiers(this._tiers, residents, cell);
      this._tiers = next;
      for (const ch of changes) {
        this._disposeCarriers(ch.id);
        if (ch.to !== PROP_TIER.FAR) {
          // Fresh chunks (from === null) sprout; tier swaps appear grown.
          this._buildCarriers(ch.id, ch.to, ch.from === null ? nowMs : 0);
        }
      }
    }

    return { placed, pending: toLoad.length - placed };
  }

  _buildCarriers(id, tier, birthBaseMs) {
    const field = this._fields.get(id);
    if (!field) return;
    const carriers = [];
    for (const [protoId, bucket] of Object.entries(field.instances)) {
      const master = this._prototypes.masterFor(protoId, tier);
      const carrier = master.clone(`prop_${protoId}_${id}`);
      carrier.setEnabled(true);
      carrier.isPickable = false;
      carrier.receiveShadows = true;
      carrier.freezeWorldMatrix(); // identity — instance matrices carry world
      carrier.thinInstanceSetBuffer('matrix', bucket.matrices, 16, true);
      carrier.thinInstanceSetBuffer('instTint', bucket.tints, 3, true);
      const births = new Float32Array(bucket.count);
      if (birthBaseMs > 0) {
        for (let i = 0; i < bucket.count; i++) {
          // Deterministic ripple: primes fold the index into a 0..150ms
          // stagger so a chunk's props rise in a wave, not one block.
          births[i] = birthBaseMs + ((i * 2654435761) % 997) / 997 * 150;
        }
      }
      carrier.thinInstanceSetBuffer('sproutBirth', births, 1, true);
      // Bounds must cover the INSTANCES, not the master's single prop at
      // origin — without this, frustum culling drops the whole carrier the
      // moment the camera looks away from world origin.
      carrier.thinInstanceRefreshBoundingInfo();
      carriers.push(carrier);
    }
    this._built.set(id, { tier, carriers });
  }

  _disposeCarriers(id) {
    const built = this._built.get(id);
    if (!built) return;
    for (const c of built.carriers) c.dispose(false, false);
    this._built.delete(id);
  }

  /** Diagnostics: live carrier meshes (= prop draw calls this frame). */
  carrierCount() {
    let n = 0;
    for (const b of this._built.values()) n += b.carriers.length;
    return n;
  }

  /** Diagnostics: total placed instances across resident carriers. */
  instanceCount() {
    let n = 0;
    for (const b of this._built.values()) {
      for (const c of b.carriers) n += c.thinInstanceCount;
    }
    return n;
  }

  tierOfChunk(cx, cz) {
    return this._tiers.get(chunkId(cx, cz)) ?? null;
  }

  dispose() {
    for (const id of [...this._built.keys()]) this._disposeCarriers(id);
    this._fields.clear();
    this._tiers.clear();
  }
}
