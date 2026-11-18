/**
 * Public height API for everything that needs to stand on the terrain
 * (structures M1-08, foliage M1-07, VFX decals, the M2 nav grid). Pure: no
 * DOM, no Babylon, safe in a worker or a Node test.
 *
 *   import { getCitadelHeightSampler, MAP_TO_WORLD } from '../map/terrain/sampler';
 *   const terrain = getCitadelHeightSampler();
 *   mesh.position.set(wx, terrain.heightAt(wx, wz), wz);   // world (scene) units in and out
 *   terrain.mapHeightAt(s.position.x, s.position.z);         // map units in and out
 *
 * `heightAt` has the `heightAt?(x, z)` shape M1-08's `createStructureSet` takes,
 * so `{ heightAt: terrain.heightAt }` plugs straight in (it's a plain closure, no `this`).
 *
 * Both interpolate the same grid samples and triangles the terrain mesh is
 * built from, so a point sits on the rendered (full-detail) ground.
 */
import type { MapSpec } from '@citadel/content';
import { CITADEL_MAP } from './citadelMap';
import { createTerrainField, type TerrainField, type TerrainTuning } from './heightfield';
import { bakeHeightGrid, sampleHeightGrid, type HeightGrid } from './heightGrid';

import { MAP_TO_WORLD, MAP_UNITS_PER_WORLD_UNIT } from '../scale';

/** Map/world scale lives in `map/scale.ts`, shared with structures; re-exported for callers. */
export { MAP_TO_WORLD, MAP_UNITS_PER_WORLD_UNIT };

/** Map units between height samples (and terrain vertices at full detail): ~0.78 world units. */
export const DEFAULT_GRID_STEP = 25;

export interface HeightSampler {
  /** Ground height at world point (x, z). World (scene) units in, world units out. */
  heightAt(x: number, z: number): number;
  /** Ground height at map point (x, z). Map units in, map units out. */
  mapHeightAt(x: number, z: number): number;
  /** The analytic field the grid was baked from (exact heights, splat weights, regions). */
  readonly field: TerrainField;
  /** The baked samples the mesh is built from. */
  readonly grid: HeightGrid;
}

export interface HeightSamplerOptions {
  step?: number;
  tuning?: Partial<TerrainTuning>;
}

export function createHeightSampler(map: MapSpec, opts: HeightSamplerOptions = {}): HeightSampler {
  const field = createTerrainField(map, opts.tuning);
  const grid = bakeHeightGrid(field, opts.step ?? DEFAULT_GRID_STEP);
  return {
    field,
    grid,
    heightAt: (x, z) =>
      sampleHeightGrid(grid, x * MAP_UNITS_PER_WORLD_UNIT, z * MAP_UNITS_PER_WORLD_UNIT) *
      MAP_TO_WORLD,
    mapHeightAt: (x, z) => sampleHeightGrid(grid, x, z),
  };
}

let citadel: HeightSampler | null = null;

/** The Citadel map's sampler, baked once on first use (~0.3 s) and shared. */
export function getCitadelHeightSampler(): HeightSampler {
  citadel ??= createHeightSampler(CITADEL_MAP);
  return citadel;
}

/** Map point → world point (x, z). */
export const mapToWorld = (p: { x: number; z: number }): { x: number; z: number } => ({
  x: p.x * MAP_TO_WORLD,
  z: p.z * MAP_TO_WORLD,
});
