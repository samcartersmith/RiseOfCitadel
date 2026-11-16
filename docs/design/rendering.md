# Rendering baseline (M1-01)

Code: `apps/client/src/render/`. Budget: ≤ 150 draw calls and ≤ 300k triangles per view (roadmap M1).

## Quality tiers

| | High | Medium | Low |
|---|---|---|---|
| Max device pixel ratio | 2 | 1.5 | 1 |
| Render scale (on top of DPR) | 1.0 | 1.0 | 0.8 |
| MSAA (post-process input) | 4× | off | off |
| FXAA | on | on | off |
| Bloom | on (weight 0.25) | on (weight 0.19) | off |
| Vignette / grade strength | 1.0 | 0.75 | grade only, in-material |
| Cascaded shadows | 3 cascades, 2048² | off | off |

All tiers use ACES tonemapping and the palette colour grade (warm gold highlights, violet-lifted shadows, +saturation). High and Medium run Babylon's `DefaultRenderingPipeline`. Low has no post-process pass at all: tonemapping and curves run inside the material shaders.

**Picking the tier** (`quality.ts → chooseTier`):

1. `?tier=high|medium|low` in the URL.
2. Otherwise auto-detect: mobile, `navigator.deviceMemory ≤ 4` or a software renderer (SwiftShader, llvmpipe) → Low. WebGPU on desktop → High. WebGL2 → Medium. M1-15 refines this with real device data.

**Switching at runtime:** `createQualityController(engine, scene, backend).setTier(tier)` rebuilds the pipeline and shadows and resets the hardware scaling, with no reload. The perf HUD's tier buttons and `window.__citadelSetTier(tier)` both call it. The pipeline is also rebuilt when the active camera changes.

## Shadows

Shadows key off the scene's directional light named `sun` (any directional light if none has that name). Other modules register meshes. Registering is safe on every tier: the registry remembers the mesh and applies it when shadows turn on.

```ts
import { registerShadowCaster, registerShadowReceiver } from '../render/shadows';

registerShadowCaster(heroRoot); // includes child meshes by default
registerShadowCaster(towerMesh, false); // just this mesh
registerShadowReceiver(terrain);
```

Disposed meshes unregister themselves. `unregisterShadowCaster` / `unregisterShadowReceiver` do it explicitly. Each caster is drawn once per cascade, so register only what matters at camera height: heroes, creeps, structures and trees, not decals or small props.

## Perf HUD

The `#overlay` panel shows backend, tier, fps, frame time (and CPU time in `scene.render`), draw calls, active meshes, triangles and JS heap (Chromium only). Rows turn red over budget. Backtick (`` ` ``) toggles it. `?hud=0` starts it hidden. The same counters are published on `window.__citadelStats`, which CI checks in `apps/client/tests/render-tiers.spec.ts`.
