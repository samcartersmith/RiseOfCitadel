# Terrain (M1-05)

Code: `apps/client/src/map/terrain/`. Sandbox: `/terrain.html` (`src/sandbox/terrain.ts`). Tests: `src/map/terrain/*.test.ts` (Vitest) and `apps/client/tests/terrain.spec.ts` (Playwright).

The ground is generated from the map spec (`packages/content/data/map/citadel.json`, see [map.md](map.md)) at load time. Nothing about its shape is authored by hand, so editing the map JSON moves the plateaus, ramps, river and lanes on the terrain too.

## Scale

| | |
|---|---|
| `MAP_UNITS_PER_WORLD_UNIT` | **32** (`sampler.ts`). The same value as M1-08's constant of the same name. Whichever PR merges second should make one import the other's |
| `MAP_TO_WORLD` | 1/32 |
| Map | 16 000 map units = **500 world units** across |
| Height levels | river −64 → −2 world, low 0, mid 128 → 4, high 256 → **8 world units** |

## Height API (for structures, foliage, decals, the nav grid)

```ts
import { getCitadelHeightSampler } from '../map/terrain/sampler';

const terrain = getCitadelHeightSampler();       // baked once (~0.3 s), shared
terrain.heightAt(wx, wz);                        // world units in, world units out
terrain.mapHeightAt(x, z);                       // map units in, map units out
terrain.field.heightAt(x, z);                    // exact analytic height (map units)
terrain.field.regionAt(x, z);                    // the region that owns a point (precedence rule)
terrain.field.splatAt(x, z);                     // lane / biome / forest / paving weights
```

- **Pure**: `heightfield.ts`, `heightGrid.ts`, `sampler.ts`, `geometry.ts`, `noise.ts`, `controlMap.ts` and `chunkGeometry.ts` import no DOM and no Babylon. They're deterministic (seeded value noise, no `Math.random`), so a worker, a Node test or the M2 sim can use them.
- `heightAt` is a plain closure. `createStructureSet(scene, structures, { heightAt: terrain.heightAt })` works as is.
- `heightAt` and `mapHeightAt` interpolate the baked grid **on the same triangles the full-detail mesh uses** (each cell is split along its flatter diagonal, `splitsAD`). Anything placed with them sits exactly on the rendered ground. The e2e test checks this by ray casting the mesh: it's within 1 map unit at 40 points.
- `createHeightSampler(map, { step, tuning })` builds one for any other map spec.

## How the height is built

`heightfield.ts`, all in map units. Later steps win, matching the map's region precedence (unwalkable > pit > river > base > highground > lane > jungle):

1. **Open low ground**: `low` plus rolling value noise (±14), flattened to 25% on lane centrelines.
2. **Plateaus**: the `highground` overlooks, then the `base` plateaus, at their level. Edges are **cliffs** 90 units wide, and the cliff line is pushed ±35 by noise so it isn't ruler-straight.
3. **Riverbed**: carved along `river.waypoints` to `river` level. The bank is a walkable slope from 230 inside the half-width to 90 outside it, also noise-wobbled.
4. **Boss pit**: an octagonal bowl at its level with a rim wall 150 high, open ±34° around `entranceFacing` (north, into the river).
5. **Ramps**: a straight slope from `from` to `to` across the cliff, `width` × `length`, centred on `position` along `direction`.
6. **Unwalkable** (map borders, jungle outcrops): rugged rock, always at least `high` + 90 with up to 170 of ridged relief.

All knobs are in `DEFAULT_TERRAIN_TUNING`.

The **mesh** is a 641 × 641 grid (25 map units = 0.78 world units per vertex), cut into **10 × 10 chunks** of 64 cells (50 world units) for frustum culling. Each chunk has three LODs (full, ½, ¼ detail: 8192 / 2048 / 512 triangles) that switch at 95 and 170 world units of camera distance (× 0.6 on Low). Skirts hang 3 units below every chunk edge, so neighbours at different LODs never show cracks. Normals come from the full-resolution grid at every LOD, so the lighting doesn't pop.

## Splat shader

`terrainMaterial.ts` + `terrainShaderCode.ts`. It's built like the toon shader: a `StandardMaterial` with a material plugin that injects **GLSL on WebGL2 and native WGSL on WebGPU**. Babylon still does shadows (the terrain receives the High-tier cascaded shadows), fog and Low-tier in-material image processing. Every texture fetch happens in `CUSTOM_FRAGMENT_MAIN_BEGIN`, so WGSL's uniformity rules allow mipmapped sampling. A unit test checks that the GLSL and WGSL declare the same hooks and read every uniform.

**Inputs**

- A **control map** (512², RGBA8), baked in code from the map data, so there's nothing to download. R = lane dirt (distance to `lanes[].waypoints`, noisy edge), G = **biome** (0 Warden … 1 Hollow, from which side of the river a point is on, with the transition spread across the riverbed), B = forest floor (`treeZones`), A = base paving (courts around the ancient, fountain, shop, towers and barracks, plus the lanes once they climb into a base).
- A **detail atlas**: the four ambientCG photos reduced to luminance only and packed into one RGBA texture (R Grass004, G Ground037, B Ground054, A Rock030). It's sampled at two world-space scales (7 and 29 units per repeat, mixed 65/35) to hide tiling. Rock is sampled biplanar on cliffs so it doesn't stretch down the faces.

**Palette remap.** No photo colour reaches the screen. Each layer turns its luminance into colour through a 3-stop palette ramp, with a Warden ramp and a Hollow ramp blended by the biome weight (`splatPalette.ts`). The luminance is first scaled by a per-layer contrast (lanes are kept calm, per art direction §2.2), then softly posterised into 4 steps so the ground reads painted, like the toon bands on units. Lighting is the toon shader's: a banded sun times the sun's shadow term, plus the same hemispheric ambient (lavender sky, violet-ash ground).

| # | Layer | Source | Where | Warden ramp | Hollow ramp |
|---|---|---|---|---|---|
| 1 | Grass | Grass004 | everywhere (base layer) | `#4F6540` → moss `#6F9A4E` → golden `#A3A86E` | `#55505E` → ash `#76717E` → violet ash `#9A92A8` |
| 2 | Forest floor | Grass004 | tree zones (control B) | `#3E5233` → `#566F43` → `#6F8F52` | `#433E4C` → `#5A5466` → `#756D82` |
| 3 | Lane dirt | Ground037 | lanes (control R) | `#7A5E44` → `#9C7F5E` → `#C2AA86` | `#675C64` → `#8A7E86` → `#ADA1A8` |
| 4 | Paving | Ground054 | base courts and roads (control A) | `#8E8474` → `#B8AE9C` → `#D6CDBB` (Warden stone) | `#4A4652` → `#6A6672` → `#8A8592` (iron → ash) |
| 5 | Bank sand | Ground054 | just below `low` | `#9E9478` → `#C4BA98` → `#DDD5B8` | `#7C7A80` → `#9C99A2` → `#B8B6BE` |
| 6 | Riverbed | Ground054 | toward `river` level | `#2D5458` → `#4F8A86` → `#7FC4BC` (toward river light `#7FE3E0`) | `#2D4C5A` → `#4D7E8A` → `#7BB9C0` |
| 7 | Rock | Rock030 | slope > 0.32 (1 − nᵧ), or anything above `high` + 70 | `#6E6558` → `#A2988A` → `#CFC6B4` (Warden stone) | `#34313A` → `#4E4A56` → `#76717E` (Hollow iron → ash) |

Layers paint over each other in that order. Each blend "bites" through where the layer's own detail is bright, which gives jagged, hand-painted edges rather than soft photo cross-fades.

**River.** Water is M1-06. Until then a flat translucent ribbon (river light, alpha 0.5, one draw call) sits over the riverbed, so the river reads in screenshots. Pass `riverPlaceholder: false` to drop it.

## Textures and download

| File | Size |
|---|---|
| `apps/client/public/terrain/terrain-detail.jpg` (2 × 2 grayscale atlas, 256² tiles, JPEG q80) | **88.8 KB** |
| Control map | 0 (generated at load, 85 ms) |

Built by `pnpm exec tsx tools/assets/terrain-textures.ts` after `pnpm assets:fetch ambientcg-terrain`. The script reduces each colour map to luminance, blurs it slightly (σ 0.6) to soften photo grain, contrast-normalises it (2nd–98th percentile) and downscales it. The client splits the atlas into one RGBA texture with mipmaps and 4× anisotropic filtering. Normal, roughness and AO maps aren't used: the toon look shades from the geometry.

## Performance

Counters from `terrain.spec.ts` (headless Chromium, software WebGL2, 1280 × 720, terrain only, default camera distance 60):

| View | Low: draws / tris | High: draws / tris |
|---|---|---|
| Lane (Warden safe lane) | 13 / 31.5k | 19 / 62.2k |
| River crossing (mid) | 13 / 20.0k | 19 / 70.7k |
| Hollow base and mid ramp | 13 / 26.7k | 19 / 70.7k |
| Top-down, whole map | 101 / 76.8k | 107 / 76.8k |

That's about a tenth of the 150-draw / 300k-triangle MOBA-view budget. High has more triangles because Low pulls the LOD switch distances in to 60%. The extra High draws are post-processing passes. The terrain **receives** shadows but doesn't cast them: casting would cost one draw per visible chunk per cascade (3 × ~13). CPU at load: height grid ~0.3 s, control map 85 ms, meshes 30 ms.

## Sandbox

`/terrain.html?view=lane|river|base|top&tier=…&engine=webgl&overlay=1`. Buttons switch the views. The **map overlay** pins `docs/design/map-citadel.svg` over the top-down view at the same scale, as a visual check that the terrain lines up with the map data. `window.__citadelTerrain` has `view`, `frames`, `heightAt`/`meshHeightAt`/`regionAt` (map units), `stats`, `setTier`, `setOverlay`. `__citadelReady` and `__citadelStats` work as in the game.

The base preset looks at the **Hollow** base. The camera always faces north, so the Warden base's cliffs face away from it, and only the Hollow plateau shows its cliff walls and ramps.

## Known gaps

- **Cliff tops are slightly scalloped.** A 0.78-unit grid under a 90-unit-wide cliff still shows small bumps along the rim, even with per-cell diagonal selection. A finer grid near cliffs, or cliff meshes, would fix it, but it isn't worth the triangles yet.
- **No terrain self-shadowing** (see Performance). M1-09 can decide whether cliffs cast shadows on High.
- **The camera doesn't follow the terrain height.** The MOBA camera's focus stays at y = 0 (camera.md), so on the 8-unit plateaus the view is a little closer.
- **The biome is a straight river-side split.** Every non-neutral region's faction agrees with its river side (a unit test checks this), so region factions aren't consulted separately. If a future map puts a Warden region north of the river, `splatAt` needs a region-faction pass.
- The Hollow side reads quite dark and violet under the post grade (shadows hue 268). Retune alongside the M1-09 lighting rig.
- Headless Chromium has no WebGPU, so CI covers only the WebGL2 path. WebGPU was checked by hand: Electron/Chromium on macOS (Metal), `/terrain.html?tier=high`, backend `webgpu`, no shader errors, the same image as WebGL2, 19 draws / 70.7k tris, 120 fps (vsync-capped) at 1280 × 720.
