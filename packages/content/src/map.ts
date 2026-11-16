import { z } from 'zod';

/**
 * Map spec (M1-04). One JSON file describes a whole battlefield: lanes, river, regions, ramps,
 * tree zones, structures, camps, runes and the boss pit.
 *
 * Coordinates are world units on the ground plane, origin at the map centre, **+x east, +z north**.
 * Angles (`facing`, `direction`) are degrees counter-clockwise from +x (0 = east, 90 = north).
 *
 * Region precedence where polygons overlap (highest wins):
 * unwalkable > pit > river > base > highground > lane > jungle. Anything not covered by a region
 * is open low ground.
 */

const Id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'lowercase snake_case id');

export const Vec2Schema = z.object({ x: z.number(), z: z.number() });
export type Vec2 = z.infer<typeof Vec2Schema>;

export const FactionSchema = z.enum(['wardens', 'hollow']);
export type Faction = z.infer<typeof FactionSchema>;
/** Structures and regions may also be `neutral` (side/secret shops, the river). */
export const OwnerSchema = z.enum(['wardens', 'hollow', 'neutral']);
export type Owner = z.infer<typeof OwnerSchema>;

export const LaneIdSchema = z.enum(['top', 'mid', 'bottom']);
export type LaneId = z.infer<typeof LaneIdSchema>;

export const HeightLevelSchema = z.enum(['river', 'low', 'mid', 'high']);
export type HeightLevel = z.infer<typeof HeightLevelSchema>;

const Angle = z.number().min(0).lt(360);
const Polygon = z.array(Vec2Schema).min(3);

export const LaneSchema = z.object({
  id: LaneIdSchema,
  /** Walkable lane width in world units (creep flow field corridor). */
  width: z.number().positive(),
  /** Polyline from the Warden base to the Hollow base. */
  waypoints: z.array(Vec2Schema).min(2),
});
export type Lane = z.infer<typeof LaneSchema>;

export const RiverSchema = z.object({
  waypoints: z.array(Vec2Schema).min(2),
  width: z.number().positive(),
});

export const RegionTagSchema = z.enum([
  'base',
  'highground',
  'jungle',
  'river',
  'pit',
  'lane',
  'unwalkable',
]);
export type RegionTag = z.infer<typeof RegionTagSchema>;

export const RegionSchema = z.object({
  id: Id,
  tag: RegionTagSchema,
  height: HeightLevelSchema,
  /** Which side's biome the region belongs to (terrain blends Warden/Hollow looks). */
  faction: OwnerSchema,
  polygon: Polygon,
});
export type Region = z.infer<typeof RegionSchema>;

export const RampSchema = z.object({
  id: Id,
  /** Centre of the ramp. */
  position: Vec2Schema,
  /** Direction of travel when walking from `from` to `to` (degrees). */
  direction: Angle,
  width: z.number().positive(),
  length: z.number().positive(),
  from: HeightLevelSchema,
  to: HeightLevelSchema,
});
export type Ramp = z.infer<typeof RampSchema>;

export const TreeZoneSchema = z.object({
  id: Id,
  polygon: Polygon,
  /** 0 = empty, 1 = as dense as foliage allows. */
  density: z.number().min(0).max(1),
  seed: z.number().int().nonnegative(),
});
export type TreeZone = z.infer<typeof TreeZoneSchema>;

export const StructureTypeSchema = z.enum([
  'tower',
  'barracks_melee',
  'barracks_ranged',
  'ancient',
  'fountain',
  'shop_base',
  'shop_side',
  'shop_secret',
]);
export type StructureType = z.infer<typeof StructureTypeSchema>;

export const StructureSchema = z.object({
  id: Id,
  faction: OwnerSchema,
  type: StructureTypeSchema,
  lane: LaneIdSchema.optional(),
  /** Towers only: 1–3 per lane, 4 guards the ancient. */
  tier: z.number().int().min(1).max(4).optional(),
  position: Vec2Schema,
  facing: Angle,
});
export type Structure = z.infer<typeof StructureSchema>;

export const CampTierSchema = z.enum(['small', 'medium', 'large', 'ancient']);
export type CampTier = z.infer<typeof CampTierSchema>;

export const CampSchema = z.object({
  id: Id,
  tier: CampTierSchema,
  /** Which side's jungle the camp sits in. */
  side: FactionSchema,
  position: Vec2Schema,
  /** A new wave spawns only if no unit stands inside this radius (stacking). */
  spawnBoxRadius: z.number().positive(),
});
export type Camp = z.infer<typeof CampSchema>;

export const RuneSpotSchema = z.object({ id: Id, position: Vec2Schema });

export const BossPitSchema = z.object({
  position: Vec2Schema,
  radius: z.number().positive(),
  /** The pit is walled except for an opening facing this way (degrees). */
  entranceFacing: Angle,
});

export const HeightLevelsSchema = z
  .object({ river: z.number(), low: z.number(), mid: z.number(), high: z.number() })
  .refine((h) => h.river < h.low && h.low < h.mid && h.mid < h.high, {
    message: 'height levels must rise river < low < mid < high',
  });

/** How far (world units) a mirrored feature may sit from its exact rotated position. */
export const SYMMETRY_TOLERANCE = 25;
/** How far (degrees) a mirrored facing may differ from the exact rotated facing. */
export const SYMMETRY_ANGLE_TOLERANCE = 2;

const MapShape = z.object({
  id: Id,
  name: z.string().min(1),
  size: z.object({ width: z.number().positive(), depth: z.number().positive() }),
  /** Elevation of each height level in world units. */
  heightLevels: HeightLevelsSchema,
  lanes: z.array(LaneSchema).length(3),
  river: RiverSchema,
  regions: z.array(RegionSchema),
  ramps: z.array(RampSchema),
  treeZones: z.array(TreeZoneSchema),
  structures: z.array(StructureSchema),
  camps: z.array(CampSchema),
  runeSpots: z.array(RuneSpotSchema).length(2),
  bossPit: BossPitSchema,
  spawnPoints: z.object({
    wardens: z.array(Vec2Schema).min(5),
    hollow: z.array(Vec2Schema).min(5),
  }),
});

export type MapSpec = z.infer<typeof MapShape>;

// ---------------------------------------------------------------------------
// Geometry helpers (shared with tools and, later, the sim/terrain loaders)
// ---------------------------------------------------------------------------

/** Rotate a point 180° around the map centre. */
export const rotate180 = (p: Vec2): Vec2 => ({ x: -p.x, z: -p.z });

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

export const polylineLength = (points: readonly Vec2[]): number =>
  points.slice(1).reduce((sum, p, i) => sum + distance(points[i]!, p), 0);

/** Point at arc length `d` along a polyline (clamped to its ends). */
export function pointAlong(points: readonly Vec2[], d: number): Vec2 {
  let left = Math.max(0, d);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = distance(a, b);
    if (left <= seg && seg > 0) {
      const t = left / seg;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    left -= seg;
  }
  return points[points.length - 1]!;
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

const mirrorOwner = (o: Owner): Owner =>
  o === 'wardens' ? 'hollow' : o === 'hollow' ? 'wardens' : 'neutral';
const mirrorLane = (l: LaneId | undefined): LaneId | undefined =>
  l === 'top' ? 'bottom' : l === 'bottom' ? 'top' : l;
const angleDiff = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
};
const near = (a: Vec2, b: Vec2): boolean => distance(a, b) <= SYMMETRY_TOLERANCE;
const fmt = (p: Vec2): string => `(${Math.round(p.x)}, ${Math.round(p.z)})`;

/** True if polyline `b` equals polyline `a` rotated 180° and walked backwards. */
const polylineMirrors = (a: readonly Vec2[], b: readonly Vec2[]): boolean =>
  a.length === b.length && a.every((p, i) => near(rotate180(p), b[b.length - 1 - i]!));

/** True if polygon `b` equals polygon `a` rotated 180°, allowing any starting vertex. */
function polygonMirrors(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  if (a.length !== b.length) return false;
  const n = a.length;
  for (let shift = 0; shift < n; shift++) {
    if (a.every((p, i) => near(rotate180(p), b[(i + shift) % n]!))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rules beyond shape
// ---------------------------------------------------------------------------

type Ctx = z.RefinementCtx;

function checkUniqueIds(map: MapSpec, ctx: Ctx): void {
  const seen = new Set<string>();
  const lists = ['regions', 'ramps', 'treeZones', 'structures', 'camps', 'runeSpots'] as const;
  for (const key of lists) {
    map[key].forEach((item, i) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [key, i, 'id'],
          message: `duplicate id "${item.id}"`,
        });
      }
      seen.add(item.id);
    });
  }
  const laneIds = new Set(map.lanes.map((l) => l.id));
  if (laneIds.size !== 3) {
    ctx.addIssue({ code: 'custom', path: ['lanes'], message: 'lanes must be top, mid and bottom' });
  }
}

function checkBounds(map: MapSpec, ctx: Ctx): void {
  const hx = map.size.width / 2;
  const hz = map.size.depth / 2;
  const check = (p: Vec2, path: (string | number)[], what: string): void => {
    if (Math.abs(p.x) > hx || Math.abs(p.z) > hz) {
      ctx.addIssue({ code: 'custom', path, message: `${what} at ${fmt(p)} is out of map bounds` });
    }
  };
  map.structures.forEach((s, i) => check(s.position, ['structures', i, 'position'], s.id));
  map.camps.forEach((c, i) => check(c.position, ['camps', i, 'position'], c.id));
  map.runeSpots.forEach((r, i) => check(r.position, ['runeSpots', i, 'position'], r.id));
  map.ramps.forEach((r, i) => check(r.position, ['ramps', i, 'position'], r.id));
  check(map.bossPit.position, ['bossPit', 'position'], 'boss pit');
  map.lanes.forEach((l, i) =>
    l.waypoints.forEach((p, j) => check(p, ['lanes', i, 'waypoints', j], `${l.id} lane waypoint`)),
  );
  map.river.waypoints.forEach((p, j) => check(p, ['river', 'waypoints', j], 'river waypoint'));
  map.regions.forEach((r, i) =>
    r.polygon.forEach((p, j) => check(p, ['regions', i, 'polygon', j], `${r.id} vertex`)),
  );
  map.treeZones.forEach((t, i) =>
    t.polygon.forEach((p, j) => check(p, ['treeZones', i, 'polygon', j], `${t.id} vertex`)),
  );
  for (const f of FactionSchema.options) {
    map.spawnPoints[f].forEach((p, j) => check(p, ['spawnPoints', f, j], `${f} spawn point`));
  }
}

function checkStructures(map: MapSpec, ctx: Ctx): void {
  map.structures.forEach((s, i) => {
    if (s.type === 'tower') {
      if (s.tier === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['structures', i, 'tier'],
          message: 'towers need a tier',
        });
      } else if ((s.tier === 4) !== (s.lane === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: ['structures', i, 'lane'],
          message: 'T1–T3 towers need a lane; T4 towers guard the ancient and have none',
        });
      }
    } else if (s.tier !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['structures', i, 'tier'],
        message: `only towers have a tier (${s.id} is ${s.type})`,
      });
    }
    if (s.faction === 'neutral' && s.type !== 'shop_side' && s.type !== 'shop_secret') {
      ctx.addIssue({
        code: 'custom',
        path: ['structures', i, 'faction'],
        message: `${s.type} must belong to a faction`,
      });
    }
    if ((s.type === 'barracks_melee' || s.type === 'barracks_ranged') && !s.lane) {
      ctx.addIssue({
        code: 'custom',
        path: ['structures', i, 'lane'],
        message: 'barracks need a lane',
      });
    }
  });

  for (const faction of FactionSchema.options) {
    const own = map.structures.filter((s) => s.faction === faction);
    const count = (pred: (s: Structure) => boolean): number => own.filter(pred).length;
    for (const lane of LaneIdSchema.options) {
      for (const tier of [1, 2, 3]) {
        const n = count((s) => s.type === 'tower' && s.lane === lane && s.tier === tier);
        if (n !== 1) {
          ctx.addIssue({
            code: 'custom',
            path: ['structures'],
            message: `${faction} need exactly 1 tier ${tier} tower in the ${lane} lane, found ${n}`,
          });
        }
      }
      for (const type of ['barracks_melee', 'barracks_ranged'] as const) {
        const n = count((s) => s.type === type && s.lane === lane);
        if (n !== 1) {
          ctx.addIssue({
            code: 'custom',
            path: ['structures'],
            message: `${faction} need exactly 1 ${type} in the ${lane} lane (2 barracks per lane), found ${n}`,
          });
        }
      }
    }
    const t4 = count((s) => s.type === 'tower' && s.tier === 4);
    if (t4 !== 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['structures'],
        message: `${faction} need exactly 2 tier 4 towers, found ${t4}`,
      });
    }
    for (const type of ['ancient', 'fountain'] as const) {
      const n = count((s) => s.type === type);
      if (n !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['structures'],
          message: `${faction} need exactly 1 ${type}, found ${n}`,
        });
      }
    }
  }
}

function checkSymmetry(map: MapSpec, ctx: Ctx): void {
  const fail = (path: (string | number)[], message: string): void =>
    ctx.addIssue({ code: 'custom', path, message: `symmetry: ${message}` });

  map.structures.forEach((s, i) => {
    const want = rotate180(s.position);
    const ok = map.structures.some(
      (t) =>
        t.faction === mirrorOwner(s.faction) &&
        t.type === s.type &&
        t.tier === s.tier &&
        t.lane === mirrorLane(s.lane) &&
        near(t.position, want) &&
        angleDiff(t.facing, s.facing + 180) <= SYMMETRY_ANGLE_TOLERANCE,
    );
    if (!ok) {
      fail(
        ['structures', i],
        `${s.id} has no ${mirrorOwner(s.faction)} ${s.type} counterpart at ${fmt(want)} facing ${(s.facing + 180) % 360}°`,
      );
    }
  });

  map.camps.forEach((c, i) => {
    const want = rotate180(c.position);
    const ok = map.camps.some(
      (d) =>
        d.tier === c.tier &&
        d.side === mirrorOwner(c.side) &&
        d.spawnBoxRadius === c.spawnBoxRadius &&
        near(d.position, want),
    );
    if (!ok) fail(['camps', i], `${c.id} has no ${c.tier} camp counterpart at ${fmt(want)}`);
  });

  map.runeSpots.forEach((r, i) => {
    const want = rotate180(r.position);
    if (!map.runeSpots.some((q) => near(q.position, want))) {
      fail(['runeSpots', i], `${r.id} has no rune spot counterpart at ${fmt(want)}`);
    }
  });

  map.ramps.forEach((r, i) => {
    const want = rotate180(r.position);
    const ok = map.ramps.some(
      (q) =>
        q.from === r.from &&
        q.to === r.to &&
        q.width === r.width &&
        q.length === r.length &&
        near(q.position, want) &&
        angleDiff(q.direction, r.direction + 180) <= SYMMETRY_ANGLE_TOLERANCE,
    );
    if (!ok) fail(['ramps', i], `${r.id} has no ramp counterpart at ${fmt(want)}`);
  });

  map.regions.forEach((r, i) => {
    // The single boss pit cannot be mirrored; its fairness is checked on `bossPit` below.
    if (r.tag === 'pit') return;
    const ok = map.regions.some(
      (q) =>
        q.tag === r.tag &&
        q.height === r.height &&
        q.faction === mirrorOwner(r.faction) &&
        polygonMirrors(r.polygon, q.polygon),
    );
    if (!ok) fail(['regions', i], `${r.id} has no rotated ${r.tag} region counterpart`);
  });

  map.treeZones.forEach((t, i) => {
    const ok = map.treeZones.some(
      (q) => q.density === t.density && q.seed === t.seed && polygonMirrors(t.polygon, q.polygon),
    );
    if (!ok) fail(['treeZones', i], `${t.id} has no rotated tree zone counterpart`);
  });

  const lane = (id: LaneId): Lane | undefined => map.lanes.find((l) => l.id === id);
  const [top, mid, bottom] = [lane('top'), lane('mid'), lane('bottom')];
  if (
    top &&
    bottom &&
    (!polylineMirrors(top.waypoints, bottom.waypoints) || top.width !== bottom.width)
  ) {
    fail(['lanes'], 'the bottom lane must be the top lane rotated 180° (and reversed)');
  }
  if (mid && !polylineMirrors(mid.waypoints, mid.waypoints)) {
    fail(['lanes'], 'the mid lane must map onto itself under a 180° rotation');
  }
  if (!polylineMirrors(map.river.waypoints, map.river.waypoints)) {
    fail(['river', 'waypoints'], 'the river must map onto itself under a 180° rotation');
  }

  map.spawnPoints.wardens.forEach((p, j) => {
    const want = rotate180(p);
    if (!map.spawnPoints.hollow.some((q) => near(q, want))) {
      fail(['spawnPoints', 'wardens', j], `no hollow spawn point at ${fmt(want)}`);
    }
  });
  if (map.spawnPoints.wardens.length !== map.spawnPoints.hollow.length) {
    fail(['spawnPoints'], 'both factions need the same number of spawn points');
  }

  const ancient = (f: Faction): Structure | undefined =>
    map.structures.find((s) => s.faction === f && s.type === 'ancient');
  const [wa, ha] = [ancient('wardens'), ancient('hollow')];
  if (wa && ha) {
    const dw = distance(map.bossPit.position, wa.position);
    const dh = distance(map.bossPit.position, ha.position);
    if (Math.abs(dw - dh) > SYMMETRY_TOLERANCE) {
      fail(
        ['bossPit', 'position'],
        `boss pit must be equidistant from both ancients (${Math.round(dw)} vs ${Math.round(dh)})`,
      );
    }
  }
}

export const MapSchema = MapShape.superRefine((map, ctx) => {
  checkUniqueIds(map, ctx);
  checkBounds(map, ctx);
  checkStructures(map, ctx);
  checkSymmetry(map, ctx);
});
