/**
 * Bulwark's restyle: a generated palette atlas that replaces the KayKit
 * Knight texture (docs/design/heroes/bulwark.md §3).
 *
 * The KayKit Adventurers textures are a grid of flat vertical gradients:
 * 8 columns × 4 rows of cells (the bottom row is one full-width gradient),
 * each with a thin "bevel" strip near its right edge. Every body vertex
 * samples one cell, so recolouring a character is a matter of repainting
 * cells. We keep the Knight's UVs and generate a new atlas with the same
 * layout from the art-direction palette (art-direction.md §2.1, Bulwark
 * brief): steel becomes warm stone, trim becomes bronze, the red cloth becomes
 * undyed team cloth (the toon material dyes it per team). Unused cells hold the colours of the kit-bash parts (gate
 * wood, moss, iron, ember), so body and parts share ONE texture and ONE
 * material, which is what lets the merged hero draw in a single call.
 *
 * Pure data + a pixel generator (no Babylon), unit-tested in palette.test.ts.
 */

import { atlasCell, type UvRect } from '../../render/shaders/teamMask';

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;

/** `"col,row"`; row 3 is a single full-width gradient, addressed as `"0,3"`. */
export type CellId = `${number},${number}`;

/** Normalised UV (glTF convention: v = 0 at the top of the image) inside a cell. */
export function cellUv(cell: CellId, t: number): [number, number] {
  const [col, row] = parseCell(cell);
  const v = (row + clamp01(t) * 0.999) / ATLAS_ROWS;
  // Stay left of the bevel strip so parts get the clean gradient.
  const u = row >= ATLAS_ROWS - 1 ? 0.5 : (col + 0.4) / ATLAS_COLS;
  return [u, v];
}

export function parseCell(cell: CellId): [number, number] {
  const [c, r] = cell.split(',').map(Number) as [number, number];
  return [c, r];
}

/** Cell of a UV, or null outside the atlas. Row 3 always reports column 0. */
export function cellOf(u: number, v: number): CellId | null {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  const row = Math.min(ATLAS_ROWS - 1, Math.floor(v * ATLAS_ROWS));
  const col = row >= ATLAS_ROWS - 1 ? 0 : Math.min(ATLAS_COLS - 1, Math.floor(u * ATLAS_COLS));
  return `${col},${row}`;
}

/** Bulwark palette (hex). Base tones come from art-direction.md §2.1 and the H01 brief. */
export const BULWARK_PALETTE = {
  stone: '#CFC6B4',
  bronze: '#B07A3C',
  moss: '#6F9A4E',
  iron: '#2E2B33',
  wood: '#9A7552',
  leather: '#6B4E36',
  cream: '#EFE6D2',
  ember: '#FFB347',
} as const;

/**
 * Team cloth is painted as an undyed light gradient; the toon material tints
 * texels inside the team mask toward the team colour (× 0.6 + 0.7·luma), so a
 * light, value-rich swatch keeps the cloth's shading in both team colours, and
 * neutrals simply show undyed cloth.
 */
export const TEAM_CLOTH_UNDYED: Gradient = { top: '#F2EDE2', bottom: '#8F887C' };

/** A vertical gradient: `top` at the top of the cell, `bottom` at the bottom. */
export interface Gradient {
  top: string;
  bottom: string;
}

/** What each cell is used for. `team` cells take the team colour (the team-colour mask). */
export type CellRole =
  | 'skin'
  | 'skinShade'
  | 'eyes'
  | 'plate'
  | 'plateDark'
  | 'trim'
  | 'trimBright'
  | 'straps'
  | 'undersuit'
  | 'mail'
  | 'cream'
  | 'team'
  | 'teamShield'
  | 'wood'
  | 'gateStone'
  | 'rubble'
  | 'moss'
  | 'chain'
  | 'ember'
  | 'grip'
  | 'spare';

/**
 * Knight cell → role. Body cells were found by sampling the Knight's UVs
 * (see the doc): 3,0 main plates; 7,0 plate trim; 4,0 gauntlets; 6,0 straps;
 * 7,1 undersuit/boots; 2,1 mail; 1,1 white tabard trim; 0,1 red cape + tabard;
 * 0,0/1,0/2,0 face. Cells the Knight doesn't use (with its sword and shields
 * hidden) carry the kit-bash part colours.
 */
export const CELL_ROLES: Readonly<Record<CellId, CellRole>> = {
  '0,0': 'skin',
  '1,0': 'skinShade',
  '2,0': 'eyes',
  '3,0': 'plate',
  '4,0': 'plateDark',
  '5,0': 'wood',
  '6,0': 'straps',
  '7,0': 'trim',
  '0,1': 'team',
  '1,1': 'cream',
  '2,1': 'mail',
  '3,1': 'gateStone',
  '4,1': 'trimBright',
  '5,1': 'grip',
  '6,1': 'chain',
  '7,1': 'undersuit',
  '0,2': 'moss',
  '1,2': 'rubble',
  '2,2': 'ember',
  '3,2': 'teamShield',
  '4,2': 'spare',
  '5,2': 'spare',
  '6,2': 'spare',
  '7,2': 'spare',
  '0,3': 'spare',
};

/** The cell to use for each part role (the inverse of CELL_ROLES for unique roles). */
export function cellFor(role: CellRole): CellId {
  const hit = (Object.keys(CELL_ROLES) as CellId[]).find((c) => CELL_ROLES[c] === role);
  if (!hit) throw new Error(`no atlas cell has role ${role}`);
  return hit;
}

const shade = (hex: string, k: number) => {
  const [r, g, b] = hexToRgb255(hex);
  const f = (x: number) =>
    Math.round(Math.max(0, Math.min(255, k >= 1 ? x + (255 - x) * (k - 1) : x * k)));
  return rgb255ToHex([f(r), f(g), f(b)]);
};

/** Gradient per role. Team cells hold undyed cloth; the toon material dyes them. */
const ROLE_GRADIENTS: Readonly<Record<CellRole, Gradient>> = {
  team: TEAM_CLOTH_UNDYED,
  teamShield: TEAM_CLOTH_UNDYED,
  // Keep the KayKit face tones: the face is tiny on screen and the helmet covers most of it.
  skin: { top: '#F9CDA8', bottom: '#EBA37C' },
  skinShade: { top: '#E7C696', bottom: '#C68B52' },
  eyes: { top: '#2A2A30', bottom: '#050506' },
  plate: { top: shade(BULWARK_PALETTE.stone, 1.18), bottom: shade(BULWARK_PALETTE.stone, 0.72) },
  plateDark: { top: shade(BULWARK_PALETTE.stone, 0.82), bottom: shade(BULWARK_PALETTE.stone, 0.5) },
  trim: { top: shade(BULWARK_PALETTE.bronze, 1.25), bottom: shade(BULWARK_PALETTE.bronze, 0.7) },
  trimBright: { top: '#F0C877', bottom: shade(BULWARK_PALETTE.bronze, 0.85) },
  // Dyed leather straps/belt (team, like the knight's M1-02 mask): a darker undyed gradient.
  straps: { top: '#D9D1C2', bottom: '#6F685E' },
  undersuit: { top: '#5A4E44', bottom: '#2C2520' },
  mail: { top: '#9C978E', bottom: '#5A5650' },
  cream: { top: BULWARK_PALETTE.cream, bottom: '#B8AC92' },
  wood: { top: shade(BULWARK_PALETTE.wood, 1.2), bottom: shade(BULWARK_PALETTE.wood, 0.6) },
  gateStone: {
    top: shade(BULWARK_PALETTE.stone, 1.05),
    bottom: shade(BULWARK_PALETTE.stone, 0.62),
  },
  rubble: { top: '#B8AE9A', bottom: '#77705F' },
  moss: { top: shade(BULWARK_PALETTE.moss, 1.3), bottom: shade(BULWARK_PALETTE.moss, 0.7) },
  chain: { top: '#77727C', bottom: BULWARK_PALETTE.iron },
  ember: { top: '#FFE7A0', bottom: '#F07A2A' },
  grip: { top: '#7A5236', bottom: '#3E2A1C' },
  spare: { top: '#BBBBBB', bottom: '#444444' },
};

export function gradientFor(cell: CellId): Gradient {
  return ROLE_GRADIENTS[CELL_ROLES[cell] ?? 'spare'];
}

const isTeamRole = (r: CellRole | undefined) =>
  r === 'team' || r === 'teamShield' || r === 'straps';

/**
 * Cells that carry team colour: the knight's cape/tabard cell, its belt and
 * strap cell (as in the knight's own M1-02 mask) and the gate shield's banner
 * cell. Their UV rectangles are Bulwark's toon team mask.
 */
export const TEAM_CELLS: readonly CellId[] = (Object.keys(CELL_ROLES) as CellId[]).filter((c) =>
  isTeamRole(CELL_ROLES[c]),
);

/**
 * Bulwark's toon team mask: the UV rectangles of TEAM_CELLS, in the same
 * convention as render/shaders/teamMask.ts (the shader takes up to 4).
 */
export const BULWARK_TEAM_MASK: readonly UvRect[] = TEAM_CELLS.map((c) =>
  atlasCell(...parseCell(c)),
);

/** The KayKit bevel strip inside each cell, as fractions of the cell (x0, x1, y0, y1). */
export const BEVEL_STRIP = { x0: 108 / 128, x1: 124 / 128, y0: 20 / 256, y1: 236 / 256 } as const;
/** How much darker the bevel strip is than the gradient beside it. */
export const BEVEL_SHADE = 0.86;

/**
 * Generate the atlas pixels (RGBA, row 0 = top of the image = glTF v 0).
 * `size` must be a multiple of 8 (cell = size/8 × size/4).
 * `mask` renders the team-colour mask instead (white on team cells, black
 * elsewhere): a debug/coverage view of the same rectangles the toon uses.
 */
export function buildAtlasPixels(size: number, mask = false): Uint8Array {
  if (size % ATLAS_COLS !== 0 || size < ATLAS_COLS)
    throw new Error(`atlas size must be a positive multiple of ${ATLAS_COLS}`);
  const px = new Uint8Array(size * size * 4);
  const cw = size / ATLAS_COLS;
  const ch = size / ATLAS_ROWS;
  const grads = new Map<CellId, [number[], number[]]>();
  for (let y = 0; y < size; y++) {
    const row = Math.min(ATLAS_ROWS - 1, Math.floor(y / ch));
    const fy = (y - row * ch + 0.5) / ch;
    for (let x = 0; x < size; x++) {
      const col = row >= ATLAS_ROWS - 1 ? 0 : Math.floor(x / cw);
      const cell: CellId = `${col},${row}`;
      const o = (y * size + x) * 4;
      if (mask) {
        const on = isTeamRole(CELL_ROLES[cell]) ? 255 : 0;
        px[o] = px[o + 1] = px[o + 2] = on;
        px[o + 3] = 255;
        continue;
      }
      let g = grads.get(cell);
      if (!g) {
        const gr = gradientFor(cell);
        g = [hexToRgb255(gr.top), hexToRgb255(gr.bottom)];
        grads.set(cell, g);
      }
      const fx = (x - col * cw + 0.5) / cw;
      const inStrip =
        row < ATLAS_ROWS - 1 &&
        fx >= BEVEL_STRIP.x0 &&
        fx < BEVEL_STRIP.x1 &&
        fy >= BEVEL_STRIP.y0 &&
        fy < BEVEL_STRIP.y1;
      const k = inStrip ? BEVEL_SHADE : 1;
      for (let i = 0; i < 3; i++) {
        px[o + i] = Math.round((g[0]![i]! + (g[1]![i]! - g[0]![i]!) * fy) * k);
      }
      px[o + 3] = 255;
    }
  }
  return px;
}

// ---- colour helpers ----------------------------------------------------------------

export function hexToRgb255(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`bad hex colour ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgb255ToHex([r, g, b]: readonly number[]): string {
  return `#${[r, g, b].map((x) => x!.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
