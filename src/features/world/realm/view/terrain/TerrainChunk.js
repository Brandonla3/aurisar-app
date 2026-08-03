/**
 * TerrainChunk — turn one generated payload into one frozen Babylon mesh.
 *
 * Deliberately dumb. All decisions (heights, normals, tessellation) were made
 * in gen/terrainChunkGen.js; this file copies arrays into a mesh, places it at
 * the chunk origin, and freezes everything. If logic wants to creep in here,
 * it belongs in gen/ where it can be tested without a GPU.
 *
 * Chunks are born at visibility 0 and ramp to 1 over CHUNK_FADE_MS
 * (TerrainStreamer owns the ramp; model/chunkFade.js owns the pure math) —
 * structural pop-in concealment, so hiding the streaming edge no longer
 * depends on scene.fogDensity being tuned high. That is what frees fog to be
 * tuned for the far horizonRings instead. `mesh.visibility` is a plain
 * per-frame-read property, independent of freezeWorldMatrix — freezing the
 * matrix does not freeze this.
 */

/* global BABYLON */

export function buildTerrainChunkMesh(scene, payload, material) {
  const mesh = new BABYLON.Mesh(`terrain_${payload.cx}_${payload.cz}`, scene);

  const vd = new BABYLON.VertexData();
  vd.positions = payload.positions;
  vd.normals = payload.normals;
  vd.uvs = payload.uvs;
  vd.colors = payload.colors; // baked self-shadow proxy — see terrainChunkGen.js
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
  mesh.visibility = 0; // TerrainStreamer ramps this to 1 — see chunkFade.js

  return mesh;
}
