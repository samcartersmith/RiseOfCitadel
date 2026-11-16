/**
 * Pure view-side motion smoothing for UnitView: no Babylon, unit-tested.
 *
 * The sim (30 Hz) or the netcode hands us a target pose; the view eases toward
 * it every render frame so movement looks continuous at any frame rate. All
 * easing is frame-rate independent: `x = target + (x - target)·e^(-rate·dt)`.
 */

export interface Vec2 {
  x: number;
  z: number;
}

const TAU = Math.PI * 2;

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/** Signed shortest turn from `from` to `to`, in (-π, π]. */
export function shortestAngleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/**
 * Turn `current` toward `target` the short way round, at most `turnRate`
 * radians per second. `turnRate <= 0` or `Infinity` snaps. Result is wrapped
 * to (-π, π].
 */
export function stepFacing(current: number, target: number, dt: number, turnRate: number): number {
  if (!(turnRate > 0) || !Number.isFinite(turnRate)) return wrapAngle(target);
  if (dt <= 0) return wrapAngle(current);
  const delta = shortestAngleDelta(current, target);
  const max = turnRate * dt;
  if (Math.abs(delta) <= max) return wrapAngle(target);
  return wrapAngle(current + Math.sign(delta) * max);
}

/** Facing (radians, 0 = +z, +π/2 = +x) of a ground direction. Returns `fallback` for a zero vector. */
export function facingOf(dx: number, dz: number, fallback = 0): number {
  if (dx === 0 && dz === 0) return fallback;
  return Math.atan2(dx, dz);
}

export interface SmoothingOptions {
  /**
   * Exponential approach rate in 1/s. Higher is tighter. 0 (or less) disables
   * smoothing: the view sits exactly on the state every frame (use this once
   * M3's netcode does its own snapshot interpolation).
   */
  rate: number;
  /** A jump longer than this (world units) snaps instead of sliding (blink, teleport, respawn). */
  snapDistance: number;
}

export const DEFAULT_SMOOTHING: SmoothingOptions = { rate: 18, snapDistance: 6 };

/**
 * Ease `current` toward `target`. Snaps when `snap` is set, smoothing is off,
 * or the gap exceeds `snapDistance`. Returns a new object.
 */
export function smoothPosition(
  current: Vec2,
  target: Vec2,
  dt: number,
  opts: SmoothingOptions = DEFAULT_SMOOTHING,
  snap = false,
): Vec2 {
  const dx = target.x - current.x;
  const dz = target.z - current.z;
  if (snap || opts.rate <= 0 || dx * dx + dz * dz > opts.snapDistance * opts.snapDistance) {
    return { x: target.x, z: target.z };
  }
  if (dt <= 0) return { x: current.x, z: current.z };
  const k = Math.exp(-opts.rate * dt);
  const x = target.x - dx * k;
  const z = target.z - dz * k;
  // Settle exactly once we're visually there, so idle units stop "breathing".
  if (Math.abs(target.x - x) < 1e-4 && Math.abs(target.z - z) < 1e-4) {
    return { x: target.x, z: target.z };
  }
  return { x, z };
}
