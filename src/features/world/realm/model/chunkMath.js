/**
 * chunkMath — chunk ids, bounds, and the ring set around a position.
 *
 * PURE. The streamer asks "which chunks should exist right now?"; this module
 * answers with plain data and no opinion about meshes.
 */

export const CHUNK_SIZE_M = 64;

/**
 * One tessellation density, shared by the generator's default and the
 * streamer's default. Two independent defaults for the same concept is how a
 * "quick test at low subdivisions" silently ships to players.
 */
export const TERRAIN_SUBDIVISIONS = 48;

/**
 * The streamed disc's default radius, in chunks. Shared by TerrainStreamer's
 * constructor default AND model/horizonRings.js's ring-tier radii — so "the
 * rings are sized relative to the streamer" is a fact both read from the same
 * constant, not two files whose numbers happen to agree today. A streamer
 * constructed with an explicit `{ radius }` override intentionally diverges
 * from the rings, same as it already diverges from this default.
 */
export const DEFAULT_STREAM_RADIUS_CHUNKS = 3;

/** "cx,cz" — stable, readable, usable as a Map key. */
export const chunkId = (cx, cz) => `${cx},${cz}`;

export function parseChunkId(id) {
  const [cx, cz] = id.split(',').map(Number);
  return { cx, cz };
}

export function worldToChunk(x, z, size = CHUNK_SIZE_M) {
  return { cx: Math.floor(x / size), cz: Math.floor(z / size) };
}

export function chunkBounds(cx, cz, size = CHUNK_SIZE_M) {
  return { minX: cx * size, minZ: cz * size, maxX: (cx + 1) * size, maxZ: (cz + 1) * size };
}

/**
 * The set of chunks that should be resident around (x, z): a Chebyshev square
 * of `radius` rings. Chebyshev (not Euclidean) so the answer is a full square —
 * diagonal movement never pops a corner chunk late.
 *
 * Returned sorted by ring (center first), so a budgeted loader building N per
 * frame builds the ground underfoot before the horizon.
 */
export function neededChunksAround(x, z, radius, size = CHUNK_SIZE_M) {
  const { cx, cz } = worldToChunk(x, z, size);
  const out = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      out.push({
        cx: cx + dx,
        cz: cz + dz,
        id: chunkId(cx + dx, cz + dz),
        ring: Math.max(Math.abs(dx), Math.abs(dz)),
      });
    }
  }
  out.sort((a, b) => a.ring - b.ring);
  return out;
}

/**
 * Diff resident chunks against the needed set.
 * `unloadSlackRings`: chunks are only dropped when they fall OUTSIDE
 * radius + slack. Loading at ring N but unloading at N+1 gives hysteresis —
 * pacing along a chunk border must not thrash load/unload every step.
 */
export function diffChunks(residentIds, needed, { radius, unloadSlackRings = 1, center }) {
  const neededIds = new Set(needed.map((n) => n.id));
  const toLoad = needed.filter((n) => !residentIds.has(n.id));

  const keepRadius = radius + unloadSlackRings;
  const toUnload = [...residentIds].filter((id) => {
    if (neededIds.has(id)) return false;
    const { cx, cz } = parseChunkId(id);
    const ring = Math.max(Math.abs(cx - center.cx), Math.abs(cz - center.cz));
    return ring > keepRadius;
  });

  return { toLoad, toUnload };
}
