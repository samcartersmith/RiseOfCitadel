/**
 * Plain-array triangle geometry for kit-bashing (no Babylon): transform,
 * append, flat-shade, winding checks and vertex-clustering decimation for LODs.
 * Every structure variant is built from these arrays and handed to Babylon
 * once per (variant, LOD, material).
 */

export interface Geom {
  positions: number[];
  normals: number[];
  /** glTF convention: v = 0 is the top of the texture. */
  uvs: number[];
  indices: number[];
}

export const emptyGeom = (): Geom => ({ positions: [], normals: [], uvs: [], indices: [] });

export const vertexCount = (g: Geom): number => g.positions.length / 3;
export const triangleCount = (g: Geom): number => g.indices.length / 3;

export interface Transform {
  scale?: readonly [number, number, number];
  /** Radians about +y, Babylon convention (local +z turns toward +x). */
  rotY?: number;
  /** Radians about +x, applied before rotY (positive tips local +y toward +z). */
  rotX?: number;
  /** Radians about +z, applied before rotX (positive tips local +x toward +y). */
  rotZ?: number;
  translate?: readonly [number, number, number];
}

function rotate(x: number, y: number, z: number, t: Transform): [number, number, number] {
  if (t.rotZ) {
    const c = Math.cos(t.rotZ);
    const s = Math.sin(t.rotZ);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  if (t.rotX) {
    const c = Math.cos(t.rotX);
    const s = Math.sin(t.rotX);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  if (t.rotY) {
    // Babylon: rotation.y = r maps local +z to (sin r, 0, cos r).
    const c = Math.cos(t.rotY);
    const s = Math.sin(t.rotY);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  return [x, y, z];
}

/**
 * A transformed copy. Normals use the inverse-transpose of the scale; a
 * mirroring scale (negative determinant) reverses the winding so faces keep
 * pointing outward.
 */
export function transformGeom(g: Geom, t: Transform): Geom {
  const [sx, sy, sz] = t.scale ?? [1, 1, 1];
  const [tx, ty, tz] = t.translate ?? [0, 0, 0];
  const out: Geom = { positions: [], normals: [], uvs: [...g.uvs], indices: [] };
  for (let i = 0; i < g.positions.length; i += 3) {
    const [x, y, z] = rotate(
      g.positions[i]! * sx,
      g.positions[i + 1]! * sy,
      g.positions[i + 2]! * sz,
      t,
    );
    out.positions.push(x + tx, y + ty, z + tz);
    let [nx, ny, nz] = rotate(
      g.normals[i]! / sx,
      g.normals[i + 1]! / sy,
      g.normals[i + 2]! / sz,
      t,
    );
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    out.normals.push(nx, ny, nz);
  }
  const mirrored = sx * sy * sz < 0;
  for (let i = 0; i < g.indices.length; i += 3) {
    const a = g.indices[i]!;
    const b = g.indices[i + 1]!;
    const c = g.indices[i + 2]!;
    if (mirrored) out.indices.push(a, c, b);
    else out.indices.push(a, b, c);
  }
  return out;
}

/** Appends `src` to `dst` in place. */
export function appendGeom(dst: Geom, src: Geom): Geom {
  const base = vertexCount(dst);
  // Loops, not push(...spread): big pieces exceed the engine's argument limit.
  for (const v of src.positions) dst.positions.push(v);
  for (const v of src.normals) dst.normals.push(v);
  for (const v of src.uvs) dst.uvs.push(v);
  for (const i of src.indices) dst.indices.push(i + base);
  return dst;
}

export function flipWinding(g: Geom): Geom {
  const indices: number[] = [];
  for (let i = 0; i < g.indices.length; i += 3) {
    indices.push(g.indices[i]!, g.indices[i + 2]!, g.indices[i + 1]!);
  }
  return { ...g, indices };
}

/**
 * +1 when triangles wind so that cross(b - a, c - a) agrees with their vertex
 * normals, -1 when it opposes them (area-weighted), 0 for no triangles.
 * Used to bring geometry from different sources to one winding convention.
 */
export function windingSign(g: Geom): number {
  let sum = 0;
  const p = g.positions;
  const n = g.normals;
  for (let i = 0; i < g.indices.length; i += 3) {
    const a = g.indices[i]! * 3;
    const b = g.indices[i + 1]! * 3;
    const c = g.indices[i + 2]! * 3;
    const ux = p[b]! - p[a]!;
    const uy = p[b + 1]! - p[a + 1]!;
    const uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!;
    const vy = p[c + 1]! - p[a + 1]!;
    const vz = p[c + 2]! - p[a + 2]!;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const nx = n[a]! + n[b]! + n[c]!;
    const ny = n[a + 1]! + n[b + 1]! + n[c + 1]!;
    const nz = n[a + 2]! + n[b + 2]! + n[c + 2]!;
    sum += cx * nx + cy * ny + cz * nz;
  }
  return sum > 0 ? 1 : sum < 0 ? -1 : 0;
}

/** Brings `g` to the given winding sign (see windingSign). */
export function withWinding(g: Geom, sign: 1 | -1): Geom {
  const s = windingSign(g);
  return s !== 0 && s !== sign ? flipWinding(g) : g;
}

/**
 * Un-welds every triangle and gives it its face normal: hard facets, like the
 * KayKit pieces, for low-sided procedural prisms. `sign` is the winding
 * convention (see windingSign) used to orient the face normal.
 */
export function flatShade(g: Geom, sign: 1 | -1): Geom {
  const out = emptyGeom();
  const p = g.positions;
  for (let i = 0; i < g.indices.length; i += 3) {
    const ids = [g.indices[i]!, g.indices[i + 1]!, g.indices[i + 2]!];
    const [a, b, c] = ids.map((k) => k * 3) as [number, number, number];
    const ux = p[b]! - p[a]!;
    const uy = p[b + 1]! - p[a + 1]!;
    const uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!;
    const vy = p[c + 1]! - p[a + 1]!;
    const vz = p[c + 2]! - p[a + 2]!;
    let nx = (uy * vz - uz * vy) * sign;
    let ny = (uz * vx - ux * vz) * sign;
    let nz = (ux * vy - uy * vx) * sign;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue; // degenerate
    nx /= len;
    ny /= len;
    nz /= len;
    const base = vertexCount(out);
    for (const k of ids) {
      out.positions.push(p[k * 3]!, p[k * 3 + 1]!, p[k * 3 + 2]!);
      out.normals.push(nx, ny, nz);
      out.uvs.push(g.uvs[k * 2] ?? 0, g.uvs[k * 2 + 1] ?? 0);
    }
    out.indices.push(base, base + 1, base + 2);
  }
  return out;
}

export interface Bounds3 {
  min: [number, number, number];
  max: [number, number, number];
}

export function boundsOf(g: Geom): Bounds3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = g.positions[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

/** Atlas grid used to keep decimation from merging across colour swatches. */
export interface UvGrid {
  cols: number;
  rows: number;
}

/**
 * Vertex-clustering decimation (impostor-free LOD). Vertices are bucketed by
 * (position cell, atlas swatch, dominant normal direction); each bucket
 * collapses to its average, and triangles that collapse to a line or repeat
 * are dropped. Keying on the swatch keeps colour regions crisp, and keying on
 * the normal direction keeps hard edges hard. Deterministic.
 */
export function decimateByClustering(g: Geom, cellSize: number, grid: UvGrid): Geom {
  if (cellSize <= 0) return g;
  const cluster = new Map<string, number>();
  const sums: number[][] = []; // per cluster: px py pz nx ny nz u v count
  const remap = new Array<number>(vertexCount(g));
  for (let i = 0; i < vertexCount(g); i++) {
    const x = g.positions[i * 3]!;
    const y = g.positions[i * 3 + 1]!;
    const z = g.positions[i * 3 + 2]!;
    const nx = g.normals[i * 3]!;
    const ny = g.normals[i * 3 + 1]!;
    const nz = g.normals[i * 3 + 2]!;
    const u = g.uvs[i * 2] ?? 0;
    const v = g.uvs[i * 2 + 1] ?? 0;
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    const dir =
      ax >= ay && ax >= az ? (nx > 0 ? 0 : 1) : ay >= az ? (ny > 0 ? 2 : 3) : nz > 0 ? 4 : 5;
    const sw = `${Math.floor(Math.min(u, 0.9999) * grid.cols)}.${Math.floor(Math.min(v, 0.9999) * grid.rows)}`;
    const key = `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)},${sw},${dir}`;
    let c = cluster.get(key);
    if (c === undefined) {
      c = sums.length;
      cluster.set(key, c);
      sums.push([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
    const s = sums[c]!;
    s[0]! += x;
    s[1]! += y;
    s[2]! += z;
    s[3]! += nx;
    s[4]! += ny;
    s[5]! += nz;
    s[6]! += u;
    s[7]! += v;
    s[8]! += 1;
    remap[i] = c;
  }
  const out = emptyGeom();
  for (const s of sums) {
    const n = s[8]!;
    out.positions.push(s[0]! / n, s[1]! / n, s[2]! / n);
    const len = Math.hypot(s[3]!, s[4]!, s[5]!) || 1;
    out.normals.push(s[3]! / len, s[4]! / len, s[5]! / len);
    out.uvs.push(s[6]! / n, s[7]! / n);
  }
  const seen = new Set<string>();
  for (let i = 0; i < g.indices.length; i += 3) {
    const a = remap[g.indices[i]!]!;
    const b = remap[g.indices[i + 1]!]!;
    const c = remap[g.indices[i + 2]!]!;
    if (a === b || b === c || a === c) continue;
    // Same triangle with the same winding (any rotation) only once.
    const m = Math.min(a, b, c);
    const key = m === a ? `${a},${b},${c}` : m === b ? `${b},${c},${a}` : `${c},${a},${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.indices.push(a, b, c);
  }
  return dropUnused(out);
}

/** Removes vertices no triangle references, keeping order. */
export function dropUnused(g: Geom): Geom {
  const used = new Int32Array(vertexCount(g)).fill(-1);
  const out = emptyGeom();
  for (const i of g.indices) {
    if (used[i]! < 0) {
      used[i] = vertexCount(out);
      out.positions.push(g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!);
      out.normals.push(g.normals[i * 3]!, g.normals[i * 3 + 1]!, g.normals[i * 3 + 2]!);
      out.uvs.push(g.uvs[i * 2] ?? 0, g.uvs[i * 2 + 1] ?? 0);
    }
    out.indices.push(used[i]!);
  }
  return out;
}

/**
 * Re-maps UVs of procedural geometry into one atlas swatch: u at the swatch's
 * horizontal centre, v following the vertex height so the swatch's vertical
 * gradient (light top, dark bottom on KayKit atlases) runs up the part.
 */
export function swatchUvs(g: Geom, col: number, row: number, grid: UvGrid, margin = 0.08): Geom {
  const { min, max } = boundsOf(g);
  const h = max[1] - min[1] || 1;
  const u = (col + 0.5) / grid.cols;
  const v0 = (row + margin) / grid.rows; // top of the swatch
  const v1 = (row + 1 - margin) / grid.rows;
  const uvs: number[] = [];
  for (let i = 0; i < vertexCount(g); i++) {
    const t = (g.positions[i * 3 + 1]! - min[1]) / h; // 0 bottom .. 1 top
    uvs.push(u, v1 + (v0 - v1) * t);
  }
  return { ...g, uvs };
}
