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
    expect(chunk.indices).toHaveLength(8 * 8 * 6);
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
    // First cell, first triangle (a, c, b): its winding must produce a +Y
    // face normal or the entire ground is invisible under backface culling.
    const [a, c, b] = [chunk.indices[0], chunk.indices[1], chunk.indices[2]];
    const P = chunk.positions;
    const ax = P[a * 3], az = P[a * 3 + 2];
    const bx = P[b * 3], bz = P[b * 3 + 2];
    const cx_ = P[c * 3], cz_ = P[c * 3 + 2];
    // (c-a) x (b-a) . +Y
    const crossY = (cz_ - az) * (bx - ax) - (cx_ - ax) * (bz - az);
    expect(crossY).toBeGreaterThan(0);
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
