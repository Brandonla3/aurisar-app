/**
 * cloudPuffs.test.js — geometry/motion contract, headless (NullEngine). No
 * pixels here (unlit StandardMaterial needs no dual-backend proof the way
 * RealmFnBlock materials do) — what matters is count, placement, wrap, and
 * that visibility genuinely reads the SAME cloudFactorAt the ambient dip does.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { RENDERING_GROUP } from '../materials/skyDomeNME.js';
import { RING_TIERS } from '../../model/horizonRings.js';
import { MIN_FACTOR, MAX_FACTOR } from '../../model/cloudShadow.js';

let buildCloudPuffs, WRAP_RADIUS_M;
let engine;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  ({ buildCloudPuffs, WRAP_RADIUS_M } = await import('./cloudPuffs.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

describe('buildCloudPuffs — geometry', () => {
  it('builds the requested count, all inside the wrap radius, above the tallest ring', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const kit = buildCloudPuffs(scene, { count: 8 });
      expect(kit.meshes).toHaveLength(8);
      const tallestRing = Math.max(...RING_TIERS.map((t) => t.heightM));
      for (const m of kit.meshes) {
        expect(Math.hypot(m.position.x, m.position.z)).toBeLessThanOrEqual(WRAP_RADIUS_M);
        expect(m.position.y).toBeGreaterThan(tallestRing);
      }
      kit.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('WRAP_RADIUS_M is exactly the near ring tier — not an independently hand-picked number', () => {
    expect(WRAP_RADIUS_M).toBe(RING_TIERS[0].radiusM);
  });

  it('disables auto-clear-depth for the CLOUDS group — the same hazard fixed for RINGS', () => {
    // Real bug class this closes, one group further out: every rendering
    // group auto-clears depth/stencil by default except group 0. Without
    // this, clouds (group 2) would render against a freshly-cleared depth
    // buffer, losing what terrain (0) and rings (1) already wrote, and could
    // incorrectly draw over nearer geometry that should occlude them.
    const scene = new BABYLON.Scene(engine);
    try {
      expect(scene.getAutoClearDepthStencilSetup(RENDERING_GROUP.CLOUDS)).toEqual({
        autoClear: true, depth: true, stencil: true,
      }); // the hazard, confirmed, before buildCloudPuffs runs
      const kit = buildCloudPuffs(scene, { count: 2 });
      expect(scene.getAutoClearDepthStencilSetup(RENDERING_GROUP.CLOUDS).autoClear).toBe(false);
      // RINGS and SKY untouched by this call — each fix owns only its group.
      expect(scene.getAutoClearDepthStencilSetup(RENDERING_GROUP.RINGS).autoClear).toBe(true);
      kit.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('claims the CLOUDS rendering group, drawn after both SKY and RINGS', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const kit = buildCloudPuffs(scene, { count: 3 });
      for (const m of kit.meshes) {
        expect(m.renderingGroupId).toBe(RENDERING_GROUP.CLOUDS);
        expect(m.renderingGroupId).toBeGreaterThan(RENDERING_GROUP.RINGS);
      }
      kit.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('is flattened (not a sphere), unpickable, and fogless', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const kit = buildCloudPuffs(scene, { count: 3 });
      for (const m of kit.meshes) {
        expect(m.scaling.y).toBeLessThan(1);
        expect(m.isPickable).toBe(false);
        expect(m.applyFog).toBe(false);
      }
      kit.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('placement is deterministic across builds', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const a = buildCloudPuffs(scene, { count: 6 });
      const b = buildCloudPuffs(scene, { count: 6 });
      for (let i = 0; i < 6; i++) {
        expect(a.meshes[i].position.x).toBe(b.meshes[i].position.x);
        expect(a.meshes[i].position.z).toBe(b.meshes[i].position.z);
      }
      a.dispose();
      b.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('buildCloudPuffs — update: drift, wrap, and tint', () => {
  it('the first update call moves nothing (no prior timestamp to derive dt from)', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const kit = buildCloudPuffs(scene, { count: 4 });
      const before = kit.meshes.map((m) => [m.position.x, m.position.z]);
      kit.update(0, 0, 1000);
      const after = kit.meshes.map((m) => [m.position.x, m.position.z]);
      expect(after).toEqual(before);
      kit.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('subsequent calls integrate drift by real elapsed time', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const kit = buildCloudPuffs(scene, { count: 4 });
      kit.update(0, 0, 0);
      const p0 = kit.meshes.map((m) => [m.position.x, m.position.z]);
      kit.update(0, 0, 2000); // 2s later
      const p1 = kit.meshes.map((m) => [m.position.x, m.position.z]);
      // At least one puff must have actually moved — all velocities are
      // nonzero by construction (paramsForIndex never yields vx=vz=0).
      const moved = p1.some(([x, z], i) => x !== p0[i][0] || z !== p0[i][1]);
      expect(moved).toBe(true);
    } finally {
      scene.dispose();
    }
  });

  it('wraps to the opposite side of the CURRENT center once it exits the radius, not world origin', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const kit = buildCloudPuffs(scene, { count: 1 });
      const mesh = kit.meshes[0];
      const center = { x: 5000, z: -3000 }; // far from world origin, like a player who has walked
      mesh.position.x = center.x + WRAP_RADIUS_M + 50; // already past the radius from center
      mesh.position.z = center.z;
      kit.update(center.x, center.z, 0); // dt=0 (first call): no drift, only the wrap check applies
      const dist = Math.hypot(mesh.position.x - center.x, mesh.position.z - center.z);
      // Must land COMFORTABLY inside the radius, not just at its edge — a
      // same-distance mirror through center (the earlier, buggy approach)
      // would leave it exactly as far out on the opposite side.
      expect(dist).toBeLessThan(WRAP_RADIUS_M);
      expect(dist).toBeCloseTo(WRAP_RADIUS_M * 0.92, 6);
      // Re-entered on the opposite side: was on the +X side, now on the -X side.
      expect(mesh.position.x).toBeLessThan(center.x);
      kit.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('visibility reads the SAME cloudFactorAt the ambient dip uses, at this puff\'s own offset', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const kit = buildCloudPuffs(scene, { count: 1 });
      const nowMs = 12_345;
      kit.update(0, 0, nowMs);
      // offsetMs is internal, but the visibility formula is public contract:
      // 0.5 + ((MAX_FACTOR - cloudFactorAt(nowMs + offset)) / (MAX_FACTOR -
      // MIN_FACTOR)) * 0.45, for SOME small offset. Reconstruct the implied
      // tint from the observed visibility instead of reaching into internals
      // — and check it spans a REAL range, not the too-narrow one the
      // original (buggy) formula silently capped itself to.
      const impliedOvercastNorm = (kit.meshes[0].visibility - 0.5) / 0.45;
      const impliedTint = MAX_FACTOR - impliedOvercastNorm * (MAX_FACTOR - MIN_FACTOR);
      expect(impliedTint).toBeGreaterThanOrEqual(MIN_FACTOR - 1e-9);
      expect(impliedTint).toBeLessThanOrEqual(MAX_FACTOR + 1e-9);
      // And the visibility itself must actually reach up near the intended
      // ceiling somewhere across a real sweep of time — pins the exact bug
      // (capped at ~0.575) rather than just checking the formula shape.
      let maxSeen = 0;
      for (let t = 0; t < 200_000; t += 3_000) {
        kit.update(0, 0, t);
        maxSeen = Math.max(maxSeen, kit.meshes[0].visibility);
      }
      expect(maxSeen).toBeGreaterThan(0.7);
      kit.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('buildCloudPuffs — dispose', () => {
  it('removes every mesh from the scene and does not throw', () => {
    const scene = new BABYLON.Scene(engine);
    try {
      const kit = buildCloudPuffs(scene, { count: 5 });
      expect(() => kit.dispose()).not.toThrow();
      for (const m of kit.meshes) expect(m.isDisposed()).toBe(true);
    } finally {
      scene.dispose();
    }
  });
});
