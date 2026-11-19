import { describe, expect, it } from 'vitest';
import type { MapSpec } from '@citadel/content';
import { CITADEL_MAP } from './citadelMap';
import {
  polygonCentroid,
  polygonSdf,
  polylineDistance,
  polylineSide,
  segmentDistance,
} from './geometry';
import { createTerrainField, riverSide } from './heightfield';
import { bakeHeightGrid, gridNormal, sampleHeightGrid } from './heightGrid';
import { fbm, valueNoise } from './noise';
import {
  createHeightSampler,
  getCitadelHeightSampler,
  MAP_TO_WORLD,
  MAP_UNITS_PER_WORLD_UNIT,
} from './sampler';

const map = CITADEL_MAP;
const L = map.heightLevels;
const field = createTerrainField(map);
const region = (id: string) => map.regions.find((r) => r.id === id)!;

describe('geometry', () => {
  const square = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 0, z: 10 },
  ];
  it('signed polygon distance is negative inside, positive outside, either winding', () => {
    expect(polygonSdf(5, 5, square)).toBeCloseTo(-5);
    expect(polygonSdf(15, 5, square)).toBeCloseTo(5);
    expect(polygonSdf(5, 5, [...square].reverse())).toBeCloseTo(-5);
    expect(polygonSdf(10, 5, square)).toBeCloseTo(0);
  });
  it('segment and polyline distances', () => {
    expect(segmentDistance(5, 3, { x: 0, z: 0 }, { x: 10, z: 0 })).toBeCloseTo(3);
    expect(segmentDistance(-4, 3, { x: 0, z: 0 }, { x: 10, z: 0 })).toBeCloseTo(5);
    expect(polylineDistance(10, 5, square)).toBeCloseTo(0);
  });
  it('polyline side is positive on the left of travel', () => {
    const line = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ];
    expect(polylineSide(5, 2, line)).toBeCloseTo(2);
    expect(polylineSide(5, -2, line)).toBeCloseTo(-2);
  });
  it('centroid of a square is its middle', () => {
    expect(polygonCentroid(square)).toEqual({ x: 5, z: 5 });
  });
});

describe('noise', () => {
  it('is deterministic and bounded', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37 - 20;
      const z = i * 0.61 + 3;
      const v = valueNoise(x, z, 4);
      expect(v).toBe(valueNoise(x, z, 4));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(fbm(x, z, 3, 9))).toBeLessThanOrEqual(1);
    }
    expect(valueNoise(1.5, 2.5, 1)).not.toBe(valueNoise(1.5, 2.5, 2));
  });
});

describe('terrain heights follow the map spec', () => {
  it('base plateaus sit at the high level', () => {
    for (const id of ['w_base', 'h_base']) {
      const c = polygonCentroid(region(id).polygon);
      expect(field.heightAt(c.x, c.z)).toBeCloseTo(L.high, -1); // ±5
      expect(Math.abs(field.heightAt(c.x, c.z) - L.high)).toBeLessThan(8);
    }
    // Ancients and fountains stand on the high ground.
    for (const s of map.structures.filter((s) => s.type === 'ancient' || s.type === 'fountain')) {
      expect(Math.abs(field.heightAt(s.position.x, s.position.z) - L.high)).toBeLessThan(8);
    }
  });

  it('overlooks sit at the mid level', () => {
    for (const r of map.regions.filter((r) => r.tag === 'highground')) {
      const c = polygonCentroid(r.polygon);
      expect(Math.abs(field.heightAt(c.x, c.z) - L[r.height])).toBeLessThan(8);
    }
  });

  it('the riverbed is carved to the river level along the waypoints', () => {
    const pts = map.river.waypoints.slice(1, -1);
    for (const p of pts) {
      expect(Math.abs(field.heightAt(p.x, p.z) - L.river)).toBeLessThan(6);
    }
    // Banks: back to low ground a little outside the river's half-width.
    const side = map.river.width / 2 + 400;
    expect(Math.abs(field.heightAt(-4200, 2300 + side) - L.low)).toBeLessThan(20);
  });

  it('lanes on open ground are near the low level and flat', () => {
    // Mid lane between the river and the T1s (both sides).
    for (const p of [
      { x: -2700, z: -3100 },
      { x: 2700, z: 3100 },
      { x: -7000, z: -400 },
      { x: 7000, z: 400 },
    ]) {
      expect(Math.abs(field.heightAt(p.x, p.z) - L.low)).toBeLessThan(6);
    }
  });

  it('ramps rise from their `from` level to their `to` level', () => {
    for (const r of map.ramps) {
      const dx = Math.cos((r.direction * Math.PI) / 180);
      const dz = Math.sin((r.direction * Math.PI) / 180);
      const at = (u: number) => field.heightAt(r.position.x + dx * u, r.position.z + dz * u);
      const bottom = at(-r.length / 2 - 60);
      const middle = at(0);
      const top = at(r.length / 2 + 120);
      expect(Math.abs(bottom - L[r.from])).toBeLessThan(25);
      expect(Math.abs(top - L[r.to])).toBeLessThan(10);
      expect(middle).toBeGreaterThan(L[r.from] + 0.25 * (L[r.to] - L[r.from]));
      expect(middle).toBeLessThan(L[r.to] - 0.25 * (L[r.to] - L[r.from]));
      // Monotonic climb along the ramp's centreline.
      let prev = -Infinity;
      for (let u = -r.length / 2; u <= r.length / 2; u += 25) {
        const h = at(u);
        expect(h).toBeGreaterThan(prev - 3);
        prev = h;
      }
    }
  });

  it('base edges away from ramps are cliffs', () => {
    // The Warden base's diagonal edge between the mid and bottom ramps.
    const a = { x: -3400, z: -7700 };
    const b = { x: -3200, z: -5400 };
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }; // (-3300, -6550)
    const inside = field.heightAt(mid.x - 250, mid.z);
    const outside = field.heightAt(mid.x + 250, mid.z);
    expect(inside - outside).toBeGreaterThan(L.high - L.low - 30);
  });

  it('unwalkable rock rises above the high ground', () => {
    for (const r of map.regions.filter((r) => r.tag === 'unwalkable')) {
      const c = polygonCentroid(r.polygon);
      expect(field.heightAt(c.x, c.z)).toBeGreaterThan(L.high);
    }
  });

  it('the boss pit is a bowl at its level with a wall away from the entrance', () => {
    const { position: p, radius } = map.bossPit;
    expect(Math.abs(field.heightAt(p.x, p.z) - L.river)).toBeLessThan(6);
    const facing = (map.bossPit.entranceFacing * Math.PI) / 180;
    const wallAt = (angle: number) =>
      field.heightAt(p.x + Math.cos(angle) * (radius + 60), p.z + Math.sin(angle) * (radius + 60));
    expect(wallAt(facing + Math.PI)).toBeGreaterThan(L.low + 80); // back wall
    expect(wallAt(facing)).toBeLessThan(L.low + 20); // the opening
  });

  it('regionAt honours the precedence rule', () => {
    expect(field.regionAt(-6000, -6000)?.id).toBe('w_base');
    expect(field.regionAt(0, 0)?.tag).toBe('river'); // river beats the mid lane
    expect(field.regionAt(map.bossPit.position.x, map.bossPit.position.z)?.tag).toBe('pit');
    expect(field.regionAt(-7900, 0)?.tag).toBe('unwalkable');
  });

  it('is 180° symmetric up to noise', () => {
    for (const p of [
      { x: -6000, z: -6000 },
      { x: -2800, z: 250 },
      { x: 1500, z: -2400 },
      { x: -3883, z: -4094 },
      { x: -4200, z: 2300 },
    ]) {
      expect(Math.abs(field.heightAt(p.x, p.z) - field.heightAt(-p.x, -p.z))).toBeLessThan(30);
    }
  });
});

describe('splat weights', () => {
  it('biome follows the river side and agrees with each region faction', () => {
    expect(field.splatAt(-6000, -6000).faction).toBe(0);
    expect(field.splatAt(6000, 6000).faction).toBe(1);
    for (const r of map.regions.filter((r) => r.faction !== 'neutral')) {
      const c = polygonCentroid(r.polygon);
      const side = riverSide(map, c);
      expect(side > 0 ? 'hollow' : 'wardens').toBe(r.faction);
    }
  });
  it('lanes get dirt, jungle does not, bases get paving', () => {
    expect(field.splatAt(-2700, -3100).lane).toBeGreaterThan(0.9);
    expect(field.splatAt(-4500, -5800).lane).toBeLessThan(0.1);
    expect(field.splatAt(-6000, -6000).court).toBeGreaterThan(0.5);
    expect(field.splatAt(0, -3000).court).toBe(0);
  });
});

describe('height grid and sampler', () => {
  const small = createHeightSampler(map, { step: 200 });

  it('sampling at grid points returns the baked samples exactly', () => {
    const g = small.grid;
    for (const [i, j] of [
      [0, 0],
      [40, 40],
      [17, 63],
      [80, 80],
    ] as const) {
      const x = g.origin + i * g.step;
      const z = g.origin + j * g.step;
      expect(sampleHeightGrid(g, x, z)).toBeCloseTo(g.heights[j * g.size + i]!, 4);
    }
  });

  it('interpolates linearly inside a cell and clamps outside the map', () => {
    const flat = createTerrainField({ ...map } as MapSpec);
    const g = bakeHeightGrid(flat, 400);
    const x = g.origin + 10.25 * g.step;
    const z = g.origin + 20.5 * g.step;
    const h = sampleHeightGrid(g, x, z);
    const hs = [
      g.heights[20 * g.size + 10]!,
      g.heights[20 * g.size + 11]!,
      g.heights[21 * g.size + 10]!,
      g.heights[21 * g.size + 11]!,
    ];
    expect(h).toBeGreaterThanOrEqual(Math.min(...hs) - 1e-4);
    expect(h).toBeLessThanOrEqual(Math.max(...hs) + 1e-4);
    expect(sampleHeightGrid(g, -1e6, -1e6)).toBe(g.heights[0]);
  });

  it('rejects a step that does not divide the map', () => {
    expect(() => bakeHeightGrid(field, 333)).toThrow();
  });

  it('normals point up on flat ground and tilt away from a cliff', () => {
    const g = small.grid;
    const n = [0, 0, 0];
    const i = Math.round((-2700 - g.origin) / g.step);
    const j = Math.round((-3100 - g.origin) / g.step);
    gridNormal(g, i, j, n);
    expect(n[1]).toBeGreaterThan(0.95);
    expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1, 5);
  });

  it('the shared Citadel sampler matches the analytic field on plateaus and in the river', () => {
    const s = getCitadelHeightSampler();
    expect(s.grid.size).toBe(641);
    for (const p of [
      { x: -6000, z: -6000 },
      { x: 6000, z: 6000 },
      { x: 0, z: 0 },
      { x: -2800, z: 250 },
    ]) {
      expect(Math.abs(s.mapHeightAt(p.x, p.z) - field.heightAt(p.x, p.z))).toBeLessThan(2);
      // World-unit API: x, z and the result are map units / 32.
      expect(s.heightAt(p.x * MAP_TO_WORLD, p.z * MAP_TO_WORLD)).toBeCloseTo(
        s.mapHeightAt(p.x, p.z) * MAP_TO_WORLD,
        5,
      );
    }
    expect(MAP_UNITS_PER_WORLD_UNIT * MAP_TO_WORLD).toBe(1);
    // A detached reference works (structures pass it as an option).
    const { heightAt } = s;
    expect(heightAt(-6000 / 32, -6000 / 32)).toBeCloseTo(256 / 32, 0);
  });
});
