# Lighting & atmosphere (M1-09)

Code: `apps/client/src/render/lighting/`. Sandbox: `/lighting.html` (`src/sandbox/lighting.ts`). Tests: `render/lighting/keyframes.test.ts` (unit), `apps/client/tests/lighting.spec.ts` (Playwright). Asset bake: `tools/assets/sky-env.ts`.

One number, `t ∈ [0, 1)`, drives the whole day/night cycle. The rig turns it into the key light, the ambient, fog, sky, colour grade and night glows. Keyframes are plain data, so the sim clock can drive `t` in M2-20 and the result stays reproducible.

## Time convention

| `t` | 0 | 0.125 | 0.25 | 0.375 | 0.5 | 0.625 | 0.75 | 0.875 |
|---|---|---|---|---|---|---|---|---|
| Phase | **dawn** | morning | **noon** | afternoon | **dusk** | nightfall | **midnight** | before dawn |
| Clock | 06:00 | 09:00 | 12:00 | 15:00 | 18:00 | 21:00 | 00:00 | 03:00 |

`t` wraps: values outside `[0, 1)` fold back in, and the last key blends into dawn. `PHASES` holds the four named times. `nightAmount(t)` is a cosine that's 0 at noon and 1 at midnight, for subscribers that only want "how dark is it".

## Keyframes

`keyframes.ts → LIGHTING_KEYFRAMES`. Colours are written as gamma hex and blended in **linear RGB**. Hues and the sun's azimuth take the short way round. Everything else blends linearly between neighbouring keys.

| | dawn 0 | morning .125 | noon .25 | afternoon .375 | dusk .5 | nightfall .625 | midnight .75 | before dawn .875 |
|---|---|---|---|---|---|---|---|---|
| Key light az / el (°) | 100 / 24 | 120 / 42 | 135 / 58 | 195 / 46 | 250 / 24 | 225 / 38 | 200 / 55 | 145 / 40 |
| Key colour × intensity | `#FFB98A` × .80 | `#FFE2BC` × .90 | `#FFF2DC` × .92 | `#FFE6C4` × .90 | `#FFA266` × .78 | `#8E9EE0` × .40 | `#A4B8FF` × .48 | `#A6B0EC` × .42 |
| Ambient sky / ground | `#C3BCDA` / `#5C5060` | `#C8CCDE` / `#5E585E` | `#C6D0E4` / `#5F5A5E` | `#CACCDC` / `#5F585C` | `#C2AFC8` / `#584A5A` | `#7E88BE` / `#363A58` | `#7389C6` / `#323C5E` | `#8A90C4` / `#3C3E5C` |
| Ambient intensity | .55 | .60 | .62 | .60 | .55 | .68 | .74 | .66 |
| Rim colour × | `#FFCFA0` × 1.05 | `#FFE2B4` × 1 | `#FFE9B8` × 1 | `#FFE2B0` × 1 | `#FFB98C` × 1.1 | `#B4C2F6` × 1.2 | `#B8CCFF` × 1.25 | `#C4C6F4` × 1.2 |
| Fog colour / density | `#D9B9B2` / .0026 | `#CFD3DC` / .0018 | `#C9D3DF` / .0014 | `#D2D2D8` / .0016 | `#BE96A0` / .0028 | `#2E3456` / .0032 | `#1F2A4C` / .0034 | `#4A4A6C` / .0030 |
| Sky zenith / horizon | `#4F6AA8` / `#F2B791` | `#5A8FD0` / `#D8E2EC` | `#5C98DA` / `#CFE2F0` | `#5888CC` / `#DCDCE0` | `#3E4584` / `#F0915E` | `#141A40` / `#3A3C6C` | `#0B1232` / `#27365F` | `#1E2856` / `#6C5C82` |
| Exposure / contrast | 1.06 / 1.18 | 1.03 / 1.20 | 1.02 / 1.22 | 1.03 / 1.20 | 1.06 / 1.16 | 1.18 / 1.12 | 1.24 / 1.10 | 1.16 / 1.12 |
| Saturation | 14 | 16 | 16 | 16 | 18 | 10 | 8 | 10 |
| Highlights hue / density | 30 / 20 | 38 / 16 | 42 / 16 | 38 / 18 | 24 / 24 | 220 / 14 | 215 / 16 | 250 / 14 |
| Shadows hue / density / exposure | 250 / 14 / 6 | 240 / 12 / 6 | 235 / 10 / 7 | 240 / 12 / 6 | 258 / 16 / 7 | 232 / 20 / 9 | 228 / 22 / 10 | 236 / 18 / 9 |
| Night emitters × | 1.5 | 1.1 | 1.0 | 1.1 | 1.7 | 2.1 | 2.2 | 1.9 |
| IBL mix | .20 | .30 | .35 | .30 | .15 | .05 | 0 | .05 |

Design rules the unit tests enforce:

- **The key light never sets.** One `DirectionalLight` named `sun` is the sun by day and the moon by night. It stays at least 20° up, and the sun→moon handover happens at dusk/nightfall, where the light is dimmest, so the swing doesn't read. The cascaded shadow generator keys off this light (`shadows.ts`), so it is never rebuilt and the shadow map is never reallocated. The test checks that the generator and shadow-map ids don't change across a full scrub.
- **Night stays readable.** Midnight is blue-dominant in both the key light and the ambient. Its total light on an upward face × exposure is more than a quarter of noon's. The rim gets stronger at night (×1.25) so silhouettes still pop (art direction §2.2).
- **Exposure and contrast stay above 1.** Babylon only adds the `EXPOSURE`/`CONTRAST` defines when they differ from 1, so crossing 1 would recompile every material on Low and the post-process on High. The rig also nudges an exact 1 to 1.001.
- **The cycle is continuous.** Sampling 2000 points never jumps more than 0.01 in any intensity, direction or sky channel.

### Faction retune (noon)

The M1-05 terrain report said the Hollow side read too violet and dark. Most of that came from the old grade's violet shadow curve (hue 268, density 22) and the lavender-on-violet toon ambient (`#C9C2D6` / `#5A4E66`). Noon now uses:

- a warm key light `#FFF2DC` and gold highlights (hue 42), so Warden stone, gold roofs and moss stay warm;
- a cooler, more neutral ambient (`#C6D0E4` sky, `#5F5A5E` ground): blue ÷ red on the ground drops from ~1.3 to under 1.15;
- a cool blue shadow grade (hue 235, density 10, shadow exposure +7), which lifts dark ash instead of tinting it violet.

The Hollow ash now reads as a mid grey-lavender, not a dark purple. What lavender is left comes from the terrain's own Hollow ramps in `splatPalette.ts` (`#55505E → #9A92A8`). Lighting shouldn't overrule that data. If art wants it cooler still, that's a one-line ramp change in M1-05's file.

## What the rig drives, and how

`createLightingRig(scene, opts)` (`rig.ts`). It adopts the scene's `sun` and hemispheric light if they exist, or creates them.

| Target | How | Recompiles? |
|---|---|---|
| Key light direction, colour, intensity | `sun.direction/diffuse/intensity`. The toon and terrain plugins read the sun every bind | no (uniforms) |
| Hemispheric ambient | `hemi.intensity/diffuse/groundColor` (StandardMaterial/PBR), plus **scene light tints** (`sceneTint.ts`) that the toon and terrain plugins multiply into their own palette ambient | no |
| Toon rim | rim tint + intensity multiplier in the same scene tint | no |
| Fog | EXP2 fog. Mode set **once** at creation, then only `fogColor`/`fogDensity` change | no |
| Clear colour | horizon colour | no |
| Sky dome | per-vertex colour buffer update | no |
| Colour grade | exposure, contrast, ColorCurves (saturation, highlight/shadow hue, density, shadow exposure) through `setColorGradeHook` in `pipeline.ts`, so they survive tier switches | no |
| Night emitters | `emissiveColor = base × (1 + (factor − 1) × strength)` | no |

The tints are ratios `target / DEFAULT_TOON_PARAMS colour` in linear space. A material with the default ambient then gets exactly the keyframe colour, and a material with its own ambient keeps its offset from the default. Scenes without a rig get the identity tint, so the toon and terrain sandboxes look exactly as before.

### Cost

- `setT` costs **0.12 ms** CPU on average (M1 MacBook, 500-step sweep, full map scene). When an exposure or contrast step lands (quantised to 0.004), that frame costs ~0.8 ms, because Babylon's image-processing setters re-flag every material. While auto-cycling that happens on a few frames per in-game hour.
- **No shader compiles while scrubbing.** The Playwright test records compiled effects, materials and the shadow generator/map ids, scrubs the whole cycle (24 steps on Low, 8 on High), and asserts all of them are unchanged.
- **+1 draw call** (the sky dome, 512 triangles).

## Environment (Poly Haven HDRI)

Source: `assets-src/polyhaven-sky` (Kloofendal 48d Partly Cloudy Pure Sky, CC0, 1k, 1.4 MB). `pnpm exec tsx tools/assets/sky-env.ts` bakes two small files into `apps/client/public/sky/`:

| File | What | Bytes |
|---|---|---|
| `sky-env.hdr` | HDRI box-filtered to 128 × 64, flat RGBE | 32,897 on disk (26.4 KB as served by `vite preview`) |
| `sky-clouds.jpg` | grayscale cloud mask of the upper hemisphere, 512 × 128 (open sky 0.72, clouds 1) | 6,460 |

- **Lazy:** the HDR loads after the scene's first `executeWhenReady`, so it never delays the first frame. The rig looks complete without it.
- **Prefiltered:** it loads as an `HDRCubeTexture` with 32² faces, GGX-prefiltered on load, and becomes `scene.environmentTexture` (intensity 0.4) for any PBR material, such as future water. Diffuse/rough IBL doesn't need more resolution, which is why the 1.4 MB source shrinks 40×.
- **Subtle IBL for the toon world:** the toon and terrain shaders don't sample the environment. Instead, the HDR's spherical harmonics give an up and a down irradiance colour, and `applyIbl` pulls the ambient sky/ground hue toward them by the keyframe's `iblMix` (35% at noon, 0 at midnight). It keeps luminance and stays at most 50% of the way from grey.
- **Sky dome** (`skyDome.ts`): a 32 × 8 hemisphere with a skirt, parented under a `lighting` node. It's a StandardMaterial with lighting off: emissive × cloud mask × vertex colour, so there's no custom shader on either backend. The gradient follows `t`; the mask contributes cloud shapes only. The MOBA camera (55° pitch) never sees the horizon. The dome shows in the sandbox's `horizon` view and past the map edge.

## Hooks for other modules

### `onLightingChange(scene, cb)`: water (M1-06), foliage (M1-07), VFX

```ts
import { onLightingChange } from '../../render/lighting';

const off = onLightingChange(scene, (p) => {
  // p: LightingPalette, all colours linear RGB [r, g, b]
  waterMat.setColor3('uSkyTint', Color3.FromArray(p.skyHorizon));
  waterMat.setFloat('uMoteGlow', 0.4 + 0.6 * p.night);
  foliageMat.setVector3('uSunDir', Vector3.FromArray(p.sunDirection));
});
```

- It fires once immediately if a rig already runs, and then on every `t` change. Auto-cycle changes `t` every frame, so keep the callback to uniform writes. Never toggle defines.
- Subscribing before the rig exists is fine. `getLightingPalette(scene)` reads the current palette (or null if there's no rig).
- Palette fields: `t`, `night`, `sunDirection` (toward the light), `sunAzimuth`, `sunElevation`, `sunColor`, `sunIntensity`, `ambientSky`, `ambientGround`, `ambientIntensity`, `rimColor`, `rimIntensity`, `fogColor`, `fogDensity`, `skyZenith`, `skyHorizon`, `exposure`, `contrast`, `saturation`, `highlightsHue/Density`, `shadowsHue/Density/Exposure`, `emissive`, `iblMix`.
- Toon-material users (`CitadelToonMaterial`) need nothing: sun, ambient and rim already follow the rig. Custom shaders (water, grass) should take sun/ambient/fog from the palette, or from `sun`/`hemi`/`scene.fog*`, which the rig keeps in sync.

### `registerNightEmitter(meshOrMaterial, strength = 1)`

```ts
import { registerNightEmitter } from '../../render/lighting';
const off = registerNightEmitter(lanternMesh);     // its material's emissive brightens at night
registerNightEmitter(fireflyMaterial, 0.5);         // half the boost
off();                                              // restore the authored emissive
```

The emissive colour at registration time is the daytime base. Registration works before or after the rig is created. Disposed materials unregister themselves. Materials whose names start with `NIGHT_EMITTER_PREFIXES` (`structure:glow:`, i.e. M1-08's gold/violet/cyan braziers, crystals, Hearthstone, rift and fountain) are registered automatically, so the structures module needs no code. Bloom on Medium/High picks up the brighter glows.

### `window.__citadelLighting`

`{ setT(t), getT() }` on every page that creates a rig (the boot scene does). The sandbox replaces it with a richer object (`window.__citadelLightingDebug`, same object): `palette`, `setPhase`, `setCycle`, `view`, `effectCount`, `materialCount`, `shadowIds`, `emitters`, `benchSetT`, `env`.

## Sandbox

`/lighting.html` shows the full terrain, the M1-06 river water, every structure in `citadel.json` on its terrain height, six lane creeps and Bulwark at the mid-lane river crossing, under the MOBA camera. The dev panel has the time slider with a 24 h clock, dawn/noon/dusk/midnight presets, an **auto-cycle** toggle (120 s per day) and views (`mid`, `wardens`, `hollow`, and a low `horizon` camera that shows the sky and the whole lit map). The perf HUD carries the tier switch. URL: `?t=`, `?view=`, `?cycle=<seconds per day>`, `?tier=`, `?engine=webgl`, `?hud=0`.

### Measured (software WebGL2, CI settings, 1280 × 720, with M1-06 water)

| View | Tier | dawn | noon | dusk | midnight |
|---|---|---|---|---|---|
| mid (river crossing) | Low | 26 draws / 59.0k tris | same | same | same |
| mid (river crossing) | High | 65 / 196.7k | same | same | same |
| Warden base, noon | Low | | 32 / 89.6k | | |
| Hollow base, noon | Low | | 28 / 58.0k | | |
| Warden base | High (Metal) | | 72 / 285k | | |

Counters don't change with `t`: no LOD, culling or caster set depends on time of day. The `horizon` view is a cinematic check, not a MOBA view. It draws ~199 calls on High because the whole map's structures are in frame, which is over the MOBA budget by design.

## Integration notes

- `render/scene.ts` (the boot scene) now calls `createLightingRig(scene, { t: PHASES.noon })` in place of its two placeholder lights.
- `render/pipeline.ts` gains `setColorGradeHook(scene, hook)`. `applyColorGrade` still sets the base grade (ACES, vignette, curves object), then calls the hook with the tier's grade intensity.
- `CitadelToonPlugin.bindForSubMesh` and `TerrainSplatPlugin.bindForSubMesh` multiply their ambient (and the toon rim) by `getSceneLightTint(scene)`. These are CPU-side uniform values, with no shader change.

## Gaps / follow-ups

- WebGPU had only a brief manual check: the Claude desktop browser pane (Chromium, macOS/Metal), `/lighting.html?tier=low`, backend `webgpu`. The scene rendered with the HDR environment loaded and no console errors. Nobody has run a full WebGPU scrub. CI covers WebGL2 only, like the other sandboxes.
- M1-06 water landed while this PR was in flight. The sandbox wires it with `onLightingChange(scene, p => water.setLighting(waterLightingFor(1 - p.night)))`. The boot/game scene has no water yet; whoever adds it should use the same line. Water reads the sun and hemi light directly, so it doesn't get the toon ambient tint. That's fine because its own day/night palette covers it.
- No point lights for braziers: the toon shader ignores extra lights by design. The glow is emissive + bloom. A cheap fake (a ground decal per brazier that fades in with `night`) could come with VFX polish.
- Terrain still doesn't cast shadows (M1-05 decision). The long dawn/dusk shadows come from structures and units only.
