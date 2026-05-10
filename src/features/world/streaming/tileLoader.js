/**
 * TileLoader — owns the lifecycle of streamed world tiles.
 *
 * Pure-infra: this class is not yet wired into BabylonWorldScene. The next
 * slice will instantiate one against the live scene and call stream() each
 * time the player crosses a tile boundary.
 *
 * Babylon is consumed via the global pollution from `import BABYLON from
 * 'babylonjs'` elsewhere in the bundle, matching the convention used by
 * AssetLibrary.js.
 */

/* global BABYLON */

import { streamingParams, worldToTile, getNeighborhood } from './tileMath.js';

export class TileLoader {
  constructor(scene, config, tileIndex) {
    this.scene = scene;
    this.params = streamingParams(config);
    this.tileIndex = tileIndex;
    this.loaded = new Map();
    this.inFlight = new Map();
    this.lastCenter = null;
  }

  currentTile(playerPos) {
    return worldToTile(playerPos.x, playerPos.z, this.params);
  }

  neededTiles(playerPos) {
    const center = this.currentTile(playerPos);
    return new Set(getNeighborhood(center, this.params.ring, this.params));
  }

  async _loadTile(id) {
    if (this.loaded.has(id)) return;
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const meta = this.tileIndex[id];
    if (!meta) return;

    const lastSlash = meta.renderUrl.lastIndexOf('/');
    const dir = lastSlash >= 0 ? meta.renderUrl.slice(0, lastSlash + 1) : '';
    const file = lastSlash >= 0 ? meta.renderUrl.slice(lastSlash + 1) : meta.renderUrl;

    const promise = BABYLON.SceneLoader.LoadAssetContainerAsync(dir, file, this.scene)
      .then((container) => {
        container.addAllToScene();
        for (const mesh of container.meshes) {
          if (mesh instanceof BABYLON.Mesh) {
            mesh.freezeWorldMatrix();
            mesh.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
          }
        }
        this.loaded.set(id, container);
        this.inFlight.delete(id);
        return container;
      })
      .catch((err) => {
        this.inFlight.delete(id);
        throw err;
      });

    this.inFlight.set(id, promise);
    return promise;
  }

  _unloadTile(id) {
    const container = this.loaded.get(id);
    if (!container) return;
    container.removeAllFromScene();
    container.dispose();
    this.loaded.delete(id);
  }

  async stream(playerPos) {
    const center = this.currentTile(playerPos);
    if (center === this.lastCenter) return;
    this.lastCenter = center;

    const needed = new Set(getNeighborhood(center, this.params.ring, this.params));
    const loads = [];
    for (const id of needed) {
      if (!this.loaded.has(id) && !this.inFlight.has(id)) {
        loads.push(this._loadTile(id));
      }
    }
    for (const id of [...this.loaded.keys()]) {
      if (!needed.has(id)) this._unloadTile(id);
    }
    await Promise.all(loads);
  }

  dispose() {
    for (const id of [...this.loaded.keys()]) this._unloadTile(id);
    this.inFlight.clear();
    this.lastCenter = null;
  }
}
