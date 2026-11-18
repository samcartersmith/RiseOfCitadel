/**
 * Team-colour masks as rectangles in a model's texture atlas.
 *
 * KayKit models share one 1024² palette atlas per model: an 8 × 4 grid of
 * vertical gradient swatches (128 × 256 px). Every face samples a single
 * swatch, so "which parts are team coloured" is the same question as "which
 * swatches are team coloured". A mask is a short list of UV rectangles; texels
 * inside any of them blend toward the team colour. See
 * docs/design/toon-shader.md ("Team-colour mask") for why this beats mesh-name
 * masks.
 *
 * UVs are in glTF convention (u right, v down from the top of the image), which
 * Babylon keeps as-is for glTF meshes. Pure data: no Babylon imports.
 */
import type { ModelId } from '../../units/modelConfig';

/** [u0, v0, u1, v1], inclusive, in 0..1 atlas UV space. */
export type UvRect = readonly [u0: number, v0: number, u1: number, v1: number];

export interface AtlasGrid {
  cols: number;
  rows: number;
}

/** Layout of the KayKit Adventurers / Skeletons palette atlases. */
export const KAYKIT_ATLAS: Readonly<AtlasGrid> = { cols: 8, rows: 4 };

/** The shader takes a fixed number of rectangles (one vec4 uniform each). */
export const MAX_TEAM_RECTS = 4;

/** UV rectangle of one swatch (column/row from the top-left of the image). */
export function atlasCell(col: number, row: number, grid: AtlasGrid = KAYKIT_ATLAS): UvRect {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) {
    throw new RangeError(`atlas cell (${col}, ${row}) outside ${grid.cols}×${grid.rows}`);
  }
  return [col / grid.cols, row / grid.rows, (col + 1) / grid.cols, (row + 1) / grid.rows];
}

/**
 * Team-coloured swatches per base model, picked by reading which swatch each
 * mesh samples (see the doc for the table). Aim: ≥ 20% of a hero's visible
 * surface (art direction §2.2), an accent only on creeps.
 */
export const TEAM_MASKS: Readonly<Record<ModelId, readonly UvRect[]>> = {
  // Red cape swatch, the leather belt/strap swatch, and the steel swatch used by
  // the helmet crest, tabard strip and boots (the crest reads from above).
  knight: [atlasCell(0, 1), atlasCell(6, 0), atlasCell(7, 0)],
  // Green swatch: hood, cape and the scarf/sash on Rogue_Body.
  rogue_hooded: [atlasCell(1, 1)],
  // Magenta cape swatch + the purple hat swatch (the robe swatch stays purple).
  mage: [atlasCell(2, 1), atlasCell(1, 1)],
  // Creep accent: the cloak swatch only.
  skeleton_minion: [atlasCell(5, 0)],
};

export function teamMaskFor(id: ModelId): readonly UvRect[] {
  return TEAM_MASKS[id];
}

/** Lower-case mesh-name prefix of each model's parts in its GLB (e.g. `Rogue_Body`). */
const PART_PREFIX: Readonly<Record<ModelId, string>> = {
  knight: 'knight_',
  rogue_hooded: 'rogue_',
  mage: 'mage_',
  skeleton_minion: 'skeleton_minion_',
};

/**
 * Which base model a set of meshes came from, from their names: GLB part
 * names (`Knight_Body`) or UnitView's merged meshes (`knight-merged-0`).
 * The UnitLook seam only hands us meshes, so this is how it finds the mask.
 */
export function modelIdForMeshNames(names: readonly string[]): ModelId | null {
  const ids = Object.keys(PART_PREFIX) as ModelId[];
  for (const raw of names) {
    const n = raw.toLowerCase();
    for (const id of ids) {
      if (n.startsWith(`${id}-merged`) || n.startsWith(PART_PREFIX[id])) return id;
    }
  }
  return null;
}

/** A rectangle no UV can fall inside; pads the unused shader slots. */
export const EMPTY_RECT: UvRect = [-1, -1, -1, -1];

/** Pads/validates a mask to exactly MAX_TEAM_RECTS rectangles for the shader. */
export function packTeamRects(rects: readonly UvRect[]): UvRect[] {
  if (rects.length > MAX_TEAM_RECTS) {
    throw new RangeError(
      `team mask has ${rects.length} rects; the shader supports ${MAX_TEAM_RECTS}`,
    );
  }
  const out = [...rects];
  while (out.length < MAX_TEAM_RECTS) out.push(EMPTY_RECT);
  return out;
}

/** CPU mirror of the shader's mask test (inclusive edges). */
export function inTeamMask(u: number, v: number, rects: readonly UvRect[]): boolean {
  return rects.some(([u0, v0, u1, v1]) => u >= u0 && u <= u1 && v >= v0 && v <= v1);
}

/** Stable cache key for a mask (materials are shared per texture + team + mask). */
export function teamMaskKey(rects: readonly UvRect[]): string {
  return rects.map((r) => r.map((x) => x.toFixed(4)).join(',')).join(';');
}
