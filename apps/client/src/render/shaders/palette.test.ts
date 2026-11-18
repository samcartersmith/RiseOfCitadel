import { describe, expect, it } from 'vitest';
import {
  buildPaletteLut,
  CITADEL_RAMP_STOPS,
  hexToRgb,
  isTeam,
  luma,
  PALETTE_LUT_SIZE,
  sampleRamp,
  TEAM_COLORS,
  type Rgb,
} from './palette';

const texel = (lut: Uint8Array, i: number): Rgb => [
  lut[i * 4]! / 255,
  lut[i * 4 + 1]! / 255,
  lut[i * 4 + 2]! / 255,
];

describe('hexToRgb', () => {
  it('parses with or without #', () => {
    expect(hexToRgb('#E8B54A')).toEqual([232 / 255, 181 / 255, 74 / 255]);
    expect(hexToRgb('8e5bd9')).toEqual([142 / 255, 91 / 255, 217 / 255]);
  });
  it('rejects malformed colours', () => {
    expect(() => hexToRgb('#fff')).toThrow();
    expect(() => hexToRgb('gold')).toThrow();
  });
});

describe('team colours', () => {
  it('match art direction §2', () => {
    expect(TEAM_COLORS).toEqual({ warden: '#E8B54A', hollow: '#8E5BD9' });
    expect(isTeam('warden')).toBe(true);
    expect(isTeam('#E8B54A')).toBe(false);
  });
});

describe('buildPaletteLut', () => {
  const lut = buildPaletteLut();

  it('is size × 1 RGBA8, fully opaque', () => {
    expect(lut).toBeInstanceOf(Uint8Array);
    expect(lut.length).toBe(PALETTE_LUT_SIZE * 4);
    for (let i = 0; i < PALETTE_LUT_SIZE; i++) expect(lut[i * 4 + 3]).toBe(255);
  });

  it('starts at the darkest stop and ends at the lightest', () => {
    const first = hexToRgb(CITADEL_RAMP_STOPS[0]!.color);
    const last = hexToRgb(CITADEL_RAMP_STOPS[CITADEL_RAMP_STOPS.length - 1]!.color);
    texel(lut, 0).forEach((c, k) => expect(c).toBeCloseTo(first[k]!, 2));
    texel(lut, PALETTE_LUT_SIZE - 1).forEach((c, k) => expect(c).toBeCloseTo(last[k]!, 2));
  });

  it('never gets darker along the ramp', () => {
    for (let i = 1; i < PALETTE_LUT_SIZE; i++) {
      expect(luma(texel(lut, i))).toBeGreaterThanOrEqual(luma(texel(lut, i - 1)) - 1 / 255);
    }
  });

  it('preserves value: the texel for luma x has luma ≈ x between the end stops', () => {
    const lo = luma(hexToRgb(CITADEL_RAMP_STOPS[0]!.color));
    const hi = luma(hexToRgb(CITADEL_RAMP_STOPS[CITADEL_RAMP_STOPS.length - 1]!.color));
    for (let i = 0; i < PALETTE_LUT_SIZE; i++) {
      const x = i / (PALETTE_LUT_SIZE - 1);
      const expected = Math.min(hi, Math.max(lo, x));
      expect(Math.abs(luma(texel(lut, i)) - expected)).toBeLessThan(2 / 255);
    }
  });

  it('passes through each palette stop exactly', () => {
    for (const stop of CITADEL_RAMP_STOPS) {
      const rgb = hexToRgb(stop.color);
      sampleRamp(CITADEL_RAMP_STOPS, luma(rgb)).forEach((c, k) =>
        expect(c).toBeCloseTo(rgb[k]!, 6),
      );
    }
  });

  it('honours explicit positions and sorts stops', () => {
    const custom = buildPaletteLut(
      [
        { color: '#FFFFFF', at: 1 },
        { color: '#000000', at: 0 },
      ],
      3,
    );
    expect([...custom]).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  });

  it('rejects bad sizes and empty ramps', () => {
    expect(() => buildPaletteLut(CITADEL_RAMP_STOPS, 1)).toThrow();
    expect(() => buildPaletteLut([], 16)).toThrow();
  });
});
