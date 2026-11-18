/**
 * Tunable parameters of the Citadel toon shader and a CPU mirror of its
 * lighting ramp. Pure data (no Babylon) so tests, the sandbox and docs share
 * one source of defaults. See docs/design/toon-shader.md.
 */

export interface ToonParams {
  /** 2 = lit/shadow, 3 = lit/mid/shadow. */
  bands: 2 | 3;
  /** N·L (times the sun's shadow term) where the shadow band ends. */
  shadowThreshold: number;
  /** N·L where the lit band starts (3 bands only). */
  litThreshold: number;
  /** Half-width of the blend between bands (0 = hard cel edge). */
  bandSoftness: number;
  /** Sun contribution in the shadow band (0..1). */
  shadowLevel: number;
  /** Sun contribution in the middle band (0..1, 3 bands only). */
  midLevel: number;

  /** Hemispheric ambient, multiplied by the scene's hemispheric light intensity. */
  ambientSky: string;
  ambientGround: string;
  /** Extra multiplier on the ambient (the toon look keeps the shadow side readable). */
  ambientStrength: number;

  rimColor: string;
  /** 0 = off. Added on top of the lit colour. */
  rimIntensity: number;
  /** Fraction of the silhouette (in 1 − N·V) the rim covers. */
  rimWidth: number;
  rimSoftness: number;
  /** 0 = rim everywhere, 1 = rim only where the sun lights the surface. */
  rimLightInfluence: number;

  /** World Y where the height gradient is darkest (the feet). */
  heightBase: number;
  /** World units over which the gradient fades out. */
  heightRange: number;
  /** 0 = off, 1 = full `heightTint` at `heightBase`. */
  heightStrength: number;
  heightTint: string;

  /** 0 = original texture colours, 1 = fully gradient-mapped through the palette LUT. */
  paletteStrength: number;

  /** Team colour (hex) for masked texels, or null for no team tint. */
  teamColor: string | null;
  /** 0..1 blend of the team colour into masked texels. */
  teamStrength: number;
}

export const DEFAULT_TOON_PARAMS: Readonly<ToonParams> = {
  bands: 3,
  shadowThreshold: 0.12,
  litThreshold: 0.6,
  bandSoftness: 0.02,
  shadowLevel: 0.15,
  midLevel: 0.45,

  ambientSky: '#C9C2D6',
  ambientGround: '#5A4E66',
  ambientStrength: 0.85,

  rimColor: '#FFE9B8',
  rimIntensity: 0.8,
  rimWidth: 0.32,
  rimSoftness: 0.12,
  rimLightInfluence: 0.5,

  heightBase: 0,
  heightRange: 1.6,
  heightStrength: 0.35,
  heightTint: '#3E3350',

  paletteStrength: 0.25,

  teamColor: null,
  teamStrength: 1,
};

/** GLSL-style smoothstep. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

type RampParams = Pick<
  ToonParams,
  'bands' | 'shadowThreshold' | 'litThreshold' | 'bandSoftness' | 'shadowLevel' | 'midLevel'
>;

/**
 * Band thresholds as the shader receives them. Two-band mode collapses the
 * lit threshold onto the shadow threshold, so the middle band disappears.
 */
export function rampUniforms(p: RampParams): { t1: number; t2: number; mid: number } {
  const t1 = p.shadowThreshold;
  const t2 = p.bands === 2 ? t1 : Math.max(t1, p.litThreshold);
  return { t1, t2, mid: p.bands === 2 ? 1 : p.midLevel };
}

/**
 * Sun contribution for a given N·L × shadow value: the same maths as
 * `toonRamp` in the shader (kept in sync by `toonParams.test.ts`).
 */
export function toonRamp(x: number, p: RampParams): number {
  const { t1, t2, mid } = rampUniforms(p);
  const w = Math.max(p.bandSoftness, 1e-4);
  const b1 = smoothstep(t1 - w, t1 + w, x);
  const b2 = smoothstep(t2 - w, t2 + w, x);
  const r = p.shadowLevel + (mid - p.shadowLevel) * b1;
  return r + (1 - r) * b2;
}
