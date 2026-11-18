/**
 * Projectile path math. Pure TypeScript so it is unit-tested in Node.
 *
 * Paths are a straight line from `from` to `to` plus a parabolic lift:
 * `lift(t) = 4 · arcHeight · t · (1 - t)`, which is 0 at both ends and exactly
 * `arcHeight` at the midpoint. `arcHeight = 0` is a straight shot.
 */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface MutableVec3 extends Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Writes the point at parameter `t` (0..1, clamped) into `out` and returns it. */
export function arcPoint<T extends MutableVec3>(
  from: Vec3Like,
  to: Vec3Like,
  arcHeight: number,
  t: number,
  out: T,
): T {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = from.x + (to.x - from.x) * u;
  out.y = from.y + (to.y - from.y) * u + 4 * arcHeight * u * (1 - u);
  out.z = from.z + (to.z - from.z) * u;
  return out;
}

/** Derivative of the path with respect to `t` (not normalised): the travel direction. */
export function arcTangent<T extends MutableVec3>(
  from: Vec3Like,
  to: Vec3Like,
  arcHeight: number,
  t: number,
  out: T,
): T {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = to.x - from.x;
  out.y = to.y - from.y + 4 * arcHeight * (1 - 2 * u);
  out.z = to.z - from.z;
  return out;
}

/**
 * Arc length, approximated with `segments` chords. Exact for straight paths;
 * within 0.1% of the true parabola length for 16 segments at sane heights.
 */
export function arcLength(from: Vec3Like, to: Vec3Like, arcHeight: number, segments = 16): number {
  if (arcHeight === 0) {
    return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  }
  let length = 0;
  let px = from.x;
  let py = from.y;
  let pz = from.z;
  const p = { x: 0, y: 0, z: 0 };
  for (let i = 1; i <= segments; i++) {
    arcPoint(from, to, arcHeight, i / segments, p);
    length += Math.hypot(p.x - px, p.y - py, p.z - pz);
    px = p.x;
    py = p.y;
    pz = p.z;
  }
  return length;
}

/** Seconds to travel the path at `speed` world units per second (along the curve). */
export function travelTime(from: Vec3Like, to: Vec3Like, arcHeight: number, speed: number): number {
  if (speed <= 0) return Number.POSITIVE_INFINITY;
  return arcLength(from, to, arcHeight) / speed;
}

/**
 * Yaw (rotation about +Y, radians) that turns local +Z toward the direction
 * (x, z). Matches Babylon's left-handed `RotationY`: yaw 0 faces +Z, π/2 faces +X.
 */
export function yawFromDirection(x: number, z: number): number {
  return Math.atan2(x, z);
}
