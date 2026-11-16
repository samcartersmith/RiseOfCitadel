# RiseOfCitadel — Roadmap

An original 5v5 MOBA in the genre that WC3 DotA defined. It's **browser-based (TypeScript + Babylon.js)**, with a **central authoritative server** like Dota 2's. It launches with the full 3-lane map and **4 original heroes**: Bulwark, Kestrel, Cinderwright and Lantern. The long-term goal is **32 heroes**.

- Mechanics research: [`docs/research/dota-allstars-reference.md`](../research/dota-allstars-reference.md). We borrow the genre's *conventions*, never DotA's heroes, names, spells, art or map.
- Art direction & hero briefs: [`docs/design/art-direction.md`](../design/art-direction.md).

---

## 0. Key decisions

| Area | Decision | Why |
|---|---|---|
| Language | **TypeScript (strict) everywhere**: client, simulation, server, tools | One language. The client and server share the exact same game-rules code. |
| Renderer | **Babylon.js** (`@babylonjs/core`, `loaders`, `gui`). **WebGPU engine with an automatic WebGL2 fallback** | Free, no license, built for the web. WebGPU gives us headroom for "strong graphics." |
| Client build | **Vite**, ES modules, code-split + lazy-loaded asset bundles | Fast dev server. A static build deploys to Vercel. |
| Simulation | **`@citadel/sim`: pure TS, no DOM/Babylon imports**, fixed **30 Hz** tick, seeded RNG, data-driven | Runs on the server (authority) and in the client (offline mode + prediction). Tested with Vitest in milliseconds. |
| Server | **Node 20 + `ws`** (`apps/server`) hosting `@citadel/sim` | The central authority. Runs locally for now. |
| Transport | **WebSockets, binary** (`ArrayBuffer` + our own compact serializer) | Works in every browser. Easy to host. |
| Netcode | Clients send **commands**. The server simulates and sends **delta snapshots filtered by fog of war**. Clients interpolate others and predict their own hero | Dota 2-style. Hidden units are never sent, so there are no map hacks. |
| Content | JSON data validated by **zod** schemas (heroes, abilities, items, units, map, modes) | Adding hero #5 through #32 is mostly data. |
| Assets | **CC0 packs (KayKit, Quaternius, Kenney, Poly Haven, ambientCG) → glTF/GLB**. Processed by a Node pipeline (`@gltf-transform`: meshopt compression, KTX2/Basis textures, palette remap) | No art team needed. Consistent look. Small downloads. |
| Hosting | **Client: Vercel** (static). **Server: local** (`pnpm dev:server`) for now. Fly.io/Railway when friends need to play over the internet (M3-08) | Vercel can't run long-lived WebSocket servers. It only runs short serverless functions. |
| Testing & CI | **GitHub Actions** (free): typecheck, lint, **Vitest** for sim/server, **Playwright** for headless browser smoke tests + screenshots, content validation | Everything runs without licensed tools, so subagents can verify their own PRs. |

### Repo layout (pnpm workspace; set up in M0)
```
/apps
  /client           Vite + Babylon.js game client
    /src
      /render       engine bootstrap, quality tiers, pipeline, shaders
      /map          terrain, water, foliage, structures placement
      /units        UnitView, animation controller, health bars
      /vfx          particle/decal library, pooling
      /camera       MOBA camera
      /input        commands, hotkeys, targeting indicators
      /hud          Babylon GUI or DOM overlay HUD
      /net          WebSocket client, interpolation, prediction
      /bridge       sim ↔ view sync (offline + online)
      /heroes/<id>  per-hero view config (anims, VFX mapping)
    /public/assets  processed GLB/KTX2 (output of the asset pipeline)
    /tests          Playwright smoke + screenshot specs
  /server           Node authoritative server
/packages
  /sim              @citadel/sim: pure game rules (no DOM)
  /protocol         @citadel/protocol: message types + binary codec
  /content          @citadel/content: JSON data + zod schemas + loader
/assets-src         raw CC0 downloads (Git LFS) + LICENSE per pack + CREDITS.md
/tools              asset pipeline, content validator, map exporter, bot runner, perf report
/docs               research, plan, design docs (one per hero)
```

**Folder ownership is what lets subagents work in parallel.** Every PR lists the folders it may touch. Two PRs that touch the same folder never run at the same time.

---

## How PRs are sized for subagents

- **One PR = one reviewable unit,** about 200–800 lines of real change. It has a "done when" check the agent can run itself: `pnpm test`, `pnpm typecheck`, `pnpm validate:content`, `pnpm build`, or a Playwright screenshot.
- **IDs:** `M<milestone>-<nn>`. **Deps** must be merged first. PRs in the same *wave* with no shared folders run in parallel.
- **Visual PRs:** Playwright opens the scene in headless Chromium, waits for a `window.__citadelReady` flag, and saves screenshots as CI artifacts. Agents link them in the PR. **You** judge look and feel.
- **Performance:** the client exposes engine counters (draw calls, active meshes, triangles, JS heap) on `window.__citadelStats`. CI checks those counts against the budget; they're deterministic, unlike FPS. **Real FPS checks happen on your machine** with the in-game perf HUD, because CI has no GPU.
- **Every PR** updates the relevant doc, adds tests for sim/server code, and passes CI.
- **Sim purity rule:** an ESLint boundary rule plus a CI check fail the build if `packages/sim` imports Babylon, the DOM, or anything from `apps/`.

---

## Milestone 0 — Foundation
Goal: a wired-up monorepo where the client builds and deploys to Vercel, the sim and server build and test, and CI verifies everything.

| ID | PR | Folders | Deps | Done when |
|---|---|---|---|---|
| M0-01 | Repo scaffold: pnpm workspace, TS strict base config, ESLint + Prettier, `.gitignore`, `.gitattributes` + Git LFS for `/assets-src`, README, CONTRIBUTING (PR rules, folder ownership), LICENSE | root, `/docs` | — | `pnpm install && pnpm typecheck` pass on an empty workspace. |
| M0-02 | Client app: Vite + Babylon, WebGPU-with-WebGL2-fallback engine bootstrap, empty scene, resize handling, `__citadelReady` + `__citadelStats` hooks | `apps/client` | 01 | `pnpm --filter client dev` shows a scene. `build` produces `dist/`. |
| M0-03 | Packages: `sim` (tick loop stub + Vitest), `protocol` (codec stub), `content` (zod + loader stub) + sim purity lint rule | `packages/*` | 01 | `pnpm test` passes. The lint rule fails on a deliberate DOM import. |
| M0-04 | Server app: Node + `ws` echo server, `pnpm dev:server`, a shared protocol handshake | `apps/server` | 03 | The client connects to `ws://localhost:7777` and gets an echo. |
| M0-05 | CI: GitHub Actions for typecheck, lint, test, build, content validation, Playwright smoke + screenshot artifacts | `.github/`, `apps/client/tests` | 02, 03 | Every PR shows a green check with screenshots attached. |
| M0-06 | Vercel: `vercel.json` (build command, output dir, long-cache headers for `/assets`, SPA fallback), preview deploys per PR | root config | 02 | A `main` push deploys. PRs get preview URLs. |
| M0-07 | Asset pipeline v0: `tools/assets` script (glTF → meshopt + KTX2, writes into `public/assets`), a `CREDITS.md` generator from per-pack `LICENSE` files | `/tools/assets`, `/assets-src` | 01 | One sample CC0 model goes through the pipeline and loads in the client. |
| M0-08 | Download the approved CC0 packs into `/assets-src/<pack>/` with licenses (**needs your OK, since it downloads files**) | `/assets-src` | 07 | `CREDITS.md` lists every pack with its source URL and license. |

**Waves:** 01, then (02 ∥ 03 ∥ 07), then (04 ∥ 05 ∥ 06 ∥ 08).

---

## Milestone 1 — Strong Graphics
Goal: the **full 3-lane map looks like a shippable game in the browser**, with Bulwark running around it in a sandbox (local movement only, no game rules yet).

**Budget** (checked by CI counters + your local perf HUD):
- ≤ 150 draw calls and ≤ 300k triangles in a typical view.
- ≤ 400 MB JS/GPU memory.
- ≤ 30 MB initial download (the rest is lazy-loaded).
- **60 fps at 1080p** on integrated graphics (Intel Iris Xe / Apple M1 class) on the High tier, WebGPU.

| ID | PR | Folders | Deps | Done when |
|---|---|---|---|---|
| M1-01 | Rendering baseline: quality tiers (High/Med/Low), `DefaultRenderingPipeline` (ACES tonemap, bloom, FXAA, color grading LUT), cascaded shadows on High, hardware scaling, perf HUD overlay | `client/src/render` | M0 | The tier switch changes counters. The perf HUD shows in the build. |
| M1-02 | **Citadel toon shader**: a ramp-lit shader with rim light, height gradient, team-color mask, palette gradient-map, written once as a Babylon `ShaderMaterial`/Node Material that works on both WebGPU and WebGL2 | `client/src/render/shaders` | 01 | A test scene shows KayKit models restyled. Screenshots match the art brief palette. |
| M1-03 | MOBA camera: angled RTS camera, edge/drag pan, zoom limits, minimap jump, hero lock, rebindable keys | `client/src/camera`, `client/src/input` | M0 | Camera feel spec doc + Playwright test for bounds. |
| M1-04 | **Map spec as data**: lanes, river, bases, high ground, ramps, tree zones, camps, shops, boss pit, rune spots, every structure position → `packages/content/map/citadel.json` | `packages/content/map`, `/docs/design` | M0 | Schema-validated. A top-down SVG is rendered from it by a tool. |
| M1-05 | Terrain: heightmap terrain built from map data (plateaus, ramps, riverbed), a splat shader (4–8 ambientCG layers, palette-remapped), faction biome blend across the river | `client/src/map/terrain` | 02, 04 | Screenshots approved. Inside budget. |
| M1-06 | River water shader: cheap flow-map, light motes, shoreline foam | `client/src/map/water` | 05 | Looks right on both WebGPU and WebGL2. |
| M1-07 | Foliage: **thin-instanced** trees (each one hideable by ID for later tree destruction), wind sway in the vertex shader, grass cards on High only | `client/src/map/foliage` | 05 | 1500+ trees inside budget. |
| M1-08 | Structures: Warden & Hollow towers (3 tiers), barracks ×2, Ancients (Hearthstone / Hollow Crown), fountain, shops, kit-bashed from CC0 packs, with LODs | `client/src/map/structures`, `/assets-src` | 02, 04 | Placed from map data. Readable at camera height. |
| M1-09 | Lighting & atmosphere: a day/night rig driven by one `t ∈ [0,1]` (sun angle, color, ambient, fog, emissive braziers), an environment texture from a Poly Haven HDRI | `client/src/render/lighting` | 05 | A day↔night slider in the dev panel runs smoothly. |
| M1-10 | Hero pipeline: rig/animation conventions (KayKit Rig_Medium + Quaternius animation retarget), an `AnimationController` (idle/run/attack×2/cast×3/channel/death, crossfades), team-color mask authoring guide | `client/src/units`, `/docs` | 02 | A stock KayKit character plays all states. |
| M1-11 | **Bulwark** model: kit-bash per the art brief (Knight body + gate shield + mace + moss/chains), restyle, full animation set | `client/src/heroes/bulwark`, `/assets-src` | 10 | Runs, attacks and casts in the sandbox. Silhouette check passes. |
| M1-12 | VFX library: shared particle textures (Kenney), GPU particles on WebGPU with a CPU fallback, ground decals for AoE/telegraphs, a projectile trail system, pooling | `client/src/vfx` | 01 | Demo scene shows each primitive inside budget. |
| M1-13 | `UnitView`: model + animator + HP/mana bars (instanced quads) + selection ring + team outline. Driven by a plain state object (ready for the M2 sim) | `client/src/units` | 10 | 50 units with bars inside budget. |
| M1-14 | Creeps, neutrals & boss art: Warden/Hollow melee, ranged and siege creeps, 4 neutral families, the boss. Low-poly, thin-instanced where possible | `client/src/units/creeps`, `/assets-src` | 10 | 40 creeps on screen inside budget. |
| M1-15 | Graphics QA: test on Chrome/Edge/Firefox/Safari, WebGPU vs. WebGL2, integrated vs. discrete GPUs. Tier auto-detect. Fixes. Perf report doc | `client/src/render`, `/docs` | 05–14 | A report doc. All tiers inside budget on your machine. |

**Waves:** (01 ∥ 03 ∥ 04 ∥ 10), then (02 ∥ 12 ∥ 13), then (05 ∥ 08 ∥ 11 ∥ 14), then (06 ∥ 07 ∥ 09), then 15.

**Exit criteria:** a Vercel URL where you fly over the full lit map (with a day/night slider) and run Bulwark around it at 60 fps on your laptop.

---

## Milestone 2 — Gameplay (offline, in the browser)
Goal: the real rules in `@citadel/sim`, rendered by the M1 views, playable **offline** (the sim runs in the browser, in a Web Worker). Most PRs here are pure TypeScript verified with Vitest, which makes them the best fit for subagents.

| ID | PR | Folders | Deps | Done when |
|---|---|---|---|---|
| M2-01 | Sim kernel: fixed tick, entity store (struct-of-arrays), seeded RNG, command queue, world snapshot, hashing for replay checks | `packages/sim/core` | M0 | Replaying 1000 ticks reproduces the same hash. |
| M2-02 | Content schemas: unit/hero/ability/modifier/item/mode zod schemas, loader, `pnpm validate:content` CLI | `packages/content`, `/tools/validate` | 01 | Invalid fixtures fail with clear errors. |
| M2-03 | Map & pathing: load map JSON, nav grid with heights, tree occupancy (trees can be destroyed), A* for heroes + flow fields for creep lanes, collision radii, local avoidance | `packages/sim/map` | 01 | Path tests across ramps and trees. 200 units fit inside the per-tick budget. |
| M2-04 | Vision & fog: per-team visibility grid, day/night radius, high-ground + tree occlusion, true sight vs. invisible | `packages/sim/vision` | 03 | Occlusion tests. A fog bitmap is exported for the client. |
| M2-05 | Stats & attributes: STR/AGI/INT derivations, level gains, armor formula, magic resistance, additive/multiplicative modifiers | `packages/sim/stats` | 02 | Formula tests. |
| M2-06 | Attack system: acquisition, aggro rules, attack point/backswing (cancelable), melee & projectile attacks, attack speed/BAT, pseudo-random procs, evasion, damage block, cleave, the **attack-modifier slot** | `packages/sim/combat` | 05 | A test for each rule, including attack-cancel timing. |
| M2-07 | Ability & modifier framework: target types, cast point, mana/cooldown, modifiers (duration, stacking, dispel tier), damage types, disable states, spell immunity + `piercesImmunity` | `packages/sim/abilities` | 05 | Tests for each target type and disable. |
| M2-08 | Effect library: damage, heal, apply modifier, knockback/pull, dash, blink, spawn unit, projectile (homing/skillshot), area over time, delayed area, chain/bounce, wall/obstacle spawn, channel, mark/stack | `packages/sim/abilities/effects` | 07 | Each primitive is tested on its own. |
| M2-09 | Lane director: waves every 30 s, wave growth, siege waves, creep AI + aggro switching | `packages/sim/lanes` | 03, 06 | A headless 10-minute sim holds lane equilibrium. |
| M2-10 | Structures: tower tiers + invulnerability chain, targeting priority, backdoor protection, glyph, barracks → super/mega creeps, Ancient = win | `packages/sim/structures` | 06, 09 | A test game ends when an Ancient dies. |
| M2-11 | Economy & XP: passive gold, bounties, last hits/denies, XP radius, level curve, skill points, kill/assist gold, death penalty, respawn, buyback | `packages/sim/economy` | 06 | Formula tests. |
| M2-12 | Sim in a Web Worker + bridge: the worker runs the sim. The main thread syncs `UnitView`s from snapshots. Input (right-click, A-move, S, H, shift-queue, cast hotkeys + targeting indicators) → commands | `client/src/bridge`, `client/src/input` | 01, M1-13 | Playable offline: walk, attack, last hit. |
| M2-13 | HUD: portrait, HP/mana, ability bar + cooldowns, skill-up, gold, minimap with fog, kill feed, clock, damage/gold popups | `client/src/hud` | 12 | Everything is driven by sim state. Playwright screenshot. |
| M2-14 | **Bulwark + Kestrel** in data (+ any missing effect primitives, as a separate small PR to `effects/` first) | `packages/content/heroes` | 08 | Scripted ability tests. Playable offline. |
| M2-15 | **Cinderwright + Lantern** in data | same | 14 | Same. |
| M2-16 | Hero art: **Kestrel, Cinderwright, Lantern** (kit-bash + restyle + animations, per the art brief) | `client/src/heroes/{kestrel,cinderwright,lantern}`, `/assets-src` | M1-10 | Can start during M1. Silhouette checks pass. |
| M2-17 | Hero VFX/SFX hookup for all 4: sim ability events → VFX/SFX via each hero's view config | `client/src/heroes/*`, `client/src/vfx` | 14, 15, 16 | Every ability has readable VFX matching its brief. |
| M2-18 | Neutrals, runes & boss: camp spawns with spawn-box check (stacking works), leash AI, runes every 2 min, the boss + its resurrection-relic drop | `packages/sim/neutrals` | 09, 11 | Stacking and rune timing tests. |
| M2-19 | Items v1: 6-slot inventory, base/side/secret shop zones, recipe auto-combine, ~25 items covering the core archetypes. Shop UI | `packages/sim/items`, `packages/content/items`, `client/src/hud/shop` | 07, 11 | Buy, combine and use offline. |
| M2-20 | Day/night, wards, courier: the sim clock drives vision + the M1-09 lighting `t`. Observer/sentry wards. A courier unit | `packages/sim/world`, `packages/sim/items` | 04, 19 | A night gank is hidden in fog. The courier delivers items. |

**Sim track waves:** 01, then (02 ∥ 03), then (04 ∥ 05), then (06 ∥ 07), then (08 ∥ 09 ∥ 11), then (10 ∥ 14 ∥ 18 ∥ 19), then (15 ∥ 20).
**Client/art track (parallel the whole time):** 16, then 12, then 13, then 17.

**Exit criteria:** offline in the browser you can play any of the 4 heroes on the full map against creeps and towers, buy items, level up, and win by destroying the enemy Ancient.

---

## Milestone 3 — Testable Prototype (online, local server)
Goal: **multiple browsers play a full match through the central server**, with bots filling empty slots. First run it on your machine/LAN, then optionally on a cheap host for friends.

| ID | PR | Folders | Deps | Done when |
|---|---|---|---|---|
| M3-01 | Protocol: binary codec (bit-packed), commands/snapshots/events, version handshake | `packages/protocol` | M2-01 | Round-trip tests. Average ≤ 8 KB/s per client. |
| M3-02 | Authoritative server loop: `@citadel/sim` at 30 Hz, command validation, rate limits, match lifecycle | `apps/server` | 01 | A headless 10-bot match completes on the server. |
| M3-03 | Snapshots: delta against acked baselines, **interest management filtered by fog of war** | `apps/server`, `packages/protocol` | 02, M2-04 | Tests prove hidden enemies are never sent. |
| M3-04 | Client netcode: WebSocket client, snapshot buffer, ~100 ms interpolation, clock sync, reconnect | `client/src/net` | 01 | Smooth at 150 ms latency + 2% loss (simulated in tests). |
| M3-05 | Prediction: local hero movement/attack-move prediction + reconciliation, instant cast animation with server-confirmed effects | `client/src/net`, `client/src/bridge` | 04 | Feels responsive at 120 ms round-trip time. |
| M3-06 | Lobby & match flow: create/join by link, team select, All Pick from the 4 heroes, loading screen, end screen with stats | `apps/server/lobby`, `client/src/menus` | 02 | 10 tabs start a match together. |
| M3-07 | Bots v1: lane, last hit, retreat at low HP, use abilities on targets in range, buy from a simple item list | `packages/sim/bots` | M2 done | A 5v5 all-bot match ends in under 45 min. |
| M3-08 | Run & host: `pnpm dev:all` (client + server locally); LAN mode (server binds `0.0.0.0`, client server-URL setting). **Optional:** Dockerfile + Fly.io/Railway deploy with `wss://`, and the Vercel client pointed at it | `apps/server`, `/tools`, root | 02 | Locally: two machines on your Wi-Fi play together. Optional: a public server URL. |
| M3-09 | Telemetry & logs: match logs, server metrics (tick time, bandwidth, RTT), a client error reporter | `apps/server`, `client/src/net` | 08 | A match health summary prints when the match ends. |
| M3-10 | Replays: store the seed + command stream, replay through the sim (offline viewer) | `apps/server`, `client/src/bridge` | 02 | A recorded match plays back. |
| M3-11 | Playtest kit: an in-game bug report (screenshot + state dump), feedback link, playtest checklist | `client/src/hud`, `/docs` | 06 | First playtest is run. |

**Waves:** 01, then (02 ∥ 04), then (03 ∥ 05 ∥ 06 ∥ 07), then 08, then (09 ∥ 10 ∥ 11).

**Exit criteria:** up to 10 players (or fewer + bots) play a full 5v5 on 4 heroes through the server. It's logged and replayable.

**Hosting note:** Vercel serves the client only. A Vercel-hosted page can connect to a server on **your own machine** (`ws://localhost` is allowed). Other people need either your LAN address (open the client from your dev server) or a hosted `wss://` server (M3-08 optional).

---

## Milestone 4+ — The Rest
Independent tracks after M3. Each bullet is one PR or a short PR series.

### M4 — Heroes to 32
- **Per hero, 3 PRs:** `design + art brief doc` → `sim data + tests` → `model + VFX + audio`. Heroes only touch `packages/content/heroes/<id>`, `client/src/heroes/<id>`, `docs/design/heroes/<id>.md` and their `/assets-src` parts, so many can run in parallel.
- Release in **batches of 4** (7 batches after the first 4). Each batch covers the archetype families listed in §Heroes.
- New effect primitives go in **a separate small PR** to `packages/sim/abilities/effects` before the hero PR, so that folder only has one writer at a time.

### M5 — Items & systems depth
- ~70 items. An attack-modifier priority system. Aura stacking rules. Shared item cooldowns.
- An "ultimate upgrade" item (our take on the concept). Reliable/unreliable gold. Denies of heroes under certain debuffs.
- Illusions & summons micro (control groups, per-unit inventory).

### M6 — Modes & drafting
- All Pick, Single Draft, All Random, Captains Mode, Random Draft.
- A mode/modifier parser (fast mode, mid only, no-cooldown sandbox).
- A practice sandbox with spawn tools. A tutorial.

### M7 — Online platform (needs a hosted server)
- Accounts (OAuth), parties, matchmaking/MMR, reconnect/abandon handling, reports.
- Regional servers, autoscaling, spectator mode (it reuses the snapshot stream), a match-history page (can be hosted on Vercel).

### M8 — Polish & production
- Audio (CC0 SFX + original music/announcer), UI/UX pass, accessibility (colorblind team colors, full rebinding).
- Localization scaffolding, anti-cheat audits, load testing.

---

## Heroes

| # | Name | Attribute | Role | Systems it forces us to build |
|---|---|---|---|---|
| H01 | **Bulwark** | STR, melee | Initiator / durable | Dash + stun, taunt, damage return, wall/obstacle spawn ultimate |
| H02 | **Kestrel** | AGI, ranged | Carry | Attack modifier (autocast), evasion/crit procs, dash, mark-and-stack ultimate, a companion that's visual only |
| H03 | **Cinderwright** | INT, ranged | Nuker | Skillshot, delayed AoE + stun, damage-over-time zone, channel-then-beam ultimate |
| H04 | **Lantern** | INT, ranged | Support | Heal over time, dispel (both directions), shield, channeled AoE heal + true-sight ultimate |

Full briefs: [`docs/design/art-direction.md`](../design/art-direction.md).

**Coverage plan for H05–H32** (7 batches of 4). Over the batches, cover:
- Summoner/multi-unit
- Illusion
- Global presence
- Invisibility
- Transformation
- Zone/terrain control
- Resource twist (HP-cost or mana-as-HP)
- Rule-breaking ultimate (time stop, forced duel, spell steal, cooldown reset)

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Browser perf vs. "strong graphics" | Budgets from M1-01. Thin instances. KTX2 + meshopt. Quality tiers + auto-detect. The WebGPU path with a WebGL2 fallback. The M1-15 QA gate. |
| CI can't measure real FPS (no GPU) | CI checks deterministic counters (draw calls, triangles). FPS is checked on your machine via the perf HUD before each milestone exit. |
| CC0 assets look generic or mismatched | One shared toon shader + palette gradient-map + kit-bashing (art brief §1.2). Each hero has an originality check. |
| Asset license mistakes | Download only from the creator's page. A `LICENSE` file per pack. `CREDITS.md` generated automatically. CI fails if a pack folder has no license. |
| WebSocket latency | Small snapshots, prediction, input buffering. Room to move to WebTransport later. |
| Logic leaking into the client | The lint boundary keeps `packages/sim` pure. Review rule: no gameplay rules in `apps/client`. |
| Agents colliding | Folder ownership per PR. Shared folders (`effects/`, `protocol/`) have one writer per wave. |
| Vercel can't host the server | The local server for M3. Fly.io/Railway when needed. |
| IP drift toward copying DotA | Hero design docs have an originality section. Names, kits and art are reviewed against the research doc. |

---

## Open items for you
1. **OK to download the CC0 packs** (M0-08) once M0 starts.
2. ~~Approve the art direction & hero briefs~~: approved.
3. Later, before M3-08: decide whether to pay for a small always-on server (~$5/mo on Fly.io/Railway) so friends can play over the internet.
