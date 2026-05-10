/**
 * tileMath — pure tile-grid math derived from world_build_config.tiling_streaming.
 *
 * No Babylon, no I/O. Safe to run in Node and unit-test.
 */

export function streamingParams(config) {
  const t = config.tiling_streaming;
  return {
    minX: t.world_bounds_m.min_x,
    minZ: t.world_bounds_m.min_z,
    maxX: t.world_bounds_m.max_x,
    maxZ: t.world_bounds_m.max_z,
    tileSize: t.tile_size_m,
    cols: t.tile_grid.cols,
    rows: t.tile_grid.rows,
    ring: t.active_streaming_ring,
  };
}

export function formatTileId(col, row) {
  return `T_${String(col).padStart(2, '0')}_${String(row).padStart(2, '0')}`;
}

export function parseTileId(id) {
  const parts = id.split('_');
  return { col: Number(parts[1]), row: Number(parts[2]) };
}

export function worldToTile(x, z, params) {
  const rawCol = Math.floor((x - params.minX) / params.tileSize);
  const rawRow = Math.floor((z - params.minZ) / params.tileSize);
  const col = Math.max(0, Math.min(params.cols - 1, rawCol));
  const row = Math.max(0, Math.min(params.rows - 1, rawRow));
  return formatTileId(col, row);
}

export function getNeighborhood(tileId, ring, params) {
  const { col, row } = parseTileId(tileId);
  const out = [];
  for (let dr = -ring; dr <= ring; dr++) {
    for (let dc = -ring; dc <= ring; dc++) {
      const cc = col + dc;
      const rr = row + dr;
      if (cc < 0 || cc >= params.cols) continue;
      if (rr < 0 || rr >= params.rows) continue;
      out.push(formatTileId(cc, rr));
    }
  }
  return out;
}

export function tileBounds(tileId, params) {
  const { col, row } = parseTileId(tileId);
  const minX = params.minX + col * params.tileSize;
  const minZ = params.minZ + row * params.tileSize;
  const maxX = minX + params.tileSize;
  const maxZ = minZ + params.tileSize;
  return {
    min: { x: minX, z: minZ },
    max: { x: maxX, z: maxZ },
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
  };
}

/**
 * Builds the full tile index for a world. Caller supplies a urlFor object
 * with .render(id) and .gameplay(id) functions so the index can be reused
 * across CDN bases, dev/prod, etc.
 */
export function buildTileIndex(params, urlFor) {
  const index = {};
  for (let row = 0; row < params.rows; row++) {
    for (let col = 0; col < params.cols; col++) {
      const id = formatTileId(col, row);
      const bounds = tileBounds(id, params);
      index[id] = {
        id,
        min: bounds.min,
        max: bounds.max,
        center: bounds.center,
        renderUrl: urlFor.render(id),
        gameplayUrl: urlFor.gameplay(id),
      };
    }
  }
  return index;
}

/**
 * Returns the set of tile IDs that should be loaded for a given player
 * position. Convenience wrapper around worldToTile + getNeighborhood.
 */
export function neededTilesAt(x, z, params) {
  const center = worldToTile(x, z, params);
  return new Set(getNeighborhood(center, params.ring, params));
}
