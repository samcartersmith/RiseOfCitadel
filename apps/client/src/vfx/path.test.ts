import { describe, expect, it } from 'vitest';
import { arcLength, arcPoint, arcTangent, travelTime, yawFromDirection } from './path';

const from = { x: 0, y: 1, z: 0 };
const to = { x: 10, y: 1, z: 0 };
const p = () => ({ x: 0, y: 0, z: 0 });

describe('arc path', () => {
  it('starts and ends exactly at the endpoints', () => {
    expect(arcPoint(from, to, 3, 0, p())).toEqual(from);
    expect(arcPoint(from, to, 3, 1, p())).toEqual(to);
  });

  it('peaks at arcHeight above the chord at the midpoint', () => {
    const mid = arcPoint(from, to, 3, 0.5, p());
    expect(mid.x).toBeCloseTo(5);
    expect(mid.y).toBeCloseTo(4);
  });

  it('is a straight line when arcHeight is 0', () => {
    const q = arcPoint({ x: 0, y: 0, z: 0 }, { x: 4, y: 2, z: -8 }, 0, 0.25, p());
    expect(q).toEqual({ x: 1, y: 0.5, z: -2 });
  });

  it('clamps t outside 0..1', () => {
    expect(arcPoint(from, to, 3, -1, p())).toEqual(from);
    expect(arcPoint(from, to, 3, 2, p())).toEqual(to);
  });

  it('tangent points up at the start, level at the top, down at the end', () => {
    expect(arcTangent(from, to, 3, 0, p()).y).toBeGreaterThan(0);
    expect(arcTangent(from, to, 3, 0.5, p()).y).toBeCloseTo(0);
    expect(arcTangent(from, to, 3, 1, p()).y).toBeLessThan(0);
  });

  it('straight length is the distance; arcs are longer', () => {
    expect(arcLength(from, to, 0)).toBeCloseTo(10);
    const arced = arcLength(from, to, 3);
    expect(arced).toBeGreaterThan(10);
    // Closed form for a parabola with span 10 and height 3 is ≈ 12.04.
    expect(arced).toBeCloseTo(12.04, 1);
  });

  it('travel time is length / speed', () => {
    expect(travelTime(from, to, 0, 5)).toBeCloseTo(2);
    expect(travelTime(from, to, 0, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('yaw 0 faces +Z and π/2 faces +X (Babylon left-handed RotationY)', () => {
    expect(yawFromDirection(0, 1)).toBeCloseTo(0);
    expect(yawFromDirection(1, 0)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(yawFromDirection(0, -1))).toBeCloseTo(Math.PI);
  });
});
