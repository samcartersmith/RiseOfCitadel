import { describe, expect, it } from 'vitest';
import {
  DAY_WATER_LIGHTING,
  DEFAULT_WATER_LOOK,
  hexToRgb,
  mixHex,
  NIGHT_WATER_LIGHTING,
  waterLightingFor,
} from './waterLook';
import { WATER_ATTRIBUTES, WATER_UNIFORMS, waterShaderCode } from './waterShaderCode';

const luma = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('water look', () => {
  it('keys the glow to the art-direction river light', () => {
    expect(DEFAULT_WATER_LOOK.glow).toBe('#7FE3E0');
  });

  it('reads lighter over the shallows than in the channel', () => {
    expect(luma(DEFAULT_WATER_LOOK.shallow)).toBeGreaterThan(luma(DEFAULT_WATER_LOOK.deep) + 0.3);
    expect(DEFAULT_WATER_LOOK.shallowAlpha).toBeLessThan(DEFAULT_WATER_LOOK.deepAlpha);
  });

  it('mixHex hits both ends and stays in gamut', () => {
    expect(mixHex('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mixHex('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mixHex('#000000', '#FFFFFF', 7)).toBe('#FFFFFF');
    // Linear-light midpoint is brighter than the gamma midpoint (#808080).
    expect(hexToRgb(mixHex('#000000', '#FFFFFF', 0.5))[0]).toBeGreaterThan(0.5);
  });

  it('waterLightingFor runs from the night palette to the day palette', () => {
    expect(waterLightingFor(1)).toEqual({ ...DAY_WATER_LIGHTING });
    expect(waterLightingFor(0)).toEqual({ ...NIGHT_WATER_LIGHTING });
    expect(waterLightingFor(-3)).toEqual(waterLightingFor(0));
    const dusk = waterLightingFor(0.5);
    expect(dusk.glowIntensity).toBeGreaterThan(DAY_WATER_LIGHTING.glowIntensity);
    expect(dusk.glowIntensity).toBeLessThan(NIGHT_WATER_LIGHTING.glowIntensity);
    // Night: darker water but a stronger glow, so the river still reads.
    expect(luma(NIGHT_WATER_LIGHTING.deep)).toBeLessThan(luma(DAY_WATER_LIGHTING.deep));
    expect(NIGHT_WATER_LIGHTING.glowIntensity).toBeGreaterThan(
      DAY_WATER_LIGHTING.glowIntensity * 3,
    );
  });
});

describe('water shader code', () => {
  const hooks = (wgsl: boolean) => ({
    vertex: waterShaderCode('vertex', wgsl)!,
    fragment: waterShaderCode('fragment', wgsl)!,
  });

  it('declares the same hooks in GLSL and WGSL', () => {
    const g = hooks(false);
    const w = hooks(true);
    expect(Object.keys(w.vertex).sort()).toEqual(Object.keys(g.vertex).sort());
    expect(Object.keys(w.fragment).sort()).toEqual(Object.keys(g.fragment).sort());
    expect(waterShaderCode('compute', false)).toBeNull();
  });

  it('reads every uniform and passes every attribute through, in both languages', () => {
    for (const wgsl of [false, true]) {
      const { vertex, fragment } = hooks(wgsl);
      const frag = Object.values(fragment).join('\n');
      const vert = Object.values(vertex).join('\n');
      for (const u of WATER_UNIFORMS) expect(frag, `${u} (${wgsl ? 'wgsl' : 'glsl'})`).toContain(u);
      for (const a of WATER_ATTRIBUTES) {
        expect(vert).toContain(`attribute ${wgsl ? `${a}:` : ''}`);
        expect(vert).toContain(a);
        const varying = `v${a[0]!.toUpperCase()}${a.slice(1)}`;
        expect(vert).toContain(varying);
        expect(frag).toContain(varying);
      }
      // Everything is guarded by the plugin's define.
      for (const code of [...Object.values(vertex), ...Object.values(fragment)]) {
        expect(code.trim().startsWith('#ifdef CITADEL_WATER')).toBe(true);
      }
    }
  });

  it('samples no textures (no WGSL uniformity constraints, no downloads)', () => {
    for (const wgsl of [false, true]) {
      const all = [
        ...Object.values(hooks(wgsl).vertex),
        ...Object.values(hooks(wgsl).fragment),
      ].join('\n');
      expect(all).not.toMatch(/texture2D|textureSample|sampler/);
    }
  });
});
