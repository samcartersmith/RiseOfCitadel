/**
 * Pure HP/mana bar math (fill, damage trail, layout). No Babylon; the
 * renderer in bars.ts packs these numbers into instance buffers.
 */

/** Fraction in [0, 1]; 0 when max is not positive or the value is NaN. */
export function barFill(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0;
  return value <= 0 ? 0 : value >= max ? 1 : value / max;
}

/**
 * The "damage taken" trail: a light segment between the current HP and where
 * HP was a moment ago. On damage it holds for `holdSeconds`, then drains toward
 * HP at `drainPerSecond` (fraction of the bar per second). Healing pulls it
 * along instantly, so it never sits below HP.
 */
export interface TrailState {
  /** Trail end as a bar fraction (always >= the HP fill). */
  value: number;
  /** Seconds left before it starts draining. */
  hold: number;
}

export interface TrailOptions {
  holdSeconds: number;
  drainPerSecond: number;
}

export const DEFAULT_TRAIL: TrailOptions = { holdSeconds: 0.45, drainPerSecond: 0.8 };

export function initialTrail(fill: number): TrailState {
  return { value: fill, hold: 0 };
}

export function stepTrail(
  prev: TrailState,
  prevFill: number,
  fill: number,
  dt: number,
  opts: TrailOptions = DEFAULT_TRAIL,
): TrailState {
  // Healed (or full): the trail rides on top of the fill.
  if (fill >= prev.value) return { value: fill, hold: 0 };
  let { value, hold } = prev;
  let drainTime = 0;
  if (fill < prevFill - 1e-6) {
    // Fresh damage this frame restarts the hold.
    hold = opts.holdSeconds;
  } else if (dt > 0) {
    // Only the part of dt after the hold runs out drains.
    const held = Math.min(hold, dt);
    hold -= held;
    drainTime = dt - held;
  }
  if (drainTime > 0) value = Math.max(fill, value - opts.drainPerSecond * drainTime);
  return { value, hold };
}

/** Bar sizes in CSS pixels (constant on screen at any zoom). */
export interface BarLayout {
  width: number;
  hpHeight: number;
  /** 0 = no mana row. */
  manaHeight: number;
  /** Gap between the bar's bottom edge and the anchor point, in pixels. */
  lift: number;
}

export const HERO_BAR: BarLayout = { width: 72, hpHeight: 8, manaHeight: 4, lift: 6 };
export const CREEP_BAR: BarLayout = { width: 44, hpHeight: 5, manaHeight: 0, lift: 4 };

export function barLayoutFor(isHero: boolean, hasMana: boolean): BarLayout {
  if (!isHero) return CREEP_BAR;
  return hasMana ? HERO_BAR : { ...HERO_BAR, manaHeight: 0 };
}

/** HP between chunk tick marks (heroes only). */
export const HP_PER_TICK = 100;

/**
 * Pixel spacing between tick marks for a bar, or 0 when ticks would be
 * denser than `minSpacingPx` (they'd turn into a grey smear, so we drop them).
 */
export function tickSpacingPx(
  maxHp: number,
  widthPx: number,
  hpPerTick = HP_PER_TICK,
  minSpacingPx = 2.5,
): number {
  if (!(maxHp > hpPerTick) || !(widthPx > 0)) return 0;
  const spacing = (widthPx * hpPerTick) / maxHp;
  return spacing >= minSpacingPx ? spacing : 0;
}

/** Tick positions as bar fractions (excluding 0 and 1), e.g. 250 max HP → [0.4, 0.8]. */
export function tickFractions(maxHp: number, hpPerTick = HP_PER_TICK): number[] {
  const out: number[] = [];
  if (!(maxHp > 0) || !(hpPerTick > 0)) return out;
  for (let hp = hpPerTick; hp < maxHp - 1e-9; hp += hpPerTick) out.push(hp / maxHp);
  return out;
}
