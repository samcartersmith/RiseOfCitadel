# Hero pipeline: rig, animation and model conventions

Status: M1-10. This doc covers how a character model gets from a CC0 pack into the game and plays animations. Hero-specific art (kit-bash, restyle) builds on it in M1-11 and M2-16.

## 1. Rig convention

- **All characters use the KayKit rig family** (`Rig_Medium` for the Adventurers and Skeletons). Every model in that family has the same bone names and the same animation clip names, so clips and logical-state mappings carry over between models.
- Props (weapons, shields, hats, capes) are **rigid meshes parented to attachment bones**: `handslot.r`, `handslot.l`, `head`, `chest`. A prop follows the bone without skinning, and swapping one is just a matter of showing a different child mesh or parenting a new one to the slot.
- **Fallback:** if KayKit lacks a clip we need, the **Quaternius Universal Animation Library** (CC0) is the backup source. It uses a different skeleton, so its clips must be retargeted onto Rig_Medium offline (Blender) and baked into the model's GLB before we use them. Nothing has needed this yet.
- glTF characters face **+Z**. Gameplay code rotates the root node and never the bones.

## 2. Logical animation states

Gameplay and view code never use clip names directly. They play **logical states** (`apps/client/src/units/states.ts`):

| State | Kind | Default after it ends |
|---|---|---|
| `idle`, `run`, `channel` | loop | (keeps looping) |
| `attack1`, `attack2` | one-shot | `idle` |
| `cast1`, `cast2`, `cast3` | one-shot | `idle` |
| `hit`, `victory` | one-shot | `idle` |
| `death` | one-shot | **holds the last frame** (the view plays `idle` on respawn) |

`AnimationController` (`apps/client/src/units/animation.ts`):

- `play(state, { blend?, speed?, fallback?, restart? })` crossfades to the state's clip using Babylon animation-group **weights**. Weights always sum to 1, even when a fade is interrupted, so the rest pose never leaks in.
- One-shots start fading back to their fallback `blend` seconds before the clip ends, so there's no freeze on the last frame.
- `setSpeed(state, multiplier)` is a persistent speed scale, e.g. attack speed. If a 1.0 s attack clip should play 1.7 times per second, call `setSpeed('attack1', 1.7)`.
- `onEvent(state, t, handler)` fires when the state's clip crosses normalized time `t` (0..1). This is how the **attack point** will be timed: the hit lands at a specific frame. An attack that is interrupted (attack cancel) does **not** fire its later events. One that finishes naturally fires them even while it fades out.
- It's driven by `scene.onBeforeAnimationsObservable` when given a `scene`, or by `update(dt)` manually.

## 3. Model view configs

Each base model has a typed config in `apps/client/src/units/modelConfig.ts`: URL, scale, prop visibility and the state → clip map. `loadModel(scene, config)` (`units/loadModel.ts`) loads the GLB once per scene into an `AssetContainer`, clones an instance, applies prop visibility and returns `{ root, meshes, animator }`.

Current clip mapping:

| State | knight (Bulwark) | rogue_hooded (Kestrel) | mage (Cinderwright, Lantern) | skeleton_minion |
|---|---|---|---|---|
| idle | Idle | Idle | Idle | Idle |
| run | Running_A | Running_A | Running_A | Running_A |
| attack1 | 1H_Melee_Attack_Chop | 1H_Ranged_Shoot | Spellcast_Shoot | 1H_Melee_Attack_Chop |
| attack2 | Block_Attack | 2H_Ranged_Shoot | 2H_Melee_Attack_Slice | 1H_Melee_Attack_Slice_Diagonal |
| cast1 | 1H_Melee_Attack_Stab | Dodge_Forward | Spellcast_Long | Spellcast_Shoot |
| cast2 | Spellcast_Raise | Spellcast_Shoot | Spellcast_Raise | Spellcast_Raise |
| cast3 | 2H_Melee_Attack_Chop | Throw | 2H_Melee_Attack_Chop | Spellcast_Summon |
| channel | Blocking | 1H_Ranged_Aiming | Spellcasting | Spellcasting |
| death | Death_A | Death_B | Death_A | Death_C_Skeletons |
| victory | Cheer | Cheer | Cheer | Taunt |
| hit | Hit_A | Hit_B | Hit_A | Hit_B |

### Adding a model

1. Add the source file to the pack's `assets-src/<pack>/manifest.json` `models[]` (see §5).
2. Add a `ModelId` and a config to `MODEL_CONFIGS`, and spare clips to `SPARE_CLIPS`. List the GLB's clip names with `pnpm assets:build` output, or read the GLB's JSON chunk.
3. Set the manifest entry's `keepAnimations` to exactly the config's clips plus spares, then run `pnpm assets:build`.
4. `pnpm test` runs `tools/assets/modelConfig.test.ts`, which fails if the config, the manifest and the committed GLB disagree.
5. Check it in the sandbox: `pnpm dev`, then open `/anim.html`.

A hero whose model is built in code (a kit-bash on a base body, like Bulwark) doesn't add a `ModelId`. It registers a custom unit model with its own loader and look (`registerUnitModel`, see [units.md §9](units.md#9-custom-unit-models)).

### Team-colour mask authoring

Team colour (art direction §2.2: ≥ 20% of a hero's visible surface, an accent on creeps) comes from the toon shader's **UV-swatch mask**, not from a mask texture or mesh names. The convention is in [toon-shader.md → Team-colour mask](toon-shader.md#team-colour-mask-atlas-uv-rectangles). In short:

- **Atlases are 8 × 4 grids of gradient swatches**, and every face samples exactly one swatch. The mask is a list of swatch rectangles in UV space (`render/shaders/teamMask.ts → TEAM_MASKS`). Texels inside any rectangle take the team colour, scaled by the swatch's own light-to-dark gradient.
- **Authoring a base model:** find which swatch each team part samples (the `/toon.html` hook's `setTeamMask` helps), add those (column, row) rectangles to `TEAM_MASKS`, and check renders from the default camera for the ≥ 20% target.
- **Kit-bashed parts** (code-built or new meshes): put every team-coloured face on a **dedicated team swatch** and nothing else on it, so one rectangle tints exactly those faces. Bulwark does this with his generated atlas (`heroes/bulwark/palette.ts → BULWARK_TEAM_MASK`). Don't share a team swatch with skin, metal or other non-team faces.
- **The mask survives merging** (UVs are kept, mesh names aren't), and it's a uniform, so it costs no extra materials or draw calls.
- If a model can't be authored this way (team parts share swatches with non-team parts), ship a mask texture instead and note it in the hero's doc.

### Prop hiding

KayKit characters ship with every weapon attached. A config's `props.show` lists the meshes the view uses. `props.hide` lists spares still in the GLB that start disabled (kept for kit-bashing). Props the hero will never use are removed from the GLB by the pipeline (`removeNodes`), so they cost nothing to download. Babylon names a multi-primitive mesh `<name>_primitive<n>`, and `applyPropVisibility` matches both forms.

## 4. Sandbox

`/anim.html` (`apps/client/src/sandbox/anim.ts`) shows all four models side by side.

- **Buttons and keys:** `1`–`9`, `0`, `-` play the states in order, `←`/`→` select a model, and `A` toggles "all models".
- **Sliders:** blend time (0–1 s) and playback speed.
- **Attack point:** each label flashes when `attack1`'s attack-point event (t = 0.5) fires.
- **Debug hook:** `window.__citadelAnim` exposes `play`, `state`, `clip`, `weights`, `duration`, `setBlend` and `attackPoints`.
- **Ready flag:** the page sets `window.__citadelReady` after 30 frames.
- **Test:** `apps/client/tests/anim.spec.ts` drives the hook and saves screenshots.

## 5. Asset pipeline options

`pnpm assets:build` (`tools/assets/build.ts`) reads each manifest `models[]` entry. These fields are optional, and an entry without them builds exactly as before:

| Field | Effect |
|---|---|
| `keepAnimations: string[]` | Keep only these clips. Every name must exist in the source, so a typo fails the build. |
| `removeNodes: string[]` | Delete these nodes and their subtrees (unused props). Every name must exist. |
| `keepNodes: string[]` | Keep only these **mesh** nodes and delete every other node that carries a mesh, including skinned body parts, so list those too. Bones and attachment slots are never touched. |
| `quantize: boolean` | Default `true` (KHR_mesh_quantization). Set it to `false` if quantization ever breaks a model's skinning. The current four models skin correctly when quantized. |

The trimming runs before `dedup → resample → prune → weld → quantize`. Animation samplers and channels are disposed explicitly, so `prune` really drops their keyframe accessors.

Effect on the committed models (M1-10):

| Model | Before | After | Clips |
|---|---|---|---|
| knight.glb | 2662 KB | 740 KB | 76 → 15 |
| rogue_hooded.glb | 2628 KB | 673 KB | 76 → 15 |
| mage.glb | 2626 KB | 704 KB | 76 → 15 |
| skeleton_minion.glb | 3503 KB | 822 KB | 95 → 15 |

## 6. Budgets (from art direction §2.3)

- **Hero:** ≤ 8k triangles, one 1024² atlas, ≤ 2 materials. The stock KayKit heroes are about 5.7–7k triangles with every prop attached, and about 5.3k for the Knight as configured (shown props only), with one 1024² texture. That leaves some room for kit-bash parts.
- **Creep:** ≤ 2k triangles on a shared atlas. The stock skeleton minion is about 5.3k, so M1-14 must decimate it or use a lighter body.
- **Structure:** ≤ 6k triangles, with LODs.
- **Shared rig:** every character uses one rig family, so animations are shared.

## 7. Silhouette check

Every hero must be identifiable as a black silhouette at 64 px tall (art direction §2.2). The procedure for each hero PR:

1. In the sandbox, set the camera to the game angle (~55° pitch) at mid zoom.
2. Render the hero with an unlit black material on a white background. A temporary toggle in the sandbox or a Playwright script both work.
3. Downscale the capture so the hero is 64 px tall, and put it next to the other heroes' silhouettes.
4. It passes when a reviewer can name each hero from its silhouette alone, in idle **and** in its attack pose. The hook (gate shield, kestrel on the shoulder, crucible, lantern) must break the outline.
5. Attach the silhouette sheet to the PR.
