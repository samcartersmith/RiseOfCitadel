import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SMOOTHING,
  facingOf,
  shortestAngleDelta,
  smoothPosition,
  stepFacing,
  wrapAngle,
} from './motion';

const PI = Math.PI;

describe('wrapAngle / shortestAngleDelta', () => {
  it('wraps into (-π, π]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(PI)).toBeCloseTo(PI);
    expect(wrapAngle(-PI)).toBeCloseTo(PI);
    expect(wrapAngle(3 * PI)).toBeCloseTo(PI);
    expect(wrapAngle(2 * PI + 0.5)).toBeCloseTo(0.5);
    expect(wrapAngle(-2 * PI - 0.5)).toBeCloseTo(-0.5);
  });

  it('turns the short way across the ±π seam', () => {
    // 170° → -170° is a 20° turn, not 340°.
    const d = shortestAngleDelta((170 * PI) / 180, (-170 * PI) / 180);
    expect(d).toBeCloseTo((20 * PI) / 180);
    expect(shortestAngleDelta((-170 * PI) / 180, (170 * PI) / 180)).toBeCloseTo((-20 * PI) / 180);
    expect(shortestAngleDelta(0.1, 0.1 + 4 * PI)).toBeCloseTo(0);
  });
});

describe('stepFacing', () => {
  it('turns at most turnRate·dt per step, the short way', () => {
    const from = (170 * PI) / 180;
    const to = (-170 * PI) / 180;
    const next = stepFacing(from, to, 0.01, 10); // max 0.1 rad
    expect(shortestAngleDelta(from, next)).toBeCloseTo(0.1);
  });

  it('lands exactly on the target when within reach', () => {
    expect(stepFacing(0, 0.05, 0.1, 10)).toBeCloseTo(0.05);
  });

  it('snaps when turnRate is 0 or infinite, and holds when dt is 0', () => {
    expect(stepFacing(0, 2, 0.016, 0)).toBeCloseTo(2);
    expect(stepFacing(0, 2, 0.016, Infinity)).toBeCloseTo(2);
    expect(stepFacing(1, 2, 0, 10)).toBeCloseTo(1);
  });

  it('converges over repeated frames', () => {
    let f = 0;
    for (let i = 0; i < 60; i++) f = stepFacing(f, -PI / 2, 1 / 60, 14);
    expect(f).toBeCloseTo(-PI / 2);
  });
});

describe('facingOf', () => {
  it('0 faces +z, +π/2 faces +x', () => {
    expect(facingOf(0, 1)).toBeCloseTo(0);
    expect(facingOf(1, 0)).toBeCloseTo(PI / 2);
    expect(facingOf(-1, 0)).toBeCloseTo(-PI / 2);
    expect(facingOf(0, 0, 1.25)).toBe(1.25);
  });
});

describe('smoothPosition', () => {
  const opts = { rate: 10, snapDistance: 5 };

  it('eases toward the target, frame-rate independently', () => {
    const a = smoothPosition({ x: 0, z: 0 }, { x: 1, z: 0 }, 0.1, opts);
    expect(a.x).toBeCloseTo(1 - Math.exp(-1));
    // Two half steps land in the same place as one full step.
    const half = smoothPosition({ x: 0, z: 0 }, { x: 1, z: 0 }, 0.05, opts);
    const b = smoothPosition(half, { x: 1, z: 0 }, 0.05, opts);
    expect(b.x).toBeCloseTo(a.x, 10);
  });

  it('snaps on request, past snapDistance, or with smoothing off', () => {
    expect(smoothPosition({ x: 0, z: 0 }, { x: 1, z: 1 }, 0.016, opts, true)).toEqual({
      x: 1,
      z: 1,
    });
    expect(smoothPosition({ x: 0, z: 0 }, { x: 4, z: 4 }, 0.016, opts)).toEqual({ x: 4, z: 4 });
    expect(
      smoothPosition({ x: 0, z: 0 }, { x: 1, z: 0 }, 0.016, { rate: 0, snapDistance: 5 }),
    ).toEqual({ x: 1, z: 0 });
  });

  it('settles exactly on the target instead of creeping forever', () => {
    let p = { x: 0, z: 0 };
    for (let i = 0; i < 120; i++) p = smoothPosition(p, { x: 2, z: -1 }, 1 / 60);
    expect(p).toEqual({ x: 2, z: -1 });
  });

  it('holds still for dt = 0 and never overshoots', () => {
    expect(smoothPosition({ x: 0, z: 0 }, { x: 1, z: 0 }, 0, opts)).toEqual({ x: 0, z: 0 });
    const p = smoothPosition({ x: 0, z: 0 }, { x: 1, z: 0 }, 10, DEFAULT_SMOOTHING);
    expect(p.x).toBeLessThanOrEqual(1);
  });
});
