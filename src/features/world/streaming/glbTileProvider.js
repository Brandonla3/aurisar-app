/**
 * GlbTileProvider — downloads tile content as a GLB from meta.renderUrl.
 *
 * Matches the AssetLibrary convention of consuming the BABYLON global.
 * Returns a Babylon AssetContainer so TileLoader can manage its lifecycle.
 */

/* global BABYLON */

export class GlbTileProvider {
  async load(meta, scene) {
    const lastSlash = meta.renderUrl.lastIndexOf('/');
    const dir = lastSlash >= 0 ? meta.renderUrl.slice(0, lastSlash + 1) : '';
    const file = lastSlash >= 0 ? meta.renderUrl.slice(lastSlash + 1) : meta.renderUrl;
    return BABYLON.SceneLoader.LoadAssetContainerAsync(dir, file, scene);
  }
}
