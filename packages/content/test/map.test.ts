import { describe, expect, it } from 'vitest';
import { MapSchema, polylineLength, rotate180, type MapSpec } from '../src';
import citadel from '../data/map/citadel.json';

const clone = (): MapSpec => structuredClone(citadel) as MapSpec;
const messages = (data: unknown): string[] => {
  const result = MapSchema.safeParse(data);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe('MapSchema: shipped citadel map', () => {
  it('validates', () => {
    expect(messages(citadel)).toEqual([]);
  });

  it('has the genre structure counts per side', () => {
    const map = MapSchema.parse(citadel);
    for (const f of ['wardens', 'hollow'] as const) {
      const own = map.structures.filter((s) => s.faction === f);
      expect(own.filter((s) => s.type === 'tower')).toHaveLength(11);
      expect(own.filter((s) => s.type.startsWith('barracks'))).toHaveLength(6);
      expect(map.camps.filter((c) => c.side === f)).toHaveLength(9);
    }
    expect(map.structures.filter((s) => s.type === 'shop_side')).toHaveLength(2);
    expect(map.structures.filter((s) => s.type === 'shop_secret')).toHaveLength(2);
  });

  it('has equal-length side lanes', () => {
    const map = MapSchema.parse(citadel);
    const len = (id: string) => polylineLength(map.lanes.find((l) => l.id === id)!.waypoints);
    expect(len('top')).toBeCloseTo(len('bottom'), 6);
  });
});

describe('MapSchema: broken fixtures fail', () => {
  it('rejects a missing T2 tower', () => {
    const map = clone();
    map.structures = map.structures.filter((s) => s.id !== 'w_tower_top_t2');
    expect(messages(map)).toContain('wardens need exactly 1 tier 2 tower in the top lane, found 0');
  });

  it('rejects an out-of-bounds structure', () => {
    const map = clone();
    const fountain = map.structures.find((s) => s.id === 'w_fountain')!;
    fountain.position = { x: -9000, z: -7150 };
    expect(
      messages(map).some((m) => m.includes('w_fountain') && m.includes('out of map bounds')),
    ).toBe(true);
  });

  it('rejects broken 180° symmetry', () => {
    const map = clone();
    const camp = map.camps.find((c) => c.id === 'w_camp_large_east')!;
    camp.position = { x: camp.position.x + 300, z: camp.position.z };
    const errs = messages(map);
    expect(errs.some((m) => m.startsWith('symmetry:') && m.includes('w_camp_large_east'))).toBe(
      true,
    );
    // Its partner loses its counterpart too.
    expect(errs.some((m) => m.startsWith('symmetry:') && m.includes('h_camp_large_east'))).toBe(
      true,
    );
  });

  it('rejects a mirrored tower whose facing is not rotated', () => {
    const map = clone();
    map.structures.find((s) => s.id === 'h_tower_mid_t1')!.facing = 0;
    expect(messages(map).some((m) => m.includes('w_tower_mid_t1'))).toBe(true);
  });

  it('rejects a duplicate ancient', () => {
    const map = clone();
    const ancient = map.structures.find((s) => s.id === 'w_ancient')!;
    map.structures.push({ ...ancient, id: 'w_ancient_2' });
    expect(messages(map)).toContain('wardens need exactly 1 ancient, found 2');
  });

  it('rejects duplicate ids and a non-tower with a tier', () => {
    const map = clone();
    map.camps[1]!.id = map.camps[0]!.id;
    map.structures.find((s) => s.id === 'w_fountain')!.tier = 2;
    const errs = messages(map);
    expect(errs.some((m) => m.startsWith('duplicate id'))).toBe(true);
    expect(errs.some((m) => m.startsWith('only towers have a tier'))).toBe(true);
  });

  it('rejects an off-centre boss pit', () => {
    const map = clone();
    map.bossPit.position = { x: 3000, z: -2000 };
    expect(messages(map).some((m) => m.includes('equidistant'))).toBe(true);
  });
});

describe('rotate180', () => {
  it('maps a point through the centre', () => {
    expect(rotate180({ x: 100, z: -250 })).toEqual({ x: -100, z: 250 });
  });
});
