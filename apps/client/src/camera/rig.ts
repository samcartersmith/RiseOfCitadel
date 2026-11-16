/**
 * Pure MOBA camera math: no Babylon, no DOM. `mobaCamera.ts` feeds it input
 * each frame and copies the result onto a Babylon camera.
 *
 * World convention: ground is the XZ plane, +x is screen-right and +z is
 * screen-up (north). The camera sits south of its focus point and looks north,
 * tilted down by `pitch` (measured from the horizontal). Yaw is fixed.
 *
 * Numbers and controls are specified in docs/design/camera.md.
 */

export interface Vec2 {
  x: number;
  z: number;
}

/** Map rectangle the focus point is clamped to (world units). */
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CameraConfig {
  bounds: Bounds;
  /** Pitch from the horizontal at max zoom-out, in degrees. */
  pitchDeg: number;
  /** Pitch at max zoom-in. Slightly flatter so heroes read better up close. */
  pitchZoomedInDeg: number;
  /** Vertical field of view in radians. */
  fov: number;
  minDistance: number;
  maxDistance: number;
  defaultDistance: number;
  /** Fraction of the current distance each wheel notch zooms by. */
  zoomStepFraction: number;
  /** Exponential smoothing rate (1/s) for zoom. */
  zoomSmoothing: number;
  /** Screen-edge band, in CSS pixels, that triggers edge pan. */
  edgeMarginPx: number;
  /** Edge pan speed (world units/s) at `defaultDistance`. Scales with zoom. */
  edgePanSpeed: number;
  /** Keyboard pan speed (world units/s) at `defaultDistance`. Scales with zoom. */
  keyPanSpeed: number;
  /** Rate (1/s) at which pan velocity approaches the requested velocity. */
  panAcceleration: number;
  /** Rate (1/s) at which pan velocity decays once input stops. */
  panDamping: number;
  /** Rate (1/s) for eased `focusOn` moves and hero follow. */
  focusSmoothing: number;
}

export const DEFAULT_BOUNDS: Bounds = { minX: -32, maxX: 32, minZ: -32, maxZ: 32 };

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  bounds: DEFAULT_BOUNDS,
  pitchDeg: 55,
  pitchZoomedInDeg: 50,
  fov: 0.8,
  minDistance: 28,
  maxDistance: 75,
  defaultDistance: 60,
  zoomStepFraction: 0.1,
  zoomSmoothing: 12,
  edgeMarginPx: 12,
  edgePanSpeed: 45,
  keyPanSpeed: 45,
  panAcceleration: 10,
  panDamping: 14,
  focusSmoothing: 10,
};

export interface CameraState {
  focus: Vec2;
  velocity: Vec2;
  distance: number;
  targetDistance: number;
  /** Eased destination for `focusOn`/follow; null when the player pans freely. */
  focusGoal: Vec2 | null;
}

/** Per-frame input, already merged from mouse, keyboard and edge pan. */
export interface CameraInput {
  /** Requested edge-pan direction in screen space (x right, z up), components in [-1, 1]. */
  edgePan: Vec2;
  /** Requested key-pan direction, same convention. */
  keyPan: Vec2;
  /** World-space focus offset from middle-mouse drag this frame (applied directly). */
  dragDelta: Vec2;
  /** Wheel notches this frame: positive zooms out, negative zooms in. */
  wheelSteps: number;
}

export const NO_INPUT: CameraInput = {
  edgePan: { x: 0, z: 0 },
  keyPan: { x: 0, z: 0 },
  dragDelta: { x: 0, z: 0 },
  wheelSteps: 0,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Frame-rate independent exponential approach of `current` to `target`. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

export function clampFocus(p: Vec2, b: Bounds): Vec2 {
  return { x: clamp(p.x, b.minX, b.maxX), z: clamp(p.z, b.minZ, b.maxZ) };
}

export function clampDistance(d: number, cfg: CameraConfig): number {
  return clamp(d, cfg.minDistance, cfg.maxDistance);
}

/** Pitch (radians from horizontal) for a given distance: flatter when zoomed in. */
export function pitchForDistance(distance: number, cfg: CameraConfig): number {
  const span = cfg.maxDistance - cfg.minDistance;
  const t = span > 0 ? clamp((distance - cfg.minDistance) / span, 0, 1) : 1;
  const deg = cfg.pitchZoomedInDeg + (cfg.pitchDeg - cfg.pitchZoomedInDeg) * t;
  return (deg * Math.PI) / 180;
}

/**
 * Edge-pan direction for a pointer at (px, py) in a `width`×`height` canvas
 * (y grows downward, like DOM coordinates). Returns screen-space x right / z up.
 * Diagonals are normalised so corners aren't faster than edges.
 */
export function edgePanDirection(
  px: number,
  py: number,
  width: number,
  height: number,
  marginPx: number,
): Vec2 {
  let x = 0;
  let z = 0;
  if (px <= marginPx) x = -1;
  else if (px >= width - 1 - marginPx) x = 1;
  if (py <= marginPx) z = 1;
  else if (py >= height - 1 - marginPx) z = -1;
  if (x !== 0 && z !== 0) {
    x *= Math.SQRT1_2;
    z *= Math.SQRT1_2;
  }
  return { x, z };
}

/** Normalise a direction to length ≤ 1. */
function capUnit(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.z);
  return len > 1 ? { x: v.x / len, z: v.z / len } : v;
}

/** World units covered by one CSS pixel at the focus point. */
export function worldPerPixel(distance: number, fov: number, viewportHeightPx: number): number {
  if (viewportHeightPx <= 0) return 0;
  return (2 * distance * Math.tan(fov / 2)) / viewportHeightPx;
}

/**
 * Convert a middle-mouse drag (CSS pixels, y down) into a focus offset. The
 * map follows the cursor ("grab" style), so the focus moves opposite the drag.
 * Vertical drags are stretched by 1/sin(pitch) because the ground is foreshortened.
 */
export function dragToWorld(
  dxPx: number,
  dyPx: number,
  distance: number,
  cfg: CameraConfig,
  viewportHeightPx: number,
): Vec2 {
  const k = worldPerPixel(distance, cfg.fov, viewportHeightPx);
  const pitch = pitchForDistance(distance, cfg);
  return { x: -dxPx * k, z: (dyPx * k) / Math.sin(pitch) };
}

/** Minimap jump: (0,0) is the minimap's top-left (north-west), (1,1) bottom-right. */
export function normalizedToWorld(u: number, v: number, b: Bounds): Vec2 {
  return {
    x: b.minX + clamp(u, 0, 1) * (b.maxX - b.minX),
    z: b.maxZ - clamp(v, 0, 1) * (b.maxZ - b.minZ),
  };
}

export function initialState(cfg: CameraConfig, focus: Vec2 = { x: 0, z: 0 }): CameraState {
  const d = clampDistance(cfg.defaultDistance, cfg);
  return {
    focus: clampFocus(focus, cfg.bounds),
    velocity: { x: 0, z: 0 },
    distance: d,
    targetDistance: d,
    focusGoal: null,
  };
}

function hasPan(v: Vec2) {
  return v.x !== 0 || v.z !== 0;
}

/** Advance the camera by `dt` seconds. Returns a new state; never mutates. */
export function stepCamera(
  state: CameraState,
  input: CameraInput,
  cfg: CameraConfig,
  dt: number,
): CameraState {
  dt = clamp(dt, 0, 0.1); // a stalled tab shouldn't fling the camera

  // Zoom: multiplicative steps on the target, then smooth the actual distance.
  let targetDistance = state.targetDistance;
  if (input.wheelSteps !== 0) {
    targetDistance *= Math.pow(1 + cfg.zoomStepFraction, input.wheelSteps);
  }
  targetDistance = clampDistance(targetDistance, cfg);
  const distance = clampDistance(damp(state.distance, targetDistance, cfg.zoomSmoothing, dt), cfg);

  // Pan: edge + keys give a desired velocity; the actual velocity eases toward it.
  const zoomScale = distance / cfg.defaultDistance;
  const edge = capUnit(input.edgePan);
  const keys = capUnit(input.keyPan);
  const desired = capUnit({ x: edge.x + keys.x, z: edge.z + keys.z });
  const speed = Math.max(hasPan(edge) ? cfg.edgePanSpeed : 0, hasPan(keys) ? cfg.keyPanSpeed : 0);
  const want = { x: desired.x * speed * zoomScale, z: desired.z * speed * zoomScale };
  const panning = hasPan(desired);
  const rate = panning ? cfg.panAcceleration : cfg.panDamping;
  const velocity = {
    x: damp(state.velocity.x, want.x, rate, dt),
    z: damp(state.velocity.z, want.z, rate, dt),
  };
  if (!panning && Math.hypot(velocity.x, velocity.z) < 1e-3) {
    velocity.x = 0;
    velocity.z = 0;
  }

  // Any manual pan cancels an eased jump / follow goal.
  const manual = panning || hasPan(input.dragDelta);
  let focusGoal = manual ? null : state.focusGoal;

  let focus: Vec2 = {
    x: state.focus.x + velocity.x * dt + input.dragDelta.x,
    z: state.focus.z + velocity.z * dt + input.dragDelta.z,
  };
  if (focusGoal) {
    focusGoal = clampFocus(focusGoal, cfg.bounds);
    focus = {
      x: damp(focus.x, focusGoal.x, cfg.focusSmoothing, dt),
      z: damp(focus.z, focusGoal.z, cfg.focusSmoothing, dt),
    };
  }

  const clamped = clampFocus(focus, cfg.bounds);
  // Hitting a wall kills velocity into it so the camera doesn't stick there.
  if (clamped.x !== focus.x) velocity.x = 0;
  if (clamped.z !== focus.z) velocity.z = 0;

  return { focus: clamped, velocity, distance, targetDistance, focusGoal };
}

/** Camera eye position and look-at target for a state. */
export function cameraPose(
  state: CameraState,
  cfg: CameraConfig,
): { position: [number, number, number]; target: [number, number, number]; pitch: number } {
  const pitch = pitchForDistance(state.distance, cfg);
  const { x, z } = state.focus;
  return {
    position: [x, state.distance * Math.sin(pitch), z - state.distance * Math.cos(pitch)],
    target: [x, 0, z],
    pitch,
  };
}
