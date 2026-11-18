import { describe, expect, it } from 'vitest';
import { inTeamMask, MAX_TEAM_RECTS } from '../../render/shaders/teamMask';
import {
  ATLAS_COLS,
  ATLAS_ROWS,
  BEVEL_STRIP,
  BULWARK_PALETTE,
  BULWARK_TEAM_MASK,
  CELL_ROLES,
  TEAM_CELLS,
  buildAtlasPixels,
  cellFor,
  cellOf,
  cellUv,
  gradientFor,
  hexToRgb255,
  type CellId,
} from './palette';

const ALL_CELLS: CellId[] = [];
for (let r = 0; r < ATLAS_ROWS - 1; r++)
  for (let c = 0; c < ATLAS_COLS; c++) ALL_CELLS.push(`${c},${r}`);
ALL_CELLS.push('0,3');

describe('bulwark palette atlas', () => {
  it('assigns a role to every KayKit atlas cell', () => {
    expect(Object.keys(CELL_ROLES).sort()).toEqual([...ALL_CELLS].sort());
  });

  it('uses the art-direction base tones', () => {
    expect(BULWARK_PALETTE.stone).toBe('#CFC6B4');
    expect(BULWARK_PALETTE.bronze).toBe('#B07A3C');
    expect(BULWARK_PALETTE.moss).toBe('#6F9A4E');
    for (const hex of Object.values(BULWARK_PALETTE)) expect(() => hexToRgb255(hex)).not.toThrow();
  });

  it('puts part UVs inside their cell and left of the bevel strip', () => {
    for (const cell of ALL_CELLS) {
      for (const t of [0, 0.5, 1]) {
        const [u, v] = cellUv(cell, t);
        expect(cellOf(u, v)).toBe(cell);
        if (cell !== '0,3') expect((u * ATLAS_COLS) % 1).toBeLessThan(BEVEL_STRIP.x0);
      }
    }
  });

  it('paints each cell with its gradient (top light, bottom dark)', () => {
    const size = 256;
    const px = buildAtlasPixels(size);
    expect(px.length).toBe(size * size * 4);
    const at = (u: number, v: number) => {
      const o = (Math.floor(v * size) * size + Math.floor(u * size)) * 4;
      return [px[o]!, px[o + 1]!, px[o + 2]!];
    };
    for (const cell of ALL_CELLS) {
      const g = gradientFor(cell);
      const [u, vTop] = cellUv(cell, 0.02);
      const [, vBot] = cellUv(cell, 0.98);
      const top = at(u, vTop);
      const bot = at(u, vBot);
      const want = hexToRgb255(g.top);
      for (let i = 0; i < 3; i++) expect(Math.abs(top[i]! - want[i]!)).toBeLessThanOrEqual(8);
      const lum = (c: number[]) => c[0]! * 0.299 + c[1]! * 0.587 + c[2]! * 0.114;
      expect(lum(top)).toBeGreaterThan(lum(bot));
    }
  });

  it('team mask = team cells: cape/tabard, straps and the shield banner', () => {
    expect([...TEAM_CELLS].sort()).toEqual(
      [cellFor('team'), cellFor('straps'), cellFor('teamShield')].sort(),
    );
    expect(BULWARK_TEAM_MASK.length).toBeLessThanOrEqual(MAX_TEAM_RECTS);
    for (const cell of ALL_CELLS) {
      const [u, v] = cellUv(cell, 0.5);
      expect(inTeamMask(u, v, BULWARK_TEAM_MASK)).toBe(TEAM_CELLS.includes(cell));
    }
    const mask = buildAtlasPixels(64, true);
    const white = (u: number, v: number) =>
      mask[(Math.floor(v * 64) * 64 + Math.floor(u * 64)) * 4] === 255;
    for (const cell of ALL_CELLS) {
      const [u, v] = cellUv(cell, 0.5);
      expect(white(u, v)).toBe(TEAM_CELLS.includes(cell));
    }
  });

  it('rejects atlas sizes that do not tile the grid', () => {
    expect(() => buildAtlasPixels(100)).toThrow();
  });
});
