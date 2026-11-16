import { describe, expect, it } from 'vitest';
import { diffStates, pickNearest } from './diff';
import type { ModelId } from './modelConfig';
import { relationOf } from './unitState';

const s = (id: number, modelId: ModelId = 'skeleton_minion') => ({ id, modelId });

describe('diffStates', () => {
  it('sorts ids into added / kept / replaced / removed', () => {
    const live = new Map<number, ModelId>([
      [1, 'knight'],
      [2, 'skeleton_minion'],
      [3, 'mage'],
    ]);
    const d = diffStates(live, [s(1, 'knight'), s(3, 'rogue_hooded'), s(4), s(5, 'mage')]);
    expect(d.kept).toEqual([1]);
    expect(d.replaced).toEqual([3]);
    expect(d.added).toEqual([4, 5]);
    expect(d.removed).toEqual([2]);
  });

  it('handles empty inputs', () => {
    expect(diffStates(new Map(), [])).toEqual({ added: [], replaced: [], removed: [], kept: [] });
    const all = diffStates(new Map([[7, 'knight' as ModelId]]), []);
    expect(all.removed).toEqual([7]);
  });

  it('ignores duplicate ids after the first', () => {
    const d = diffStates(new Map(), [s(1), s(1, 'knight'), s(2)]);
    expect(d.added).toEqual([1, 2]);
  });

  it('is stable when nothing changed', () => {
    const live = new Map<number, ModelId>([
      [1, 'knight'],
      [2, 'mage'],
    ]);
    const d = diffStates(live, [s(2, 'mage'), s(1, 'knight')]);
    expect(d).toEqual({ added: [], replaced: [], removed: [], kept: [2, 1] });
  });
});

describe('pickNearest', () => {
  const t = (id: number, x: number, y: number, radius = 20, depth = 50) => ({
    id,
    x,
    y,
    radius,
    depth,
  });

  it('returns the unit under the point, or null', () => {
    expect(pickNearest([t(1, 100, 100), t(2, 300, 100)], 105, 98)).toBe(1);
    expect(pickNearest([t(1, 100, 100), t(2, 300, 100)], 200, 100)).toBeNull();
  });

  it('prefers the closer centre (relative to size) when circles overlap', () => {
    expect(pickNearest([t(1, 100, 100), t(2, 112, 100)], 109, 100)).toBe(2);
  });

  it('breaks exact ties toward the unit nearer the camera', () => {
    expect(pickNearest([t(1, 100, 100, 20, 80), t(2, 100, 100, 20, 40)], 100, 100)).toBe(2);
  });
});

describe('relationOf', () => {
  it('maps teams to ally / enemy / neutral for the local player', () => {
    expect(relationOf('wardens', 'wardens')).toBe('ally');
    expect(relationOf('hollow', 'wardens')).toBe('enemy');
    expect(relationOf('neutral', 'hollow')).toBe('neutral');
    expect(relationOf('hollow', 'neutral')).toBe('enemy'); // spectator-ish fallback
  });
});
