/**
 * River path and flow maths for the water (M1-06). Pure: no DOM, no Babylon,
 * so it's unit tested and usable by gameplay or VFX (`flowAt` says which way
 * and how fast the river runs at a point).
 *
 * Everything here is in **map units** unless a name says otherwise. The river
 * flows in waypoint order: from the north-west map edge (-8000, 4400) through
 * the centre to the south-east edge (8000, -4400).
 *
 * "River space" is (s, across): `s` is arc length along the smoothed centreline,
 * `across` the signed distance from it, positive on the left of the flow
 * (the Hollow / north-east side for this map).
 */

export interface P2 {
  x: number;
  z: number;
}

export interface RiverSample {
  x: number;
  z: number;
  /** Unit tangent: the flow direction. */
  tx: number;
  tz: number;
  /** Arc length from the start of the path. */
  s: number;
}

export interface RiverPath {
  readonly samples: readonly RiverSample[];
  readonly length: number;
  /** Distance between consecutive samples (the last gap can be shorter). */
  readonly spacing: number;
}

export interface RiverPathOptions {
  /** Distance between resampled points. Default 30. */
  spacing?: number;
  /** Catmull-Rom points per waypoint segment before resampling. Default 16. */
  smoothing?: number;
  /** Keep points this far inside ±limit on both axes (the map edge). */
  limit?: number;
}

/**
 * Uniform Catmull-Rom spline through every waypoint (end points repeated), so
 * the 11 straight segments of the map data become one smooth curve with no
 * kinks in the flow direction. Passes exactly through each waypoint.
 */
export function catmullRom(points: readonly P2[], perSegment: number): P2[] {
  if (points.length < 3 || perSegment < 2) return points.map((p) => ({ ...p }));
  const out: P2[] = [];
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))]!;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push({ ...points[points.length - 1]! });
  return out;
}

/** Points at equal arc-length spacing along a polyline, with unit tangents. */
export function resamplePolyline(points: readonly P2[], spacing: number): RiverSample[] {
  if (points.length < 2) throw new Error('a river needs at least two points');
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const total = cum[cum.length - 1]!;
  const n = Math.max(1, Math.ceil(total / spacing));
  const out: RiverSample[] = [];
  let seg = 0;
  for (let k = 0; k <= n; k++) {
    const s = Math.min(total, k * spacing);
    while (seg < points.length - 2 && cum[seg + 1]! < s) seg++;
    const a = points[seg]!;
    const b = points[seg + 1]!;
    const len = cum[seg + 1]! - cum[seg]! || 1;
    const t = (s - cum[seg]!) / len;
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: 0, tz: 0, s });
  }
  // Tangents by central differences: smooth across the resampled points.
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 1)]!;
    const b = out[Math.min(out.length - 1, i + 1)]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    out[i]!.tx = dx / len;
    out[i]!.tz = dz / len;
  }
  return out;
}

/** The smoothed, evenly resampled centreline of a river. */
export function buildRiverPath(waypoints: readonly P2[], opts: RiverPathOptions = {}): RiverPath {
  const limit = opts.limit ?? Infinity;
  const clamp = (v: number) => Math.max(-limit, Math.min(limit, v));
  const pts = waypoints.map((p) => ({ x: clamp(p.x), z: clamp(p.z) }));
  const spacing = opts.spacing ?? 30;
  const samples = resamplePolyline(catmullRom(pts, opts.smoothing ?? 16), spacing);
  return { samples, length: samples[samples.length - 1]!.s, spacing };
}

/** The centreline point at arc length `s` (clamped to the path), interpolated. */
export function pointAt(path: RiverPath, s: number): RiverSample {
  const { samples } = path;
  const c = Math.max(0, Math.min(path.length, s));
  const i = Math.min(samples.length - 2, Math.floor(c / path.spacing));
  const a = samples[i]!;
  const b = samples[i + 1]!;
  const t = b.s > a.s ? (c - a.s) / (b.s - a.s) : 0;
  const tx = a.tx + (b.tx - a.tx) * t;
  const tz = a.tz + (b.tz - a.tz) * t;
  const tl = Math.hypot(tx, tz) || 1;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: tx / tl, tz: tz / tl, s: c };
}

export interface RiverProjection {
  /** Arc length of the closest centreline point. */
  s: number;
  /** Signed distance from the centreline, + on the left of the flow. */
  across: number;
  /** Unsigned distance to the centreline. */
  distance: number;
  /** Flow direction there (unit). */
  tx: number;
  tz: number;
}

/** Closest point on the centreline to (x, z), in river space. Linear in the sample count. */
export function projectOnPath(path: RiverPath, x: number, z: number): RiverProjection {
  const { samples } = path;
  let best: RiverProjection = { s: 0, across: 0, distance: Infinity, tx: 1, tz: 0 };
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.distance) {
      const len = Math.sqrt(len2);
      const tx = dx / len;
      const tz = dz / len;
      // Left of the flow direction (tx, tz) is (-tz, tx).
      const side = (x - px) * -tz + (z - pz) * tx;
      best = { s: a.s + (b.s - a.s) * t, across: side >= 0 ? d : -d, distance: d, tx, tz };
    }
  }
  return best;
}

export interface FlowProfile {
  /** Speed on the centreline (world units / s). */
  centreSpeed: number;
  /** Fraction of the centre speed left at the water's edge. */
  edgeFactor: number;
  /** Half-width of the wet channel (map units): the speed reaches the edge factor here. */
  wetHalfWidth: number;
}

export const DEFAULT_FLOW: Readonly<FlowProfile> = {
  centreSpeed: 1.1,
  edgeFactor: 0.3,
  wetHalfWidth: 400,
};

/**
 * Flow speed across the channel: a parabola, fastest on the centreline and
 * slow by the banks (like a real river's velocity profile).
 */
export function flowSpeed(across: number, profile: FlowProfile = DEFAULT_FLOW): number {
  const a = Math.min(1, Math.abs(across) / Math.max(1e-6, profile.wetHalfWidth));
  return profile.centreSpeed * (profile.edgeFactor + (1 - profile.edgeFactor) * (1 - a * a));
}

export interface Flow {
  /** Unit flow direction (x, z). */
  dx: number;
  dz: number;
  /** World units per second; 0 off the river. */
  speed: number;
}

/**
 * Which way and how fast the water moves at map point (x, z). `speed` is 0
 * outside the ribbon's half-width (`maxAcross`).
 */
export function flowAt(
  path: RiverPath,
  x: number,
  z: number,
  profile: FlowProfile = DEFAULT_FLOW,
  maxAcross = profile.wetHalfWidth,
): Flow {
  const p = projectOnPath(path, x, z);
  return { dx: p.tx, dz: p.tz, speed: p.distance > maxAcross ? 0 : flowSpeed(p.across, profile) };
}

/**
 * Two-phase flow-map weights at time `t` (s) with period `period` (s). Each
 * phase scrolls the pattern for one period, then jumps back while its weight
 * is 0, so features never shear apart where the speed varies across the river.
 * Mirrors the shader (waterShaderCode.ts); the weights always sum to 1.
 */
export function flowPhases(
  t: number,
  period: number,
): { phase0: number; phase1: number; weight0: number; weight1: number } {
  const phase0 = fract(t / period);
  const phase1 = fract(t / period + 0.5);
  const weight0 = 1 - Math.abs(1 - 2 * phase0);
  return { phase0, phase1, weight0, weight1: 1 - weight0 };
}

const fract = (v: number) => v - Math.floor(v);

// ------------------------------------------------------------------------- geometry

export interface WaterGeometryOptions {
  /** Ground height at a map point, map units in and out. */
  heightAt(x: number, z: number): number;
  /** Water surface height (map units). */
  level: number;
  /** Ribbon half-width (map units). Wider than the wet channel: the bank clips it. */
  halfWidth: number;
  /** Vertices across the ribbon. */
  columns: number;
  /** Rows (path samples) per chunk, for frustum culling. */
  rowsPerChunk: number;
  /** World units per map unit. */
  scale: number;
  /** Drop quads whose four corners are all this far (map units) under the ground. */
  cullDepth: number;
  flow: FlowProfile;
}

export interface WaterChunkArrays {
  /** World-space xyz. */
  positions: Float32Array;
  normals: Float32Array;
  /** Per vertex: across (−1..1 of the half-width), s (world units), depth (world units, < 0 under ground), flow speed (world units / s). */
  data: Float32Array;
  /** Per vertex: flow direction (x, z), unit. */
  flow: Float32Array;
  indices: Uint32Array;
  triangles: number;
}

/**
 * Builds the river ribbon: one cross-section per path sample, split into
 * chunks along the river. The ribbon is flat at `level` and wider than the
 * water, so the terrain's banks cut the visible shoreline through it; quads
 * entirely under the ground are dropped. Each vertex carries its water depth
 * (from the same height grid the terrain mesh uses) for the depth tint and
 * the shoreline foam.
 */
export function buildWaterChunks(path: RiverPath, opts: WaterGeometryOptions): WaterChunkArrays[] {
  const { samples } = path;
  const cols = Math.max(2, opts.columns);
  const S = opts.scale;
  const rows = samples.length;
  // Shared per-vertex values for the whole ribbon, then sliced into chunks.
  const vx = new Float64Array(rows * cols);
  const vz = new Float64Array(rows * cols);
  const depth = new Float64Array(rows * cols);
  const across = new Float64Array(cols);
  for (let c = 0; c < cols; c++) across[c] = -1 + (2 * c) / (cols - 1);
  for (let r = 0; r < rows; r++) {
    const p = samples[r]!;
    const nx = -p.tz;
    const nz = p.tx;
    for (let c = 0; c < cols; c++) {
      const d = across[c]! * opts.halfWidth;
      const i = r * cols + c;
      vx[i] = p.x + nx * d;
      vz[i] = p.z + nz * d;
      depth[i] = opts.level - opts.heightAt(vx[i]!, vz[i]!);
    }
  }

  const chunks: WaterChunkArrays[] = [];
  const step = Math.max(1, opts.rowsPerChunk);
  for (let r0 = 0; r0 < rows - 1; r0 += step) {
    const r1 = Math.min(rows - 1, r0 + step);
    const remap = new Map<number, number>();
    const idx: number[] = [];
    const used: number[] = [];
    const vert = (i: number) => {
      let v = remap.get(i);
      if (v === undefined) {
        v = used.length;
        remap.set(i, v);
        used.push(i);
      }
      return v;
    };
    for (let r = r0; r < r1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        const cut = -opts.cullDepth;
        if (depth[a]! < cut && depth[b]! < cut && depth[d]! < cut && depth[e]! < cut) continue;
        // Babylon is left-handed with clockwise front faces: viewed from +y,
        // a → d → b winds clockwise when "left" (+c) is +across.
        idx.push(vert(a), vert(d), vert(b), vert(b), vert(d), vert(e));
      }
    }
    if (!idx.length) continue;
    const n = used.length;
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    const data = new Float32Array(n * 4);
    const flow = new Float32Array(n * 2);
    used.forEach((i, v) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const p = samples[r]!;
      positions.set([vx[i]! * S, opts.level * S, vz[i]! * S], v * 3);
      normals.set([0, 1, 0], v * 3);
      const off = across[c]! * opts.halfWidth;
      data.set([across[c]!, p.s * S, depth[i]! * S, flowSpeed(off, opts.flow)], v * 4);
      flow.set([p.tx, p.tz], v * 2);
    });
    chunks.push({
      positions,
      normals,
      data,
      flow,
      indices: Uint32Array.from(idx),
      triangles: idx.length / 3,
    });
  }
  return chunks;
}
