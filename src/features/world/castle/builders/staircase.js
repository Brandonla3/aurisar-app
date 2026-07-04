/**
 * Grand staircases — step meshes, railings and shaft-edge balustrades on the
 * upper floor. Step heights sample stairSurfaceY — the SAME function the nav
 * grid uses — so what you see is what you walk.
 */

/* global BABYLON */

import { LEVELS, STAIRS, stairRects, stairSurfaceY } from '../castlePlan.js';
import { box, cyl } from './mergeUtil.js';

const STEP_RISE_TARGET = 0.19;

const G = (level) => `L${level}`;

export function createGrandStaircase(ctx, st, ax, az) {
  const yLo = LEVELS[st.lo].y, yHi = LEVELS[st.hi].y;
  const halfRise = (yHi - yLo) / 2;
  const grand = st.laneW > 2.5;
  const stoneMat = st.lo === 0 ? 'darkStone' : (grand ? 'marble' : 'stone');
  const railMat = grand ? 'marbleDark' : 'iron';
  const { laneA, laneB, landing, footprint } = stairRects(st);
  const group = G(st.lo);

  // ── steps per lane: sample the shared ramp at each step center ──
  const nSteps = Math.max(4, Math.round(halfRise / STEP_RISE_TARGET));
  const du = st.runLen / nSteps;
  for (const [lane, rect] of [['A', laneA], ['B', laneB]]) {
    for (let i = 0; i < nSteps; i++) {
      const u = st.u0 + (i + 0.5) * du;
      const vMid = st.axis === 'z' ? (rect.x0 + rect.x1) / 2 : (rect.z0 + rect.z1) / 2;
      const p = st.axis === 'z' ? { x: vMid, z: u } : { x: u, z: vMid };
      const y = stairSurfaceY(st, p.x, p.z);
      // solid riser from a shared base keeps the stair visually massive
      const h = Math.max(0.24, y - yLo + 0.12);
      const m = st.axis === 'z'
        ? box(ctx.scene, `step_${st.id}_${lane}${i}`, p.x + ax, y - h / 2, p.z + az,
          rect.x1 - rect.x0, h, du + 0.02)
        : box(ctx.scene, `step_${st.id}_${lane}${i}`, p.x + ax, y - h / 2, p.z + az,
          du + 0.02, h, rect.z1 - rect.z0);
      ctx.add(m, stoneMat, group);
    }
  }
  // ── landing platform ──
  const lm = box(ctx.scene, `landing_${st.id}`,
    (landing.x0 + landing.x1) / 2 + ax, yLo + halfRise - 0.35,
    (landing.z0 + landing.z1) / 2 + az,
    landing.x1 - landing.x0, 0.7 + halfRise * 0.12, landing.z1 - landing.z0);
  ctx.add(lm, stoneMat, group);

  // ── center spine wall between the lanes (fills the railing gap) ──
  const gapMid = st.v0 + st.laneW + st.gap / 2;
  const spine = st.axis === 'z'
    ? box(ctx.scene, `spine_${st.id}`, gapMid + ax, yLo + halfRise / 2 + 0.55,
      st.u0 + st.runLen / 2 + az, st.gap, halfRise + 1.1, st.runLen)
    : box(ctx.scene, `spine_${st.id}`, st.u0 + st.runLen / 2 + ax,
      yLo + halfRise / 2 + 0.55, gapMid + az, st.runLen, halfRise + 1.1, st.gap);
  ctx.add(spine, stoneMat, group);
  // rail cap on the spine
  const cap = st.axis === 'z'
    ? box(ctx.scene, `spineCap_${st.id}`, gapMid + ax, yLo + halfRise + 1.14,
      st.u0 + st.runLen / 2 + az, st.gap + 0.1, 0.08, st.runLen)
    : box(ctx.scene, `spineCap_${st.id}`, st.u0 + st.runLen / 2 + ax,
      yLo + halfRise + 1.14, gapMid + az, st.runLen, 0.08, st.gap + 0.1);
  ctx.add(cap, grand ? 'gold' : 'iron', group);

  // ── outer railings along both lanes (posts follow the ramp) ──
  for (const [rect, outerSign] of [[laneA, -1], [laneB, +1]]) {
    const vOuter = st.axis === 'z'
      ? (outerSign < 0 ? rect.x0 + 0.08 : rect.x1 - 0.08)
      : (outerSign < 0 ? rect.z0 + 0.08 : rect.z1 - 0.08);
    const nPosts = Math.max(3, Math.round(st.runLen / 1.2));
    for (let i = 0; i <= nPosts; i++) {
      const u = st.u0 + (i / nPosts) * st.runLen;
      const p = st.axis === 'z' ? { x: vOuter, z: u } : { x: u, z: vOuter };
      const y = stairSurfaceY(st, p.x, p.z);
      if (y == null) continue;
      ctx.add(cyl(ctx.scene, `sPost_${st.id}`, p.x + ax, y + 0.5, p.z + az, 1.0, 0.09, 8),
        railMat, group);
    }
    // sloped handrail (thin box, rotated to the ramp pitch)
    const pitch = Math.atan2(halfRise, st.runLen);
    const railLen = Math.hypot(halfRise, st.runLen);
    const uMid = st.u0 + st.runLen / 2;
    const laneIsA = rect === laneA;
    const yMidRail = (laneIsA ? yLo + halfRise / 2 : yHi - halfRise / 2) + 1.0;
    const rail = box(ctx.scene, `sRail_${st.id}`,
      st.axis === 'z' ? vOuter + ax : uMid + ax,
      yMidRail,
      st.axis === 'z' ? uMid + az : vOuter + az,
      st.axis === 'z' ? 0.09 : railLen,
      0.1,
      st.axis === 'z' ? railLen : 0.09);
    // lane A rises with +u; lane B descends with +u
    const sign = laneIsA ? 1 : -1;
    if (st.axis === 'z') rail.rotation.x = -sign * pitch;
    else rail.rotation.z = sign * pitch;
    ctx.add(rail, grand ? 'gold' : 'iron', group);
  }

  // ── landing outer balustrade ──
  {
    const uEdge = st.u0 + st.runLen + st.landingD - 0.1;
    const vMid = st.v0 + st.laneW + st.gap / 2;
    const width = 2 * st.laneW + st.gap;
    const railY = yLo + halfRise;
    const m = st.axis === 'z'
      ? box(ctx.scene, `landRail_${st.id}`, vMid + ax, railY + 1.0, uEdge + az, width, 0.12, 0.14)
      : box(ctx.scene, `landRail_${st.id}`, uEdge + ax, railY + 1.0, vMid + az, 0.14, 0.12, width);
    ctx.add(m, grand ? 'gold' : 'iron', group);
    const nP = Math.max(2, Math.round(width / 1.1));
    for (let i = 0; i <= nP; i++) {
      const v = st.v0 + (i / nP) * width;
      const p = st.axis === 'z' ? { x: v, z: uEdge } : { x: uEdge, z: v };
      ctx.add(cyl(ctx.scene, `landPost_${st.id}`, p.x + ax, railY + 0.5, p.z + az, 1.0, 0.09, 8),
        railMat, group);
    }
  }

  // ── shaft-edge balustrade on the UPPER floor (the arrival edge over
  //    lane B stays open) ──
  const fp = footprint;
  const upper = G(st.hi);
  const yU = yHi;
  const edges = [];
  if (st.axis === 'z') {
    edges.push({ axis: 'x', at: fp.x0 - 0.1, lo: fp.z0, hi: fp.z1 });   // west
    edges.push({ axis: 'x', at: fp.x1 + 0.1, lo: fp.z0, hi: fp.z1 });   // east
    edges.push({ axis: 'z', at: fp.z1 + 0.1, lo: fp.x0, hi: fp.x1 });   // far end
    // near end (u0): open only over lane B; rail over lane A + gap
    edges.push({ axis: 'z', at: fp.z0 - 0.1, lo: laneA.x0, hi: laneA.x1 + st.gap });
  } else {
    edges.push({ axis: 'z', at: fp.z0 - 0.1, lo: fp.x0, hi: fp.x1 });
    edges.push({ axis: 'z', at: fp.z1 + 0.1, lo: fp.x0, hi: fp.x1 });
    edges.push({ axis: 'x', at: fp.x1 + 0.1, lo: fp.z0, hi: fp.z1 });
    edges.push({ axis: 'x', at: fp.x0 - 0.1, lo: laneA.z0, hi: laneA.z1 + st.gap });
  }
  for (const e of edges) {
    const len = e.hi - e.lo;
    const m = e.axis === 'x'
      ? box(ctx.scene, `shaftRail_${st.id}`, e.at + ax, yU + 1.0, (e.lo + e.hi) / 2 + az, 0.14, 0.12, len)
      : box(ctx.scene, `shaftRail_${st.id}`, (e.lo + e.hi) / 2 + ax, yU + 1.0, e.at + az, len, 0.12, 0.14);
    ctx.add(m, grand ? 'gold' : 'iron', upper);
    const nP = Math.max(2, Math.round(len / 1.1));
    for (let i = 0; i <= nP; i++) {
      const v = e.lo + (i / nP) * len;
      const p = e.axis === 'x' ? { x: e.at, z: v } : { x: v, z: e.at };
      ctx.add(cyl(ctx.scene, `shaftPost_${st.id}`, p.x + ax, yU + 0.5, p.z + az, 1.0, 0.09, 8),
        railMat, upper);
    }
  }
}

export function createAllStaircases(ctx, ax, az) {
  for (const st of STAIRS) createGrandStaircase(ctx, st, ax, az);
}
