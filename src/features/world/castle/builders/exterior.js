/**
 * Exterior shell — the castle as seen from the open world: curtain walls,
 * four round corner towers with conical caps, a raised central keep, a
 * gatehouse with twin turrets, battlements, arched glowing windows, banners
 * and gate torches. Purely decorative (the interior is the far-east
 * instance); it conforms to the terrain via worldgen.surfaceY and merges
 * per material into a handful of frozen draw calls.
 */

/* global BABYLON */

import { EXTERIOR } from '../castlePlan.js';
import { box, cyl, archTube } from './mergeUtil.js';
import { hash2 } from '../../worldgen/rng.js';

const EG = 'EXT';           // core shell — always visible
const EG_LOD0 = 'EXT_LOD0'; // detail — hidden beyond LOD distance
export const EXTERIOR_LOD0_MAX_M = 200;

/** Crossed emissive quads (same flame idiom as the interior fixtures). */
function flame(ctx, x, y, z, s) {
  for (const rot of [0, Math.PI / 2]) {
    const p = BABYLON.MeshBuilder.CreatePlane('extFlame', { width: s, height: s * 1.6 }, ctx.scene);
    p.position.set(x, y, z);
    p.rotation.y = rot + hash2(x, z) * 0.9;
    ctx.add(p, 'flame', EG);
  }
}

/** Crenellated parapet along a wall run. */
function battlements(ctx, x0, z0, x1, z1, topY, group = EG_LOD0) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.floor(len / 2.4);
  for (let i = 0; i <= n; i++) {
    const t = i / Math.max(1, n);
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    const m = box(ctx.scene, 'merlon', x, topY + 0.65, z, 1.3, 1.3, 1.3);
    ctx.add(m, 'extStone', group);
  }
}

/** Rows of warm glowing arched windows on a wall face. */
function windowRows(ctx, face, baseY, floors, normal, warmBias = 0.5) {
  const len = Math.hypot(face.x1 - face.x0, face.z1 - face.z0);
  const n = Math.max(2, Math.floor(len / 5.5));
  const nx = normal.x, nz = normal.z;
  const litThreshold = 0.65 - warmBias * 0.35;
  for (let f = 0; f < floors; f++) {
    const y = baseY + 3.4 + f * 6.0;
    for (let i = 0; i < n; i++) {
      const lit = hash2(face.x0 + i * 7.3, y * 1.7 + f) > litThreshold;
      const t = (i + 0.5) / n;
      const x = face.x0 + (face.x1 - face.x0) * t + nx * 0.12;
      const z = face.z0 + (face.z1 - face.z0) * t + nz * 0.12;
      // stone frame
      const fr = box(ctx.scene, 'extWinFrame', x + nx * 0.05, y, z + nz * 0.05,
        Math.abs(nx) > 0.5 ? 0.24 : 1.5, 2.6, Math.abs(nx) > 0.5 ? 1.5 : 0.24);
      ctx.add(fr, 'extStone', EG_LOD0);
      // glass
      const gl = box(ctx.scene, 'extWinGlass', x + nx * 0.14, y, z + nz * 0.14,
        Math.abs(nx) > 0.5 ? 0.06 : 1.1, 2.1, Math.abs(nx) > 0.5 ? 1.1 : 0.06);
      ctx.add(gl, lit ? 'windowGlow' : 'windowCool', EG_LOD0);
      // semicircular arch cap standing in the wall plane
      const arch = archTube(ctx.scene, 'extWinArch', 1.25, 0.15, 10);
      if (Math.abs(nx) > 0.5) arch.rotation.y = Math.PI / 2;
      arch.position.set(x + nx * 0.05, y + 1.3, z + nz * 0.05);
      ctx.add(arch, 'extStone', EG_LOD0);
    }
  }
}

/** Long hanging banner strip on a wall face. */
function banner(ctx, x, y, z, h, matKey, alongX, group = EG_LOD0) {
  const b = box(ctx.scene, 'extBanner', x, y, z, alongX ? 1.3 : 0.1, h, alongX ? 0.1 : 1.3);
  ctx.add(b, matKey, group);
  const rod = box(ctx.scene, 'extBannerRod', x, y + h / 2 + 0.1, z, alongX ? 1.7 : 0.14, 0.12, alongX ? 0.14 : 1.7);
  ctx.add(rod, 'gold', group);
}

/** Early-fall approach dressing: leaf piles + bare branch stubs west of the gate. */
function seasonalApproach(ctx, gx, gz, gateFloor, gateWidth) {
  const pathX = gx - 5.5;
  for (let i = 0; i < 8; i++) {
    const t = (i + 0.5) / 8;
    const px = pathX - t * 14;
    const pz = gz + (hash2(px, gz + i) - 0.5) * 5;
    const py = gateFloor + 0.04;
    const pile = box(ctx.scene, 'leafPile', px, py, pz,
      0.9 + hash2(i, px) * 0.6, 0.08, 0.7 + hash2(px, i) * 0.5);
    ctx.add(pile, hash2(px, pz) > 0.55 ? 'redFabric' : 'linen', EG_LOD0);
    if (i % 3 === 0) {
      for (const rot of [0, 0.9]) {
        const branch = BABYLON.MeshBuilder.CreatePlane('fallBranch', { width: 1.6, height: 2.4 }, ctx.scene);
        branch.position.set(px + 1.2, gateFloor + 1.1, pz + (hash2(i, pz) - 0.5));
        branch.rotation.y = rot + hash2(px, pz) * 0.5;
        ctx.add(branch, 'woodDark', EG_LOD0);
      }
    }
  }
  ctx.add(box(ctx.scene, 'ivy', gx - 0.4, gateFloor + 2.2, gz, 0.15, 3.6, gateWidth + 2.4),
    'linen', EG_LOD0);
}

/**
 * Build the whole shell around EXTERIOR.site on the terrain.
 * @param {object} [opts]
 * @param {number} [opts.warmBias=0.5] 0=noon cool windows, 1=sunset warm glow
 * Returns { gateTorchPositions, baseY }
 */
export function createCastleExterior(ctx, worldgen, opts = {}) {
  const warmBias = opts.warmBias ?? 0.5;
  const E = EXTERIOR;
  const { x: sx, z: sz } = E.site;
  const gy = (x, z) => worldgen.surfaceY(x, z);

  // plinth base: lowest terrain over the footprint − 1.5 (buried skirt)
  let minY = Infinity;
  for (let dx = -E.halfW; dx <= E.halfW; dx += 8) {
    for (let dz = -E.halfD; dz <= E.halfD; dz += 8) {
      minY = Math.min(minY, gy(sx + dx, sz + dz));
    }
  }
  const baseY = minY - 1.5;
  const wallTop = baseY + E.wallH;

  // ── curtain walls (west wall split by the gatehouse) ──
  const W = { x: sx - E.halfW, z0: sz - E.halfD, z1: sz + E.halfD };
  const gateHalf = E.gate.width / 2 + 2.6;
  for (const [z0, z1] of [[W.z0, E.gate.z - gateHalf], [E.gate.z + gateHalf, W.z1]]) {
    if (z1 - z0 < 1) continue;
    ctx.add(box(ctx.scene, 'wallW', W.x, (baseY + wallTop) / 2, (z0 + z1) / 2,
      2.4, wallTop - baseY, z1 - z0), 'extStone', EG);
    battlements(ctx, W.x, z0 + 1, W.x, z1 - 1, wallTop);
  }
  // east / north / south walls
  ctx.add(box(ctx.scene, 'wallE', sx + E.halfW, (baseY + wallTop) / 2, sz,
    2.4, wallTop - baseY, E.halfD * 2), 'extStone', EG);
  battlements(ctx, sx + E.halfW, sz - E.halfD + 1, sx + E.halfW, sz + E.halfD - 1, wallTop);
  for (const s of [-1, 1]) {
    ctx.add(box(ctx.scene, 'wallNS', sx, (baseY + wallTop) / 2, sz + s * E.halfD,
      E.halfW * 2, wallTop - baseY, 2.4), 'extStone', EG);
    battlements(ctx, sx - E.halfW + 1, sz + s * E.halfD, sx + E.halfW - 1, sz + s * E.halfD, wallTop);
  }
  // string course band
  ctx.add(box(ctx.scene, 'course', sx, baseY + E.wallH * 0.55, sz - E.halfD - 0.1, E.halfW * 2 + 0.4, 0.5, 0.3), 'stone', EG);
  ctx.add(box(ctx.scene, 'course', sx, baseY + E.wallH * 0.55, sz + E.halfD + 0.1, E.halfW * 2 + 0.4, 0.5, 0.3), 'stone', EG);

  // windows on all four faces
  const wr = (face, base, floors, normal) =>
    windowRows(ctx, face, base, floors, normal, warmBias);
  wr({ x0: W.x - 1.25, z0: W.z0 + 4, x1: W.x - 1.25, z1: E.gate.z - gateHalf - 1 }, baseY + 4, 4, { x: -1, z: 0 });
  wr({ x0: W.x - 1.25, z0: E.gate.z + gateHalf + 1, x1: W.x - 1.25, z1: W.z1 - 4 }, baseY + 4, 4, { x: -1, z: 0 });
  wr({ x0: sx + E.halfW + 1.25, z0: sz - E.halfD + 4, x1: sx + E.halfW + 1.25, z1: sz + E.halfD - 4 }, baseY + 4, 4, { x: 1, z: 0 });
  wr({ x0: sx - E.halfW + 4, z0: sz - E.halfD - 1.25, x1: sx + E.halfW - 4, z1: sz - E.halfD - 1.25 }, baseY + 4, 4, { x: 0, z: -1 });
  wr({ x0: sx - E.halfW + 4, z0: sz + E.halfD + 1.25, x1: sx + E.halfW - 4, z1: sz + E.halfD + 1.25 }, baseY + 4, 4, { x: 0, z: 1 });

  // ── corner towers with conical caps + pennants ──
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const tx = sx + dx * E.halfW, tz = sz + dz * E.halfD;
    const tTop = baseY + E.towerH;
    ctx.add(cyl(ctx.scene, 'tower', tx, (baseY + tTop) / 2, tz, tTop - baseY, E.towerR * 2, 20), 'extStone', EG);
    // corbelled crown ring + merlons
    ctx.add(cyl(ctx.scene, 'towerCrown', tx, tTop + 0.4, tz, 1.2, E.towerR * 2 + 1.4, 20), 'extStone', EG_LOD0);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.add(box(ctx.scene, 'towerMerlon', tx + Math.cos(a) * (E.towerR + 0.5), tTop + 1.5, tz + Math.sin(a) * (E.towerR + 0.5), 1.0, 1.1, 1.0), 'extStone', EG_LOD0);
    }
    const cone = BABYLON.MeshBuilder.CreateCylinder('towerCap', {
      height: 5.5, diameterBottom: E.towerR * 2 + 1.0, diameterTop: 0.1, tessellation: 20,
    }, ctx.scene);
    cone.position.set(tx, tTop + 3.6, tz);
    ctx.add(cone, 'blueFabric', EG_LOD0);
    ctx.add(cyl(ctx.scene, 'pole', tx, tTop + 7.4, tz, 2.4, 0.1, 6), 'iron', EG_LOD0);
    ctx.add(box(ctx.scene, 'pennant', tx + 0.65, tTop + 8.3, tz, 1.2, 0.5, 0.05), 'redFabric', EG_LOD0);
    for (let f = 0; f < 4; f++) {
      const a = Math.atan2(sz - tz, sx - tx) + Math.PI;
      ctx.add(box(ctx.scene, 'slit', tx + Math.cos(a) * E.towerR, baseY + 5 + f * 6.5, tz + Math.sin(a) * E.towerR, 0.25, 1.6, 0.55), 'iron', EG_LOD0);
    }
    const lit = hash2(tx, tz) > (0.5 - warmBias * 0.25);
    ctx.add(box(ctx.scene, 'towerWin', tx + Math.cos(0.7 + dx) * E.towerR, tTop - 3, tz + Math.sin(0.7 + dx) * E.towerR, 0.9, 1.6, 0.9), lit ? 'windowGlow' : 'windowCool', EG_LOD0);
  }

  // ── central keep (reads as the 4-storey heart of the fortress) ──
  const K = E.keep;
  const kTop = baseY + K.h;
  ctx.add(box(ctx.scene, 'keep', sx + 4, (baseY + kTop) / 2, sz, K.halfW * 2, kTop - baseY, K.halfD * 2), 'extStone', EG);
  battlements(ctx, sx + 4 - K.halfW + 1, sz - K.halfD, sx + 4 + K.halfW - 1, sz - K.halfD, kTop);
  battlements(ctx, sx + 4 - K.halfW + 1, sz + K.halfD, sx + 4 + K.halfW - 1, sz + K.halfD, kTop);
  battlements(ctx, sx + 4 - K.halfW, sz - K.halfD + 1, sx + 4 - K.halfW, sz + K.halfD - 1, kTop);
  battlements(ctx, sx + 4 + K.halfW, sz - K.halfD + 1, sx + 4 + K.halfW, sz + K.halfD - 1, kTop);
  wr({ x0: sx + 4 - K.halfW + 3, z0: sz - K.halfD - 1.15, x1: sx + 4 + K.halfW - 3, z1: sz - K.halfD - 1.15 }, baseY + 8, 4, { x: 0, z: -1 });
  wr({ x0: sx + 4 - K.halfW + 3, z0: sz + K.halfD + 1.15, x1: sx + 4 + K.halfW - 3, z1: sz + K.halfD + 1.15 }, baseY + 8, 4, { x: 0, z: 1 });
  ctx.add(box(ctx.scene, 'keepRidge', sx + 4, kTop + 1.6, sz, K.halfW * 1.2, 3.2, K.halfD * 0.9), 'darkStone', EG_LOD0);
  banner(ctx, sx + 4 - K.halfW - 0.15, baseY + K.h * 0.62, sz, 9, 'redFabric', false);

  // ── gatehouse: twin turrets + arch + portcullis + doors ──
  const gx = W.x, gz = E.gate.z;
  const gTop = baseY + E.wallH + 4;
  for (const s of [-1, 1]) {
    const tz = gz + s * (E.gate.width / 2 + 1.6);
    ctx.add(cyl(ctx.scene, 'gateTurret', gx, (baseY + gTop) / 2, tz, gTop - baseY, 5.2, 16), 'extStone', EG);
    ctx.add(cyl(ctx.scene, 'gateTurretCrown', gx, gTop + 0.4, tz, 1.1, 6.4, 16), 'extStone', EG_LOD0);
    const cone = BABYLON.MeshBuilder.CreateCylinder('gateCap', {
      height: 3.6, diameterBottom: 6.0, diameterTop: 0.1, tessellation: 16,
    }, ctx.scene);
    cone.position.set(gx, gTop + 2.5, tz);
    ctx.add(cone, 'blueFabric', EG_LOD0);
  }
  const gateFloor = gy(gx - 2, gz);
  ctx.add(box(ctx.scene, 'gateLintel', gx, gateFloor + E.gate.height + 1.2, gz, 3.0, 2.4, E.gate.width + 3.2), 'extStone', EG);
  const gArch = archTube(ctx.scene, 'gateArch', E.gate.width + 1.4, 0.7, 20);
  gArch.rotation.y = Math.PI / 2;
  gArch.position.set(gx - 1.3, gateFloor + E.gate.height - 0.3, gz);
  ctx.add(gArch, 'stone', EG_LOD0);
  // the great double doors (closed — entry is the press-E teleport)
  for (const s of [-1, 1]) {
    const leaf = box(ctx.scene, 'gateDoor', gx - 1.15, gateFloor + E.gate.height / 2, gz + s * E.gate.width / 4,
      0.45, E.gate.height, E.gate.width / 2 - 0.1);
    ctx.add(leaf, 'woodDark', EG);
    // iron banding + studs
    for (const by of [0.25, 0.55, 0.85]) {
      ctx.add(box(ctx.scene, 'gateBand', gx - 1.42, gateFloor + E.gate.height * by, gz + s * E.gate.width / 4,
        0.08, 0.22, E.gate.width / 2 - 0.2), 'iron', EG);
    }
  }
  // portcullis teeth above the arch
  for (let i = 0; i < 7; i++) {
    ctx.add(box(ctx.scene, 'portc', gx - 1.8, gateFloor + E.gate.height + 0.35, gz - E.gate.width / 2 + 0.5 + i * (E.gate.width - 1) / 6, 0.18, 1.3, 0.18), 'iron', EG_LOD0);
  }
  // heraldic banners flanking the gate + torch sconces
  banner(ctx, gx - 1.3, gateFloor + E.gate.height + 4.6, gz - E.gate.width / 2 - 1.9, 5.2, 'redFabric', false);
  banner(ctx, gx - 1.3, gateFloor + E.gate.height + 4.6, gz + E.gate.width / 2 + 1.9, 5.2, 'blueFabric', false);

  const gateTorchPositions = [];
  for (const s of [-1, 1]) {
    const tx = gx - 1.6, tz = gz + s * (E.gate.width / 2 + 1.1);
    const ty = gateFloor + 2.6;
    ctx.add(box(ctx.scene, 'gTorchBr', tx, ty - 0.3, tz, 0.12, 0.35, 0.12), 'iron', EG);
    const sh = cyl(ctx.scene, 'gTorch', tx - 0.12, ty, tz, 0.6, 0.1, 8);
    sh.rotation.z = -0.3;
    ctx.add(sh, 'woodDark', EG);
    flame(ctx, tx - 0.22, ty + 0.42, tz, 0.4);
    gateTorchPositions.push(new BABYLON.Vector3(tx - 0.22, ty + 0.5, tz));
  }

  // approach: torch-lined path stubs + a worn threshold slab
  ctx.add(box(ctx.scene, 'threshold', gx - 3.2, gateFloor + 0.06, gz, 4.5, 0.12, E.gate.width + 2), 'darkStone', EG);
  seasonalApproach(ctx, gx, gz, gateFloor, E.gate.width);

  return { gateTorchPositions, baseY };
}
