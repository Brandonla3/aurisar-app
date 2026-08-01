/**
 * terrainChunkGen — tessellate one chunk of the terrain field into typed arrays.
 *
 * PURE. Emits a plain payload { positions, normals, indices, uvs } that
 * view/terrain/TerrainChunk.js turns into a Babylon mesh verbatim. Nothing
 * here knows what a mesh is — which is why this file is testable in node and
 * why the tessellation can be golden-tested without a GPU.
 *
 * Positions are CHUNK-LOCAL (origin at the chunk's min corner); the view layer
 * places the mesh at the chunk origin. Local coordinates keep float precision
 * flat across the world — vertices never carry world-sized magnitudes.
 *
 * Normals are sampled from the FIELD (field.normalAt), not averaged from the
 * generated triangles. Adjacent chunks tessellate independently; averaged
 * triangle normals would disagree along shared edges and draw a visible seam
 * down every chunk border. Field normals are identical on both sides of an
 * edge by construction.
 */

export function generateTerrainChunk(field, { cx, cz, size = 64, subdivisions = 32 }) {
  const verts = subdivisions + 1;
  const positions = new Float32Array(verts * verts * 3);
  const normals = new Float32Array(verts * verts * 3);
  const uvs = new Float32Array(verts * verts * 2);
  const indices = new Uint32Array(subdivisions * subdivisions * 6);

  const originX = cx * size;
  const originZ = cz * size;
  const step = size / subdivisions;

  let minY = Infinity;
  let maxY = -Infinity;

  let p = 0;
  let uv = 0;
  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const lx = ix * step;
      const lz = iz * step;
      const wx = originX + lx;
      const wz = originZ + lz;
      const y = field.surfaceY(wx, wz);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      positions[p] = lx;
      positions[p + 1] = y;
      positions[p + 2] = lz;

      const n = field.normalAt(wx, wz);
      normals[p] = n.x;
      normals[p + 1] = n.y;
      normals[p + 2] = n.z;
      p += 3;

      uvs[uv] = ix / subdivisions;
      uvs[uv + 1] = iz / subdivisions;
      uv += 2;
    }
  }

  // Two triangles per cell, counter-clockwise as seen from +Y so the ground
  // faces up under Babylon's default backface culling.
  let t = 0;
  for (let iz = 0; iz < subdivisions; iz++) {
    for (let ix = 0; ix < subdivisions; ix++) {
      const a = iz * verts + ix;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      indices[t++] = a; indices[t++] = c; indices[t++] = b;
      indices[t++] = b; indices[t++] = c; indices[t++] = d;
    }
  }

  return {
    cx, cz, size, subdivisions,
    positions, normals, uvs, indices,
    /** For bounding info + streamer debug; world-space Y range of this chunk. */
    minY, maxY,
    originX, originZ,
  };
}
