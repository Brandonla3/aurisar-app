/**
 * castleNavBlockers — collect furniture/structure nav blockers for emit
 * and server validation parity with runtime CastleSystem.init().
 *
 * Runs the same interior builder subset that records ctx.navBlockers
 * (dressStructuralRooms → staircases → furniture), without Babylon.
 */

import { INTERIOR_ANCHOR } from './castlePlan.js';
import { createCollector } from './builders/mergeUtil.js';
import { createAllFurniture } from './builders/furniture.js';
import { dressStructuralRooms } from './builders/rooms.js';
import { createAllStaircases } from './builders/staircase.js';

if (!globalThis.BABYLON) {
  const fakeMesh = () => ({
    position: { set() {} },
    rotation: {},
    scaling: {},
    setEnabled() {},
    computeWorldMatrix() {},
    freezeWorldMatrix() {},
    isPickable: true,
    material: null,
  });
  globalThis.BABYLON = {
    MeshBuilder: new Proxy({}, { get: () => () => fakeMesh() }),
    Mesh: { CAP_ALL: 0 },
    Vector3: class Vector3 {
      constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
      static Zero() { return new Vector3(); }
    },
  };
}

/** Run interior builders and return nav blocker rects (interior-local). */
export function collectNavBlockers(anchor = INTERIOR_ANCHOR) {
  const ax = anchor.x, az = anchor.z;
  const ctx = createCollector(null, {});
  dressStructuralRooms(ctx, ax, az);
  createAllStaircases(ctx, ax, az);
  createAllFurniture(ctx, ax, az);
  return ctx.navBlockers;
}

/** Stamp builder blockers into a buildNav() result (matches CastleSystem.init). */
export function stampNavBlockers(nav, blockers = collectNavBlockers(nav.anchor)) {
  for (const b of blockers) nav.blockRect(b.level, b, b.expand);
}
