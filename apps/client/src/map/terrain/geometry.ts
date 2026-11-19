/**
 * 2D geometry for terrain generation: signed distances to polygons and
 * polylines on the ground plane (map units, +x east, +z north). Pure: no DOM,
 * no Babylon, no allocation in the hot paths.
 */

export interface P2 {
  readonly x: number;
  readonly z: number;
}

export interface Box {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function boundsOf(points: readonly P2[], pad = 0): Box {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad };
}

export const inBox = (b: Box, x: number, z: number): boolean =>
  x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;

/** Distance from (x, z) to the segment a–b. */
export function segmentDistance(x: number, z: number, a: P2, b: P2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = x - (a.x + dx * t);
  const ez = z - (a.z + dz * t);
  return Math.sqrt(ex * ex + ez * ez);
}

/** Unsigned distance from (x, z) to an open polyline. */
export function polylineDistance(x: number, z: number, pts: readonly P2[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const d = segmentDistance(x, z, pts[i - 1]!, pts[i]!);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Signed distance to a polyline that crosses the whole map (the river):
 * positive on the left of the direction of travel, negative on the right.
 * The river runs WNW → ESE, so left = north-east = the Hollow side.
 */
export function polylineSide(x: number, z: number, pts: readonly P2[]): number {
  let best = Infinity;
  let sign = 1;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const d = segmentDistance(x, z, a, b);
    if (d < best) {
      best = d;
      // 2D cross product (b − a) × (p − a): > 0 when p is to the left.
      const cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
      sign = cross >= 0 ? 1 : -1;
    }
  }
  return best * sign;
}

/**
 * Signed distance to a simple polygon: negative inside, positive outside
 * (even-odd rule for the sign, so winding order does not matter).
 */
export function polygonSdf(x: number, z: number, poly: readonly P2[]): number {
  let best = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const d = segmentDistance(x, z, a, b);
    if (d < best) best = d;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside ? -best : best;
}

/** Area-weighted centroid of a simple polygon. */
export function polygonCentroid(poly: readonly P2[]): P2 {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j]!;
    const q = poly[i]!;
    const f = p.x * q.z - q.x * p.z;
    a += f;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, z: poly.reduce((s, p) => s + p.z, 0) / n };
  }
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

/** GLSL-style smoothstep (edge0 may be greater than edge1 for a falling edge). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  let t = (x - edge0) / (edge1 - edge0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
