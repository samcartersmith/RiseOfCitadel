/**
 * Kit-bash recipes: every structure variant as plain data (no Babylon). A
 * recipe is a list of parts: KayKit Medieval Hexagon pieces (`piece`) and
 * procedural primitives (`prim`) textured from a swatch of the same atlas, or
 * glowing (`glow`). `structureSet.ts` merges them into one mesh per material
 * per LOD, so the whole recipe is a couple of draw calls, shared by every
 * instance on the map.
 *
 * Conventions: world units (a displayed hero is ~5 tall), origin at the centre
 * of the base on the ground, front = local +z (turned toward the map spec's
 * `facing`). Angles in degrees. Prims stand on their `at` point, except tori,
 * which are centred on it. See docs/design/structures.md for the design notes.
 */
import type { Owner } from '@citadel/content';
import { STRUCTURE_KINDS, variantKey, type StructureKind, type VariantId } from './placement';

export const PIECE_IDS = [
  'tower_a',
  'tower_b',
  'tower_base',
  'barracks',
  'archeryrange',
  'market',
  'well',
  'flag',
  'barrel',
  'crate',
  'tent',
  'weaponrack',
  'target',
  'mountain_a',
] as const;
export type PieceId = (typeof PIECE_IDS)[number];

/** Swatches of the KayKit hexagon atlas (8 × 4 grid; column, row from the top-left). */
export const SWATCHES = {
  stone: [2, 0],
  stoneDark: [3, 0],
  iron: [4, 0],
  black: [0, 0],
  white: [1, 0],
  wood: [6, 0],
  brass: [3, 1],
  ember: [7, 0],
  team: [0, 3],
} as const satisfies Record<string, readonly [number, number]>;
export type SwatchId = keyof typeof SWATCHES;

/** The atlas swatch that takes the team colour (the "blue" variant pieces use it). */
export const TEAM_SWATCH = SWATCHES.team;

export const GLOW_COLORS = {
  gold: '#FFC35C',
  violet: '#A46BFF',
  cyan: '#7FE3E0',
} as const;
export type GlowId = keyof typeof GLOW_COLORS;

export type Vec3 = readonly [number, number, number];

export type PrimShape =
  | { type: 'cylinder'; height: number; top: number; bottom: number; sides: number }
  | { type: 'box'; w: number; h: number; d: number }
  | { type: 'torus'; diameter: number; thickness: number; sides: number }
  /** Stretched octahedron standing on its lower tip. */
  | { type: 'crystal'; height: number; width: number };

interface PartBase {
  at?: Vec3;
  rotY?: number;
  rotX?: number;
  rotZ?: number;
  scale?: number | Vec3;
  /** Small detail: dropped from LOD1. */
  detail?: boolean;
  /** Part of the hovering group (bobs and spins; Ancient crown, crystals). */
  float?: boolean;
}
export interface KitPart extends PartBase {
  piece: PieceId;
}
export interface PrimPart extends PartBase {
  prim: PrimShape;
  /** Atlas swatch for the body material (default stone). Ignored when `glow` is set. */
  swatch?: SwatchId;
  glow?: GlowId;
}
export type Part = KitPart | PrimPart;

export const isKitPart = (p: Part): p is KitPart => 'piece' in p;

export interface Recipe {
  parts: Part[];
  /** Footprint radius (world units): terrain snapping and future collision art checks. */
  footprint: number;
  /** Casts into the cascaded shadow map (High tier). See the shadow policy in the doc. */
  castsShadow: boolean;
  /** Hover motion for `float` parts. */
  hover?: { amplitude: number; period: number; spin: number };
}

// ---------------------------------------------------------------------------
// Part helpers
// ---------------------------------------------------------------------------

const cyl = (
  height: number,
  bottom: number,
  top: number,
  sides: number,
  at: Vec3,
  rest: Omit<PrimPart, 'prim' | 'at'> = {},
): PrimPart => ({ prim: { type: 'cylinder', height, top, bottom, sides }, at, ...rest });

const box = (
  w: number,
  h: number,
  d: number,
  at: Vec3,
  rest: Omit<PrimPart, 'prim' | 'at'> = {},
): PrimPart => ({
  prim: { type: 'box', w, h, d },
  at,
  ...rest,
});

const crystal = (
  height: number,
  width: number,
  at: Vec3,
  glow: GlowId,
  rest: Omit<PrimPart, 'prim' | 'at' | 'glow'> = {},
): PrimPart => ({ prim: { type: 'crystal', height, width }, at, glow, ...rest });

const piece = (
  id: PieceId,
  scale: number,
  at: Vec3 = [0, 0, 0],
  rest: Omit<KitPart, 'piece' | 'scale' | 'at'> = {},
): KitPart => ({
  piece: id,
  scale,
  at,
  ...rest,
});

/** `n` copies of a part around a circle (first one at +z), each turned to face out. */
function ring(
  n: number,
  radius: number,
  y: number,
  make: (at: Vec3, rotY: number, i: number) => Part[],
  offsetDeg = 0,
): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const a = offsetDeg + (360 * i) / n;
    const r = (a * Math.PI) / 180;
    out.push(...make([Math.sin(r) * radius, y, Math.cos(r) * radius], a, i));
  }
  return out;
}

/** A standing brazier: iron pole, brass bowl, flame. */
function brazier(at: Vec3, glow: GlowId, h = 2.4): Part[] {
  const [x, y, z] = at;
  return [
    cyl(h, 0.3, 0.22, 6, [x, y, z], { swatch: 'iron' }),
    cyl(0.5, 0.45, 1.0, 8, [x, y + h, z], { swatch: 'brass' }),
    crystal(1.1, 0.7, [x, y + h + 0.25, z], glow),
  ];
}

/** Hex plinth that hides terrain seams and lifts the silhouette. */
const plinth = (d: number, h: number, swatch: SwatchId = 'stone'): PrimPart =>
  cyl(h, d, d * 0.94, 6, [0, 0, 0], { swatch, rotY: 30 });

/** Hollow iron spike, leaning outward by `lean` degrees. */
function spike(
  at: Vec3,
  rotY: number,
  h: number,
  w: number,
  lean = 0,
  rest: Omit<PrimPart, 'prim' | 'at'> = {},
): PrimPart {
  return cyl(h, w, 0, 4, at, { swatch: 'iron', rotY, rotX: lean, ...rest });
}

/** Thin hanging chain stand-in from `a` to `b` (a stretched 4-sided rod). */
function chain(a: Vec3, b: Vec3): PrimPart {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const horiz = Math.hypot(dx, dz);
  return cyl(len, 0.16, 0.16, 4, a, {
    swatch: 'black',
    rotX: (Math.atan2(horiz, dy) * 180) / Math.PI,
    rotY: (Math.atan2(dx, dz) * 180) / Math.PI,
    detail: true,
  });
}

// ---------------------------------------------------------------------------
// Wardens: pale stone watchtowers, bronze caps, gold braziers and banners
// ---------------------------------------------------------------------------

function wardenTower(tier: 1 | 2 | 3 | 4): Recipe {
  const s = [5.0, 5.2, 5.5, 5.9][tier - 1]!;
  const ph = [0.8, 1.0, 1.3, 1.6][tier - 1]!;
  const pd = [7.5, 8, 9.5, 11][tier - 1]!;
  const parts: Part[] = [plinth(pd, ph)];
  parts.push(piece(tier === 1 ? 'tower_a' : 'tower_b', s, [0, ph, 0]));
  // Braziers flank the front; flags fly from the plinth corners.
  const bx = pd * 0.36;
  parts.push(...brazier([-bx, ph, pd * 0.25], 'gold'), ...brazier([bx, ph, pd * 0.25], 'gold'));
  parts.push(piece('flag', 6, [-bx, ph, -pd * 0.28], { rotY: 90, detail: true }));
  if (tier >= 2) parts.push(piece('flag', 6, [bx, ph, -pd * 0.28], { rotY: 90, detail: true }));
  if (tier >= 3) {
    // Side turrets.
    for (const sx of [-1, 1])
      parts.push(piece('tower_base', 2.2, [sx * pd * 0.42, ph, -pd * 0.05]));
  }
  if (tier === 4) {
    // The Ancient's guards carry a hovering gold keystone shard.
    parts.push(crystal(2.4, 1.4, [0, ph + 2.49 * s + 1.2, 0], 'gold', { float: true }));
  }
  return {
    parts,
    footprint: pd / 2,
    castsShadow: true,
    hover: tier === 4 ? { amplitude: 0.35, period: 3.2, spin: 0.6 } : undefined,
  };
}

function wardenBarracks(ranged: boolean): Recipe {
  const parts: Part[] = [box(9.5, 0.6, 9.5, [0, 0, 0], { swatch: 'stone' })];
  if (ranged) {
    parts.push(piece('archeryrange', 4.6, [0, 0.6, 0]));
    parts.push(
      piece('target', 5, [-3.6, 0.6, 4.2], { detail: true }),
      piece('target', 5, [3.6, 0.6, 4.2], { detail: true }),
    );
  } else {
    parts.push(piece('barracks', 4.8, [0, 0.6, 0]));
    parts.push(
      piece('weaponrack', 6, [-3.6, 0.6, 4.1], { detail: true }),
      piece('weaponrack', 6, [3.6, 0.6, 4.1], { detail: true }),
    );
  }
  parts.push(...brazier([-4.2, 0.6, 2.2], 'gold', 2), ...brazier([4.2, 0.6, 2.2], 'gold', 2));
  parts.push(
    piece('flag', 7, [-4.2, 0.6, -4.2], { rotY: 90, detail: true }),
    piece('flag', 7, [4.2, 0.6, -4.2], { rotY: 90, detail: true }),
  );
  return { parts, footprint: 5, castsShadow: false };
}

/** The Hearthstone: a giant keystone monolith with a glowing hearth slit, on a stepped hex dais. */
function hearthstone(): Recipe {
  const parts: Part[] = [
    plinth(24, 1.2),
    cyl(1.2, 17, 16, 6, [0, 1.2, 0], { swatch: 'stone', rotY: 30 }),
    // Keystone: a square frustum, wider at the top.
    cyl(13, 6.5, 10.5, 4, [0, 2.4, 0], { swatch: 'stone', rotY: 45 }),
    // Bronze cap and band.
    cyl(1.0, 10.8, 10.2, 4, [0, 15.4, 0], { swatch: 'brass', rotY: 45 }),
    cyl(0.8, 8.2, 8.4, 4, [0, 7.0, 0], { swatch: 'brass', rotY: 45 }),
    // Hearth: a glowing slit through the stone and a bright core above the cap.
    box(1.4, 9.5, 8.2, [0, 4.6, 0], { glow: 'gold' }),
    box(8.2, 9.5, 1.4, [0, 4.6, 0], { glow: 'gold' }),
    crystal(4.2, 2.6, [0, 17.6, 0], 'gold', { float: true }),
  ];
  // Watch turrets at the back corners, gold-capped obelisks at the front, braziers between.
  parts.push(
    ...ring(
      4,
      9.6,
      1.2,
      (at, rotY, i) => [
        i === 1 || i === 2
          ? piece('tower_base', 2.6, at, { rotY })
          : cyl(5.5, 2.2, 0.9, 4, at, { swatch: 'stone', rotY: rotY + 45 }),
        ...(i === 1 || i === 2 ? [] : [crystal(1.4, 0.9, [at[0], 6.7, at[2]], 'gold')]),
        ...brazier([at[0] * 0.78, 2.4, at[2] * 0.78], 'gold', 1.6),
      ],
      45,
    ),
  );
  parts.push(
    ...ring(
      2,
      8.6,
      2.4,
      (at, rotY) => [piece('flag', 9, at, { rotY: rotY + 90, detail: true })],
      0,
    ),
  );
  return {
    parts,
    footprint: 12,
    castsShadow: true,
    hover: { amplitude: 0.5, period: 4, spin: 0.35 },
  };
}

function wardenFountain(): Recipe {
  const parts: Part[] = [
    plinth(15, 0.5),
    cyl(1.3, 13, 12.4, 12, [0, 0.5, 0], { swatch: 'stone' }),
    cyl(1.0, 11, 11, 12, [0, 0.9, 0], { glow: 'cyan' }),
    cyl(4.5, 2.0, 1.4, 8, [0, 1.8, 0], { swatch: 'stone' }),
    cyl(0.8, 1.6, 3.4, 8, [0, 6.3, 0], { swatch: 'brass' }),
    crystal(2.6, 1.6, [0, 7.4, 0], 'gold', { float: true }),
  ];
  parts.push(
    ...ring(
      4,
      6.6,
      0.5,
      (at) => [
        cyl(3.6, 1.2, 0.5, 4, at, { swatch: 'stone', rotY: 45 }),
        crystal(1.1, 0.6, [at[0], 4.3, at[2]], 'gold'),
      ],
      45,
    ),
  );
  return {
    parts,
    footprint: 7.5,
    castsShadow: false,
    hover: { amplitude: 0.3, period: 3, spin: 0.8 },
  };
}

function baseShop(owner: 'wardens' | 'hollow'): Recipe {
  const glow: GlowId = owner === 'wardens' ? 'gold' : 'violet';
  const parts: Part[] = [
    box(10, 0.4, 7.5, [0, 0, 0], { swatch: owner === 'wardens' ? 'stone' : 'stoneDark' }),
    piece('market', 4.6, [0, 0.4, 0]),
    piece('tent', 5, [0, 0.4, -4.6]),
    piece('crate', 7, [-4.4, 0.4, 3.0], { detail: true }),
    piece('crate', 6, [-3.4, 0.4, 3.4], { rotY: 25, detail: true }),
    piece('barrel', 7, [4.2, 0.4, 3.2], { detail: true }),
    piece('barrel', 6, [3.3, 0.4, 3.5], { detail: true }),
    ...brazier([4.8, 0.4, -2.4], glow, 2),
  ];
  if (owner === 'hollow')
    parts.push(
      spike([0, 4.4, -0.4], 0, 3.2, 0.9),
      spike([-3, 3.6, -0.4], 0, 2.2, 0.7, -12),
      spike([3, 3.6, -0.4], 0, 2.2, 0.7, 12),
    );
  return { parts, footprint: 5.5, castsShadow: false };
}

// ---------------------------------------------------------------------------
// Hollow: ash stone and black iron spires, chains, floating violet embers
// ---------------------------------------------------------------------------

function hollowSpire(h: number, w: number, at: Vec3): Part[] {
  const [x, y, z] = at;
  return [
    cyl(h, w, w * 0.08, 6, [x, y, z], { swatch: 'iron' }),
    // Collar of spikes partway up.
    ...ring(
      4,
      w * 0.42,
      y + h * 0.18,
      (p, rotY) => [spike([x + p[0], p[1], z + p[2]], rotY, h * 0.28, w * 0.32, 28)],
      45,
    ),
  ];
}

function hollowTower(tier: 1 | 2 | 3 | 4): Recipe {
  const bs = [4.4, 4.6, 4.9, 5.3][tier - 1]!; // tower_base is 1.5 tall
  const ph = [0.8, 1.0, 1.3, 1.6][tier - 1]!;
  const pd = [7.5, 8, 9.5, 11][tier - 1]!;
  const top = ph + 1.5 * bs;
  const spireH = [8, 9, 10, 11][tier - 1]!;
  const parts: Part[] = [plinth(pd, ph, 'stoneDark'), piece('tower_base', bs, [0, ph, 0])];
  parts.push(...hollowSpire(spireH, 3.2, [0, top - 0.2, 0]));
  parts.push(crystal(2.2, 1.2, [0, top + spireH + 0.8, 0], 'violet', { float: true }));
  // Chains from the spire collar down to the plinth corners.
  const chains = tier === 1 ? 2 : 4;
  parts.push(
    ...ring(
      chains,
      pd * 0.42,
      ph,
      (at) => [chain([at[0] * 0.25, top + spireH * 0.25, at[2] * 0.25], at)],
      45,
    ),
  );
  if (tier >= 2) {
    parts.push(
      ...ring(
        3,
        2.6,
        top + spireH * 0.55,
        (at, _r, i) => [
          crystal(0.9, 0.5, [at[0], at[1] + i * 0.7, at[2]], 'violet', { float: true }),
        ],
        20,
      ),
    );
  }
  if (tier >= 3) {
    for (const sx of [-1, 1])
      parts.push(...hollowSpire(spireH * 0.55, 1.8, [sx * pd * 0.36, ph, -pd * 0.1]));
  }
  if (tier === 4) {
    for (const sz of [1]) parts.push(...hollowSpire(spireH * 0.45, 1.6, [0, ph, sz * pd * 0.38]));
    parts.push(crystal(1.6, 0.9, [0, top + spireH + 3.4, 0], 'violet', { float: true }));
  }
  return {
    parts,
    footprint: pd / 2,
    castsShadow: true,
    hover: { amplitude: 0.4, period: 2.6, spin: 0.9 },
  };
}

function hollowBarracks(ranged: boolean): Recipe {
  const parts: Part[] = [box(9.5, 0.6, 9.5, [0, 0, 0], { swatch: 'stoneDark' })];
  if (ranged) {
    parts.push(piece('archeryrange', 4.6, [0, 0.6, 0]));
    parts.push(...hollowSpire(5.5, 1.6, [0, 7.6, -0.6]));
  } else {
    parts.push(piece('barracks', 4.8, [0, 0.6, 0]));
    parts.push(
      spike([-2.2, 7.0, 0], 0, 3.4, 0.9, -15),
      spike([2.2, 7.0, 0], 0, 3.4, 0.9, 15),
      spike([0, 7.6, 0], 0, 4.4, 1.1),
    );
  }
  parts.push(
    ...ring(
      2,
      5.6,
      0.6,
      (at) => [
        spike(at, 0, 4.5, 1.2),
        crystal(1.0, 0.6, [at[0], 5.4, at[2]], 'violet', { float: true }),
      ],
      45,
    ),
  );
  parts.push(...brazier([-4.2, 0.6, 3.2], 'violet', 2), ...brazier([4.2, 0.6, 3.2], 'violet', 2));
  return {
    parts,
    footprint: 5,
    castsShadow: false,
    hover: { amplitude: 0.25, period: 2.4, spin: 1 },
  };
}

/** The Hollow Crown: a broken iron crown hovering over a glowing rift. */
function hollowCrown(): Recipe {
  const parts: Part[] = [
    plinth(24, 0.8, 'stoneDark'),
    cyl(0.4, 17, 17, 10, [0, 0.8, 0], { swatch: 'black' }),
    cyl(0.45, 8.5, 8.5, 10, [0, 0.8, 0], { glow: 'violet' }),
  ];
  // Jagged rocks torn up around the rift.
  parts.push(
    ...ring(
      6,
      9.2,
      0.6,
      (at, rotY, i) => [
        {
          piece: 'mountain_a',
          at,
          rotY: rotY + i * 37,
          scale: [2.2, 2.4 + (i % 3) * 0.8, 2.0],
        } as KitPart,
      ],
      15,
    ),
  );
  // Floating crown: band, spikes (two snapped short and bent), jewels, core.
  const cy = 10.5;
  parts.push({
    prim: { type: 'torus', diameter: 10, thickness: 1.3, sides: 12 },
    at: [0, cy, 0],
    swatch: 'team',
    float: true,
  });
  parts.push({
    prim: { type: 'torus', diameter: 9.2, thickness: 0.6, sides: 12 },
    at: [0, cy - 1, 0],
    swatch: 'brass',
    float: true,
  });
  parts.push(
    ...ring(8, 5, cy, (at, rotY, i) => {
      const broken = i === 2 || i === 5;
      return [spike(at, rotY, broken ? 1.6 : 4.2, 1.3, broken ? 35 : 8, { float: true })];
    }),
  );
  parts.push(
    ...ring(4, 5.1, cy - 0.5, (at) => [crystal(1.2, 0.8, at, 'violet', { float: true })], 22.5),
  );
  parts.push(crystal(5.5, 3.0, [0, cy - 3.6, 0], 'violet', { float: true }));
  // Chains straining from the rocks up toward the crown.
  parts.push(...ring(4, 8.6, 2.5, (at) => [chain(at, [at[0] * 0.55, cy - 1.2, at[2] * 0.55])], 15));
  return {
    parts,
    footprint: 12,
    castsShadow: true,
    hover: { amplitude: 0.6, period: 4.5, spin: 0.25 },
  };
}

function hollowFountain(): Recipe {
  const parts: Part[] = [
    plinth(15, 0.5, 'stoneDark'),
    cyl(1.3, 13, 12.4, 12, [0, 0.5, 0], { swatch: 'stoneDark' }),
    cyl(1.0, 11, 11, 12, [0, 0.9, 0], { glow: 'cyan' }),
    ...hollowSpire(6, 1.8, [0, 1.8, 0]),
    crystal(2.6, 1.6, [0, 9.2, 0], 'violet', { float: true }),
  ];
  parts.push(...ring(6, 6.4, 0.5, (at, rotY) => [spike(at, rotY, 3.4, 1.0, 14)], 30));
  return {
    parts,
    footprint: 7.5,
    castsShadow: false,
    hover: { amplitude: 0.3, period: 3, spin: 0.8 },
  };
}

// ---------------------------------------------------------------------------
// Neutral shops
// ---------------------------------------------------------------------------

function sideShop(): Recipe {
  return {
    parts: [
      box(8, 0.3, 6, [0, 0, 0], { swatch: 'wood' }),
      piece('tent', 6.5, [0, 0.3, -0.6]),
      piece('crate', 7, [-3.2, 0.3, 2.0], { detail: true }),
      piece('crate', 6, [-2.4, 0.3, 2.4], { rotY: 30, detail: true }),
      piece('barrel', 7, [3.0, 0.3, 2.2], { detail: true }),
      ...brazier([3.4, 0.3, -1.8], 'cyan', 2.6),
    ],
    footprint: 4.5,
    castsShadow: false,
  };
}

function secretShop(): Recipe {
  const parts: Part[] = [plinth(9, 0.4, 'stoneDark'), piece('well', 4.6, [0, 0.4, 0])];
  parts.push(
    ...ring(
      3,
      4.4,
      0.4,
      (at, rotY) => [cyl(4.2, 1.3, 0.4, 4, at, { swatch: 'stoneDark', rotY: rotY + 45 })],
      0,
    ),
  );
  parts.push(crystal(2.2, 1.2, [0, 6.2, 0], 'cyan', { float: true }));
  return {
    parts,
    footprint: 4.5,
    castsShadow: false,
    hover: { amplitude: 0.4, period: 3.4, spin: 1.1 },
  };
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

function build(): Map<VariantId, Recipe> {
  const r = new Map<VariantId, Recipe>();
  const w = (k: StructureKind, recipe: Recipe) => r.set(variantKey('wardens', k), recipe);
  const h = (k: StructureKind, recipe: Recipe) => r.set(variantKey('hollow', k), recipe);
  ([1, 2, 3, 4] as const).forEach((t) => {
    w(`tower_t${t}`, wardenTower(t));
    h(`tower_t${t}`, hollowTower(t));
  });
  w('barracks_melee', wardenBarracks(false));
  w('barracks_ranged', wardenBarracks(true));
  h('barracks_melee', hollowBarracks(false));
  h('barracks_ranged', hollowBarracks(true));
  w('ancient', hearthstone());
  h('ancient', hollowCrown());
  w('fountain', wardenFountain());
  h('fountain', hollowFountain());
  w('shop_base', baseShop('wardens'));
  h('shop_base', baseShop('hollow'));
  r.set(variantKey('neutral', 'shop_side'), sideShop());
  r.set(variantKey('neutral', 'shop_secret'), secretShop());
  return r;
}

export const RECIPES: ReadonlyMap<VariantId, Recipe> = build();

/** Every variant with a recipe, faction-grouped in kind order (gallery order). */
export function recipeVariants(): VariantId[] {
  const owners: Owner[] = ['wardens', 'hollow', 'neutral'];
  return owners.flatMap((o) =>
    STRUCTURE_KINDS.map((k) => variantKey(o, k)).filter((v) => RECIPES.has(v)),
  );
}

/** Kit pieces a set of variants needs (load only these). */
export function piecesFor(variants: Iterable<VariantId>): PieceId[] {
  const set = new Set<PieceId>();
  for (const v of variants)
    for (const p of RECIPES.get(v)?.parts ?? []) if (isKitPart(p)) set.add(p.piece);
  return PIECE_IDS.filter((id) => set.has(id));
}

/** Footprint radius per kind for terrain snapping (the larger of the two factions). */
export function footprintRadii(): Partial<Record<StructureKind, number>> {
  const out: Partial<Record<StructureKind, number>> = {};
  for (const [v, r] of RECIPES) {
    const kind = v.split(':')[1] as StructureKind;
    out[kind] = Math.max(out[kind] ?? 0, r.footprint);
  }
  return out;
}
