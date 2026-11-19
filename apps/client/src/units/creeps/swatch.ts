/**
 * Palette-atlas recolouring (docs/design/creeps.md §3).
 *
 * Every KayKit pack we use textures its models from one 1024² atlas laid out
 * as an 8 × 4 grid of colour swatches (each a vertical gradient). A vertex's
 * colour is decided by which swatch its UV sits in, so we can recolour a model
 * per creep type without new textures:
 *
 * - move the UV into another swatch of the same atlas (keeping its offset
 *   inside the swatch, so the gradient still shades the same way), and/or
 * - multiply by a per-vertex colour (`tint`). Tinting a near-white swatch gives
 *   an exact colour such as the faction gold `#E8B54A`.
 *
 * Pure (no Babylon), unit-tested in swatch.test.ts.
 */

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;
export const ATLAS_CELLS = ATLAS_COLS * ATLAS_ROWS;

export type Rgb3 = readonly [number, number, number];

/** One recolour rule. The first rule that matches a vertex wins. */
export interface RecolorRule {
  /** Source swatch index (row * 8 + col), or several. */
  from: number | readonly number[];
  /** Move matching vertices into this swatch. Omit to keep the swatch. */
  to?: number;
  /** Multiply by this colour (`#RRGGBB`). Omit for white (no change). */
  tint?: string;
  /** Only apply to parts whose mesh name contains one of these strings. */
  parts?: readonly string[];
}

/** The swatch a UV falls in. UVs on the far edge clamp into the last swatch. */
export function cellOf(u: number, v: number): number {
  const col = Math.min(ATLAS_COLS - 1, Math.max(0, Math.floor(u * ATLAS_COLS)));
  const row = Math.min(ATLAS_ROWS - 1, Math.max(0, Math.floor(v * ATLAS_ROWS)));
  return row * ATLAS_COLS + col;
}

/** Move a UV into `cell`, keeping its relative position inside its current swatch. */
export function moveToCell(u: number, v: number, cell: number): [number, number] {
  const from = cellOf(u, v);
  const fu = u * ATLAS_COLS - (from % ATLAS_COLS);
  const fv = v * ATLAS_ROWS - Math.floor(from / ATLAS_COLS);
  // Keep a hair inside the swatch so bilinear filtering never bleeds into a neighbour.
  const clamp = (x: number) => Math.min(0.98, Math.max(0.02, x));
  return [
    ((cell % ATLAS_COLS) + clamp(fu)) / ATLAS_COLS,
    (Math.floor(cell / ATLAS_COLS) + clamp(fv)) / ATLAS_ROWS,
  ];
}

export function hexToRgb(hex: string): Rgb3 {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`bad colour "${hex}"`);
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function matches(rule: RecolorRule, cell: number, part: string): boolean {
  const from = typeof rule.from === 'number' ? rule.from === cell : rule.from.includes(cell);
  if (!from) return false;
  return !rule.parts || rule.parts.some((p) => part.includes(p));
}

/** The rule that applies to a vertex, or undefined. */
export function ruleFor(
  rules: readonly RecolorRule[],
  cell: number,
  part: string,
): RecolorRule | undefined {
  return rules.find((r) => matches(r, cell, part));
}

/**
 * Recolour one part's vertices in place: rewrites `uvs` and fills `colors`
 * (RGBA, white where no rule applies). Returns how many vertices changed.
 */
export function recolorPart(
  uvs: Float32Array | number[],
  colors: Float32Array | number[],
  part: string,
  rules: readonly RecolorRule[],
): number {
  const n = uvs.length / 2;
  let changed = 0;
  const tints = new Map<string, Rgb3>();
  for (let i = 0; i < n; i++) {
    const u = uvs[i * 2]!;
    const v = uvs[i * 2 + 1]!;
    const rule = ruleFor(rules, cellOf(u, v), part);
    let rgb: Rgb3 = [1, 1, 1];
    if (rule) {
      changed++;
      if (rule.to !== undefined) {
        const [nu, nv] = moveToCell(u, v, rule.to);
        uvs[i * 2] = nu;
        uvs[i * 2 + 1] = nv;
      }
      if (rule.tint) {
        let t = tints.get(rule.tint);
        if (!t) tints.set(rule.tint, (t = hexToRgb(rule.tint)));
        rgb = t;
      }
    }
    colors[i * 4] = rgb[0];
    colors[i * 4 + 1] = rgb[1];
    colors[i * 4 + 2] = rgb[2];
    colors[i * 4 + 3] = 1;
  }
  return changed;
}
