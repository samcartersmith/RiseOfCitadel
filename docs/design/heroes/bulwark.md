# Bulwark (H01): hero model

Status: M1-11. The brief is in [art-direction.md §3, H01](../art-direction.md). This doc covers how the model is built.

Code: `apps/client/src/heroes/bulwark/`. Sandbox: `/bulwark.html` (`src/sandbox/bulwark.ts`). Test: `apps/client/tests/bulwark.spec.ts`. Unit tests: `heroes/bulwark/*.test.ts`.

```ts
import { loadBulwark } from '../heroes/bulwark/bulwark';
const bulwark = await loadBulwark(scene, { team: 'wardens' }); // a LoadedModel plus setTeam/look/renderStats
bulwark.animator.play('attack1');
```

## 1. What it's made of

| Part | Source | How |
|---|---|---|
| Body, helmet, cape | KayKit Adventurers **Knight** (`knight.glb`, Rig_Medium, already in the repo) | Same GLB and clips as the M1-10 `knight` config. The stock sword and every stock shield are hidden. |
| Gate shield | Code (`parts.ts → buildGateShield`) | A wooden arch slab with plank seams, a stone arch frame with a keystone, two iron bands with bronze studs, a swallowtail **team banner** on a bronze rod, chains with stone weights down both sides, moss clumps over the arch, and a small ember brazier on the back. About 1.45 × 2.05 units against a ~2.6-unit hero. |
| Mace | Code (`buildMace`) | A short leather grip, an iron head with six flanges, bronze bands and a pommel. |
| Pauldron stones | Code (`buildPauldronStones`) | Rough stone chunks plus a moss tuft on each upper arm. |
| Proportions | `config.ts → BONE_SCALES` | Chest ×1.08, upper arms ×1.18, hands ×1.12/1.18, head ×0.9 (re-scaled down so the helmet stays stubby). |

**Why the parts are code instead of another pack's meshes:** the brief asks for a custom low-poly gate, and code-built parts can sample our own atlas. Body and parts then share **one texture and one material**, which is what lets the merged hero draw in a single call. A KayKit dungeon prop would bring its own atlas and a second material. Everything is reproducible from source, with no binaries to hand-edit and no new asset pack, so `CREDITS.md` is unchanged. The KayKit Adventurers pack has no mace, so the mace is code-built too.

`geometry.ts` is a small pure-TS kit (box, extrude, frame band, cylinder, torus, jittered lump, arch outline) that emits flat-shaded, glTF-wound (CCW, right-handed) triangles. Unit tests check triangle counts, outward winding, and that every vertex samples its intended atlas cell.

### Attachment

Parts are rigid meshes parented to Rig_Medium bones (hero-pipeline §1). Each part's `axes` give its orientation in the bone frame. The loader cancels the inherited `BONE_SCALES` on the part node, so pushing the shoulders doesn't also inflate the mace.

- **Mace:** `handslot.r`, in the stock 1H_Sword frame.
- **Pauldron stones:** `upperarm.l` / `upperarm.r`.
- **Gate shield: `hips`, not `handslot.l`.** The KayKit clips roll the left hand by about 90° between poses. The stock shield is carried edge-forward at idle and face-forward in Block/Blocking, so no fixed hand offset keeps a 2-unit gate upright in every clip. I tried the hand (the gate went flat in the run and in the shield bash) and the chest (it tilted ~45° with the run lean). On the hips it stays an upright wall planted in front of his left side in every state, and it still bobs and turns with the body. This is a deliberate deviation from "held on his left arm" (see §7).

## 2. Clips

These are the M1-10 knight mapping (hero-pipeline §3), with heavier speeds: run ×0.85, attack1/attack2 ×0.9, cast3 ×0.85.

| State | Clip | Reads as |
|---|---|---|
| idle | Idle | |
| run | Running_A | lumbering run |
| attack1 | 1H_Melee_Attack_Chop | mace swing |
| attack2 | Block_Attack | shield bash (body lunge) |
| cast1 | 1H_Melee_Attack_Stab | Rampart Charge impact |
| cast2 | Spellcast_Raise | Challenge Horn raise |
| cast3 | 2H_Melee_Attack_Chop | Seal the Gate slam |
| channel | Blocking | |
| death | Death_A | |
| victory / hit | Cheer / Hit_A | |

## 3. Restyle: the generated palette atlas

The KayKit Adventurers textures are an **8 × 4 grid of vertical-gradient cells**. The bottom row is one full-width gradient, and each cell has a thin bevel strip near its right edge. Every face samples one cell. Bulwark keeps the Knight's UVs and swaps in an atlas generated at load time (`palette.ts → buildAtlasPixels`, 256², a `RawTexture`), painted from the art-direction palette:

| Cell (col,row) | Knight used it for | Bulwark |
|---|---|---|
| 3,0 | main plates (steel) | warm stone `#CFC6B4` |
| 7,0 | plate trim | bronze `#B07A3C` |
| 4,0 / 7,1 / 2,1 | gauntlets / undersuit, boots / mail | darker stone / dark leather / iron mail |
| 0,1 | red cape and tabard | **team cloth** |
| 6,0 | belt and straps | **team-dyed leather** |
| 1,1 | white trim | cream `#EFE6D2` |
| 0,0 1,0 2,0 | face | unchanged skin tones |
| 5,0 3,1 4,1 5,1 6,1 0,2 1,2 2,2 | (unused by the Knight) | gate wood, gate stone, bright bronze, grip, chain iron, moss `#6F9A4E`, rubble, ember |
| 3,2 | (unused) | **shield banner team cloth** |

The atlas is the source material. The **Citadel toon material (M1-02)** is applied on top through `toonMaterialFor` (`material.ts → bulwarkToonMaterial`), so Bulwark gets the same ramp, rim, height gradient and palette gradient-map as every other unit.

## 4. Team colour

The mask follows M1-02's **atlas UV-rectangle** convention (toon-shader.md, "Team-colour mask"). `BULWARK_TEAM_MASK` holds the rectangles of the three team cells: cape/tabard (0,1), straps (6,0) and the dedicated **gate-shield banner cell (3,2)**. The team cells are painted as *undyed* light gradients, and the toon tint (`teamColor × (0.6 + 0.7·luma)`) dyes them gold for Wardens and violet for Hollow, keeping the gradient. Neutral shows undyed cloth.

The Knight alone had too little team colour from the front: M1-02 measured its team area as mostly on the back (cape) and top (crest). Bulwark's front is the shield, so the shield banner is the fix. Measured in the e2e test (`teamCoverage()`: each model drawn with an unlit mask material, team pixels ÷ model pixels, idle pose):

| View | Bulwark | stock Knight (M1-02 mask) | Target |
|---|---|---|---|
| Front close-up | **28.4%** | 11.7% | ≥ 20% |
| Default MOBA camera (55°, distance 60, 2.5× display scale) | **21.9%** | 14.7% | ≥ 20% |

`createBulwarkLook` is a `UnitLook` (toon material per team plus outline highlight). `UnitView` can't host Bulwark yet: `ModelId` is fixed in `units/modelConfig.ts` and UnitView always calls `loadModel`. A small units/ follow-up should let a model config name a custom loader and look (see §7).

## 5. Budget (measured)

| | Triangles | Draw calls | Materials | Texture |
|---|---|---|---|---|
| **Bulwark (merged)** | **6,144** (body + helmet + cape 4,712, parts 1,432) | **1** | 1 toon material per team, shared by all instances | one 256² generated atlas |
| Stock Knight (merged, sword + shield) | 5,274 | 1 | 1 | 1024² PNG |
| Budget (art direction §2.3) | ≤ 8,000 | ≤ 2 | ≤ 2 | one 1024² atlas |

The e2e test checks the draw call two ways: per instance (`renderStats`) and scene-wide with only Bulwark on screen (`setSolo` → SceneInstrumentation: 1 draw, 6,144 triangles). `parts.test.ts` checks body + parts ≤ 8k triangles straight from the committed GLB.

## 6. Merge fix (found here, belongs to units/)

`mergeSkinnedParts` (M1-13) assumes every skinned part of a character shares one skeleton. In our GLBs they don't. `pnpm assets:build` quantizes each mesh, and gltf-transform folds each mesh's dequantization into that mesh's own skin (its inverse bind matrices). Babylon loads one `Skeleton` per skin, so merging onto the first part's skeleton put the other parts in the wrong space. Up close the merged Knight rendered with its body mirrored behind the head (cape in front, face floating). It's invisible at unit-sandbox zoom, but it's there for **every** merged unit.

This used to live here as `heroes/bulwark/merge.ts → unifySkins`. M1-13b moved and generalised it into `units/mergeModel.ts` (`unifySkins` + `skinRemap.ts`: bone remap by joint node plus a bind-pose rebake), so `mergeSkinnedParts` is now exact for every unit, and Bulwark calls it directly. See units.md §4.

## 7. Known gaps

- **Shield on the hips, not the arm.** A planted-shield idle, a charge loop, the overhead shield slam (cast3) and "falls behind his shield" all need custom clips. The shield doesn't swing with the arm in attack2/cast3; the body lunge carries the bash. The Quaternius fallback path (hero-pipeline §1) or a Blender pass would fix it.
- **The silhouette is a "walking wall" block** next to the Knight's slim figure plus sword. It's distinct at the MOBA zoom, but at ~60 px the arch top and the chains merge into a rounded block.
- **The brazier doesn't glow yet.** The ember cell is bright in the albedo only. The ult glow is a VFX job (M1-12 library) or an emissive mask later.
- **Left arm clipping:** in some poses the left hand passes through the back of the shield.
- **UnitView integration:** done in M1-13b. `heroes/bulwark/unitModel.ts → registerBulwarkUnitModel()` registers `modelId: 'bulwark'` (units.md §9).
- **The pauldron stones are small** and read mostly from above.
