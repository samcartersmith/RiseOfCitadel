/**
 * Tiny low-poly geometry kit for Bulwark's kit-bash parts (gate shield, mace,
 * chains, moss, stone chunks). Pure TypeScript, no Babylon, so the shapes and
 * their triangle counts are unit-tested and the parts are reproducible from
 * code (no hand-edited binaries).
 *
 * Conventions: right-handed glTF space (+Y up), counter-clockwise front faces,
 * flat normals (faceted low-poly look). Every vertex samples one atlas cell
 * (see palette.ts); `v` runs down the cell's vertical gradient by the vertex's
 * height inside its primitive, so parts get the same top-light/bottom-dark
 * shading as the KayKit body.
 */
import { cellUv, type CellId } from './palette';

export interface MeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export type Vec3 = readonly [number, number, number];

export interface Xform {
  /** Translation. */
  t?: Vec3;
  /** Euler rotation in radians, applied X then Y then Z. */
  r?: Vec3;
  /** Scale (applied first). */
  s?: Vec3;
}

export const emptyMesh = (): MeshData => ({ positions: [], normals: [], uvs: [], indices: [] });

export function triangleCount(m: MeshData): number {
  return m.indices.length / 3;
}

/** Append `src` to `dst` (indices are rebased). */
export function appendMesh(dst: MeshData, src: MeshData): MeshData {
  const base = dst.positions.length / 3;
  dst.positions.push(...src.positions);
  dst.normals.push(...src.normals);
  dst.uvs.push(...src.uvs);
  for (const i of src.indices) dst.indices.push(i + base);
  return dst;
}

export function mergeMeshes(parts: readonly MeshData[]): MeshData {
  const out = emptyMesh();
  for (const p of parts) appendMesh(out, p);
  return out;
}

// ---- transforms ----------------------------------------------------------------

type Mat3 = [number, number, number, number, number, number, number, number, number];

function rotation([x, y, z]: Vec3): Mat3 {
  const [cx, sx, cy, sy, cz, sz] = [
    Math.cos(x),
    Math.sin(x),
    Math.cos(y),
    Math.sin(y),
    Math.cos(z),
    Math.sin(z),
  ];
  // R = Rz * Ry * Rx (X applied first), row-major.
  return [
    cz * cy,
    cz * sy * sx - sz * cx,
    cz * sy * cx + sz * sx,
    sz * cy,
    sz * sy * sx + cz * cx,
    sz * sy * cx - cz * sx,
    -sy,
    cy * sx,
    cy * cx,
  ];
}

/** Transform a mesh in place: scale, then rotate, then translate. Normals use the inverse-transpose. */
export function transformMesh(m: MeshData, xf: Xform): MeshData {
  const s = xf.s ?? [1, 1, 1];
  const R = rotation(xf.r ?? [0, 0, 0]);
  const t = xf.t ?? [0, 0, 0];
  const p = m.positions;
  const n = m.normals;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]! * s[0];
    const y = p[i + 1]! * s[1];
    const z = p[i + 2]! * s[2];
    p[i] = R[0] * x + R[1] * y + R[2] * z + t[0];
    p[i + 1] = R[3] * x + R[4] * y + R[5] * z + t[1];
    p[i + 2] = R[6] * x + R[7] * y + R[8] * z + t[2];
    // Inverse-transpose of (R * S) is R * S^-1.
    const nx = n[i]! / s[0];
    const ny = n[i + 1]! / s[1];
    const nz = n[i + 2]! / s[2];
    const rx = R[0] * nx + R[1] * ny + R[2] * nz;
    const ry = R[3] * nx + R[4] * ny + R[5] * nz;
    const rz = R[6] * nx + R[7] * ny + R[8] * nz;
    const len = Math.hypot(rx, ry, rz) || 1;
    n[i] = rx / len;
    n[i + 1] = ry / len;
    n[i + 2] = rz / len;
  }
  // A mirroring scale flips winding; keep faces counter-clockwise.
  if (s[0] * s[1] * s[2] < 0) {
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = m.indices[i + 1]!;
      m.indices[i + 1] = m.indices[i + 2]!;
      m.indices[i + 2] = a;
    }
  }
  return m;
}

// ---- builder ---------------------------------------------------------------------

/**
 * Flat-shaded triangle soup builder: every face gets its own vertices so
 * normals stay faceted. UV `v` is assigned after the primitive is built,
 * from each vertex's height within the primitive (top = light).
 */
class Builder {
  readonly m = emptyMesh();

  /** Add a planar convex-or-star polygon (CCW seen from its front), fanned from `fan`. */
  poly(pts: readonly Vec3[], fan = 0): void {
    const k = pts.length;
    if (k < 3) return;
    // Newell's method: robust for fans whose first vertices are collinear.
    const nrm = newell(pts);
    const base = this.m.positions.length / 3;
    for (const p of pts) {
      this.m.positions.push(p[0], p[1], p[2]);
      this.m.normals.push(nrm[0], nrm[1], nrm[2]);
      this.m.uvs.push(0, 0);
    }
    for (let i = 1; i < k - 1; i++) {
      const i0 = (fan + 0) % k;
      const i1 = (fan + i) % k;
      const i2 = (fan + i + 1) % k;
      this.m.indices.push(base + i0, base + i1, base + i2);
    }
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
    this.poly([a, b, c, d]);
  }

  /** Assign every vertex to `cell`, with v from height (top of the primitive = top of the cell gradient). */
  finish(cell: CellId, shade: readonly [number, number] = [0.15, 0.85]): MeshData {
    const p = this.m.positions;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < p.length; i += 3) {
      lo = Math.min(lo, p[i]!);
      hi = Math.max(hi, p[i]!);
    }
    const span = hi - lo || 1;
    for (let i = 0; i < p.length / 3; i++) {
      const h = (hi - p[i * 3 + 1]!) / span; // 0 at the top
      const [u, v] = cellUv(cell, shade[0] + (shade[1] - shade[0]) * h);
      this.m.uvs[i * 2] = u;
      this.m.uvs[i * 2 + 1] = v;
    }
    return this.m;
  }
}

function newell(pts: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

// ---- primitives ------------------------------------------------------------------

/** Axis-aligned box centred on the origin. 12 triangles. */
export function box(size: Vec3, cell: CellId, xf: Xform = {}): MeshData {
  const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const b = new Builder();
  const v = (x: number, y: number, z: number): Vec3 => [x * hx, y * hy, z * hz];
  b.quad(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)); // +Z
  b.quad(v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)); // -Z
  b.quad(v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1)); // +X
  b.quad(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)); // -X
  b.quad(v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1)); // +Y
  b.quad(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)); // -Y
  return transformMesh(b.finish(cell), xf);
}

/**
 * Extrude a 2D polygon (x, y; counter-clockwise) along Z, centred on z = 0.
 * `fan` is the vertex the caps are fanned from (any vertex for convex shapes,
 * the reflex vertex for a swallowtail). Triangles: 2·(n−2) + 2·n.
 */
export function extrude(
  outline: readonly (readonly [number, number])[],
  depth: number,
  cell: CellId,
  xf: Xform = {},
  fan = 0,
): MeshData {
  const n = outline.length;
  const hz = depth / 2;
  const front = outline.map(([x, y]): Vec3 => [x, y, hz]);
  const back = outline.map(([x, y]): Vec3 => [x, y, -hz]).reverse();
  const b = new Builder();
  b.poly(front, fan);
  b.poly(back, (n - 1 - fan + n) % n);
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i]!;
    const [x1, y1] = outline[(i + 1) % n]!;
    b.quad([x0, y0, hz], [x0, y0, -hz], [x1, y1, -hz], [x1, y1, hz]);
  }
  return transformMesh(b.finish(cell), xf);
}

/**
 * A band between an outer and an inner outline (same vertex count, both CCW),
 * extruded along Z: a frame around a door or a shield rim. Open outlines
 * (`closed = false`) get end caps. Triangles: 8 per segment (+4 for caps).
 */
export function frame(
  outer: readonly (readonly [number, number])[],
  inner: readonly (readonly [number, number])[],
  depth: number,
  cell: CellId,
  closed = true,
  xf: Xform = {},
): MeshData {
  const n = outer.length;
  const hz = depth / 2;
  const b = new Builder();
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const [ox0, oy0] = outer[i]!;
    const [ox1, oy1] = outer[j]!;
    const [ix0, iy0] = inner[i]!;
    const [ix1, iy1] = inner[j]!;
    b.quad([ix0, iy0, hz], [ox0, oy0, hz], [ox1, oy1, hz], [ix1, iy1, hz]); // front
    b.quad([ox0, oy0, -hz], [ix0, iy0, -hz], [ix1, iy1, -hz], [ox1, oy1, -hz]); // back
    b.quad([ox0, oy0, hz], [ox0, oy0, -hz], [ox1, oy1, -hz], [ox1, oy1, hz]); // outer wall
    b.quad([ix1, iy1, hz], [ix1, iy1, -hz], [ix0, iy0, -hz], [ix0, iy0, hz]); // inner wall
  }
  if (!closed) {
    const cap = (o: readonly [number, number], i: readonly [number, number], flip: boolean) => {
      const q: Vec3[] = [
        [i[0], i[1], hz],
        [i[0], i[1], -hz],
        [o[0], o[1], -hz],
        [o[0], o[1], hz],
      ];
      b.poly(flip ? q.reverse() : q);
    };
    cap(outer[0]!, inner[0]!, false);
    cap(outer[n - 1]!, inner[n - 1]!, true);
  }
  return transformMesh(b.finish(cell), xf);
}

/** Cylinder along Y, centred on the origin. Triangles: 2·segments + (caps ? 2·(segments−2) : 0). */
export function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments: number,
  cell: CellId,
  xf: Xform = {},
  caps = true,
): MeshData {
  const b = new Builder();
  const hy = height / 2;
  const ring = (r: number, y: number) =>
    Array.from({ length: segments }, (_, i): Vec3 => {
      const a = (i / segments) * Math.PI * 2;
      return [Math.cos(a) * r, y, -Math.sin(a) * r];
    });
  const top = ring(radiusTop, hy);
  const bot = ring(radiusBottom, -hy);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    b.quad(bot[i]!, bot[j]!, top[j]!, top[i]!);
  }
  if (caps) {
    b.poly(top);
    b.poly([...bot].reverse());
  }
  return transformMesh(b.finish(cell), xf);
}

/** Torus in the XY plane (a chain link). Triangles: 2·major·minor. */
export function torus(
  radius: number,
  tube: number,
  major: number,
  minor: number,
  cell: CellId,
  xf: Xform = {},
): MeshData {
  const b = new Builder();
  const pt = (i: number, j: number): Vec3 => {
    const u = (i / major) * Math.PI * 2;
    const v = (j / minor) * Math.PI * 2;
    const r = radius + tube * Math.cos(v);
    return [Math.cos(u) * r, Math.sin(u) * r, tube * Math.sin(v)];
  };
  for (let i = 0; i < major; i++) {
    for (let j = 0; j < minor; j++) {
      b.quad(pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1));
    }
  }
  return transformMesh(b.finish(cell), xf);
}

/** Deterministic pseudo-random in [0, 1) from an integer seed (for rock jitter). */
export function hash01(seed: number): number {
  let t = (seed * 0x9e3779b1) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Faceted lump (moss clump, stone chunk): a low-poly UV sphere with
 * deterministic radial jitter. Triangles: 2·segments·(rings−1).
 */
export function lump(
  segments: number,
  rings: number,
  jitter: number,
  seed: number,
  cell: CellId,
  xf: Xform = {},
): MeshData {
  const b = new Builder();
  const grid: Vec3[][] = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    const row: Vec3[] = [];
    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const pole = r === 0 || r === rings;
      const k = pole ? 1 : 1 + (hash01(seed * 131 + r * 17 + s) - 0.5) * 2 * jitter;
      row.push([
        Math.sin(phi) * Math.cos(theta) * k,
        Math.cos(phi) * k,
        -Math.sin(phi) * Math.sin(theta) * k,
      ]);
    }
    grid.push(row);
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const t = (s + 1) % segments;
      const a = grid[r]![s]!;
      const c = grid[r + 1]![t]!;
      if (r === 0) b.poly([a, grid[r + 1]![s]!, c]);
      else if (r === rings - 1) b.poly([a, grid[r + 1]![s]!, grid[r]![t]!]);
      else b.quad(a, grid[r + 1]![s]!, c, grid[r]![t]!);
    }
  }
  return transformMesh(b.finish(cell), xf);
}

/** Points of a gate-arch outline: a rectangle topped by a half-circle, CCW from bottom-left. */
export function archOutline(
  width: number,
  height: number,
  archSegments: number,
): [number, number][] {
  const r = width / 2;
  const spring = height - r; // where the arch starts, measured from the bottom (y = 0)
  const pts: [number, number][] = [
    [-r, 0],
    [r, 0],
  ];
  for (let i = 0; i <= archSegments; i++) {
    const a = (i / archSegments) * Math.PI;
    pts.push([Math.cos(a) * r, spring + Math.sin(a) * r]);
  }
  return pts;
}
