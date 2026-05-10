/**
 * ProceduralTileProvider — builds tile content deterministically from tile_id.
 *
 * Produces a flat grass ground sized to tile_size_m plus a small,
 * deterministic scatter of trees and rocks per tile. Future slice will
 * replace this with a GLB provider once Blender authoring lands.
 *
 * Uses a seeded PRNG so the same tile_id always yields the same scatter,
 * regardless of which player loads it — required for shared-world parity.
 */

/* global BABYLON */

import { parseTileId, streamingParams, tileBounds } from './tileMath.js';

// Mulberry32 — small, fast, deterministic.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromTileId(id) {
  const { col, row } = parseTileId(id);
  // Hash col,row into a 32-bit seed.
  return ((col * 73856093) ^ (row * 19349663)) >>> 0;
}

const TREES_PER_TILE = 12;
const ROCKS_PER_TILE = 6;

export class ProceduralTileProvider {
  constructor(config, options = {}) {
    this.params = streamingParams(config);
    this._materials = null;
    // Optional: skip scatter for visual debugging or perf testing.
    this.scatter = options.scatter !== false;
  }

  // Materials are lazy-built once per scene so tiles share them.
  _ensureMaterials(scene) {
    if (this._materials && this._materials.scene === scene) return this._materials;
    const grass = new BABYLON.StandardMaterial('tile_grass', scene);
    grass.diffuseColor = new BABYLON.Color3(0.18, 0.30, 0.12);
    grass.specularColor = new BABYLON.Color3(0, 0, 0);

    const trunk = new BABYLON.StandardMaterial('tile_trunk', scene);
    trunk.diffuseColor = new BABYLON.Color3(0.35, 0.22, 0.10);
    trunk.specularColor = new BABYLON.Color3(0, 0, 0);

    const leaf = new BABYLON.StandardMaterial('tile_leaf', scene);
    leaf.diffuseColor = new BABYLON.Color3(0.14, 0.42, 0.14);
    leaf.specularColor = new BABYLON.Color3(0, 0, 0);

    const rock = new BABYLON.StandardMaterial('tile_rock', scene);
    rock.diffuseColor = new BABYLON.Color3(0.42, 0.42, 0.44);
    rock.specularColor = new BABYLON.Color3(0, 0, 0);

    this._materials = { scene, grass, trunk, leaf, rock };
    return this._materials;
  }

  load(meta, scene) {
    const mats = this._ensureMaterials(scene);
    const bounds = tileBounds(meta.id, this.params);
    const size = this.params.tileSize;
    const cx = bounds.center.x;
    const cz = bounds.center.z;
    const rng = makeRng(seedFromTileId(meta.id));

    const container = new BABYLON.AssetContainer(scene);

    // Ground plane sized to the tile.
    const ground = BABYLON.MeshBuilder.CreateGround(`tile_${meta.id}_ground`, {
      width: size,
      height: size,
      subdivisions: 2,
    }, scene);
    ground.position.x = cx;
    ground.position.z = cz;
    ground.material = mats.grass;
    ground.receiveShadows = true;
    container.meshes.push(ground);

    if (this.scatter) {
      // Trees: cylinder trunk + cone leaf cluster.
      const halfSize = size / 2;
      for (let i = 0; i < TREES_PER_TILE; i++) {
        const lx = cx + (rng() - 0.5) * size * 0.9;
        const lz = cz + (rng() - 0.5) * size * 0.9;
        const h = 2.8 + rng() * 2.4;

        const trunk = BABYLON.MeshBuilder.CreateCylinder(`tile_${meta.id}_trunk${i}`, {
          diameterTop: 0.25, diameterBottom: 0.45, height: h, tessellation: 6,
        }, scene);
        trunk.position.set(lx, h / 2, lz);
        trunk.material = mats.trunk;
        container.meshes.push(trunk);

        const leaf = BABYLON.MeshBuilder.CreateCylinder(`tile_${meta.id}_leaf${i}`, {
          diameterTop: 0, diameterBottom: 1.6 + rng() * 0.6, height: 2.4, tessellation: 6,
        }, scene);
        leaf.position.set(lx, h + 0.6, lz);
        leaf.material = mats.leaf;
        container.meshes.push(leaf);
      }

      // Rocks: low-poly squashed spheres.
      for (let i = 0; i < ROCKS_PER_TILE; i++) {
        const lx = cx + (rng() - 0.5) * size * 0.95;
        const lz = cz + (rng() - 0.5) * size * 0.95;
        const d = 0.8 + rng() * 1.4;

        const rock = BABYLON.MeshBuilder.CreateSphere(`tile_${meta.id}_rock${i}`, {
          diameter: d, segments: 3,
        }, scene);
        rock.position.set(lx, d * 0.25, lz);
        rock.scaling.y = 0.55;
        rock.rotation.y = rng() * Math.PI * 2;
        rock.material = mats.rock;
        container.meshes.push(rock);
      }
      // Silence the unused halfSize warning in case future scatters reference it.
      void halfSize;
    }

    return container;
  }
}
