/**
 * PropPrototypes — every master mesh, built once at boot from pure payloads.
 *
 * One disabled master per (prototype, stage), geometry straight from
 * gen/propGen.js verbatim (the TerrainChunk pattern), all sharing the ONE
 * prop material. Carriers (PropStreamer) are clones of these masters —
 * clones share geometry and material by reference, so a carrier costs a
 * mesh header, never a vertex buffer.
 */

/* global BABYLON */

import { PROTOTYPES } from '../../model/propGenomes.js';
import { buildPrototypePayload } from '../../gen/propGen.js';

export class PropPrototypes {
  /**
   * @param {object} scene
   * @param {object} material the shared prop NodeMaterial (propNME.js)
   */
  constructor(scene, material) {
    /** 'protoId:stage' -> disabled master mesh */
    this._masters = new Map();
    for (const proto of PROTOTYPES) {
      for (let stage = 0; stage < proto.stages; stage++) {
        const payload = buildPrototypePayload(proto.id, stage);
        const mesh = new BABYLON.Mesh(`propMaster_${proto.id}_${stage}`, scene);
        const vd = new BABYLON.VertexData();
        vd.positions = payload.positions;
        vd.normals = payload.normals;
        vd.colors = payload.colors;
        vd.indices = payload.indices;
        vd.applyToMesh(mesh, false);
        mesh.material = material;
        mesh.setEnabled(false); // masters never render; carriers do
        mesh.isPickable = false;
        this._masters.set(`${proto.id}:${stage}`, mesh);
      }
    }
  }

  /**
   * The master for a prototype at a LOD tier. Tiers beyond a prototype's
   * stage count clamp to its last stage — a single-stage prototype (boulder,
   * bramble, tuft) renders its one mesh at NEAR and MID alike.
   */
  masterFor(protoId, tier) {
    const proto = PROTOTYPES.find((p) => p.id === protoId);
    if (!proto) throw new Error(`[PropPrototypes] unknown prototype "${protoId}"`);
    const stage = Math.min(tier, proto.stages - 1);
    return this._masters.get(`${protoId}:${stage}`);
  }

  dispose() {
    for (const mesh of this._masters.values()) mesh.dispose(false, false);
    this._masters.clear();
  }
}
