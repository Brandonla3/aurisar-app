/**
 * ProceduralTileProvider — builds tile content deterministically from tile_id.
 *
 * Produces a flat grass ground sized to tile_size_m plus a small,
 * deterministic scatter of trees and rocks per tile. Future slice will
 * replace this with a GLB provider once Blender authoring lands.
 *
 * Uses a seeded PRNG so the same tile_id always yields the same scatter,
 * regardless of which player loads it — required for shared-world parity.
 *
 * Trees and rocks are rendered as InstancedMesh copies of three shared
 * template meshes. With ring=1 the active scatter is 9 tiles × 18 trees +
 * 9 tiles × 6 rocks ≈ 270 nodes, but only three instanced draw calls
 * actually hit the GPU per frame.
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
    this._templates = null;
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

  // Template meshes shared by every tile. Each scattered tree/rock is an
  // InstancedMesh of the matching template, with per-instance position /
  // scaling carrying the variance the old code expressed as separate meshes.
  // Templates live for the lifetime of the provider — they are intentionally
  // NOT pushed into the tile AssetContainer so unload doesn't dispose them.
  _ensureTemplates(scene) {
    if (this._templates && this._templates.scene === scene) return this._templates;
    const mats = this._ensureMaterials(scene);

    const trunkSrc = BABYLON.MeshBuilder.CreateCylinder('tile_tpl_trunk', {
      diameterTop: 0.25, diameterBottom: 0.45, height: 1, tessellation: 6,
    }, scene);
    trunkSrc.material = mats.trunk;

    const leafSrc = BABYLON.MeshBuilder.CreateCylinder('tile_tpl_leaf', {
      diameterTop: 0, diameterBottom: 1, height: 2.4, tessellation: 6,
    }, scene);
    leafSrc.material = mats.leaf;

    const rockSrc = BABYLON.MeshBuilder.CreateSphere('tile_tpl_rock', {
      diameter: 1, segments: 3,
    }, scene);
    rockSrc.material = mats.rock;

    for (const m of [trunkSrc, leafSrc, rockSrc]) {
      m.setEnabled(false);   // template itself never renders
      m.isPickable = false;
    }

    this._templates = { scene, trunkSrc, leafSrc, rockSrc };
    return this._templates;
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
      const tpl = this._ensureTemplates(scene);

      // Trees: instanced cylinder trunk (height via scaling.y) + instanced
      // cone leaf cluster (radius via scaling.x/z).
      for (let i = 0; i < TREES_PER_TILE; i++) {
        const lx = cx + (rng() - 0.5) * size * 0.9;
        const lz = cz + (rng() - 0.5) * size * 0.9;
        const h = 2.8 + rng() * 2.4;

        const trunk = tpl.trunkSrc.createInstance(`tile_${meta.id}_trunk${i}`);
        trunk.position.set(lx, h / 2, lz);
        trunk.scaling.y = h;
        container.meshes.push(trunk);

        const leafDia = 1.6 + rng() * 0.6;
        const leaf = tpl.leafSrc.createInstance(`tile_${meta.id}_leaf${i}`);
        leaf.position.set(lx, h + 0.6, lz);
        leaf.scaling.x = leafDia;
        leaf.scaling.z = leafDia;
        container.meshes.push(leaf);
      }

      // Rocks: instanced spheres, squashed via scaling.y.
      for (let i = 0; i < ROCKS_PER_TILE; i++) {
        const lx = cx + (rng() - 0.5) * size * 0.95;
        const lz = cz + (rng() - 0.5) * size * 0.95;
        const d  = 0.8 + rng() * 1.4;

        const rock = tpl.rockSrc.createInstance(`tile_${meta.id}_rock${i}`);
        rock.position.set(lx, d * 0.25, lz);
        rock.scaling.set(d, d * 0.55, d);
        rock.rotation.y = rng() * Math.PI * 2;
        container.meshes.push(rock);
      }
    }

    return container;
  }
}
