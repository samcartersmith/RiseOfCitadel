/**
 * Vertex data for one terrain chunk at one level of detail, from the baked
 * height grid. Pure (typed arrays only) so it is unit tested without a GPU.
 *
 * - Positions are scene units (map × `scale`).
 * - Normals come from the full-resolution grid at every LOD, so lighting
 *   doesn't pop when a chunk switches level.
 * - Each cell A(i,j) B(i+1,j) C(i,j+1) D(i+1,j+1) is split along the
 *   diagonal `splitsAD` picks (the flatter one), the same split
 *   `sampleHeightGrid` interpolates on. Winding matches Babylon's ground.
 * - A skirt hangs `skirtDepth` below every chunk edge (both windings) and
 *   hides cracks between neighbours at different LODs.
 */
import { gridNormal, splitsAD, type HeightGrid } from './heightGrid';

export interface ChunkArrays {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Triangles excluding the skirt. */
  surfaceTriangles: number;
}

export interface ChunkSpec {
  /** Chunk column / row (x / z). */
  ci: number;
  cj: number;
  /** Grid cells per chunk side at full detail. */
  cells: number;
  /** Grid samples skipped per vertex (1 = full detail, 2, 4…); must divide `cells`. */
  stride: number;
  /** Scene units per map unit. */
  scale: number;
  /** Skirt depth in scene units (0 = none). */
  skirtDepth: number;
}

export function buildChunkArrays(g: HeightGrid, spec: ChunkSpec): ChunkArrays {
  const { ci, cj, cells, stride, scale, skirtDepth } = spec;
  if (cells % stride !== 0) throw new Error(`stride ${stride} must divide ${cells}`);
  const n = cells / stride; // quads per side
  const v = n + 1; // vertices per side
  const edge = skirtDepth > 0 ? 4 * v : 0;
  const vertCount = v * v + edge;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const i0 = ci * cells;
  const j0 = cj * cells;

  const put = (k: number, gi: number, gj: number, drop: number) => {
    positions[k * 3] = (g.origin + gi * g.step) * scale;
    positions[k * 3 + 1] = g.heights[gj * g.size + gi]! * scale - drop;
    positions[k * 3 + 2] = (g.origin + gj * g.step) * scale;
    gridNormal(g, gi, gj, normals, k * 3);
  };
  for (let b = 0; b < v; b++) {
    for (let a = 0; a < v; a++) put(b * v + a, i0 + a * stride, j0 + b * stride, 0);
  }

  const surfaceTriangles = n * n * 2;
  const skirtTriangles = skirtDepth > 0 ? 4 * n * 4 : 0;
  const idxCount = (surfaceTriangles + skirtTriangles) * 3;
  const indices = vertCount > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount);
  let t = 0;
  const tri = (p: number, q: number, r: number) => {
    indices[t++] = p;
    indices[t++] = q;
    indices[t++] = r;
  };
  for (let b = 0; b < n; b++) {
    for (let a = 0; a < n; a++) {
      const A = b * v + a;
      const B = A + 1;
      const C = A + v;
      const D = C + 1;
      const y = (k: number) => positions[k * 3 + 1]!;
      if (splitsAD(y(A), y(B), y(C), y(D))) {
        tri(A, B, D);
        tri(A, D, C);
      } else {
        tri(B, D, C);
        tri(A, B, C);
      }
    }
  }

  if (skirtDepth > 0) {
    // Four edges, each as a list of surface vertex indices in order.
    const edges: number[][] = [
      Array.from({ length: v }, (_, a) => a), // south
      Array.from({ length: v }, (_, a) => (v - 1) * v + a), // north
      Array.from({ length: v }, (_, b) => b * v), // west
      Array.from({ length: v }, (_, b) => b * v + v - 1), // east
    ];
    let k = v * v;
    for (const e of edges) {
      const base = k;
      for (const s of e) {
        const a = s % v;
        const b = Math.floor(s / v);
        put(k++, i0 + a * stride, j0 + b * stride, skirtDepth);
      }
      for (let m = 0; m < n; m++) {
        const p0 = e[m]!;
        const p1 = e[m + 1]!;
        const q0 = base + m;
        const q1 = base + m + 1;
        tri(p0, p1, q1);
        tri(p0, q1, q0);
        tri(p0, q1, p1);
        tri(p0, q0, q1);
      }
    }
  }
  return { positions, normals, indices, surfaceTriangles };
}
