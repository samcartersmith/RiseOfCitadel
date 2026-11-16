# DotA Allstars (WC3: The Frozen Throne) — Research Reference

> Research for the RiseOfCitadel foundation PR. Target era: **DotA Allstars 6.83d** (the last IceFrog version of the WC3 map, mirrored by Dota 2 patch 6.83, Dec 2014).
>
> **Sources:** the classic DotA wiki on Fandom (dota.fandom.com, read through its API: hero pages, the hero navbox, the "Items (DOTA)" category), Liquipedia's 6.83 changelog, Epic War's 6.83c map listing, and long-standing community knowledge.
> **Confidence markers:** ✅ = confirmed against a source during this research · ⚠️ = from memory or approximate; check against a live 6.83d map before treating it as canon. The wiki is incomplete (about 30 hero pages are missing or stubs, and most item pages have no gold costs), so a lot of the numbers are ⚠️.

---

## TL;DR — what's in this doc

1. **History & versions.** From Eul's RoC map, to Guinsoo's Allstars, to IceFrog (6.x), to 6.83d, and the community versions after it.
2. **Map.** Diagonal river, 3 lanes, 11 towers + 6 barracks + an Ancient per side. Also the Fountain, shops, Roshan, runes, jungle camps, high ground and trees.
3. **Economy & XP.** Passive gold, last hits, denies, kill and streak bounties, buyback, death penalties and the XP curve to level 25.
4. **Combat model.** Attributes, base stats, armor formula, damage types, magic immunity, attack timing (BAT, attack point, backswing), and pseudo-random procs.
5. **WC3 engine quirks.** Orb effects / Unique Attack Modifiers, buff placers, stacking rules, illusions, channeling, disables, and why the game *feels* the way it does.
6. **Heroes.** Every hero in the 6.83 roster (~110), by faction × attribute, with DotA 1 names and all 4 spells. Plus Invoker's 10 invoked spells and late additions.
7. **Items.** Every shop, every basic item, every recipe item, with stats and build paths. Also orb-effect priorities, Aghanim's upgrades, Roshan drops and couriers.
8. **Units.** Lane creeps (waves, growth, super/mega creeps), neutral camps and their abilities, Roshan.
9. **Modes & commands.** All draft modes, modifiers and in-game `-commands`.
10. **Player skills.** Last hitting, denying, creep pulling and stacking, juking, orb walking, tread switching, warding, ganks, smoke, team fights. These skills are emergent features any remake must preserve.
11. **Implications for our build.** The systems inventory these mechanics imply, plus an IP note (we should build an *original* game in this genre, not a copy).

---

## 1. History & Versions

| Era | Who | What happened |
|---|---|---|
| 2003 | **Eul** | Made the original "Defense of the Ancients" for *Reign of Chaos*, based on the StarCraft map *Aeon of Strife*. |
| 2004 | **Meian, Ragn0r, then Guinsoo** (Steve Feak) | Made *DotA Allstars* for *The Frozen Throne* by merging heroes from many DotA variants. Guinsoo was lead from ~5.x and added recipes and Roshan. Neichus helped. |
| 2005–2015 | **IceFrog** | Took over around 6.01. Ran the 6.x line, balanced it competitively, and added new heroes almost every version. Captains Mode, Glyph, bounty runes and more were added over this period. Joined Valve to make Dota 2 (2009+). |
| Dec 2014 / 2015 | IceFrog | **6.83 / 6.83c / 6.83d.** The last widely played IceFrog WC3 versions, released in parallel with Dota 2's 6.83 "Shifting Snows" patch. |
| 2016+ | IceFrog → community | The 6.84–6.85 maps continued (Arc Warden, Oracle and Winter Wyvern were ported in). Community-maintained versions (e.g. 6.88) followed. ⚠️ exact authorship and timelines |

**The 6.83 changelog** (Dota 2 parity, confirmed on Liquipedia ✅) shows what "late DotA" means:
- Both first rune spawns are **Bounty Runes** (100 gold + 100 XP each).
- Illusions deal 25% less damage to buildings.
- Barracks bounty was reworked into team-wide gold (125 per player for melee rax, 75 for ranged).
- Max attack speed went up to 600 (internal).
- Animal Courier costs 120. Circlet costs 165. Clarity restores 150 mana.
- **Diffusal Blade is no longer a Unique Attack Modifier**, and mana-break effects don't stack.
- Medallion of Courage can target allies. Shadow Amulet costs 1400.
- Refresher Orb cooldown went up to 195.

---

## 2. The Map

### 2.1 Geography
- Square map, split **diagonally by a river** from top-left to bottom-right.
- **Sentinel** in the bottom-left. It has a green, living look: Night Elf trees and Ancient Protector towers. The Ancient is the **World Tree**.
- **Scourge** in the top-right. It has a dark, blighted look: dead trees and Ziggurat-style towers. The Ancient is the **Frozen Throne**.
- **Three lanes:** Top, Mid and Bottom. Mid is a straight diagonal through the river. The side lanes run along the map edges.
  - Each team has a **safe lane** (where its T1 tower sits closer to the river and its own jungle is next to it). Sentinel's is bottom, Scourge's is top.
  - Each team has an **off lane** ("long lane", "suicide lane"): Sentinel top, Scourge bottom.
- **Elevation:** each base sits on high ground. Ramps lead up to each tier of tower, and the jungle and river have many cliffs. Ranged attacks from low ground to high ground have a **25% miss chance**, and **low ground cannot see high ground** unless something gives vision.
- **Trees** are pathing blockers and break line of sight. They create juke paths. Trees can be destroyed (Tango, Quelling Blade, Tango-style abilities, Timbersaw, Tiny's Aghanim's), and **regrow after ~5 min** ⚠️.

### 2.2 Structures per side

| Structure | Count | Notes |
|---|---|---|
| **Tier 1 tower** | 3 (one per lane) | At the edge of each lane, nearest the river. Kept vulnerable on purpose. |
| **Tier 2 tower** | 3 | Midway down the lane. Invulnerable until the T1 in that lane falls. |
| **Tier 3 tower** | 3 | At the base entrance on high ground, in front of the barracks. Invulnerable until T2 falls. |
| **Melee Barracks** | 3 | Behind each T3. Destroying it upgrades *your* melee creeps in that lane to **Super Creeps**. |
| **Ranged Barracks** | 3 | Behind each T3. Destroying it upgrades *your* ranged creeps in that lane. |
| **Tier 4 tower** | 2 | Flank the Ancient. Invulnerable until any T3 falls. |
| **Ancient** | 1 | World Tree / Frozen Throne. Win by destroying it. Invulnerable until both T4s fall. |
| **Fountain** | 1 | Spawn point. Big HP/mana regen aura for allies, and a high-damage attack against enemies. Main shops ring it. |
| Filler buildings | many | Moon Wells, Ziggurats, Ancient-type buildings. Destroyable for a small bounty. They pad the base and support backdoor protection ⚠️. |

- **Total: 11 towers + 6 barracks + Ancient** per side.
- **Mega Creeps:** destroy all 6 enemy barracks and every lane spawns the strongest creeps.
- **Tower behavior:** towers attack the closest unit in range, preferring units that attack allied heroes (aggro rules). They have **True Sight** in a small radius ⚠️. Buildings take reduced damage from some sources (siege vs. normal armor types; WC3 "Fortified" armor).
- **Backdoor protection:** when no enemy creeps are nearby, structures regenerate quickly and take reduced damage. This stops heroes from sneaking in to destroy buildings without a creep wave ⚠️ (WC3 6.x implementation).
- **Glyph of Fortification:** a team button that makes all of that team's buildings invulnerable for ~5 s. Cooldown ~5 min ⚠️.
- **Tower deny:** allies can attack their own tower once it's below **10% HP**.

### 2.3 Shops
- **Main shops (at the Fountain):** a ring of vendor buildings, each selling one category. Confirmed DotA 1 shop names ✅:
  - Basic shops: *Ancient of Wonders* (consumables), *Sena the Accessorizer* (attributes), *Weapons Dealer*, *Cache of Quel'Thelan* (misc/arcane basics), *Gateway Relics*, *Supportive Vestments*, *Arcane Sanctum*, *Protectorate*, *Enchanted Artifacts*, *Ancient Weaponry*.
  - Recipe/upgrade shops sell the recipe and auto-combine. Clicking a finished item in a shop buys its recipe scroll ✅.
- **Side Lane Shops (2):** one on each side lane, near the edge of the map. They sell a subset: Boots, Energy Booster, Broadsword (in 6.83), Ring of Health, wards, TP, etc.
- **Secret Shops (2):** *Leragas the Vile* ✅. Hidden in the jungle, one on each side. They sell the high-tier components (Point Booster, Ring of Health, Void Stone, Energy Booster, Vitality Booster, Hyperstone, Demon Edge, Mystic Staff, Reaver, Eaglesong, Sacred Relic, Ultimate Orb).
- **Inventory: 6 slots.** Items combine automatically when all parts plus the recipe are in the inventory (in DotA 1 the parts must be in inventory, not stash ⚠️). Couriers carry items.

### 2.4 Roshan
- A neutral boss in a pit off the river, in the **lower-right half of the map** (near the Scourge bottom lane).
- He has very high HP that **grows with game time** ⚠️, a **Bash** (stun on hit), **Slam** (AoE slow), and **Spell Block / magic resistance** (immune to most spells) ⚠️.
- **Drops:** the Aegis of the Immortal on every kill. **Cheese** from the 3rd kill on in later versions ⚠️ (6.8x: kill 2+ in Dota 2). Gold for the team and the killer.
- **Respawn:** random 8–11 min after death ⚠️.
- **Aegis:** one extra life. The holder revives at their death location after ~5 s. You can't pass it to a teammate. It **expires** after ~5–6 min ⚠️ and becomes a full heal when it runs out.

### 2.5 Runes
- They spawn **every 2 minutes** at one of **two river spots** (top or bottom), and only if the previous rune wasn't picked up ⚠️.
- **Types:** Double Damage (+100% base damage), Haste (max move speed), Illusion (2 illusions), Invisibility, Regeneration (rapid HP/mana regen, broken by damage), **Bounty** (gold + XP; 6.83 makes both first spawns Bounty ✅).
- **Bottle** stores one rune for later use and refills at the Fountain or from runes.

### 2.6 Day/Night
- The day/night cycle alternates (≈4 min each in DotA ⚠️, starting at Day).
- Heroes have **1800 day / 800 night** vision (most). Night favors ganks.
- Night Stalker is built around night: faster, more attack speed, flying vision, and an ultimate that *forces* night.
- Luna's Lunar Blessing gets stronger at night. Some neutral and creep visibility rules change.

---

## 3. Economy & Experience

### 3.1 Gold
- **Starting gold:** ~603 ⚠️ (Dota 2 used 625). `-random` gives bonus gold ⚠️.
- **Passive income:** about **1 gold per 0.875 s** in the WC3 map (as you quoted). Dota 2's equivalent was faster. ⚠️ verify.
- **Last hit:** only the killing blow earns the bounty. Creep bounties ⚠️: Melee ~38–48, Ranged ~43–53, Siege ~66–80. Bounties grow over the game.
- **Hero kills:** base bounty + per-level scaling + **streak bonuses** for ending the victim's streak. **Assist gold** is shared among nearby allies who helped, and is larger when you kill a hero from a team that's ahead ⚠️.
- **Death penalty:** you lose unreliable gold (~ level × 30 ⚠️). Late versions split gold into **reliable** (kills, Hand of Midas) and **unreliable** (passive, creeps).
- **Buyback:** pay gold to respawn instantly. The cost scales with level and game time (6.8x: ~100 + level² × 1.5 + minutes × 15 ⚠️). Long cooldown (~7 min ⚠️). Buyback also adds a respawn penalty to your next death.
- **Tower gold:** goes to the whole team plus a bonus for the last hitter. Barracks gold is team-wide in 6.83 ✅.
- **Roshan gold:** team + killer.
- **Hand of Midas:** turns a creep into gold + XP (reliable gold).
- **Goblin's Greed** (Alchemist): bonus gold for creep kills that grows with kills in a row.

### 3.2 Experience
- XP is shared between enemy heroes within **~1300 range** of a dying enemy unit. You don't need the last hit.
- **Max level 25.** XP per level (6.8x curve ⚠️):

| Lvl | Total XP | Lvl | Total XP | Lvl | Total XP |
|---|---|---|---|---|---|
| 2 | 200 | 10 | 5400 | 18 | 17000 |
| 3 | 500 | 11 | 6000 | 19 | 18900 |
| 4 | 900 | 12 | 8200 | 20 | 20900 |
| 5 | 1400 | 13 | 9000 | 21 | 23000 |
| 6 | 2000 | 14 | 10400 | 22 | 25200 |
| 7 | 2600 | 15 | 11900 | 23 | 27500 |
| 8 | 3200 | 16 | 13500 | 24 | 29900 |
| 9 | 4400 | 17 | 15200 | 25 | 32400 |

  (treat this as a template for our own curve, not canon)
- **Skill points:** 1 per level. Basic abilities go to 4 levels. **Ultimates unlock at 6/11/16** (3 levels; Invoker, Meepo and a few others differ). **Attribute Bonus** ("stats", +2 all per point, up to 10 points) is a skill you can put points into instead.
- **Hero kill XP** scales with the victim's level. Killing higher-level heroes catches you up.
- **Denied creeps** give enemies reduced XP (≈50% in late versions ⚠️) and no gold.

### 3.3 Denying
- You can attack **allied creeps below 50% HP**, **allied towers below 10%**, and allied heroes under certain DoTs (Doom, Venomancer's Poison Nova, etc.) ⚠️.
- A deny shows a "!" over the unit. It takes gold and part of the XP away from the enemy.
- Some heroes can deny themselves (Pudge with Rot, Phoenix, Huskar under some DoTs) ⚠️.

---

## 4. Combat Model

### 4.1 Attributes ✅ (from your notes, matches WC3 DotA)

| Attribute | Per point |
|---|---|
| **Strength** | +19 max HP, +0.03 HP regen/sec |
| **Agility** | +1% attack speed, +0.14 armor (1 per 7) |
| **Intelligence** | +13 max mana, +0.04 mana regen/sec |
| **Primary attribute** | also +1 attack damage per point |

- Every hero has a **base value** and a **gain per level** for each attribute. Example: STR 22 + 2.8/lvl.
- **Attribute Bonus skill:** +2 to all attributes per point.

### 4.2 Per-hero base stats (what a hero data record needs)
Base HP (150 + STR × 19), base mana (INT × 13), base damage range, base armor, **base attack time (BAT)** (usually 1.7; some 1.6 or 1.5, Alchemist's Chemical Rage → 1.1/1.0), **attack point / backswing** (animation timing), **attack range** (melee 100–128; ranged 400–700), **projectile speed**, **movement speed** (280–325 base; cap 522, min 100 ⚠️), **turn rate**, **day/night vision**, **collision size**, attack type, armor type.

### 4.3 Armor
- Damage reduction = **0.06 × armor / (1 + 0.06 × armor)**. Negative armor *increases* damage taken (with a different formula).
- WC3 armor/attack types (Hero, Normal, Pierce, Siege, Chaos, Fortified) give the damage multipliers between creeps, heroes and buildings. For example, siege creeps do bonus damage to buildings, and heroes take reduced damage from some types ⚠️.

### 4.4 Damage types
- **Physical:** reduced by armor. Affects magic-immune units. Can be **evaded** (miss).
- **Magical:** reduced by **magic resistance** (heroes have **25% base**; it stacks multiplicatively). Blocked by magic immunity.
- **Pure:** ignores armor and magic resistance. Usually blocked by magic immunity (e.g. Meat Hook ✅).
- **HP Removal:** sets HP directly. It doesn't count as damage for some interactions and doesn't break Salve/Bottle the same way ⚠️.
- **Composite / Universal** (rare): reduced by both armor and magic resistance, or by neither.

### 4.5 Magic immunity and spell interactions
- **Magic immunity** comes from BKB's Avatar, Repel, Rage, Blade Fury and similar. It blocks magical damage and most disables. A few spells **pierce** it (Black Hole, Chronosphere, Duel, Culling Blade's kill, Dismember's disable ✅, Roar, etc.).
- **Spell block:** Linken's Sphere blocks one targeted spell every ~17 s.
- **Dispels/Purge:** Diffusal, Satyr purge, Abaddon shield, Eul's self-cast, etc. remove buffs/debuffs. There's a basic vs. strong dispel distinction ⚠️.
- **Disable categories:** Stun, Silence, Hex, Root/Ensnare, Slow, Disarm, Ethereal, Cyclone (Eul's), Taunt (Berserker's Call), Fear (Requiem), Sleep (Nightmare, Echo Stomp), Ministun, Banish (Astral Imprisonment, Disruption), Forced movement (Toss, Force Staff, Skewer, Vacuum).
- **Channeling:** the caster has to stay still and is interrupted by stuns, silences, hexes and some forced movement. Examples: Black Hole, Freezing Field, Life Drain, Fiend's Grip, Death Ward, Dismember, Shackles, Sun Ray, TP Scrolls.

### 4.6 Attack mechanics
- **Attack speed:** IAS from agility and items. Capped (WC3 6.83: max 400% IAS / internal 500→600 in the 6.83 change ✅).
- **Attack point / backswing:** the windup before the hit lands, then the recovery animation. Players **cancel the backswing** by moving ("orb walking", "animation canceling").
- **Pseudo-random distribution (PRD):** WC3 natively uses PRD for crits, bash and evasion. The chance on each attempt starts low and increases after every failure, so procs come at steady intervals instead of streaks.
- **Bash:** chance to stun on hit. Multiple bash sources don't stack. Melee/ranged variants differ ⚠️.
- **Critical strike:** multiple crit sources each roll, and the highest multiplier wins ⚠️.
- **Evasion:** multiple sources stack multiplicatively. **True Strike** (MKB) ignores evasion and uphill miss.
- **Damage block:** Stout Shield / Poor Man's Shield / Vanguard have a chance to block a flat amount from attacks (melee blocks more than ranged).
- **Cleave:** melee splash damage (Battle Fury, Great Cleave, Tidebringer). It ignores armor and hits in a cone/radius.
- **Lifesteal:** heals for a % of attack damage dealt (orb, aura or buff).
- **Spell damage amplification** was barely a thing in 6.83 (Veil of Discord, Ancient Seal and Amplify-style effects instead).

### 4.7 Orb effects, Unique Attack Modifiers (UAM) and buff placers — the WC3 quirk
- In WC3, many on-hit effects are implemented as **"orb" abilities**. Only **one orb effect applies per attack**.
- **UAMs** include lifesteal (Morbid Mask, Helm of the Dominator, Satanic, Mask of Madness), Desolator's corruption, Skadi's cold attack, Orb of Venom, and Diffusal's feedback (no longer a UAM in 6.83 ✅). Hero abilities count too: Frost Arrows, Searing Arrows, Burning Spear, Poison Attack, Arcane Orb, Glaives of Wisdom, Impetus.
- **Priority rule:** a hero's **active autocast orb** overrides item orbs. Among items, the item in the **earlier inventory slot** (or a fixed priority list) wins ⚠️.
- **Buff placers** (e.g. Eye of Skadi's slow, Orb of Venom) don't stack with each other. Lifesteal stacks with some but not others.
- **Chance-based procs** (bash, crit, Maelstrom/Mjollnir's chain lightning, MKB's mini-bash) are **not orbs** and stack differently.
- Why this matters for a remake: orb rules make itemization a puzzle. We'd want a cleaner, *intentional* version (e.g. "one Unique Attack Modifier slot" with explicit priority), not engine accidents.

### 4.8 Illusions
- Illusions copy the hero's stats and items. They **deal reduced damage** and **take increased damage** (values differ by source: Manta, rune, Naga, PL, CK, TB).
- They don't cast spells and can't use most actives. They copy passives that make sense (bash, crit, Fury Swipes...). Some orbs don't work on illusions.
- Illusions die instantly to some effects. Enemies can tell them apart with a mouse-over or by watching HP bars ⚠️.
- They deal **25% less damage to buildings** in 6.83 ✅.

### 4.9 Invisibility and detection
- **Invisibility** (Shadow Blade, Riki, Clinkz, Bounty Hunter, Weaver, Nyx, rune) breaks when you attack or cast, except for some abilities. It's countered by **True Sight**: Sentry Ward, Gem of True Sight (drops on death), Dust of Appearance, towers, and some abilities.
- **Fade time:** a short delay before invisibility takes effect.

### 4.10 Regeneration and healing
- Healing Salve and Clarity are **broken by player damage**. Tango (eat a tree) isn't ⚠️.
- The Fountain heals a % of max HP/mana per second.
- Out-of-combat regeneration only applies to Heart of Tarrasque. It deactivates when you take hero damage.

---

## 5. Heroes (6.83-era roster)

**How heroes were picked:** **12 Taverns** (6 Sentinel, 6 Scourge), each one attribute's worth of heroes. In All Pick you can choose from either side's taverns. Each spell had its own **hotkey letter** (e.g. Fissure = F). WC3 players often remapped these with tools like *Warkeys*.

**Notation:** `Hero (DotA name — proper name)` then spells. The last spell is the **ultimate** (R). `[P]` = passive, `[T]` = toggle, `[A]` = autocast, `[C]` = channeled.
✅ = the spell kit is confirmed on the DotA wiki. Everything else is from memory (high confidence for kit names; numbers are omitted).

> **Faction note:** most faction assignments were confirmed on the wiki ✅. **Invoker** has conflicting sources: the wiki's Sentinel roster page lists him, but his own page says Scourge. **Oracle, Winter Wyvern and Arc Warden** appear in the DotA 1 navbox but arrived in the post-6.83 maps (6.84+) ⚠️.

### 5.1 Sentinel — Strength (21)

| Hero | Spells (Q · W · E · R) | Identity |
|---|---|---|
| **Earthshaker** — Raigor Stonehoof | Fissure · Enchant Totem · Aftershock [P] · **Echo Slam** | Initiator. Fissure walls off paths. Echo Slam scales with the number of nearby units. |
| **Sven** — Rogue Knight ✅ | Storm Bolt · Great Cleave [P] · Warcry · **God's Strength** | Stun + cleave carry. |
| **Tiny** — Stone Giant ✅ | Avalanche · Toss · Craggy Exterior [P] · **Grow** | Burst combo (Avalanche → Toss). Aghanim's gives a tree club with cleave. |
| **Kunkka** — Admiral ✅ | Torrent · Tidebringer [P] · X Marks the Spot · **Ghost Ship** | Combo: X → Torrent → Ship. Ship delays damage taken by allies. |
| **Beastmaster** — Rexxar ✅ | Wild Axes · Call of the Wild (boar/hawk) · Inner Beast [P] · **Primal Roar** | Summons + vision. Roar is a magic-immunity-piercing stun. |
| **Dragon Knight** — Knight Davion | Breathe Fire · Dragon Tail · Dragon Blood [P] · **Elder Dragon Form** | Tanky pusher. Becomes a ranged dragon with splash/slow. |
| **Clockwerk** — Rattletrap | Battery Assault · Power Cogs · Rocket Flare · **Hookshot** | Ganker. Cogs trap a target; Flare gives global scouting. |
| **Omniknight** — Purist Thunderwrath ✅ | Purification · Repel · Degen Aura [P] · **Guardian Angel** | Support. Gives magic immunity and physical immunity. |
| **Huskar** — Sacred Warrior ✅ | Inner Vitality · Burning Spear [A] · Berserker's Blood [P] · **Life Break** | Gets stronger as HP drops. Spears cost HP. |
| **Alchemist** — Razzil Darkbrew ✅ | Acid Spray · Unstable Concoction · Goblin's Greed [P] · **Chemical Rage** | Farm-accelerated carry. Rage lowers BAT and boosts regen. |
| **Brewmaster** — Mangix ✅ | Thunder Clap · Drunken Haze · Drunken Brawler [P] · **Primal Split** | Splits into Earth/Storm/Fire spirits (micro-heavy). |
| **Treant Protector** — Rooftrellen ✅ | Nature's Guise · Leech Seed · Living Armor · **Overgrowth** | Global support. AoE root. |
| **Io** — Guardian Wisp ✅ | Tether · Spirits · Overcharge [T] · **Relocate** | Pairs with a carry. Global teleport for two heroes. |
| **Centaur Warchief** — Bradwarden | Hoof Stomp · Double Edge · Return [P] · **Stampede** (6.8x; formerly Great Fortitude) | Initiator. Team-wide speed for engages or escapes. |
| **Goblin Shredder / Timbersaw** — Rizzrak | Whirling Death · Timber Chain · Reactive Armor [P] · **Chakram** | Tree-dependent mobility. Steals STR. Scales with being hit. |
| **Bristleback** — Rigwarl | Viscous Nasal Goo · Quill Spray · Bristleback [P] · **Warpath** [P] | Takes less damage from behind. Stacking debuffs. |
| **Tuskarr / Tusk** — Ymir | Ice Shards · Snowball · Frozen Sigil · **Walrus Punch** | Ganker. Snowball carries allies. Punch is a huge crit + launch. |
| **Tauren Chieftain / Elder Titan** — Cairne Bloodhoof | Echo Stomp · Astral Spirit · Natural Order [P] · **Earth Splitter** | Natural Order strips armor/magic resistance. Splitter does delayed % HP damage. |
| **Legion Commander** — Tresdin | Overwhelming Odds · Press the Attack · Moment of Courage [P] · **Duel** | Duel forces a 1v1. The winner gains permanent damage. |
| **Earth Spirit** — Kaolin | Boulder Smash · Rolling Boulder · Geomagnetic Grip · (Stone Remnant) · **Magnetize** | Mechanically complex combo hero. Stone Remnants change how spells behave. |
| **Phoenix** — Icarus ✅ | Icarus Dive · Fire Spirits · Sun Ray [C-ish] · **Supernova** | Becomes an egg. If the egg survives, Phoenix revives at full. |

### 5.2 Sentinel — Agility (18)

| Hero | Spells | Identity |
|---|---|---|
| **Anti-Mage** — Magina | Mana Break [P] · Blink · Spell Shield [P] · **Mana Void** | Mana-burn hard carry. Mana Void scales with missing mana. |
| **Drow Ranger** — Traxex | Frost Arrows [A] · Gust (Silence) · Precision Aura [P] · **Marksmanship** [P] | Ranged carry. Ranged-damage aura. |
| **Juggernaut** — Yurnero ✅ | Blade Fury · Healing Ward · Blade Dance [P] · **Omnislash** | Spins while magic immune. Invulnerable slashes. |
| **Mirana** — Priestess of the Moon | Starfall · Sacred Arrow · Leap · **Moonlight Shadow** | Long-range arrow stun. Team-wide invisibility. |
| **Morphling** | Waveform · Adaptive Strike · Morph (AGI↔STR) [T] · **Replicate** | Shifts stats. Escape artist. |
| **Phantom Lancer** — Azwraith ✅ | Spirit Lance · Doppelwalk · Juxtapose [P] · **Phantom Edge** | Floods the map with illusions. |
| **Vengeful Spirit** — Shendelzare Silkood ✅ | Magic Missile · Wave of Terror · Command Aura [P] · **Nether Swap** | Support. Swaps places with a unit. |
| **Riki** — Rikimaru, Stealth Assassin | Smoke Screen · Blink Strike · Backstab [P] · **Permanent Invisibility** [P] | Always invisible. Bonus damage from behind. |
| **Sniper** — Kardel Sharpeye ✅ | Shrapnel · Headshot [P] · Take Aim [P] · **Assassinate** | Longest attack range. Long-range finisher. |
| **Templar Assassin** — Lanaya | Refraction · Meld · Psi Blades [P] ✅ · **Psionic Trap** | Blocks damage instances. Burst from invisibility. |
| **Luna** — Moon Rider ✅ | Lucent Beam · Moon Glaive [P] · Lunar Blessing [P] · **Eclipse** | Bouncing attacks. Repeated beams. |
| **Bounty Hunter** — Gondar | Shuriken Toss · Jinada [P] ✅ · Shadow Walk · **Track** | Track gives vision + bonus gold on the tracked target's death. |
| **Ursa** — Ulfsaar ✅ | Earthshock · Overpower · Fury Swipes [P] · **Enrage** | Stacking damage on one target. Roshan killer. |
| **Gyrocopter** — Aurel Vlaicu | Rocket Barrage · Homing Missile · Flak Cannon · **Call Down** | AoE physical carry. |
| **Lone Druid** — Syllabear ✅ | Summon Spirit Bear · Rabid · Synergy [P] · **True Form** | Bear has its own items (micro). |
| **Naga Siren** — Slithice ✅ | Mirror Image · Ensnare · Rip Tide · **Song of the Siren** | Illusions. Song puts the area to sleep (reset button). |
| **Troll Warlord** — Jah'rakal ✅ | Berserker's Rage [T] (melee/ranged) · Whirling Axes · Fervor [P] · **Battle Trance** | Switches between melee and ranged. |
| **Ember Spirit** — Xin | Searing Chains · Sleight of Fist · Flame Guard · **Fire Remnant** (+ Activate) | High mobility. Places remnants and dashes to them. |

### 5.3 Sentinel — Intelligence (19 + Invoker)

| Hero | Spells | Identity |
|---|---|---|
| **Crystal Maiden** — Rylai Crestfall | Crystal Nova · Frostbite · Brilliance Aura [P] · **Freezing Field** [C] | Global mana-regen aura. |
| **Puck** — Faerie Dragon | Illusory Orb (+ Ethereal Jaunt) · Waning Rift · Phase Shift · **Dream Coil** | Slippery initiator. |
| **Storm Spirit** — Raijin Thunderkeg | Static Remnant · Electric Vortex · Overload [P] · **Ball Lightning** | Mana-scaling travel ultimate. |
| **Windrunner** — Alleria | Shackleshot · Powershot · Windrun · **Focus Fire** | Shackle a target to a tree or unit. |
| **Zeus** — Lord of Olympia | Arc Lightning · Lightning Bolt · Static Field [P] · **Thundergod's Wrath** | Global ultimate nuke. |
| **Lina** — Slayer (Lina Inverse) | Dragon Slave · Light Strike Array · Fiery Soul [P] · **Laguna Blade** | Burst nuker. |
| **Shadow Shaman** — Rhasta | Forked Lightning · Voodoo (Hex) · Shackles [C] · **Mass Serpent Ward** | Lockdown + pushing with wards. |
| **Tinker** — Boush | Laser · Heat-Seeking Missile · March of the Machines · **Rearm** [C] | Rearm refreshes his spells and items. |
| **Nature's Prophet** — Furion | Sprout · Teleportation · Nature's Call (Treants) · **Wrath of Nature** | Global split-pusher. |
| **Enchantress** — Aiushtha | Untouchable [P] · Enchant · Nature's Attendants · **Impetus** [A] | Converts creeps. Impetus does more damage the farther it travels. |
| **Jakiro** — Twin Head Dragon | Dual Breath · Ice Path · Liquid Fire [A] · **Macropyre** | Lane bully. Tower pusher. |
| **Chen** — Holy Knight | Penitence · Test of Faith · Holy Persuasion · **Hand of God** | Converts neutrals. Global heal. |
| **Silencer** — Nortrom ✅ | Curse of the Silent · Glaives of Wisdom [A] · Last Word [P] · **Global Silence** | Steals INT. Map-wide silence. |
| **Ogre Magi** — Aggron Stonebreak | Fireblast · Ignite · Bloodlust · **Multicast** [P] | Spells repeat randomly (×2/×3/×4). |
| **Rubick** — Grand Magus | Telekinesis · Fade Bolt · Null Field [P] · **Spell Steal** | Steals and uses the enemy's last spell. |
| **Disruptor** — Thrall | Thunder Strike · Glimpse · Kinetic Field · **Static Storm** | Zone control. Glimpse sends a target back to where it was. |
| **Keeper of the Light** — Ezalor | Illuminate [C] · Mana Leak · Chakra Magic · **Spirit Form** (+ Recall, Blinding Light) | Mana support. Global Recall. |
| **Skywrath Mage** — Dragonus | Arcane Bolt · Concussive Shot · Ancient Seal · **Mystic Flare** | Silence + magic amp burst. |
| **Goblin Techies** — Squee, Spleen & Spoon | Land Mines · Stasis Trap · Suicide Squad, Attack! · **Remote Mines** | Area denial / traps. |
| **Invoker** — Kael ⚠️ faction | Quas · Wex · Exort · **Invoke** | 3 reagent orbs, combined into 10 spells (below). |

**Invoker's 10 invoked spells** (Q = Quas, W = Wex, E = Exort):

| Combo | Spell | Effect |
|---|---|---|
| QQQ | Cold Snap | Repeated ministuns every time the target takes damage |
| QQW | Ghost Walk | Invisibility. Slows nearby enemies and yourself |
| QQE | Ice Wall | A wall in front of you that slows and damages |
| WWW | EMP | Delayed AoE that burns mana and deals damage |
| WWQ | Tornado | Lifts enemies in a line, then damages them |
| WWE | Alacrity | Attack speed + damage on an ally |
| EEE | Sun Strike | Global delayed beam |
| EEQ | Forge Spirit | Summons fire spirits |
| EEW | Chaos Meteor | A meteor that rolls forward and burns |
| QWE | Deafening Blast | A cone that knocks back + disarms |

Orb levels scale each invoked spell's power. Invoke holds 2 spells at once. Invoker skips the normal ultimate structure: his orbs level all the way up, and Invoke itself is the "ultimate."

### 5.4 Scourge — Strength (16)

| Hero | Spells | Identity |
|---|---|---|
| **Axe** — Mogul Khan | Berserker's Call · Battle Hunger · Counter Helix [P] · **Culling Blade** | Taunt initiator. Execute at low HP. |
| **Pudge** — Butcher ✅ | Meat Hook · Rot [T] · Flesh Heap [P] · **Dismember** [C] | Hook = pure damage + pull (range 550–1000, cooldown 14→11 ✅). Rot hurts himself too. Flesh Heap gives STR per nearby hero death. |
| **Sand King** — Crixalis | Burrowstrike · Sand Storm · Caustic Finale [P] · **Epicenter** [C] | Burrow-in initiator. |
| **Slardar** — Slithereen Guard | Sprint · Slithereen Crush · Bash [P] · **Amplify Damage** | Armor shred + true sight on the target. |
| **Tidehunter** — Leviathan | Gush · Kraken Shell [P] · Anchor Smash · **Ravage** | Huge AoE stun. |
| **Skeleton King** — King Leoric | Hellfire Blast · Vampiric Aura [P] · Critical Strike [P] · **Reincarnation** [P] | Revives on death. |
| **Lifestealer** — N'aix ✅ | Rage · Feast [P] · Open Wounds · **Infest** | Magic-immune carry. Hides inside units. |
| **Night Stalker** — Balanar ✅ | Void · Crippling Fear · Hunter in the Night [P] · **Darkness** | Night ganker. Forces night. |
| **Doom Bringer** — Lucifer | Devour · Scorched Earth · LVL? Death · **Doom** | Doom silences, mutes items and does damage over time. |
| **Spirit Breaker** — Barathrum | Charge of Darkness · Empowering Haste · Greater Bash [P] · **Nether Strike** | Charges across the map. |
| **Lycanthrope / Lycan** — Banehallow ✅ | Summon Wolves · Howl · Feral Impulse [P] · **Shapeshift** | Wolf form at max speed. Pusher. |
| **Chaos Knight** — Nessaj | Chaos Bolt · Reality Rift · Chaos Strike [P] ✅ · **Phantasm** | Random-damage stun. Strong illusions. |
| **Undying** — Dirge | Decay · Soul Rip · Tombstone · **Flesh Golem** | Steals STR. A zombie-spawning tombstone. |
| **Magnataur / Magnus** | Shockwave · Empower · Skewer · **Reverse Polarity** | AoE stun that pulls enemies in front of him. |
| **Lord of Avernus / Abaddon** | Mist Coil · Aphotic Shield · Frostmourne / Curse of Avernus [P] · **Borrowed Time** | Damage becomes healing. |
| **Pit Lord / Underlord** — Azgalor | Firestorm · Pit of Malice · Atrophy Aura [P] · **Dark Rift** | AoE zoning. Team teleport. |

### 5.5 Scourge — Agility (16)

| Hero | Spells | Identity |
|---|---|---|
| **Bloodseeker** — Strygwyr | Bloodrage · Blood Bath (Blood Rite) · Thirst [P] · **Rupture** | Rupture damages the target when it moves. Thirst gives vision of low-HP enemies. |
| **Shadow Fiend** — Nevermore | Shadowraze (near/mid/far) · Necromastery [P] · Presence of the Dark Lord [P] · **Requiem of Souls** | Souls give damage. |
| **Razor** — Lightning Revenant | Plasma Field · Static Link · Unstable Current [P] · **Eye of the Storm** | Steals damage. |
| **Venomancer** — Lesale Deathbringer | Venomous Gale · Poison Sting [P] · Plague Ward · **Poison Nova** | Poison zone control. |
| **Faceless Void** — Darkterror | Time Walk · Backtrack [P] · Time Lock [P] · **Chronosphere** | Time stop (pierces magic immunity). |
| **Phantom Assassin** — Mortred | Stifling Dagger · Phantom Strike · Blur [P] · **Coup de Grace** [P] | Evasion + huge crits. |
| **Viper** — Netherdrake | Poison Attack [A] · Nethertoxin [P] · Corrosive Skin [P] · **Viper Strike** | Lane dominance. |
| **Clinkz** — Bone Fletcher | Strafe · Searing Arrows [A] · Skeleton Walk · **Death Pact** | Invisible burst carry. |
| **Broodmother** — Black Arachnia | Spawn Spiderlings · Spin Web · Incapacitating Bite [P] · **Insatiable Hunger** | Webs give free pathing. Spider swarms. |
| **Weaver** — Skitskurr | The Swarm · Shukuchi · Geminate Attack [P] · **Time Lapse** | Rewinds his position and HP. |
| **Spectre** — Mercurial | Spectral Dagger · Desolate [P] · Dispersion [P] · **Haunt** | Global ultimate. Late-game monster. |
| **Meepo** — Geomancer ✅ | Earthbind · Poof · Geostrike [P] · **Divided We Stand** | Multiple controllable clones. If one dies, all die. |
| **Nyx Assassin** — Nerubian Assassin | Impale · Mana Burn · Spiked Carapace · **Vendetta** | Invisible ganker. |
| **Slark** — Murloc Nightcrawler | Dark Pact · Pounce · Essence Shift [P] · **Shadow Dance** | Steals stats. Self-purges. |
| **Medusa** — Gorgon | Split Shot [T] · Mystic Snake · Mana Shield [T] · **Stone Gaze** | Mana works as HP. Multi-target attacks. |
| **Terrorblade** — Soul Keeper ✅ | Reflection · Conjure Image · Metamorphosis · **Sunder** | Swaps HP percentages with a target. |

### 5.6 Scourge — Intelligence (18)

| Hero | Spells | Identity |
|---|---|---|
| **Lich** — Kel'Thuzad | Frost Nova · Frost Armor · Dark Ritual · **Chain Frost** | A bouncing frost orb. |
| **Lion** — Demon Witch | Earth Spike · Hex · Mana Drain [C] · **Finger of Death** | Two disables + finger nuke. |
| **Witch Doctor** — Vol'Jin | Paralyzing Cask · Voodoo Restoration [T] · Maledict · **Death Ward** [C] | Bouncing stun. Channeled ward. |
| **Enigma** — Darchrow | Malefice · Demonic Conversion · Midnight Pulse · **Black Hole** [C] | AoE pull (pierces magic immunity). |
| **Necrolyte / Necrophos** — Rotund'jere | Death Pulse · Heartstopper Aura [P] · Sadist [P] · **Reaper's Scythe** | Damage based on missing HP. Adds respawn time. |
| **Warlock** — Demnok Lannik | Fatal Bonds · Shadow Word · Upheaval [C] · **Rain of Chaos** (Golem) | Summons an infernal golem. |
| **Queen of Pain** — Akasha | Shadow Strike · Blink · Scream of Pain · **Sonic Wave** | Mobile nuker. Sonic Wave is pure damage. |
| **Death Prophet** — Krobelus | Carrion Swarm · Silence · Witchcraft [P] · **Exorcism** | Ghosts that push towers. |
| **Pugna** — Oblivion | Nether Blast · Decrepify · Nether Ward · **Life Drain** [C] | Destroys towers fast. Punishes casters. |
| **Dazzle** — Shadow Priest | Poison Touch · Shallow Grave · Shadow Wave · **Weave** | Stops an ally from dying. |
| **Leshrac** — Tormented Soul ✅ (INT) | Split Earth · Diabolic Edict · Lightning Storm · **Pulse Nova** [T] | AoE + tower damage. |
| **Dark Seer** — Ish'Kafel | Vacuum · Ion Shell · Surge · **Wall of Replica** | Makes illusions of enemies. |
| **Batrider** — Bat Rider | Sticky Napalm · Flamebreak · Firefly · **Flaming Lasso** | Drags one target away. |
| **Ancient Apparition** — Kaldr | Cold Feet · Ice Vortex · Chilling Touch · **Ice Blast** | Global anti-heal + execute. |
| **Obsidian/Outworld Destroyer** — Harbinger | Arcane Orb [A] · Astral Imprisonment · Essence Aura [P] · **Sanity's Eclipse** | Damage from the INT difference. |
| **Shadow Demon** — Eredar | Disruption · Soul Catcher · Shadow Poison · **Demonic Purge** | Banishes a target and makes illusions of it. |
| **Visage** — Necro'lic | Grave Chill · Soul Assumption · Gravekeeper's Cloak [P] · **Summon Familiars** | Stone familiars stun. |
| **Bane** — Atropos ✅ | Enfeeble · Brain Sap · Nightmare · **Fiend's Grip** [C] | Sleep + channeled disable. |

### 5.7 Late additions (post-6.83 DotA maps ⚠️)
- **Oracle** — Nerif: Fortune's End · Fate's Edict · Purifying Flames · **False Promise**
- **Winter Wyvern** — Auroth: Arctic Burn · Splinter Blast · Cold Embrace · **Winter's Curse**
- **Arc Warden** — Zet: Flux · Magnetic Field · Spark Wraith · **Tempest Double**

### 5.8 Roster stats
- **~110 heroes** in 6.83d. Sentinel ≈ 58, Scourge ≈ 50.
- Split roughly evenly across STR/AGI/INT.
- **Roles** (informal, but universally used): Carry, Support, Nuker, Disabler, Initiator, Jungler, Pusher, Durable, Escape, Lane Support, Ganker.
- **Design archetypes worth noting:**
  - **Multi-unit heroes:** Meepo, Lone Druid, Brewmaster, Chen, Enchantress, Visage, Broodmother, Nature's Prophet, Beastmaster.
  - **Illusion heroes:** PL, Naga, CK, TB.
  - **Global abilities:** Zeus, Spectre, Silencer, NP, KotL, Io, Clockwerk's flare, Invoker's Sun Strike, AA.
  - **Transformation ultimates:** DK, Lycan, TB, Alchemist.
  - **Resource-swapping or unusual-resource heroes:** Huskar's HP-cost spears, Medusa's mana shield, Storm's mana-scaling ball, Morphling's stat shifting.
  - **"Rule-breaking" ultimates** that need engine-level support:
    - Chronosphere (freezes everything except one team's heroes)
    - Black Hole
    - Omnislash
    - Duel
    - Reincarnation
    - Supernova
    - Infest
    - Relocate
    - Replicate
    - Spell Steal
    - Rearm
    - Multicast
    - Invoke
    - Time Lapse
    - Sunder

### 5.9 Aghanim's Scepter upgrades (selected) ⚠️
Aghanim's Scepter improves *most* heroes' ultimates. Typical patterns:
- **More damage or a lower cooldown:** Laguna Blade becomes pure damage, Finger of Death does more damage, Mana Void, Ravage ⚠️.
- **Adds targets or an area:** Chain Frost bounces forever, Fiend's Grip drains mana, Hookshot's cooldown drops, Echo Slam ⚠️.
- **Changes mechanics:**
  - Tiny gets a tree club with cleave.
  - Pudge's Dismember heals him (confirmed: heals by the damage dealt ✅).
  - Zeus gets Nimbus (in later versions).
  - Ogre Magi gets more Multicast. Alchemist can give his Scepter to an ally. Riki gets Tricks of the Trade.
  - Earthshaker's Echo Slam does more damage. Sven's Storm Bolt makes him jump to the target.
  - Doom pierces magic immunity. Necrolyte's Scythe stops buyback.
  - Shadow Shaman's wards attack buildings. Kunkka's ship gets a bigger effect.
  - Nature's Prophet's treants.
- **Heroes with no Aghanim's upgrade** got only the stats from the item.

---

## 6. Items

Gold costs are 6.8x values from memory ⚠️ unless marked. Recipes marked ✅ were confirmed on the DotA wiki. "R" = recipe scroll.

### 6.1 Consumables (Ancient of Wonders)

| Item | Cost | Effect |
|---|---|---|
| Clarity Potion | 50 | Restores mana over time (150 in 6.83 ✅). Broken by damage. |
| Healing Salve | 110 ✅ | Restores HP over time. Broken by damage. |
| Ancient Tango of Essifation | ~90–125 | Eat a tree for HP regen over time. Several charges. |
| Observer Wards | ~150 (×2) | Invisible vision ward, ~6 min. |
| Sentry Wards | ~200 (×2) | Invisible True Sight ward that reveals invisible units and wards. |
| Dust of Appearance | 180 | Reveals invisible enemies in an area. |
| Town Portal Scroll | 135 | Channel, then teleport to an allied building. |
| Smoke of Deceit | ~100 | Group invisibility + speed until you get near an enemy. |
| Animal Courier | 120 ✅ | Ground unit that ferries items. |
| Flying Courier | ~220 | Upgrades the Animal Courier to a faster, flying one. |
| Magical Bottle | ~600 | 3 charges of regen. Refills at the Fountain. Stores runes ✅. |
| Gem of True Sight | 900 | Permanent True Sight around the carrier. **Drops on death.** |

### 6.2 Attribute basics (Sena the Accessorizer ✅)

| Item | Cost | Stats |
|---|---|---|
| Ironwood Branch | ~53 | +1 all attributes (the most cost-efficient stat item ✅) |
| Gauntlets of Strength / Slippers of Agility / Mantle of Intelligence | 150 | +3 to one attribute |
| Circlet of Nobility | 165 ✅ | +2 all |
| Belt of Giant Strength ✅ / Band of Elvenskin / Robe of the Magi | 450 | +6 to one attribute |
| Ogre Club ✅ / Blade of Alacrity ✅ / Staff of Wizardry ✅ | 1000 | +10 to one attribute |
| Ultimate Orb | 2100 | +10 all |

### 6.3 Armaments & misc basics (Weapons Dealer, Cache of Quel'Thelan ✅, etc.)

| Item | Cost | Stats |
|---|---|---|
| Ring of Protection | 175 | +2 armor |
| Quelling Blade | 225 | Melee bonus damage vs. creeps. Can chop trees. |
| Stout Shield | 250 | Chance to block a flat amount of attack damage |
| Orb of Venom | ~275 | Poison orb (slow + damage over time) |
| Magic Stick | 200 ✅ | Gains charges when enemies cast nearby. Burst heal + mana. |
| Sage's Mask | 325 | +50% mana regen |
| Ring of Regeneration | 350 | +2 HP regen |
| Blades of Attack | 420–450 | +9 damage |
| Boots of Speed | 450 | +50 movement speed (Cache of Quel'Thelan / Side Shop ✅) |
| Gloves of Haste | 500 | +15% attack speed |
| Chainmail | 550 | +5 armor |
| Cloak | 550 | +15% magic resistance |
| Quarterstaff | 900 | +10 damage, +10% attack speed |
| Morbid Mask | 900 | Lifesteal orb (15%) |
| Helm of Iron Will | 950 | +5 armor, +3 HP regen |
| Broadsword | 1200 | +18 damage |
| Claymore | 1400 | +21 damage |
| Platemail | 1400 | +10 armor |
| Shadow Amulet | 1400 ✅ | Invisibility while standing still |
| Javelin | 1500 | +21 damage, chance for bonus damage |
| Mithril Hammer | 1600 | +24 damage |
| Ghost Scepter | 1600 | +7 all, active: Ethereal form (immune to physical, can't attack) |
| Talisman of Evasion | 1800 | +25% evasion |
| Kelen's Dagger (Blink) | 2150 | Teleport ~1200 units. Disabled for 3 s after taking hero damage. Double-click blinks toward your Fountain ✅ |

### 6.4 Secret Shop components (Leragas the Vile ✅)

| Item | Cost | Stats |
|---|---|---|
| Ring of Health ✅ | 875 | +5 HP regen |
| Void Stone ✅ | 875 | +100% mana regen |
| Energy Booster ✅ | 900–1000 | +250 mana (also at the Side Shop ✅) |
| Vitality Booster | 1100 | +250 HP |
| Point Booster ✅ | 1200 | +200 HP, +150 mana |
| Hyperstone ✅ | 2100 | +55% attack speed |
| Demon Edge | 2400 | +46 damage |
| Mystic Staff | 2700 | +25 INT |
| Reaver ✅ | 3000 | +25 STR |
| Eaglesong | 3200 | +25 AGI |
| Sacred Relic ✅ | 3800 | +60 damage |

### 6.5 Upgraded (recipe) items

**Early-game and stat "wraps"**

| Item (DotA 1 name) | Build | Effect |
|---|---|---|
| Magic Wand ✅ | Magic Stick + 3 Branches + R | More charges (17 max in 6.83 ✅), +3 all |
| Bracer / Wraith Band ✅ / Null Talisman | Circlet + Gauntlets/Slippers/Mantle + R | +2 all, +4 primary-themed stat, plus damage |
| Soul Ring ✅ | Sage's Mask + Ring of Regen + R | Sacrifice HP for temporary mana |
| Ring of Basilius ✅ | Sage's Mask + Ring of Protection | Armor + mana regen aura |
| Ring of Aquila ✅ | Wraith Band + Ring of Basilius | Combined aura (doesn't stack with other armor auras ✅) |
| Headdress of Rejuvenation | Ring of Regen + Branch + R | HP regen aura |
| Nathrezim Buckler | Chainmail + Branch + R | Active armor for nearby allies |
| Urn of Shadows | Gauntlets ×2 + Sage's Mask + R | Charges on nearby hero deaths. Heal ally / damage enemy |
| Poor Man's Shield | Slippers ×2 + Stout Shield | Damage block (always blocks vs. heroes ⚠️) |
| Perseverance | Ring of Health + Void Stone | HP + mana regen, damage |
| Oblivion Staff | Quarterstaff + Sage's Mask + Robe of the Magi | INT, attack speed, damage, mana regen |
| Hand of Midas | Gloves of Haste + R | Turn a creep into gold + XP |

**Boots**

| Item | Build | Effect |
|---|---|---|
| Power Treads ✅ | Boots + Gloves of Haste + Belt/Band/Robe | Attack speed + switchable +8 STR/AGI/INT ("tread switching") |
| Phase Boots ✅ | Boots + Blades of Attack ×2 ✅ (Gateway Relics) | Damage. Active: speed boost + walk through units |
| Arcane Boots ✅ | Boots + Energy Booster ✅ (Supportive Vestments) | Active: restore mana to nearby allies |
| Tranquil Boots ✅ | Boots + Ring of Protection + Ring of Regen ✅ | Big HP regen + speed. Turns off when you attack or get hit ⚠️ |
| Boots of Travel ✅ | Boots + R ✅ | Max boot speed. Teleport to any allied unit or building |

**Support/Caster**

| Item | Build | Effect |
|---|---|---|
| Medallion of Courage | Chainmail + Sage's Mask + R | Swap armor with a target: −armor on an enemy, or +armor on an ally (6.83 ✅) |
| Ancient Janggo of Endurance (Drums) | Bracer + Robe + R | Aura + active speed/attack-speed burst (6 charges in 6.83 ✅) |
| Mekansm | Buckler + Headdress + R | Active AoE heal + armor |
| Vladmir's Offering | Basilius + Headdress + Morbid Mask + R | Lifesteal/damage/armor/regen aura |
| Pipe of Insight | Hood of Defiance + Headdress + R | AoE magic barrier (12 s in 6.83 ✅) |
| Hood of Defiance | Ring of Health + Cloak + Ring of Regen | Magic resistance + HP regen |
| Eul's Scepter of Divinity | Staff of Wizardry + Sage's Mask + Void Stone + R (650 ✅) | Cyclone: lift a target (or yourself), invulnerable and disabled, for 2.5 s |
| Force Staff | Staff of Wizardry + Ring of Regen + R | Push any unit 600 units in the direction it's facing |
| Necronomicon (1→3) | Staff of Wizardry ×? + Belt + R ⚠️ | Summons warriors (mana burn, true sight) and archers |
| Dagon (1→5) | Null Talisman + Staff of Wizardry + R (repeat R for each level) | Targeted magic burst |
| Veil of Discord | Helm of Iron Will + Null Talisman ×2 + R ⚠️ | Magic amplification aura/active ⚠️ |
| Rod of Atos ✅ | Staff of Wizardry ×2 + Vitality Booster ✅ (Arcane Sanctum) | Targeted slow |
| Orchid Malevolence | Oblivion Staff ×2 + R | Silence that amplifies damage taken |
| **Aghanim's Scepter** ✅ | Point Booster + Ogre Club + Blade of Alacrity + Staff of Wizardry ✅ (Arcane Sanctum) | +stats, upgrades most ultimates |
| Refresher Orb | Perseverance ×2 + R | Resets all cooldowns (195 s cooldown in 6.83 ✅) |
| Guinsoo's Scythe of Vyse | Mystic Staff + Ultimate Orb + Void Stone | Hex for 3.5 s |
| Shiva's Guard | Platemail + Mystic Staff + R | Armor, INT, slow aura, AoE frost blast |
| Linken's Sphere | Ultimate Orb + Perseverance + R | Blocks one targeted spell every ~17 s |
| Soul Booster | Point Booster + Vitality Booster + Energy Booster | HP, mana, regen |
| Bloodstone | Soul Booster + Perseverance ×? ⚠️ | Charges from kills. Lowers respawn time. Death heals allies |
| Ethereal Blade | Eaglesong + Ghost Scepter | Ethereal blast (amplifies magic damage) |

**Carry/Weapons**

| Item | Build | Effect |
|---|---|---|
| Lothar's Edge (Shadow Blade) | Claymore + Quarterstaff | Invisibility + bonus damage on the attack that breaks it |
| Battle Fury | Broadsword + Claymore + Perseverance | Melee cleave + regen |
| Crystalys | Broadsword + Blades of Attack + R | Crit |
| **Buriza-do Kyanon (Daedalus)** | Crystalys + Demon Edge | 25% chance for a 2.4× crit |
| Cranium Basher (Skull Basher) ✅ | Javelin + Belt + R ✅ | Bash (not on some heroes ⚠️) |
| Abyssal Blade ✅ | Skull Basher + Sacred Relic ✅ (Ancient Weaponry) | Bash + active 2 s stun that pierces magic immunity |
| Monkey King Bar | Demon Edge + Javelin ×2 | True Strike + mini-bash chance |
| Stygian Desolator ✅ | Mithril Hammer ×2 + R ✅ | Armor-reduction orb (UAM) |
| Yasha ✅ | Blade of Alacrity + Band of Elvenskin + R | AGI, attack speed, movement speed % (unique) |
| Sange ✅ | Ogre Club + Belt + R | STR, damage, maim (slow) chance |
| Sange and Yasha ✅ | Sange + Yasha | Combines both, with stronger maim |
| Manta Style ✅ | Yasha + Ultimate Orb + R | Active: 2 illusions + dispel |
| Heaven's Halberd ✅ | Sange + Talisman of Evasion ✅ | Evasion + active disarm |
| Diffusal Blade (1→2) | Blade of Alacrity ×2 + Robe + R | Feedback (burns mana) + active purge (not a UAM in 6.83 ✅) |
| Mask of Madness | Morbid Mask + R | Lifesteal + active berserk (attack speed, takes more damage) |
| Helm of the Dominator ✅ | Helm of Iron Will + Morbid Mask ✅ | Lifesteal + take control of a creep (500 HP bonus in 6.83 ✅) |
| Satanic ✅ | Reaver + Helm of the Dominator + R ✅ (Enchanted Artifacts) | STR, lifesteal, active huge lifesteal |
| Maelstrom → Mjollnir | Mithril Hammer + Gloves + R → + Hyperstone + R | Chain lightning procs. Static shield active |
| Eye of Skadi | Ultimate Orb ×2 + Point Booster + Orb of Venom | Stats + frost slow orb |
| Armlet of Mordiggian | Helm of Iron Will + Gloves + Blades of Attack + R (500 ✅) | Toggle: big STR + attack speed, drains HP |
| Black King Bar ✅ | Mithril Hammer + Ogre Club + R ✅ | Avatar: magic immunity for 10 s, shrinking to 5 s with each use ✅ |
| Radiance | Sacred Relic + R | Burn aura (~50 damage per second) + miss chance |
| Butterfly | Eaglesong + Talisman of Evasion + Quarterstaff | AGI, damage, attack speed, 35% evasion |
| Assault Cuirass ✅ | Platemail + Hyperstone + Chainmail + R ✅ | Aura: armor/attack speed for allies, −armor for enemies |
| Heart of Tarrasque ✅ | Reaver + Vitality Booster ×2 ✅ | STR, HP, % regen when out of combat |
| Vanguard ✅ | Ring of Health + Vitality Booster + R ✅ | HP, regen, damage block |
| Crimson Guard | Vanguard + Buckler + R ⚠️ | Active AoE damage block (10 s in 6.83 ✅) |
| Blade Mail ✅ | Broadsword + Chainmail + Robe ✅ (Protectorate) | Active: returns damage taken |
| **Divine Rapier** | Demon Edge + Sacred Relic | Huge damage (+300/330 ✅). **Drops on death** and anyone can pick it up |

### 6.6 Special drops
- **Aegis of the Immortal:** from Roshan. Can't be sold or dropped onto a teammate ✅. One revive.
- **Cheese:** from later Roshan kills. Instantly restores a large amount of HP and mana.

### 6.7 Item mechanics to keep in mind
- **6 inventory slots.** Items combine automatically. Recipe scrolls are "fake items" bought by clicking the finished item ✅.
- **Selling** gives back 50% of the cost (100% within a short window ⚠️).
- **Drop / give / courier:** some items can't be dropped (Aegis), some drop on death (Gem, Rapier), and some can't be shared.
- **Item cooldowns are shared** across duplicate copies of the same item ⚠️.
- **Stock & restock:** wards, smoke and couriers have limited shop stock that restocks over time.
- **Unique stacking flags:** Yasha's movement speed, auras, bash, crit, lifesteal and orbs (see §4.7).
- **Disassembly:** wasn't possible in DotA 1 ⚠️.

---

## 7. Units

### 7.1 Lane creeps ⚠️ (approximate stats)
- **Spawn:** a wave every **30 s** from each team's barracks, in all 3 lanes. The first wave arrives at the river at ~1:30 game time.
- **Composition:** 3 melee + 1 ranged. A **siege unit** (catapult / meat wagon) joins every 7th wave ⚠️. More creeps are added to each wave as the game goes on (e.g. +1 melee around 15–17 min, +1 ranged later).
- **Melee:** ~550 HP, ~19–23 damage, 2 armor. **Ranged:** ~300 HP, ~21–26 damage, attack range 500. **Siege:** high damage vs. buildings, slow attack, long range.
- **Creeps get stronger over time:** small HP/damage increases every ~7.5 min ⚠️.
- **Super creeps** come from a destroyed enemy barracks. **Mega creeps** come from all 6.
- **Creep aggro AI:** creeps attack the nearest enemy. If an enemy hero attacks an allied hero nearby, creeps switch to that hero. You can drop aggro by right-clicking an ally creep or using another trick (player skill: aggro pulling).
- **Creep blocking:** at the start of the game a hero can walk in front of their first wave to slow it, which moves the lane equilibrium toward their tower.

### 7.2 Neutral camps (both jungles + "ancients")
They spawn **every minute on the minute**, but only if the camp's spawn box is empty of units. That's what makes **stacking** possible: pull the camp out of its box just before the minute so a second group spawns.

| Tier | Camp | Notable abilities |
|---|---|---|
| Small | Kobolds (Kobold, Kobold Soldier, Kobold Taskmaster) | Speed aura |
| Small | Forest/Hill Trolls (Troll Berserkers + Troll Priest) | Priest heals |
| Small | Gnoll Assassins | Poison attack |
| Small | Ghosts (Ghost + Fell Spirit) | Frost attack slow |
| Small | Harpies (Harpy Scout + Stormcrafter) | Chain lightning |
| Medium | Wolves (Giant Wolves + Alpha Wolf) | Crit aura |
| Medium | Satyrs (Trickster + Soulstealer) | Purge, mana burn |
| Medium | Ogres (Bruiser + Frostmage) | Frost Armor |
| Medium | Mud Golems | Split into smaller golems on death |
| Large | Centaurs (Courser + Khan) | War Stomp (AoE stun), endurance aura |
| Large | Satyr Hellcaller / Tormenter | Shockwave, unholy aura |
| Large | Polar Furbolgs (Ursa Warrior / Champion) | Clap (AoE slow) |
| Large | Dark Trolls (Summoner) | Ensnare, raise skeletons |
| **Ancient** | Black Dragon + Black Drakes | Splash, fire attack |
| **Ancient** | Granite Golem + Rock Golems | HP aura (6.83: Granite Golem down to 1700 HP, +15% HP aura ✅) |
| **Ancient** | Thunderhides / Ancient Lizards | Slam, frenzy |

Neutral creeps matter beyond their gold. Chen, Enchantress and Helm of the Dominator **take control of them** and use their active abilities, so neutral design doubles as a power pool for those heroes.

### 7.3 Roshan
See §2.4. His HP, armor and damage grow over time ⚠️. He has Bash and Slam ⚠️, and he's immune to most spells.

---

## 8. Game Modes & Commands

The host (Blue / Player 1) types a mode string in the first ~15 s. Modes combine, e.g. `-apem`, `-sdomsh`.

### 8.1 Draft modes

| Command | Name | How it works |
|---|---|---|
| `-ap` | All Pick | Pick any hero from either side's taverns |
| `-ar` | All Random | Every player gets a random hero |
| `-sd` | Single Draft | Each player chooses from 3 random heroes (1 STR / 1 AGI / 1 INT) |
| `-rd` | Random Draft | A shared pool of ~20 random heroes. Teams pick in turn |
| `-cm` | Captains Mode | Captains ban and pick in turn (the tournament standard) |
| `-cd` | Captains Draft | Captains draft from a random pool |
| `-lm` / `-xl` | League Mode / Extended League | Alternating picks, tournament style |
| `-vr` | Vote Random | Vote on random options |
| `-mm` | Mirror Match | Both teams get the same 5 heroes |
| `-ar` + `-sp` / `-sh` | Shuffle Players / Same Hero | Shuffle teams; everyone plays the same hero |
| `-dm` | Death Match | Heroes are replaced when they die, up to a death limit |
| `-rv` | Reverse | You pick your enemy's hero ⚠️ |
| `-aa` / `-ai` / `-as` | All Agility / Int / Strength | Restricts the hero pool by attribute |
| `-mo` / `-ro` | Melee Only / Range Only | Restricts by attack type |
| `-tr` | Team Random | Random heroes, but from your own side's taverns |

### 8.2 Modifiers

| Command | Effect |
|---|---|
| `-em` | Easy Mode: more gold/XP, weaker towers |
| `-om` | Only Mid: creeps spawn only in mid |
| `-wtf` | No mana costs and no cooldowns |
| `-sc` | Super Creeps spawn periodically |
| `-ns` / `-nr` | No Swap / No Repick |
| `-id` | Item Drop on death |
| `-fr` | Fast Respawn |
| `-mi` | Mini heroes (cosmetic, smaller models) |
| `-ulm` / `-nt` ⚠️ | Unlimited/no-timer variants |
| `-pm` | Pooling mode ⚠️ |
| `-so` | Switch On: lets players switch teams mid-game |
| `-ts` | Team Swap ⚠️ |

### 8.3 In-game player commands

| Command | Effect |
|---|---|
| `-repick` | Re-choose your hero (costs gold) |
| `-random` | Random hero (bonus gold) |
| `-swap N` / `-swaphero` | Trade heroes with a teammate during the pick phase |
| `-ms` | Show your movement speed |
| `-cs` / `-cson` | Show your creep score (last hits/denies) |
| `-matchup` / `-ma` | Show enemy heroes and levels |
| `-unstuck` | Teleport to the Fountain after a delay (anti-stuck) |
| `-apm` | Show actions per minute |
| `-disablehelp` | Stop allies from controlling your units |
| `-showdeny` ⚠️ | Toggle the "!" indicator on denies |
| `-gg` / `-ff` (community) | Surrender votes ⚠️ |
| `-water red/blue/green` | Change the river's color (cosmetic Easter egg) |
| `-weather rain/snow/moonlight` | Cosmetic weather |
| `-fun` / `-test` | Single-player fun and test commands (spawn creeps, levels, gold) |

### 8.4 Controls (inherited from WC3)
- **RTS controls:** box select, control groups (Ctrl + number), right-click to move/attack, **A** attack-move, **S** stop, **H** hold position, **P** patrol, **Shift** to queue orders.
- **Inventory** uses numpad hotkeys 7/8/4/5/1/2 by default. This is a notorious problem, and it's why tools like Warkeys and Customkeys existed.
- **Per-spell hotkey letters** are set in the map's data, not fixed QWER.
- **Courier** is shared and controlled by the whole team. Allies can share control of units.
- **Camera** is free RTS camera. You can type `-zoom` ⚠️ in some versions.

---

## 9. Emergent Player Skills (systems must support these)
1. **Last hitting & denying.** Damage numbers, creep HP and attack timing need to be precise and readable.
2. **Lane equilibrium.** Creep blocking, pulling neutrals into your own lane creeps, and stacking. These depend on aggro rules, spawn boxes and camp timers.
3. **Orb walking / animation canceling.** Attack point and backswing must be data-driven, and commands must be able to interrupt animations.
4. **Juking.** Trees and fog of war, with height-based vision. Trees must block vision. There's no "see through trees" vision.
5. **Tread switching / item drop tricks.** Mechanics like "stats change max HP but keep the current %" create real, readable depth. Decide on purpose whether we keep them.
6. **Warding.** Ward stock, ward duration, True Sight counterplay, and good spots on cliffs/high ground.
7. **Ganking & smoke.** Night vision, invisibility counterplay, TP scrolls and fast rotations.
8. **Rune control & Bottle.** Two-spot uncertainty + mid hero rotations.
9. **Roshan timing & Aegis.** A risk/reward objective. Timers create map tension.
10. **Teamfight execution.** Combos (e.g. Ravage + Echo Slam). This needs strict spell ordering, channel interruption rules and readable AoE indicators.
11. **Buyback & high-ground sieges.** Comeback mechanics.
12. **Micro.** Illusions, summons, Meepo, Lone Druid's bear, Chen's creeps. This needs multi-unit control, selection groups and per-unit inventories.

---

## 10. Implications for Our Build

### 10.1 IP note (important)
Rebuilding **DotA itself** (its hero names, characters, spells as named, art, map, item names, or Warcraft/Valve lore) isn't something we should do. Those belong to Blizzard and Valve, and a recreation would also be a straight copy rather than our game. What we *can* build is an **original MOBA in this genre**, because the genre's *conventions* are shared and used by many games:
- lanes
- towers and barracks
- creep waves
- last hits and denies
- a jungle
- a boss with a resurrection drop
- runes
- attribute-based heroes
- recipe items
- draft modes

So the plan should treat this doc as **mechanics research**, then define **RiseOfCitadel's own** factions, heroes, abilities, items, map and art. "Citadel" already gives us a good original theme to build around.

### 10.2 Systems inventory implied by the research
A foundation PR would lay the groundwork for these, in rough dependency order:

1. **Simulation core:** a deterministic fixed-tick game loop and an entity/component model (units, buildings, projectiles, wards, trees).
2. **Map & pathing:** grid/navmesh, collision sizes, destructible trees, elevation/ramps, high-ground miss chance.
3. **Vision:** fog of war, day/night radii, high-ground occlusion, tree occlusion, True Sight vs. invisibility.
4. **Unit stats & attributes:** STR/AGI/INT derivations, base + per-level gains, the armor formula, magic resistance.
5. **Attack system:** acquisition and aggro rules, attack point/backswing, projectiles, BAT/IAS, PRD procs, damage block, evasion, cleave, an explicit attack-modifier priority system (our cleaner version of orbs).
6. **Data-driven ability system:** target types (unit/point/no-target/passive/toggle/autocast/channel), modifiers/buffs with stacking rules, damage types, dispel tiers, disable states, spell immunity and its exceptions, and mana/cooldown. Everything should be defined in data files, so ~100 heroes don't mean ~100 hand-coded classes.
7. **Items & shops:** a 6-slot inventory, recipes that combine automatically, shop zones (Fountain / side / secret), stock/restock, a courier, selling.
8. **Economy & XP:** passive gold, bounties, last hit/deny, reliable/unreliable gold, assist split, buyback, the XP curve, skill points.
9. **Lane/creep director:** wave spawns, wave growth, super/mega creeps, neutral camp spawns with spawn-box checks, the boss.
10. **Structures:** tower tiers + invulnerability chain, backdoor protection, glyph, barracks → creep upgrade, Ancient = win condition.
11. **Game flow:** hero pick/draft modes, a mode/modifier parser, day/night clock, runes, respawn timers, end of game.
12. **Networking:** 10 players with server-authoritative or lockstep simulation. This is the hardest architectural decision, and it should be made *before* gameplay code.
13. **Client:** RTS camera, input (attack-move, hold, queue, control groups, rebindable hotkeys from day one), HUD, minimap, AoE indicators.
14. **Bots/AI:** at least basic lane bots for testing.

### 10.3 Open questions to settle in the plan
- **Engine and platform:** Unity / Godot / Unreal / a custom web stack? Browser-playable or desktop?
- **Networking model:** lockstep (WC3-style, deterministic) vs. server-authoritative with client prediction (Dota 2-style).
- **Scope of the first playable:** e.g. 1 lane, 2 original heroes, towers + creeps + last hitting, 1v1 or vs. bots.
- **How "WC3-faithful" the feel should be:** turn rates, animation timings and orb-style quirks vs. modern cleanups.
- **Art direction** and the original setting/lore for the "Citadel."

---

*End of reference.*
