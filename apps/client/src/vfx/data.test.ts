import { describe, expect, it } from 'vitest';
import {
  ATLAS_GRID,
  CONE_DRAWN_HALF_ANGLE,
  DECAL_CELLS,
  PARTICLE_CELLS,
  cellUv,
  coneScaleX,
  decalQuadExtents,
  spriteSheetCell,
} from './atlasLayout';
import { VFX_BUDGETS, scaledCount } from './budget';
import { INTENTS, INTENT_STYLES, hexToRgb } from './intents';
import { PRESETS, PRESET_NAMES, presetEmitTime, presetLifetime } from './presets';

describe('atlas layout', () => {
  it('assigns every cell exactly once', () => {
    const ids = [...Object.values(PARTICLE_CELLS), ...Object.values(DECAL_CELLS)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...ids)).toBeLessThan(ATLAS_GRID * ATLAS_GRID);
  });

  it('maps cell 0 to the top-left of the texture (v = 1 is the canvas top)', () => {
    const uv = cellUv(0, 0);
    expect(uv).toEqual({ u0: 0, u1: 0.25, v0: 0.75, v1: 1 });
    expect(cellUv(15, 0)).toEqual({ u0: 0.75, u1: 1, v0: 0, v1: 0.25 });
    expect(() => cellUv(16)).toThrow();
  });

  it('maps canvas cells to particle sprite-sheet cells (rows flipped)', () => {
    expect(spriteSheetCell(0)).toBe(12);
    expect(spriteSheetCell(2)).toBe(14);
    expect(spriteSheetCell(6)).toBe(10);
    expect(spriteSheetCell(15)).toBe(3);
  });

  it('quad extents put radius / apex / start at unit dimensions', () => {
    const c = decalQuadExtents('circle');
    expect(c.x1).toBeGreaterThan(1); // padding sits outside radius 1
    expect(c.x0).toBe(-c.x1);
    const cone = decalQuadExtents('cone');
    expect(cone.z0).toBeLessThan(0); // apex just above the bottom edge
    expect(cone.z1).toBeGreaterThan(1);
    // At the drawn 30° half-angle, the arc at radius 1 spans x = ±0.5.
    expect(cone.x1).toBeGreaterThanOrEqual(Math.sin(CONE_DRAWN_HALF_ANGLE));
  });

  it('cone X scale is the length at 30° and grows with the angle', () => {
    expect(coneScaleX(5, CONE_DRAWN_HALF_ANGLE)).toBeCloseTo(5);
    expect(coneScaleX(5, Math.PI / 4)).toBeGreaterThan(5);
    expect(coneScaleX(5, Math.PI / 12)).toBeLessThan(5);
  });
});

describe('intents', () => {
  it('uses the palette danger and ally colours', () => {
    expect(INTENT_STYLES.enemyDisable.edge).toBe('#E5484D');
    expect(INTENT_STYLES.allyBuff.edge).toBe('#46A758');
  });

  it('priority follows art direction: disable > buff > damage > neutral', () => {
    const p = INTENTS.map((i) => INTENT_STYLES[i].priority);
    expect(p).toEqual([...p].sort((a, b) => b - a));
    expect(new Set(p).size).toBe(p.length);
  });

  it('parses hex colours', () => {
    expect(hexToRgb('#FF0000')).toEqual([1, 0, 0]);
    expect(hexToRgb('#0f0')).toEqual([0, 1, 0]);
    expect(() => hexToRgb('nope')).toThrow();
  });
});

describe('budgets and presets', () => {
  it('scales particle counts down per tier, never to zero', () => {
    expect(scaledCount(40, 'high')).toBe(40);
    expect(scaledCount(40, 'medium')).toBeLessThan(40);
    expect(scaledCount(40, 'low')).toBeLessThan(scaledCount(40, 'medium'));
    expect(scaledCount(1, 'low')).toBe(1);
    expect(scaledCount(0, 'low')).toBe(0);
    expect(VFX_BUDGETS.high.particleScale).toBe(1);
  });

  it('includes every required preset', () => {
    for (const name of [
      'impactBurst',
      'sparkShower',
      'dustPuff',
      'trail',
      'aura',
      'embers',
      'motes',
    ]) {
      expect(PRESET_NAMES).toContain(name);
    }
  });

  it('every layer fits its burst in its capacity and has a sane lifetime', () => {
    for (const name of PRESET_NAMES) {
      for (const layer of PRESETS[name].layers) {
        expect('burst' in layer || 'rate' in layer).toBe(true);
        if ('burst' in layer) expect(layer.burst).toBeLessThanOrEqual(layer.capacity);
        if ('rate' in layer) {
          // Peak live count (rate × min(emit time, max life)) must fit the buffer.
          const peak = layer.rate * Math.min(layer.emitTime, layer.life[1]);
          expect(peak).toBeLessThanOrEqual(layer.capacity);
        }
        expect(layer.life[0]).toBeLessThanOrEqual(layer.life[1]);
      }
    }
  });

  it('computes when a cast finishes', () => {
    expect(presetEmitTime(PRESETS.impactBurst)).toBe(0);
    expect(presetLifetime(PRESETS.impactBurst, 0)).toBeCloseTo(0.5);
    expect(presetEmitTime(PRESETS.sparkShower)).toBeCloseTo(0.4);
    expect(presetLifetime(PRESETS.sparkShower, 0.4)).toBeCloseTo(1.3);
    expect(presetLifetime(PRESETS.aura, 2)).toBeCloseTo(3.6);
  });
});
