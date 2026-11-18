/**
 * Pure placement logic for structures (no Babylon): which model variant each
 * `structures[]` entry of the map spec gets, and where it stands in the world.
 *
 * Map spec coordinates (packages/content/src/map.ts) are "map units": a 16000²
 * board, +x east, +z north, `facing` in degrees counter-clockwise from +x. The
 * client renders in "world units" where a displayed hero is ~5 tall
 * (docs/design/units.md §7), so the map is scaled down by
 * MAP_UNITS_PER_WORLD_UNIT. Babylon is left-handed with +x east and +z north,
 * so the axes carry over unchanged. See docs/design/structures.md.
 */
import type { Owner, Structure } from '@citadel/content';

/**
 * Map units per world unit. 32 puts the 16000-unit map at 500 world units, a
 * 750-unit lane at ~23 world units (about 11 displayed heroes abreast), and
 * keeps the default MOBA camera view (~90 world units wide) at ~2900 map units,
 * which is the usual MOBA screen. Terrain (M1-05) should share this constant.
 */
export const MAP_UNITS_PER_WORLD_UNIT = 32;

/** Terrain height in world units at a world-space ground point. */
export type HeightAt = (x: number, z: number) => number;

export const FLAT_GROUND: HeightAt = () => 0;

export const STRUCTURE_KINDS = [
  'tower_t1',
  'tower_t2',
  'tower_t3',
  'tower_t4',
  'barracks_melee',
  'barracks_ranged',
  'ancient',
  'fountain',
  'shop_base',
  'shop_side',
  'shop_secret',
] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

/** A model variant: who owns it and what it is (e.g. `wardens:tower_t2`). */
export type VariantId = `${Owner}:${StructureKind}`;

export const variantKey = (owner: Owner, kind: StructureKind): VariantId => `${owner}:${kind}`;

export function parseVariant(id: VariantId): { owner: Owner; kind: StructureKind } {
  const [owner, kind] = id.split(':') as [Owner, StructureKind];
  return { owner, kind };
}

/** The model kind for a map structure (towers pick their kind from `tier`). */
export function structureKind(s: Pick<Structure, 'id' | 'type' | 'tier'>): StructureKind {
  if (s.type === 'tower') {
    if (s.tier === undefined) throw new Error(`tower ${s.id} has no tier`);
    return `tower_t${s.tier}` as StructureKind;
  }
  return s.type;
}

export function structureVariant(
  s: Pick<Structure, 'id' | 'type' | 'tier' | 'faction'>,
): VariantId {
  return variantKey(s.faction, structureKind(s));
}

/**
 * Babylon `rotation.y` that turns a model's front (local +z) toward a map
 * `facing` (degrees CCW from +x). Babylon rotates local +z to (sin r, cos r)
 * in (x, z), so r = 90° - facing. Normalised to (-π, π].
 */
export function facingToRotationY(facingDeg: number): number {
  let r = ((90 - facingDeg) * Math.PI) / 180;
  while (r <= -Math.PI) r += 2 * Math.PI;
  while (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

export function mapToWorld(
  p: { x: number; z: number },
  scale = MAP_UNITS_PER_WORLD_UNIT,
): { x: number; z: number } {
  return { x: p.x / scale, z: p.z / scale };
}

/**
 * Ground height for a footprint: the lowest of the centre and 8 points on the
 * footprint rim. Taking the minimum sinks a structure slightly into a slope
 * instead of leaving one side floating; the plinths are tall enough to hide it.
 */
export function footprintHeight(heightAt: HeightAt, x: number, z: number, radius: number): number {
  let y = heightAt(x, z);
  if (radius <= 0) return y;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    y = Math.min(y, heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius));
  }
  return y;
}

export interface StructurePlacement {
  id: string;
  variant: VariantId;
  owner: Owner;
  kind: StructureKind;
  /** World position of the model origin (centre of its base). */
  x: number;
  y: number;
  z: number;
  /** Babylon rotation.y in radians. */
  rotationY: number;
}

export interface PlaceOptions {
  /** Map units per world unit (default MAP_UNITS_PER_WORLD_UNIT). */
  scale?: number;
  /** Terrain height in world units; defaults to flat ground at y = 0. */
  heightAt?: HeightAt;
  /** Footprint radius (world units) per kind, for slope-safe snapping. */
  footprintRadius?: Partial<Record<StructureKind, number>>;
}

/** World placements for every structure in a map spec, in spec order. */
export function placeStructures(
  structures: readonly Structure[],
  opts: PlaceOptions = {},
): StructurePlacement[] {
  const scale = opts.scale ?? MAP_UNITS_PER_WORLD_UNIT;
  const heightAt = opts.heightAt ?? FLAT_GROUND;
  return structures.map((s) => {
    const kind = structureKind(s);
    const { x, z } = mapToWorld(s.position, scale);
    const radius = opts.footprintRadius?.[kind] ?? 0;
    return {
      id: s.id,
      variant: variantKey(s.faction, kind),
      owner: s.faction,
      kind,
      x,
      y: footprintHeight(heightAt, x, z, radius),
      z,
      rotationY: facingToRotationY(s.facing),
    };
  });
}

/** How many placements use each variant. */
export function countByVariant(placements: readonly StructurePlacement[]): Map<VariantId, number> {
  const out = new Map<VariantId, number>();
  for (const p of placements) out.set(p.variant, (out.get(p.variant) ?? 0) + 1);
  return out;
}
