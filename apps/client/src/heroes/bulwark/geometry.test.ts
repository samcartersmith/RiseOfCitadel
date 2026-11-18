import { describe, expect, it } from 'vitest';
import {
  archOutline,
  box,
  cylinder,
  extrude,
  frame,
  lump,
  mergeMeshes,
  torus,
  transformMesh,
  triangleCount,
  type MeshData,
} from './geometry';
import { cellOf } from './palette';

const CELL = '5,0' as const;

/** Every face normal of a closed convex-ish shape should point away from its centroid. */
function outwardFraction(m: MeshData): number {
  const n = m.positions.length / 3;
  const c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k]! += m.positions[i * 3 + k]! / n;
  let out = 0;
  const tris = m.indices.length / 3;
  for (let t = 0; t < tris; t++) {
    const ids = [0, 1, 2].map((j) => m.indices[t * 3 + j]!);
    const p = ids.map((i) => [0, 1, 2].map((k) => m.positions[i * 3 + k]!));
    const e1 = [0, 1, 2].map((k) => p[1]![k]! - p[0]![k]!);
    const e2 = [0, 1, 2].map((k) => p[2]![k]! - p[0]![k]!);
    const nrm = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    const mid = [0, 1, 2].map((k) => (p[0]![k]! + p[1]![k]! + p[2]![k]!) / 3 - c[k]!);
    if (nrm[0]! * mid[0]! + nrm[1]! * mid[1]! + nrm[2]! * mid[2]! > 0) out++;
  }
  return out / tris;
}

function expectWellFormed(m: MeshData) {
  const verts = m.positions.length / 3;
  expect(m.normals.length).toBe(m.positions.length);
  expect(m.uvs.length).toBe(verts * 2);
  expect(m.indices.length % 3).toBe(0);
  for (const i of m.indices) expect(i).toBeLessThan(verts);
  for (let i = 0; i < verts; i++) {
    const l = Math.hypot(m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!);
    expect(l).toBeCloseTo(1, 4);
  }
}

describe('bulwark geometry kit', () => {
  it('builds primitives with the documented triangle counts', () => {
    expect(triangleCount(box([1, 1, 1], CELL))).toBe(12);
    expect(triangleCount(cylinder(1, 1, 1, 6, CELL))).toBe(12 + 8);
    expect(triangleCount(cylinder(1, 1, 1, 6, CELL, {}, false))).toBe(12);
    expect(triangleCount(torus(1, 0.2, 6, 3, CELL))).toBe(36);
    expect(triangleCount(lump(6, 3, 0.3, 1, CELL))).toBe(2 * 6 * 2);
    const arch = archOutline(1, 2, 8);
    expect(triangleCount(extrude(arch, 0.1, CELL))).toBe(2 * (arch.length - 2) + 2 * arch.length);
  });

  it('winds closed shapes with outward faces (glTF counter-clockwise)', () => {
    for (const m of [
      box([1, 2, 3], CELL),
      cylinder(0.5, 0.3, 1, 6, CELL),
      lump(6, 3, 0, 1, CELL),
      extrude(archOutline(1, 2, 8), 0.2, CELL),
    ]) {
      expectWellFormed(m);
      expect(outwardFraction(m)).toBe(1);
    }
  });

  it('keeps faces outward under mirroring transforms', () => {
    const m = transformMesh(box([1, 1, 1], CELL), { s: [-1, 1, 1], t: [3, 0, 0] });
    expect(outwardFraction(m)).toBe(1);
  });

  it('builds an open frame band with end caps', () => {
    const o = archOutline(1, 2, 4).slice(1);
    const i = archOutline(0.8, 1.9, 4).slice(1);
    const m = frame(o, i, 0.2, CELL, false);
    expectWellFormed(m);
    expect(triangleCount(m)).toBe((o.length - 1) * 8 + 4);
  });

  it('maps every vertex into its atlas cell', () => {
    const m = mergeMeshes([box([1, 1, 1], '0,2'), torus(1, 0.2, 6, 3, '0,2')]);
    for (let i = 0; i < m.uvs.length; i += 2) expect(cellOf(m.uvs[i]!, m.uvs[i + 1]!)).toBe('0,2');
  });

  it('draws the gate arch from bottom corners over a half circle', () => {
    const a = archOutline(2, 3, 8);
    expect(a[0]).toEqual([-1, 0]);
    expect(a[1]).toEqual([1, 0]);
    const top = a[2 + 4]!;
    expect(top[0]).toBeCloseTo(0, 6);
    expect(top[1]).toBeCloseTo(3, 6);
  });
});
