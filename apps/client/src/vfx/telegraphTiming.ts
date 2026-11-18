/**
 * Telegraph timing: how a ground decal fades in, fills up, flashes, holds and
 * fades out. Pure TypeScript so it is unit-tested in Node.
 *
 * Timeline (seconds since the telegraph was placed):
 *
 *   0 ── fadeIn ──►            alpha 0 → 1
 *   0 ────────── fillTime ──►  fill 0 → 1 (linear, so players can read the timing)
 *                fillTime ── flash ──►  flash 1 → 0 (the "it lands now" pop)
 *                fillTime ── hold ──►   stays fully filled (Infinity = until stopped)
 *                       holdEnd ── fadeOut ──► alpha 1 → 0, then done
 *
 * `fillTime = 0` is an instant indicator: fill is 1 immediately and there is no flash.
 */
export interface TelegraphTiming {
  fadeIn: number;
  fillTime: number;
  flash: number;
  /** Seconds to stay up after filling. Infinity keeps it up until stopped. */
  hold: number;
  fadeOut: number;
}

export const DEFAULT_TIMING: Readonly<TelegraphTiming> = {
  fadeIn: 0.08,
  fillTime: 0,
  flash: 0.18,
  hold: 0,
  fadeOut: 0.25,
};

export type TelegraphPhase = 'filling' | 'hold' | 'fadeOut' | 'done';

export interface TelegraphFrame {
  /** 0..1 fill progress (scale of the inner fill decal). */
  fill: number;
  /** 0..1 overall opacity multiplier. */
  alpha: number;
  /** 0..1 brightness pop right after the fill completes. */
  flash: number;
  phase: TelegraphPhase;
}

export function makeTiming(partial: Partial<TelegraphTiming> = {}): TelegraphTiming {
  return { ...DEFAULT_TIMING, ...partial };
}

/** When the telegraph stops holding and starts fading (Infinity while it holds forever). */
export function holdEnd(timing: TelegraphTiming, stoppedAt?: number): number {
  const natural = timing.fillTime + timing.hold;
  return stoppedAt === undefined ? natural : Math.min(natural, Math.max(0, stoppedAt));
}

/** Total lifetime in seconds (Infinity while it holds forever and hasn't been stopped). */
export function totalDuration(timing: TelegraphTiming, stoppedAt?: number): number {
  return holdEnd(timing, stoppedAt) + timing.fadeOut;
}

/**
 * Evaluates the telegraph at time `t`. `stoppedAt` (seconds) ends the hold
 * early, e.g. when the cast is cancelled; the decal then fades out from there.
 * Writes into `out` when given, so the per-frame update allocates nothing.
 */
export function telegraphFrame(
  t: number,
  timing: TelegraphTiming,
  stoppedAt?: number,
  out: TelegraphFrame = { fill: 0, alpha: 0, flash: 0, phase: 'filling' },
): TelegraphFrame {
  const fillTime = Math.max(0, timing.fillTime);
  const end = holdEnd(timing, stoppedAt);
  const fadeOut = Math.max(0, timing.fadeOut);

  out.fill = fillTime > 0 ? clamp01(t / fillTime) : 1;

  let alpha = timing.fadeIn > 0 ? clamp01(t / timing.fadeIn) : 1;
  if (t >= end) alpha *= fadeOut > 0 ? 1 - clamp01((t - end) / fadeOut) : 0;
  out.alpha = alpha;

  const sinceFilled = t - fillTime;
  out.flash =
    fillTime > 0 && timing.flash > 0 && sinceFilled >= 0 && sinceFilled < timing.flash
      ? 1 - sinceFilled / timing.flash
      : 0;

  if (t >= end + fadeOut) out.phase = 'done';
  else if (t >= end) out.phase = 'fadeOut';
  else if (t < fillTime) out.phase = 'filling';
  else out.phase = 'hold';
  if (out.phase === 'done') out.alpha = 0;
  return out;
}

/**
 * Edge pulse multiplier (1 = steady). The pulse quickens as the fill nears
 * completion so "about to land" reads even in peripheral vision.
 */
export function pulseFactor(t: number, amplitude: number, fill: number): number {
  if (amplitude <= 0) return 1;
  const hz = 1.5 + 3 * clamp01(fill);
  return 1 - amplitude * 0.5 * (1 + Math.sin(2 * Math.PI * hz * t));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
