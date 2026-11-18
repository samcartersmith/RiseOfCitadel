import { describe, expect, it } from 'vitest';
import { LOGICAL_STATES } from '../states';
import {
  CREEP_MODEL_IDS,
  CREEP_TYPES,
  NEUTRAL_CAMPS,
  bakedClipNames,
  isCreepModelId,
} from './creepTypes';
import { SIEGE_CLIPS } from './siegePose';
import { ATLAS_CELLS } from './swatch';

describe('creep types', () => {
  it('has a config for every id, keyed consistently', () => {
    for (const id of CREEP_MODEL_IDS) expect(CREEP_TYPES[id].id).toBe(id);
    expect(Object.keys(CREEP_TYPES).sort()).toEqual([...CREEP_MODEL_IDS].sort());
  });

  it('routes creep ids and nothing else', () => {
    expect(isCreepModelId('hollow_melee')).toBe(true);
    expect(isCreepModelId('bulwark')).toBe(false);
  });

  it('covers 6 lane types (both factions × melee/ranged/siege), 4 neutrals and a boss', () => {
    const lane = CREEP_MODEL_IDS.filter((id) => CREEP_TYPES[id].category === 'lane');
    expect(lane).toHaveLength(6);
    expect(lane.filter((id) => CREEP_TYPES[id].team === 'wardens')).toHaveLength(3);
    expect(lane.filter((id) => CREEP_TYPES[id].team === 'hollow')).toHaveLength(3);
    expect(CREEP_MODEL_IDS.filter((id) => CREEP_TYPES[id].category === 'neutral')).toHaveLength(4);
    expect(CREEP_MODEL_IDS.filter((id) => CREEP_TYPES[id].category === 'boss')).toHaveLength(1);
  });

  it('maps every logical state to a clip', () => {
    for (const id of CREEP_MODEL_IDS) {
      for (const s of LOGICAL_STATES) expect(CREEP_TYPES[id].clips[s], `${id}.${s}`).toBeTruthy();
      expect(bakedClipNames(id).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('siege engines only use the procedural clips', () => {
    const names = new Set<string>(Object.values(SIEGE_CLIPS).map((c) => c.name));
    for (const id of CREEP_MODEL_IDS) {
      if (CREEP_TYPES[id].build !== 'siege') continue;
      for (const n of bakedClipNames(id)) expect(names.has(n)).toBe(true);
    }
  });

  it('lane creeps carry a team swatch and stay inside the 2k triangle budget', () => {
    for (const id of CREEP_MODEL_IDS) {
      const t = CREEP_TYPES[id];
      expect(t.whiteCell).toBeGreaterThanOrEqual(0);
      expect(t.whiteCell).toBeLessThan(ATLAS_CELLS);
      if (t.category !== 'lane') continue;
      expect(t.teamCell, id).toBeGreaterThanOrEqual(0);
      expect(t.teamCell!).toBeLessThan(ATLAS_CELLS);
      expect(t.maxTriangles).toBeLessThanOrEqual(2000);
    }
  });

  it('recolour rules point at real swatches', () => {
    for (const id of CREEP_MODEL_IDS) {
      for (const r of CREEP_TYPES[id].recolor) {
        const from = typeof r.from === 'number' ? [r.from] : r.from;
        for (const c of [...from, ...(r.to === undefined ? [] : [r.to])]) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThan(ATLAS_CELLS);
        }
      }
    }
  });

  it('camps only use neutral types', () => {
    expect(NEUTRAL_CAMPS).toHaveLength(4);
    for (const camp of NEUTRAL_CAMPS) {
      for (const u of camp.units) expect(CREEP_TYPES[u].category).toBe('neutral');
    }
  });
});
