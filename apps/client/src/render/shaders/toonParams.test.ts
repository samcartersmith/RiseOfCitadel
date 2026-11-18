import { describe, expect, it } from 'vitest';
import { DEFAULT_TOON_PARAMS, rampUniforms, smoothstep, toonRamp } from './toonParams';
import { TOON_UNIFORMS, toonFragmentCode } from './toonShaderCode';

const p = DEFAULT_TOON_PARAMS;

describe('toonRamp', () => {
  it('hits the band levels away from the thresholds', () => {
    expect(toonRamp(0, p)).toBeCloseTo(p.shadowLevel, 6);
    expect(toonRamp((p.shadowThreshold + p.litThreshold) / 2, p)).toBeCloseTo(p.midLevel, 6);
    expect(toonRamp(1, p)).toBeCloseTo(1, 6);
  });

  it('is monotonic', () => {
    let prev = -Infinity;
    for (let x = 0; x <= 1.0001; x += 0.005) {
      const r = toonRamp(x, p);
      expect(r).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r;
    }
  });

  it('has exactly three plateaus with 3 bands and two with 2', () => {
    const plateaus = (bands: 2 | 3) => {
      const values = new Set<string>();
      for (let x = 0; x <= 1; x += 0.01) values.add(toonRamp(x, { ...p, bands }).toFixed(2));
      // Plateau values dominate; transition samples are few with the default softness.
      return [p.shadowLevel, p.midLevel, 1].filter((v) => values.has(v.toFixed(2))).length;
    };
    expect(plateaus(3)).toBe(3);
    expect(plateaus(2)).toBe(2);
  });

  it('collapses the middle band in 2-band mode', () => {
    expect(rampUniforms({ ...p, bands: 2 })).toEqual({
      t1: p.shadowThreshold,
      t2: p.shadowThreshold,
      mid: 1,
    });
    expect(rampUniforms({ ...p, litThreshold: 0 }).t2).toBe(p.shadowThreshold); // never below t1
  });
});

describe('smoothstep', () => {
  it('matches GLSL', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0.3, 0.3, 0.2)).toBe(0);
    expect(smoothstep(0.3, 0.3, 0.4)).toBe(1);
  });
});

describe('toon shader code', () => {
  for (const wgsl of [false, true]) {
    const code = toonFragmentCode(wgsl);
    const all = Object.values(code).join('\n');
    it(`${wgsl ? 'WGSL' : 'GLSL'} hooks the lighting and colour injection points`, () => {
      expect(Object.keys(code).sort()).toEqual([
        'CUSTOM_FRAGMENT_BEFORE_FOG',
        'CUSTOM_FRAGMENT_DEFINITIONS',
      ]);
      expect(all).toContain('computeCustomDiffuseLighting');
      expect(all).toContain('computeCustomSpecularLighting');
      expect(all).toContain('citadelToonShade');
    });
    it(`${wgsl ? 'WGSL' : 'GLSL'} reads every uniform it declares`, () => {
      for (const u of TOON_UNIFORMS) expect(all).toContain(u);
    });
    it(`${wgsl ? 'WGSL' : 'GLSL'} uses the same luma weights as palette.ts`, () => {
      expect(all).toContain('0.299, 0.587, 0.114');
    });
  }
});
