# Structures (M1-08)

Code: `apps/client/src/map/structures/`. Sandbox: `/structures.html` (`src/sandbox/structures.ts`). Test: `apps/client/tests/structures.spec.ts`. Unit tests: `placement.test.ts`, `geometry.test.ts`, `recipes.test.ts`.

Every structure on the map, for both factions: towers T1–T3 and the T4 pair, melee and ranged barracks, the two Ancients, fountains, the base shops, and the neutral side and secret shops. They're kit-bashed in code from the **KayKit Medieval Hexagon** pack (CC0), plus procedural primitives that sample the same texture atlas. They use the shared Citadel toon material and team colour.

## Using it

```ts
import { createStructureSet } from '../map/structures';

const structures = await createStructureSet(scene, map.structures, {
  heightAt: (x, z) => terrain.heightAt(x, z), // optional, world units; default flat y = 0
});
structures.nodes.get('w_ancient'); // placement root per structure id
```

- **Input:** `structures[]` from the map spec (`packages/content/data/map/citadel.json`). `type` and `faction` pick the variant, and `tier` picks the tower model.
- **World scale:** `MAP_UNITS_PER_WORLD_UNIT = 32` (`placement.ts`). The 16000-unit map becomes 500 world units, and a 750-unit lane is ~23 world units wide. The default camera view (distance 60, ~90 world units across) covers ~2900 map units, which is a normal MOBA screen. UnitView draws heroes ~5 world units tall (2.5× display scale), so a T1 tower is ~2.5 heroes tall. **Terrain (M1-05) should use the same constant.** It's the one number the two PRs have to agree on.
- **Terrain snapping:** `heightAt(x, z)` takes world coordinates and returns world Y. Each structure is set at the *lowest* of 9 samples over its footprint (centre plus 8 rim points), so on a slope it sinks into the ground instead of floating. The hex plinths are tall enough to hide the seam. The default is flat ground at y = 0, so this PR doesn't depend on M1-05.
- **Facing:** the spec's `facing` (degrees CCW from +x) turns the model's front (local +z) with `rotation.y = 90° − facing`.

## How it's built

1. **Asset pipeline:** `assets-src/kaykit-medieval-hexagon/manifest.json` lists the 14 pieces used (the "blue" colour variants). `pnpm assets:build` turns them into quantized GLBs in `apps/client/public/models/kaykit-medieval-hexagon/` (920 KB total). Raw packs stay git-ignored. No new packs were added, so `CREDITS.md` doesn't change.
2. **Recipes** (`recipes.ts`, plain data): each variant is a list of parts. A `piece` part is a KayKit GLB with position, rotation and scale. A `prim` part is a cylinder, box, torus or crystal. Prims take their UVs from one atlas swatch (`swatchUvs`): u at the centre of the swatch, v running up the part, so they pick up KayKit's vertical gradient and match the pieces. Parts flagged `glow` use an emissive material instead. Parts flagged `float` hover. Parts flagged `detail` are dropped at LOD1.
3. **Merge** (`structureSet.ts`): all parts of a variant are baked into one mesh per (LOD, hover group, material channel). The geometry maths is pure and unit-tested (`geometry.ts`): transforms, a winding normaliser (the glTF root's handedness flip is baked in and every source is brought to Babylon's own winding, measured from its box builder), flat shading and decimation.
4. **Instances:** every structure is a `TransformNode` with one `InstancedMesh` per source mesh. Static instances get `freezeWorldMatrix()`. Hovering parts sit under a child node that bobs and spins, with a phase taken from a hash of the structure id.

Reproducible end to end: manifest → `assets:build` → recipes in code. No binary is hand-edited.

### Materials (6 in total, shared by all variants)

| Material | What |
|---|---|
| `structure:body:wardens` | Atlas, no tint, team swatch → gold `#E8B54A` |
| `structure:body:hollow` | Atlas × `#A39BB3`, so stone turns violet ash, team swatch → violet `#8E5BD9` |
| `structure:body:neutral` | Atlas × `#E6DED0`, team swatch → bronze `#B07A3C` |
| `structure:glow:gold` / `violet` / `cyan` | Emissive only (braziers, crystals, hearth, rift, fountain water). Bloom picks them up on Medium/High. M1-09 can drive their intensity |

**Team colour:** the "blue" KayKit pieces put every team-coloured face (roofs, flags, banners, awnings) on atlas swatch (0, 3). The body material's team mask is that one swatch (`TEAM_SWATCH`), so roofs turn gold or violet with no extra material. The toon height gradient is off for structures (`heightStrength 0`), because structures stand on terrain at varying heights and the hero-tuned gradient would be wrong. The plinths ground them instead.

## Look

- **Wardens:** pale stone watchtowers with gold (bronze-capped) roofs. Tiers grow in height and plinth size: T1 uses KayKit tower A, T2 tower B with a second flag, T3 adds side turrets, and T4 adds a hovering gold shard. Every tower has a pair of gold braziers. Barracks are KayKit barracks (melee, with weapon racks) and archery range (ranged, with targets) on a stone pad, with braziers and flags. **The Hearthstone** is a square keystone frustum, wider at the top, on a stepped hex dais. A glowing gold hearth slit runs through it, it has a bronze cap and band, a hovering gold core, two watch turrets at the back and two gold-tipped obelisks at the front.
- **Hollow:** the same stone in violet ash, topped with black iron spires: a hex spire with a collar of outward spikes, chains to the plinth, and a floating violet crystal. T2+ adds orbiting embers, T3 adds twin side spires, and T4 adds a third spire and a second crystal. Barracks get iron spikes on the roof (melee) or a spire (ranged), plus violet braziers and floating crystals. **The Hollow Crown** is a broken iron crown hovering over a glowing violet rift. The crown has a violet band, a bronze inner band and eight spikes, two of them snapped and bent. Torn-up rocks ring the rift, chains strain up toward the crown, and a large violet crystal hangs under it.
- **Neutral:** the side shop is a tent on a wooden deck with crates, a barrel and a cyan lantern. The secret shop is a well inside three standing stones under a floating cyan crystal.

The silhouettes are faction-distinct at camera height: round towers with conical roofs (Wardens) against tall black spikes (Hollow). The team colour sits on the roofs and the glow colour.

## Budget

Per structure (one instance; `__citadelStructures.variants`). Draws = source meshes per visible batch, and one batch covers every instance of that variant on screen.

| Variant | Tris LOD0 | Tris LOD1 | Draws | Casts shadow |
|---|---:|---:|---:|:-:|
| Wardens T1 | 2,338 | 1,044 | 2 | ✓ |
| Wardens T2 | 2,666 | 1,231 | 2 | ✓ |
| Wardens T3 | 5,742 | 2,191 | 2 | ✓ |
| Wardens T4 | 5,750 | 2,220 | 3 | ✓ |
| Wardens barracks (melee) | 4,327 | 2,557 | 2 | |
| Wardens barracks (ranged) | 4,367 | 1,936 | 2 | |
| Hearthstone (Ancient) | 3,604 | 1,142 | 3 | ✓ |
| Wardens fountain | 288 | 216 | 4 | |
| Wardens base shop | 4,031 | 1,713 | 2 | |
| Hollow T1 | 1,690 | 750 | 2 | ✓ |
| Hollow T2 | 1,746 | 905 | 2 | ✓ |
| Hollow T3 | 1,922 | 990 | 2 | ✓ |
| Hollow T4 | 2,018 | 951 | 2 | ✓ |
| Hollow barracks (melee) | 4,243 | 2,619 | 3 | |
| Hollow barracks (ranged) | 4,095 | 2,014 | 3 | |
| Hollow Crown (Ancient) | 1,732 | 1,071 | 4 | ✓ |
| Hollow fountain | 312 | 174 | 3 | |
| Hollow base shop | 4,079 | 1,739 | 2 | |
| Side shop (neutral) | 666 | 106 | 2 | |
| Secret shop (neutral) | 806 | 528 | 2 | |

Every variant is under the art-direction cap of 6k triangles (CI checks this). Measured scenes (Playwright, software WebGL2, 1280×720):

| View | Tier | Draws | Tris |
|---|---|---:|---:|
| Map, Warden base (Ancient, 2× T4, T3, barracks), the densest view | Low | 18 | 40.8k |
| Map, Warden base | High | 54 | 172k |
| Map, Hollow base | Low | 21 | 23.6k |
| Map, Hollow base | High | 61 | 123k |
| Map, whole-map overview (all 44 at LOD1) | Low | 54 | 62.5k |
| Gallery, all 20 variants | Low | 60 | 31.4k |

The High numbers include the shadow passes: Babylon counts the 3 cascade renders in draws and active indices. Structures alone leave plenty of room for terrain, trees and units in the 150-draw / 300k-triangle budget.

### LOD

Two levels, no impostors:

- **LOD0:** full recipe.
- **LOD1:** drops `detail` parts (flags, crates, barrels, weapon racks, targets, chains) and halves the sides of round primitives. It then runs **vertex-clustering decimation** on the body (`decimateByClustering`, 0.32-unit cells). Vertices only merge when they share a cell, an atlas swatch and a dominant normal direction, so colour regions and hard edges survive. It typically removes 40–65% of the triangles.
- **Switch distance:** 105 world units from the camera (`DEFAULT_LOD1_DISTANCE`). At the default zoom, everything in the lower two-thirds of the screen is LOD0 and far-edge structures are LOD1. Zoomed out, everything is LOD1. LOD is picked per instance by Babylon. `forceLod(0|1|null)` and the sandbox's LOD button override it.

## Shadow-caster policy

Cascaded shadows (High only) draw each caster once per cascade (3×). With instancing, that costs **one draw per caster source mesh per cascade**, however many instances there are. Even so, we cast only where a shadow reads at camera height:

- **Cast:** towers (all tiers) and both Ancients, the tall silhouettes. Only their *body* mesh casts. Glow parts don't (emissive crystals casting shadows looks wrong, and it would add draws).
- **Don't cast:** barracks, fountains and shops. They're low and wide, their shadow mostly falls on their own pad, and they're the most numerous (6 barracks per side).
- **Receive:** every structure mesh receives shadows (`registerShadowReceiver` on the sources).

On the whole map this is 25 registered caster instances, which batch into a few draws per cascade. `recipes.test.ts` enforces the policy.

## Sandbox

`/structures.html?mode=gallery` (default) shows every variant in rows: Wardens (back), Hollow (middle), neutral (front). A displayed-scale knight stands next to the Warden T1 for scale. Views: `overview`, `towers`, `core`, `neutral`. `/structures.html?mode=map` loads all 44 structures from `citadel.json` on a flat stand-in ground with lanes and river strips. Its views are `wardens_base` (the densest), `hollow_base`, `mid` and `overview`. The camera uses the MOBA rig's pose maths (`camera/rig.ts → cameraPose`: 55° pitch, default distance 60) without its input, so screenshots are deterministic. `?tier=`, `?engine=webgl` and `?lod=<distance>` work. `window.__citadelStructures` exposes `expected`, `placed`, `counts`, `variants`, `casterCount`, `materialCount`, `frames()`, `view()`, `forceLod()` and `lodUsage()`. `__citadelReady` and `__citadelStats` work as in the game.

## Known gaps

- Structure scale (and `MAP_UNITS_PER_WORLD_UNIT`) is a proposal until terrain and the camera retune land. Changing the constant moves everything consistently.
- There are no destruction states (rubble or damaged meshes) yet. They come with the sim (M2).
- The Hollow look leans on tint plus iron prims. A Hollow-specific kit (dead trees, more ruin) could push it further once foliage (M1-07) exists.
- Flags and banners are static. Wind sway comes with the foliage shader.
- Glow intensity is fixed until the M1-09 lighting rig drives it (find the materials by the `structure:glow:` name prefix).
