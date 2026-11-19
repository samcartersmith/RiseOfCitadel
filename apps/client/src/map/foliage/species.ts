/**
 * Tree species per faction biome (M1-07). Pure data: which CC0 model each
 * species uses, how tall it stands, how it is recoloured into the Citadel
 * palette (art direction §2.1), how much it sways and what its far-LOD /
 * shadow proxy looks like. Docs: docs/design/foliage.md.
 */

/** A 3-stop colour ramp (dark → mid → light), sRGB hex. */
export type Ramp = readonly [string, string, string];

export type ProxyShape = 'cone' | 'round' | 'bare';

export interface SpeciesDef {
  id: string;
  /** 0 = Warden biome, 1 = Hollow. */
  biome: 0 | 1;
  /** GLB path under /models. */
  model: string;
  /** Share of the biome's trees (weights are normalised per biome). */
  weight: number;
  /** World height at scale 1 (a hero is about 5 tall). */
  height: number;
  /** Leaves / needles, by normalised luma. */
  foliage: Ramp;
  /** Trunk and branches. */
  bark: Ramp;
  /** Canopy sway as a fraction of the tree height. */
  wind: number;
  /** Far-LOD and shadow-proxy silhouette. */
  proxy: ProxyShape;
}

const WARDEN_BARK: Ramp = ['#4A3628', '#7A5A3E', '#A88A64'];
const HOLLOW_BARK: Ramp = ['#2C2832', '#4C4556', '#756D82'];

export const SPECIES: readonly SpeciesDef[] = [
  // ---- Warden: green moss, golden canopy, warm bark.
  {
    id: 'warden-oak',
    biome: 0,
    model: 'foliage-kaykit-hexagon/tree_round.glb',
    weight: 0.42,
    height: 7.2,
    foliage: ['#3B5A2C', '#6F9A4E', '#B9C46C'],
    bark: WARDEN_BARK,
    wind: 0.035,
    proxy: 'round',
  },
  {
    id: 'warden-fir',
    biome: 0,
    model: 'foliage-kaykit-hexagon/tree_cone.glb',
    weight: 0.3,
    height: 8.4,
    foliage: ['#2A4A30', '#4C7A45', '#8DB062'],
    bark: WARDEN_BARK,
    wind: 0.025,
    proxy: 'cone',
  },
  {
    id: 'warden-goldpine',
    biome: 0,
    model: 'foliage-kaykit-halloween/pine_tall.glb',
    weight: 0.28,
    height: 9.6,
    foliage: ['#6A5A26', '#B09A42', '#E2D27A'],
    bark: WARDEN_BARK,
    wind: 0.025,
    proxy: 'cone',
  },
  // ---- Hollow: ash, iron and cold violet; dead trees and teal-violet survivors.
  {
    id: 'hollow-deadwood',
    biome: 1,
    model: 'foliage-kaykit-halloween/dead_large.glb',
    weight: 0.3,
    height: 9.2,
    foliage: ['#3A3448', '#5E5672', '#958CAA'],
    bark: ['#2A2631', '#544C62', '#968DA8'],
    wind: 0.015,
    proxy: 'bare',
  },
  {
    id: 'hollow-snag',
    biome: 1,
    model: 'foliage-kaykit-halloween/dead_medium.glb',
    weight: 0.15,
    height: 7.4,
    foliage: ['#3A3448', '#5E5672', '#958CAA'],
    bark: ['#28252E', '#4E4858', '#8A8398'],
    wind: 0.015,
    proxy: 'bare',
  },
  {
    id: 'hollow-ashpine',
    biome: 1,
    model: 'foliage-kaykit-halloween/pine_tall.glb',
    weight: 0.3,
    height: 9.6,
    foliage: ['#26363E', '#3E6264', '#7BA19B'],
    bark: HOLLOW_BARK,
    wind: 0.025,
    proxy: 'cone',
  },
  {
    id: 'hollow-duskoak',
    biome: 1,
    model: 'foliage-kaykit-hexagon/tree_round.glb',
    weight: 0.25,
    height: 7.0,
    foliage: ['#33313D', '#575568', '#8E8B9E'],
    bark: HOLLOW_BARK,
    wind: 0.035,
    proxy: 'round',
  },
];

/** Picks a species index for a biome from a uniform [0, 1) roll (weights normalised per biome). */
export function pickSpecies(biome: 0 | 1, roll: number, species = SPECIES): number {
  let total = 0;
  for (const s of species) if (s.biome === biome) total += s.weight;
  let acc = 0;
  let last = -1;
  for (let i = 0; i < species.length; i++) {
    const s = species[i]!;
    if (s.biome !== biome) continue;
    last = i;
    acc += s.weight / total;
    if (roll < acc) return i;
  }
  return last;
}
