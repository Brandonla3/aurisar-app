/**
 * TerrainChunk — turn one generated payload into one frozen Babylon mesh.
 *
 * Deliberately dumb. All decisions (heights, normals, tessellation) were made
 * in gen/terrainChunkGen.js; this file copies arrays into a mesh, places it at
 * the chunk origin, and freezes everything. If logic wants to creep in here,
 * it belongs in gen/ where it can be tested without a GPU.
 */

/* global BABYLON */

export function buildTerrainChunkMesh(scene, payload, material) {
  const mesh = new BABYLON.Mesh(`terrain_${payload.cx}_${payload.cz}`, scene);

  const vd = new BABYLON.VertexData();
  vd.positions = payload.positions;
  vd.normals = payload.normals;
  vd.uvs = payload.uvs;
  vd.indices = payload.indices;
  vd.applyToMesh(mesh, false); // not updatable — terrain never morphs

  // Positions are chunk-local; the world offset lives on the node.
  mesh.position.set(payload.originX, 0, payload.originZ);

  if (material) mesh.material = material;

  // Static ground: no matrix recomputes, no per-frame material dirty checks.
  mesh.freezeWorldMatrix();
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  // Chunks are large and ground-hugging; sphere-only culling is cheap and never
  // false-negatives for meshes this size.
  mesh.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;

  return mesh;
}
