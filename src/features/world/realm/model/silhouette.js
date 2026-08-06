/**
 * silhouette — LOD-contract math: do two meshes read as the SAME shape?
 *
 * PURE. The developmental-LOD design (gen/propGen.js) claims a truncated
 * growth stage is a valid distant LOD of its adult form. That claim is
 * exactly measurable: project both stages to 2D from several yaw angles,
 * rasterize occupancy masks, and compare. High intersection-over-union
 * means the swap at LOD distance moves almost no silhouette pixels — which
 * is the entire definition of "no pop". This turns LOD quality from an
 * eyeballed playtest complaint into a CI assertion, the same move
 * boundary.test.js made for the engine-import rule.
 *
 * Rasterization detail that matters: masks are FILLED triangle interiors
 * (point-in-triangle per covered cell), never vertex splats or edge
 * samples. The first version of this file sampled edges and was a
 * wireframe comparator wearing a silhouette comparator's name — an 80-face
 * and an 8-face sphere with near-identical OUTLINES scored IoU 0.06,
 * because their interior edge patterns share almost nothing. Silhouette
 * means the filled shadow shape; only filling measures it.
 *
 * Comparisons share ONE projection window (the union of both payloads'
 * bounds). Normalizing each mesh to its own bounds would silently erase
 * envelope mismatch — a half-width crown would still score IoU 1 — and
 * envelope mismatch is precisely the pop this exists to catch.
 *
 * Pitch (added for actor archetypes; props never needed it — trees are
 * always eyeballed level). `pitchRad` tilts the view before projecting: the
 * world-Y axis mixes with depth exactly the way a chase camera looking
 * down at a character would see it. At `pitchRad = 0` the tilt term is
 * multiplied by `sin(0) === 0` exactly, so every existing caller (props,
 * all of which default it) gets the untilted math back BIT-IDENTICAL —
 * this file has no code path that behaves differently for "pitch omitted"
 * vs "pitch passed as 0".
 *
 * Fixed windows (`ACTOR_WINDOW`, `canonicalStats`, `fitsWindow`) exist
 * because actor comparisons are a ROSTER problem, not a pairwise one: later
 * tasks measure whether four archetypes are mutually distinguishable, which
 * means comparing every pair against a common yardstick. `silhouetteStats`'s
 * per-pair union window is right for a single LOD-vs-LOD check but makes
 * Jaccard distance fail the triangle inequality across different pairs (the
 * window itself changes per pair), so roster-wide reasoning ("is A closer
 * to B than to C?") stops being valid. A single fixed window fixes that,
 * at the cost of a new failure mode a union window can't have: the window
 * can clip. `fitsWindow` exists to catch that silently-wrong case before it
 * poisons a measurement — a clipped mask still rasterizes and still reports
 * a number, it is just a smaller-than-real one.
 *
 * `bandOccupancy` supports the same roster work at a finer grain than
 * whole-silhouette IoU: which vertical band (legs / torso / head-ish) holds
 * how much of the shape. It is defined at pitch 0 only — see the function
 * doc for why pitch breaks the row-maps-to-world-Y guarantee it depends on.
 */

/** Projected-space bounds of one payload from one yaw (and optional pitch). */
export function projectedBounds(positions, yawRad, pitchRad = 0) {
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);
  const cosPitch = Math.cos(pitchRad);
  const sinPitch = Math.sin(pitchRad);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const sx = x * cosYaw - z * sinYaw;
    // Depth along the view ray post-yaw. At pitchRad = 0, sinPitch is
    // exactly 0, so this term is multiplied away and sy reduces to y.
    const depth = x * sinYaw + z * cosYaw;
    const sy = y * cosPitch - depth * sinPitch;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  return { minX, maxX, minY, maxY };
}

const unionBounds = (a, b) => ({
  minX: Math.min(a.minX, b.minX),
  maxX: Math.max(a.maxX, b.maxX),
  minY: Math.min(a.minY, b.minY),
  maxY: Math.max(a.maxY, b.maxY),
});

/**
 * Rasterize a payload's silhouette into a res*res Uint8 mask, viewed
 * horizontally from `yawRad` (and optionally tilted by `pitchRad`), within
 * a FIXED projection window `bounds`.
 */
export function rasterizeMask(payload, yawRad, bounds, res = 32, pitchRad = 0) {
  const { positions, indices } = payload;
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);
  const cosPitch = Math.cos(pitchRad);
  const sinPitch = Math.sin(pitchRad);
  const mask = new Uint8Array(res * res);
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6);

  // Vertex → cell space (continuous coordinates, cell centers at +0.5).
  const toCellX = (sx) => ((sx - bounds.minX) / spanX) * res;
  const toCellY = (sy) => ((sy - bounds.minY) / spanY) * res;
  const px = (vi) => toCellX(positions[vi * 3] * cosYaw - positions[vi * 3 + 2] * sinYaw);
  const py = (vi) => {
    const depth = positions[vi * 3] * sinYaw + positions[vi * 3 + 2] * cosYaw;
    return toCellY(positions[vi * 3 + 1] * cosPitch - depth * sinPitch);
  };
  const clampCell = (v) => Math.min(res - 1, Math.max(0, v));

  for (let t = 0; t < indices.length; t += 3) {
    const ax = px(indices[t]); const ay = py(indices[t]);
    const bx = px(indices[t + 1]); const by = py(indices[t + 1]);
    const cx = px(indices[t + 2]); const cy = py(indices[t + 2]);

    const minCx = clampCell(Math.floor(Math.min(ax, bx, cx)));
    const maxCx = clampCell(Math.ceil(Math.max(ax, bx, cx)));
    const minCy = clampCell(Math.floor(Math.min(ay, by, cy)));
    const maxCy = clampCell(Math.ceil(Math.max(ay, by, cy)));

    // Signed-area barycentric fill over the bbox, orientation-agnostic.
    // Vertex cells are splatted ONLY for degenerate triangles: the first
    // version splatted every triangle's vertices unconditionally, which
    // marked cells whose CENTERS lie outside the shape and inflated every
    // mask by ~a boundary cell — IoU and silhouetteM2 both read slightly
    // high (caught in PR review; relevant because one prototype passed its
    // gate by 1.5%). The fill rule alone is the honest measurement.
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) {
      mask[clampCell(Math.floor(ay)) * res + clampCell(Math.floor(ax))] = 1;
      mask[clampCell(Math.floor(by)) * res + clampCell(Math.floor(bx))] = 1;
      mask[clampCell(Math.floor(cy)) * res + clampCell(Math.floor(cx))] = 1;
      continue;
    }
    for (let gy = minCy; gy <= maxCy; gy++) {
      const sy = gy + 0.5;
      for (let gx = minCx; gx <= maxCx; gx++) {
        const sx = gx + 0.5;
        const w0 = ((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) / area;
        const w1 = ((cx - bx) * (sy - by) - (cy - by) * (sx - bx)) / area;
        const w2 = ((ax - cx) * (sy - cy) - (ay - cy) * (sx - cx)) / area;
        if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) mask[gy * res + gx] = 1;
      }
    }
  }
  return mask;
}

/** Intersection-over-union of two same-sized binary masks. Empty pair → 1. */
export function maskIoU(a, b) {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai & bi) inter++;
    if (ai | bi) union++;
  }
  return union === 0 ? 1 : inter / union;
}

/**
 * One yaw's worth of comparison, shared by silhouetteStats (per-pair union
 * window) and canonicalStats (caller-fixed window) — the only difference
 * between the two callers is which window `resolveWindow` hands back and
 * which fields of the result they keep. Both payloads' OWN bounds are
 * always computed (not just the resolved window) because silhouetteStats
 * needs them for widthDeltaFrac; canonicalStats simply ignores them.
 */
function compareAtYaw(payloadA, payloadB, yaw, resolveWindow, res, pitchRad) {
  const boundsA = projectedBounds(payloadA.positions, yaw, pitchRad);
  const boundsB = projectedBounds(payloadB.positions, yaw, pitchRad);
  const window = resolveWindow(boundsA, boundsB);
  const iou = maskIoU(
    rasterizeMask(payloadA, yaw, window, res, pitchRad),
    rasterizeMask(payloadB, yaw, window, res, pitchRad),
  );
  return { iou, boundsA, boundsB };
}

/**
 * The LOD contract measurement: compare two payloads over `yawCount`
 * evenly-spaced yaws, each in its OWN shared (per-pair union) window.
 * Untilted (pitchRad is not exposed here — see file header) because every
 * existing prop caller relies on this exact behaviour staying frozen.
 *
 * @returns {{meanIoU, minIoU, widthDeltaFrac}} widthDeltaFrac is the max
 *   over yaws of |width(b) - width(a)| / width(a) — the crown-width pop.
 */
export function silhouetteStats(payloadA, payloadB, { yawCount = 8, res = 32 } = {}) {
  let sum = 0;
  let min = Infinity;
  let widthDeltaFrac = 0;
  for (let y = 0; y < yawCount; y++) {
    const yaw = (y / yawCount) * Math.PI * 2;
    const { iou, boundsA, boundsB } = compareAtYaw(payloadA, payloadB, yaw, unionBounds, res, 0);
    sum += iou;
    if (iou < min) min = iou;
    const wa = Math.max(boundsA.maxX - boundsA.minX, 1e-6);
    const wb = boundsB.maxX - boundsB.minX;
    widthDeltaFrac = Math.max(widthDeltaFrac, Math.abs(wb - wa) / wa);
  }
  return { meanIoU: sum / yawCount, minIoU: min, widthDeltaFrac };
}

/**
 * The same per-yaw comparison as silhouetteStats, but scored against a
 * caller-supplied FIXED `bounds` instead of each pair's own union — see the
 * file header for why a roster of actors needs a common yardstick. Pair it
 * with `fitsWindow` on both payloads first: a window that clips silently
 * under-reports IoU instead of failing loudly.
 *
 * @returns {{meanIoU, minIoU}} no widthDeltaFrac — width delta is only a
 *   meaningful "pop" measure against a per-pair union window.
 */
export function canonicalStats(payloadA, payloadB, {
  bounds, yawCount = 8, res = 48, pitchRad = 0,
} = {}) {
  let sum = 0;
  let min = Infinity;
  for (let y = 0; y < yawCount; y++) {
    const yaw = (y / yawCount) * Math.PI * 2;
    const { iou } = compareAtYaw(payloadA, payloadB, yaw, () => bounds, res, pitchRad);
    sum += iou;
    if (iou < min) min = iou;
  }
  return { meanIoU: sum / yawCount, minIoU: min };
}

/**
 * Canonical fixed projection window for actors. A fixed window (rather than
 * silhouetteStats's per-pair union) is what makes Jaccard distance a true
 * metric, so roster comparisons compose — see the file header. It must be
 * snug: an over-generous window wastes mask resolution and degrades the
 * measurement. Derivation:
 *  - X half-span 1.15: the widest archetype (`unbound`'s hypertrophied arm
 *    plus its fist mass) reaches ≈1.06 in projection, and under yaw |sx|
 *    approaches sqrt(x² + z²) — the span has to clear the diagonal case too.
 *  - maxY 2.45 clears the tallest spine (≈2.25 m).
 *  - minY -0.45 clears the depth term at GATE_PITCH_RAD
 *    (-|d|·sin(p) ≈ -0.27) below the ground the actor stands on.
 * At res = 48 this gives ≈4.8cm cells: an actor reads ≈12-19 cells wide
 * and ≈38 tall.
 */
export const ACTOR_WINDOW = Object.freeze({
  minX: -1.15, maxX: 1.15, minY: -0.45, maxY: 2.45,
});

/**
 * Does this payload sit strictly inside `bounds` at every sampled yaw? A
 * fixed window that clips is a SILENT measurement failure — the rasterizer
 * does not error, it just quietly bins geometry outside the window into
 * nothing and reports an IoU that looks fine. This is the guard: run it on
 * every payload before trusting a canonicalStats/bandOccupancy result.
 *
 * @returns {{fits: boolean, worstMarginFrac: number}} worstMarginFrac is
 *   the smallest per-side, per-yaw clearance as a fraction of that axis's
 *   window span — negative means clipped, and by how much.
 */
export function fitsWindow(payload, { bounds, yawCount = 8, pitchRad = 0 } = {}) {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6);
  let worstMarginFrac = Infinity;
  for (let y = 0; y < yawCount; y++) {
    const yaw = (y / yawCount) * Math.PI * 2;
    const b = projectedBounds(payload.positions, yaw, pitchRad);
    const margins = [
      (b.minX - bounds.minX) / spanX,
      (bounds.maxX - b.maxX) / spanX,
      (b.minY - bounds.minY) / spanY,
      (bounds.maxY - b.maxY) / spanY,
    ];
    for (const m of margins) if (m < worstMarginFrac) worstMarginFrac = m;
  }
  return { fits: worstMarginFrac > 0, worstMarginFrac };
}

/**
 * Fraction of a payload's filled silhouette cells that fall in each
 * vertical world-Y band, averaged over `yawCount` yaws (so the returned
 * array always sums to ~1). Bands are `bandEdgesY` (interior boundaries
 * only, ascending) plus the window's own minY/maxY as the implicit outer
 * edges — e.g. `[WAIST_Y, SHOULDER_Y]` yields 3 bands: legs, torso, head.
 *
 * Defined at pitch 0 ONLY, and does not accept a pitchRad — this is
 * deliberate, not an oversight. With a horizontal eye and a fixed window,
 * mask row index maps LINEARLY to world Y, so a band edge in world-Y
 * converts exactly to a row index once. Under pitch, a mask row mixes Y and
 * depth (see projectedBounds), so the same row no longer corresponds to one
 * world-Y value across the mask's width and the metric would be quietly
 * measuring the wrong thing while still returning plausible-looking numbers.
 */
export function bandOccupancy(payload, {
  bounds, bandEdgesY, yawCount = 8, res = 48,
} = {}) {
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const rowForY = (y) => Math.min(res - 1, Math.max(0, Math.floor(((y - bounds.minY) / spanY) * res)));
  const edgeRows = bandEdgesY.map(rowForY);
  const bandCount = edgeRows.length + 1;
  const bandOf = (row) => {
    let band = 0;
    while (band < edgeRows.length && row >= edgeRows[band]) band++;
    return band;
  };

  const totals = new Array(bandCount).fill(0);
  for (let y = 0; y < yawCount; y++) {
    const yaw = (y / yawCount) * Math.PI * 2;
    const mask = rasterizeMask(payload, yaw, bounds, res);
    const bandFilled = new Array(bandCount).fill(0);
    let totalFilled = 0;
    for (let row = 0; row < res; row++) {
      const base = row * res;
      let rowFilled = 0;
      for (let col = 0; col < res; col++) rowFilled += mask[base + col];
      bandFilled[bandOf(row)] += rowFilled;
      totalFilled += rowFilled;
    }
    if (totalFilled === 0) continue; // nothing to attribute this yaw
    for (let b = 0; b < bandCount; b++) totals[b] += bandFilled[b] / totalFilled;
  }
  return totals.map((t) => t / yawCount);
}

/**
 * Average projected silhouette area in m², over `yawCount` yaws — the
 * `silhouetteM2` a prototype declares in its cost manifest, used by the
 * budget census to bill fill-rate analytically. Mask-fraction times the
 * projection window's real area, from filled-triangle masks.
 */
export function silhouetteAreaM2(payload, { yawCount = 8, res = 32 } = {}) {
  let sum = 0;
  for (let y = 0; y < yawCount; y++) {
    const yaw = (y / yawCount) * Math.PI * 2;
    const b = projectedBounds(payload.positions, yaw);
    const mask = rasterizeMask(payload, yaw, b, res);
    let filled = 0;
    for (let i = 0; i < mask.length; i++) filled += mask[i];
    sum += (filled / mask.length) * (b.maxX - b.minX) * (b.maxY - b.minY);
  }
  return sum / yawCount;
}
