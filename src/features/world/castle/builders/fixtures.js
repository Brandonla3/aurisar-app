/**
 * Light fixtures — the VISUAL half of every light anchor: torch sconces,
 * chandeliers, candelabra, braziers, fireplace surrounds. Flames and coals
 * are emissive quads/spheres (they bloom via the render pipeline); the only
 * real PointLights come from CastleLightPool, which follows the player.
 */

/* global BABYLON */

import { LEVELS } from '../castlePlan.js';
import { box, cyl } from './mergeUtil.js';
import { hash2 } from '../../worldgen/rng.js';

const G = (level) => `L${level}`;

/** Crossed emissive quads — the universal flame. */
function flame(ctx, level, x, y, z, s, matKey = 'flame') {
  for (const rot of [0, Math.PI / 2]) {
    const p = BABYLON.MeshBuilder.CreatePlane(`flame_${level}`, { width: s, height: s * 1.6 }, ctx.scene);
    p.position.set(x, y, z);
    p.rotation.y = rot + hash2(x, z) * 0.8;
    ctx.add(p, matKey, G(level));
  }
}

/** Wall torch: iron bracket + shaft + emissive flame head. */
export function createTorch(ctx, level, x, z, y, ax, az) {
  const wx = x + ax, wz = z + az;
  ctx.add(box(ctx.scene, `torchBr_${level}`, wx, y - 0.32, wz, 0.1, 0.34, 0.1), 'iron', G(level));
  const shaft = cyl(ctx.scene, `torch_${level}`, wx, y - 0.05, wz, 0.55, 0.09, 8);
  shaft.rotation.x = 0.28;
  ctx.add(shaft, 'woodDark', G(level));
  flame(ctx, level, wx, y + 0.32, wz, 0.34);
}

/** Great ring chandelier: gold ring, chains, candles, flames. */
export function createChandelier(ctx, level, x, z, y, ax, az, big = false) {
  const wx = x + ax, wz = z + az;
  const R = big ? 2.1 : 1.35;
  const ring = BABYLON.MeshBuilder.CreateTorus(`chanRing_${level}`, {
    diameter: R * 2, thickness: 0.09, tessellation: 24,
  }, ctx.scene);
  ring.position.set(wx, y, wz);
  ctx.add(ring, 'gold', G(level));
  // chains up to the ceiling (three, slightly splayed)
  const L = LEVELS[level];
  const ceilY = level === 2 && big ? LEVELS[4].y - 0.6 : L.y + L.clear;
  const drop = Math.max(0.8, ceilY - y);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const ch = cyl(ctx.scene, `chanChain_${level}`,
      wx + Math.cos(a) * R * 0.5, y + drop / 2, wz + Math.sin(a) * R * 0.5,
      drop, 0.035, 6);
    ch.rotation.z = Math.cos(a) * (R * 0.5 / drop);
    ch.rotation.x = -Math.sin(a) * (R * 0.5 / drop);
    ctx.add(ch, 'iron', G(level));
  }
  const n = big ? 10 : 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const cxp = wx + Math.cos(a) * R, czp = wz + Math.sin(a) * R;
    ctx.add(cyl(ctx.scene, `chanCandle_${level}`, cxp, y + 0.14, czp, 0.26, 0.07, 6),
      'linen', G(level));
    flame(ctx, level, cxp, y + 0.38, czp, 0.16, 'candleGlow');
  }
}

/** Standing candelabrum / bedside candle cluster. */
export function createCandle(ctx, level, x, z, y, ax, az) {
  const wx = x + ax, wz = z + az;
  const floorY = LEVELS[level].y;
  const stemH = y - floorY - 0.15;
  ctx.add(cyl(ctx.scene, `candStem_${level}`, wx, floorY + stemH / 2, wz, stemH, 0.07, 8), 'gold', G(level));
  ctx.add(box(ctx.scene, `candBase_${level}`, wx, floorY + 0.06, wz, 0.4, 0.12, 0.4), 'gold', G(level));
  for (const [dx, dz] of [[0, 0], [-0.14, 0.08], [0.13, -0.07]]) {
    ctx.add(cyl(ctx.scene, `cand_${level}`, wx + dx, y + 0.1, wz + dz, 0.22, 0.06, 6), 'linen', G(level));
    flame(ctx, level, wx + dx, y + 0.3, wz + dz, 0.13, 'candleGlow');
  }
}

/** Iron brazier bowl with coals + tall flame — guard posts, dungeon. */
export function createBrazier(ctx, level, x, z, ax, az) {
  const wx = x + ax, wz = z + az;
  const floorY = LEVELS[level].y;
  ctx.add(cyl(ctx.scene, `brazBowl_${level}`, wx, floorY + 0.82, wz, 0.35, 0.95, 12), 'iron', G(level));
  for (const a of [0, 2.1, 4.2]) {
    const leg = cyl(ctx.scene, `brazLeg_${level}`,
      wx + Math.cos(a) * 0.3, floorY + 0.4, wz + Math.sin(a) * 0.3, 0.8, 0.07, 6);
    leg.rotation.z = Math.cos(a) * 0.25;
    leg.rotation.x = -Math.sin(a) * 0.25;
    ctx.add(leg, 'iron', G(level));
  }
  const coals = BABYLON.MeshBuilder.CreateSphere(`brazCoal_${level}`, { diameter: 0.7, segments: 6 }, ctx.scene);
  coals.scaling.y = 0.4;
  coals.position.set(wx, floorY + 1.0, wz);
  ctx.add(coals, 'ember', G(level));
  flame(ctx, level, wx, floorY + 1.35, wz, 0.5);
}

/** Fireplace: stone surround, mantel, hearth, ember bed + flame. The anchor
 *  x sits ~0.7 m off the wall face; the surround backs onto the wall. */
export function createFireplace(ctx, level, x, z, ax, az, big = false) {
  const wx = x + ax, wz = z + az;
  const floorY = LEVELS[level].y;
  const W = big ? 3.4 : 2.4, H = big ? 2.6 : 2.0, D = 0.9;
  const matKey = level === 0 ? 'darkStone' : 'stone';
  // side piers + lintel + mantel shelf (opening faces +x, into the room)
  ctx.add(box(ctx.scene, `fpL_${level}`, wx, floorY + H / 2, wz - W / 2 + 0.25, D, H, 0.5), matKey, G(level));
  ctx.add(box(ctx.scene, `fpR_${level}`, wx, floorY + H / 2, wz + W / 2 - 0.25, D, H, 0.5), matKey, G(level));
  ctx.add(box(ctx.scene, `fpTop_${level}`, wx, floorY + H - 0.25, wz, D, 0.5, W), matKey, G(level));
  ctx.add(box(ctx.scene, `fpMantel_${level}`, wx + 0.12, floorY + H + 0.08, wz, D + 0.3, 0.16, W + 0.4), 'marbleDark', G(level));
  ctx.add(box(ctx.scene, `fpBack_${level}`, wx - D / 2 + 0.08, floorY + H / 2, wz, 0.16, H, W - 0.6), 'darkStone', G(level));
  // hearth stone
  ctx.add(box(ctx.scene, `fpHearth_${level}`, wx + D / 2 + 0.25, floorY + 0.045, wz, 0.9, 0.09, W + 0.3), 'marbleDark', G(level));
  // ember bed + fire
  const bed = BABYLON.MeshBuilder.CreateSphere(`fpEmber_${level}`, { diameter: W * 0.42, segments: 6 }, ctx.scene);
  bed.scaling.y = 0.3;
  bed.position.set(wx, floorY + 0.16, wz);
  ctx.add(bed, 'ember', G(level));
  flame(ctx, level, wx, floorY + 0.55, wz, big ? 0.75 : 0.55);
  // log stack beside
  for (let i = 0; i < 3; i++) {
    const lg = cyl(ctx.scene, `fpLog_${level}`, wx + 0.15, floorY + 0.12 + i * 0.16, wz + W / 2 + 0.55, 0.7, 0.15, 7);
    lg.rotation.x = Math.PI / 2;
    ctx.add(lg, 'woodDark', G(level));
  }
}

/** Route every light anchor to its fixture builder. Fireplace anchors sit
 *  against a wall with the opening toward the room center. */
export function createFixturesFromAnchors(ctx, anchors, ax, az) {
  for (const a of anchors) {
    switch (a.kind) {
      case 'torch':      createTorch(ctx, a.level, a.x, a.z, a.y, ax, az); break;
      case 'chandelier': createChandelier(ctx, a.level, a.x, a.z, a.y, ax, az, a.priority >= 4); break;
      case 'candle':     createCandle(ctx, a.level, a.x, a.z, a.y, ax, az); break;
      case 'brazier':    createBrazier(ctx, a.level, a.x, a.z, ax, az); break;
      case 'fireplace':  createFireplace(ctx, a.level, a.x, a.z, ax, az, a.priority >= 3); break;
    }
  }
}
