import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { getBindings, type InputBindings } from '../input/bindings';
import { DoubleTap, KeyboardState } from '../input/keys';
import {
  DEFAULT_CAMERA_CONFIG,
  NO_INPUT,
  cameraPose,
  clampFocus,
  dragToWorld,
  edgePanDirection,
  initialState,
  normalizedToWorld,
  stepCamera,
  type Bounds,
  type CameraConfig,
  type CameraInput,
  type CameraState,
  type Vec2,
} from './rig';

/** Something with a ground position; Babylon's Vector3 fits. */
export type TargetPoint = Vec2 | { x: number; y?: number; z: number };
export type TargetGetter = () => TargetPoint | null | undefined;

export interface CameraDebugState {
  focus: Vec2;
  distance: number;
  targetDistance: number;
  pitchDeg: number;
  following: boolean;
  bounds: Bounds;
  minDistance: number;
  maxDistance: number;
}

export interface MobaCamera {
  readonly camera: TargetCamera;
  /** Move the focus to a ground point, eased unless `instant`. Stops a hero lock. */
  focusOn(point: TargetPoint, opts?: { instant?: boolean }): void;
  /**
   * Set the hero the camera recenters on (Space). By default this also locks
   * the camera onto it until the player pans; pass `{ lock: false }` to only
   * register the target. `null` clears it (Space then centers on the origin).
   */
  follow(getTarget: TargetGetter | null, opts?: { lock?: boolean }): void;
  /** Minimap jump: (0,0) = top-left / north-west of the map, (1,1) = bottom-right. */
  jumpTo(normalized: { x: number; y: number }, opts?: { instant?: boolean }): void;
  setBounds(bounds: Bounds): void;
  getState(): CameraDebugState;
  dispose(): void;
}

const registry = new WeakMap<Scene, MobaCamera>();

/** The MOBA camera created for `scene`, if any. */
export function getMobaCamera(scene: Scene): MobaCamera | undefined {
  return registry.get(scene);
}

const ORIGIN: Vec2 = { x: 0, z: 0 };

/**
 * Classic angled RTS/MOBA camera: fixed yaw, ~55° pitch, edge/keyboard/
 * middle-drag pan, wheel zoom, map bounds, hero lock and minimap jump.
 * All math lives in `rig.ts`; this file only wires DOM input and Babylon.
 */
export function createMobaCamera(
  scene: Scene,
  overrides: Partial<CameraConfig> = {},
  bindings: InputBindings = getBindings(),
): MobaCamera {
  const cfg: CameraConfig = { ...DEFAULT_CAMERA_CONFIG, ...overrides };
  const engine = scene.getEngine();
  const canvas = engine.getRenderingCanvas();
  let state: CameraState = initialState(cfg);

  const camera = new TargetCamera('moba-camera', Vector3.Zero(), scene);
  camera.fov = cfg.fov;
  camera.minZ = 0.5;
  camera.maxZ = 600;
  const apply = () => {
    const pose = cameraPose(state, cfg);
    camera.position.set(...pose.position);
    camera.setTarget(new Vector3(...pose.target));
  };
  apply();

  // --- Input state -----------------------------------------------------------
  const keys = new KeyboardState(window);
  const spaceTap = new DoubleTap(300);
  const cleanup: (() => void)[] = [() => keys.dispose()];
  const on = <K extends keyof HTMLElementEventMap>(
    el: HTMLElement | Window,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ) => {
    el.addEventListener(type, fn as EventListener, opts);
    cleanup.push(() => el.removeEventListener(type, fn as EventListener, opts));
  };

  let windowFocused = typeof document !== 'undefined' ? document.hasFocus() : true;
  let pointerInside = false;
  let pointer = { x: 0, y: 0 };
  let dragging: { id: number; x: number; y: number } | null = null;
  let pendingDrag = { x: 0, y: 0 };
  let pendingWheel = 0;

  let getTarget: TargetGetter | null = null;
  let locked = false;

  on(window, 'focus', () => (windowFocused = true));
  on(window, 'blur', () => {
    windowFocused = false;
    pointerInside = false;
  });

  if (canvas) {
    on(canvas, 'pointerenter', (e) => {
      pointerInside = true;
      pointer = { x: e.offsetX, y: e.offsetY };
    });
    on(canvas, 'pointerleave', () => (pointerInside = false));
    on(canvas, 'pointermove', (e) => {
      pointerInside = true;
      pointer = { x: e.offsetX, y: e.offsetY };
      if (dragging && e.pointerId === dragging.id) {
        pendingDrag.x += e.clientX - dragging.x;
        pendingDrag.y += e.clientY - dragging.y;
        dragging.x = e.clientX;
        dragging.y = e.clientY;
      }
    });
    on(canvas, 'pointerdown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault(); // no autoscroll cursor
      dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture?.(e.pointerId);
    });
    const endDrag = (e: PointerEvent) => {
      if (dragging && e.pointerId === dragging.id) {
        dragging = null;
        canvas.releasePointerCapture?.(e.pointerId);
      }
    };
    on(canvas, 'pointerup', endDrag);
    on(canvas, 'pointercancel', endDrag);
    on(canvas, 'mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    on(
      canvas,
      'wheel',
      (e) => {
        e.preventDefault();
        // Normalise: pixel mode ≈ 100px per notch, line mode ≈ 3 lines per notch.
        const notches =
          e.deltaMode === 1 ? e.deltaY / 3 : e.deltaMode === 2 ? e.deltaY : e.deltaY / 100;
        pendingWheel += Math.max(-3, Math.min(3, notches));
      },
      { passive: false },
    );
  }

  const heroPoint = (): Vec2 => {
    const t = getTarget?.();
    return t ? { x: t.x, z: t.z } : ORIGIN;
  };

  keys.onPress((code, e) => {
    if (!bindings.matches('cameraCenterHero', code)) return;
    e.preventDefault(); // Space would otherwise scroll / click focused buttons
    if (spaceTap.tap(performance.now())) {
      locked = true; // double tap: stay locked on the hero
    }
    state = { ...state, focus: clampFocus(heroPoint(), cfg.bounds), focusGoal: null };
    state.velocity = { x: 0, z: 0 };
  });

  // --- Per-frame update ------------------------------------------------------
  const readInput = (): CameraInput => {
    const input: CameraInput = {
      edgePan: { ...NO_INPUT.edgePan },
      keyPan: { ...NO_INPUT.keyPan },
      dragDelta: { ...NO_INPUT.dragDelta },
      wheelSteps: pendingWheel,
    };
    pendingWheel = 0;

    if (canvas && windowFocused && pointerInside && !dragging) {
      input.edgePan = edgePanDirection(
        pointer.x,
        pointer.y,
        canvas.clientWidth,
        canvas.clientHeight,
        cfg.edgeMarginPx,
      );
    }
    const b = bindings;
    input.keyPan = {
      x:
        (keys.anyDown(b.get('cameraPanRight')) ? 1 : 0) -
        (keys.anyDown(b.get('cameraPanLeft')) ? 1 : 0),
      z:
        (keys.anyDown(b.get('cameraPanUp')) ? 1 : 0) -
        (keys.anyDown(b.get('cameraPanDown')) ? 1 : 0),
    };
    if (canvas && (pendingDrag.x !== 0 || pendingDrag.y !== 0)) {
      input.dragDelta = dragToWorld(
        pendingDrag.x,
        pendingDrag.y,
        state.distance,
        cfg,
        canvas.clientHeight,
      );
    }
    pendingDrag = { x: 0, y: 0 };
    return input;
  };

  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    const holdingCenter = keys.anyDown(bindings.get('cameraCenterHero'));
    if (locked && getTarget) state.focusGoal = heroPoint();
    state = stepCamera(state, readInput(), cfg, dt);
    if (locked && state.focusGoal === null) locked = false; // the player panned away
    if (holdingCenter) {
      // Holding the center key keeps the hero pinned to the middle of the screen.
      state = { ...state, focus: clampFocus(heroPoint(), cfg.bounds), velocity: { x: 0, z: 0 } };
    }
    apply();
  });
  cleanup.push(() => scene.onBeforeRenderObservable.remove(observer));

  const api: MobaCamera = {
    camera,
    focusOn(point, opts) {
      locked = false;
      const p = clampFocus({ x: point.x, z: point.z }, cfg.bounds);
      state = opts?.instant
        ? { ...state, focus: p, focusGoal: null, velocity: { x: 0, z: 0 } }
        : { ...state, focusGoal: p };
      if (opts?.instant) apply();
    },
    follow(next, opts) {
      getTarget = next;
      locked = next !== null && (opts?.lock ?? true);
    },
    jumpTo(n, opts) {
      api.focusOn(normalizedToWorld(n.x, n.y, cfg.bounds), { instant: opts?.instant ?? true });
    },
    setBounds(bounds) {
      cfg.bounds = { ...bounds };
      state = { ...state, focus: clampFocus(state.focus, cfg.bounds) };
    },
    getState() {
      const pose = cameraPose(state, cfg);
      return {
        focus: { ...state.focus },
        distance: state.distance,
        targetDistance: state.targetDistance,
        pitchDeg: (pose.pitch * 180) / Math.PI,
        following: locked,
        bounds: { ...cfg.bounds },
        minDistance: cfg.minDistance,
        maxDistance: cfg.maxDistance,
      };
    },
    dispose() {
      for (const fn of cleanup) fn();
      registry.delete(scene);
      camera.dispose();
    },
  };
  registry.set(scene, api);
  return api;
}
