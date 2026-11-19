# River water (M1-06)

Code: `apps/client/src/map/water/`. Sandbox: `/water.html` (`src/sandbox/water.ts`). Tests: `src/map/water/*.test.ts` (Vitest) and `apps/client/tests/water.spec.ts` (Playwright).

The river is pale cyan light-water (`#7FE3E0`, [art-direction.md](art-direction.md) §2) running from the north-west map edge through the mid crossing to the south-east edge. The water is generated from the map spec's `river.waypoints` and the terrain's height grid at load time. Like the terrain, nothing is authored by hand: move the river in `citadel.json` and the water follows.

## Use

```ts
import { createTerrain } from '../map/terrain';
import { createWater, waterLightingFor } from '../map/water';

const terrain = await createTerrain(scene, { riverPlaceholder: false }); // no placeholder ribbon
const water = createWater(scene, { sampler: terrain.sampler, tier: quality.tier });

water.setTier('low');                          // motes off on Low, on for Medium/High
water.setLighting(waterLightingFor(daylight)); // M1-09 day/night hook (see Lighting)
water.flowAt(wx, wz);                          // { dx, dz, speed } world units, 0 off the river
water.depthAt(wx, wz);                         // water depth, world units (≤ 0 = dry)
water.setTime(12.5);                           // freeze the animation (screenshots); null resumes
```

**Terrain coordination.** The terrain already had a `riverPlaceholder` option (default `true`) for its flat translucent ribbon. Callers that create water pass `riverPlaceholder: false`. No code in `map/terrain/` changed for this PR; only the River paragraph of [terrain.md](terrain.md) now points here. The terrain's riverbed palette (layer 6, teal toward river light) is what you see through the shallow water, so the two are tuned together.

## Technique

### Geometry (`riverPath.ts`, pure)

1. **Path.** The 11 waypoints are smoothed with a uniform Catmull-Rom spline (it passes through every waypoint) and resampled every 30 map units (~0.94 world units). Tangents come from central differences. A unit test checks the smoothed line stays within 120 map units of the carved polyline (the bed is ~440 wide at the waterline), turns less than 3° between samples, and that offsetting it by ±600 never folds a quad on the inside of a bend.
2. **Ribbon.** One cross-section per sample, 40 vertices across ±600 map units (~0.95 world units apart), flat at the water level: 55% of the way from the riverbed (−64) to low ground (0), i.e. −28.8 map units, −0.9 world. The ribbon is deliberately wider than the water. The terrain's banks cut the visible shoreline through it with the depth test, so the waterline sits exactly on the rendered ground with no extra work.
3. **Culling.** Quads whose four corners are all more than 12 map units under the ground are dropped (that's most of the ribbon's width, and the river's ends under the border rock). The rest is split along the river into **13 chunks** of 48 cross-sections (~45 world units) for frustum culling.
4. **Attributes.** Each vertex carries `waterData` = (across −1…1, arc length *s* in world units, water depth in world units, flow speed) and `waterFlow` = the flow direction (x, z). The depth comes from the same baked height grid the terrain mesh uses (`sampler.mapHeightAt`), so the foam band follows the real bank.

Flow direction is waypoint order (north-west → south-east). Flow speed has a river-like parabolic profile across the channel: 1.1 world units/s on the centreline, 30% of that at the wet edge (400 map units out). `flowAt(path, x, z)` exposes it for gameplay and VFX.

### Shader (`waterShaderCode.ts`, `waterMaterial.ts`)

A `StandardMaterial` with a material plugin, the same pattern as the toon and terrain shaders: **GLSL on WebGL2, native WGSL on WebGPU**, Babylon still doing shadows (High), fog and Low-tier in-material image processing. The plugin passes the two attributes through as varyings, takes over lighting with `CUSTOMUSERLIGHTING` (recording only the sun's shadow term) and shades in `CUSTOM_FRAGMENT_BEFORE_FOG`. Alpha-blended, back faces culled, depth write on.

**No textures.** Ripples, streaks and foam break-up are value noise (a sine-free hash, stable on mobile GPUs), so the water downloads nothing and WGSL's uniformity rules never apply. All in river space, `q = (across × half-width, s)` in world units:

| Element | How |
|---|---|
| **Flow** | Two-phase flow map. Each phase scrolls the noise downstream at the vertex's flow speed for 3 s, then jumps back (with a new offset) while its weight is 0. The weights are triangles that sum to 1 (`flowPhases`, unit tested), and the blend is rescaled so contrast doesn't dip mid-cycle. Because the speed varies across the river, a plain UV scroll would shear the pattern apart over time; the phase reset stops that. |
| **Depth tint** | Depth / 0.9 world units, softly posterised into 3 bands, mixes shallow `#8FE6DC` → deep `#1E6E78`. Alpha goes 0.55 → 0.88 with depth, so the terrain's sand and teal riverbed show through the shallows. |
| **Flow streaks** | Noise stretched 18:1 along the flow, thresholded into thin pale lines, kept off the shallows. They're the main cue for which way the river runs. |
| **Shoreline foam** | A band from the waterline to 0.22 world units deep, edge broken up by slowly drifting noise and lapping in and out with a sine along the bank. A thinner, broken second foam line follows further out. Alpha fades to 0 in the last 0.03 units of depth, so the very edge is soft. |
| **Toon lighting** | Albedo × (hemispheric ambient + banded sun × shadow), the terrain's 3-band ramp, so water and ground light the same. |
| **Specular** | The normal is tilted by the ripple and streak noise; Blinn n·h through a hard threshold (0.994) gives small, sharp toon glints, masked by the sun's shadow and the foam. |
| **Fresnel** | A banded (smoothstep 0.42–0.48) sky-tint band at grazing angles, from a gently rippled normal so it reads as a clean band. |
| **Glow** | River light `#7FE3E0` added as self-illumination, stronger in the deep channel. 0.12 by day; night raises it (see Lighting). Bloom (Medium/High) picks up the glints and motes. |
| **Distance calm** | Streaks, the second foam line and glints fade between 80 and 170 world units from the eye, so long views don't shimmer into noise. |

### Motes (`motes.ts`)

One CPU `ParticleSystem`, additive, one draw call, with a 32² dot texture generated in code. 140 motes on High, 70 on Medium, none on Low. They spawn over open water (depth > 4 map units) within ±1800 map units of arc length around where the camera's forward ray meets the water, then drift downstream at 45–75% of the local surface speed, rising slowly and fading in and out over 3–6 s. When the focus jumps (a view preset or minimap jump), the system respawns around the new focus at once. Motes render in group 1, shared with VFX particles (Babylon draws particles before transparent meshes in a group, so in group 0 the water would paint over them). Group 1 keeps the depth buffer, so motes still hide behind banks.

### Reflections

No reflection or refraction render targets on any tier. On High a planar mirror would cost one extra scene pass (the whole terrain and every unit again, roughly doubling draw calls in the river views) for a surface the MOBA camera sees at ~55°, where the fresnel term is small anyway. The fresnel sky band and the glints carry the look. This is the first thing to revisit if M1-15 finds spare budget on High.

## Tiers

| | Low | Medium | High |
|---|---|---|---|
| Water shader | same | same | same |
| Motes | off | 70 | 140 |
| Sun shadows on the water | — | — | yes (cascaded, from tower/tree casters) |
| Bloom on glints / motes | — | yes | yes |
| Tonemap + grade | in-material | post | post |

The water shader is identical on every tier: it's cheap enough not to need variants, and the image stays consistent.

## Cost

Counters from `water.spec.ts` (headless Chromium, software WebGL2, 1280 × 720, terrain + water, default camera distance):

| View | Low: draws / tris | High: draws / tris |
|---|---|---|
| River crossing (mid, MOBA camera) | 17 / 34.2k | 24 / 84.9k |
| River bend (top-left, MOBA camera) | 21 / 43.0k | 28 / 90.7k |
| Long view down the river (low camera, 190 units deep) | 80 / 105.0k | 87 / 129.1k |
| Top-down, whole map | 113 / 111.3k | 120 / 111.3k |

Against the terrain alone ([terrain.md](terrain.md): crossing 13 / 20.0k Low, 19 / 70.7k High), the water adds **3–4 draw calls and ~14k triangles** in a MOBA view, plus 1 draw for the motes on Medium/High. The whole river is 34.5k triangles / 18.3k vertices in 13 chunks, built in ~10 ms of CPU at load. Per pixel: five value-noise lookups (20 hashes) and about 80 ALU ops, no texture fetches. The water covers 15–35% of the screen at the crossing. WebGPU (headless Chromium on Apple Silicon/Metal, High) renders the same image with the same counters.

## Lighting (M1-09)

Sun direction, sun colour and intensity, and the hemispheric ambient are **read from the scene's lights on every bind**, exactly like the terrain (`findSunLight`, the `HemisphericLight`). So when M1-09's rig moves and recolours the sun, the water's banded lighting, glints and shadows follow with no call.

The water-specific colours are what M1-09 must push, through one hook:

```ts
water.setLighting(waterLightingFor(daylight)); // daylight ∈ [0, 1]: 0 night, 1 full day
```

- `WaterLighting` = `shallow`, `deep`, `foam`, `streak`, `glow`, `glowIntensity`, `skyTint` (fresnel colour), `mote`, `moteIntensity`. Every field is a uniform (or a particle colour), so calling it every frame never recompiles.
- `waterLightingFor(daylight)` blends `DAY_WATER_LIGHTING` and `NIGHT_WATER_LIGHTING` in linear light. M1-09 owns the mapping from its `t` to `daylight`; the sun's elevation (`max(0, sun.y)` normalised) is the natural choice. Dusk/dawn tints can be passed as custom palettes: `waterLightingFor(d, myDay, myNight)` or a partial object straight to `setLighting`.
- Intent: at night the water darkens (`deep` `#0F3550`) but its **glow rises from 0.12 to 0.45** and the motes brighten (×1.6), so the river of raw leyline light stays the brightest neutral thing on the map. The sandbox's daylight slider runs this hook and dims the placeholder sun and sky as a stand-in for M1-09.

## Sandbox

`/water.html?view=crossing|bend|long|top&tier=…&engine=webgl&daylight=0..1`. The buttons switch views; the slider runs the day/night hook. `window.__citadelWater` has `view`, `frames`, `stats`, `placeholder` (false: the terrain's ribbon is off), `flowAt`/`depthAt` (map units in), `motes()` (live count), `setTier`, `setDaylight`, `setTime`. `__citadelReady` and `__citadelStats` work as in the game.

## Known gaps

- **The pattern stays the same width at every distance.** Streaks and glints are calmed with distance but not filtered, so in the long, low view glints still read as a glitter path toward the sun. Fine for the ~55° MOBA camera, where the water is never far away.
- **The water level is flat.** The river has no slope or rapids; the flow is purely visual. If the M2 sim wants currents (slowing units in the river), `flowAt` is ready for it.
- **Mote spawning is linear in path samples** (`projectOnPath` over ~600 segments) every 10 frames. ~0.05 ms; it could use a spatial bucket if the path grows.
- **Foam follows per-vertex depth** (~0.95-unit spacing) while the visible waterline follows the terrain's 0.78-unit grid, so the foam band can drift up to about half a unit from the exact edge in places. Not visible at MOBA zoom.
- **The boss pit is dry.** It's at river height but outside the ribbon, which is right for gameplay. If art wants a flooded pit, give it its own water patch.
- WebGPU was checked on this Mac only (headless Chromium, Metal). CI covers WebGL2.
