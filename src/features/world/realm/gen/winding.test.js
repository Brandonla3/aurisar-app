/**
 * winding.test.js — the gate that was missing while the ground was invisible.
 *
 * Every piece of realm geometry is authored with ANALYTIC normals: the
 * generator knows which way each surface faces and writes it into `normals`.
 * Triangle winding is a SECOND, independent statement of the same fact, made
 * in `indices`, and nothing in this repo checked that the two agreed. From P2
 * (terrain) and P5 (blobs, grass) until the P6 final review they did not:
 * `addBlob`, `addBladeFan` and `generateTerrainChunk` all emitted the reverse
 * of Babylon's front face, so on real hardware the world's entire ground was
 * culled and 76-85% of every near-stage actor presented its interior surface.
 *
 * WHY NOTHING NOTICED, which is the part worth engineering against. The
 * silhouette harness rasterizes orientation-agnostically ON PURPOSE
 * (model/silhouette.js:123 — a signed-area barycentric fill, so reversing a
 * triangle negates `area` and all three barycentrics and the coverage test is
 * unchanged). So `silhouetteAreaM2`, every IoU gate, the band histograms, the
 * budget manifests and the exit bar are ALL blind to winding by construction,
 * and they should stay that way — an outline is an outline. Even the phase's
 * real-GPU check was blind: a closed body covers the same screen pixels
 * either way (measured, 38,361 vs 38,362 lit pixels before/after reversing
 * every index), because reversal only changes WHICH of its two surfaces you
 * are looking at, not where it is.
 *
 * That leaves winding with no natural home in any existing gate, which is
 * exactly why it needs its own file.
 *
 * THE CONVENTION IS MEASURED HERE, NOT REMEMBERED. Handedness conventions are
 * the classic thing to get backwards from memory — the wrong-signed assertion
 * this file replaces (gen/terrainChunkGen.test.js's "triangles face up") was
 * green for four phases. So group 1 derives the rule from Babylon's own
 * primitives, which are correct by definition, and closes the render-state
 * escape hatches that could change it. Group 2 then applies the derived rule
 * to everything the realm generates.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import BABYLON from 'babylonjs';

import { generateTerrainChunk } from './terrainChunkGen.js';
import { buildPrototypePayload } from './propGen.js';
import { buildActorPayload } from './actorGen.js';
import {
  addBladeFan, addBlob, addTube, finalize, newAccumulator,
} from './propPrimitives.js';
import { createTerrainField } from '../model/terrainField.js';
import { PROTOTYPES, RENDERED_STAGES } from '../model/propGenomes.js';
import { ARCHETYPES } from '../model/actorMasses.js';

const REALM_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Per-triangle: does the right-handed cross product (v1-v0)x(v2-v0) agree
 * with the surface's authored outward normal (`parallel`) or oppose it
 * (`anti`)? The authored normal is taken as the mean of the triangle's three
 * vertex normals, which is exact for our flat-per-face primitives and
 * correct-in-the-limit for smoothly-shaded ones.
 *
 * `degenerate` catches both zero-area triangles (Babylon's sphere collapses
 * one quad row at each pole) and the case where the cross sits perpendicular
 * to the normal, which would mean the two statements are unrelated rather
 * than merely disagreeing.
 */
function windingCensus({ positions, normals, indices }) {
  let parallel = 0;
  let anti = 0;
  let degenerate = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3;
    const i1 = indices[t + 1] * 3;
    const i2 = indices[t + 2] * 3;
    const ux = positions[i1] - positions[i0];
    const uy = positions[i1 + 1] - positions[i0 + 1];
    const uz = positions[i1 + 2] - positions[i0 + 2];
    const vx = positions[i2] - positions[i0];
    const vy = positions[i2 + 1] - positions[i0 + 1];
    const vz = positions[i2 + 2] - positions[i0 + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const nx = (normals[i0] + normals[i1] + normals[i2]) / 3;
    const ny = (normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1]) / 3;
    const nz = (normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2]) / 3;
    const dot = cx * nx + cy * ny + cz * nz;
    const mag = Math.hypot(cx, cy, cz) * Math.hypot(nx, ny, nz);
    if (mag < 1e-12 || Math.abs(dot) < 1e-9 * mag) degenerate++;
    else if (dot > 0) parallel++;
    else anti++;
  }
  return { parallel, anti, degenerate, tris: indices.length / 3 };
}

/** The one assertion every realm payload must satisfy. */
function expectFrontFaceOut(label, payload) {
  const c = windingCensus(payload);
  expect(
    c.parallel,
    `${label}: ${c.parallel} of ${c.tris} triangles have their right-handed cross parallel to the authored `
    + 'normal, which is the BACK face here — those triangles are culled on a real GPU and you will see the '
    + 'inside of the far surface instead. Reverse the index push that emits them (swap the last two indices); '
    + 'do NOT reach for sideOrientation or backFaceCulling, which cannot fix one emitter without breaking another.',
  ).toBe(0);
  expect(
    c.anti,
    `${label}: only ${c.anti} of ${c.tris} triangles were classified — the rest were degenerate, so this `
    + 'assertion examined almost nothing',
  ).toBe(c.tris);
}

// ── 1. THE CONVENTION ───────────────────────────────────────────────────────

describe('1. front-face convention, derived from the engine rather than asserted', () => {
  it('every Babylon primitive winds its front face RH-cross-INWARD', () => {
    // Babylon's own builders are correct by definition: whatever relation
    // THEY hold between winding and authored normal is what "front face"
    // means in this engine. Measured across five of them, the relation is
    // unanimous and it is ANTI-parallel — a front face's RH cross points away
    // from the side the normal faces, i.e. away from the viewer looking at it.
    const reference = {
      CreateGround: BABYLON.CreateGroundVertexData({ width: 2, height: 2, subdivisions: 4 }),
      CreateSphere: BABYLON.CreateSphereVertexData({ diameter: 2, segments: 8 }),
      CreateBox: BABYLON.CreateBoxVertexData({ size: 1 }),
      CreateCylinder: BABYLON.CreateCylinderVertexData({ height: 2, diameter: 1, tessellation: 12 }),
      CreateIcoSphere: BABYLON.CreateIcoSphereVertexData({ radius: 1, subdivisions: 1 }),
    };
    for (const [name, vd] of Object.entries(reference)) {
      const c = windingCensus(vd);
      expect(c.parallel, `${name} has ${c.parallel}/${c.tris} parallel triangles — the convention this whole `
        + 'file rests on has changed; re-derive it before touching any generator').toBe(0);
      expect(c.anti, `${name} classified nothing`).toBeGreaterThan(0);
    }
    // Measured on babylonjs 9.19.0: ground 32/32 anti, sphere 360/400 anti
    // with 40 degenerate pole triangles, box 12/12, cylinder 48/48,
    // icosphere 20/20. Zero parallel anywhere.
    expect(windingCensus(reference.CreateGround)).toEqual({ parallel: 0, anti: 32, degenerate: 0, tris: 32 });
  });

  it('the render state that makes anti-parallel the FRONT face is the default one', () => {
    // The convention above is only the realm's convention if nothing in the
    // pipeline flips it. Babylon resolves the front face as
    // `_getEffectiveOrientation(mesh)`: material.sideOrientation if set, else
    // the mesh's, and CounterClockWise (1) means gl.frontFace(CCW). There is
    // no handedness term in that computation, so useRightHandedSystem matters
    // only via how the projection is built — which is why it is pinned too.
    const engine = new BABYLON.NullEngine();
    try {
      const scene = new BABYLON.Scene(engine);
      const mesh = new BABYLON.Mesh('windingProbe', scene);
      const material = new BABYLON.StandardMaterial('windingProbe', scene);
      mesh.material = material;

      expect(scene.useRightHandedSystem, 'the realm is left-handed; nothing in src/ sets this').toBe(false);
      expect(material.sideOrientation, 'a fresh material defers to the mesh').toBeNull();
      expect(mesh.sideOrientation).toBe(BABYLON.Material.CounterClockWiseSideOrientation);
      expect(material._getEffectiveOrientation(mesh)).toBe(BABYLON.Material.CounterClockWiseSideOrientation);
      expect(material.backFaceCulling, 'back faces really are discarded').toBe(true);
      expect(material.cullBackFaces).toBe(true);
      scene.dispose();
    } finally {
      engine.dispose();
    }
  });

  it('only the three deliberately inside-out surfaces touch orientation or culling', () => {
    // The escape hatches. A file that sets BACKSIDE or disables culling is
    // exempt from the convention BY DESIGN, and exactly three are: the sky
    // dome and horizon rings are seen from INSIDE (a viewer standing at the
    // centre of a sphere/cylinder), and cloud puffs are billboards read from
    // both faces. Everything else — terrain, props, actors — is an opaque
    // surface seen from outside and must obey group 2.
    //
    // This scan is what stops someone "fixing" a winding regression with a
    // material flag: doing so would have to add a file here, in review.
    const ALLOWED = new Set([
      'view/materials/skyDomeNME.js',   // CreateSphere BACKSIDE — viewed from inside
      'view/materials/horizonRingNME.js', // CreateCylinder BACKSIDE — viewed from inside
      'view/atmosphere/cloudPuffs.js',  // backFaceCulling false — double-sided puffs
    ]);
    // Three verified bypasses closed in the P6 review round, all of which
    // this scan used to wave through:
    //   cullBackFaces = false   — Babylon's own alias for backFaceCulling,
    //     asserted twenty lines above as part of the pinned render state, and
    //     absent from this pattern entirely.
    //   overrideMaterialSideOrientation — the SCENE-level override, which
    //     flips every material at once. `\bsideOrientation\b` is case
    //     sensitive and there is no word boundary before a capital S inside
    //     an identifier, so the widest hammer in the engine was the one
    //     spelling the scan could not see.
    //   backFaceCulling: false  — the object-literal form. Every Babylon
    //     material and mesh builder takes an options bag, so `=` alone
    //     covered one of the two ways to write the same thing.
    // FLIPPER_BYPASSES below holds each of these as a literal and asserts it
    // matches, so the pattern is checked against the strings it exists to
    // catch instead of being read for plausibility.
    const FLIPPERS = new RegExp([
      '[sS]ideOrientation',
      'backFaceCulling\\s*[=:]\\s*false',
      'cullBackFaces\\s*[=:]\\s*false',
      '\\bflipFaces\\b',
      '\\buseRightHandedSystem\\b',
    ].join('|'));
    // Comments are stripped for the same reason boundary.test.js strips them:
    // the generators DISCUSS these flags at length (they are the escape
    // hatches this file exists to keep shut) and prose must not count as use.
    const stripComments = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const walk = (dir) => readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full);
      return /\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry) ? [full] : [];
    });
    const rel = (f) => relative(REALM_ROOT, f).split(sep).join('/');
    const offenders = walk(REALM_ROOT)
      .filter((f) => !ALLOWED.has(rel(f)))
      .filter((f) => FLIPPERS.test(stripComments(readFileSync(f, 'utf8'))))
      .map(rel);
    expect(
      offenders,
      'These files flip triangle orientation or disable culling. If the surface is genuinely viewed from '
      + 'inside (a dome, a ring) or is genuinely double-sided, add it to ALLOWED with the reason. Otherwise '
      + 'fix the GEOMETRY: a material flag cannot correct one emitter without inverting every other.',
    ).toEqual([]);
    expect(ALLOWED.size, 'the allowlist must not be able to swallow the whole tree').toBeLessThan(5);

    // The scan is only worth its ALLOWED list if it can actually see the
    // spellings someone reaches for. Each of these is a real, working way to
    // invert or disable culling in Babylon; the last three are the ones this
    // pattern let through until the P6 review.
    for (const bypass of [
      'material.sideOrientation = BABYLON.Material.ClockWiseSideOrientation;',
      'vertexData.flipFaces();',
      'scene.useRightHandedSystem = true;',
      'material.backFaceCulling = false;',
      'mesh.cullBackFaces = false;',
      'scene.overrideMaterialSideOrientation = BABYLON.Material.ClockWiseSideOrientation;',
      'new BABYLON.StandardMaterial("m", scene, { backFaceCulling: false })',
      'CreateSphere("s", { diameter: 2, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene)',
    ]) {
      expect(FLIPPERS.test(bypass), `FLIPPERS does not see: ${bypass}`).toBe(true);
    }
    // ...and does not fire on the harmless neighbours of those spellings,
    // which is what keeps the allowlist from having to absorb false hits.
    for (const innocent of [
      'material.backFaceCulling = true;',
      'mesh.cullBackFaces = true;',
      'const sideLength = 3;',
      'const orientation = "north";',
    ]) {
      expect(FLIPPERS.test(innocent), `FLIPPERS falsely fires on: ${innocent}`).toBe(false);
    }
  });

  it('front-face-out is anchored to GEOMETRY, not only to self-consistency', () => {
    // windingCensus pins indices against the AUTHORED NORMALS, which makes
    // every assertion in group 2 a MUTUAL-consistency check: invert a
    // generator's index order AND negate the normals it writes, and the
    // census still reads 100% anti-parallel while every surface faces inward
    // on a real GPU. Terrain has an independent anchor (its normals are
    // derived from the height field, so they cannot be negated without the
    // lighting going obviously wrong), props and actors did not.
    //
    // Signed volume is that anchor. For a closed mesh
    // V = (1/6) * sum over triangles of det[v0, v1, v2] about an interior
    // point; reversing a triangle negates its determinant, so reversing every
    // triangle negates V, while negating the normals does not touch it. So a
    // double inversion — invisible to the census — flips this sign.
    //
    // The reference sign is TAKEN FROM BABYLON, the same way group 1 takes
    // the winding convention rather than remembering it.
    const signedVolume = ({ positions, indices }) => {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      const n = positions.length / 3;
      for (let i = 0; i < positions.length; i += 3) {
        cx += positions[i]; cy += positions[i + 1]; cz += positions[i + 2];
      }
      cx /= n; cy /= n; cz /= n;
      let vol = 0;
      let area = 0;
      for (let t = 0; t < indices.length; t += 3) {
        const i0 = indices[t] * 3;
        const i1 = indices[t + 1] * 3;
        const i2 = indices[t + 2] * 3;
        const ax = positions[i0] - cx;
        const ay = positions[i0 + 1] - cy;
        const az = positions[i0 + 2] - cz;
        const bx = positions[i1] - cx;
        const by = positions[i1 + 1] - cy;
        const bz = positions[i1 + 2] - cz;
        const gx = positions[i2] - cx;
        const gy = positions[i2 + 1] - cy;
        const gz = positions[i2 + 2] - cz;
        vol += ax * (by * gz - bz * gy) - ay * (bx * gz - bz * gx) + az * (bx * gy - by * gx);
        const ux = bx - ax;
        const uy = by - ay;
        const uz = bz - az;
        const vx = gx - ax;
        const vy = gy - ay;
        const vz = gz - az;
        area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      }
      // Normalized by area^1.5 so the floor below is scale-free: a 2 m tree
      // and a 0.2 m blob are held to the same shape criterion.
      return { vol: vol / 6, shape: (vol / 6) / (area ** 1.5) };
    };

    const reference = {
      CreateSphere: BABYLON.CreateSphereVertexData({ diameter: 2, segments: 8 }),
      CreateBox: BABYLON.CreateBoxVertexData({ size: 1 }),
      CreateCylinder: BABYLON.CreateCylinderVertexData({ height: 2, diameter: 1, tessellation: 12 }),
      CreateIcoSphere: BABYLON.CreateIcoSphereVertexData({ radius: 1, subdivisions: 1 }),
    };
    const signs = Object.entries(reference).map(([name, vd]) => [name, Math.sign(signedVolume(vd).vol)]);
    for (const [name, sign] of signs) {
      expect(sign, `${name} has no signed volume to take a sign from`).not.toBe(0);
    }
    const OUTWARD = signs[0][1];
    for (const [name, sign] of signs) {
      expect(sign, `${name} disagrees with ${signs[0][0]} about which sign is outward`).toBe(OUTWARD);
    }
    // Measured on babylonjs 9.19.0: all four are NEGATIVE (sphere -4.019,
    // box -1.000, cylinder -1.500, icosphere -2.536), which is the same
    // statement as group 1's "RH cross anti-parallel to the outward normal",
    // arrived at without reading a single normal.
    expect(OUTWARD).toBe(-1);

    // Two families, and only two. Terrain chunks are an open SHEET, whose
    // signed volume about its own centroid measures whatever the height
    // field happens to do (+602 and +3699 for the two shipped densities) and
    // says nothing about facing; addBladeFan is single-sided quads, which are
    // not a volume at all (+7.6e-4). Both are excluded on that ground, not
    // because they are inconvenient — and terrain keeps its own anchor.
    const SHAPE_MIN = 0.005;
    const bodies = [
      ['addTube', (() => { const a = newAccumulator(); addTube(a, [0, 0, 0], [0, 1, 0], 0.3, 0.2, 8, [1, 1, 1]); return finalize(a); })()],
      ...[0, 1, 2].map((level) => [`addBlob level ${level}`, (() => {
        const a = newAccumulator(); addBlob(a, [0, 0, 0], 0.4, level, [1, 1, 1]); return finalize(a);
      })()]),
      ...PROTOTYPES.flatMap((p) => Array.from(
        { length: p.stages }, (_, s) => [`prop ${p.id} s${s}`, buildPrototypePayload(p.id, s)],
      )),
      ...ARCHETYPES.flatMap((a) => Array.from(
        { length: a.stages }, (_, s) => [`actor ${a.id} s${s}`, buildActorPayload(a.id, s)],
      )),
    ];
    expect(bodies.length, 'the sweep must cover both generator families').toBe(23);
    for (const [label, payload] of bodies) {
      const { vol, shape } = signedVolume(payload);
      expect(
        Math.sign(vol),
        `${label}: signed volume ${vol.toExponential(3)} has the sign of an INSIDE-OUT body. Every one of `
        + 'its triangles is wound backwards. The winding census cannot see this if the normals were '
        + 'negated to match — that is exactly what this assertion is for. Fix the index order.',
      ).toBe(OUTWARD);
      expect(
        Math.abs(shape),
        `${label}: |signed volume| / area^1.5 is ${Math.abs(shape).toFixed(5)}, near enough to zero that its `
        + 'sign is noise rather than evidence — this body no longer encloses anything, so the assertion '
        + 'above just passed without measuring',
      ).toBeGreaterThan(SHAPE_MIN);
    }
    // Measured range at 2026-08-06: props -0.0111 (tuft) to -0.0879
    // (boulder), actors -0.0177 (legion far) to -0.0225 (orghon near),
    // primitives -0.0618 to -0.0918. The floor sits at 45% of the tightest.
  });
});

// ── 2. EVERYTHING THE REALM GENERATES ───────────────────────────────────────

describe('2. every generated payload winds its front face outward', () => {
  // The primitives in isolation, so a regression names the emitter rather
  // than the twelve payloads that compose it.
  it('addTube', () => {
    const acc = newAccumulator();
    addTube(acc, [0, 0, 0], [0, 1, 0], 0.3, 0.2, 8, [1, 1, 1]);
    expectFrontFaceOut('addTube', finalize(acc));
  });

  for (const level of [0, 1, 2]) {
    it(`addBlob level ${level} (${['octahedron', 'icosahedron', 'icosphere'][level]})`, () => {
      // All three levels, because sphereFaces' level-2 subdivision emits its
      // own face triples ([a,ab,ca], [ab,b,bc], [ca,bc,c], [ab,bc,ca]) rather
      // than reusing the base table's, so one level can be right while
      // another is wrong.
      const acc = newAccumulator();
      addBlob(acc, [0, 0, 0], 0.4, level, [1, 1, 1]);
      expectFrontFaceOut(`addBlob level ${level}`, finalize(acc));
    });
  }

  it('addBladeFan', () => {
    // Single-sided by design (see its doc comment) — which makes WHICH side
    // survives culling the entire question, not a detail.
    const acc = newAccumulator();
    addBladeFan(acc, 4, 0.2, 0.5, [1, 1, 1], 7);
    expectFrontFaceOut('addBladeFan', finalize(acc));
  });

  const field = createTerrainField();
  for (const [label, opts] of [
    ['terrain chunk sub 8', { cx: 0, cz: 0, size: 64, subdivisions: 8 }],
    ['terrain chunk sub 48 (the runtime density)', { cx: 3, cz: -2, size: 64, subdivisions: 48 }],
  ]) {
    it(label, () => {
      expectFrontFaceOut(label, generateTerrainChunk(field, opts));
    });
  }

  for (const proto of PROTOTYPES) {
    for (let stage = 0; stage < proto.stages; stage++) {
      it(`prop ${proto.id} stage ${stage}`, () => {
        // The boulder is the one prototype whose normals are DERIVED from the
        // winding (growBoulder's flat-shade pass), so it is the one that can
        // agree with itself while both halves are inverted together. It is
        // covered here because the pass negates the cross deliberately; if
        // someone drops that negation this fires.
        expectFrontFaceOut(`prop ${proto.id} s${stage}`, buildPrototypePayload(proto.id, stage));
      });
    }
  }

  for (const arch of ARCHETYPES) {
    for (let stage = 0; stage < arch.stages; stage++) {
      it(`actor ${arch.id} stage ${stage}`, () => {
        // The composition that made this Critical: addMass is one addTube
        // plus up to two addBlob caps, and the caps are 76-85% of a near
        // stage's triangles. A blob-only regression therefore shows up here
        // as a majority of the body, not as a rounding error.
        expectFrontFaceOut(`actor ${arch.id} s${stage}`, buildActorPayload(arch.id, stage));
      });
    }
  }

  it('the sweep above actually covered the whole roster', () => {
    // Anti-vacuity: an empty PROTOTYPES or ARCHETYPES would make every
    // generated case above disappear silently rather than fail, and a
    // stage-count regression would quietly halve the coverage.
    expect(PROTOTYPES.length).toBeGreaterThanOrEqual(7);
    expect(ARCHETYPES.length).toBeGreaterThanOrEqual(4);
    expect(RENDERED_STAGES).toBe(2);
    const propStages = PROTOTYPES.reduce((n, p) => n + p.stages, 0);
    const actorStages = ARCHETYPES.reduce((n, a) => n + a.stages, 0);
    // 11 prop payloads (tuft ships a single stage) + 8 actor ones.
    expect({ propStages, actorStages }).toEqual({ propStages: 11, actorStages: 8 });
  });
});
