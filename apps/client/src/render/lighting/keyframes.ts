/**
 * Day/night keyframes for the lighting rig (M1-09). Pure data and maths: no
 * Babylon, no DOM, so the sim (M2-20), tests and docs share one source.
 *
 * Time convention: `t ∈ [0, 1)` wraps. 0 = dawn, 0.25 = noon, 0.5 = dusk,
 * 0.75 = midnight. Colours are authored as gamma hex and interpolated in
 * linear RGB; hues take the short way round; the sun's azimuth/elevation
 * interpolate as angles. Docs: docs/design/lighting.md.
 */

export type Rgb = readonly [number, number, number];

/** Named times of day. */
export const PHASES = { dawn: 0, noon: 0.25, dusk: 0.5, midnight: 0.75 } as const;
export type Phase = keyof typeof PHASES;

/** One authored keyframe. Colours are gamma-space hex. */
export interface LightingKeyframe {
  t: number;
  /** Where the light comes from: compass degrees (0 = +z north, 90 = +x east) and elevation. */
  sunAzimuth: number;
  sunElevation: number;
  /** The key light: the sun by day, the moon by night (same light, so shadows never rebuild). */
  sunColor: string;
  sunIntensity: number;
  /** Hemispheric ambient, absolute colours. Materials get them as tints over their palette ambient. */
  ambientSky: string;
  ambientGround: string;
  ambientIntensity: number;
  /** Toon rim colour and a multiplier on each material's rim intensity. */
  rimColor: string;
  rimIntensity: number;
  fogColor: string;
  /** Scene EXP2 fog density (per world unit). */
  fogDensity: number;
  skyZenith: string;
  skyHorizon: string;
  /**
   * Colour grade (image processing). Keep `exposure` and `contrast` above 1 everywhere:
   * Babylon only defines EXPOSURE/CONTRAST when they differ from 1, so crossing 1 recompiles.
   */
  exposure: number;
  contrast: number;
  saturation: number;
  highlightsHue: number;
  highlightsDensity: number;
  shadowsHue: number;
  shadowsDensity: number;
  shadowsExposure: number;
  /** Multiplier on night-emitter emissive (braziers, crystals). 1 = as authored. */
  emissive: number;
  /** How much the HDRI's irradiance hue tints the ambient (0..1). */
  iblMix: number;
}

/** Interpolated palette, in linear RGB, ready for the rig and its subscribers. */
export interface LightingPalette {
  t: number;
  /** Unit vector *toward* the light (the DirectionalLight's direction is its negation). */
  sunDirection: Rgb;
  sunAzimuth: number;
  sunElevation: number;
  sunColor: Rgb;
  sunIntensity: number;
  ambientSky: Rgb;
  ambientGround: Rgb;
  ambientIntensity: number;
  rimColor: Rgb;
  rimIntensity: number;
  fogColor: Rgb;
  fogDensity: number;
  skyZenith: Rgb;
  skyHorizon: Rgb;
  exposure: number;
  contrast: number;
  saturation: number;
  highlightsHue: number;
  highlightsDensity: number;
  shadowsHue: number;
  shadowsDensity: number;
  shadowsExposure: number;
  emissive: number;
  iblMix: number;
  /** 0 at noon … 1 at midnight: a convenience for subscribers (water sparkle, fireflies). */
  night: number;
}

/**
 * The cycle. Noon keeps the M1 baseline (sun over the camera's right shoulder)
 * but neutralises the violet in the ambient and the shadow grade, so the
 * Hollow side reads cool rather than gloomy. Night is moonlit blue, never black.
 */
export const LIGHTING_KEYFRAMES: readonly LightingKeyframe[] = [
  {
    t: 0, // dawn: low warm sun from the east, rosy fog
    sunAzimuth: 100,
    sunElevation: 24,
    sunColor: '#FFB98A',
    sunIntensity: 0.8,
    ambientSky: '#C3BCDA',
    ambientGround: '#5C5060',
    ambientIntensity: 0.55,
    rimColor: '#FFCFA0',
    rimIntensity: 1.05,
    fogColor: '#D9B9B2',
    fogDensity: 0.0026,
    skyZenith: '#4F6AA8',
    skyHorizon: '#F2B791',
    exposure: 1.06,
    contrast: 1.18,
    saturation: 14,
    highlightsHue: 30,
    highlightsDensity: 20,
    shadowsHue: 250,
    shadowsDensity: 14,
    shadowsExposure: 6,
    emissive: 1.5,
    iblMix: 0.2,
  },
  {
    t: 0.125, // morning
    sunAzimuth: 120,
    sunElevation: 42,
    sunColor: '#FFE2BC',
    sunIntensity: 0.9,
    ambientSky: '#C8CCDE',
    ambientGround: '#5E585E',
    ambientIntensity: 0.6,
    rimColor: '#FFE2B4',
    rimIntensity: 1,
    fogColor: '#CFD3DC',
    fogDensity: 0.0018,
    skyZenith: '#5A8FD0',
    skyHorizon: '#D8E2EC',
    exposure: 1.03,
    contrast: 1.2,
    saturation: 16,
    highlightsHue: 38,
    highlightsDensity: 16,
    shadowsHue: 240,
    shadowsDensity: 12,
    shadowsExposure: 6,
    emissive: 1.1,
    iblMix: 0.3,
  },
  {
    t: 0.25, // noon: the M1 baseline sun (over the camera's right shoulder)
    sunAzimuth: 135,
    sunElevation: 58,
    sunColor: '#FFF2DC',
    sunIntensity: 0.92,
    ambientSky: '#C6D0E4',
    ambientGround: '#5F5A5E',
    ambientIntensity: 0.62,
    rimColor: '#FFE9B8',
    rimIntensity: 1,
    fogColor: '#C9D3DF',
    fogDensity: 0.0014,
    skyZenith: '#5C98DA',
    skyHorizon: '#CFE2F0',
    exposure: 1.02,
    contrast: 1.22,
    saturation: 16,
    highlightsHue: 42,
    highlightsDensity: 16,
    shadowsHue: 235,
    shadowsDensity: 10,
    shadowsExposure: 7,
    emissive: 1,
    iblMix: 0.35,
  },
  {
    t: 0.375, // afternoon
    sunAzimuth: 195,
    sunElevation: 46,
    sunColor: '#FFE6C4',
    sunIntensity: 0.9,
    ambientSky: '#CACCDC',
    ambientGround: '#5F585C',
    ambientIntensity: 0.6,
    rimColor: '#FFE2B0',
    rimIntensity: 1,
    fogColor: '#D2D2D8',
    fogDensity: 0.0016,
    skyZenith: '#5888CC',
    skyHorizon: '#DCDCE0',
    exposure: 1.03,
    contrast: 1.2,
    saturation: 16,
    highlightsHue: 38,
    highlightsDensity: 18,
    shadowsHue: 240,
    shadowsDensity: 12,
    shadowsExposure: 6,
    emissive: 1.1,
    iblMix: 0.3,
  },
  {
    t: 0.5, // dusk: low orange sun from the west, braziers coming up
    sunAzimuth: 250,
    sunElevation: 24,
    sunColor: '#FFA266',
    sunIntensity: 0.78,
    ambientSky: '#C2AFC8',
    ambientGround: '#584A5A',
    ambientIntensity: 0.55,
    rimColor: '#FFB98C',
    rimIntensity: 1.1,
    fogColor: '#BE96A0',
    fogDensity: 0.0028,
    skyZenith: '#3E4584',
    skyHorizon: '#F0915E',
    exposure: 1.06,
    contrast: 1.16,
    saturation: 18,
    highlightsHue: 24,
    highlightsDensity: 24,
    shadowsHue: 258,
    shadowsDensity: 16,
    shadowsExposure: 7,
    emissive: 1.7,
    iblMix: 0.15,
  },
  {
    t: 0.625, // nightfall: the key light turns into the moon at its dimmest
    sunAzimuth: 225,
    sunElevation: 38,
    sunColor: '#8E9EE0',
    sunIntensity: 0.4,
    ambientSky: '#7E88BE',
    ambientGround: '#363A58',
    ambientIntensity: 0.68,
    rimColor: '#B4C2F6',
    rimIntensity: 1.2,
    fogColor: '#2E3456',
    fogDensity: 0.0032,
    skyZenith: '#141A40',
    skyHorizon: '#3A3C6C',
    exposure: 1.18,
    contrast: 1.12,
    saturation: 10,
    highlightsHue: 220,
    highlightsDensity: 14,
    shadowsHue: 232,
    shadowsDensity: 20,
    shadowsExposure: 9,
    emissive: 2.1,
    iblMix: 0.05,
  },
  {
    t: 0.75, // midnight: high cool moon, readable blue
    sunAzimuth: 200,
    sunElevation: 55,
    sunColor: '#A4B8FF',
    sunIntensity: 0.48,
    ambientSky: '#7389C6',
    ambientGround: '#323C5E',
    ambientIntensity: 0.74,
    rimColor: '#B8CCFF',
    rimIntensity: 1.25,
    fogColor: '#1F2A4C',
    fogDensity: 0.0034,
    skyZenith: '#0B1232',
    skyHorizon: '#27365F',
    exposure: 1.24,
    contrast: 1.1,
    saturation: 8,
    highlightsHue: 215,
    highlightsDensity: 16,
    shadowsHue: 228,
    shadowsDensity: 22,
    shadowsExposure: 10,
    emissive: 2.2,
    iblMix: 0,
  },
  {
    t: 0.875, // before dawn: the moon sinks east, the horizon warms
    sunAzimuth: 145,
    sunElevation: 40,
    sunColor: '#A6B0EC',
    sunIntensity: 0.42,
    ambientSky: '#8A90C4',
    ambientGround: '#3C3E5C',
    ambientIntensity: 0.66,
    rimColor: '#C4C6F4',
    rimIntensity: 1.2,
    fogColor: '#4A4A6C',
    fogDensity: 0.003,
    skyZenith: '#1E2856',
    skyHorizon: '#6C5C82',
    exposure: 1.16,
    contrast: 1.12,
    saturation: 10,
    highlightsHue: 250,
    highlightsDensity: 14,
    shadowsHue: 236,
    shadowsDensity: 18,
    shadowsExposure: 9,
    emissive: 1.9,
    iblMix: 0.05,
  },
];

// ---------------------------------------------------------------------------- maths

/** Wraps any number into [0, 1). */
export function wrapT(t: number): number {
  const w = t - Math.floor(t);
  return w >= 1 ? 0 : w;
}

export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Interpolates angles in degrees the short way round; result in [0, 360). */
export function lerpAngle(a: number, b: number, k: number): number {
  let d = ((((b - a) % 360) + 540) % 360) - 180;
  if (d === -180) d = 180;
  const r = (a + d * k) % 360;
  return r < 0 ? r + 360 : r;
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/** Gamma hex → linear RGB. */
export function hexToLinear(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  return [
    srgbToLinear(((n >> 16) & 255) / 255),
    srgbToLinear(((n >> 8) & 255) / 255),
    srgbToLinear((n & 255) / 255),
  ];
}

/** Linear RGB → gamma RGB (each 0..1, clamped). */
export function linearToGamma(c: Rgb): Rgb {
  const f = (v: number) => linearToSrgb(Math.min(1, Math.max(0, v)));
  return [f(c[0]), f(c[1]), f(c[2])];
}

/** Linear RGB → gamma hex. */
export function linearToHex(c: Rgb): string {
  const g = linearToGamma(c);
  return `#${g
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

export const lerpRgb = (a: Rgb, b: Rgb, k: number): Rgb => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k),
  lerp(a[2], b[2], k),
];

/** Rec. 709 luminance of a linear colour. */
export const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Unit vector toward a light at compass azimuth / elevation (degrees). Y up, +z north, +x east. */
export function sunDirection(azimuthDeg: number, elevationDeg: number): Rgb {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const c = Math.cos(el);
  return [Math.sin(az) * c, Math.sin(el), Math.cos(az) * c];
}

const COLOR_KEYS = [
  'sunColor',
  'ambientSky',
  'ambientGround',
  'rimColor',
  'fogColor',
  'skyZenith',
  'skyHorizon',
] as const;
const SCALAR_KEYS = [
  'sunIntensity',
  'ambientIntensity',
  'rimIntensity',
  'fogDensity',
  'exposure',
  'contrast',
  'saturation',
  'highlightsDensity',
  'shadowsDensity',
  'shadowsExposure',
  'emissive',
  'iblMix',
  'sunElevation',
] as const;
const ANGLE_KEYS = ['sunAzimuth', 'highlightsHue', 'shadowsHue'] as const;

/**
 * The two keyframes around `t` and the blend between them (wrapping from the
 * last key back to the first). Keys must be sorted by `t` in [0, 1).
 */
export function bracket<K extends { t: number }>(
  keys: readonly K[],
  t: number,
): { a: K; b: K; k: number } {
  if (keys.length === 0) throw new Error('no keyframes');
  const w = wrapT(t);
  if (keys.length === 1) return { a: keys[0]!, b: keys[0]!, k: 0 };
  let i = keys.length - 1;
  for (let j = 0; j < keys.length; j++) {
    if (keys[j]!.t <= w) i = j;
    else break;
  }
  // Before the first key: we're between the last key and the first (wrapped).
  if (w < keys[0]!.t) i = keys.length - 1;
  const a = keys[i]!;
  const b = keys[(i + 1) % keys.length]!;
  let span = b.t - a.t;
  let d = w - a.t;
  if (span <= 0) span += 1;
  if (d < 0) d += 1;
  return { a, b, k: span > 0 ? Math.min(1, Math.max(0, d / span)) : 0 };
}

/** How "night" a time is: 0 at noon, 1 at midnight, a cosine in between. */
export function nightAmount(t: number): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * (wrapT(t) - PHASES.noon));
}

/** Samples the cycle at `t` (wraps). Linear between keys; colours in linear RGB. */
export function samplePalette(
  t: number,
  keys: readonly LightingKeyframe[] = LIGHTING_KEYFRAMES,
): LightingPalette {
  const { a, b, k } = bracket(keys, t);
  const out: Record<string, unknown> = { t: wrapT(t), night: nightAmount(t) };
  for (const key of COLOR_KEYS) out[key] = lerpRgb(hexToLinear(a[key]), hexToLinear(b[key]), k);
  for (const key of SCALAR_KEYS) out[key] = lerp(a[key], b[key], k);
  for (const key of ANGLE_KEYS) out[key] = lerpAngle(a[key], b[key], k);
  const p = out as unknown as LightingPalette;
  return { ...p, sunDirection: sunDirection(p.sunAzimuth, p.sunElevation) };
}

/** Per-channel ratio `target / base` (both linear), for tinting materials' own palette colours. */
export function tintOver(target: Rgb, base: Rgb): Rgb {
  const f = (t: number, b: number) => (b > 1e-4 ? t / b : 1);
  return [f(target[0], base[0]), f(target[1], base[1]), f(target[2], base[2])];
}

/** Hemisphere irradiance hues from an environment map (linear RGB, any scale). */
export interface IblIrradiance {
  sky: Rgb;
  ground: Rgb;
}

/**
 * Evaluates a Babylon-style spherical polynomial (x, y, z, xx, yy, zz, yz, zx, xy
 * as RGB triples) for the up and down normals.
 */
export function irradianceUpDown(poly: { y: Rgb; xx: Rgb; yy: Rgb; zz: Rgb }): IblIrradiance {
  // E(n) = x·nx + y·ny + z·nz + xx·nx² + yy·ny² + zz·nz² + …; for n = ±Y only y and yy remain.
  const at = (s: 1 | -1): Rgb => [
    Math.max(0, s * poly.y[0] + poly.yy[0]),
    Math.max(0, s * poly.y[1] + poly.yy[1]),
    Math.max(0, s * poly.y[2] + poly.yy[2]),
  ];
  return { sky: at(1), ground: at(-1) };
}

/** Normalises a colour to unit luminance (its hue/saturation only); null if it's black. */
function hueOf(c: Rgb): Rgb | null {
  const l = luminance(c);
  if (!(l > 1e-6)) return null;
  // Limit how saturated an HDRI can push the ambient: never further than 50% from grey.
  const n: Rgb = [c[0] / l, c[1] / l, c[2] / l];
  return lerpRgb([1, 1, 1], n, 0.5);
}

/**
 * Pulls the palette's ambient toward the environment's irradiance hue by
 * `palette.iblMix`, keeping each colour's luminance. No-op without IBL data.
 */
export function applyIbl(p: LightingPalette, ibl: IblIrradiance | null): LightingPalette {
  if (!ibl || p.iblMix <= 0) return p;
  const pull = (c: Rgb, env: Rgb): Rgb => {
    const h = hueOf(env);
    if (!h) return c;
    const l = luminance(c);
    return lerpRgb(c, [h[0] * l, h[1] * l, h[2] * l], p.iblMix);
  };
  return {
    ...p,
    ambientSky: pull(p.ambientSky, ibl.sky),
    ambientGround: pull(p.ambientGround, ibl.ground),
  };
}
