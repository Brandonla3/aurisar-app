/**
 * propGen — grow a prototype family from a genome. PURE.
 *
 * buildPrototypePayload(prototypeId, stage) → the same typed-array payload
 * shape terrainChunkGen emits; view/props turns it into a master mesh
 * verbatim. Stage is a DEVELOPMENTAL truncation, not a decimation: coarser
 * stages run the same growth program with fewer fork recursions, fewer ring
 * segments, fewer foliage blobs — while the adult envelope (height, crown
 * radius, conifer tier heights/radii) is held FIXED by construction:
 *
 *  - canopy crowns place their blobs on the crown ellipsoid at distance
 *    (crownRadius - blobRadius), and blob radius GROWS as blob count drops
 *    (cube-root volume compensation), so total crown extent is exactly
 *    crownRadius at every stage — a far stage cannot be a narrower tree.
 *  - conifer tier discs sit at genome-fixed heights/radii; stages only
 *    coarsen each disc's tessellation.
 *  - the boulder displaces every tessellation level with the SAME
 *    direction-continuous noise field, so coarser levels sample the same
 *    lumps rather than inventing new ones.
 *
 * The silhouette-IoU test (gen/propGen.test.js) measures this instead of
 * trusting it.
 */

import { fbm2, hash2 } from '../model/noise.js';
import { GENOMES, deriveStressed, prototypeById } from '../model/propGenomes.js';
import {
  addBladeFan, addBlob, addTube, finalize, newAccumulator,
} from './propPrimitives.js';

/**
 * Coarser-blob radius compensation. An icosahedron's mean projected
 * silhouette is ~76% of its circumscribing sphere's (Cauchy: mean projected
 * area = surface/4; 9.57R² vs 12.57R²) — measured in the IoU gate as
 * mid stages systematically under-filling. Compensation applies ONLY when a
 * stage's blob level is actually coarser than stage 0's (keyed on the level
 * DIFFERENCE, not on the stage index — bramble uses the same level at both
 * stages and must get comp 1, which an earlier stage-keyed version got
 * wrong and failed its own envelope gate over).
 */
// 1.08, not the area-exact 1.146: conifer discs measure width at the gate
// boundary at 1.10 (0.10000002 — literally the gate), and the crown code's
// exact-envelope trick doesn't apply to discs whose radius IS the envelope.
const MID_BLOB_COMP = 1.08;
const blobComp = (levels, stage) => (levels[stage] < levels[0] ? MID_BLOB_COMP : 1);

/** Direction-continuous radial displacement shared by all LOD levels. */
const gnarlField = (genome) => (d) => 1 + genome.gnarl * fbm2(
  d[0] * genome.gnarlFreq + 4.7,
  (d[2] + d[1] * 0.7) * genome.gnarlFreq - 3.1,
  { octaves: 2, seed: genome.seed },
);

/**
 * Mild lumpiness for foliage blobs; per-blob seed offset so blobs differ.
 * Amplitude and frequency are deliberately LOW: stages tessellate the same
 * field at different vertex directions, so the rougher this field, the more
 * a coarse stage's max-extent vertex can diverge from the fine stage's —
 * which shows up directly as stage-to-stage width delta in the IoU gate.
 */
const leafField = (genome, blobIndex) => (d) => 1 + 0.10 * fbm2(
  d[0] * 1.3 + blobIndex * 7.13,
  d[2] * 1.3 - blobIndex * 3.71,
  { octaves: 2, seed: genome.seed + 59 },
);

/**
 * Crown blobs on the envelope. One fixed direction sequence per genome;
 * stages truncate to the first N and compensate radius, so every stage
 * fills the same ellipsoid.
 */
function addCrown(acc, genome, stage, blobLevels) {
  const blobLevel = blobLevels[stage];
  const budget = genome.clusterBudget[stage];
  const full = genome.clusterBudget[0];
  const comp = blobComp(blobLevels, stage);
  const blobR = genome.clusterRadius * Math.cbrt(full / budget) * comp;
  for (let i = 0; i < budget; i++) {
    // Golden-angle azimuths, not hash-random: EVERY prefix of a golden-angle
    // sequence covers azimuths near-evenly, which is exactly what first-N
    // stage truncation needs. Hash-random azimuths measured a 14.9% width
    // delta at one yaw — the three dropped blobs happened to own an entire
    // azimuth sector, so the mid crown was genuinely narrower along it.
    const phi = i * 2.399963229728653 + (hash2(i, 41, genome.seed) - 0.5) * 0.3;
    // Elevation stratified the same way (golden-fraction + small jitter):
    // a blob's horizontal reach scales with sin(elevation), so hash-random
    // elevations let a prefix keep only tucked-in high blobs along some
    // azimuth — measured as residual width delta after azimuths were fixed.
    const strat = (i * 0.6180339887498949 + 0.31) % 1;
    const cosT = Math.min(1, -0.25 + (strat * 0.9 + hash2(i, 43, genome.seed) * 0.3));
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const dir = [sinT * Math.cos(phi), cosT, sinT * Math.sin(phi)];
    // PER-BLOB exact envelope: each blob's center distance derives from its
    // OWN jittered radius, so nominal extent is crownRadius for every blob
    // at every stage. An earlier version used the stage's nominal radius
    // for centers and jittered only the drawn blob — extent then wandered
    // by ±jitter×blobR, and since mid-stage blobs are larger (cube-root
    // compensation), the two stages wandered by DIFFERENT amounts: measured
    // as a 14.6% stage-to-stage width delta that moved whenever any knob
    // moved. Deriving centers from drawn radii pins it structurally.
    const drawnR = blobR * (0.92 + hash2(i, 47, genome.seed) * 0.16);
    const centerDist = Math.max(0, genome.crownRadius - drawnR);
    addBlob(acc, [
      dir[0] * centerDist,
      genome.crownCenterY + dir[1] * centerDist * genome.crownSquash,
      dir[2] * centerDist,
    ], drawnR, blobLevel, genome.leafRGB, {
      displace: leafField(genome, i),
      squashY: 0.9,
    });
  }
}

/** Recursive limb: tube + children pitched off the tip. */
function addLimbs(acc, genome, stage, from, dir, len, radius, depth, nodeSeed) {
  const to = [from[0] + dir[0] * len, from[1] + dir[1] * len, from[2] + dir[2] * len];
  addTube(acc, from, to, radius, radius * 0.55, genome.ringSegments[stage], genome.barkRGB);
  if (depth <= 0) return;
  const pitch = (genome.forkAngleDeg * Math.PI) / 180;
  for (let k = 0; k < genome.forkCount; k++) {
    const yaw = (k / genome.forkCount) * Math.PI * 2 + hash2(nodeSeed, k, genome.seed) * 1.1;
    // Child direction: parent dir pitched outward, crudely — for a stylized
    // tree the exact rotation frame doesn't matter, staying deterministic does.
    const out = [Math.cos(yaw), 0, Math.sin(yaw)];
    const cd = [
      dir[0] * Math.cos(pitch) + out[0] * Math.sin(pitch),
      Math.max(0.15, dir[1] * Math.cos(pitch)),
      dir[2] * Math.cos(pitch) + out[2] * Math.sin(pitch),
    ];
    const il = 1 / Math.hypot(cd[0], cd[1], cd[2]);
    addLimbs(
      acc, genome, stage, to,
      [cd[0] * il, cd[1] * il, cd[2] * il],
      len * 0.62, radius * 0.55, depth - 1, nodeSeed * 7 + k + 1,
    );
  }
}

/** Broadleaf (valeoak) and shrub (bramble): trunk [+ limbs] + crown. */
function growCanopy(genome, stage) {
  const acc = newAccumulator();
  const lean = (hash2(1, 3, genome.seed) - 0.5) * 0.2;
  const top = [lean * genome.trunkH, genome.trunkH, lean * 0.6 * genome.trunkH];
  addTube(acc, [0, 0, 0], top, genome.baseRadius, genome.baseRadius * genome.taper, genome.ringSegments[stage], genome.barkRGB);
  const depth = genome.forkDepth ? genome.forkDepth[stage] : 0;
  if (depth > 0) {
    addLimbs(acc, genome, stage, top, [lean, 1, lean * 0.6].map((v, i) => (i === 1 ? 0.9 : v)), genome.trunkH * 0.42, genome.baseRadius * genome.taper, depth, 13);
  }
  addCrown(acc, genome, stage, genome.blobLevel ?? [2, 1]);
  return finalize(acc);
}

/**
 * Conifer (cragpine): trunk + fixed-envelope tier discs. Both stages use
 * sphere blobs from the same family (icosphere subdiv-1 near, icosahedron
 * mid — the mid's 12 verts are a strict SUBSET of the near's 42, so it
 * samples the same displacement lumps); the mid stage gets horizontal
 * area compensation. A lens primitive was tried here and measured WORSE
 * (0.67 vs 0.81 IoU): its side profile is a diamond filling ~64% of the
 * squashed sphere's ellipse, and conifer discs are side-view-dominated.
 */
function growConifer(genome, stage) {
  const acc = newAccumulator();
  const topY = genome.tierHeights[genome.tierHeights.length - 1] + 0.5;
  addTube(acc, [0, 0, 0], [0, topY, 0], genome.baseRadius, genome.baseRadius * genome.taper, genome.ringSegments[stage], genome.barkRGB);
  const comp = blobComp(genome.blobLevel, stage);
  for (let t = 0; t < genome.tierHeights.length; t++) {
    addBlob(acc, [0, genome.tierHeights[t], 0], genome.tierRadii[t] * comp, genome.blobLevel[stage], genome.leafRGB, {
      displace: leafField(genome, t),
      squashY: genome.tierSquash / comp, // keep disc HEIGHT fixed while width compensates
    });
  }
  return finalize(acc);
}

/**
 * Boulder: displaced sphere, flat-shaded, lichen on the up-faces.
 * Flat shading is deliberate — faceted rock reads stylized; smooth radial
 * normals read like a balloon. Blob geometry is unindexed, so overwriting
 * each triangle's three normals with its face normal is safe (no sharing).
 */
function growBoulder(genome, stage) {
  const acc = newAccumulator();
  addBlob(acc, [0, genome.radius * genome.squashY * 0.8, 0], genome.radius, genome.level[stage], genome.rockRGB, {
    displace: gnarlField(genome),
    squashY: genome.squashY,
    shadeFloor: 0.85,
  });
  // Flat-shade + lichen pass over what addBlob just wrote.
  const { pos, nrm, col, idx } = acc;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const il = 1 / (Math.hypot(nx, ny, nz) || 1);
    nx *= il; ny *= il; nz *= il;
    const lichen = Math.max(0, ny - 0.45) * 1.4; // up-faces grow lichen
    for (const vi of [idx[t], idx[t + 1], idx[t + 2]]) {
      nrm[vi * 3] = nx; nrm[vi * 3 + 1] = ny; nrm[vi * 3 + 2] = nz;
      for (let ch = 0; ch < 3; ch++) {
        const rock = col[vi * 4 + ch];
        col[vi * 4 + ch] = rock + (genome.lichenRGB[ch] - rock) * Math.min(1, lichen);
      }
    }
  }
  return finalize(acc);
}

function growTuft(genome) {
  const acc = newAccumulator();
  addBladeFan(acc, genome.blades, genome.bladeW, genome.bladeH, genome.grassRGB, genome.seed);
  return finalize(acc);
}

/**
 * The one public entry: prototype id + stage → payload. Throws on unknown
 * ids or out-of-range stages — a typo'd prototype must fail loudly at
 * build time, not place invisible nothing.
 */
export function buildPrototypePayload(prototypeId, stage) {
  const proto = prototypeById(prototypeId);
  if (!proto) throw new Error(`[propGen] unknown prototype "${prototypeId}"`);
  if (stage < 0 || stage >= proto.stages) {
    throw new Error(`[propGen] "${prototypeId}" has ${proto.stages} stages; got ${stage}`);
  }
  const genome = deriveStressed(GENOMES[proto.genomeId], proto.stress);
  switch (proto.kind) {
    case 'canopy':
    case 'shrub':
      return growCanopy(genome, stage);
    case 'conifer':
      return growConifer(genome, stage);
    case 'boulder':
      return growBoulder(genome, stage);
    case 'tuft':
      return growTuft(genome);
    default:
      throw new Error(`[propGen] unhandled kind "${proto.kind}"`);
  }
}
