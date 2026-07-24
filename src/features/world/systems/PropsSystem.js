/**
 * PropsSystem — places the hub settlement + camp dressing from
 * content/zones/zone1/props.ts using the CC0 GLBs under
 * public/assets/props/ (see ATTRIBUTION.md).
 *
 * Pure client visuals: deterministic from content data, no server rows,
 * no collision (tree/prop collision is a tracked backlog item). Placement
 * rules follow the reference layout: buildings scaled to authored
 * w×h×d footprints, fences segmented along lines, ruin rings alternating
 * intact/broken columns, composed mine entrance and dock.
 */

/* global BABYLON */

import { ZONE1_PROPS } from '../content/zones/zone1/props';
import propsManifest from '../../../../public/assets/manifest/props.manifest.json';

const BASE = propsManifest.base; // '/assets/props/'

// key → file, from the generated manifest (scripts/assets_pipeline.mjs).
const MANIFEST = Object.fromEntries(
  Object.entries(propsManifest.assets).map(([key, a]) => [key, a.file]),
);

// House heights from the reference layout (houseHeight table).
const HOUSE_KINDS = ['house_1', 'house_2', 'blacksmith'];
const HOUSE_HEIGHT = { house_1: 8.0, house_2: 7.6, inn: 7.6, blacksmith: 6.6 };

function rand(x, z) {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

export class PropsSystem {
  constructor(scene, worldgen) {
    this.scene = scene;
    this.worldgen = worldgen;
    this._containers = new Map();
    this._roots = [];
    this._disposed = false;
    this._castShadow = scene.metadata?.ashwood?.castShadow ?? (() => {});
  }

  async init() {
    await Promise.all(
      Object.entries(MANIFEST).map(async ([key, file]) => {
        try {
          const c = await BABYLON.SceneLoader.LoadAssetContainerAsync(BASE, file, this.scene);
          this._containers.set(key, c);
        } catch {
          // Missing file — that placement is skipped silently.
        }
      })
    );
    if (this._disposed) return;
    this._placeAll();
  }

  _ground(x, z) { return this.worldgen.surfaceY(x, z); }

  /**
   * Instantiate a prop. opts: { fit: {w,h,d} exact-fit scale per axis,
   * uniform: target size for the largest XZ extent, yOffset, rotY, tint }.
   * Returns the root TransformNode (or null if the GLB is missing).
   */
  _place(key, x, z, opts = {}) {
    const container = this._containers.get(key);
    if (!container) return null;
    const inst = container.instantiateModelsToScene((n) => `prop_${key}_${n}`, false);
    const root = new BABYLON.TransformNode(`prop_${key}_${Math.round(x * 10)}_${Math.round(z * 10)}`, this.scene);
    inst.rootNodes.forEach((n) => { n.parent = root; });

    // Measure the unscaled footprint to derive fit scales.
    const { min, max } = root.getHierarchyBoundingVectors(true);
    const size = max.subtract(min);
    const sx = Math.max(size.x, 0.001);
    const sy = Math.max(size.y, 0.001);
    const sz = Math.max(size.z, 0.001);

    if (opts.fit) {
      root.scaling.set(opts.fit.w / sx, opts.fit.h / sy, opts.fit.d / sz);
    } else if (opts.uniform) {
      const s = opts.uniform / Math.max(sx, sz);
      root.scaling.set(s, (opts.uniformY ?? opts.uniform) / sy, s);
    }

    // Sit the base on the terrain: the measured min.y scaled is the offset
    // from the root origin to the lowest vertex.
    const scaledMinY = min.y * root.scaling.y;
    root.position.set(x, this._ground(x, z) - scaledMinY + (opts.yOffset ?? -0.06), z);
    if (opts.rotY !== undefined) root.rotation.y = opts.rotY;

    const meshes = inst.rootNodes.flatMap((n) => (n.getChildMeshes ? n.getChildMeshes(false) : []));
    for (const m of meshes) {
      m.isPickable = false;
      this._castShadow(m);
      if (opts.tint && m.material) {
        if ('albedoColor' in m.material) m.material.albedoColor = opts.tint;
        else if ('diffuseColor' in m.material) m.material.diffuseColor = opts.tint;
      }
    }
    root.computeWorldMatrix(true);
    this._roots.push(root);
    return root;
  }

  _placeAll() {
    const P = ZONE1_PROPS;

    // ── Buildings ──────────────────────────────────────────────────
    for (const b of P.buildings) {
      if (b.kind === 'chapel') {
        // Chapel = bell tower (rear) + small hall (front).
        this._place('bell_tower', b.x, b.z - 0.75 * Math.cos(b.rot), {
          fit: { w: b.w * 0.98, h: 10.6, d: b.d * 0.72 }, rotY: b.rot,
        });
        this._place('house_3', b.x + Math.sin(b.rot) * (b.d / 2 - 1.62), b.z + Math.cos(b.rot) * (b.d / 2 - 1.62), {
          fit: { w: b.w * 0.9, h: 2.5, d: 3.2 }, rotY: b.rot,
        });
        continue;
      }
      const kind = b.kind === 'inn'
        ? 'inn'
        : HOUSE_KINDS[Math.floor(rand(b.x * 13.7, b.z * 3.1) * HOUSE_KINDS.length) % HOUSE_KINDS.length];
      this._place(kind, b.x, b.z, {
        fit: { w: b.w, h: HOUSE_HEIGHT[kind] ?? 7.6, d: b.d }, rotY: b.rot, yOffset: -0.12,
      });
    }

    // ── Well ───────────────────────────────────────────────────────
    for (const w of P.wells) {
      this._place('well', w.x, w.z, { fit: { w: 2.6, h: 3.6, d: 2.9 }, rotY: rand(w.x, w.z) * Math.PI, yOffset: -0.1 });
    }

    // ── Market stalls (+ smithy / produce clutter) ─────────────────
    P.stalls.forEach((s, i) => {
      const standKey = i % 2 === 0 ? 'market_stand_1' : 'market_stand_2';
      this._place(standKey, s.x, s.z, { fit: { w: 3.1, h: 2.6, d: 2.5 }, rotY: s.rot });
      const cos = Math.cos(s.rot);
      const sin = Math.sin(s.rot);
      const local = (lx, lz) => ({ x: s.x + lx * cos + lz * sin, z: s.z - lx * sin + lz * cos });
      if (s.smithy) {
        const a = local(1.35, 1.15);
        const ws = local(-1.45, 0.6);
        this._place('anvil', a.x, a.z, { uniform: 1.0, rotY: s.rot });
        this._place('weapon_stand', ws.x, ws.z, { uniform: 1.4, rotY: s.rot });
      } else {
        const fc = local(1.3, 1.05);
        const br = local(-1.35, 0.85);
        this._place('farmcrate_apple', fc.x, fc.z, { uniform: 1.0, rotY: s.rot });
        this._place('barrel', br.x, br.z, { uniform: 1.0, rotY: rand(br.x, br.z) * Math.PI });
      }
    });

    // ── Static bonfires ────────────────────────────────────────────
    for (const c of P.campfires) {
      this._place('bonfire', c.x, c.z, { uniform: 2.2, rotY: rand(c.x, c.z) * Math.PI * 2, yOffset: -0.05 });
    }

    // ── Fences (segmented lines, ~2.35 m modules) ──────────────────
    for (const f of P.fences) {
      const dx = f.x2 - f.x1;
      const dz = f.z2 - f.z1;
      const len = Math.hypot(dx, dz);
      const modules = Math.max(1, Math.round(len / 2.35));
      const yaw = Math.atan2(dx, dz) + Math.PI / 2;
      for (let i = 0; i < modules; i++) {
        const t = (i + 0.5) / modules;
        this._place('fence', f.x1 + dx * t, f.z1 + dz * t, { uniform: 2.5, uniformY: 1.4, rotY: yaw });
      }
    }

    // ── Bandit tents + crate clutter ───────────────────────────────
    for (const t of P.tents) {
      const kind = rand(t.x, t.z) < 0.55 ? 'tent_open' : 'tent_small';
      this._place(kind, t.x, t.z, { uniform: 3.0 * t.scale, uniformY: 2.6 * t.scale, rotY: t.rot });
    }
    P.crates.forEach((c, i) => {
      const kind = i % 3 === 2 ? 'barrel' : 'crate_wooden';
      this._place(kind, c.x, c.z, { uniform: kind === 'barrel' ? 0.9 : 1.0, rotY: rand(c.x, c.z) * Math.PI, yOffset: -0.04 });
    });

    // ── Murloc mud huts (recolored mushrooms, doorways facing center) ─
    if (P.mudHuts.length) {
      const tint = new BABYLON.Color3(0.72, 0.6, 0.42);
      for (const h of P.mudHuts) {
        this._place('mushroom_red', h.x, h.z, {
          uniform: 5.5 + rand(h.x, h.z) * 1.5, uniformY: 4.5 + rand(h.z, h.x) * 1.5,
          rotY: rand(h.x, h.z) * Math.PI * 2, tint,
        });
        this._place('mushroom_tan', h.x + 1.8, h.z + 1.2, { uniform: 1.2 });
      }
    }

    // ── Mourner's Rest ruin ring ───────────────────────────────────
    for (const r of P.ruinRings) {
      for (let i = 0; i < r.columns; i++) {
        const ang = (i / r.columns) * Math.PI * 2;
        const cx = r.x + Math.sin(ang) * r.ringR;
        const cz = r.z + Math.cos(ang) * r.ringR;
        const intact = i % 4 === 1;
        this._place(intact ? 'column' : 'column_broken', cx, cz, {
          uniform: 1.6, uniformY: intact ? 3.5 + (i % 2) * 0.5 : 1.7 + (i % 3) * 0.85,
          rotY: ang,
        });
      }
      // Toppled relics at the ring center.
      this._place('statue_head', r.x - 2, r.z - 3, { uniform: 1.6, rotY: 0.7 });
      this._place('statue_block', r.x - 0.5, r.z - 3.6, { uniform: 1.4, rotY: 1.9 });
      this._place('column_broken', r.x + 1.5, r.z - 2.2, { uniform: 1.5, uniformY: 0.9, rotY: 2.6 });
    }

    // ── Rustvein Dig mine entrance (composed) ──────────────────────
    for (const m of P.mines) {
      const cos = Math.cos(m.rot);
      const sin = Math.sin(m.rot);
      const local = (lx, lz) => ({ x: m.x + lx * cos + lz * sin, z: m.z - lx * sin + lz * cos });
      for (const side of [-1.45, 1.45]) {
        const p = local(side, 0);
        this._place('timber_pillar', p.x, p.z, { uniform: 1.0, uniformY: 3.4, rotY: m.rot });
      }
      const rocks = [
        ['rock_tall_a', 0, -3.0, 2.6], ['rock_large_d', -2.7, -2.0, 1.9], ['rock_tall_h', 2.7, -2.2, 2.0],
        ['rock_large_f', -1.6, -1.0, 1.2], ['rock_large_d', 1.8, -0.9, 1.1], ['rock_tall_a', 0.3, -4.2, 2.3],
        ['rock_tall_h', -1.4, -3.4, 1.8], ['rock_large_f', 1.5, -3.2, 1.7], ['rock_large_d', 0, -1.6, 1.4],
      ];
      for (const [kind, lx, lz, s] of rocks) {
        const p = local(lx, lz);
        this._place(kind, p.x, p.z, { uniform: s, rotY: rand(p.x, p.z) * Math.PI * 2 });
      }
      const ore = local(2.4, 1.4);
      this._place('ore_rocks', ore.x, ore.z, { uniform: 1.4 });
    }

    // ── Stillmere dock (composed) ──────────────────────────────────
    for (const d of P.docks) {
      const cos = Math.cos(d.rot);
      const sin = Math.sin(d.rot);
      const local = (lx, lz) => ({ x: d.x + lx * cos + lz * sin, z: d.z - lx * sin + lz * cos });
      for (let i = 0; i < 3; i++) {
        const p = local(0, -1.05 - i * 2.13);
        this._place('dock_platform', p.x, p.z, { uniform: 2.4, uniformY: 0.6, rotY: d.rot, yOffset: -0.05 - i * 0.12 });
      }
      const hut = local(2.8, 2.4);
      this._place('house_3', hut.x, hut.z, { fit: { w: 3.4, h: 3.0, d: 3.0 }, rotY: d.rot });
      const boat = local(-2.2, -3.4);
      this._place('rowboat', boat.x, boat.z, { uniform: 2.6, rotY: d.rot + 1.2, yOffset: -0.2 });
      const b1 = local(1.6, 0.6);
      this._place('barrel', b1.x, b1.z, { uniform: 0.9 });
      const c1 = local(0.7, 1.4);
      this._place('crate_wooden', c1.x, c1.z, { uniform: 1.0, rotY: 0.6 });
    }
  }

  dispose() {
    this._disposed = true;
    this._roots.forEach((r) => r.dispose(false, true));
    this._roots = [];
    this._containers.forEach((c) => c.dispose());
    this._containers.clear();
  }
}
