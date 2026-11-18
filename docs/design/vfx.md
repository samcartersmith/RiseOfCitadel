# VFX library (M1-12)

Code: `apps/client/src/vfx/`. Demo: `/vfx.html` (`src/sandbox/vfx.ts`). CI: `apps/client/tests/vfx.spec.ts`.

A pooled toolkit that hero abilities compose in M2: particle presets, ground telegraphs and visual-only projectiles, all drawn from **one procedural atlas** generated in code at startup. Nothing is downloaded, so the art is original and CC0-clean by construction.

## Quick start

```ts
import { createVfx, withVfxStats } from '../vfx';

const vfx = createVfx(scene, { tier: quality.tier }); // once per scene
// on a quality tier change: vfx.setTier(tier);

vfx.play('impactBurst', { at: hitPoint, color: '#FFD27A' });
vfx.attach('aura', heroRoot, { color: '#46A758', duration: 4 });
const tel = vfx.telegraph({
  shape: 'circle', at: { x, z }, radius: 3, intent: 'enemyDisable', fillTime: 1,
  onFilled: () => vfx.play('dustPuff', { at: { x, y: 0.2, z } }),
});
vfx.projectile({ from, to, speed: 14, arcHeight: 3, color: '#FF8A3D', onArrive: (p) => … });

tel.stop(); // every cast returns an EffectHandle { alive, serial, stop() }
window.__citadelStats = withVfxStats(readStats(…), vfx); // adds `vfxActive`
```

Handles are the pooled objects themselves. Once `alive` is false the object may be reused by a later cast, so don't hold on to handles after an effect ends (compare `serial` if you must).

## Files

| File | What |
|---|---|
| `atlasLayout.ts` | 512² atlas, 4×4 grid of 128 px cells; UV maths, decal quad extents, cone scaling. Pure. |
| `atlasDraw.ts` | Canvas-2D painters for every sprite and decal (seeded PRNG, deterministic). |
| `atlas.ts` | Builds the `DynamicTexture` once per scene (mipmapped, trilinear). |
| `presets.ts` | Particle presets as plain data. Pure. |
| `particles.ts` | `ParticleRig`: one Babylon particle system per preset layer, GPU or CPU. |
| `decals.ts` | `TelegraphRenderer`: thin-instanced ground decals. |
| `projectiles.ts` | `ProjectileSystem`: path, trail, impact, thin-instanced orb heads. |
| `pool.ts`, `path.ts`, `telegraphTiming.ts`, `intents.ts`, `budget.ts` | Pure logic, unit-tested (`*.test.ts`). |
| `index.ts` | `createVfx` / `Vfx` manager, stats, `withVfxStats`. |

## Atlas

Particle sprites: `dot`, `spark`, `ring`, `smoke`, `streak`, `feather`, `shard`. Decals: `circleFill/Edge`, `ringFill/Edge`, `coneFill/Edge`, `lineFill/Edge`, `crack`. Every shape is white with alpha so it can be tinted. Decal edges carry a **dark halo** under a white core so the outline separates from light *and* dark ground. Each cell keeps an 8 px empty border so mipmaps don't bleed.

Babylon's particle sprite sheets count rows from the bottom of the (Y-flipped) texture, so `spriteSheetCell()` maps canvas cells to sheet cells. Content inside a cell is mirrored vertically for particles too, so particle sprites are drawn vertically symmetric or orientation-agnostic.

## Particle presets

Counts are High tier; Medium ×0.7, Low ×0.5 (`budget.ts`). All systems run with `updateSpeed = 1/60`, so lifetimes, rates and speeds are in seconds and world units.

| Preset | Kind | Layers | Particles (High / Med / Low) | Use |
|---|---|---|---|---|
| `impactBurst` | one-shot | stretched sparks + shockwave ring | 32+1 / 22+1 / 16+1 | hits, landings, projectile impacts |
| `sparkShower` | 0.4 s stream | stretched sparks, cone up, heavy gravity | 64 / 45 / 32 total | gold/forge impacts |
| `dustPuff` | one-shot | alpha-blended smoke, grows ×2.2 | 14 / 10 / 7 | dashes, slams, footfalls |
| `trail` | loop, attached | additive dots, shrink | ≈40 / 28 / 20 live | projectiles, dashes |
| `aura` | loop, attached | rising dots from a ring | ≈48 / 34 / 24 live | buffs, channels |
| `embers` | loop | rising sparks from a box | ≈72 / 50 / 36 live | burning ground, forge glow |
| `motes` | loop | slow drifting dots, fade by size | ≈96 / 67 / 48 live | river light, ambience |

Cast options: `at`, `follow` + `offset`, `color` (tint override: start colours become the tint and a lighter mix of it), `scale` (sizes, speeds, emitter radius), `duration` (emission time; loops run until `stop()` without it), `area` (box half-size for embers/motes), `cell` (sprite override for the first layer, e.g. `feather` for Kestrel).

`stop()` on a particle effect is graceful: emission stops, live particles finish, then the rig goes back to the pool.

### GPU vs CPU

`createVfx` uses `GPUParticleSystem` when `GPUParticleSystem.IsSupported` (WebGL2 transform feedback, WebGPU compute shaders), otherwise `ParticleSystem`. `?particles=cpu|gpu` in the URL or `options.particles` forces one. Both paths share the same rig code and presets.

- GPU systems are created with `emitRateControl: true` so `emitRate` and `manualEmitCount` behave like the CPU path.
- A GPU system keeps drawing its (dead) particle slots until it is released, so it costs a draw call for its whole lifetime. A CPU system stops drawing as soon as its last particle dies. In the CI stress test this is 87 vs 50 peak draw calls.
- Releasing a GPU rig calls `reset()`, which frees its buffers; they are rebuilt (one typed-array allocation) on next use. The JS-side objects are pooled.
- Prewarmed rigs are started with nothing to emit at startup so shaders compile before the first cast. Without it a GPU burst can be swallowed while its effect compiles.
- WebGPU needs the compute-shader engine extension; `particles.ts` imports it.

## Telegraphs

Shapes: `circle`, `ring` (inner radius fixed at 70%), `cone` (apex at `at`, facing `yaw`/`direction`, any angle: the drawn 60° wedge is stretched in X, so very wide cones get a slightly elliptical arc), `line` (starts at `at`, `length` × `width`), `crack` (decorative, e.g. Seal the Gate).

Each telegraph has three layers: a faint full-size fill (only when it has a fill time), the growing fill, and the edge. Every decal of a shape and layer is a **thin instance** of one shared quad with a per-instance colour, so all telegraphs together cost at most **9 draw calls** however many are up. Decals sit at y = 0.03–0.05 on the ground plane (y = 0 until terrain lands) and use a material with image processing disabled, so intent colours stay exact on the Low tier.

### Intent colours and priority

Priority follows art direction §2.2: enemy hard disables > ally buffs > damage > ambient. Higher priority draws on top, has a stronger edge and pulses harder.

| Intent | Edge | Fill | Fill alpha | Pulse | Use |
|---|---|---|---|---|---|
| `enemyDisable` | `#E5484D` | `#E5484D` | 0.42 | 0.30 | stuns, roots, taunts, Crucible Drop |
| `allyBuff` | `#46A758` | `#7CD38A` (lighter, to separate from moss) | 0.36 | 0.12 | heals, shields, Beacon Vigil |
| `damage` | `#F5A524` | `#F5A524` | 0.30 | 0.08 | pure damage areas |
| `neutral` | `#EFE6D2` | `#EFE6D2` | 0.16 | 0 | range previews, ambient |

### Timing

`telegraphTiming.ts`: fade in (0.08 s) → **fill grows linearly over `fillTime`** (linear so players can read the timing) → a 0.18 s flash when it completes (`onFilled` fires that frame) → `hold` → fade out (0.25 s). `fillTime: 0` is an instant indicator (default hold 1 s). `hold: Infinity` keeps it up until `stop()`. The edge pulse quickens as the fill nears 1.

Crucible Drop's 1 s delay is `{ shape: 'circle', intent: 'enemyDisable', fillTime: 1, onFilled }`.

## Projectiles

Visual only: the sim owns real projectiles from M2-08. `vfx.projectile({ from, to | target, speed, arcHeight, color, size, visual, trail, impact, onArrive })`.

- Path: `lerp(from, to, t) + up · 4h·t(1−t)`, so `arcHeight` is the exact peak lift. Speed is along the curve (arc length from 16 chords).
- `target` homes: the end point is re-read from the node every frame.
- The default head is a thin instance of one emissive orb mesh (all heads = 1 draw call). Pass `visual` to move your own node instead; it is turned to face the direction of travel.
- `trail` (default `trail`) follows the head; `impact` (default `impactBurst`) plays on arrival, both tinted with `color`. `null` turns either off.
- `stop()` cancels: no impact, no `onArrive`.

## Pooling and stats

Every rig, telegraph and projectile comes from a `Pool` (`pool.ts`). Pools prewarm one rig per preset and cap at 24 rigs per preset, 48 telegraphs per shape and 64 projectiles; past the cap the **oldest** effect of that kind is recycled, so a spike can never blow the budget. Steady-state casting allocates no engine objects.

`vfx.stats()` returns `{ backend, tier, active: {particles, telegraphs, projectiles, total}, pooled: {…}, particleSystems }`. Projectile trails count as particle effects. `withVfxStats(stats, vfx)` adds `vfxActive` to a `CitadelStats` snapshot (the one optional field in `render/stats.ts`).

## Rendering notes

- Particles and projectile heads draw in rendering group **1** (`VFX_RENDER_GROUP`) so they sit on top of ground decals (transparent meshes in group 0 would otherwise draw over particles). `createVfx` turns off the depth clear for group 1, so world geometry still hides them. Other modules should not reuse group 1 for opaque world meshes.
- Particle emitters are `Vector3`s that the manager moves each frame to follow nodes. Babylon only renders a mesh-emitted particle system when its emitter mesh is in the active-mesh list, which TransformNodes never are.
- The shared atlas is never disposed by particle systems (`dispose(false)`).

## Budgets

Per view: ≤ 150 draw calls (roadmap M1). Measured in `vfx.spec.ts` (headless Chromium, WebGL2 SwiftShader, Low tier) with 50 concurrent mixed effects (bursts, showers, dust, embers, auras, 4 telegraph shapes, arced projectiles with trails): **peak 87 draw calls with GPU particles, 50 with CPU particles**, including the ground. A local WebGPU run on High tier peaked at 56. Rough cost model: 1 draw per active particle layer (GPU: until released), ≤ 9 for all decals, 1 for all projectile heads.

## Hero mapping (M2-17)

Each hero's view config (`apps/client/src/heroes/<id>`) will map sim ability events to VFX calls. The sim emits events such as `castStart`, `castPoint`, `projectileLaunched`, `projectileHit`, `areaPending(delay)`, `areaLanded`, `modifierApplied/Removed` and `channelStart/End`. The mapping is data plus small callbacks:

| Event | VFX |
|---|---|
| `areaPending(delay)` | `telegraph({ fillTime: delay, intent })`, intent from the ability's effect (hard disable → `enemyDisable`, heal/shield → `allyBuff`, else `damage`) |
| `areaLanded` | `impactBurst` / `dustPuff` / `sparkShower` at the centre, `crack` decal for slams |
| `projectileLaunched` | `projectile({ from, to | target, speed, arcHeight })`, using the sim's speed so visuals line up |
| `projectileHit` | the projectile's `impact`, or an explicit preset at the hit point |
| `modifierApplied` (buff/aura) | `attach('aura', unit, { color })`; keep the handle and `stop()` on `modifierRemoved` |
| dash / charge | `attach('trail', unit, { duration })` + `dustPuff` at start and end |
| channel | `attach('aura' | 'embers', …)` until `channelEnd` |

Examples from the art direction: Rampart Charge = `trail` (dust tint) + `dustPuff` + gold `impactBurst` on hit. Challenge Horn = two or three `ring` telegraphs (`enemyDisable`, instant). Seal the Gate = `crack` + `ring` (`enemyDisable`). Talon Shot = projectile with a feather `dustPuff` (`cell: 'feather'`) on impact. Slag Bolt = arced orange projectile + `dustPuff` splash. Crucible Drop = 1 s `circle` `enemyDisable` telegraph, then `sparkShower` (orange) + `dustPuff`. Ember Field = `circle` `damage` decal held for the duration + `embers` with `area`. Kindle = `attach('aura', ally, { color: '#FFE6A3' })`. Beacon Vigil = large `ring` `allyBuff` + `motes` in warm gold.

## Known limitations

- Decals are flat quads at y ≈ 0; they need projecting onto terrain once M1-05 lands.
- Ring inner radius is fixed (70%). Line decals have side rails only (an end cap would smear when stretched).
- Ally green (`#46A758`) on Warden moss reads through its dark-halo edge, but the fill is low-contrast there. The fill is lightened for that reason.
- Additive particles on the bright Low-tier moss wash out without bloom; High/Medium bloom brings the glow back.
- GPU rigs draw for their full lifetime (see above). If budgets get tight, shorten the release slack or prefer CPU for tiny bursts.
- The VFX modules add ~240 kB (≈50 kB gzipped) to the shared `babylon` chunk, which now passes the 4096 kB warning limit.
