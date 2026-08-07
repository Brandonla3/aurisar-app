import { describe, expect, it } from 'vitest';
import { createTerrainField } from '../model/terrainField.js';
import { generateTerrainChunk } from './terrainChunkGen.js';

const field = createTerrainField();

describe('generateTerrainChunk', () => {
  const chunk = generateTerrainChunk(field, { cx: 0, cz: 0, size: 64, subdivisions: 8 });

  it('emits the expected array sizes', () => {
    const verts = 9 * 9;
    expect(chunk.positions).toHaveLength(verts * 3);
    expect(chunk.normals).toHaveLength(verts * 3);
    expect(chunk.uvs).toHaveLength(verts * 2);
    expect(chunk.colors).toHaveLength(verts * 4);
    expect(chunk.indices).toHaveLength(8 * 8 * 6);
  });

  it('colors carry field.shadeProxyAt, replicated across r/g/b with alpha 1', () => {
    // Vertex 0 is local (0,0) at this chunk's origin (0,0) -> world (0,0).
    const shade = field.shadeProxyAt(0, 0);
    expect(chunk.colors[0]).toBeCloseTo(shade, 6); // r
    expect(chunk.colors[1]).toBeCloseTo(shade, 6); // g
    expect(chunk.colors[2]).toBeCloseTo(shade, 6); // b
    expect(chunk.colors[3]).toBe(1); // a
  });

  it('every index is a valid vertex', () => {
    const verts = 9 * 9;
    for (const i of chunk.indices) expect(i).toBeLessThan(verts);
  });

  it('positions are chunk-local, heights are world truth', () => {
    // Local XZ start at 0 (float precision stays flat across the world)...
    expect(chunk.positions[0]).toBe(0);
    expect(chunk.positions[2]).toBe(0);
    // ...but Y is the real field value at the WORLD position. Close-to, not
    // exact: the payload is deliberately Float32 (GPU-bound), the field is a
    // double. f32 has ~7 significant digits; 5 decimal places is within that.
    expect(chunk.positions[1]).toBeCloseTo(field.surfaceY(0, 0), 5);

    const far = generateTerrainChunk(field, { cx: 5, cz: -3, size: 64, subdivisions: 8 });
    expect(far.positions[1]).toBeCloseTo(field.surfaceY(5 * 64, -3 * 64), 4);
  });

  it('edge vertices land exactly on the chunk boundary, for ANY subdivision count', () => {
    // The seam guarantee must hold by construction, not by lucky divisors.
    // lx = (ix/sub)*size gives exactly `size` at the far edge for every sub;
    // the step form ix*(size/sub) only does when sub*(size/sub) rounds back.
    // 7 and 13 are deliberately awkward non-power-of-two divisors of nothing.
    for (const sub of [7, 13, 48]) {
      const c = generateTerrainChunk(field, { cx: 2, cz: 1, size: 64, subdivisions: sub });
      const verts = sub + 1;
      // Far-edge column: local X must be exactly 64.
      expect(c.positions[(verts - 1) * 3]).toBe(64);
      // Far-edge row: local Z must be exactly 64.
      expect(c.positions[((verts - 1) * verts) * 3 + 2]).toBe(64);
    }
  });

  it('adjacent chunks agree exactly at the RUNTIME subdivision density', () => {
    // The original seam test pinned subdivisions: 8 while the streamer ships
    // 48 — a green test about a configuration nobody runs. This is the real one.
    const sub = 48;
    const left = generateTerrainChunk(field, { cx: 0, cz: 0, size: 64, subdivisions: sub });
    const right = generateTerrainChunk(field, { cx: 1, cz: 0, size: 64, subdivisions: sub });
    const verts = sub + 1;
    for (let iz = 0; iz < verts; iz++) {
      const li = (iz * verts + sub) * 3;
      const ri = (iz * verts + 0) * 3;
      expect(right.positions[ri + 1]).toBe(left.positions[li + 1]);
      expect(right.normals[ri]).toBe(left.normals[li]);
      expect(right.normals[ri + 1]).toBe(left.normals[li + 1]);
      expect(right.normals[ri + 2]).toBe(left.normals[li + 2]);
    }
  });

  it('adjacent chunks agree exactly along their shared edge', () => {
    // The seam test. Chunks tessellate independently; if the shared-edge
    // vertices (or their normals) differed at all, every chunk border would
    // render as a visible tear or lighting crease.
    const sub = 8;
    const left = generateTerrainChunk(field, { cx: 0, cz: 0, size: 64, subdivisions: sub });
    const right = generateTerrainChunk(field, { cx: 1, cz: 0, size: 64, subdivisions: sub });

    const verts = sub + 1;
    for (let iz = 0; iz < verts; iz++) {
      const li = (iz * verts + sub) * 3; // left chunk's max-X column
      const ri = (iz * verts + 0) * 3;   // right chunk's min-X column
      expect(right.positions[ri + 1]).toBe(left.positions[li + 1]); // same height
      expect(right.normals[ri]).toBe(left.normals[li]);             // same normal
      expect(right.normals[ri + 1]).toBe(left.normals[li + 1]);
      expect(right.normals[ri + 2]).toBe(left.normals[li + 2]);
    }
  });

  it('triangles face up', () => {
    // The claim this test has always MEANT to make: the up-facing side of the
    // ground must be Babylon's FRONT face, or the entire ground is invisible
    // under backface culling. What it asserted until the P6 final review was
    // the opposite sign — and the ground was in fact invisible on hardware.
    //
    // Front face here = right-handed cross (v1-v0)x(v2-v0) pointing AWAY from
    // the viewer, so for a ground plane seen from above it points DOWN.
    // gen/winding.test.js is where that convention is measured off Babylon's
    // own primitives; this test just pins the first cell of the first chunk so
    // a reversal shows up in the file that emits it, not only in the sweep.
    const P = chunk.positions;
    const y = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    for (const t of [0, 3]) {
      const [v0, v1, v2] = [y(chunk.indices[t]), y(chunk.indices[t + 1]), y(chunk.indices[t + 2])];
      const ux = v1[0] - v0[0], uz = v1[2] - v0[2];
      const vx = v2[0] - v0[0], vz = v2[2] - v0[2];
      // ((v1-v0) x (v2-v0)).y
      const crossY = uz * vx - ux * vz;
      expect(crossY, `triangle ${t / 3} of the first cell is wound with its RH cross UP, which is the BACK `
        + 'face — the ground would be culled away entirely').toBeLessThan(0);
    }
  });

  it('tracks its own height range for bounds', () => {
    expect(chunk.minY).toBeLessThanOrEqual(chunk.maxY);
    expect(Number.isFinite(chunk.minY)).toBe(true);
  });

  it('is deterministic', () => {
    const again = generateTerrainChunk(field, { cx: 0, cz: 0, size: 64, subdivisions: 8 });
    expect(again.positions).toEqual(chunk.positions);
    expect(again.indices).toEqual(chunk.indices);
  });
});
