import { describe, expect, it } from 'vitest';
import { CITADEL_MAP } from '../terrain/citadelMap';
import {
  buildRiverPath,
  buildWaterChunks,
  catmullRom,
  DEFAULT_FLOW,
  flowAt,
  flowPhases,
  flowSpeed,
  pointAt,
  projectOnPath,
  resamplePolyline,
  type RiverPath,
  type WaterGeometryOptions,
} from './riverPath';

const straight = (len = 1000): RiverPath =>
  buildRiverPath(
    [
      { x: 0, z: 0 },
      { x: len / 2, z: 0 },
      { x: len, z: 0 },
    ],
    { spacing: 10 },
  );

describe('catmullRom', () => {
  it('passes through every waypoint', () => {
    const pts = CITADEL_MAP.river.waypoints;
    const curve = catmullRom(pts, 8);
    expect(curve.length).toBe((pts.length - 1) * 8 + 1);
    pts.forEach((p, i) => {
      expect(curve[i * 8]!.x).toBeCloseTo(p.x, 6);
      expect(curve[i * 8]!.z).toBeCloseTo(p.z, 6);
    });
  });

  it('leaves collinear points on the line', () => {
    const curve = catmullRom(
      [
        { x: 0, z: 0 },
        { x: 10, z: 10 },
        { x: 20, z: 20 },
      ],
      5,
    );
    for (const p of curve) expect(p.x).toBeCloseTo(p.z, 9);
  });
});

describe('resamplePolyline', () => {
  it('spaces samples evenly with unit tangents', () => {
    const s = resamplePolyline(
      [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
        { x: 100, z: 50 },
      ],
      10,
    );
    expect(s.length).toBe(16);
    expect(s[s.length - 1]!.s).toBeCloseTo(150);
    for (let i = 1; i < s.length; i++) expect(s[i]!.s - s[i - 1]!.s).toBeCloseTo(10);
    for (const p of s) expect(Math.hypot(p.tx, p.tz)).toBeCloseTo(1, 9);
    expect(s[0]!.tx).toBeCloseTo(1);
    expect(s[s.length - 1]!.tz).toBeCloseTo(1);
  });

  it('rejects a single point', () => {
    expect(() => resamplePolyline([{ x: 0, z: 0 }], 10)).toThrow();
  });
});

describe('the Citadel river path', () => {
  const path = buildRiverPath(CITADEL_MAP.river.waypoints, { spacing: 30, limit: 7980 });

  it('runs from the north-west edge to the south-east edge through the centre', () => {
    const a = path.samples[0]!;
    const b = path.samples[path.samples.length - 1]!;
    expect(a.x).toBeLessThan(-7900);
    expect(a.z).toBeGreaterThan(4000);
    expect(b.x).toBeGreaterThan(7900);
    expect(b.z).toBeLessThan(-4000);
    expect(projectOnPath(path, 0, 0).distance).toBeLessThan(1);
    // Point-symmetric map: the centre is half way along.
    expect(projectOnPath(path, 0, 0).s / path.length).toBeCloseTo(0.5, 2);
  });

  it('flows south-east everywhere and never turns sharply', () => {
    for (let i = 1; i < path.samples.length; i++) {
      const p = path.samples[i]!;
      const q = path.samples[i - 1]!;
      expect(p.tx).toBeGreaterThan(0.5);
      expect(p.tz).toBeLessThan(0.1);
      // Under 3° between neighbouring samples: smooth enough for the flow streaks.
      expect(p.tx * q.tx + p.tz * q.tz).toBeGreaterThan(Math.cos((3 * Math.PI) / 180));
    }
  });

  it('stays within the carved channel', () => {
    // The terrain carves along the raw polyline; smoothing must not drift out of the bed.
    for (let i = 0; i < path.samples.length; i += 5) {
      const p = path.samples[i]!;
      const wp = CITADEL_MAP.river.waypoints;
      let best = Infinity;
      for (let k = 0; k < wp.length - 1; k++) {
        const a = wp[k]!;
        const b = wp[k + 1]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)),
        );
        best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
      }
      expect(best).toBeLessThan(120);
    }
  });

  it('has cross-sections that never fold over at ±600', () => {
    // Offsetting by the ribbon half-width must not reverse quads on the inside of a bend.
    const half = 600;
    for (let i = 1; i < path.samples.length; i++) {
      const p = path.samples[i]!;
      const q = path.samples[i - 1]!;
      for (const side of [-1, 1]) {
        const ax = q.x - q.tz * half * side;
        const az = q.z + q.tx * half * side;
        const bx = p.x - p.tz * half * side;
        const bz = p.z + p.tx * half * side;
        // The offset edge still advances along the flow.
        expect((bx - ax) * p.tx + (bz - az) * p.tz).toBeGreaterThan(0);
      }
    }
  });
});

describe('pointAt / projectOnPath', () => {
  const path = straight();

  it('interpolates and clamps', () => {
    expect(pointAt(path, 123).x).toBeCloseTo(123);
    expect(pointAt(path, -50).x).toBeCloseTo(0);
    expect(pointAt(path, 5000).x).toBeCloseTo(1000);
  });

  it('round-trips a point in river space', () => {
    const p = projectOnPath(path, 400, 75);
    expect(p.s).toBeCloseTo(400);
    // Flow is +x, so +z is on the left: positive across.
    expect(p.across).toBeCloseTo(75);
    expect(projectOnPath(path, 400, -75).across).toBeCloseTo(-75);
    expect(p.tx).toBeCloseTo(1);
  });
});

describe('flow', () => {
  it('is fastest on the centreline and slows to the edge factor at the banks', () => {
    const f = DEFAULT_FLOW;
    expect(flowSpeed(0)).toBeCloseTo(f.centreSpeed);
    expect(flowSpeed(f.wetHalfWidth)).toBeCloseTo(f.centreSpeed * f.edgeFactor);
    expect(flowSpeed(-f.wetHalfWidth * 3)).toBeCloseTo(f.centreSpeed * f.edgeFactor);
    expect(flowSpeed(100)).toBeCloseTo(flowSpeed(-100));
    expect(flowSpeed(100)).toBeGreaterThan(flowSpeed(200));
  });

  it('flowAt follows the path and stops off the river', () => {
    const path = straight();
    const on = flowAt(path, 500, 10);
    expect(on.dx).toBeCloseTo(1);
    expect(on.speed).toBeGreaterThan(0);
    expect(flowAt(path, 500, 2000).speed).toBe(0);
  });

  it('two-phase weights sum to one and each phase resets at weight zero', () => {
    for (let t = 0; t < 10; t += 0.137) {
      const p = flowPhases(t, 3);
      expect(p.weight0 + p.weight1).toBeCloseTo(1, 12);
      expect(p.phase0).toBeGreaterThanOrEqual(0);
      expect(p.phase0).toBeLessThan(1);
    }
    // At the moment phase 0 wraps, it has no weight (the jump is invisible).
    expect(flowPhases(3, 3).weight0).toBeCloseTo(0);
    expect(flowPhases(1.5, 3).weight1).toBeCloseTo(0);
  });
});

describe('buildWaterChunks', () => {
  const opts = (over: Partial<WaterGeometryOptions> = {}): WaterGeometryOptions => ({
    // A channel 40 deep at the centreline (z = 0) rising 0.2 per unit to the banks.
    heightAt: (_x, z) => -40 + Math.abs(z) * 0.2,
    level: -20,
    halfWidth: 300,
    columns: 13,
    rowsPerChunk: 20,
    scale: 1 / 32,
    cullDepth: 12,
    flow: DEFAULT_FLOW,
    ...over,
  });

  it('splits into chunks along the river with matching attribute sizes', () => {
    const chunks = buildWaterChunks(straight(), opts());
    expect(chunks.length).toBe(5); // 101 rows, 20 per chunk
    for (const c of chunks) {
      const n = c.positions.length / 3;
      expect(c.normals.length).toBe(n * 3);
      expect(c.data.length).toBe(n * 4);
      expect(c.flow.length).toBe(n * 2);
      expect(c.indices.length).toBe(c.triangles * 3);
      for (const i of c.indices) expect(i).toBeLessThan(n);
    }
  });

  it('drops quads buried under the banks and keeps every wet one', () => {
    // Waterline at |z| = 100; |z| > 160 is more than 12 under ground.
    const chunks = buildWaterChunks(straight(), opts());
    for (const c of chunks) {
      for (let v = 0; v < c.positions.length / 3; v++) {
        const z = c.positions[v * 3 + 2]! * 32;
        expect(Math.abs(z)).toBeLessThanOrEqual(160 + 50 + 1e-6); // within one column of the cut
      }
    }
    const full = buildWaterChunks(straight(), opts({ cullDepth: 1e9 }));
    const tris = (cs: typeof chunks) => cs.reduce((a, c) => a + c.triangles, 0);
    expect(tris(chunks)).toBeLessThan(tris(full));
    expect(tris(full)).toBe(100 * 12 * 2);
    // Columns at |z| ≤ 150 are kept: 7 inner columns → 6 quads + the two straddling the cut.
    expect(tris(chunks)).toBe(100 * 8 * 2);
  });

  it('stores depth, river-space position and flow per vertex', () => {
    const [c] = buildWaterChunks(straight(), opts({ cullDepth: 1e9 }));
    for (let v = 0; v < c!.positions.length / 3; v++) {
      const x = c!.positions[v * 3]! * 32;
      const y = c!.positions[v * 3 + 1]! * 32;
      const z = c!.positions[v * 3 + 2]! * 32;
      const [across, s, depth, speed] = c!.data.subarray(v * 4, v * 4 + 4);
      expect(y).toBeCloseTo(-20);
      expect(across! * 300).toBeCloseTo(z, 3);
      expect(s! * 32).toBeCloseTo(x, 3);
      expect(depth! * 32).toBeCloseTo(-20 - (-40 + Math.abs(z) * 0.2), 3);
      expect(speed).toBeCloseTo(flowSpeed(z));
      expect(c!.flow[v * 2]).toBeCloseTo(1);
    }
  });

  it('winds triangles front-facing from above (Babylon clockwise)', () => {
    const [c] = buildWaterChunks(straight(), opts());
    const P = c!.positions;
    for (let t = 0; t < c!.triangles; t++) {
      const [a, b, d] = [0, 1, 2].map((k) => c!.indices[t * 3 + k]!);
      const ux = P[b! * 3]! - P[a! * 3]!;
      const uz = P[b! * 3 + 2]! - P[a! * 3 + 2]!;
      const vx = P[d! * 3]! - P[a! * 3]!;
      const vz = P[d! * 3 + 2]! - P[a! * 3 + 2]!;
      // Same sign as the terrain's (A → +x → +z) triangles: cross.y < 0.
      expect(uz * vx - ux * vz).toBeLessThan(0);
    }
  });
});
