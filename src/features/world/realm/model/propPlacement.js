/**
 * propPlacement — the ordered ecological pass. One chunk in, instance
 * buffers out. PURE and deterministic: same (chunk, seed) → byte-identical
 * placement on every client, no sync (the surfaceY contract extended to
 * ecology).
 *
 * Species place in a fixed order (boulders → trees → brambles → grass) and
 * every boulder/tree STAMPS a signed footprint into a per-chunk occupancy
 * grid that later species read: canopies suppress grass beneath them and
 * encourage it at their drip line, boulders carve bare halos, trees space
 * THEMSELVES by reading earlier trees' stamps. Clumping, understory, and
 * negative space emerge from the order + the stamps — no Poisson disk, no
 * per-species tuning pass.
 *
 * Chunk seams: stamping passes run over an 8m APRON of each neighbor —
 * the lattice is world-absolute and the hashes key on integer lattice
 * indices, so a neighbor's accept decisions are REPRODUCED exactly (never
 * synced), stamped, and simply not emitted. A canopy at a chunk border
 * suppresses grass on both sides identically because both sides compute
 * the same canopy.
 *
 * Determinism, scoped precisely (the first draft of this header overclaimed
 * "byte-identical on every client"): hash KEYS are exact integers and the
 * pass order is fixed, so placement is byte-identical across runs of the
 * SAME JS engine. Accept thresholds and geometry flow through Math.hypot/
 * cos/sin/fbm2, which ECMAScript lets engines approximate — cross-ENGINE
 * identity is near-exact, not guaranteed, the same tolerance contract
 * terrainField.js documents for surfaceY. Nothing gameplay-authoritative
 * may compare placements for equality across runtimes.
 *
 * Chunk-independence, also scoped precisely: the tree pass READS the grid
 * it STAMPS mid-pass, so strict independence needs the transitive closure
 * of influence (~4.25m/hop), which the 8m apron bounds for one hop but not
 * arbitrarily many. In practice the process is subcritical (order-
 * independence probes pass; suppression discs don't chain at these
 * densities) — chunk-independent by measurement, not by construction.
 */

import { CHUNK_SIZE_M } from './chunkMath.js';
import { hash2 } from './noise.js';
import { canopyDensityJs, CANOPY_DENSITY_DEF } from './vegDensity.js';
import { stressTierAt } from './propGenomes.js';
import { writeInstanceMatrix } from './instanceMatrix.js';
import { ribbonWear } from './desireLines.js';

export const OCCUPANCY_CELL_M = 0.5;
export const APRON_M = 8;
const GRID_N = (CHUNK_SIZE_M + 2 * APRON_M) / OCCUPANCY_CELL_M; // 160

/**
 * One module-level scratch grid, zeroed per call — placement is synchronous
 * and single-threaded, and 25KB per streamed chunk would otherwise be pure
 * allocator churn. Bias-128 encoding: 128 neutral, below = exclusion,
 * above = encouragement.
 */
const scratch = new Uint8Array(GRID_N * GRID_N);


/**
 * Order-independent per-edge bias between two chunks: both sides hash the
 * lexicographically-sorted coordinate pair, so both derive the identical
 * value with no load-order dependence — groves lean across seams instead
 * of respecting them.
 */
export function edgeBias(cxA, czA, cxB, czB, seed) {
  const aFirst = cxA < cxB || (cxA === cxB && czA <= czB);
  const [x1, z1, x2, z2] = aFirst ? [cxA, czA, cxB, czB] : [cxB, czB, cxA, czA];
  return hash2((x1 * 8191 + z1) | 0, (x2 * 8191 + z2) | 0, (seed + 555) | 0) * 2 - 1;
}

const EDGE_FALLOFF_M = 24;

/**
 * Density multiplier from the four edge-neighbor handshakes, derived from
 * the candidate's OWNING chunk — computed from its world position, never
 * from the chunk whose pass happens to be evaluating it. The first version
 * took the GENERATING chunk's frame: an apron candidate then measured
 * negative edge distances and read a different chunk's edges entirely, so
 * the apron recompute and the owner disagreed about the same tree's bias
 * (measured in PR review at up to 2x at corners). Owning-chunk framing
 * makes the value a pure function of world position, which is the only
 * thing that makes "the neighbor recomputes my decisions exactly" true.
 */
function neighborBiasFactor(x, z, seed) {
  const ocx = Math.floor(x / CHUNK_SIZE_M);
  const ocz = Math.floor(z / CHUNK_SIZE_M);
  const lx = x - ocx * CHUNK_SIZE_M;
  const lz = z - ocz * CHUNK_SIZE_M;
  let f = 1;
  const edges = [
    [ocx - 1, ocz, lx], // west edge: distance = lx, always in [0, 64)
    [ocx + 1, ocz, CHUNK_SIZE_M - lx],
    [ocx, ocz - 1, lz],
    [ocx, ocz + 1, CHUNK_SIZE_M - lz],
  ];
  for (const [nx, nz, dist] of edges) {
    if (dist < EDGE_FALLOFF_M) {
      const bias = edgeBias(ocx, ocz, nx, nz, seed);
      f *= 1 + bias * 0.5 * (1 - dist / EDGE_FALLOFF_M);
    }
  }
  return f;
}

// ── The occupancy grid ───────────────────────────────────────────────────────

const cellOf = (localM) => Math.floor((localM + APRON_M) / OCCUPANCY_CELL_M);

function stampDisc(lx, lz, radiusM, delta) {
  const c0x = Math.max(0, cellOf(lx - radiusM));
  const c1x = Math.min(GRID_N - 1, cellOf(lx + radiusM));
  const c0z = Math.max(0, cellOf(lz - radiusM));
  const c1z = Math.min(GRID_N - 1, cellOf(lz + radiusM));
  const r2 = radiusM * radiusM;
  for (let gz = c0z; gz <= c1z; gz++) {
    const wz = (gz + 0.5) * OCCUPANCY_CELL_M - APRON_M;
    for (let gx = c0x; gx <= c1x; gx++) {
      const wx = (gx + 0.5) * OCCUPANCY_CELL_M - APRON_M;
      const dx = wx - lx;
      const dz = wz - lz;
      if (dx * dx + dz * dz <= r2) {
        const i = gz * GRID_N + gx;
        scratch[i] = Math.max(0, Math.min(255, scratch[i] + delta));
      }
    }
  }
}

function stampRing(lx, lz, r0, r1, delta) {
  const c0x = Math.max(0, cellOf(lx - r1));
  const c1x = Math.min(GRID_N - 1, cellOf(lx + r1));
  const c0z = Math.max(0, cellOf(lz - r1));
  const c1z = Math.min(GRID_N - 1, cellOf(lz + r1));
  const r0sq = r0 * r0;
  const r1sq = r1 * r1;
  for (let gz = c0z; gz <= c1z; gz++) {
    const wz = (gz + 0.5) * OCCUPANCY_CELL_M - APRON_M;
    for (let gx = c0x; gx <= c1x; gx++) {
      const wx = (gx + 0.5) * OCCUPANCY_CELL_M - APRON_M;
      // Squared-distance membership like stampDisc — Math.hypot is
      // implementation-approximated, and one ULP at a ring edge would flip
      // a whole ±35 cell between engines (review catch).
      const dx = wx - lx;
      const dz = wz - lz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r0sq && d2 <= r1sq) {
        const i = gz * GRID_N + gx;
        scratch[i] = Math.max(0, Math.min(255, scratch[i] + delta));
      }
    }
  }
}

/** Occupancy multiplier at a local point: 1 neutral, <1 suppressed, >1 boosted. */
function occupancyAt(lx, lz) {
  const gx = Math.max(0, Math.min(GRID_N - 1, cellOf(lx)));
  const gz = Math.max(0, Math.min(GRID_N - 1, cellOf(lz)));
  return scratch[gz * GRID_N + gx] / 128;
}

// ── Species passes ───────────────────────────────────────────────────────────

/** Iterate a world-absolute lattice covering the chunk plus its apron. */
function forLattice(originX, originZ, spacingM, withApron, fn) {
  const pad = withApron ? APRON_M : 0;
  const i0x = Math.ceil((originX - pad) / spacingM);
  const i1x = Math.floor((originX + CHUNK_SIZE_M + pad) / spacingM);
  const i0z = Math.ceil((originZ - pad) / spacingM);
  const i1z = Math.floor((originZ + CHUNK_SIZE_M + pad) / spacingM);
  for (let iz = i0z; iz <= i1z; iz++) {
    for (let ix = i0x; ix <= i1x; ix++) {
      fn(ix, iz);
    }
  }
}

const collect = () => ({ mats: [], tints: [], count: 0 });

function emit(bucket, pose, tint) {
  const at = bucket.count * 16;
  bucket.mats.length = at + 16;
  writeInstanceMatrix(bucket.mats, at, pose);
  bucket.tints.push(tint[0], tint[1], tint[2]);
  bucket.count++;
}

/**
 * The whole chunk's prop field. `surfaceYAt` (optional) substitutes a cheap
 * height lookup (e.g. a bilerp over the already-generated terrain mesh) for
 * GRASS ONLY — visual ground-snapping, never an accept input, so the two
 * lookup paths cannot diverge on placement decisions. Trees/boulders read
 * the exact field: they will collide someday and must sit right.
 */
export function placeChunkProps(field, {
  cx, cz, surfaceYAt = null,
}) {
  const seed = field.config.seed;
  const originX = cx * CHUNK_SIZE_M;
  const originZ = cz * CHUNK_SIZE_M;
  scratch.fill(128);

  const out = {
    valeoak: collect(),
    cragpine: collect(),
    cragpine_hardy: collect(),
    cragpine_krum: collect(),
    boulder: collect(),
    bramble: collect(),
    tuft: collect(),
  };
  const inChunk = (x, z) => x >= originX && x < originX + CHUNK_SIZE_M && z >= originZ && z < originZ + CHUNK_SIZE_M;

  // Pass 1 — boulders (stampers; apron included so neighbors' halos land).
  forLattice(originX, originZ, 4, true, (ix, iz) => {
    const jx = (hash2(ix, iz, seed + 11) - 0.5) * 3.2;
    const jz = (hash2(ix, iz, seed + 13) - 0.5) * 3.2;
    const x = ix * 4 + jx;
    const z = iz * 4 + jz;
    const { mountainMask, valeMask } = field.radialMasksAt(x, z);
    let density = (0.02 + mountainMask * 0.10) * (1 - valeMask * 0.9);
    // Boulders respect the desire lines HARDEST — the one species that
    // physically blocks a walker must never sit in an authored path
    // (review catch: every species thinned on ribbons except this one).
    density *= 1 - 0.95 * ribbonWear(x, z);
    if (hash2(ix, iz, seed + 17) >= density) return;
    const probe = field.probeAt(x, z);
    if (probe.slope > 0.75) return;
    const sxz = 0.6 + hash2(ix, iz, seed + 19) * 1.0;
    stampDisc(x - originX, z - originZ, 1.3 * sxz, -70);
    if (!inChunk(x, z)) return;
    const g = 0.85 + hash2(ix, iz, seed + 23) * 0.3;
    emit(out.boulder, {
      x, y: probe.y - 0.15 * sxz, z,
      yaw: hash2(ix, iz, seed + 29) * Math.PI * 2,
      sxz, sy: sxz * (0.7 + hash2(ix, iz, seed + 31) * 0.5),
    }, [g, g, g]);
  });

  // Pass 2 — trees (stampers; read earlier stamps for self-spacing).
  forLattice(originX, originZ, 2, true, (ix, iz) => {
    const jx = (hash2(ix, iz, seed + 41) - 0.5) * 1.6;
    const jz = (hash2(ix, iz, seed + 43) - 0.5) * 1.6;
    const x = ix * 2 + jx;
    const z = iz * 2 + jz;
    const lx = x - originX;
    const lz = z - originZ;
    const masks = field.radialMasksAt(x, z);
    let density = canopyDensityJs(x, z, masks, seed) * 0.16;
    density *= 1 - 0.85 * ribbonWear(x, z);
    density *= neighborBiasFactor(x, z, seed);
    density *= occupancyAt(lx, lz);
    if (hash2(ix, iz, seed + 47) >= density) return;
    const probe = field.probeAt(x, z);
    if (probe.slope > CANOPY_DENSITY_DEF.slopeMax) return;
    if (probe.channel > 0.5) return; // no trees on the ravine bed
    const stress = stressTierAt(probe);
    const protoId = masks.mountainMask < 0.35
      ? 'valeoak'
      : ['cragpine', 'cragpine_hardy', 'cragpine_krum'][stress];
    const sxz = 0.85 + hash2(ix, iz, seed + 53) * 0.4;
    stampDisc(lx, lz, 2.0 * sxz, -60);
    stampRing(lx, lz, 2.4 * sxz, 3.2 * sxz, 35);
    if (!inChunk(x, z)) return;
    // Compass lean: every tree tips slightly AWAY from the vale center —
    // rotation about the tangent axis. Read one trunk up close anywhere in
    // the world and it points home. Near-free: two extra matrix terms.
    const r = Math.hypot(x, z) || 1;
    const warm = protoId === 'valeoak' ? hash2(ix, iz, seed + 59) * 0.12 : 0;
    const g = 0.9 + hash2(ix, iz, seed + 61) * 0.2;
    emit(out[protoId], {
      x, y: probe.y - 0.12, z,
      yaw: hash2(ix, iz, seed + 67) * Math.PI * 2,
      sxz, sy: 0.9 + hash2(ix, iz, seed + 71) * 0.25,
      // Axis = (z, -x)/r, i.e. the NEGATED tangent: writeInstanceMatrix's
      // Rodrigues rows are the row-vector transpose of the column form, so
      // rotation runs opposite to the column-convention intuition — the
      // compass-lean test pins the outcome (local Y tips radially OUTWARD),
      // which is the fact that matters, not the convention.
      leanAxisX: z / r, leanAxisZ: -x / r,
      leanAngle: 0.05 + hash2(ix, iz, seed + 73) * 0.05,
    }, [g + warm, g, g - warm * 0.5]);
  });

  // Pass 3 — brambles (no stamps; love drip lines, hate deep canopy).
  forLattice(originX, originZ, 2, false, (ix, iz) => {
    const x = ix * 2 + 1 + (hash2(ix, iz, seed + 83) - 0.5) * 1.4;
    const z = iz * 2 + 1 + (hash2(ix, iz, seed + 89) - 0.5) * 1.4;
    if (!inChunk(x, z)) return;
    const masks = field.radialMasksAt(x, z);
    let density = (0.02 + canopyDensityJs(x, z, masks, seed) * 0.05) * (1 - masks.valeMask * 0.8);
    density *= 1 - 0.9 * ribbonWear(x, z);
    density *= occupancyAt(x - originX, z - originZ);
    if (hash2(ix, iz, seed + 97) >= density) return;
    const probe = field.probeAt(x, z);
    if (probe.slope > 0.6) return;
    const sxz = 0.7 + hash2(ix, iz, seed + 101) * 0.7;
    const g = 0.85 + hash2(ix, iz, seed + 103) * 0.3;
    emit(out.bramble, {
      x, y: probe.y - 0.05, z,
      yaw: hash2(ix, iz, seed + 107) * Math.PI * 2,
      sxz, sy: sxz,
    }, [g, g + 0.05, g * 0.95]);
  });

  // Pass 4 — grass tufts (the reader that makes all the negative space
  // legible: halos under canopies, moss boost at drip rings, worn ribbons).
  const grassY = surfaceYAt ?? field.surfaceY;
  forLattice(originX, originZ, 1, false, (ix, iz) => {
    const x = ix + (hash2(ix, iz, seed + 113) - 0.5) * 0.9;
    const z = iz + (hash2(ix, iz, seed + 127) - 0.5) * 0.9;
    if (!inChunk(x, z)) return;
    const { mountainMask, valeMask } = field.radialMasksAt(x, z);
    let density = 0.4 * (1 - mountainMask * 0.85) * (1 - valeMask * 0.35);
    density *= 1 - 0.6 * ribbonWear(x, z);
    density *= occupancyAt(x - originX, z - originZ);
    if (hash2(ix, iz, seed + 131) >= density) return;
    const s = 0.8 + hash2(ix, iz, seed + 137) * 0.5;
    // Straw-dry toward the mountain band, lush green in the vale.
    const dry = mountainMask * 0.5;
    const g = 0.85 + hash2(ix, iz, seed + 139) * 0.3;
    emit(out.tuft, {
      x, y: grassY(x, z), z,
      yaw: hash2(ix, iz, seed + 149) * Math.PI * 2,
      sxz: s, sy: s,
    }, [g * (1 + dry * 0.35), g, g * (1 - dry * 0.45)]);
  });

  // Finalize: typed arrays, drop empty buckets.
  const instances = {};
  for (const [id, b] of Object.entries(out)) {
    if (b.count > 0) {
      instances[id] = {
        count: b.count,
        matrices: Float32Array.from(b.mats),
        tints: Float32Array.from(b.tints),
      };
    }
  }
  return { instances };
}
