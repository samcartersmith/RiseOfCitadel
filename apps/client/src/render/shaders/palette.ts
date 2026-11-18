/**
 * Palette data and the 1D gradient-map LUT for the Citadel toon shader.
 *
 * Pure TypeScript (no Babylon) so it can be unit-tested and reused by tools.
 * Colours are the art-direction palette (docs/design/art-direction.md §2.1) and
 * are treated as gamma-space sRGB, the same space StandardMaterial shades in.
 */

export type Rgb = readonly [r: number, g: number, b: number];

/** Team colours from art direction §2. */
export const TEAM_COLORS = {
  warden: '#E8B54A',
  hollow: '#8E5BD9',
} as const;

export type Team = keyof typeof TEAM_COLORS;

export function isTeam(value: unknown): value is Team {
  return value === 'warden' || value === 'hollow';
}

/** Parses `#RRGGBB` (or `RRGGBB`) into 0..1 floats. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`bad hex colour "${hex}"`);
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Perceived brightness of a gamma-space colour (Rec. 601 weights). The shader
 * uses the same weights to look a texel up in the LUT, so keep them in sync
 * with `toonShaderCode.ts`.
 */
export function luma([r, g, b]: Rgb): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export interface RampStop {
  color: string;
  /** Position 0..1 in the ramp. Defaults to the colour's own luma, which keeps values intact. */
  at?: number;
}

/**
 * Default gradient-map ramp, dark → light. It runs from cool Hollow tones in
 * the shadows to warm Warden tones in the highlights (iron → ash → bronze →
 * stone → hearth cream), the same split the post-process grade uses. Each stop
 * sits at its own luma, so remapping a texel keeps its value and only pulls its
 * hue and saturation toward the palette. Moss, river and team colours are left
 * out on purpose: a green or violet mid-tone would tint skin and metal.
 */
export const CITADEL_RAMP_STOPS: readonly RampStop[] = [
  { color: '#1B1A1F' }, // clear colour / deepest shadow
  { color: '#2E2B33' }, // Hollow iron
  { color: '#5E5A63' }, // Hollow ash
  { color: '#B07A3C' }, // Warden bronze
  { color: '#CFC6B4' }, // Warden stone
  { color: '#EFE6D2' }, // hearth cream (Lantern's scarf)
  { color: '#FFF8EA' }, // highlight
];

/** Default LUT width. 256 texels keeps 8-bit luma steps exact. */
export const PALETTE_LUT_SIZE = 256;

interface ResolvedStop {
  rgb: Rgb;
  at: number;
}

function resolveStops(stops: readonly RampStop[]): ResolvedStop[] {
  if (stops.length === 0) throw new Error('palette ramp needs at least one stop');
  return stops
    .map((s) => {
      const rgb = hexToRgb(s.color);
      return { rgb, at: Math.min(1, Math.max(0, s.at ?? luma(rgb))) };
    })
    .sort((a, b) => a.at - b.at);
}

/** Samples the ramp at `x` (0..1) with linear interpolation; flat beyond the end stops. */
export function sampleRamp(stops: readonly RampStop[], x: number): Rgb {
  return sampleResolved(resolveStops(stops), x);
}

function sampleResolved(stops: ResolvedStop[], x: number): Rgb {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (x <= first.at) return first.rgb;
  if (x >= last.at) return last.rgb;
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]!;
    if (x <= b.at) {
      const a = stops[i - 1]!;
      const t = b.at > a.at ? (x - a.at) / (b.at - a.at) : 1;
      return [
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t,
      ];
    }
  }
  return last.rgb;
}

/**
 * Builds the gradient-map LUT as RGBA8 texels (`size` × 1). Texel `i` holds
 * the ramp colour for luma `i / (size - 1)`; the shader samples it at the
 * base colour's luma.
 */
export function buildPaletteLut(
  stops: readonly RampStop[] = CITADEL_RAMP_STOPS,
  size: number = PALETTE_LUT_SIZE,
): Uint8Array {
  if (!Number.isInteger(size) || size < 2) throw new Error('LUT size must be an integer ≥ 2');
  const resolved = resolveStops(stops);
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const [r, g, b] = sampleResolved(resolved, i / (size - 1));
    data[i * 4] = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}
