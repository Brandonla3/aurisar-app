/**
 * propFootprints — the single authored source of every prop's ground footprint.
 *
 * Before this, a prop's size lived as a bare `fit`/`uniform` literal inside
 * `PropsSystem._placeAll()`, and only the `buildings` bucket carried authored
 * `w`/`d` in content data. That is exactly the drift shape Batch D spent a
 * whole batch removing for positions: bump a stall's art from 3.1 m to 4.0 m
 * and a separately-maintained collider would silently leave 0.45 m of solid
 * stall you can walk through on each side, with nothing failing.
 *
 * So the geometry lives here, once, and every consumer derives from it:
 *   • PropsSystem  — how big to scale the GLB
 *   • propColliders — what the player collides with
 *   • scripts/render_world_plan.mjs — what the plan view draws
 *
 * Conventions:
 *   • `fit: [w, h, d]`  — exact per-axis size in metres; footprint is w × d.
 *   • `uniform: n`      — n is the target size of the LARGER xz extent only, so
 *                         the true footprint depends on the GLB's aspect. For
 *                         collision we take the conservative circle r = n/2
 *                         rather than pretend we know the minor axis.
 *   • `walkable: true`  — rendered, but not a collider (dock decking, fire).
 *
 * Local offsets are in the parent prop's local frame and are converted with the
 * SAME left-handed rotation PropsSystem uses:
 *     wx = x + lx·cos(rot) + lz·sin(rot)
 *     wz = z − lx·sin(rot) + lz·cos(rot)
 * Keep those two in step or props and their colliders will shear apart.
 */

/** Building heights by kind (rendering only — footprint comes from w/d). */
export const HOUSE_HEIGHT = { house: 6.6, inn: 7.6, chapel: 7.0 };

export const PROP_FOOTPRINTS = {
  well:            { fit: [2.6, 3.6, 2.9] },
  stall:           { fit: [3.1, 2.6, 2.5] },
  anvil:           { uniform: 1.0, local: [1.35, 1.15] },
  weapon_stand:    { uniform: 1.4, local: [-1.45, 0.6] },
  farmcrate_apple: { uniform: 1.0, local: [1.3, 1.05] },
  stall_barrel:    { uniform: 1.0, local: [-1.35, 0.85] },
  // A campfire is meant to be walked up to and cooked at — blocking it would
  // make the cooking prompt unreachable from most approaches.
  campfire:        { uniform: 2.2, walkable: true },
  fence_module:    { uniform: 2.5 },
  tent:            { uniform: 3.0 },
  crate:           { uniform: 1.0 },
  crate_barrel:    { uniform: 0.9 },
  mud_hut:         { uniform: 5.5 },
  mud_hut_small:   { uniform: 1.2, local: [1.8, 1.2] },
  ruin_column:     { uniform: 1.6 },
  timber_pillar:   { uniform: 1.0 },  // matches PropsSystem's literal exactly
  ore_rocks:       { uniform: 1.4, local: [2.4, 1.4] },
  dock_platform:   { uniform: 2.4, walkable: true },
  dock_hut:        { fit: [3.4, 3.0, 3.0], local: [2.8, 2.4] },
  rowboat:         { uniform: 2.6, walkable: true },
};

/** PropsSystem's deterministic per-position hash (frac(sin dot-noise)) —
 *  reproduced here so colliders can match rand-scaled props exactly. Keep in
 *  step with PropsSystem.rand. */
export function propRand(x, z) {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/** Fence modules are laid every FENCE_MODULE_M along the segment. */
export const FENCE_MODULE_M = 2.35;

/** Local → world, matching PropsSystem's left-handed rotation exactly. */
export function localToWorld(x, z, rot, lx, lz) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
}

const rectOf = (label, x, z, rot, fit) => ({ kind: 'rect', label, x, z, rot, w: fit[0], d: fit[2] });
const circOf = (label, x, z, uniform) => ({ kind: 'circle', label, x, z, r: uniform / 2 });

/**
 * Derive every world-space collider from authored prop data.
 *
 * Pure: takes the props object, returns plain geometry. No Babylon, no scene —
 * so it runs in Node (the plan renderer, CI spacing checks) and in the client
 * from one implementation.
 *
 * @param {object} props ZONE1_PROPS
 * @returns {Array<{kind:'rect'|'circle', label:string, x:number, z:number, rot?:number, w?:number, d?:number, r?:number}>}
 */
export function buildPropColliders(props) {
  const out = [];
  const push = (c, key) => { if (!PROP_FOOTPRINTS[key]?.walkable) out.push(c); };

  for (const b of props.buildings ?? []) {
    out.push({ kind: 'rect', label: b.kind, x: b.x, z: b.z, rot: b.rot ?? 0, w: b.w, d: b.d });
  }
  for (const w of props.wells ?? []) {
    push(rectOf('well', w.x, w.z, 0, PROP_FOOTPRINTS.well.fit), 'well');
  }
  for (const s of props.stalls ?? []) {
    const rot = s.rot ?? 0;
    push(rectOf(s.smithy ? 'smithy' : 'stall', s.x, s.z, rot, PROP_FOOTPRINTS.stall.fit), 'stall');
    for (const key of s.smithy
      ? ['anvil', 'weapon_stand']
      : ['farmcrate_apple', 'stall_barrel']) {
      const f = PROP_FOOTPRINTS[key];
      const p = localToWorld(s.x, s.z, rot, f.local[0], f.local[1]);
      push(circOf(key, p.x, p.z, f.uniform), key);
    }
  }
  for (const c of props.campfires ?? []) push(circOf('campfire', c.x, c.z, PROP_FOOTPRINTS.campfire.uniform), 'campfire');
  for (const f of props.fences ?? []) {
    const dx = f.x2 - f.x1, dz = f.z2 - f.z1;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / FENCE_MODULE_M));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      push(circOf('fence', f.x1 + dx * t, f.z1 + dz * t, PROP_FOOTPRINTS.fence_module.uniform), 'fence_module');
    }
  }
  for (const t of props.tents ?? []) {
    push(circOf('tent', t.x, t.z, PROP_FOOTPRINTS.tent.uniform * (t.scale ?? 1)), 'tent');
  }
  for (let i = 0; i < (props.crates ?? []).length; i++) {
    const c = props.crates[i];
    const key = i % 3 === 2 ? 'crate_barrel' : 'crate';
    push(circOf(key, c.x, c.z, PROP_FOOTPRINTS[key].uniform), key);
  }
  for (const h of props.mudHuts ?? []) {
    // PropsSystem scales huts by 5.5 + rand(x,z)*1.5 with its deterministic
    // hash; reproduce it so the collider matches the rendered hut, not the
    // minimum one.
    push(circOf('mud_hut', h.x, h.z, PROP_FOOTPRINTS.mud_hut.uniform + propRand(h.x, h.z) * 1.5), 'mud_hut');
    const s = PROP_FOOTPRINTS.mud_hut_small;
    push(circOf('mud_hut_small', h.x + s.local[0], h.z + s.local[1], s.uniform), 'mud_hut_small');
  }
  for (const r of props.ruinRings ?? []) {
    const cols = r.columns ?? 8;
    for (let i = 0; i < cols; i++) {
      const a = (i / cols) * Math.PI * 2;
      // PropsSystem places columns at (x + sin a * R, z + cos a * R) — match
      // it exactly; the cos/sin transposition put every collider on a
      // DISJOINT ring from the rendered pillars (all walk-through, with
      // invisible walls elsewhere).
      push(circOf('ruin_column', r.x + Math.sin(a) * r.ringR, r.z + Math.cos(a) * r.ringR,
        PROP_FOOTPRINTS.ruin_column.uniform), 'ruin_column');
    }
  }
  for (const m of props.mines ?? []) {
    const rot = m.rot ?? 0;
    for (const lx of [-1.45, 1.45]) {
      const p = localToWorld(m.x, m.z, rot, lx, 0);
      push(circOf('timber_pillar', p.x, p.z, PROP_FOOTPRINTS.timber_pillar.uniform), 'timber_pillar');
    }
    const o = PROP_FOOTPRINTS.ore_rocks;
    const op = localToWorld(m.x, m.z, rot, o.local[0], o.local[1]);
    push(circOf('ore_rocks', op.x, op.z, o.uniform), 'ore_rocks');
  }
  for (const d of props.docks ?? []) {
    const rot = d.rot ?? 0;
    const h = PROP_FOOTPRINTS.dock_hut;
    const hp = localToWorld(d.x, d.z, rot, h.local[0], h.local[1]);
    out.push({ kind: 'rect', label: 'dock_hut', x: hp.x, z: hp.z, rot, w: h.fit[0], d: h.fit[2] });
  }
  return out;
}
