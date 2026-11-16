import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMERA_CONFIG as CFG,
  NO_INPUT,
  cameraPose,
  clampFocus,
  damp,
  dragToWorld,
  edgePanDirection,
  initialState,
  normalizedToWorld,
  pitchForDistance,
  stepCamera,
  type CameraInput,
  type CameraState,
} from './rig';

const DT = 1 / 60;
const input = (over: Partial<CameraInput>): CameraInput => ({ ...NO_INPUT, ...over });
function run(state: CameraState, inp: CameraInput, seconds: number): CameraState {
  for (let t = 0; t < seconds; t += DT) state = stepCamera(state, inp, CFG, DT);
  return state;
}

describe('bounds clamping', () => {
  it('clamps a point to the map rectangle', () => {
    expect(clampFocus({ x: 100, z: -100 }, CFG.bounds)).toEqual({ x: 32, z: -32 });
    expect(clampFocus({ x: 3, z: 4 }, CFG.bounds)).toEqual({ x: 3, z: 4 });
  });

  it('never lets panning push the focus outside bounds', () => {
    let s = initialState(CFG);
    for (const dir of [
      { x: 1, z: 0 },
      { x: 0, z: 1 },
      { x: -1, z: -1 },
    ]) {
      for (let i = 0; i < 600; i++) {
        s = stepCamera(s, input({ edgePan: dir, keyPan: dir }), CFG, DT);
        expect(s.focus.x).toBeGreaterThanOrEqual(CFG.bounds.minX);
        expect(s.focus.x).toBeLessThanOrEqual(CFG.bounds.maxX);
        expect(s.focus.z).toBeGreaterThanOrEqual(CFG.bounds.minZ);
        expect(s.focus.z).toBeLessThanOrEqual(CFG.bounds.maxZ);
      }
    }
    expect(s.focus).toEqual({ x: CFG.bounds.minX, z: CFG.bounds.minZ });
  });

  it('clamps drag deltas and eased goals too', () => {
    let s = initialState(CFG);
    s = stepCamera(s, input({ dragDelta: { x: 500, z: 0 } }), CFG, DT);
    expect(s.focus.x).toBe(CFG.bounds.maxX);
    s = run({ ...s, focusGoal: { x: -999, z: 999 } }, NO_INPUT, 3);
    expect(s.focus.x).toBeCloseTo(CFG.bounds.minX, 3);
    expect(s.focus.z).toBeCloseTo(CFG.bounds.maxZ, 3);
  });

  it('kills velocity into a wall so the camera leaves it immediately', () => {
    let s = run(initialState(CFG), input({ keyPan: { x: 1, z: 0 } }), 3);
    expect(s.focus.x).toBe(CFG.bounds.maxX);
    expect(s.velocity.x).toBe(0);
    s = stepCamera(s, input({ keyPan: { x: -1, z: 0 } }), CFG, DT);
    expect(s.focus.x).toBeLessThan(CFG.bounds.maxX);
  });
});

describe('zoom limits', () => {
  it('stays within [min, max] however far the wheel goes', () => {
    let s = initialState(CFG);
    s = run(s, input({ wheelSteps: -50 }), 1);
    expect(s.targetDistance).toBe(CFG.minDistance);
    expect(s.distance).toBeGreaterThanOrEqual(CFG.minDistance);
    expect(s.distance).toBeCloseTo(CFG.minDistance, 3);
    s = run(s, input({ wheelSteps: 50 }), 1);
    expect(s.targetDistance).toBe(CFG.maxDistance);
    expect(s.distance).toBeLessThanOrEqual(CFG.maxDistance);
    expect(s.distance).toBeCloseTo(CFG.maxDistance, 3);
  });

  it('one notch changes the target by zoomStepFraction and the distance eases there', () => {
    let s = initialState(CFG);
    s = stepCamera(s, input({ wheelSteps: -1 }), CFG, DT);
    expect(s.targetDistance).toBeCloseTo(CFG.defaultDistance / (1 + CFG.zoomStepFraction), 6);
    expect(s.distance).toBeLessThan(CFG.defaultDistance);
    expect(s.distance).toBeGreaterThan(s.targetDistance);
  });

  it('pitch flattens slightly when zoomed in', () => {
    const far = pitchForDistance(CFG.maxDistance, CFG);
    const near = pitchForDistance(CFG.minDistance, CFG);
    expect((far * 180) / Math.PI).toBeCloseTo(CFG.pitchDeg, 6);
    expect((near * 180) / Math.PI).toBeCloseTo(CFG.pitchZoomedInDeg, 6);
    expect(near).toBeLessThan(far);
  });
});

describe('edge pan direction', () => {
  const W = 1280;
  const H = 720;
  const M = CFG.edgeMarginPx;
  it('maps each screen edge to the right world direction', () => {
    expect(edgePanDirection(W - 1, H / 2, W, H, M)).toEqual({ x: 1, z: 0 });
    expect(edgePanDirection(0, H / 2, W, H, M)).toEqual({ x: -1, z: 0 });
    expect(edgePanDirection(W / 2, 0, W, H, M)).toEqual({ x: 0, z: 1 }); // top = north
    expect(edgePanDirection(W / 2, H - 1, W, H, M)).toEqual({ x: 0, z: -1 });
  });

  it('does nothing in the middle and normalises corners', () => {
    expect(edgePanDirection(W / 2, H / 2, W, H, M)).toEqual({ x: 0, z: 0 });
    expect(edgePanDirection(M + 1, M + 1, W, H, M)).toEqual({ x: 0, z: 0 });
    const c = edgePanDirection(W - 1, 0, W, H, M);
    expect(Math.hypot(c.x, c.z)).toBeCloseTo(1, 9);
    expect(c.x).toBeGreaterThan(0);
    expect(c.z).toBeGreaterThan(0);
  });

  it('right-edge pan moves focus +x, scaled by zoom', () => {
    const near = run(
      { ...initialState(CFG), distance: CFG.minDistance, targetDistance: CFG.minDistance },
      input({ edgePan: { x: 1, z: 0 } }),
      0.25,
    );
    const far = run(initialState(CFG), input({ edgePan: { x: 1, z: 0 } }), 0.25);
    expect(near.focus.x).toBeGreaterThan(0);
    expect(far.focus.x).toBeGreaterThan(near.focus.x);
    expect(far.focus.z).toBe(0);
  });
});

describe('damping convergence', () => {
  it('damp is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 10, 5, 1 / 60);
    let b = 0;
    for (let i = 0; i < 240; i++) b = damp(b, 10, 5, 1 / 240);
    expect(a).toBeCloseTo(b, 6);
    expect(damp(0, 10, 5, 100)).toBeCloseTo(10, 9);
  });

  it('pan accelerates to full speed, then coasts to a stop', () => {
    let s = initialState(CFG);
    s = stepCamera(s, input({ keyPan: { x: 0, z: 1 } }), CFG, DT);
    const firstFrameSpeed = s.velocity.z;
    expect(firstFrameSpeed).toBeGreaterThan(0);
    expect(firstFrameSpeed).toBeLessThan(CFG.keyPanSpeed * 0.5); // smooth start
    s = run(s, input({ keyPan: { x: 0, z: 1 } }), 0.6);
    expect(s.velocity.z).toBeCloseTo(CFG.keyPanSpeed, 0);
    const released = s.focus.z;
    s = run(s, NO_INPUT, 1);
    expect(s.velocity).toEqual({ x: 0, z: 0 });
    expect(s.focus.z).toBeGreaterThan(released); // it glided a little
    const settled = s.focus.z;
    s = run(s, NO_INPUT, 1);
    expect(s.focus.z).toBe(settled);
  });

  it('eased focusOn converges, and manual pan cancels it', () => {
    let s: CameraState = { ...initialState(CFG), focusGoal: { x: 10, z: -5 } };
    s = run(s, NO_INPUT, 2);
    expect(s.focus.x).toBeCloseTo(10, 3);
    expect(s.focus.z).toBeCloseTo(-5, 3);
    s = { ...s, focusGoal: { x: -20, z: 0 } };
    s = stepCamera(s, input({ edgePan: { x: 1, z: 0 } }), CFG, DT);
    expect(s.focusGoal).toBeNull();
  });

  it('a long frame is capped so a stalled tab does not fling the camera', () => {
    const s = stepCamera(initialState(CFG), input({ keyPan: { x: 1, z: 0 } }), CFG, 5);
    expect(s.focus.x).toBeLessThan(CFG.keyPanSpeed * 0.1 + 1e-9);
  });
});

describe('helpers', () => {
  it('minimap jump maps normalized coords with north at the top', () => {
    expect(normalizedToWorld(0, 0, CFG.bounds)).toEqual({ x: -32, z: 32 });
    expect(normalizedToWorld(1, 1, CFG.bounds)).toEqual({ x: 32, z: -32 });
    expect(normalizedToWorld(0.5, 0.5, CFG.bounds)).toEqual({ x: 0, z: 0 });
    expect(normalizedToWorld(-1, 2, CFG.bounds)).toEqual({ x: -32, z: -32 });
  });

  it('drag grabs the map: dragging right moves focus -x, dragging down moves it +z', () => {
    const d = dragToWorld(100, 50, CFG.defaultDistance, CFG, 720);
    expect(d.x).toBeLessThan(0);
    expect(d.z).toBeGreaterThan(0);
  });

  it('camera sits south of and above the focus at the configured pitch', () => {
    const s = initialState(CFG, { x: 5, z: 5 });
    const { position, target, pitch } = cameraPose(s, CFG);
    expect(target).toEqual([5, 0, 5]);
    expect(position[0]).toBe(5);
    expect(position[2]).toBeLessThan(5);
    const dy = position[1];
    const dz = 5 - position[2];
    expect(Math.atan2(dy, dz)).toBeCloseTo(pitch, 9);
    expect(Math.hypot(dy, dz)).toBeCloseTo(CFG.defaultDistance, 9);
  });
});
