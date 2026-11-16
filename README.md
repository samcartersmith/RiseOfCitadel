# Rise of Citadel

An original 5v5 browser MOBA: three lanes, towers, creeps, last hits, and a growing roster of heroes. Built with **TypeScript + Babylon.js** and a central authoritative server.

- Plan: [`docs/plan/roadmap.md`](docs/plan/roadmap.md)
- Art direction & hero briefs: [`docs/design/art-direction.md`](docs/design/art-direction.md)
- Genre mechanics research: [`docs/research/dota-allstars-reference.md`](docs/research/dota-allstars-reference.md)

## Quick start

Requires Node 20+ (see `.nvmrc`). pnpm comes through Corepack.

```bash
corepack enable
pnpm install
pnpm dev:all        # client on http://localhost:5173 + server on ws://localhost:7777
```

| Command                        | What it does                                                            |
| ------------------------------ | ----------------------------------------------------------------------- |
| `pnpm dev`                     | Client only (Vite)                                                      |
| `pnpm dev:server`              | Game server only                                                        |
| `pnpm test`                    | Unit tests (sim, protocol, content, server)                             |
| `pnpm test:e2e`                | Headless browser smoke test + screenshots                               |
| `pnpm typecheck` / `pnpm lint` | Static checks                                                           |
| `pnpm validate:content`        | Validate hero/item/map data                                             |
| `pnpm assets:fetch`            | Download CC0 source packs into `assets-src/*/raw`                       |
| `pnpm assets:build`            | Convert source packs into compressed GLB in `apps/client/public/assets` |

URL flags for the client: `?engine=webgl` forces the WebGL2 fallback. `?server=ws://host:port` connects to a game server (dev builds connect to localhost automatically).

## Layout

```
apps/client      Vite + Babylon.js game client (deployed to Vercel)
apps/server      Node authoritative game server (runs locally for now)
packages/sim     Pure TypeScript game rules shared by client and server
packages/protocol Client/server wire protocol
packages/content Hero/item/map data + schemas
tools/assets     CC0 asset fetch + build pipeline
assets-src       Per-pack manifests and licenses (raw downloads are git-ignored)
docs             Research, roadmap, design docs
```

## Art credits

All third-party art is CC0. See [`CREDITS.md`](CREDITS.md).
