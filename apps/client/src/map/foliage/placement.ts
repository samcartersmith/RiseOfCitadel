/**
 * Deterministic tree and grass scatter for the Citadel map (M1-07). Pure: no
 * DOM, no Babylon, no Math.random. The M2 sim builds its destructible tree
 * occupancy from the same function, so client and server agree on every
 * tree's position and ID (docs/design/map.md → "How other work consumes this data").
 *
 * All coordinates here are **map units** (see map/scale.ts). The renderer
 * converts to world units and snaps to the terrain.
 */
import type { MapSpec, StructureType, TreeZone } from '@citadel/content';
import type { TerrainField } from '../terrain/heightfield';
import { riverSide } from '../terrain/heightfield';
import { polygonSdf, polylineDistance, boundsOf, type P2 } from '../terrain/geometry';
import { fbm } from '../terrain/noise';

/** One placed tree. `id` is its index in the returned array, stable for a given map + tuning. */
export interface TreePlacement {
  id: number;
  /** Map units. */
  x: number;
  z: number;
  /** 0 = Warden biome (south-west of the river), 1 = Hollow. */
  biome: 0 | 1;
  /** Uniform random in [0, 1): picks the species and variant (shared by mirror twins). */
  pick: number;
  /** Size multiplier around 1. */
  scale: number;
  /** Rotation about Y, radians. */
  yaw: number;
  /** The tree zone it came from. */
  zone: string;
}

export interface ScatterTuning {
  /** Poisson-disk spacing between tree trunks (map units). */
  spacing: number;
  /** Feature size of the clump noise (map units): bigger = larger groves and clearings. */
  clumpScale: number;
  /** Width of the noise band where a zone fades from forest to clearing (0..1 of noise range). */
  clumpSoftness: number;
  /** Added to every zone's density: the forested fraction of a zone is about density + bias. */
  densityBias: number;
  /** Extra clearance beyond each lane's half-width (map units). */
  laneMargin: number;
  /** Extra clearance beyond the river's half-width. */
  riverMargin: number;
  /** Extra clearance around ramps (beyond their width × length rectangle). */
  rampMargin: number;
  /** Extra clearance beyond each camp's spawn box. */
  campMargin: number;
  /** Clear radius around rune spots. */
  runeRadius: number;
  /** Extra clearance beyond the boss pit radius. */
  pitMargin: number;
  /** Clear radius per structure type. */
  structureRadius: Readonly<Record<StructureType, number>>;
  /** Clear radius around hero spawn points. */
  spawnRadius: number;
  /** Max height difference across ±slopeProbe map units before a spot counts as a cliff. */
  maxRise: number;
  slopeProbe: number;
}

export const DEFAULT_SCATTER_TUNING: Readonly<ScatterTuning> = {
  spacing: 115,
  clumpScale: 1500,
  clumpSoftness: 0.22,
  densityBias: 0.08,
  laneMargin: 170,
  riverMargin: 160,
  rampMargin: 160,
  campMargin: 200,
  runeRadius: 450,
  pitMargin: 380,
  structureRadius: {
    tower: 420,
    barracks_melee: 480,
    barracks_ranged: 480,
    ancient: 820,
    fountain: 720,
    shop_base: 420,
    shop_side: 420,
    shop_secret: 420,
  },
  spawnRadius: 320,
  maxRise: 40,
  slopeProbe: 55,
};

// ------------------------------------------------------------------ random

/** mulberry32: tiny seeded PRNG, [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of (a, b) → [0, 1). */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ Poisson disk

/**
 * Bridson Poisson-disk samples inside `poly` (seeded). Returns points in
 * generation order, which is deterministic for a given seed.
 */
export function poissonInPolygon(poly: readonly P2[], spacing: number, seed: number, k = 20): P2[] {
  const rand = mulberry32(seed);
  const box = boundsOf(poly);
  const cell = spacing / Math.SQRT2;
  const cols = Math.max(1, Math.ceil((box.maxX - box.minX) / cell));
  const rows = Math.max(1, Math.ceil((box.maxZ - box.minZ) / cell));
  const grid = new Int32Array(cols * rows).fill(-1);
  const pts: P2[] = [];
  const active: number[] = [];
  const r2 = spacing * spacing;

  const cellOf = (p: P2) => {
    const i = Math.min(cols - 1, Math.floor((p.x - box.minX) / cell));
    const j = Math.min(rows - 1, Math.floor((p.z - box.minZ) / cell));
    return [i, j] as const;
  };
  const fits = (p: P2) => {
    if (p.x < box.minX || p.x > box.maxX || p.z < box.minZ || p.z > box.maxZ) return false;
    if (polygonSdf(p.x, p.z, poly) > 0) return false;
    const [ci, cj] = cellOf(p);
    for (let j = Math.max(0, cj - 2); j <= Math.min(rows - 1, cj + 2); j++) {
      for (let i = Math.max(0, ci - 2); i <= Math.min(cols - 1, ci + 2); i++) {
        const q = grid[j * cols + i]!;
        if (q < 0) continue;
        const o = pts[q]!;
        const dx = o.x - p.x;
        const dz = o.z - p.z;
        if (dx * dx + dz * dz < r2) return false;
      }
    }
    return true;
  };
  const add = (p: P2) => {
    const [ci, cj] = cellOf(p);
    grid[cj * cols + ci] = pts.length;
    active.push(pts.length);
    pts.push(p);
  };

  // Seed points: several, so thin polygons (edge strips) fill from more than one end.
  for (let s = 0, tries = 0; s < 4 && tries < 400; tries++) {
    const p = {
      x: box.minX + rand() * (box.maxX - box.minX),
      z: box.minZ + rand() * (box.maxZ - box.minZ),
    };
    if (fits(p)) {
      add(p);
      s++;
    }
  }
  while (active.length) {
    const ai = Math.floor(rand() * active.length);
    const base = pts[active[ai]!]!;
    let found = false;
    for (let t = 0; t < k; t++) {
      const a = rand() * Math.PI * 2;
      const d = spacing * (1 + rand());
      const p = { x: base.x + Math.cos(a) * d, z: base.z + Math.sin(a) * d };
      if (fits(p)) {
        add(p);
        found = true;
      }
    }
    if (!found) active.splice(ai, 1);
  }
  return pts;
}

// ------------------------------------------------------------------ keep-clear rules

export type ClearReason =
  'region' | 'lane' | 'river' | 'ramp' | 'structure' | 'camp' | 'rune' | 'pit' | 'spawn' | 'cliff';

const DEG = Math.PI / 180;
const BLOCKING_TAGS = new Set(['unwalkable', 'river', 'pit', 'lane']);

/**
 * Builds the keep-clear test for trees: returns why a map point must stay
 * free of trees, or null if a tree may stand there.
 */
export function createClearanceTest(
  field: TerrainField,
  tuning: Readonly<ScatterTuning> = DEFAULT_SCATTER_TUNING,
): (x: number, z: number) => ClearReason | null {
  const map = field.map;
  const t = tuning;
  const ramps = map.ramps.map((r) => ({
    cx: r.position.x,
    cz: r.position.z,
    dx: Math.cos(r.direction * DEG),
    dz: Math.sin(r.direction * DEG),
    halfL: r.length / 2 + t.rampMargin,
    halfW: r.width / 2 + t.rampMargin,
  }));
  const discs: { x: number; z: number; r2: number; why: ClearReason }[] = [];
  for (const s of map.structures) {
    const r = t.structureRadius[s.type];
    discs.push({ x: s.position.x, z: s.position.z, r2: r * r, why: 'structure' });
  }
  for (const c of map.camps) {
    const r = c.spawnBoxRadius + t.campMargin;
    discs.push({ x: c.position.x, z: c.position.z, r2: r * r, why: 'camp' });
  }
  for (const r of map.runeSpots) {
    discs.push({ x: r.position.x, z: r.position.z, r2: t.runeRadius ** 2, why: 'rune' });
  }
  {
    const r = map.bossPit.radius + t.pitMargin;
    discs.push({ x: map.bossPit.position.x, z: map.bossPit.position.z, r2: r * r, why: 'pit' });
  }
  for (const side of [map.spawnPoints.wardens, map.spawnPoints.hollow]) {
    for (const p of side) discs.push({ x: p.x, z: p.z, r2: t.spawnRadius ** 2, why: 'spawn' });
  }
  const riverClear = map.river.width / 2 + t.riverMargin;
  const probe = t.slopeProbe;

  return (x, z) => {
    for (const d of discs) {
      const dx = x - d.x;
      const dz = z - d.z;
      if (dx * dx + dz * dz < d.r2) return d.why;
    }
    for (const l of map.lanes) {
      if (polylineDistance(x, z, l.waypoints) < l.width / 2 + t.laneMargin) return 'lane';
    }
    if (polylineDistance(x, z, map.river.waypoints) < riverClear) return 'river';
    for (const r of ramps) {
      const ox = x - r.cx;
      const oz = z - r.cz;
      const u = ox * r.dx + oz * r.dz;
      const v = -ox * r.dz + oz * r.dx;
      if (Math.abs(u) < r.halfL && Math.abs(v) < r.halfW) return 'ramp';
    }
    const region = field.regionAt(x, z);
    if (region && BLOCKING_TAGS.has(region.tag)) return 'region';
    const h0 = field.heightAt(x, z);
    const rise = Math.max(
      Math.abs(field.heightAt(x + probe, z) - h0),
      Math.abs(field.heightAt(x - probe, z) - h0),
      Math.abs(field.heightAt(x, z + probe) - h0),
      Math.abs(field.heightAt(x, z - probe) - h0),
    );
    if (rise > t.maxRise) return 'cliff';
    return null;
  };
}

// ------------------------------------------------------------------ zones and mirroring

/**
 * Pairs each tree zone with its 180°-rotated twin (same seed, polygon equal
 * under rotation within `tolerance`). Returns [primary, twin | null] with the
 * primary on the Warden side, so the Warden layout is scattered once and
 * rotated into the Hollow zone (docs/design/map.md → Tree zones).
 */
export function pairTreeZones(map: MapSpec, tolerance = 30): [TreeZone, TreeZone | null][] {
  const used = new Set<string>();
  const out: [TreeZone, TreeZone | null][] = [];
  const sorted = [...map.treeZones].sort((a, b) => a.id.localeCompare(b.id));
  const centroidSide = (z: TreeZone) => {
    let cx = 0;
    let cz = 0;
    for (const p of z.polygon) {
      cx += p.x;
      cz += p.z;
    }
    return riverSide(map, { x: cx / z.polygon.length, z: cz / z.polygon.length });
  };
  const isTwin = (a: TreeZone, b: TreeZone) =>
    a.seed === b.seed &&
    a.polygon.length === b.polygon.length &&
    a.polygon.every((p) => b.polygon.some((q) => Math.hypot(p.x + q.x, p.z + q.z) <= tolerance));
  for (const z of sorted) {
    if (used.has(z.id)) continue;
    used.add(z.id);
    const twin = sorted.find((o) => !used.has(o.id) && isTwin(z, o)) ?? null;
    if (twin) used.add(twin.id);
    if (twin && centroidSide(z) > centroidSide(twin)) out.push([twin, z]);
    else out.push([z, twin]);
  }
  return out;
}

export interface ScatterResult {
  trees: TreePlacement[];
  /** Candidates rejected per rule (for docs and tests). */
  rejected: Record<ClearReason | 'clump', number>;
  /** Trees per zone id. */
  perZone: Record<string, number>;
}

/**
 * Scatters trees over every tree zone. Warden zones are scattered once and
 * rotated 180° into their Hollow twins; each copy then passes the keep-clear
 * rules on its own (the map is point-symmetric except for the boss pit).
 */
export function scatterTrees(
  field: TerrainField,
  tuning: Partial<ScatterTuning> = {},
): ScatterResult {
  const t: ScatterTuning = { ...DEFAULT_SCATTER_TUNING, ...tuning };
  const map = field.map;
  const clear = createClearanceTest(field, t);
  const trees: TreePlacement[] = [];
  const rejected: ScatterResult['rejected'] = {
    clump: 0,
    region: 0,
    lane: 0,
    river: 0,
    ramp: 0,
    structure: 0,
    camp: 0,
    rune: 0,
    pit: 0,
    spawn: 0,
    cliff: 0,
  };
  const perZone: Record<string, number> = {};

  const tryAdd = (
    zone: TreeZone,
    x: number,
    z: number,
    pick: number,
    scale: number,
    yaw: number,
  ) => {
    const why = clear(x, z);
    if (why) {
      rejected[why]++;
      return;
    }
    trees.push({
      id: trees.length,
      x,
      z,
      biome: riverSide(map, { x, z }) > 0 ? 1 : 0,
      pick,
      scale,
      yaw,
      zone: zone.id,
    });
    perZone[zone.id] = (perZone[zone.id] ?? 0) + 1;
  };

  for (const [zone, twin] of pairTreeZones(map)) {
    const pts = poissonInPolygon(zone.polygon, t.spacing, zone.seed * 7919 + 17);
    // Groves and clearings: keep a point where the clump noise clears a threshold set
    // by the zone density (density 0.45 → about 45% of the zone is forest).
    const forest = Math.min(1, zone.density + t.densityBias);
    const lo = 1 - forest - t.clumpSoftness / 2;
    const hi = 1 - forest + t.clumpSoftness / 2;
    const rand = mulberry32(zone.seed * 104729 + 3);
    for (const p of pts) {
      const n = fbm(p.x / t.clumpScale, p.z / t.clumpScale, 3, zone.seed) * 0.5 + 0.5;
      const keepP = hi <= lo ? 1 : Math.min(1, Math.max(0, (n - lo) / (hi - lo)));
      const roll = rand();
      const pick = rand();
      const scale = 0.85 + rand() * 0.35;
      const yaw = rand() * Math.PI * 2;
      if (roll >= keepP) {
        rejected.clump += twin ? 2 : 1;
        continue;
      }
      tryAdd(zone, p.x, p.z, pick, scale, yaw);
      if (twin) tryAdd(twin, -p.x, -p.z, pick, scale, yaw + Math.PI);
    }
  }
  return { trees, rejected, perZone };
}

// ------------------------------------------------------------------ grass

export interface GrassTuning {
  /** Jittered-grid spacing between tufts (map units). */
  spacing: number;
  /** Feature size of the patch noise (map units). */
  patchScale: number;
  /** Fraction of candidate spots kept (patchy, 0..1). */
  coverage: number;
  /** Max lane / paving splat weight a tuft may stand on. */
  maxLane: number;
}

export const DEFAULT_GRASS_TUNING: Readonly<GrassTuning> = {
  spacing: 60,
  patchScale: 700,
  coverage: 0.55,
  maxLane: 0.2,
};

/**
 * Grass tufts inside a map-unit rectangle, as flat [x, z, yaw, scale, biome] tuples
 * (biome 0 Warden … 1 Hollow, from the splat). Deterministic for a given rectangle.
 * Tufts avoid lanes, paving, the riverbed, cliffs and rock.
 */
export function scatterGrass(
  field: TerrainField,
  rect: { minX: number; minZ: number; maxX: number; maxZ: number },
  tuning: Partial<GrassTuning> = {},
): number[] {
  const g: GrassTuning = { ...DEFAULT_GRASS_TUNING, ...tuning };
  const L = field.levels;
  const out: number[] = [];
  const splat = { lane: 0, faction: 0, forest: 0, court: 0 };
  const i0 = Math.floor(rect.minX / g.spacing);
  const i1 = Math.ceil(rect.maxX / g.spacing);
  const j0 = Math.floor(rect.minZ / g.spacing);
  const j1 = Math.ceil(rect.maxZ / g.spacing);
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const r1 = hash01(i * 3 + 1, j * 7 + 5);
      const r2 = hash01(i * 11 + 2, j * 13 + 9);
      const x = (i + r1) * g.spacing;
      const z = (j + r2) * g.spacing;
      if (x < rect.minX || x >= rect.maxX || z < rect.minZ || z >= rect.maxZ) continue;
      const n = fbm(x / g.patchScale, z / g.patchScale, 2, 4242) * 0.5 + 0.5;
      if (n < 1 - g.coverage) continue;
      field.splatAt(x, z, splat);
      if (splat.lane > g.maxLane || splat.court > g.maxLane) continue;
      const h = field.heightAt(x, z);
      if (h < L.low - 12 || h > L.high + 30) continue;
      const tag = field.regionAt(x, z)?.tag;
      if (tag === 'unwalkable' || tag === 'river' || tag === 'pit') continue;
      if (
        Math.abs(field.heightAt(x + 40, z) - h) > 30 ||
        Math.abs(field.heightAt(x, z + 40) - h) > 30
      )
        continue;
      out.push(
        x,
        z,
        hash01(i * 17 + 3, j * 19 + 1) * Math.PI * 2,
        0.7 + hash01(i, j) * 0.6,
        splat.faction,
      );
    }
  }
  return out;
}
