import { describe, expect, it } from 'vitest';
import { MODEL_IDS } from '../../units/modelConfig';
import {
  atlasCell,
  EMPTY_RECT,
  inTeamMask,
  modelIdForMeshNames,
  MAX_TEAM_RECTS,
  packTeamRects,
  TEAM_MASKS,
  teamMaskKey,
} from './teamMask';

describe('atlasCell', () => {
  it('maps KayKit swatches to UV rectangles (v down from the image top)', () => {
    expect(atlasCell(0, 0)).toEqual([0, 0, 0.125, 0.25]);
    expect(atlasCell(7, 3)).toEqual([0.875, 0.75, 1, 1]);
    expect(atlasCell(1, 2, { cols: 4, rows: 4 })).toEqual([0.25, 0.5, 0.5, 0.75]);
  });
  it('rejects cells outside the grid', () => {
    expect(() => atlasCell(8, 0)).toThrow(RangeError);
    expect(() => atlasCell(0, -1)).toThrow(RangeError);
  });
});

describe('TEAM_MASKS', () => {
  it('has a mask for every base model that fits the shader', () => {
    for (const id of MODEL_IDS) {
      expect(TEAM_MASKS[id].length).toBeGreaterThan(0);
      expect(TEAM_MASKS[id].length).toBeLessThanOrEqual(MAX_TEAM_RECTS);
    }
  });

  // UV centres of the cape islands, read from the committed GLBs (see the doc's table).
  it('covers each cape / cloak', () => {
    expect(inTeamMask(0.056, 0.375, TEAM_MASKS.knight)).toBe(true); // Knight_Cape
    expect(inTeamMask(0.181, 0.375, TEAM_MASKS.rogue_hooded)).toBe(true); // Rogue_Cape
    expect(inTeamMask(0.302, 0.371, TEAM_MASKS.mage)).toBe(true); // Mage_Cape
    expect(inTeamMask(0.685, 0.147, TEAM_MASKS.skeleton_minion)).toBe(true); // cloak
  });

  it('leaves skin and the main armour/robe swatches alone', () => {
    expect(inTeamMask(0.06, 0.1, TEAM_MASKS.knight)).toBe(false); // skin (0,0)
    expect(inTeamMask(0.44, 0.1, TEAM_MASKS.knight)).toBe(false); // armour (3,0)
    expect(inTeamMask(0.06, 0.375, TEAM_MASKS.mage)).toBe(false); // robe (0,1)
    expect(inTeamMask(0.19, 0.375, TEAM_MASKS.skeleton_minion)).toBe(false); // bones (1,1)
  });
});

describe('packTeamRects', () => {
  it('pads to MAX_TEAM_RECTS with rects nothing can fall inside', () => {
    const packed = packTeamRects([atlasCell(0, 1)]);
    expect(packed).toHaveLength(MAX_TEAM_RECTS);
    expect(packed.slice(1)).toEqual([EMPTY_RECT, EMPTY_RECT, EMPTY_RECT]);
    expect(inTeamMask(0, 0, [EMPTY_RECT])).toBe(false);
    expect(inTeamMask(1, 1, [EMPTY_RECT])).toBe(false);
  });
  it('rejects masks the shader cannot hold', () => {
    const five = [0, 1, 2, 3, 4].map((c) => atlasCell(c, 0));
    expect(() => packTeamRects(five)).toThrow(RangeError);
  });
});

describe('teamMaskKey', () => {
  it('is stable and distinguishes masks', () => {
    expect(teamMaskKey(TEAM_MASKS.knight)).toBe(teamMaskKey([...TEAM_MASKS.knight]));
    expect(teamMaskKey(TEAM_MASKS.knight)).not.toBe(teamMaskKey(TEAM_MASKS.mage));
    expect(teamMaskKey([])).toBe('');
  });
});

describe('modelIdForMeshNames', () => {
  it('recognises GLB part names and merged UnitView meshes', () => {
    expect(modelIdForMeshNames(['__root__', 'Knight_Body'])).toBe('knight');
    expect(modelIdForMeshNames(['Rogue_Head_Hooded'])).toBe('rogue_hooded');
    expect(modelIdForMeshNames(['Mage_Hat_primitive0'])).toBe('mage');
    expect(modelIdForMeshNames(['Skeleton_Minion_Cloak'])).toBe('skeleton_minion');
    expect(modelIdForMeshNames(['rogue_hooded-merged-0'])).toBe('rogue_hooded');
    expect(modelIdForMeshNames(['skeleton_minion-merged-1'])).toBe('skeleton_minion');
    expect(modelIdForMeshNames(['ground', 'Cube.125'])).toBeNull();
  });
});
