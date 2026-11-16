# MOBA camera (M1-03)

Classic angled RTS/MOBA camera: fixed yaw, fixed pitch, looking at a point on the ground. The camera sits south of its focus and looks north, so **screen-right is +x and screen-up is +z**.

Code:

- `apps/client/src/camera/rig.ts`: pure pan/zoom/bounds math, no Babylon or DOM. Unit tested in `rig.test.ts`.
- `apps/client/src/camera/mobaCamera.ts`: drives a Babylon `TargetCamera` from DOM input. Created in `render/scene.ts`, found with `getMobaCamera(scene)`.
- `apps/client/src/input/bindings.ts`: rebindable action → key map (`KeyboardEvent.code`), saved to localStorage under `citadel.bindings.v1`.
- `apps/client/src/input/keys.ts`: held-key tracking and the double-tap detector.

## Numbers

All live in `DEFAULT_CAMERA_CONFIG` and can be overridden per scene. These are first-pass values for the 64×64 placeholder map. Retune once M1-04/M1-05 land the real map and heroes are at their final scale.

| Setting | Value | Notes |
|---|---|---|
| Pitch (zoomed out) | **55°** from horizontal | |
| Pitch (zoomed in) | **50°** | Eased linearly with distance, so close-ups are slightly flatter |
| Yaw | fixed, looking north (+z) | No rotation control |
| Field of view | 0.8 rad (≈ 46° vertical) | |
| Distance (eye to focus) | min **28**, default **60**, max **75** | World units |
| Zoom step | **10 %** of distance per wheel notch | Multiplicative, so it feels the same at any height |
| Zoom smoothing | rate **12 /s** | ≈ 0.25 s to settle |
| Edge-pan margin | **12 px** | Inner band of the canvas |
| Edge-pan speed | **45 u/s** at default distance | Scales with distance / 60 |
| Key-pan speed | **45 u/s** at default distance | Scales with distance / 60 |
| Pan acceleration | rate **10 /s** | ≈ 0.3 s to reach 95 % speed |
| Pan damping | rate **14 /s** | Short glide after release |
| `focusOn` / follow easing | rate **10 /s** | |
| Space double-tap window | **300 ms** | |
| Map bounds | **x, z ∈ [-32, 32]** | The focus point is clamped. Pass `bounds` (or call `setBounds`) for the real map |
| Max frame step | 0.1 s | A stalled tab can't fling the camera |

All smoothing uses frame-rate independent exponential damping: `x = target + (x - target)·e^(-rate·dt)`.

## Controls

| Input | Action | Binding |
|---|---|---|
| Pointer within 12 px of a canvas edge | Pan that way (diagonal in corners) | Only while the window has focus and the pointer is in the canvas |
| Arrow keys | Pan | `cameraPanUp/Down/Left/Right`, rebindable |
| WASD | Pan | **Off by default.** Opt in with `getBindings().apply(WASD_PAN_BINDINGS)` |
| Middle-mouse drag | Grab and drag the map | Moves 1:1 with the cursor at the focus point |
| Mouse wheel | Zoom in/out | |
| Space (tap) | Center on your hero | `cameraCenterHero`, rebindable |
| Space (hold) | Keep the hero centered while held | |
| Space (double-tap) | Lock the camera on your hero until you pan | |

Any manual pan (edge, keys or drag) cancels an eased jump or a hero lock. Until there are heroes, the "hero" is the world origin.

## API

```ts
const cam = getMobaCamera(scene)!;
cam.focusOn({ x, z }, { instant: true }); // eased unless instant; clamps to bounds
cam.follow(() => hero.position);          // set the hero and lock onto it
cam.follow(() => hero.position, { lock: false }); // only set what Space centers on
cam.follow(null);                         // clear (Space centers on the origin)
cam.jumpTo({ x: u, y: v });               // minimap: (0,0) = top-left / north-west
cam.setBounds({ minX, maxX, minZ, maxZ });
cam.getState();                           // debug: focus, distance, pitch, bounds…
```

`window.__citadelCamera` exposes the same object for Playwright and the console.

## Rebinding

```ts
import { setBinding, getBindings } from './input/bindings';
setBinding('cameraCenterHero', 'KeyF');      // one key
setBinding('cameraPanUp', ['ArrowUp', 'KeyW']); // several keys
getBindings().reset();                       // back to defaults
```

If localStorage is unavailable (private mode, sandboxed iframe, quota), bindings still work for the session and just aren't saved.

## Known gaps

- No settings UI for rebinding yet.
- Edge pan is all-or-nothing inside the margin (no speed ramp toward the edge).
- No terrain-height following: the focus stays at y = 0 until terrain (M1-05) exists.
- Bounds clamp the focus point, not the visible frustum, so you can see a little past the map edge.
