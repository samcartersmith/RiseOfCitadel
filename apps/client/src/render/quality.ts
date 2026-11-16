import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { Backend } from './engine';

export type QualityTier = 'high' | 'medium' | 'low';

export const QUALITY_TIERS: readonly QualityTier[] = ['high', 'medium', 'low'];

export interface TierSettings {
  /** Upper bound on devicePixelRatio we render at (retina phones would otherwise render 3x). */
  maxDevicePixelRatio: number;
  /** Extra resolution multiplier on top of the clamped DPR (< 1 renders below native). */
  renderScale: number;
  /** MSAA samples on the post-process input. 1 = off. */
  msaaSamples: number;
  fxaa: boolean;
  bloom: boolean;
  /** Multiplier for bloom weight, vignette and grading strength. 0 disables the pipeline. */
  postIntensity: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowCascades: number;
}

export const TIER_SETTINGS: Readonly<Record<QualityTier, TierSettings>> = {
  high: {
    maxDevicePixelRatio: 2,
    renderScale: 1,
    msaaSamples: 4,
    fxaa: true,
    bloom: true,
    postIntensity: 1,
    shadows: true,
    shadowMapSize: 2048,
    shadowCascades: 3,
  },
  medium: {
    maxDevicePixelRatio: 1.5,
    renderScale: 1,
    msaaSamples: 1,
    fxaa: true,
    bloom: true,
    postIntensity: 0.75,
    shadows: false,
    shadowMapSize: 0,
    shadowCascades: 0,
  },
  low: {
    maxDevicePixelRatio: 1,
    renderScale: 0.8,
    msaaSamples: 1,
    fxaa: false,
    bloom: false,
    // No post-process pipeline: tonemapping + grading run inside the material shaders.
    postIntensity: 0,
    shadows: false,
    shadowMapSize: 0,
    shadowCascades: 0,
  },
};

export function isQualityTier(value: unknown): value is QualityTier {
  return typeof value === 'string' && (QUALITY_TIERS as readonly string[]).includes(value);
}

export interface TierChoice {
  tier: QualityTier;
  /** Why this tier was picked, for the perf HUD and bug reports. */
  reason: string;
}

interface NavigatorHints {
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
}

/**
 * Picks the starting tier: `?tier=high|medium|low` wins, otherwise a coarse
 * auto-detect. M1-15 refines the heuristics with real device data.
 */
export function chooseTier(
  engine: AbstractEngine,
  backend: Backend,
  search: string = location.search,
): TierChoice {
  const forced = new URLSearchParams(search).get('tier');
  if (isQualityTier(forced)) return { tier: forced, reason: 'url' };

  const nav = navigator as Navigator & NavigatorHints;
  const mobile = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobi/i.test(nav.userAgent);
  if (mobile) return { tier: 'low', reason: 'mobile' };
  if (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) {
    return { tier: 'low', reason: `deviceMemory ${nav.deviceMemory}GB` };
  }

  const info = (engine as { getInfo?: () => { renderer: string } }).getInfo?.();
  const renderer = (info?.renderer ?? '').toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(renderer)) {
    return { tier: 'low', reason: 'software renderer' };
  }

  if (backend === 'webgpu') return { tier: 'high', reason: 'webgpu desktop' };
  return { tier: 'medium', reason: 'webgl2' };
}

/** Engine hardware scaling level for a tier (Babylon renders at canvasCSS / level). */
export function hardwareScalingFor(settings: TierSettings, dpr: number = devicePixelRatio): number {
  const effective = Math.min(dpr || 1, settings.maxDevicePixelRatio) * settings.renderScale;
  return 1 / effective;
}
