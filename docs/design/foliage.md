# Foliage (M1-07)

Code: `apps/client/src/map/foliage/`. Sandbox: `/foliage.html` (`src/sandbox/foliage.ts`, with the M1-06 water). Tests: `src/map/foliage/*.test.ts` (Vitest) and `apps/client/tests/foliage.spec.ts` (Playwright).

Every tree zone on the Citadel map is filled with **2 851 thin-instanced trees** in seven species (three Warden, four Hollow), scattered deterministically from the map data. Each tree has a stable ID and can be hidden and shown again in O(1) for M2 tree destruction. Trees sway in the vertex shader, far cells switch to a cheaper mesh, one shared proxy casts the High-tier shadows, and grass tufts grow near the camera on High.

```ts
import { createFoliage } from '../map/foliage';

const foliage = await createFoliage(scene, { sampler: terrain.sampler, tier: quality.tier });
foliage.trees[id];                  // { id, x, y, z (world), species, biome, zone }
foliage.setTreeVisible(id, false);  // chop; true to regrow
foliage.setTier('low');             // grass off, LOD distances × 0.7
foliage.wind.strength = 2;          // scene-wide gust (uniform only)
```

## Placement rules

`placement.ts` is pure (no DOM, no Babylon, no `Math.random`), works in **map units**, and is what the M2 sim should call to build tree occupancy so both sides agree on every tree's position and ID.

1. **Zones are paired.** `pairTreeZones` matches each zone to its 180°-rotated twin (same seed, polygon equal under rotation). The Warden zone is scattered once and every point is rotated into the Hollow zone, as map.md asks. Each copy then passes the keep-clear rules on its own, so the layout is point-symmetric everywhere except around the boss pit, which only exists on the Warden side (98.9% of Warden trees have an exact twin; a unit test checks > 97%).
2. **Poisson disk.** Bridson sampling inside the zone polygon, seeded by the zone seed, at **115 map units** (3.6 world) between trunks.
3. **Groves and clearings.** A 3-octave value-noise field (feature size 1 500) thins the samples. A zone keeps the fraction `density + 0.08` of its area as forest, with a soft edge, so the 0.45-density jungles become groves with walkable gaps and the 0.75 map edges read as solid tree lines.
4. **Keep-clear rules** (`createClearanceTest`, map units):

| Rule | Clearance | Rejected |
|---|---|---|
| Lane corridors | lane half-width (375) + 170 | 268 |
| River | half-width (450) + 160 | 37 |
| Ramps | the ramp's width × length rectangle + 160 | 68 |
| Structures | tower 420, barracks 480, ancient 820, fountain 720, shops 420 | 142 |
| Camps | spawn-box radius + 200 | 608 |
| Rune spots | 450 | 0 |
| Boss pit | radius + 380 | 42 |
| Hero spawn points | 320 | 0 |
| Regions | never on `unwalkable`, `river`, `pit` or `lane` regions | 20 |
| Cliffs | ground rises more than 40 within ±55 | 262 |
| Clump noise (clearings) | | 1 820 |

5. **Species and variation.** Each sample carries one random `pick` (shared by its mirror twin), which chooses a species from the tree's biome table by weight, plus a scale (0.85 to 1.2) and a yaw.
6. **Snapping.** A tree stands at the lowest `heightAt` of its trunk centre and four points 0.6 units out, minus 0.1, so roots never float on a slope.

IDs are indices into the scatter output. They're stable for a given map JSON and tuning; changing either renumbers trees, so the sim and client must use the same build.

| Zone pair | Density | Trees (Warden / Hollow) |
|---|---|---|
| primary jungle | 0.45 | 814 / 857 |
| secondary jungle | 0.45 | 379 / 381 |
| south map edge | 0.75 | 122 / 116 |
| west map edge | 0.75 | 53 / 53 |
| east map edge | 0.7 | 23 / 22 |
| base rim | 0.6 | 16 / 15 |

The Hollow primary jungle has more trees than its Warden twin because the boss pit's clearing is only on the Warden side. The census per species is printed by the e2e test (`[foliage] … trees`):

| Species | Biome | Model (CC0) | Count | Near tris | Far tris | Height |
|---|---|---|---|---|---|---|
| warden-oak | Warden | KayKit Hexagon `tree_single_B` | 562 | 220 | 28 | 7.2 |
| warden-fir | Warden | KayKit Hexagon `tree_single_A` | 451 | 50 | 20 | 8.4 |
| warden-goldpine | Warden | KayKit Halloween `tree_pine_yellow_large` | 394 | 318 | 20 | 9.6 |
| hollow-deadwood | Hollow | KayKit Halloween `tree_dead_large` | 407 | 256 | 26 | 9.2 |
| hollow-snag | Hollow | KayKit Halloween `tree_dead_medium` | 212 | 216 | 26 | 7.4 |
| hollow-ashpine | Hollow | KayKit Halloween `tree_pine_yellow_large` | 473 | 318 | 20 | 9.6 |
| hollow-duskoak | Hollow | KayKit Hexagon `tree_single_B` | 352 | 220 | 28 | 7.0 |
| shadow proxy (all species) | | generated | | | 26 | 1 (scaled) |
| grass tuft | both | generated | | 5 | | 1 |

Heights are world units at scale 1 (a hero is about 5 tall).

## Palette

No atlas colour reaches the screen. At load, `treeGeometry.recolorTree` samples each GLB's atlas at every vertex UV, classifies the vertex as **foliage** (greens and teals above 30% saturation, or anything above 62%, which catches the Halloween pines' orange needles) or **bark**, normalises luma within each class, mixes in height (lighter toward the crown) and maps it through the species' 3-stop ramp. Vertices near the ground get a little baked occlusion. The result is stored as vertex colours, so the tree materials sample no texture.

| Species | Foliage ramp | Bark ramp |
|---|---|---|
| warden-oak | `#3B5A2C` → moss `#6F9A4E` → golden `#B9C46C` | `#4A3628` → `#7A5A3E` → `#A88A64` |
| warden-fir | `#2A4A30` → `#4C7A45` → `#8DB062` | same |
| warden-goldpine | `#6A5A26` → `#B09A42` → `#E2D27A` (golden grass) | same |
| hollow-deadwood / snag | (bare) | `#2A2631` → `#544C62` → `#968DA8` (dead violet-tinted, art direction §2) |
| hollow-ashpine | `#26363E` → `#3E6264` → `#7BA19B` (cool teal) | `#2C2832` → `#4C4556` → `#756D82` |
| hollow-duskoak | `#33313D` → `#575568` → `#8E8B9E` (violet ash) | same |

Lighting is the shared Citadel toon material (`CitadelToonMaterial`) with `paletteStrength 0` (colours are already palette-mapped), `heightStrength 0` (the occlusion is baked, and terrain height varies) and a softer rim (0.35). Each instance's colour is jittered ±8% in the vertex shader from a hash of its position, so a grove of one species doesn't read as copies.

## Rendering layout

The map is cut into **50-unit cells** (the terrain chunk size, 87 of 100 have trees). Each cell has, per species present:

- a **near mesh** (the recoloured model) and a **far mesh** (a generated proxy), which share the cell's instance-matrix `Float32Array`;
- one **shadow-caster mesh** for all its trees (see Shadows).

That's 282 near/far pairs and 87 casters. Babylon frustum-culls each cell from its thin-instance bounding box. The foliage system's `onBeforeRender` measures the camera's distance to each cell's centre and shows the near or the far mesh: the switch is at **95 world units** (× 0.7 on Low, so 66). With the default MOBA camera (distance 60), the lower two thirds of the screen are near cells on High.

Thin-instance buffers live on a mesh's `Geometry`, so every cell mesh gets its own small `Geometry` (and index buffer), but the position, normal and colour buffers are uploaded once per species and shared.

**Far LOD.** `buildProxy` makes a 20 to 28-triangle stand-in from the measured canopy: a 4-sided trunk plus a 6-sided cone (pines and firs) or a 5-sided rounded double cone (oaks), and for the dead trees a tapered trunk with three closed branch prisms reaching up to the crown (26 triangles; an earlier open-cone crown read as black shards). Everything is vertex-coloured from the same ramps and built in the model's own units, so the proxy reuses the near mesh's material, matrices and wind weights.

## Hiding trees by ID

`setTreeVisible(id, false)` overwrites the tree's 16 floats in its cell's matrix array with a **collapsed** matrix: the 3 × 3 is zeroed, the translation kept. Every vertex lands on the trunk base and the GPU rasterises nothing. Its slot in the cell's caster array gets the same treatment. `true` copies the original matrix back from a master copy. The call is O(1) and never rebuilds a buffer, adds a mesh or changes a draw call. It only marks the cell dirty, and the next frame uploads each dirty cell's matrix buffer once (`thinInstanceBufferUpdated`), however many trees changed in it. A cell holds about 30 trees, so that upload is about 2 KB.

A hidden tree still costs its triangles in the vertex stage (they're degenerate), which is negligible next to a cell's draw. The e2e test chops 40 trees in the jungle view and checks that the hidden count is 40, those IDs report hidden, draw calls and active meshes don't grow, and regrowing restores the exact counters.

## Wind

`FoliageWindPlugin` (`foliageMaterial.ts`) is a second material plugin next to the toon plugin, written like the toon and terrain plugins: GLSL for WebGL2 and native WGSL for WebGPU (`windShaderCode.ts`; a unit test checks that both declare the same hooks and read every uniform).

- It edits `worldPos` at `CUSTOM_VERTEX_UPDATE_WORLDPOS`, after the instance transform.
- The weight is (model height fraction)², so trunks are stiff and canopies move: `windWeight` mirrors it on the CPU.
- The phase is a hash of the instance's world translation, so no per-instance attribute is needed and neighbours never sway in step. Two sines (1× and 2.31×) give the sway, a slow travelling gust modulates it, and a small cross-wind flutter rides on top.
- The displacement scales with the instance's own scale, so a collapsed (hidden) tree stays collapsed.
- Amplitude is per species (oaks 3.5% of their height, pines 2.5%, dead trees 1.5%, grass 14%). `foliage.wind` holds the direction, the clock and a global strength. All of it is uniforms, so nothing recompiles.

Shadows don't sway (the caster is a separate proxy). Nobody will notice at the MOBA camera.

## Shadows

On High the cascaded shadow map draws every registered caster once **per cascade** (3×), and Babylon doesn't cull casters per cascade here, so registering the tree meshes themselves would have cost 282 draws × 3. The policy instead:

- **One shared caster proxy per cell**: a 26-triangle unit tree (trunk plus rounded canopy), thin-instanced with a per-tree matrix scaled to that tree's height and canopy radius. All species in a cell cast through one draw.
- Caster meshes sit on layer `SHADOW_ONLY_LAYER` (`0x10000000`). The camera's default layer mask skips them, while the shadow render target (which doesn't check layer masks for an explicit render list) draws them.
- Only cells within **100 units** of the camera submit their caster (`shadowDistance`). That's 9 to 10 cells in a MOBA view: about 30 shadow draws and 25k shadow triangles.
- **Trees don't receive shadows.** The proxy would self-shadow the real canopy in blotches, and skipping it saves the shadow lookups on the most-drawn surfaces. The terrain (a receiver) shows the tree shadows, and the trees' own toon bands do the rest.

On Low and Medium there's no shadow generator, and the caster meshes are masked out of the camera, so they cost nothing.

## Grass (High only)

`scatterGrass` puts tufts on a jittered 60-map-unit grid (1.9 world), keeps a patchy 55% by noise, and skips lanes, paving (splat > 0.2), the riverbed, rock, the pit and steep ground. Tuft biome colour comes from the terrain splat: Warden `#86A85A`, Hollow `#8C8698`, blended across the river. Each tuft is 5 tapered single-triangle blades (two-sided, up-facing normals so it lights like the ground), with a per-instance colour buffer and the same wind plugin.

Cells grow their grass lazily the first time the camera comes within **75 units** of them on High, and hide it beyond that. A dense view has 4 to 5 grass cells, about 1 200 to 2 200 tufts (6 to 11k triangles, 4 to 5 draws). Switching to Medium or Low hides it all.

## Budget

`foliage.spec.ts`, headless Chromium, 1280 × 720, terrain + M1-06 water + foliage, default camera distance 60, CI's software GL (SwiftShader). The counters don't depend on the renderer.

| View | Low: draws / tris | High: draws / tris |
|---|---|---|
| Warden jungle (densest Warden view, 238 trees on screen) | 52 / 80k | 93 / 205k |
| Hollow jungle (densest view on the map, 258 trees) | 41 / 69k | 77 / 196k |
| Lane edge (Warden safe lane, south forest) | | 69 / 101k |
| River between the biomes | | 85 / 139k |
| Top-down, whole map (every cell far LOD) | 395 / 179k | |

All MOBA views stay inside the 150-draw / 300k-triangle budget. The top-down view draws every cell at once (282 far meshes, 101 terrain chunks and the water), so it's over the draw budget by design. Like the terrain test, it only asserts triangles, on Low. It's a debug view, not something the game camera can do.

High-tier breakdown for the Warden jungle: terrain 19 draws and 62k triangles, trees about 40 draws (near and far meshes) and 110k triangles, shadow casters 30 draws and 25k triangles, grass 4 draws and 8k triangles, plus post-processing.

**Download:** five GLBs, **110 KB** in total (each embeds its 15 KB palette atlas, which is read once for the recolour). Load time at startup: scatter 35 ms, recolour, proxies and meshes about 50 ms.

## Assets

| Pack | Manifest | Models |
|---|---|---|
| KayKit Medieval Hexagon Pack 1.0 (CC0, Kay Lousberg) | `assets-src/foliage-kaykit-hexagon` | `tree_cone`, `tree_round` |
| KayKit Halloween Bits 1.0 (CC0, Kay Lousberg) | `assets-src/foliage-kaykit-halloween` | `pine_tall`, `dead_large`, `dead_medium` |

`pnpm assets:fetch foliage-kaykit-halloween foliage-kaykit-hexagon && pnpm assets:build foliage-kaykit-halloween foliage-kaykit-hexagon`. Both licence files are checked for "Creative Commons Zero" on fetch, and `CREDITS.md` is regenerated. Quaternius and Kenney nature packs were considered, but neither has a direct download the fetch tool can reach (Kenney's site rejects scripted requests), and the two KayKit packs match the structures' style.

`glb.ts` reads the GLBs directly (KHR_mesh_quantization, node translation and scale, embedded PNG) instead of instantiating glTF scene graphs, because the trees are re-baked into vertex-coloured meshes anyway.

## Sandbox

`/foliage.html?view=lane|jungle|hollow|biomes|top&tier=…&engine=webgl&hud=0`. Buttons switch views, **chop 25 trees** hides random visible trees near the camera focus through `setTreeVisible`, **regrow** shows them again, and a slider scales the wind. `window.__citadelFoliage` has `view`, `frames`, `treeCount`, `hiddenCount`, `chop(n)`, `regrow`, `setTreeVisible`, `isTreeVisible`, `census`, `stats` and `setTier`. `__citadelReady` and `__citadelStats` work as in the game.

## Known gaps

- **The goldpine is the Halloween pine's orange recoloured toward gold.** It still reads warmer than the art-direction moss. A third green Warden species, or a lighter gold ramp, may suit M1-09 lighting better.
- **LOD switches per cell**, so a whole 50-unit cell pops between near and far at once. The far proxies are faceted but keep each species' colour and silhouette, which keeps the pop small at 95 units. A cross-fade (dithered) would cost a second draw per switching cell.
- **The Hollow side is dark** under the current post grade, as noted in terrain.md. The dead trees especially read close to black. Retune with M1-09.
- **Shadows don't sway** and come from a generic canopy, not the exact silhouette.
- **No per-cascade culling of casters.** Distance gating keeps it inside budget; a custom `getCustomRenderList` per cascade could cut shadow draws by another third.
- **IDs depend on the map and tuning.** If the map JSON changes, tree IDs renumber. The sim must use the same `scatterTrees` build as the client (M2-03).
- Headless Chromium has no WebGPU, so CI covers only the WebGL2 path. The WGSL wind code is checked by the unit test only; it hasn't been run on a WebGPU device.
