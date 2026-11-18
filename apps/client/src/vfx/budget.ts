/**
 * Per-tier VFX budgets. Pure TypeScript.
 *
 * The tier itself comes from the render quality controller (render/tiers.ts,
 * read-only here). VFX only scale particle *counts*; sizes, timings and decals
 * are identical on every tier so gameplay reads the same everywhere.
 */
import type { QualityTier } from '../render/quality';

export interface VfxTierBudget {
  /** Multiplier on every preset's burst count and emit rate. */
  particleScale: number;
  /** Most rigs of one preset alive at once; the oldest is recycled past this. */
  maxRigsPerPreset: number;
}

export const VFX_BUDGETS: Readonly<Record<QualityTier, VfxTierBudget>> = {
  high: { particleScale: 1, maxRigsPerPreset: 24 },
  medium: { particleScale: 0.7, maxRigsPerPreset: 24 },
  low: { particleScale: 0.5, maxRigsPerPreset: 24 },
};

/** Most telegraph decals of one shape visible at once (thin-instance buffer size). */
export const MAX_TELEGRAPHS_PER_SHAPE = 48;
/** Most visual projectiles in flight at once. */
export const MAX_PROJECTILES = 64;

/** A base (High tier) particle count scaled for `tier`. Never below `min`. */
export function scaledCount(base: number, tier: QualityTier, min = 1): number {
  if (base <= 0) return 0;
  return Math.max(min, Math.round(base * VFX_BUDGETS[tier].particleScale));
}

/** A base (High tier) emit rate scaled for `tier` (particles per second). */
export function scaledRate(base: number, tier: QualityTier): number {
  return base * VFX_BUDGETS[tier].particleScale;
}
