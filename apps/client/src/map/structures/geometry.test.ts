import { describe, expect, it } from 'vitest';
import {
  appendGeom,
  boundsOf,
  decimateByClustering,
  dropUnused,
  flatShade,
  flipWinding,
  swatchUvs,
  transformGeom,
  triangleCount,
  vertexCount,
  windingSign,
  type Geom,
} from './geometry';

const GRID = { cols: 8, rows: 4 };

/** Unit quad in the XZ plane facing +y, wound so cross(b-a, c-a) = +y. */
function quad(): Geom {
  return {
    positions: [0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    uvs: [0.3, 0.1, 0.3, 0.1, 0.3, 0.1, 0.3, 0.1],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

/** A finely subdivided flat grid (n × n quads), facing +y. */
function grid(n: number, size = 1): Geom {
  const g: Geom = { positions: [], normals: [], uvs: [], indices: [] };
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      g.positions.push((i / n) * size, 0, (j / n) * size);
      g.normals.push(0, 1, 0);
      g.uvs.push(0.3, 0.1);
    }
  const id = (i: number, j: number) => i * (n + 1) + j;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      g.indices.push(
        id(i, j),
        id(i, j + 1),
        id(i + 1, j + 1),
        id(i, j),
        id(i + 1, j + 1),
        id(i + 1, j),
      );
  return g;
}

describe('winding', () => {
  it('measures and flips the winding convention', () => {
    expect(windingSign(quad())).toBe(1);
    expect(windingSign(flipWinding(quad()))).toBe(-1);
  });
  it('a mirroring scale keeps faces outward', () => {
    const m = transformGeom(quad(), { scale: [1, 1, -1] });
    expect(windingSign(m)).toBe(1);
  });
});

describe('transformGeom', () => {
  it('rotates like Babylon rotation.y (local +z → +x at 90°)', () => {
    const g: Geom = { positions: [0, 0, 1], normals: [0, 0, 1], uvs: [0, 0], indices: [] };
    const r = transformGeom(g, { rotY: Math.PI / 2, translate: [10, 0, 0] });
    expect(r.positions[0]).toBeCloseTo(11);
    expect(r.positions[2]).toBeCloseTo(0);
    expect(r.normals[0]).toBeCloseTo(1);
  });
  it('keeps normals unit length under non-uniform scale', () => {
    const g: Geom = {
      positions: [1, 1, 0],
      normals: [Math.SQRT1_2, Math.SQRT1_2, 0],
      uvs: [0, 0],
      indices: [],
    };
    const r = transformGeom(g, { scale: [4, 1, 1] });
    expect(Math.hypot(r.normals[0]!, r.normals[1]!, r.normals[2]!)).toBeCloseTo(1);
    // Stretching x flattens the surface, so the normal leans toward +y.
    expect(r.normals[1]!).toBeGreaterThan(r.normals[0]!);
  });
});

describe('appendGeom / dropUnused / flatShade', () => {
  it('offsets appended indices', () => {
    const g = appendGeom(quad(), quad());
    expect(vertexCount(g)).toBe(8);
    expect(g.indices.slice(6)).toEqual([4, 5, 6, 4, 6, 7]);
  });
  it('drops unreferenced vertices', () => {
    const g = quad();
    g.indices = [0, 1, 2];
    expect(vertexCount(dropUnused(g))).toBe(3);
  });
  it('flat shading gives each triangle its face normal', () => {
    const f = flatShade(quad(), 1);
    expect(vertexCount(f)).toBe(6);
    for (let i = 0; i < f.normals.length; i += 3)
      expect(f.normals.slice(i, i + 3)).toEqual([0, 1, 0]);
    expect(flatShade(quad(), -1).normals[1]).toBe(-1);
  });
});

describe('decimateByClustering', () => {
  it('collapses a fine flat grid to a few triangles and keeps its extent', () => {
    const g = grid(16);
    const d = decimateByClustering(g, 0.26, GRID);
    expect(triangleCount(d)).toBeLessThan(triangleCount(g) / 4);
    expect(triangleCount(d)).toBeGreaterThan(0);
    const b = boundsOf(d);
    expect(b.max[0] - b.min[0]).toBeGreaterThan(0.7);
    expect(windingSign(d)).toBe(1);
  });
  it('never merges across atlas swatches', () => {
    const g = appendGeom(quad(), {
      ...quad(),
      uvs: quad().uvs.map((v, i) => (i % 2 === 0 ? 0.6 : v)),
    });
    const d = decimateByClustering(g, 10, GRID); // everything in one spatial cell
    // Two swatches → two clusters per spatial cell, so two separate (degenerate) groups: nothing survives,
    // but no vertex may average the two swatches together.
    for (let i = 0; i < d.uvs.length; i += 2) expect([0.3, 0.6]).toContain(d.uvs[i]);
  });
  it('keeps hard edges: faces with different normal directions stay separate', () => {
    const top = quad();
    const side: Geom = transformGeom(quad(), { rotZ: -Math.PI / 2 }); // facing +x
    const d = decimateByClustering(appendGeom(appendGeom(emptyLike(), top), side), 0.01, GRID);
    const ups = [];
    for (let i = 0; i < d.normals.length; i += 3) ups.push(Math.round(d.normals[i + 1]!));
    expect(new Set(ups)).toEqual(new Set([0, 1]));
  });
  it('is deterministic', () => {
    const g = grid(9);
    expect(decimateByClustering(g, 0.2, GRID)).toEqual(decimateByClustering(g, 0.2, GRID));
  });
});

function emptyLike(): Geom {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

describe('swatchUvs', () => {
  it('runs the swatch gradient bottom (dark) to top (light) inside one cell', () => {
    const g: Geom = {
      positions: [0, 0, 0, 0, 2, 0],
      normals: [0, 1, 0, 0, 1, 0],
      uvs: [0, 0, 0, 0],
      indices: [],
    };
    const s = swatchUvs(g, 2, 1, GRID, 0);
    expect(s.uvs[0]).toBeCloseTo(2.5 / 8);
    expect(s.uvs[1]).toBeCloseTo(2 / 4); // bottom vertex → bottom of row 1
    expect(s.uvs[3]).toBeCloseTo(1 / 4); // top vertex → top of row 1
  });
});
