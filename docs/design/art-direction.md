# RiseOfCitadel — Art Direction & Hero Briefs

Status: **approved**, including the hero names and all four hero briefs (roadmap item M0-07). All four heroes are original characters.

---

## 1. Strategy: restyle free assets, don't model from scratch

We have no art team, so every visual starts from **CC0 asset packs** and is pulled into one look by **our own shaders, palette and kit-bashing**, not by repainting each asset. CC0 means free for commercial use, with no attribution required. That approach is how mismatched packs end up looking like one game.

### 1.1 Approved sources (CC0 unless noted; verify on download and record in `CREDITS.md`)

| Source | What we use it for | License |
|---|---|---|
| **KayKit Character Pack: Adventurers** (Kay Lousberg) | Base meshes for heroes. 4 rigged, textured characters plus weapons/props | CC0 ✅ ([itch.io](https://kaylousberg.itch.io/kaykit-adventurers)). The creator asks that unmodified copies not be resold. |
| **KayKit Character Animations** | Shared animation set for KayKit rigs (Rig_Medium / Rig_Large) | CC0 ✅ ([itch.io](https://kaylousberg.itch.io/kaykit-character-animations)) |
| **KayKit Skeletons** and other KayKit packs (dungeon, forest, medieval builder) | Scourge-side creeps, structures, props | CC0 (verify each pack) |
| **Quaternius Universal Animation Library 1 & 2** | 120+ humanoid animations on a universal rig (backup/extra animations) | CC0 ✅ (free "Standard" tier; [quaternius.com](https://quaternius.com/packs/universalanimationlibrary.html)) |
| **Quaternius** nature / fantasy packs | Trees, rocks, foliage, monsters for neutral camps | CC0 (verify each pack) |
| **Kenney** (kenney.nl) | UI icons, castle/nature kits, particle textures, sound effects | CC0 |
| **Poly Haven** | HDRIs for lighting reference, a few PBR textures | CC0 |
| **ambientCG** | Tileable terrain textures (grass, dirt, stone, snow, water normals) | CC0 |

**Rules:**
- Only use assets with a clear CC0 (or CC-BY with attribution) license, recorded per file in `CREDITS.md`.
- Don't use any pack whose license we can't verify.
- Don't use paid tiers unless you approve the cost.
- Don't use ripped or "free download" mirrors. Get every asset from the creator's own page.

### 1.2 How we make it *ours*
1. **One toon/painterly shader for everything.** Two-to-three-step lighting ramp, a soft rim light, a hand-painted-style color gradient by height, and a mask channel that tints team color.
2. **One palette.** Every texture is remapped to the palette below with a palette-swap/gradient-map step, so packs from different artists match.
3. **Kit-bashing.** Each hero combines parts from several packs plus custom simple geometry (shields, lanterns, crucibles), so no hero looks like the stock character.
4. **Scale & silhouette.** Hero proportions are pushed (bigger hands, weapons and shoulders) so they read from the MOBA camera.
5. **VFX carry identity.** Each hero has a signature VFX color and shape language, built from shared particle textures.

---

## 2. World & Factions

**Setting:** a ruined mountain citadel sits on a broken leyline. Two factions fight over the river of raw light that runs through it.

| | **The Wardens** (bottom-left) | **The Hollow** (top-right) |
|---|---|---|
| Theme | Living stone, bronze, banners, warm hearth-light | Ash, iron, cold violet fire, overgrown ruin |
| Terrain | Green moss on pale stone, golden grass | Grey ash, black rock, dead violet-tinted trees |
| Structures | Stone watchtowers with bronze caps and glowing braziers | Iron spires with chains and floating violet embers |
| Ancient | **The Hearthstone**: a giant glowing keystone | **The Hollow Crown**: a broken iron crown hovering over a rift |
| Team color | Gold `#E8B54A` | Violet `#8E5BD9` |

**River:** pale cyan light-water `#7FE3E0`, with floating motes. It's neutral ground.

### 2.1 Master palette

| Use | Hex |
|---|---|
| Warden stone | `#CFC6B4` |
| Warden moss | `#6F9A4E` |
| Warden bronze | `#B07A3C` |
| Hollow ash | `#5E5A63` |
| Hollow iron | `#2E2B33` |
| Hollow ember | `#8E5BD9` |
| River light | `#7FE3E0` |
| Danger / enemy highlight | `#E5484D` |
| Ally highlight | `#46A758` |

### 2.2 Readability rules (MOBA camera ~55°, mid zoom)
- **Heroes:** strongest value contrast on the screen. A bright rim light. The team-color mask on at least 20% of the visible surface (cloak, shield face, banner).
- **Creeps:** lower saturation than heroes, and smaller. Team color only on an accent such as a shoulder or banner.
- **Terrain:** mid-to-low contrast so units pop. No busy high-frequency texture in lanes.
- **VFX priority:** enemy hard disables (red-edged decals) > ally buffs > damage > ambient.
- **Silhouettes:** every hero must be identifiable as a black silhouette at 64 px tall.

### 2.3 Performance budget (WebGL)
- Hero: ≤ 8k triangles, one 1024² atlas, ≤ 2 materials.
- Creep: ≤ 2k triangles, a shared atlas.
- Structure: ≤ 6k triangles, with LODs.
- All characters use **one shared rig family** (KayKit Rig_Medium/Large), so animations are shared.

---

## 3. Hero Briefs

Each brief has: concept, silhouette, palette, base assets to restyle, kit-bash parts, animation set, ability VFX language, and an originality check.

---

### H01 — **Bulwark**
**Strength · Melee · Initiator / Durable · Wardens**

**Concept:** the citadel's last gatekeeper. He's a stonemason-knight who carries a **shield cut from the old citadel gate**. Slow and immovable, he steps forward and makes enemies deal with him. His personality is stoic, protective and a bit weary. He "holds the line."

**Silhouette:** very wide and low. The shield is a giant rectangle as tall as he is, with a gate-arch shape and iron studs, held on his left arm. There's a short heavy mace in his right hand. He has broad pauldrons and a stubby helmet with a single slit. He reads as a "**walking wall**."

**Palette:** warm stone `#CFC6B4` armor plates, bronze `#B07A3C` trim, moss growing on the shield edges `#6F9A4E`. The shield face carries the team color (gold or violet banner cloth hanging from it).

**Base assets:**
- Body: KayKit Adventurers **Knight** (Rig_Medium), with proportions pushed (scale the shoulders and hands up).
- Shield: custom low-poly gate shape (a simple box-and-arch model), plus KayKit dungeon door/studs textures.
- Mace: KayKit weapon prop, restyled.

**Kit-bash:** add stone chunks to the pauldrons, chains hanging from the shield, and a small brazier on the back of the shield (it glows during the ultimate).

**Abilities & VFX language** (shapes: *squares, walls, cracks*; color: *warm dust + gold sparks*):

| Ability | Gameplay (draft) | VFX |
|---|---|---|
| **Rampart Charge** (Q) | Dashes forward. The first enemy hero hit is stunned | A dust trail and stone debris kicking up. A heavy impact ring with gold sparks |
| **Challenge Horn** (W) | Taunts nearby enemies into attacking him | A brass horn blast: concentric red-edged rings, and a glowing mark above taunted enemies |
| **Iron Mortar** (E, passive) | Returns part of melee damage to attackers | Small stone shards flicking off the shield when hit |
| **Seal the Gate** (R) | Slams the shield down and raises a ring of stone walls, trapping enemies inside for a few seconds | The ground cracks in a circle, square stone pillars erupt, and gold runes glow on the pillars |

**Animation:** heavy idle (shield planted), a lumbering run, a two-hit attack (mace swing, shield bash), a charge loop, a horn-raise cast, an overhead shield slam, death (falls behind his shield).

**Originality check:** not a minotaur, not an axe-wielding taunt warrior, not a classic "knight in shining armor." The gate-shield and the "walking wall" identity are the hook.

---

### H02 — **Kestrel**
**Agility · Ranged · Carry · Wardens**

**Concept:** a cliff-dwelling **falconer-archer** from the citadel's high towers. She hunts with a short recurve bow and a trained kestrel that rides her shoulder. Her personality is quick, cocky and precise. Her damage grows the longer she focuses one target.

**Silhouette:** slim and upright. A big feathered half-cape flares out behind her shoulders like folded wings, and a **bird is always visible on her left shoulder**. She has a short bow, a leather hood with a beak-like brim, and long legs with a forward lean.

**Palette:** sandy leather `#B89A6A`, slate-blue feathers `#5F7A99`, white feather tips. Team color sits on the cape lining and quiver. Her signature VFX color is **pale wind-white with a gold edge**.

**Base assets:**
- Body: KayKit Adventurers **Rogue / Rogue Hooded** (Rig_Medium).
- Bow & quiver: KayKit weapon props, restyled.
- Kestrel: a simple low-poly bird (Quaternius animal/bird pack, or a custom ~500-triangle model) with idle/flap/dive animations.

**Kit-bash:** layered feather cards for the cape (alpha-tested, with wind sway from the shared foliage shader), a falconer's glove on her left arm, a beak-brim on the hood.

**Abilities & VFX language** (shapes: *arcs, feathers, streaks*; color: *white wind + gold*):

| Ability | Gameplay (draft) | VFX |
|---|---|---|
| **Talon Shot** (Q, autocast) | Her attack modifier: arrows apply a stacking slow + bleed | Arrows trail feathers. The impact leaves small talon-scratch decals |
| **Windstep** (W) | A short dash. Her next attack is faster | A wind-streak line and a feather burst at the start and end |
| **Keen Eye** (E, passive) | Chance to evade attacks and to crit targets slowed by Talon Shot | A gold glint on her eyes and a white "shing" on crits |
| **Stoop** (R) | Her kestrel dives on a target and marks it. Each attack she lands on that target adds bonus damage, and the mark lasts several seconds | The bird soars up and dives in a white streak. A gold target reticle circles the victim and stacks visibly |

**Animation:** alert idle (the bird shifts), a light run, a bow draw + release (2 variants), a dash pose, a "point" cast (sending the bird), death (the bird flies off).

**Originality check:** not a moon-priestess archer, not a wind-themed archer queen, not a sniper with a gun. The falconer and her live bird companion are the hook.

---

### H03 — **Cinderwright**
**Intelligence · Ranged · Nuker · Hollow**

**Concept:** a disgraced **forge-sage** who learned to shape the leyline's raw light into molten slag. He fights with a **hammer-staff topped by a swinging crucible** of liquid metal. His personality is gruff, obsessive and a craftsman. Every spell is a "pour."

**Silhouette:** hunched and heavy-shouldered. A long leather smith's apron, oversized riveted gauntlets, and a soot-stained hood with goggles pushed up. The staff is longer than he is, with a glowing hanging crucible, so you see a **bright orange point of light above his head**.

**Palette:** soot iron `#2E2B33`, scorched leather `#6B4A33`, molten orange `#FF8A3D` glow. A violet-tinted ember undertone ties him to the Hollow. Team color is on the apron straps and hood lining.

**Base assets:**
- Body: KayKit Adventurers **Mage** (Rig_Medium), with the robe re-shaped into an apron and gauntlets scaled up.
- Staff: KayKit staff prop + a custom crucible (a cylinder with a lip on a chain) and an emissive molten material.

**Kit-bash:** goggles (two cylinders), chains, hanging tongs and small hammers on his belt, a hot rivet glow on the gauntlets.

**Abilities & VFX language** (shapes: *drips, splashes, pools*; color: *molten orange → cooling black crust*):

| Ability | Gameplay (draft) | VFX |
|---|---|---|
| **Slag Bolt** (Q) | A skillshot projectile that damages the first enemy hit | A glob of molten metal flying in an arc with drips. On impact it splashes and hardens into black crust |
| **Crucible Drop** (W) | After a delay, molten metal pours onto a target area, dealing damage and a short stun | A glowing ring telegraph, a falling column of liquid metal, then a splash crater |
| **Ember Field** (E) | Leaves a cooling slag pool that burns and slows enemies standing in it | A ground decal that fades from orange to black crust, with rising heat shimmer |
| **White Heat** (R) | A short channel, then a single-target beam of superheated metal for heavy burst damage | The crucible flares white. A thick beam with heat distortion, and the target glows orange-white |

**Animation:** idle (swirls the crucible), a heavy walk/run, a staff-swing attack that flicks a molten droplet, an overhead "pour" cast, a point-forward beam channel, death (the crucible tips and spills).

**Originality check:** not a fire sorceress, not a dragon-fire caster, not a blacksmith-dwarf hammer hero. The forge-alchemist with the swinging crucible and "pour" spell language is the hook.

---

### H04 — **Lantern**
**Intelligence · Ranged · Support · Wardens**

**Concept:** the citadel's last **lamplighter**, a small, gentle keeper who carries a **lantern on a long pole holding a captured light-spirit**. She mends allies and burns away curses. Her personality is calm and kind, with a quiet stubbornness. "Keep the light on."

**Silhouette:** short and round. A wide-brimmed lamplighter hat and a long layered coat that flares at the bottom (bell shape). A tall shepherd's-crook pole with a **hanging glass lantern** puts a bright, soft glow at the top of her silhouette, so allies can find her by eye.

**Palette:** deep teal coat `#2F5D62`, cream `#EFE6D2` scarf and hat band, warm soft light `#FFE6A3` from the lantern. Team color is on the coat lining and ribbons on the pole.

**Base assets:**
- Body: KayKit Adventurers **Mage** with different proportions, scaled smaller and rounder (or a smaller KayKit body if available). The hat and coat come from re-shaped robe parts.
- Pole & lantern: a custom crook (a bent cylinder) + a lantern cage (a low-poly box frame) with an emissive spirit sprite inside.

**Kit-bash:** a ring of keys on her belt, a small oil can, tiny moths (particles) circling the lantern at idle.

**Abilities & VFX language** (shapes: *soft circles, flames, moths*; color: *warm cream-gold light*):

| Ability | Gameplay (draft) | VFX |
|---|---|---|
| **Kindle** (Q) | Heals an ally over a short time | A small warm flame lands on the ally, with soft rising embers |
| **Snuff** (W) | Dispels debuffs from an ally, or buffs from an enemy | She cups the lantern. A puff of light and a curl of dark smoke lift away from the target |
| **Wick Ward** (E) | Shields an ally and absorbs damage | A soft glowing glass-lantern bubble around the ally. It cracks and shatters when broken |
| **Beacon Vigil** (R, channeled) | Plants the lantern and channels. Heals allies and reveals invisible enemies in a large radius. Interrupted by disables | The lantern rises and blazes. A huge warm ring of light on the ground, moths spiralling out, invisible enemies outlined in gold |

**Animation:** idle (lifts the lantern, moths circle), a short bustling run, a pole-tap attack that launches a small light mote, a raise-lantern cast, a plant-pole channel loop, death (the lantern dims and falls).

**Originality check:** not a frost-maiden support, not a holy-knight healer, not a "light keeper" wizard with a staff. The small lamplighter with a captured light-spirit and the moth motif are the hook.

---

## 4. Next art steps (after approval)
1. Download the packs listed in §1.1 into `/assets-src/<pack>/` (roadmap M0-08). Each pack gets a `LICENSE` copy and a `CREDITS.md` entry. The asset pipeline converts them to compressed GLB/KTX2 in `apps/client/public/assets`.
2. Build the shared toon shader + palette gradient-map as a Babylon.js shader that works on both WebGPU and WebGL2 (roadmap M1-02).
3. Build Bulwark first (M1-11), as the proof that the restyle pipeline works.
4. Do Kestrel, Cinderwright and Lantern in parallel (M2-16).
