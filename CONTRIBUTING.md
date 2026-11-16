# Contributing

Work is planned as small PRs in [`docs/plan/roadmap.md`](docs/plan/roadmap.md). Each PR has an ID (`M1-05`), dependencies, a list of **folders it may touch**, and a **done-when** check.

## PR rules

1. **One roadmap item per PR.** Title it `M1-05: Terrain`. Branch name `m1-05-terrain`.
2. **Stay inside your folders.** If you need to change a folder another PR owns, split that change into its own small PR first.
3. **Single-writer folders:** `packages/sim/src/abilities/effects` and `packages/protocol` take only one open PR at a time.
4. **Green CI is required:** typecheck, lint, unit tests, content validation, client build, browser smoke test.
5. **Visual PRs** attach the Playwright screenshots from CI. Look and feel is approved by a human.
6. **Sim purity:** `packages/sim` never imports Babylon, the DOM, Node APIs, timers, `Math.random` or `Date.now`. ESLint enforces it.
7. **Gameplay rules live in `packages/sim`,** never in `apps/client`.
8. **Assets:** CC0 only, downloaded from the creator's own page or repo, recorded in `assets-src/<pack>/manifest.json` with its license. Never commit raw packs. Commit processed output only.
9. **Originality:** heroes, names, abilities and art are our own. The research doc is for mechanics only.
10. Update the relevant doc in `docs/` in the same PR.
