import { describe, expect, it } from 'vitest';
import { createTerrainField } from '../terrain/heightfield';
import { CITADEL_MAP } from '../terrain/citadelMap';
import { polygonSdf, polylineDistance } from '../terrain/geometry';
import {
  createClearanceTest,
  DEFAULT_SCATTER_TUNING,
  hash01,
  mulberry32,
  pairTreeZones,
  poissonInPolygon,
  scatterGrass,
  scatterTrees,
} from './placement';
import { pickSpecies, SPECIES } from './species';

const field = createTerrainField(CITADEL_MAP);
const result = scatterTrees(field);
const trees = result.trees;

describe('tree scatter', () => {
  it('places 1500+ trees with sequential, stable IDs', () => {
    expect(trees.length).toBeGreaterThanOrEqual(1500);
    trees.forEach((t, i) => expect(t.id).toBe(i));
  });

  it('is deterministic', () => {
    const again = scatterTrees(field).trees;
    expect(again.length).toBe(trees.length);
    for (let i = 0; i < trees.length; i += 97) expect(again[i]).toEqual(trees[i]);
  });

  it('keeps every tree inside its tree zone', () => {
    const zones = new Map(CITADEL_MAP.treeZones.map((z) => [z.id, z]));
    for (const t of trees) {
      expect(polygonSdf(t.x, t.z, zones.get(t.zone)!.polygon)).toBeLessThanOrEqual(1e-6);
    }
    // Every zone gets trees.
    for (const z of CITADEL_MAP.treeZones) expect(result.perZone[z.id] ?? 0).toBeGreaterThan(0);
  });

  it('keeps lanes, river, ramps, structures, camps, runes, the pit and spawns clear', () => {
    const t = DEFAULT_SCATTER_TUNING;
    const map = CITADEL_MAP;
    for (const tree of trees) {
      for (const l of map.lanes) {
        expect(polylineDistance(tree.x, tree.z, l.waypoints)).toBeGreaterThanOrEqual(
          l.width / 2 + t.laneMargin,
        );
      }
      expect(polylineDistance(tree.x, tree.z, map.river.waypoints)).toBeGreaterThanOrEqual(
        map.river.width / 2 + t.riverMargin,
      );
      for (const s of map.structures) {
        expect(Math.hypot(tree.x - s.position.x, tree.z - s.position.z)).toBeGreaterThanOrEqual(
          t.structureRadius[s.type],
        );
      }
      for (const c of map.camps) {
        expect(Math.hypot(tree.x - c.position.x, tree.z - c.position.z)).toBeGreaterThanOrEqual(
          c.spawnBoxRadius + t.campMargin,
        );
      }
      for (const r of map.runeSpots) {
        expect(Math.hypot(tree.x - r.position.x, tree.z - r.position.z)).toBeGreaterThanOrEqual(
          t.runeRadius,
        );
      }
      const p = map.bossPit;
      expect(Math.hypot(tree.x - p.position.x, tree.z - p.position.z)).toBeGreaterThanOrEqual(
        p.radius + t.pitMargin,
      );
      const region = field.regionAt(tree.x, tree.z);
      expect(['unwalkable', 'river', 'pit', 'lane']).not.toContain(region?.tag);
    }
  });

  it('never stands a tree on a ramp or a cliff face', () => {
    const clear = createClearanceTest(field);
    for (const t of trees) expect(clear(t.x, t.z)).toBeNull();
    for (const r of CITADEL_MAP.ramps) {
      expect(trees.some((t) => Math.hypot(t.x - r.position.x, t.z - r.position.z) < 250)).toBe(
        false,
      );
    }
  });

  it('keeps trunks apart (Poisson spacing)', () => {
    // Check a sample against all others via a coarse grid.
    const cell = DEFAULT_SCATTER_TUNING.spacing;
    const grid = new Map<string, typeof trees>();
    for (const t of trees) {
      const k = `${Math.floor(t.x / cell)},${Math.floor(t.z / cell)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(t);
    }
    for (const t of trees) {
      const i = Math.floor(t.x / cell);
      const j = Math.floor(t.z / cell);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          for (const o of grid.get(`${i + di},${j + dj}`) ?? []) {
            if (o === t || o.zone !== t.zone) continue;
            expect(Math.hypot(o.x - t.x, o.z - t.z)).toBeGreaterThanOrEqual(cell - 1e-6);
          }
        }
      }
    }
  });

  it('mirrors the Warden layout 180° into the Hollow zones', () => {
    const pairs = pairTreeZones(CITADEL_MAP);
    expect(pairs).toHaveLength(6);
    for (const [w, h] of pairs) {
      expect(w.id.startsWith('w_')).toBe(true);
      expect(h?.id.startsWith('h_')).toBe(true);
    }
    const key = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`;
    const all = new Set(trees.map((t) => key(t.x, t.z)));
    const warden = trees.filter((t) => t.zone.startsWith('w_'));
    const twinned = warden.filter((t) => all.has(key(-t.x, -t.z))).length;
    // Only the boss pit (Warden side only) breaks the symmetry.
    expect(twinned / warden.length).toBeGreaterThan(0.97);
  });

  it('splits trees by biome along the river', () => {
    const hollow = trees.filter((t) => t.biome === 1).length;
    expect(hollow / trees.length).toBeGreaterThan(0.45);
    expect(hollow / trees.length).toBeLessThan(0.55);
    for (const t of trees) expect(t.biome).toBe(t.zone.startsWith('h_') ? 1 : 0);
  });
});

describe('poisson disk', () => {
  it('stays inside the polygon and respects spacing', () => {
    const poly = [
      { x: 0, z: 0 },
      { x: 1000, z: 0 },
      { x: 1000, z: 400 },
      { x: 0, z: 400 },
    ];
    const pts = poissonInPolygon(poly, 50, 7);
    expect(pts.length).toBeGreaterThan(60);
    for (const p of pts) expect(polygonSdf(p.x, p.z, poly)).toBeLessThanOrEqual(0);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z)).toBeGreaterThanOrEqual(50);
      }
    }
    expect(poissonInPolygon(poly, 50, 7)).toEqual(pts);
  });

  it('has a seeded PRNG and hash in [0, 1)', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(hash01(3, 4)).toBe(hash01(3, 4));
  });
});

describe('species', () => {
  it('picks only species of the tree biome, roughly by weight', () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 10000; i++) {
      const roll = i / 10000;
      for (const biome of [0, 1] as const) {
        const s = pickSpecies(biome, roll);
        expect(SPECIES[s]!.biome).toBe(biome);
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    for (const [i, s] of SPECIES.entries()) {
      const total = SPECIES.filter((o) => o.biome === s.biome).reduce((a, o) => a + o.weight, 0);
      expect(counts.get(i)! / 10000).toBeCloseTo(s.weight / total, 2);
    }
    expect(SPECIES.filter((s) => s.biome === 0).length).toBeGreaterThanOrEqual(3);
    expect(SPECIES.filter((s) => s.biome === 1).length).toBeGreaterThanOrEqual(3);
  });
});

describe('grass scatter', () => {
  it('fills jungle floor and avoids lanes and the river', () => {
    const jungle = scatterGrass(field, { minX: -1600, minZ: -5600, maxX: 0, maxZ: -4000 });
    expect(jungle.length / 5).toBeGreaterThan(200);
    const lane = scatterGrass(field, { minX: 1000, minZ: -6800, maxX: 1400, maxZ: -6500 });
    for (let i = 0; i < lane.length; i += 5) {
      const s = field.splatAt(lane[i]!, lane[i + 1]!);
      expect(s.lane).toBeLessThanOrEqual(0.2);
    }
    const river = scatterGrass(field, { minX: -300, minZ: -300, maxX: 300, maxZ: 300 });
    for (let i = 0; i < river.length; i += 5) {
      expect(field.regionAt(river[i]!, river[i + 1]!)?.tag).not.toBe('river');
    }
    expect(scatterGrass(field, { minX: -1600, minZ: -5600, maxX: 0, maxZ: -4000 })).toEqual(jungle);
  });
});
