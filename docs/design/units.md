# Unit views (M1-13)

Status: M1-13. A `UnitView` is the presentation object for any unit: a hero, a lane creep or a neutral. It is driven **only** by a plain `UnitViewState`, so the M2 sim bridge (M2-12) and later the M3 netcode can drive it without touching Babylon. Model loading and animation come from the hero pipeline ([hero-pipeline.md](hero-pipeline.md)).

Code: `apps/client/src/units/`

| File | What it does |
|---|---|
| `unitState.ts` | `UnitViewState` contract, teams, relation (ally/enemy/neutral), readability colours. Pure data. |
| `motion.ts` | Position smoothing/snap and shortest-angle facing. Pure, tested in `motion.test.ts`. |
| `barMath.ts` | Bar fill, damage-trail stepping, bar layout, tick spacing. Pure, tested in `barMath.test.ts`. |
| `diff.ts` | State diffing by id and screen-space picking. Pure, tested in `diff.test.ts`. |
| `unitView.ts` | `UnitView`: owns the model instance and its `AnimationController`. |
| `unitViewManager.ts` | `UnitViewManager`: creates/updates/disposes views each frame, owns the shared bars and rings. |
| `bars.ts` | All HP/mana bars in one thin-instanced draw call (custom GLSL + WGSL shader). |
| `rings.ts` | All selection/hover rings in one thin-instanced draw call. |
| `look.ts` | The `UnitLook` seam for team rim + highlight outline, with a fallback until the toon shader lands. |
| `mergeModel.ts` | Folds a KayKit character's parts into 1–2 skinned meshes (the draw-call fix, §4). |
| `skinRemap.ts` | Pure skin-unification math used by the merge (bone remap + bind-pose rebake). Tested in `skinRemap.test.ts`. |
| `skinBounds.ts` | CPU-skinned world bounds of a model, for the merge regression test. |
| `modelRegistry.ts` | `registerUnitModel`: custom unit models with their own loader and look (§9). |

Sandbox: `/units.html` (`apps/client/src/sandbox/units.ts`). Tests: `apps/client/tests/units.spec.ts`, `apps/client/tests/unitMerge.spec.ts`.

## 1. The state contract

```ts
interface UnitViewState {
  id: number;                 // sim entity id, stable for the unit's lifetime
  modelId: UnitModelId;       // a base ModelId ('knight' | 'rogue_hooded' | 'mage' | 'skeleton_minion') or a registered id ('bulwark'), §9
  team: 'wardens' | 'hollow' | 'neutral';
  position: { x: number; z: number }; // ground position; y comes from terrain later
  facing: number;             // radians; 0 faces +z (north), +π/2 faces +x (east)
  animState: LogicalState;    // states.ts: idle, run, attack1, ..., death
  animSeq?: number;           // bump to replay a one-shot that is already the current animState
  attackSpeedScale: number;   // 1 = clip's natural speed
  hp: number; maxHp: number;
  mana?: number; maxMana?: number; // heroes only
  level?: number;             // heroes only (shown by the M2-13 HUD, not by the bar)
  isHero: boolean;
  selected: boolean;
  hovered: boolean;
  visible: boolean;           // false = hidden by fog / not spawned: model, bar and rings all hide
  snap?: boolean;             // skip smoothing this update (spawn, respawn, blink, teleport)
}
```

Rules:

- **It's plain data.** No Babylon types, no methods, cheap to copy. The bridge can reuse one object per unit and mutate it in place, or build new ones each frame.
- **The view never writes back.** Selection and hover are inputs too: the input layer decides what is selected and writes `selected`/`hovered`. The manager's `pick(x, y)` helps it decide.
- **Gameplay stays in the sim.** The view doesn't decide when an attack lands, when a unit dies or how far it moves. It shows what the state says.

## 2. Update semantics

`manager.sync(states, dt)` once per render frame (before `scene.render()`). It diffs `states` against live views by `id`:

| Case | Result |
|---|---|
| New id | A `UnitView` is created. Its model loads asynchronously (the GLB is cached per scene and cloned). The first state is applied with `snap`, so it never slides in from the origin. Until the model is loaded the unit has no bar or ring. |
| Known id | `view.update(state, dt)`. |
| Known id, different `modelId` | The old view is disposed and a new one created (hero swap, morph). |
| Id missing from `states` | The view is disposed: model, animator and skeleton are freed. |
| Duplicate ids | Only the first is used. The manager warns once. |

Inside `update`:

- **Position** eases toward the state with frame-rate independent exponential smoothing (`rate` 18/s by default; ~0.17 s to cover 95% of a step). It **snaps** when `state.snap` is set, when the gap is longer than `snapDistance` (6 world units), or when smoothing is turned off with `{ smoothing: { rate: 0 } }`. The sim ticks at 30 Hz, so without smoothing units would visibly step at 30 Hz on a 60–144 Hz display.
- **M3 netcode:** remote units will arrive as snapshot-interpolated positions. At that point either keep a small `rate` as a jitter filter or set `rate: 0` and let the netcode's interpolation be the only smoothing. Teleports must still set `snap` either way.
- **Facing** turns the short way round at up to `turnRate` (14 rad/s ≈ a half-turn in 0.22 s). `snap` makes it instant. This is a view-side turn. The sim's own turn rate (if M2 adds one, DotA-style) is what decides when a unit can act.
- **Animation:** when `animState` changes, the controller crossfades to it. A one-shot that is already playing replays only when `animSeq` changes, so a continuous attack is `animState: 'attack1'` plus `animSeq++` per swing. When a one-shot finishes, the controller falls back to idle on its own (see hero-pipeline.md). If the sim then sends `idle`, nothing changes. `attackSpeedScale` sets the speed of `attack1` and `attack2`.
- **Death:** `animState: 'death'` holds the last frame, and the bar hides (`hp <= 0` hides it too). On respawn send `idle` with `snap: true`.
- **Visibility:** `visible: false` disables the unit's node (no draw calls) and drops its bar and rings. Smoothing keeps running, so the unit doesn't slide when it reappears. For a unit that reappears far away, set `snap`.

## 3. Bars

All bars are **one draw call**: a unit quad thin-instanced once per visible unit (`bars.ts`). Per instance it gets the anchor position (in the instance matrix) and 12 floats: HP fill, trail fill, mana fill, max HP for ticks, width/height/mana-height/lift in pixels, colour and alpha. The vertex shader projects the anchor and expands the quad in **screen pixels**. That keeps bars facing the camera at a constant size at every zoom. The fragment shader draws the frame, the fill, the trail, the tick marks and the mana row. No textures and no per-unit GUI controls.

| | Hero | Creep / neutral |
|---|---|---|
| Size (CSS px) | 72 × 8 HP + 4 mana | 44 × 5 HP |
| Chunk ticks | every 100 HP (dropped if closer than 2.5 px) | none |
| Lift above anchor | 6 px | 4 px |

- **Colours** come from the local player's point of view (`localTeam`, default Wardens): ally green `#46A758`, enemy red `#E5484D`, neutral yellow `#E8C547`, mana blue `#3E8EDE`, missing HP `#1B1A1F`, damage trail `#F4E3B5`.
- **Damage trail:** on damage the trail holds at the old HP for 0.45 s, then drains at 0.8 bar-widths/s. Healing pulls it up instantly. Math in `barMath.ts → stepTrail`.
- **Anchor height** per model: `barAnchorHeight` in `modelConfig.ts` (world units at scale 1, times the model's `scale`). It sits just over the head/hat. The bar doesn't follow the head bone, so a cast animation never makes it bob.
- **Draw order:** bars render in rendering group 2 with depth testing off, so they're always on top of the world. They're sorted back to front every frame, so nearer bars overlap farther ones.
- **DPR:** sizes are in CSS pixels and scaled by render-pixels per CSS pixel, so they look the same on a 2× display and under the Low tier's render scale.
- **WebGPU:** the shader ships in GLSL and WGSL. No GLSL→WGSL conversion step is needed.

**Budget:** bars + rings cost **2 draw calls total** and ≈ 2 triangles per bar, whatever the unit count. CPU cost is filling ~20 floats per unit per frame plus a sort.

## 4. Draw calls: model merging

A KayKit character is about 6 skinned body parts plus rigid props (sword, shield, helmet, cape), so ~10 draw calls each. Fifty units would be ~470 draw calls before anything else (measured: 474 with merging off, `?merge=0`).

`loadModel(..., { mergeMeshes: true })` (used by `UnitView`; off by default, so `loadModel`'s existing behaviour is unchanged) calls `mergeSkinnedParts`:

- Every visible part using the same material is folded into **one skinned mesh** on the first skinned part's skeleton.
- **Skins are unified first** (`unifySkins` → `skinRemap.ts`). Each body part in our GLBs has its **own glTF skin**, so Babylon gives it its own `Skeleton` (same joint nodes, but its own joint order and its own inverse bind matrices). `pnpm assets:build` quantizes each mesh, and gltf-transform folds that mesh's dequantization transform `D` into its skin: `IBM_part[j] = D · IBM_ref[j']`. Merging the raw parts onto one skeleton put every other part in the wrong space; up close, the Knight's body rendered mirrored behind its head. Now each part's joint indices are remapped onto the reference skeleton **by joint node** (`j → j'`), and its positions/normals are rebaked through `D` (checked to be one constant matrix over every joint the part uses), so it skins identically. If a part can't be unified, the merge is skipped and the model renders unmerged. No source geometry is modified (clones share geometry with the cached container).
- Rigid props are re-expressed in bind space and skinned 100% to the bone their attachment node hangs from. They still follow the hand/head exactly.
- Hidden spare props are left alone (still disabled, still available for kit-bashing).
- If a model breaks the assumptions (skins that differ by more than a constant matrix, a joint missing from the reference skin, more than 4 influences), the merge is skipped and the model renders unmerged.
- The merged mesh keeps the glTF winding (`sideOrientation` of the source parts). It works at any pose and under any parent transform, including a rotated and scaled one.
- **Regression tests:** `skinRemap.test.ts` (Vitest) checks that a rebaked part skins vertex-for-vertex identically on the reference skeleton with permuted joints and a quantization transform, in random poses. `tests/unitMerge.spec.ts` (Playwright) loads three Knights in the same pose: unmerged, merged under a rotated and scaled parent, and merged by `loadModel` then parented. It checks that their CPU-skinned world bounding boxes, centroids and vertex counts match within 0.02 world units, under two parent rotations. Before the fix they were off by 0.5.

Result: **1 draw call per hero model**, **2 per skeleton_minion** (body + its separate glowing-eye material). Animation is unaffected, because animation groups drive the bone transform nodes, not the meshes. Each unit still has its own skeleton, since every unit animates independently.

## 5. Team rim, outline and the toon-shader seam

`look.ts` defines how a model shows its team and its highlight state:

```ts
interface UnitLook {
  setTeam(team: Team): void;
  setHighlight(mode: 'none' | 'hover' | 'selected', color: Rgb): void;
  dispose(): void;
}
setUnitLookFactory(factory) // swap the implementation for units created afterwards
```

**Fallback (current):**

- **Team rim:** a shared `StandardMaterial` per (source material, team) on the same albedo texture. It adds a faint faction tint plus an emissive fresnel rim (Wardens gold `#E8B54A`, Hollow violet `#8E5BD9`, neutrals a dim grey). It's added on top of the lit colour (`useEmissiveAsIllumination`), so it reads even on the dark skeleton texture. Shared materials mean no extra draw calls and no per-unit shader variants.
- **Highlight:** Babylon's outline renderer, on selected/hovered units only: relation colour for selection, pale for hover. It costs one extra draw call per outlined mesh, so a handful per frame.

**Toon look (M1-02).** `installToonUnitLook()` (`render/shaders/toonUnitLook.ts`) swaps in the toon material's factory (team colour through the atlas mask, see toon-shader.md). It only affects views created **after** the call, so call it once at startup, **before the first `UnitViewManager.sync`**:

- **Game:** in the game's scene setup (the `main.ts` boot scene today, the M2-12 sim-bridge setup later), right after the scene is created, next to `registerBulwarkUnitModel()` and the other hero registrations (§9).
- **Units sandbox:** `sandbox/units.ts` calls it at startup. `?look=fallback` keeps the fallback rim below, `?look=0` turns looks off.

A model registered with its own `look` (§9) uses that instead of the global factory. The fallback's materials are only created when the fallback is used.

The ground rings (`rings.ts`) aren't part of the look. They're always drawn: selection is a relation-tinted ring at `selectionRadius` (from the model config), hover is a faint pale ring (slightly larger if the unit is also selected).

## 6. Sandbox and debug hook

`/units.html?n=50` (0–100, also on a slider). `?engine=webgl` forces WebGL2. `?merge=0` turns merging off. `?scale=1` shows true config scale (the default is 2.5, see §7). The toon look is installed at startup; `?look=fallback` uses the fallback rim, `?look=0` disables looks. The hero rotation is knight, rogue_hooded, mage and **Bulwark** (a registered custom model, §9), so 50 units include two Bulwarks.

A fake driver stands in for the sim. It owns plain states and mutates them: units wander their half of the lane, close on nearby enemies, attack (with `animSeq` per swing), heroes sometimes cast and spend mana, units die (death anim), then respawn with `snap`. It's seeded, so screenshots repeat.

- Click selects, shift-click toggles, hovering highlights. Camera: the M1-03 MOBA camera.
- `window.__citadelUnits`: `count`, `setCount`, `ids`, `counts`, `state`, `select`, `hover`, `damage`, `reviveAll`, `pause`, `bar(id)` (what was actually uploaded to the bar buffer), `rings(id)`, `screenPos`, `pick`, `frames`, `unitMeshes(id)` (rendered meshes and whether they use the toon material) and `mergeCheck(opts)` (the merge regression check, §4).
- `window.__citadelReady` is set 30 frames after every model has loaded. `window.__citadelStats` is published every 15 frames.

## 7. Measured budget and open items

Measured in the Playwright run (headless Chromium, SwiftShader WebGL2, 1280×720, every unit alive and in view, no shadows or post-processing):

| Units | Draw calls | Triangles | Within budget (≤ 150 / ≤ 300k) |
|---|---|---|---|
| 50 (9 heroes incl. 2 Bulwarks, 37 lane creeps, 4 neutrals; toon look) | **94** | **265k** | yes |
| 100 | **190** | **537k** | **no** |
| 50, merging off | 474 | 273k | no |

What's left:

- **Triangles are the creep art.** `skeleton_minion` is 5.3k triangles, against the art budget of ≤ 2k per creep (art-direction.md §2.3). With 2k creeps, 100 units would be ~250k triangles. That's **M1-14** (creep art budget).
- **The second draw call per creep** is the skeleton's separate glow-eye material. M1-14's creeps should use one material (eyes in the atlas, glow from emissive in the toon shader), giving 1 draw call per unit (~105 at 100 units).
- **Shadows** aren't on in the sandbox. A shadow caster is drawn once more per cascade (High tier, 3 cascades), so units would cost 4× there. **M1-15** decides which units cast and with what LOD.
- **Unit scale vs. camera distance is still open.** At config scale 1 and the default camera distance (60), a hero is ~15 px tall at 720p, which is too small. The sandbox draws units at 2.5× (`displayScale`) to read like a MOBA. The boot scene does the same (3×) for its sample hero. The real fix belongs to the map/camera retune (M1-04/M1-05 with M1-03's numbers). `UnitViewOptions.displayScale` covers it until then.
- **Readability at default zoom:** bars make teams obvious at a glance. Without bars, heroes are told apart by silhouette and the rim is subtle. Wardens and Hollow skeleton creeps differ only by a warm vs. violet rim on a dark model, which is weak. A proper team-colour mask (art-direction §2.2: ≥ 20% of a hero's surface, an accent on creeps) is M1-02/M1-14's job.
- **Picking** is screen-space against each unit's body centre (no ray casts against skinned meshes). That's cheap and forgiving at MOBA zoom. If units ever need pixel-exact picking, add a GPU picking pass.

## 8. How M2-12 feeds it

```ts
const views = new UnitViewManager(scene, { localTeam: myTeam });
// each render frame:
const states = bridge.unitStates(alpha); // UnitViewState[], built from the latest sim snapshot(s)
views.sync(states, dt);
scene.render();
```

- The bridge maps sim entities to `UnitViewState`. It translates sim facts into presentation fields: the sim's attack-start event becomes `animState: 'attack1'` and `animSeq++`, death becomes `'death'`, respawn and blink become `snap: true`, and fog of war becomes `visible`.
- Selection lives in input/bridge state, not in the sim. Write `selected`/`hovered` into the states each frame, and use `views.pick(x, y)` for clicks and hover.
- `views.get(id)?.animator?.onEvent(...)` is still available for view-only effects (a swing's whoosh, VFX at the attack point). Gameplay timing (when damage lands) comes from the sim.
- The sim runs at 30 Hz and renders at display rate. Either hand the manager the latest snapshot and let smoothing hide the steps, or interpolate between the last two snapshots in the bridge and turn smoothing off.

## 9. Custom unit models

Most units are a base GLB plus a `ModelViewConfig` (`modelConfig.ts`), loaded with `loadModel`. Kit-bashed heroes build their model in code and bring their own look, so `modelRegistry.ts` lets a hero module register itself:

```ts
registerUnitModel('bulwark', {
  config: BULWARK_VIEW_CONFIG,              // scale, barAnchorHeight, selectionRadius
  load: (scene, { mergeMeshes, initialState }) =>
    loadBulwark(scene, { merge: mergeMeshes, look: false, initialState }),
  look: createBulwarkLook,                  // optional; overrides the global UnitLook factory
});
```

- `UnitViewState.modelId` is a `UnitModelId`: a base `ModelId` or any registered id. `UnitView` checks the registry first, then `MODEL_CONFIGS`, and throws for an unknown id.
- `load` returns a `LoadedModel` (root, meshes, animator, dispose). UnitView parents its root under the unit's node, drives the animator and disposes it with the view, exactly like a base model.
- `look` is optional. Without it, the global factory (`setUnitLookFactory` / `installToonUnitLook`) is used.
- units/ never imports heroes/. The hero registers itself: `heroes/bulwark/unitModel.ts → registerBulwarkUnitModel()`. Call it once at startup, before any view with that id is created (the units sandbox does).
- Ids must be unique. Registering an existing id replaces it, so registration is idempotent.
