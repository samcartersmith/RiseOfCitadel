/**
 * Layout of the procedural VFX atlas: one 512² texture, a 4×4 grid of 128 px
 * cells. Pure TypeScript (the drawing lives in atlasDraw.ts) so the cell maths
 * is unit-tested.
 */
export const ATLAS_GRID = 4;
export const ATLAS_CELL = 128;
export const ATLAS_SIZE = ATLAS_GRID * ATLAS_CELL;
/** Empty border inside each cell, so mipmaps don't bleed into neighbours. */
export const CELL_PAD = 8;

/** Particle sprites (billboards). */
export const PARTICLE_CELLS = {
  dot: 0,
  spark: 1,
  ring: 2,
  smoke: 3,
  streak: 4,
  feather: 5,
  shard: 6,
} as const;
export type ParticleCell = keyof typeof PARTICLE_CELLS;

/** Ground decals (flat quads). Each telegraph shape has a fill and an edge cell. */
export const DECAL_CELLS = {
  circleFill: 7,
  circleEdge: 8,
  ringFill: 9,
  ringEdge: 10,
  coneFill: 11,
  coneEdge: 12,
  lineFill: 13,
  lineEdge: 14,
  crack: 15,
} as const;
export type DecalCell = keyof typeof DECAL_CELLS;

/** Inner radius of the ring decal as a fraction of its outer radius. */
export const RING_INNER = 0.7;
/** Half-angle of the wedge drawn in the cone cells; other angles stretch it in X. */
export const CONE_DRAWN_HALF_ANGLE = Math.PI / 6;

export interface CellRect {
  /** Texture-space rectangle (v = 1 is the top row of the canvas). */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** UV rectangle of a cell, inset by `insetPx` texels to avoid sampling neighbours. */
export function cellUv(index: number, insetPx = 0.5): CellRect {
  if (!Number.isInteger(index) || index < 0 || index >= ATLAS_GRID * ATLAS_GRID) {
    throw new Error(`Atlas cell ${index} out of range`);
  }
  const col = index % ATLAS_GRID;
  const row = Math.floor(index / ATLAS_GRID);
  const inset = insetPx / ATLAS_SIZE;
  return {
    u0: col / ATLAS_GRID + inset,
    u1: (col + 1) / ATLAS_GRID - inset,
    // Canvas row 0 is the top of the image, which lands at v = 1.
    v0: 1 - (row + 1) / ATLAS_GRID + inset,
    v1: 1 - row / ATLAS_GRID - inset,
  };
}

/**
 * Cell id as Babylon's particle sprite sheets count it. The sheet indexes rows
 * from the bottom of the uploaded (Y-flipped) texture, so canvas row 0 is the
 * sheet's last row. Content inside a cell is mirrored vertically too, which is
 * why particle sprites are drawn vertically symmetric (or don't care).
 */
export function spriteSheetCell(index: number): number {
  const col = index % ATLAS_GRID;
  const row = Math.floor(index / ATLAS_GRID);
  return (ATLAS_GRID - 1 - row) * ATLAS_GRID + col;
}

/** Top-left pixel of a cell on the atlas canvas. */
export function cellOrigin(index: number): { x: number; y: number } {
  return {
    x: (index % ATLAS_GRID) * ATLAS_CELL,
    y: Math.floor(index / ATLAS_GRID) * ATLAS_CELL,
  };
}

export type DecalShape = 'circle' | 'ring' | 'cone' | 'line' | 'crack';

/**
 * Local-space extents of the quad for each decal shape, chosen so that a
 * mesh scale of 1 means "radius 1" (circle, ring, crack), "length 1 with the
 * apex at the origin" (cone) or "length 1, width 1, starting at the origin"
 * (line). The quad covers the whole cell, padding included, so the drawn shape
 * lands exactly on those unit dimensions.
 */
export function decalQuadExtents(shape: DecalShape): {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
} {
  const S = ATLAS_CELL;
  const P = CELL_PAD;
  switch (shape) {
    case 'circle':
    case 'ring':
    case 'crack': {
      const R = S / 2 - P; // drawn radius in px
      const h = S / 2 / R;
      return { x0: -h, x1: h, z0: -h, z1: h };
    }
    case 'cone': {
      const R = S - 2 * P; // apex at the bottom pad, arc touching the top pad
      const h = S / 2 / R;
      return { x0: -h, x1: h, z0: -P / R, z1: (S - P) / R };
    }
    case 'line': {
      const W = S - 2 * P;
      const L = S - 2 * P;
      return { x0: -(S / 2) / W, x1: S / 2 / W, z0: -P / L, z1: (S - P) / L };
    }
  }
}

/**
 * X scale for a cone decal so its edges sit at `halfAngle` while its length
 * stays `length` (the arc end becomes slightly elliptical for angles far from 30°).
 */
export function coneScaleX(length: number, halfAngle: number): number {
  const clamped = Math.min(Math.max(halfAngle, 0.05), (75 * Math.PI) / 180);
  return (length * Math.tan(clamped)) / Math.tan(CONE_DRAWN_HALF_ANGLE);
}
