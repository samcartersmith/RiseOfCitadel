/**
 * The terrain as pure maths (M1-05): height and splat weights at any ground
 * point, built from the map spec (docs/design/map.md → "How other work
 * consumes this data"). No DOM, no Babylon, deterministic, so the client mesh,
 * unit tests and later systems (foliage, structures, decals, the M2 nav grid)
 * all agree on where the ground is.
 *
 * Everything here is in **map units** (the JSON's coordinates and height
 * levels). Scene units are map units × MAP_TO_WORLD (sampler.ts).
 *
 * Height, in order (later steps win where they overlap, matching the map's
 * region precedence unwalkable > pit > river > base > highground > lane > jungle):
 *  1. open low ground: `low` plus gentle noise, flattened along lanes;
 *  2. `highground` then `base` plateaus at their level, with cliff edges
 *     (a steep blend `cliffWidth` wide, its line wobbled by noise);
 *  3. the riverbed carved along `river.waypoints` with sloped, walkable banks;
 *  4. the boss pit: a bowl at its level with a rim wall, open toward `entranceFacing`;
 *  5. ramps: a straight slope from `from` to `to` across the cliff;
 *  6. `unwalkable` regions: rugged rock rising above `high`.
 */
import type { HeightLevel, MapSpec, Region } from '@citadel/content';
import {
  boundsOf,
  clamp01,
  inBox,
  lerp,
  polygonSdf,
  polylineDistance,
  polylineSide,
  smoothstep,
  type Box,
  type P2,
} from './geometry';
import { fbm } from './noise';

/** Shape knobs (map units). Defaults are tuned for the Citadel map. */
export interface TerrainTuning {
  /** Horizontal width of a cliff (the blend between two levels). */
  cliffWidth: number;
  /** How far noise pushes a cliff line in or out. */
  cliffJitter: number;
  /** River bank: slope starts this far inside the river's half-width... */
  bankInner: number;
  /** ...and reaches low ground this far outside it. */
  bankOuter: number;
  /** Amplitude of the rolling noise on open low ground (± units). */
  lowNoise: number;
  /** Fraction of `lowNoise` left on lane centrelines. */
  laneFlatten: number;
  /** Amplitude of the noise on plateau tops (± units). */
  plateauNoise: number;
  /** Unwalkable rock rises at least this far above `high`... */
  rockBase: number;
  /** ...plus up to this much ridged relief. */
  rockRelief: number;
  /** Boss pit rim wall height above `low` and its thickness. */
  pitWallHeight: number;
  pitWallWidth: number;
  /** Half-angle (degrees) of the pit's opening. */
  pitOpeningDeg: number;
  /** Noise seed (heights and splat breakup). */
  seed: number;
}

export const DEFAULT_TERRAIN_TUNING: Readonly<TerrainTuning> = {
  cliffWidth: 90,
  cliffJitter: 35,
  bankInner: 230,
  bankOuter: 90,
  lowNoise: 14,
  laneFlatten: 0.25,
  plateauNoise: 5,
  rockBase: 90,
  rockRelief: 170,
  pitWallHeight: 150,
  pitWallWidth: 150,
  pitOpeningDeg: 34,
  seed: 1729,
};

/** Splat weights at a point, all 0..1 (what the control texture stores). */
export interface SplatSample {
  /** Lane dirt path. */
  lane: number;
  /** Biome: 0 = Warden (south-west), 1 = Hollow (north-east). */
  faction: number;
  /** Forest floor inside tree zones. */
  forest: number;
  /** Paved courts and roads inside the bases (around the ancient, fountain, shop, towers, barracks). */
  court: number;
}

export interface TerrainField {
  readonly map: MapSpec;
  readonly tuning: Readonly<TerrainTuning>;
  /** Elevation of each height level (map units). */
  readonly levels: Readonly<Record<HeightLevel, number>>;
  /** Exact analytic height at (x, z), map units. */
  heightAt(x: number, z: number): number;
  /** Splat weights at (x, z). Writes into `out` when given. */
  splatAt(x: number, z: number, out?: SplatSample): SplatSample;
  /** The region that owns (x, z) under the map's precedence rule, or null for open low ground. */
  regionAt(x: number, z: number): Region | null;
}

/** Region precedence from the map spec, lowest first. */
export const REGION_PRECEDENCE: readonly Region['tag'][] = [
  'jungle',
  'lane',
  'highground',
  'base',
  'river',
  'pit',
  'unwalkable',
];

interface PreparedRegion {
  region: Region;
  box: Box;
  level: number;
}

const DEG = Math.PI / 180;

export function createTerrainField(
  map: MapSpec,
  tuning: Partial<TerrainTuning> = {},
): TerrainField {
  const t: TerrainTuning = { ...DEFAULT_TERRAIN_TUNING, ...tuning };
  const L = map.heightLevels;
  const seed = t.seed;
  const pad = t.cliffWidth + t.cliffJitter * 2 + 10;

  const prep = (tag: Region['tag'], extraPad = 0): PreparedRegion[] =>
    map.regions
      .filter((r) => r.tag === tag)
      .map((r) => ({ region: r, box: boundsOf(r.polygon, pad + extraPad), level: L[r.height] }));

  const plateaus = [...prep('highground'), ...prep('base')];
  const unwalkable = prep('unwalkable', t.cliffJitter);
  const bases = prep('base');
  /** Paved courts around base structures (radius by type, map units). */
  const COURT_RADIUS: Partial<Record<MapSpec['structures'][number]['type'], number>> = {
    ancient: 950,
    fountain: 800,
    shop_base: 380,
    barracks_melee: 380,
    barracks_ranged: 380,
    tower: 320,
  };
  const courtSpots = map.structures
    .filter((s) => s.faction !== 'neutral' && COURT_RADIUS[s.type] !== undefined)
    .map((s) => ({ x: s.position.x, z: s.position.z, r: COURT_RADIUS[s.type]! }));
  const ordered = REGION_PRECEDENCE.flatMap((tag) => map.regions.filter((r) => r.tag === tag));
  const regionBoxes = new Map(ordered.map((r) => [r, boundsOf(r.polygon)]));

  const river = map.river.waypoints;
  const riverHalf = map.river.width / 2;
  const lanes = map.lanes.map((l) => ({ pts: l.waypoints, half: l.width / 2 }));
  const treeZones = map.treeZones.map((z) => ({
    poly: z.polygon,
    box: boundsOf(z.polygon, 260),
    density: z.density,
  }));

  const pit = map.bossPit;
  const pitPoly = map.regions.find((r) => r.tag === 'pit')?.polygon ?? null;
  const pitBox = pitPoly ? boundsOf(pitPoly, t.pitWallWidth + 80) : null;
  const pitFacing = {
    x: Math.cos(pit.entranceFacing * DEG),
    z: Math.sin(pit.entranceFacing * DEG),
  };
  const pitOpenOuter = Math.cos((t.pitOpeningDeg + 8) * DEG);
  const pitOpenInner = Math.cos((t.pitOpeningDeg - 4) * DEG);

  const ramps = map.ramps.map((r) => {
    const dx = Math.cos(r.direction * DEG);
    const dz = Math.sin(r.direction * DEG);
    const reach = Math.hypot(r.length, r.width) / 2 + 80;
    return {
      cx: r.position.x,
      cz: r.position.z,
      dx,
      dz,
      halfW: r.width / 2,
      halfL: r.length / 2,
      from: L[r.from],
      to: L[r.to],
      box: {
        minX: r.position.x - reach,
        maxX: r.position.x + reach,
        minZ: r.position.z - reach,
        maxZ: r.position.z + reach,
      },
    };
  });

  const laneDistance = (x: number, z: number): number => {
    // Distance in "half-widths" to the nearest lane centreline (0 = centre, 1 = edge).
    let best = Infinity;
    for (const lane of lanes) {
      const d = polylineDistance(x, z, lane.pts) / lane.half;
      if (d < best) best = d;
    }
    return best;
  };

  const cliffJitter = (x: number, z: number): number =>
    fbm(x / 420, z / 420, 2, seed + 7) * t.cliffJitter;

  function heightAt(x: number, z: number): number {
    // 1. Open low ground, flatter on the lanes.
    const laneCore = 1 - smoothstep(0.6, 1.4, laneDistance(x, z));
    const roll = fbm(x / 1900, z / 1900, 3, seed) * t.lowNoise;
    let h = L.low + roll * (1 - (1 - t.laneFlatten) * laneCore);

    // 2. Plateaus (highground first, then bases) with noisy cliff lines.
    let jitter = NaN;
    for (const p of plateaus) {
      if (!inBox(p.box, x, z)) continue;
      if (Number.isNaN(jitter)) jitter = cliffJitter(x, z);
      const sd = polygonSdf(x, z, p.region.polygon) + jitter;
      const c = smoothstep(t.cliffWidth / 2, -t.cliffWidth / 2, sd);
      if (c <= 0) continue;
      const top = p.level + fbm(x / 700, z / 700, 2, seed + 3) * t.plateauNoise;
      h = lerp(h, top, c);
    }

    // 3. Riverbed along the waypoints, with sloped walkable banks.
    const rd = polylineDistance(x, z, river) + fbm(x / 600, z / 600, 2, seed + 11) * 45;
    const rc = smoothstep(riverHalf + t.bankOuter, riverHalf - t.bankInner, rd);
    if (rc > 0) h = lerp(h, L.river + fbm(x / 500, z / 500, 2, seed + 13) * 4, rc);

    // 4. Boss pit: a bowl at its level, ringed by a wall except toward the entrance.
    if (pitPoly && pitBox && inBox(pitBox, x, z)) {
      const sd = polygonSdf(x, z, pitPoly);
      const floor = smoothstep(40, -120, sd);
      if (floor > 0) h = lerp(h, L[pitLevel(map)], floor);
      const ox = x - pit.position.x;
      const oz = z - pit.position.z;
      const len = Math.hypot(ox, oz) || 1;
      const facing = (ox * pitFacing.x + oz * pitFacing.z) / len;
      const open = smoothstep(pitOpenOuter, pitOpenInner, facing);
      const wall =
        smoothstep(-10, 40, sd) *
        smoothstep(t.pitWallWidth + 40, t.pitWallWidth - 20, sd) *
        (1 - open);
      if (wall > 0) {
        const top = L.low + t.pitWallHeight + fbm(x / 160, z / 160, 2, seed + 17) * 25;
        h = lerp(h, top, wall);
      }
    }

    // 5. Ramps: straight slopes across the cliff.
    for (const r of ramps) {
      if (!inBox(r.box, x, z)) continue;
      const ox = x - r.cx;
      const oz = z - r.cz;
      const u = ox * r.dx + oz * r.dz;
      const v = -ox * r.dz + oz * r.dx;
      const across = smoothstep(r.halfW + 40, r.halfW - 10, Math.abs(v));
      const along = smoothstep(r.halfL + 70, r.halfL, Math.abs(u));
      const c = across * along;
      if (c <= 0) continue;
      const s = clamp01((u + r.halfL) / (2 * r.halfL));
      const eased = 0.5 * (s + s * s * (3 - 2 * s));
      h = lerp(h, lerp(r.from, r.to, eased), c);
    }

    // 6. Unwalkable rock: rugged, always above the high ground.
    for (const p of unwalkable) {
      if (!inBox(p.box, x, z)) continue;
      const sd = polygonSdf(x, z, p.region.polygon) + 1.6 * cliffJitter(x, z);
      const c = smoothstep(t.cliffWidth * 0.7, -t.cliffWidth * 0.7, sd);
      if (c <= 0) continue;
      const ridge = 1 - Math.abs(fbm(x / 300, z / 300, 3, seed + 23));
      const inner = smoothstep(0, -220, sd); // taller away from the edge
      const top =
        Math.max(p.level, L.high) +
        t.rockBase +
        ridge * ridge * t.rockRelief * (0.25 + 0.75 * inner);
      h = Math.max(h, lerp(h, top, c));
    }
    return h;
  }

  function splatAt(
    x: number,
    z: number,
    out: SplatSample = { lane: 0, faction: 0, forest: 0, court: 0 },
  ) {
    const edge = fbm(x / 260, z / 260, 2, seed + 31);
    out.lane = smoothstep(0.92, 0.5, laneDistance(x, z) + edge * 0.22);

    const side = polylineSide(x, z, river) + fbm(x / 900, z / 900, 2, seed + 37) * 260;
    out.faction = smoothstep(-riverHalf * 1.1, riverHalf * 1.1, side);

    let forest = 0;
    for (const zone of treeZones) {
      if (!inBox(zone.box, x, z)) continue;
      const sd = polygonSdf(x, z, zone.poly) + edge * 120;
      const f = smoothstep(220, -260, sd) * (0.55 + 0.45 * zone.density);
      if (f > forest) forest = f;
    }
    out.forest = forest;

    let inBase = 0;
    for (const b of bases) {
      if (!inBox(b.box, x, z)) continue;
      const c = smoothstep(-40, -260, polygonSdf(x, z, b.region.polygon));
      if (c > inBase) inBase = c;
    }
    let court = 0;
    if (inBase > 0) {
      for (const s of courtSpots) {
        const d = Math.hypot(x - s.x, z - s.z) + edge * 60;
        const c = smoothstep(s.r + 40, s.r - 60, d);
        if (c > court) court = c;
      }
      // Lanes become paved roads once they climb into a base.
      court = Math.max(court, out.lane) * inBase;
    }
    out.court = court;
    return out;
  }

  function regionAt(x: number, z: number): Region | null {
    for (let i = ordered.length - 1; i >= 0; i--) {
      const r = ordered[i]!;
      if (!inBox(regionBoxes.get(r)!, x, z)) continue;
      if (polygonSdf(x, z, r.polygon) <= 0) return r;
    }
    return null;
  }

  return { map, tuning: t, levels: L, heightAt, splatAt, regionAt };
}

const pitLevel = (map: MapSpec): HeightLevel =>
  map.regions.find((r) => r.tag === 'pit')?.height ?? 'river';

/** The Warden/Hollow side of the river at (x, z): signed distance, > 0 on the Hollow side. */
export function riverSide(map: MapSpec, p: P2): number {
  return polylineSide(p.x, p.z, map.river.waypoints);
}
