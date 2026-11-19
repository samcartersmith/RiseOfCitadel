/**
 * A regular height grid baked from a TerrainField. The terrain mesh is built
 * from exactly these samples, and `sampleHeightGrid` interpolates on the same
 * triangles the mesh uses, so anything placed with it sits on the rendered
 * ground (full-detail LOD). Pure: no DOM, no Babylon.
 */
import type { TerrainField } from './heightfield';

export interface HeightGrid {
  /** Map units between samples. */
  readonly step: number;
  /** Samples per side (the grid is square). */
  readonly size: number;
  /** Map coordinate of sample (0, 0) on both axes (the map's south-west corner). */
  readonly origin: number;
  /** Row-major heights, map units: index = j * size + i, x = origin + i·step, z = origin + j·step. */
  readonly heights: Float32Array;
}

/** Bakes `field` on a `step`-spaced grid covering the whole (square) map. */
export function bakeHeightGrid(field: TerrainField, step: number): HeightGrid {
  const extent = Math.max(field.map.size.width, field.map.size.depth);
  const cells = Math.round(extent / step);
  if (Math.abs(cells * step - extent) > 1e-6) {
    throw new Error(`terrain step ${step} must divide the map size ${extent}`);
  }
  const size = cells + 1;
  const origin = -extent / 2;
  const heights = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    const z = origin + j * step;
    for (let i = 0; i < size; i++) heights[j * size + i] = field.heightAt(origin + i * step, z);
  }
  return { step, size, origin, heights };
}

/** Height of sample (i, j), clamped to the grid. */
export function gridHeight(g: HeightGrid, i: number, j: number): number {
  const ci = i < 0 ? 0 : i >= g.size ? g.size - 1 : i;
  const cj = j < 0 ? 0 : j >= g.size ? g.size - 1 : j;
  return g.heights[cj * g.size + ci]!;
}

/**
 * Which diagonal a cell A(i,j) B(i+1,j) C(i,j+1) D(i+1,j+1) is split along:
 * the one whose ends differ least in height (true = A–D, false = B–C). Picking
 * per cell keeps cliff tops from turning into a sawtooth when a cliff runs
 * across the grid diagonals. chunkGeometry.ts and sampleHeightGrid share it.
 */
export function splitsAD(hA: number, hB: number, hC: number, hD: number): boolean {
  return Math.abs(hA - hD) < Math.abs(hB - hC);
}

/**
 * Height at (x, z) in map units, interpolated on the mesh's triangles (each
 * cell split along the diagonal `splitsAD` picks, as chunkGeometry.ts does).
 * Points outside the map clamp to the edge.
 */
export function sampleHeightGrid(g: HeightGrid, x: number, z: number): number {
  const max = g.size - 1;
  let gx = (x - g.origin) / g.step;
  let gz = (z - g.origin) / g.step;
  gx = gx < 0 ? 0 : gx > max ? max : gx;
  gz = gz < 0 ? 0 : gz > max ? max : gz;
  let i = Math.floor(gx);
  let j = Math.floor(gz);
  if (i >= max) i = max - 1;
  if (j >= max) j = max - 1;
  const fx = gx - i;
  const fz = gz - j;
  const s = g.size;
  const hA = g.heights[j * s + i]!;
  const hB = g.heights[j * s + i + 1]!;
  const hC = g.heights[(j + 1) * s + i]!;
  const hD = g.heights[(j + 1) * s + i + 1]!;
  if (splitsAD(hA, hB, hC, hD)) {
    if (fx >= fz) return hA + fx * (hB - hA) + fz * (hD - hB); // ABD
    return hA + fx * (hD - hC) + fz * (hC - hA); // ADC
  }
  if (fx + fz <= 1) return hA + fx * (hB - hA) + fz * (hC - hA); // ABC
  return hD + (1 - fx) * (hC - hD) + (1 - fz) * (hB - hD); // BDC
}

/**
 * Unit surface normal at sample (i, j) by central differences (map units, so
 * the shape is true to scale). Writes [nx, ny, nz] into `out` at `offset`.
 */
export function gridNormal(
  g: HeightGrid,
  i: number,
  j: number,
  out: Float32Array | number[],
  offset = 0,
): void {
  const dx = (gridHeight(g, i + 1, j) - gridHeight(g, i - 1, j)) / (2 * g.step);
  const dz = (gridHeight(g, i, j + 1) - gridHeight(g, i, j - 1)) / (2 * g.step);
  const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
  out[offset] = -dx * inv;
  out[offset + 1] = inv;
  out[offset + 2] = -dz * inv;
}
