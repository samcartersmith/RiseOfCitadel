import { describe, expect, it } from 'vitest';
import { MapSchema, type Structure } from '@citadel/content';
import citadelJson from '../../../../../packages/content/data/map/citadel.json';
import {
  countByVariant,
  facingToRotationY,
  footprintHeight,
  MAP_UNITS_PER_WORLD_UNIT,
  placeStructures,
  structureKind,
  structureVariant,
} from './placement';
import { footprintRadii, RECIPES } from './recipes';

const map = MapSchema.parse(citadelJson);

describe('structureKind / structureVariant', () => {
  it('picks the tower kind from the tier', () => {
    const t = { id: 'x', type: 'tower', tier: 3, faction: 'hollow' } as const;
    expect(structureKind(t)).toBe('tower_t3');
    expect(structureVariant(t)).toBe('hollow:tower_t3');
  });
  it('rejects a tower without a tier', () => {
    expect(() => structureKind({ id: 'x', type: 'tower' })).toThrow(/tier/);
  });
  it('passes other types through', () => {
    expect(structureVariant({ id: 'x', type: 'shop_secret', faction: 'neutral' })).toBe(
      'neutral:shop_secret',
    );
  });
});

describe('facingToRotationY', () => {
  // Babylon rotation.y = r turns local +z to (sin r, cos r) in (x, z).
  const front = (deg: number) => {
    const r = facingToRotationY(deg);
    return [Math.sin(r), Math.cos(r)];
  };
  it.each([0, 45, 90, 135, 180, 225, 270, 315, 359])('points the front along facing %i°', (deg) => {
    const [x, z] = front(deg);
    expect(x).toBeCloseTo(Math.cos((deg * Math.PI) / 180), 9);
    expect(z).toBeCloseTo(Math.sin((deg * Math.PI) / 180), 9);
  });
  it('stays within (-π, π]', () => {
    for (let d = 0; d < 360; d += 7) {
      const r = facingToRotationY(d);
      expect(r).toBeGreaterThan(-Math.PI);
      expect(r).toBeLessThanOrEqual(Math.PI);
    }
  });
});

describe('footprintHeight', () => {
  it('is the centre height on flat ground', () => {
    expect(footprintHeight(() => 3, 1, 2, 5)).toBe(3);
  });
  it('takes the lowest rim sample on a slope', () => {
    const slope = (x: number) => x * 0.5;
    expect(footprintHeight(slope, 10, 0, 4)).toBeCloseTo(3); // (10 - 4) * 0.5
  });
  it('samples only the centre for a zero radius', () => {
    expect(footprintHeight((x) => x, 7, 0, 0)).toBe(7);
  });
});

describe('placeStructures on citadel.json', () => {
  const placed = placeStructures(map.structures, { footprintRadius: footprintRadii() });

  it('places every structure once, in order', () => {
    expect(placed.map((p) => p.id)).toEqual(map.structures.map((s) => s.id));
  });

  it('has a recipe for every variant the map uses', () => {
    for (const p of placed) expect(RECIPES.has(p.variant), p.variant).toBe(true);
  });

  it('scales map units into world units on flat ground', () => {
    const ancient = placed.find((p) => p.id === 'w_ancient')!;
    expect(ancient.x).toBeCloseTo(-6000 / MAP_UNITS_PER_WORLD_UNIT);
    expect(ancient.z).toBeCloseTo(-6000 / MAP_UNITS_PER_WORLD_UNIT);
    expect(ancient.y).toBe(0);
  });

  it('counts the genre layout per side', () => {
    const counts = countByVariant(placed);
    for (const side of ['wardens', 'hollow'] as const) {
      expect(counts.get(`${side}:tower_t1`)).toBe(3);
      expect(counts.get(`${side}:tower_t2`)).toBe(3);
      expect(counts.get(`${side}:tower_t3`)).toBe(3);
      expect(counts.get(`${side}:tower_t4`)).toBe(2);
      expect(counts.get(`${side}:barracks_melee`)).toBe(3);
      expect(counts.get(`${side}:barracks_ranged`)).toBe(3);
      expect(counts.get(`${side}:ancient`)).toBe(1);
      expect(counts.get(`${side}:fountain`)).toBe(1);
    }
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(map.structures.length);
  });

  it('snaps to terrain through heightAt (world coordinates)', () => {
    const plateau = (x: number, z: number) => (x + z < -250 ? 8 : 0);
    const onTerrain = placeStructures(map.structures, { heightAt: plateau });
    expect(onTerrain.find((p) => p.id === 'w_ancient')!.y).toBe(8);
    expect(onTerrain.find((p) => p.id === 'h_ancient')!.y).toBe(0);
  });

  it('honours a custom map scale', () => {
    const s: Structure = {
      id: 'a',
      faction: 'wardens',
      type: 'fountain',
      position: { x: 100, z: -50 },
      facing: 0,
    };
    const [p] = placeStructures([s], { scale: 10 });
    expect(p).toMatchObject({ x: 10, z: -5 });
  });
});
