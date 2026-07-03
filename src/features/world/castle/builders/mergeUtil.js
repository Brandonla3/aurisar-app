/**
 * mergeUtil — draw-call control for the castle.
 *
 * Builders push raw primitive meshes into a Collector with a matKey +
 * groupKey (usually the level). mergeCollector() then MergeMeshes each
 * (groupKey × matKey) bucket into one frozen, unpickable mesh — the whole
 * interior renders in ~15 draw calls per floor instead of thousands.
 *
 * Merging happens in WORLD SPACE: builders bake final positions into the
 * primitives (no parent transforms), matching how MergeMeshes flattens
 * world matrices. The merged meshes get an inert TransformNode parent only
 * for bulk setEnabled().
 */

/* global BABYLON */

export function createCollector(scene, mats) {
  const buckets = new Map(); // `${group}|${matKey}` -> mesh[]
  const dynamic = [];        // meshes excluded from merging (animated later)

  return {
    scene, mats,
    /** Register a primitive for merging under (group, matKey). Primitives
     *  are disabled immediately — thousands of unmerged draw calls must
     *  never hit a render frame during the chunked build (that cost 20+ s
     *  of software-GL frames before this guard). */
    add(mesh, matKey, group = 'g') {
      mesh.material = mats[matKey];
      mesh.setEnabled(false);
      const key = `${group}|${matKey}`;
      let arr = buckets.get(key);
      if (!arr) { arr = []; buckets.set(key, arr); }
      arr.push(mesh);
      return mesh;
    },
    /** Register a mesh kept separate (future animation / special material). */
    addDynamic(mesh, matKey) {
      if (matKey) mesh.material = mats[matKey];
      mesh.isPickable = false;
      dynamic.push(mesh);
      return mesh;
    },
    buckets, dynamic,
  };
}

/**
 * Merge every bucket; parent results under `root`. Returns the merged
 * meshes. `onMerged(mesh, group, matKey)` lets the caller add shadow
 * casters (exterior) or per-level bookkeeping.
 */
export function mergeCollector(collector, root, onMerged = null) {
  const out = [];
  for (const [key, meshes] of collector.buckets) {
    if (!meshes.length) continue;
    const [group, matKey] = key.split('|');
    const material = collector.mats[matKey];
    // disabled meshes never compute world matrices on their own — force it
    // so MergeMeshes bakes the real transforms
    for (const m of meshes) m.computeWorldMatrix(true);
    const merged = meshes.length === 1
      ? meshes[0]
      : BABYLON.Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (!merged) continue;
    merged.setEnabled(true);
    merged.name = `castle_${group}_${matKey}`;
    merged.material = material;
    merged.isPickable = false;
    merged.receiveShadows = false;
    merged.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
    merged.parent = root;
    merged.freezeWorldMatrix();
    onMerged?.(merged, group, matKey);
    out.push(merged);
  }
  for (const d of collector.dynamic) {
    d.parent = root;
    out.push(d);
  }
  collector.buckets.clear();
  collector.dynamic.length = 0;
  return out;
}

/** Axis-aligned box helper — the workhorse primitive. Center + size. */
export function box(scene, name, cx, cy, cz, w, h, d) {
  const b = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  b.position.set(cx, cy, cz);
  return b;
}

/** Box from a rect footprint: top surface at yTop, thickness t. */
export function slabBox(scene, name, rect, yTop, t, ax = 0, az = 0) {
  return box(scene, name,
    (rect.x0 + rect.x1) / 2 + ax, yTop - t / 2, (rect.z0 + rect.z1) / 2 + az,
    rect.x1 - rect.x0, t, rect.z1 - rect.z0);
}

/** Subtract hole rects from base rects (guillotine split, axis-aligned). */
export function rectSubtract(baseRects, holes) {
  let rects = [...baseRects];
  for (const h of holes) {
    const next = [];
    for (const r of rects) {
      if (h.x0 >= r.x1 || h.x1 <= r.x0 || h.z0 >= r.z1 || h.z1 <= r.z0) {
        next.push(r);
        continue;
      }
      const ix0 = Math.max(r.x0, h.x0), ix1 = Math.min(r.x1, h.x1);
      if (r.z0 < h.z0) next.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: h.z0 });      // south strip
      if (r.z1 > h.z1) next.push({ x0: r.x0, z0: h.z1, x1: r.x1, z1: r.z1 });      // north strip
      const zs = Math.max(r.z0, h.z0), ze = Math.min(r.z1, h.z1);
      if (r.x0 < ix0) next.push({ x0: r.x0, z0: zs, x1: ix0, z1: ze });            // west strip
      if (r.x1 > ix1) next.push({ x0: ix1, z0: zs, x1: r.x1, z1: ze });            // east strip
    }
    rects = next;
  }
  return rects.filter((r) => r.x1 - r.x0 > 0.01 && r.z1 - r.z0 > 0.01);
}

/** Cylinder helper. */
export function cyl(scene, name, cx, cy, cz, height, diameter, tessellation = 16) {
  const c = BABYLON.MeshBuilder.CreateCylinder(name, { height, diameter, tessellation }, scene);
  c.position.set(cx, cy, cz);
  return c;
}
