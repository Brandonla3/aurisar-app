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
 */

/** Projected-space bounds of one payload from one yaw. */
export function projectedBounds(positions, yawRad) {
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const sx = positions[i] * cos - positions[i + 2] * sin;
    const sy = positions[i + 1];
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
 * horizontally from `yawRad`, within a FIXED projection window `bounds`.
 */
export function rasterizeMask(payload, yawRad, bounds, res = 32) {
  const { positions, indices } = payload;
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  const mask = new Uint8Array(res * res);
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6);

  // Vertex → cell space (continuous coordinates, cell centers at +0.5).
  const toCellX = (sx) => ((sx - bounds.minX) / spanX) * res;
  const toCellY = (sy) => ((sy - bounds.minY) / spanY) * res;
  const px = (vi) => toCellX(positions[vi * 3] * cos - positions[vi * 3 + 2] * sin);
  const py = (vi) => toCellY(positions[vi * 3 + 1]);
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
 * The LOD contract measurement: compare two payloads over `yawCount`
 * evenly-spaced yaws in ONE shared projection window per yaw.
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
    const ba = projectedBounds(payloadA.positions, yaw);
    const bb = projectedBounds(payloadB.positions, yaw);
    const shared = unionBounds(ba, bb);
    const iou = maskIoU(
      rasterizeMask(payloadA, yaw, shared, res),
      rasterizeMask(payloadB, yaw, shared, res),
    );
    sum += iou;
    if (iou < min) min = iou;
    const wa = Math.max(ba.maxX - ba.minX, 1e-6);
    const wb = bb.maxX - bb.minX;
    widthDeltaFrac = Math.max(widthDeltaFrac, Math.abs(wb - wa) / wa);
  }
  return { meanIoU: sum / yawCount, minIoU: min, widthDeltaFrac };
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
