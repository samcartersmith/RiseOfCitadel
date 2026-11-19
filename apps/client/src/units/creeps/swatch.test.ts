import { describe, expect, it } from 'vitest';
import { ATLAS_CELLS, cellOf, hexToRgb, moveToCell, recolorPart, ruleFor } from './swatch';

/** Centre UV of a swatch. */
const centre = (cell: number): [number, number] => [
  ((cell % 8) + 0.5) / 8,
  (Math.floor(cell / 8) + 0.5) / 4,
];

describe('cellOf', () => {
  it('maps swatch centres to their index', () => {
    for (let c = 0; c < ATLAS_CELLS; c++) expect(cellOf(...centre(c))).toBe(c);
  });
  it('clamps UVs on or past the edges', () => {
    expect(cellOf(1, 1)).toBe(31);
    expect(cellOf(-0.1, -0.1)).toBe(0);
    expect(cellOf(1.2, 0)).toBe(7);
  });
});

describe('moveToCell', () => {
  it('keeps the offset inside the swatch', () => {
    // 30% across, 60% down swatch 3.
    const u = (3 + 0.3) / 8;
    const v = 0.6 / 4;
    const [nu, nv] = moveToCell(u, v, 17);
    expect(cellOf(nu, nv)).toBe(17);
    expect(nu * 8 - 1).toBeCloseTo(0.3);
    expect(nv * 4 - 2).toBeCloseTo(0.6);
  });
  it('keeps a margin from the swatch border', () => {
    const [nu, nv] = moveToCell(0, 0, 9);
    expect(nu * 8 - 1).toBeCloseTo(0.02);
    expect(nv * 4 - 1).toBeCloseTo(0.02);
    const [eu, ev] = moveToCell(1 / 8 - 1e-9, 1 / 4 - 1e-9, 9);
    expect(cellOf(eu, ev)).toBe(9);
    expect(eu * 8 - 1).toBeCloseTo(0.98);
  });
});

describe('hexToRgb', () => {
  it('parses with or without #', () => {
    expect(hexToRgb('#FF8000')).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb('000000')).toEqual([0, 0, 0]);
  });
  it('rejects bad input', () => {
    expect(() => hexToRgb('#abc')).toThrow();
  });
});

describe('ruleFor / recolorPart', () => {
  const rules = [
    { from: 8, to: 16, tint: '#E8B54A', parts: ['Shield'] },
    { from: [8, 9], tint: '#808080' },
    { from: 3, to: 4 },
  ];

  it('picks the first matching rule, honouring part filters', () => {
    expect(ruleFor(rules, 8, 'Rectangle_Shield')).toBe(rules[0]);
    expect(ruleFor(rules, 8, 'Knight_Body')).toBe(rules[1]);
    expect(ruleFor(rules, 9, 'Rectangle_Shield')).toBe(rules[1]);
    expect(ruleFor(rules, 5, 'Knight_Body')).toBeUndefined();
  });

  it('rewrites UVs and fills colours in place', () => {
    const uvs = new Float32Array([...centre(8), ...centre(3), ...centre(5)]);
    const colors = new Float32Array(12).fill(-1);
    const changed = recolorPart(uvs, colors, 'Rectangle_Shield', rules);
    expect(changed).toBe(2);
    expect(cellOf(uvs[0]!, uvs[1]!)).toBe(16);
    expect(cellOf(uvs[2]!, uvs[3]!)).toBe(4);
    expect(cellOf(uvs[4]!, uvs[5]!)).toBe(5);
    const gold = hexToRgb('#E8B54A');
    expect(Array.from(colors.slice(0, 4))).toEqual([...gold.map(Math.fround), 1]);
    // No tint → white; untouched vertex → white.
    expect(Array.from(colors.slice(4))).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });
});
