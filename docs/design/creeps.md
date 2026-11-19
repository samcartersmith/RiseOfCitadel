# Creeps, neutrals & boss (M1-14)

Code: `apps/client/src/units/creeps/`. Sandbox: `/creeps.html` (`src/sandbox/creeps.ts`, scenes `?scene=lane|neutral|wave|camps`). Test: `apps/client/tests/creeps.spec.ts`. Unit tests next to the pure modules (`*.test.ts`).

| Category | Id | Name | Source (all CC0, KayKit) |
|---|---|---|---|
| Warden melee | `warden_melee` | Warden Shieldbearer | Adventurers: Knight (no head, helmet + cape, sword, rectangle shield) |
| Warden ranged | `warden_ranged` | Warden Arbalist | Adventurers: Rogue + crossbow |
| Warden siege | `warden_siege` | Warden Stonethrower | Medieval Hexagon: catapult turret, chassis/wheels built in code |
| Hollow melee | `hollow_melee` | Hollow Thrall | Skeletons: Minion + blade |
| Hollow ranged | `hollow_ranged` | Hollow Ashcaller | Skeletons: Mage + staff |
| Hollow siege | `hollow_siege` | Hollow Gravecaster | Same catapult, grave-wood and violet recolour |
| Neutral small | `neutral_small` | Thicket Stalker | Adventurers: Rogue (hooded), twin knives, moss/bark recolour |
| Neutral medium | `neutral_medium` | Hedge Seer | Adventurers: Mage, moss robe, rust cape |
| Neutral large | `neutral_large` | Cairn Ogre | Adventurers: Barbarian ×1.35, lichen skin, 2H axe |
| Neutral ancient | `neutral_ancient` | Leyline Revenant | Skeletons: Warrior ×1.6, river-cyan leyline armour + axe |
| Boss | `boss` | The Sundered Sentinel | Adventurers: Knight ×2.2, stone plate, cyan leyline cracks, greatsword |

Camps (`NEUTRAL_CAMPS`): small = 3 Stalkers; medium = 2 Seers + 1 Stalker; large = Ogre + Seer; ancient = 2 Revenants. The designs, names and colours are ours; only the meshes and rigs come from the packs.

## 1. Rendering approach: baked VAT + thin instances

**One draw call per creep type, whatever the count.** Each type is one mesh drawn with thin instances. Animation comes from a baked vertex-animation texture (VAT, Babylon's `BakedVertexAnimationManager`), not a skeleton per unit:

- At load, every clip a type uses is sampled at 30 fps. Each frame's bone matrices go into one row of an RGBA float texture (width = (bones + 1) × 4 texels). The skin weights stay on the mesh, and the vertex shader skins from the texture row.
- Each instance carries a 4-float `bakedVertexAnimationSettingsInstanced` attribute set to `(frame, frame, 0, 0)`. With speed 0 the shader reads exactly that row, so the **CPU picks the frame** (`CreepAnimator`). The GPU keeps no clock, and pause, slow-mo and per-unit attack speed are free.
- Per-frame CPU cost per unit is one 16-float matrix and one 4-float settings write into the type's buffers. There is no skeleton evaluation and no animation groups.

Why not the alternatives?

- **Skeleton per unit** (the hero path, `UnitView`): 40 skinned clones cost 40+ draw calls and 40 skeleton updates per frame. That is fine for 10 heroes, wasteful for 40–80 creeps.
- **Babylon `InstancedMesh`** with a shared skeleton: every instance would play the same pose.
- **Thin instances + VAT**: one draw per type and per-instance frames. Animation is cut-only (no crossfade blending), which reads fine at creep size and camera distance.

The trade-off is memory: a VAT is `168 × 4 × 4 B ≈ 2.7 KB` per row, so 150–320 rows ≈ 0.4–0.9 MB per humanoid type. All 11 types together come to about 5.4 MB of GPU memory.

## 2. State contract

Creeps use the same plain state object as every other unit (`UnitViewState`, docs/design/units.md §2), with `modelId` narrowed to a `CreepModelId`:

```ts
type CreepViewState = Omit<UnitViewState, 'modelId'> & { modelId: CreepModelId };
```

- **Routing.** Game code sends any state with `isCreepModelId(modelId)` to `CreepViewManager.sync(states, dt)` and the rest to `UnitViewManager`. The API is the same: `sync`, `counts`, `pick`, `screenPos`, `setLocalTeam`, `barAnchorHeight`, `dispose`.
- **Animation semantics** match `UnitView`:
  - loops (`idle`, `run`) play until the state changes, starting at a per-unit phase (`phaseOf(id)`) so a crowd doesn't march in step;
  - one-shots replay when `animSeq` changes;
  - a finished one-shot falls back to idle (`DEFAULT_FALLBACK`), except death, which holds its last frame;
  - `attackSpeedScale` scales `attack1`/`attack2`.
- **Every logical state is mapped.** Creeps have no casts, so `cast*`, `channel` and `victory` reuse attack and idle clips.
- **Shared pieces.** Position smoothing and turn rate come from `units/motion.ts`. Health bars (with trails) and selection/hover rings come from the shared `BarRenderer`/`RingRenderer`. The manager owns its own pair, which costs 2 draw calls. Picking reuses `pickNearest`.

## 3. Look: toon shader, atlas recolour, team swatch

Every type renders with the Citadel toon material (`toonMaterialFor`, docs/design/toon-shader.md) with `variant: 'creep'`. `?toon=0` falls back to the installed `UnitLook`.

- **Recolouring needs no new textures.** KayKit models texture from one 8 × 4 swatch atlas. `swatch.ts` recolours per vertex at load:
  - it moves a UV into another swatch, keeping its offset inside the swatch so the gradient still shades the same way;
  - and/or it multiplies by a vertex colour, so tinting a near-white swatch gives an exact colour.

  Rules are per type in `creepTypes.ts` (`recolor`), and the first match wins.
- **Team swatch.** Each lane type has a `teamCell`, a light swatch its source model never samples. Faction-accent geometry is moved into it, and the toon team mask covers exactly that atlas rectangle. Because the mask is a UV rectangle, it survives thin-instancing.

  The swatches were chosen big enough to read from the front at default zoom:

  | Type | Team-coloured parts |
  |---|---|
  | Shieldbearer | Crest, shield face and trim |
  | Arbalist | Tunic |
  | Siege | Side rails (boxes 0.2 × 0.32) and turret trim |
  | Thrall | Cloak and blade |
  | Ashcaller | Robe and hat |

  Colours are Warden gold `#E8B54A` and Hollow violet `#8E5BD9`.
- **Neutrals have no team.** They use earthy moss, bark and rust. The ancient camp and the boss carry the River Cyan `#7FE3E0` leyline accent from the art direction.

## 4. Siege engines

KayKit has no animated siege unit, so the siege mesh is assembled in code (`buildSiegeCreep`):

- The catapult turret and arm come from the Medieval Hexagon catapult tower, normalised to a 1.35-unit turret.
- The deck, team rails, tow beam and four wheels are procedural boxes and cylinders.
- Everything sits on a **4-bone rig**: body, arm, front axle and back axle.
- `siegePose.ts` gives pure pose curves for each clip:

  | Clip | Motion |
  |---|---|
  | `Siege_Idle` | Creak |
  | `Siege_Move` | Bob, roll and one wheel turn per loop |
  | `Siege_Fire` | Snap–hold–winch throw with a chassis kick |
  | `Siege_Wreck` | Tips over and sinks |

- These poses are baked into a VAT exactly like the skinned creeps, so the GPU path is identical: one draw per siege type, with a VAT only 20 texels wide.

## 5. Asset pipeline

- **Packs.** There are three new packs, each with a manifest that fetches the KayKit GitHub repo and checks its `LICENSE.txt` contains "Creative Commons Zero":
  - `assets-src/creeps-kaykit-adventurers/`
  - `assets-src/creeps-kaykit-skeletons/`
  - `assets-src/creeps-kaykit-hexagon/`

  `CREDITS.md` is regenerated by `pnpm assets:credits`.
- **Trimming.** Per model, `keepNodes` drops unused hats and weapons, and `keepAnimations` keeps only the 5 clips used, out of 70–90.
- **New `simplify` model option** (`tools/assets/modelOptions.ts`). It runs gltf-transform `simplify` (meshoptimizer) after weld. KayKit characters are about 6–9k triangles, so lane creeps are decimated to fit the 2k budget:

  | Models | Ratio / error |
  |---|---|
  | Hollow | 0.10–0.12 / 0.06–0.09 |
  | Warden | 0.2 / 0.05 |

  At creep scale and the default camera distance, the loss shows only as slightly faceted skulls and helmets.
- **Rebuilding one pack.** `pnpm assets:build <pack-id>` rebuilds a single pack.
- **Skin merging** (`buildSkinnedCreep`). KayKit GLBs give each body part its own glTF skin, with its own joint order. After quantisation, each skin also has its own dequantise transform folded into the inverse bind matrices. To merge the parts into one skinned mesh:
  - joint indices are remapped through the shared bone nodes;
  - each part's vertices move into the reference part's skin space;
  - props (sword, blade, staff, axe) are hung on the hand-slot bone as rigid parts.

  The root mirror (glTF → left-handed) is folded into the baked matrices. Triangle winding flips only when that transform does not mirror.

  Merging these parts naïvely (for example `mergeMeshes`) scrambles them. That is the likely cause of the `mergeMeshes: true` trouble seen in M1-02.

## 6. Budget: per-type numbers

Measured in `/creeps.html` on SwiftShader WebGL2 at 1280 × 720 (`typeStats()` and `__citadelStats`). Triangles are per instance. Draw calls are per type, whatever the instance count.

| Type | Triangles | Budget | Draw calls | VAT (w × h) | Bones |
|---|---:|---:|---:|---|---:|
| warden_melee | 1,433 | 2,000 | 1 | 168 × 153 | 41 |
| warden_ranged | 1,300 | 2,000 | 1 | 168 × 226 | 41 |
| warden_siege | 1,534 | 2,000 | 1 | 20 × 182 | 4 |
| hollow_melee | 1,975 | 2,000 | 1 | 168 × 205 | 41 |
| hollow_ranged | 1,875 | 2,000 | 1 | 168 × 234 | 41 |
| hollow_siege | 1,534 | 2,000 | 1 | 20 × 182 | 4 |
| neutral_small | 1,054 | 3,000 | 1 | 168 × 174 | 41 |
| neutral_medium | 2,725 | 3,000 | 1 | 168 × 237 | 41 |
| neutral_large | 2,649 | 3,000 | 1 | 168 × 173 | 41 |
| neutral_ancient | 3,886 | 4,000 | 1 | 168 × 321 | 41 |
| boss | 5,124 | 6,000 | 1 | 168 × 267 | 41 |

The `maxTriangles` budgets live in `creepTypes.ts`, and the e2e test asserts every type against them.

Scene totals:

| Scene | Creeps | Draw calls (whole scene) | Triangles |
|---|---:|---:|---:|
| `wave`: 2 × (12 melee + 6 ranged + 2 siege) | 40 | **10** (6 creep types + bars + rings + ground + lane) | **66,262** |
| `lane` gallery | 24 | 9 | ≈ 39k |
| `neutral` gallery | 20 | 8 | ≈ 62k |
| `camps` | 11 | 9 | ≈ 28k |

The M1 budget for 40 creeps is ≤ 150 draw calls and ≤ 300k triangles. `creeps.spec.ts` asserts both from engine counters, plus "draw calls ≤ types + 6".

## 7. Display scale

The sandbox uses the same display convention as `/units.html` (docs/design/units.md §7):

- `displayScale` 2.5 (`?scale=`) multiplies the world size of each type's `scale`;
- spacing and ranges in the sandbox scale with it.

## 8. Known gaps

- **No crossfades.** State changes cut. Blending two VAT rows per instance would need a custom shader or a second settings attribute.
- **No per-unit outline or highlight shader.** Hover and selection read through the shared rings. `UnitLook.setHighlight` is not wired for thin instances.
- **Two extra draw calls for bars and rings.** `CreepViewManager` owns its own `BarRenderer` and `RingRenderer`. Merging them with the hero manager's pair would save those 2.
- **Lane creeps sit close to the 2k cap.** hollow_melee is 1,975 and hollow_ranged is 1,875, after heavy decimation. Skulls are visibly faceted up close.
- **Neutrals read a little muted** on the green test ground. That is intended (they should not compete with faction colours), but they may want more value contrast once the real terrain lands.
- **The siege chassis is procedural.** It is boxes and cylinders under a KayKit turret. It reads as a cart at game zoom but is plain up close.
- **No VAT on WebGPU yet.** Tests run WebGL2, the M1 baseline. The baked-animation manager exists on WebGPU in Babylon 9, but it is not exercised here.
