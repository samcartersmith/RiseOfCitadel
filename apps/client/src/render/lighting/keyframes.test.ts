import { describe, expect, it } from 'vitest';
import {
  applyIbl,
  bracket,
  hexToLinear,
  irradianceUpDown,
  lerpAngle,
  LIGHTING_KEYFRAMES,
  linearToHex,
  luminance,
  nightAmount,
  PHASES,
  samplePalette,
  sunDirection,
  tintOver,
  wrapT,
  type LightingKeyframe,
} from './keyframes';
import { emitterScale } from './nightEmitters';

const close = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  a.every((v, i) => Math.abs(v - b[i]!) < eps);

describe('keyframe data', () => {
  it('is sorted, in [0, 1), and covers the four named phases', () => {
    const ts = LIGHTING_KEYFRAMES.map((k) => k.t);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    for (const t of ts) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1);
    }
    for (const t of Object.values(PHASES)) expect(ts).toContain(t);
  });

  it('keeps the key light above the horizon all day (stable, sane shadows)', () => {
    for (let i = 0; i <= 400; i++) {
      const p = samplePalette(i / 400);
      expect(p.sunElevation).toBeGreaterThanOrEqual(20);
      expect(p.sunDirection[1]).toBeGreaterThan(0.3);
    }
  });

  it('never lets exposure or contrast reach 1 (that toggles a shader define)', () => {
    for (let i = 0; i <= 400; i++) {
      const p = samplePalette(i / 400);
      expect(p.exposure).toBeGreaterThan(1.005);
      expect(p.contrast).toBeGreaterThan(1.005);
    }
  });

  it('keeps night readable: moonlit blue, never black', () => {
    const night = samplePalette(PHASES.midnight);
    const noon = samplePalette(PHASES.noon);
    // Blue-dominant ambient and key light at midnight.
    expect(night.ambientSky[2]).toBeGreaterThan(night.ambientSky[0]);
    expect(night.sunColor[2]).toBeGreaterThan(night.sunColor[0]);
    // Total light on an upward face stays at least a quarter of noon's (before exposure).
    const light = (p: typeof noon) =>
      luminance(p.ambientSky) * p.ambientIntensity + luminance(p.sunColor) * p.sunIntensity;
    expect(light(night) * night.exposure).toBeGreaterThan(light(noon) * 0.25);
    expect(night.emissive).toBeGreaterThan(noon.emissive);
  });

  it('noon is warm in the key light and not violet in the ambient ground', () => {
    const noon = samplePalette(PHASES.noon);
    expect(noon.sunColor[0]).toBeGreaterThan(noon.sunColor[2]);
    const [r, , b] = noon.ambientGround;
    expect(b / r).toBeLessThan(1.15); // the M1-05 default #5A4E66 is ~1.3
    expect(noon.shadowsHue).toBeLessThan(250); // grade shadows cool blue, not violet 268
  });
});

describe('interpolation', () => {
  it('returns each keyframe exactly at its t', () => {
    for (const k of LIGHTING_KEYFRAMES) {
      const p = samplePalette(k.t);
      expect(close(p.sunColor, hexToLinear(k.sunColor))).toBe(true);
      expect(close(p.fogColor, hexToLinear(k.fogColor))).toBe(true);
      expect(p.sunIntensity).toBeCloseTo(k.sunIntensity, 12);
      expect(p.exposure).toBeCloseTo(k.exposure, 12);
      expect(p.sunAzimuth).toBeCloseTo(k.sunAzimuth % 360, 9);
    }
  });

  it('blends linearly in linear RGB halfway between keys', () => {
    const [a, b] = [LIGHTING_KEYFRAMES[0]!, LIGHTING_KEYFRAMES[1]!];
    const p = samplePalette((a.t + b.t) / 2);
    const la = hexToLinear(a.ambientSky);
    const lb = hexToLinear(b.ambientSky);
    expect(
      close(p.ambientSky, [(la[0] + lb[0]) / 2, (la[1] + lb[1]) / 2, (la[2] + lb[2]) / 2]),
    ).toBe(true);
    expect(p.fogDensity).toBeCloseTo((a.fogDensity + b.fogDensity) / 2, 12);
  });

  it('wraps from the last key back to dawn', () => {
    expect(samplePalette(1).t).toBe(0);
    expect(samplePalette(-0.25).t).toBeCloseTo(0.75, 12);
    const last = LIGHTING_KEYFRAMES[LIGHTING_KEYFRAMES.length - 1]!;
    const mid = (last.t + 1) / 2;
    const { a, b, k } = bracket(LIGHTING_KEYFRAMES, mid);
    expect(a).toBe(last);
    expect(b).toBe(LIGHTING_KEYFRAMES[0]);
    expect(k).toBeCloseTo(0.5, 12);
  });

  it('is continuous over the whole cycle (no jumps between samples)', () => {
    const N = 2000;
    let prev = samplePalette(0);
    for (let i = 1; i <= N; i++) {
      const p = samplePalette(i / N);
      for (const key of ['sunIntensity', 'ambientIntensity', 'exposure', 'emissive'] as const) {
        expect(Math.abs(p[key] - prev[key])).toBeLessThan(0.01);
      }
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(p.sunDirection[c]! - prev.sunDirection[c]!)).toBeLessThan(0.01);
        expect(Math.abs(p.skyHorizon[c]! - prev.skyHorizon[c]!)).toBeLessThan(0.01);
      }
      prev = p;
    }
  });

  it('takes hues the short way round', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0, 9);
    expect(lerpAngle(10, 350, 0.25)).toBeCloseTo(5, 9);
    expect(lerpAngle(42, 215, 0.5)).toBeCloseTo(128.5, 9);
    expect(lerpAngle(30, 250, 0.5)).toBeCloseTo(320, 9); // 30 → 250 is shorter backwards (−140)
  });

  it('works with a single key and with custom keys starting after 0', () => {
    const one = [{ ...LIGHTING_KEYFRAMES[2]!, t: 0.3 }];
    expect(samplePalette(0.9, one).sunIntensity).toBe(one[0]!.sunIntensity);
    const two: LightingKeyframe[] = [
      { ...LIGHTING_KEYFRAMES[0]!, t: 0.2, sunIntensity: 0 },
      { ...LIGHTING_KEYFRAMES[0]!, t: 0.6, sunIntensity: 1 },
    ];
    expect(samplePalette(0.4, two).sunIntensity).toBeCloseTo(0.5, 12);
    // 0.0 sits between 0.6 and 1.2 (wrapped): 0.4 / 0.6 of the way back down.
    expect(samplePalette(0, two).sunIntensity).toBeCloseTo(1 - 0.4 / 0.6, 12);
  });
});

describe('helpers', () => {
  it('wrapT folds any number into [0, 1)', () => {
    expect(wrapT(0)).toBe(0);
    expect(wrapT(1)).toBe(0);
    expect(wrapT(2.25)).toBeCloseTo(0.25, 12);
    expect(wrapT(-0.1)).toBeCloseTo(0.9, 12);
  });

  it('round-trips hex through linear RGB', () => {
    for (const hex of ['#000000', '#FFFFFF', '#7FE3E0', '#5E5A63', '#E8B54A']) {
      expect(linearToHex(hexToLinear(hex))).toBe(hex);
    }
  });

  it('points the sun by compass azimuth and elevation', () => {
    expect(close(sunDirection(0, 90), [0, 1, 0], 1e-12)).toBe(true);
    expect(close(sunDirection(90, 0), [1, 0, 0], 1e-12)).toBe(true);
    expect(close(sunDirection(180, 0), [0, 0, -1], 1e-12)).toBe(true);
    const d = sunDirection(135, 58);
    expect(Math.hypot(...d)).toBeCloseTo(1, 12);
    // Noon light comes from the south-east, over the MOBA camera's right shoulder.
    const n = samplePalette(PHASES.noon).sunDirection;
    expect(n[0]).toBeGreaterThan(0);
    expect(n[2]).toBeLessThan(0);
  });

  it('nightAmount is 0 at noon and 1 at midnight', () => {
    expect(nightAmount(PHASES.noon)).toBeCloseTo(0, 12);
    expect(nightAmount(PHASES.midnight)).toBeCloseTo(1, 12);
    expect(nightAmount(PHASES.dawn)).toBeCloseTo(0.5, 12);
  });

  it('tintOver gives the per-channel factor that maps base onto target', () => {
    expect(tintOver([0.5, 0.2, 0.1], [0.25, 0.4, 0.1])).toEqual([2, 0.5, 1]);
    expect(tintOver([0.5, 0.5, 0.5], [0, 0.5, 1])).toEqual([1, 1, 0.5]);
  });

  it('emitterScale boosts by strength and never goes negative', () => {
    expect(emitterScale(2, 1)).toBe(2);
    expect(emitterScale(2, 0.5)).toBe(1.5);
    expect(emitterScale(2, 0)).toBe(1);
    expect(emitterScale(0, 2)).toBe(0);
  });
});

describe('image-based ambient', () => {
  const poly = {
    y: [0.1, 0.3, 0.9],
    xx: [0.2, 0.2, 0.2],
    yy: [0.5, 0.5, 0.5],
    zz: [0.2, 0.2, 0.2],
  } as const;

  it('evaluates the spherical polynomial at the up and down normals', () => {
    const { sky, ground } = irradianceUpDown(poly);
    expect(close(sky, [0.6, 0.8, 1.4], 1e-12)).toBe(true);
    expect(close(ground, [0.4, 0.2, 0], 1e-12)).toBe(true);
  });

  it('pulls the ambient hue toward the environment, keeping luminance', () => {
    const p = { ...samplePalette(PHASES.noon), iblMix: 1 };
    const out = applyIbl(p, irradianceUpDown(poly));
    expect(luminance(out.ambientSky)).toBeCloseTo(luminance(p.ambientSky), 9);
    // The env's sky is blue: the ambient sky gets bluer.
    expect(out.ambientSky[2] / out.ambientSky[0]).toBeGreaterThan(
      p.ambientSky[2] / p.ambientSky[0],
    );
  });

  it('is a no-op with no data, zero mix or a black environment', () => {
    const p = samplePalette(PHASES.noon);
    expect(applyIbl(p, null)).toBe(p);
    expect(applyIbl({ ...p, iblMix: 0 }, irradianceUpDown(poly)).ambientSky).toBe(p.ambientSky);
    const black = applyIbl({ ...p, iblMix: 1 }, { sky: [0, 0, 0], ground: [0, 0, 0] });
    expect(black.ambientSky).toEqual(p.ambientSky);
  });
});
