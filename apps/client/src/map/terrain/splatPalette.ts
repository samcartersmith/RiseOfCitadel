/**
 * Terrain splat layers and their palette ramps (pure data, no Babylon).
 *
 * The detail atlas carries only luminance (one ambientCG photo per channel).
 * Each layer turns that luminance into colour through a 3-stop ramp
 * (dark → mid → light) taken from the art-direction palette, with a Warden and
 * a Hollow version blended by the biome weight. That is the "palette remap":
 * no photo colour reaches the screen, so every layer sits on the same palette
 * as the toon-shaded units. See docs/design/terrain.md.
 */

/** Detail atlas channels (tools/assets/terrain-textures.ts → TERRAIN_LAYERS). */
export const DETAIL_CHANNELS = {
  grass: 'r', // Grass004
  dirt: 'g', // Ground037
  ground: 'b', // Ground054
  rock: 'a', // Rock030
} as const;

export type DetailChannel = (typeof DETAIL_CHANNELS)[keyof typeof DETAIL_CHANNELS];

export type Ramp = readonly [dark: string, mid: string, light: string];

export interface SplatLayer {
  id: string;
  /** Which ambientCG luminance it reads. */
  channel: DetailChannel;
  source: string;
  warden: Ramp;
  hollow: Ramp;
  /** Luminance contrast around 0.5 before the ramp (low = calmer, art direction §2.2). */
  contrast: number;
}

/**
 * Layer order is also blend order (later layers paint over earlier ones):
 * grass → forest floor → lane dirt → paving → bank sand → riverbed → rock.
 */
export const SPLAT_LAYERS: readonly SplatLayer[] = [
  {
    id: 'grass',
    channel: 'r',
    source: 'Grass004',
    warden: ['#4F6540', '#6F9A4E', '#A3A86E'], // Warden moss → golden grass
    hollow: ['#55505E', '#76717E', '#9A92A8'], // Hollow ash → violet-tinted ash
    contrast: 0.55,
  },
  {
    id: 'forest',
    channel: 'r',
    source: 'Grass004',
    warden: ['#3E5233', '#566F43', '#6F8F52'],
    hollow: ['#433E4C', '#5A5466', '#756D82'],
    contrast: 0.6,
  },
  {
    id: 'dirt',
    channel: 'g',
    source: 'Ground037',
    warden: ['#7A5E44', '#9C7F5E', '#C2AA86'], // bronze-brown trodden earth
    hollow: ['#675C64', '#8A7E86', '#ADA1A8'],
    contrast: 0.45,
  },
  {
    id: 'paving',
    channel: 'b',
    source: 'Ground054',
    warden: ['#8E8474', '#B8AE9C', '#D6CDBB'], // Warden stone
    hollow: ['#4A4652', '#6A6672', '#8A8592'], // Hollow iron → ash
    contrast: 0.7,
  },
  {
    id: 'sand',
    channel: 'b',
    source: 'Ground054',
    warden: ['#9E9478', '#C4BA98', '#DDD5B8'],
    hollow: ['#7C7A80', '#9C99A2', '#B8B6BE'],
    contrast: 0.5,
  },
  {
    id: 'riverbed',
    channel: 'b',
    source: 'Ground054',
    warden: ['#2D5458', '#4F8A86', '#7FC4BC'], // toward river light #7FE3E0
    hollow: ['#2D4C5A', '#4D7E8A', '#7BB9C0'],
    contrast: 0.6,
  },
  {
    id: 'rock',
    channel: 'a',
    source: 'Rock030',
    warden: ['#6E6558', '#A2988A', '#CFC6B4'], // shadowed stone → Warden stone
    hollow: ['#34313A', '#4E4A56', '#76717E'], // Hollow iron → ash
    contrast: 0.8,
  },
];

/** World-space tiling: scene units per repeat of the detail atlas (two scales, mixed). */
export const DETAIL_TILE = { fine: 7, coarse: 29 } as const;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * CPU mirror of the shader's ramp lookup: luminance `l` (0..1) → gamma RGB.
 * l is first pushed away from or toward 0.5 by `contrast`.
 */
export function rampColor(ramp: Ramp, l: number, contrast = 1): [number, number, number] {
  const c = Math.min(1, Math.max(0, 0.5 + (l - 0.5) * contrast));
  const [a, b, d] = ramp.map(hexToRgb) as [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  const t = c < 0.5 ? c * 2 : c * 2 - 1;
  const lo = c < 0.5 ? a : b;
  const hi = c < 0.5 ? b : d;
  return [lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t];
}

/** Uniform names: one vec4 per ramp stop per biome per layer. */
export function rampUniformName(layer: number, biome: 'w' | 'h', stop: 0 | 1 | 2): string {
  return `tr${layer}${biome}${stop}`;
}
