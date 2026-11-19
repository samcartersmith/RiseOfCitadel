/**
 * Water look knobs and the day/night colour hook for M1-09. Pure (no Babylon).
 *
 * Colours are gamma-space hex like the rest of the palette (art-direction.md
 * §2.1). Every field is a shader uniform, so changing any of them at runtime
 * (`water.setLighting`) never recompiles.
 */

export interface WaterLighting {
  /** Water over the shallow banks. */
  shallow: string;
  /** The deep channel. */
  deep: string;
  /** Shoreline foam. */
  foam: string;
  /** Flow streaks (the lines that show which way the river runs). */
  streak: string;
  /** Self-lit "raw light" glow (art direction: a river of light). */
  glow: string;
  /** Glow strength (0 = none). Night raises it so the river reads in the dark. */
  glowIntensity: number;
  /** Colour the fresnel band picks up at grazing angles (the sky it would reflect). */
  skyTint: string;
  /** Mote colour and brightness (High/Medium). */
  mote: string;
  moteIntensity: number;
}

export interface WaterLook extends WaterLighting {
  /** Opacity over the shallow banks and in the deep channel. */
  shallowAlpha: number;
  deepAlpha: number;
  /** Water depth (world units) where the colour reaches `deep`. */
  deepDepth: number;
  /** Depth (world units) the foam band reaches from the waterline. */
  foamDepth: number;
  /** Strength of the flow streaks (0..1). */
  streakStrength: number;
  /** Fresnel band strength (0..1). */
  fresnel: number;
  /** How far the procedural ripples tilt the normal (0 = flat). */
  rippleStrength: number;
  /** Toon specular: threshold on n·h (cos), strength. */
  specThreshold: number;
  specStrength: number;
  /** Seconds per flow-map phase (see `flowPhases`). */
  flowPeriod: number;
  /** Soft posterise width for the depth bands (0 = hard). */
  bandSoftness: number;
}

/** Day palette: the river is pale cyan light-water (#7FE3E0) over a teal channel. */
export const DAY_WATER_LIGHTING: Readonly<WaterLighting> = {
  shallow: '#8FE6DC',
  deep: '#1E6E78',
  foam: '#F2FBF6',
  streak: '#C8F7F0',
  glow: '#7FE3E0',
  glowIntensity: 0.12,
  skyTint: '#BFD8F0',
  mote: '#BFF6F0',
  moteIntensity: 1.3,
};

/**
 * Night palette: deeper water, but the river itself glows (raw leyline light),
 * so it stays the brightest neutral thing on the map.
 */
export const NIGHT_WATER_LIGHTING: Readonly<WaterLighting> = {
  shallow: '#4FA9B4',
  deep: '#0F3550',
  foam: '#D8F4F2',
  streak: '#9DF2F0',
  glow: '#7FE3E0',
  glowIntensity: 0.45,
  skyTint: '#5A5F9A',
  mote: '#A9FFF6',
  moteIntensity: 1.6,
};

export const DEFAULT_WATER_LOOK: Readonly<WaterLook> = {
  ...DAY_WATER_LIGHTING,
  shallowAlpha: 0.55,
  deepAlpha: 0.88,
  deepDepth: 0.9,
  foamDepth: 0.22,
  streakStrength: 0.45,
  fresnel: 0.35,
  rippleStrength: 0.35,
  specThreshold: 0.994,
  specStrength: 0.9,
  flowPeriod: 3,
  bandSoftness: 0.12,
};

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`bad colour ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const toHex = (rgb: readonly number[]) =>
  '#' +
  rgb
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();

/** Linear-light mix of two gamma hex colours (no muddy midpoint). */
export function mixHex(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return toHex(
    A.map((v, i) => Math.pow(Math.pow(v, 2.2) * (1 - k) + Math.pow(B[i]!, 2.2) * k, 1 / 2.2)),
  );
}

/**
 * Water colours for a daylight amount (0 = night, 1 = full day). M1-09 maps
 * its day/night `t` to daylight (e.g. from the sun's elevation) and calls
 * `water.setLighting(waterLightingFor(daylight))`; sun and ambient light are
 * read from the scene's lights each frame, so only these water-specific
 * colours need pushing.
 */
export function waterLightingFor(
  daylight: number,
  day: WaterLighting = DAY_WATER_LIGHTING,
  night: WaterLighting = NIGHT_WATER_LIGHTING,
): WaterLighting {
  const t = Math.max(0, Math.min(1, daylight));
  const lerp = (a: number, b: number) => b + (a - b) * t;
  return {
    shallow: mixHex(night.shallow, day.shallow, t),
    deep: mixHex(night.deep, day.deep, t),
    foam: mixHex(night.foam, day.foam, t),
    streak: mixHex(night.streak, day.streak, t),
    glow: mixHex(night.glow, day.glow, t),
    glowIntensity: lerp(day.glowIntensity, night.glowIntensity),
    skyTint: mixHex(night.skyTint, day.skyTint, t),
    mote: mixHex(night.mote, day.mote, t),
    moteIntensity: lerp(day.moteIntensity, night.moteIntensity),
  };
}
