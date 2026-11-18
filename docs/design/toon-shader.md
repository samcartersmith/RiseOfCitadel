# Citadel toon shader (M1-02)

Code: `apps/client/src/render/shaders/`. Sandbox: `/toon.html` (`src/sandbox/toon.ts`). Test: `apps/client/tests/toon.spec.ts`.

One stylized material for every unit, structure and prop (art direction §1.2): a banded sun, a hemispheric ambient, a rim light, a world-space height gradient, a palette gradient-map and a team-colour mask.

## How it's built

`CitadelToonMaterial` is a `StandardMaterial` plus a **material plugin** (`CitadelToonPlugin`, Babylon's public `MaterialPluginBase` API). Babylon internals are not forked. The plugin injects GLSL on WebGL2 and **native WGSL** on WebGPU (`toonShaderCode.ts`), so WebGPU never downloads glslang/twgsl, which a GLSL `ShaderMaterial` would need. Everything StandardMaterial already does keeps working on both backends:

| Feature | How |
|---|---|
| Skinning (bones texture or uniforms), instances, thin instances, clip planes | StandardMaterial, unchanged |
| Shadows | Babylon still samples the cascaded shadow map. `CUSTOMUSERLIGHTING` swaps the per-light sum for our `computeCustomDiffuseLighting`, which only records the smallest shadow term (the sun's) and adds nothing. With shadows off (Low/Medium) the term is 1, so the fallback is automatic. A mesh needs `receiveShadows` (`registerShadowReceiver`) |
| Fog | The toon colour is written at `CUSTOM_FRAGMENT_BEFORE_FOG`, so scene fog applies after it |
| Image processing | Low tier tonemaps in-material; that still runs after the toon colour |

Hooks used: `CUSTOM_FRAGMENT_DEFINITIONS` and `CUSTOM_FRAGMENT_BEFORE_FOG`. No vertex changes.

## Shading, in order

1. **Base colour** = diffuse texture × `diffuseColor`. glTF base-colour textures load into sRGB buffers and sample *linear*; the shader converts back to gamma when it detects that (`toonHeight.w`). Without that, KayKit textures render dark and oversaturated.
2. **Palette gradient-map**: look the texel's luma (Rec. 601) up in the palette LUT and blend by `paletteStrength`.
3. **Team colour**: texels inside the team mask blend toward `teamColor × (0.6 + 0.7·luma)` by `teamStrength`, which keeps the swatch's light-to-dark gradient.
4. **Lighting**, in linear space like PBR, so the bands read as bright as the untouched originals: `ambient(hemi) + sunColor × sunIntensity × band(N·L × sunShadow)`. Cast shadows fall into the lower bands instead of just darkening.
5. **Height gradient**: multiply toward `heightTint` near `heightBase` (world Y), fading out over `heightRange`.
6. **Rim**: `smoothstep` on `1 − N·V`, scaled by `rimIntensity` and more toward the sunny side (`rimLightInfluence`), then added.

The sun is the scene's directional light named `sun` (same lookup as `shadows.ts`). The ambient is our palette colours × the scene's first `HemisphericLight` intensity. Lighting changes in M1-09 flow through without touching materials.

## Parameters

On `material.toon.params` (`toonParams.ts`). All of them are uniforms: changing one never recompiles a shader. The sandbox sliders show them live.

| Param | Default | Meaning |
|---|---|---|
| `bands` | 3 | 2 = lit/shadow, 3 = lit/mid/shadow |
| `shadowThreshold` / `litThreshold` | 0.12 / 0.60 | N·L (× sun shadow) where the shadow band ends / the lit band starts |
| `bandSoftness` | 0.02 | half-width of the blend between bands |
| `shadowLevel` / `midLevel` | 0.15 / 0.45 | sun contribution in the shadow / mid band |
| `ambientSky` / `ambientGround` | `#C9C2D6` / `#5A4E66` | hemispheric ambient (cool lavender sky, violet-ash ground) |
| `ambientStrength` | 0.85 | multiplier on the ambient |
| `rimColor` / `rimIntensity` | `#FFE9B8` / 0.8 | warm cream rim |
| `rimWidth` / `rimSoftness` | 0.32 / 0.12 | rim coverage and edge blend |
| `rimLightInfluence` | 0.5 | 0 = rim everywhere, 1 = rim only on lit surfaces |
| `heightBase` / `heightRange` | 0 / 1.6 | world Y of the feet and the fade distance |
| `heightStrength` / `heightTint` | 0.35 / `#3E3350` | how dark the feet get, and toward what colour |
| `paletteStrength` | 0.25 | 0 = original texture, 1 = full gradient-map |
| `teamColor` / `teamStrength` | null / 1 | team tint (hex) and its blend |

`material.toon.teamRects` holds the mask (up to 4 rectangles). `material.toon.paletteTexture` can take a different LUT (`createPaletteLut(scene, stops)`).

## Applying it

```ts
import { applyCitadelToon } from '../render/shaders/applyCitadelToon';
import { teamMaskFor } from '../render/shaders/teamMask';

const knight = await loadModel(scene, MODEL_CONFIGS.knight);
applyCitadelToon(knight.root, { team: 'warden', teamMask: teamMaskFor('knight') });
```

- It walks the root and swaps each mesh's material, keeping the texture, base/emissive colour, sidedness and winding (`sideOrientation`).
- Materials are **cached per scene** by (texture or colour, emissive, sidedness, winding, team, mask, `variant`). Ten Warden knights share one material, and the originals in the AssetContainer are never modified. `params` apply when a material is first created; pass a `variant` when two callers need different params for the same texture and team (the boot scene's 3× knight does).
- Hand-built meshes: `new CitadelToonMaterial(name, scene, { params })` and set `diffuseColor` or `diffuseTexture`.
- **UnitView**: `installToonUnitLook()` (`toonUnitLook.ts`) plugs the toon material into M1-13's `UnitLook` seam (`setUnitLookFactory`). `wardens`/`hollow` map to the team colours, and `neutral` gets no tint. The mask is found from the mesh names (`Knight_Body`, `knight-merged-0`, …). Highlights use the outline renderer, like the fallback look. Nothing calls `installToonUnitLook` at startup yet. The sim bridge (M2-12) should call it once.

The boot scene's Knight (`render/sampleHero.ts`) uses it in Warden gold.

## Team-colour mask: atlas UV rectangles

KayKit atlases have no mask channel. Each model's atlas is an 8 × 4 grid of 128 × 256 px gradient swatches, and every face samples exactly one swatch. **The mask is a list of swatch rectangles in UV space** (`teamMask.ts → TEAM_MASKS`). Texels inside any rectangle take the team colour.

Why rectangles and not mesh names:

- **Finer than a mesh.** A mesh-name mask tints a whole mesh, but the team parts live *inside* meshes: the knight's belt and straps are on `Knight_Body`, and the rogue's sash is on `Rogue_Body`. Tinting the whole body or shield would bury the silhouette in one colour.
- **Survives merging.** UnitView merges a character into one mesh per material (M1-13). Mesh names are gone after that; UVs aren't.
- **One material per (texture, team).** The mask is a uniform, so there are no extra materials or draw calls.

Chosen swatches (column, row from the top-left), picked by reading which swatch each mesh samples and then checking renders:

| Model | Swatches | What turns team-coloured |
|---|---|---|
| knight | (0,1) (6,0) (7,0) | cape; belt, shoulder straps and leg wraps; helmet crest, tabard strip and boots (the crest reads from above) |
| rogue_hooded | (1,1) | hood, cape, sash |
| mage | (2,1) (1,1) | cape and hat (the robe stays purple) |
| skeleton_minion | (5,0) | cloak only (a creep accent, art direction §2.2) |

Heroes clear the ≥ 20% visible team surface target from the default camera, except the knight from the front, where most of the team area is on its back (cape) and top (crest). Bulwark's gate shield (M1-11) should carry a team swatch. Kit-bashed props for M1-11/M2-16 should put their team parts on a dedicated swatch, or ship a mask texture if that gets awkward.

## Palette LUT

`palette.ts → buildPaletteLut()` builds a 256 × 1 RGBA8 ramp in code from the art-direction palette. The stops run dark to light: `#1B1A1F` → Hollow iron → Hollow ash → Warden bronze → Warden stone → hearth cream → `#FFF8EA`. That gives cool Hollow shadows and warm Warden highlights, the same split the post grade uses. **Each stop sits at its own luma**, so remapping a texel keeps its value and only pulls hue and saturation toward the palette. Unit tests check that value is preserved to within 2/255. Moss, river and the team colours are left out, because a green or violet mid-tone would tint skin and metal. One LUT per scene is shared by all toon materials (`getPaletteLut`).

## WebGPU / WebGL2 notes

- GLSL and WGSL snippets live side by side in `toonShaderCode.ts` and must stay in sync. `toonParams.test.ts` checks that both declare the same hooks, read every uniform and use the same luma weights. The ramp maths is mirrored on the CPU (`toonRamp`).
- WGSL uses `textureSampleLevel` for the LUT, so there's no uniformity-analysis trouble, and `var<private>` for the per-fragment sun-shadow capture.
- Verified on WebGL2 (headless SwiftShader in CI) and on **WebGPU** (headed Chromium on macOS/Metal, `/toon.html?tier=high`, backend `webgpu`, no shader errors). Headless Chromium can't create a WebGPU swap chain here, so CI only covers WebGL2.

## Performance

- **Draw calls: none added.** It's still one draw per mesh. Sharing keeps the material and shader-variant count at one per source material per team (12 toon materials in the sandbox for 24 restyled models).
- **Fragment cost:** about one LUT fetch, 4 rect tests, 2 `pow`s and a few smoothsteps more than StandardMaterial, with no specular. Babylon's per-light maths still runs for shadow sampling, but its result is discarded.
- **Measured** (`/toon.html`, 12 models + ground + 8 thin-instanced markers, software WebGL2): Low 110 draws / 60.5k tris; High 143 draws / 74.8k tris (2 shadow casters × 3 cascades). On WebGPU High it's 149 draws with a 10-mesh caster.
- **Shadows are the budget risk, not the shader.** Babylon's cascaded shadow generator draws each caster once per cascade with no per-cascade culling. An unmerged KayKit hero is 8–10 meshes, so on High it costs ~30 shadow draws. The sandbox therefore casts from one model by default (`?casters=all` for the full look, over budget). UnitView's merged meshes (1–2 draws per unit) are what make shadows affordable in game.

## Sandbox

`/toon.html` shows the four base models idling in three rows: originals (back), Warden toon (middle) and Hollow toon (front). The camera sits south like the game camera, with the sun over its shoulder. Sliders cover bands, thresholds, softness, ambient, rim, palette, team and height; buttons toggle 2/3 bands, fog, and close vs MOBA view (55° pitch, heroes ~60 px tall for the silhouette check). `window.__citadelToon` exposes `params`, `setParam`, `setBands`, `setFog`, `view`, `setTeamMask` (for picking swatches), `toonFraction`, `materialCount`, `frames` and `scene`. `window.__citadelReady` and `__citadelStats` work as in the game.
