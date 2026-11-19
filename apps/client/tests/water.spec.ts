import { readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

// M1 per-view budget from docs/plan/roadmap.md.
const BUDGET = { drawCalls: 150, triangles: 300_000 };

interface V2 {
  x: number;
  z: number;
}
const map = JSON.parse(
  readFileSync(new URL('../../../packages/content/data/map/citadel.json', import.meta.url), 'utf8'),
) as { river: { waypoints: V2[] } };

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__citadelStats !== undefined && !!window.__citadelWater);
}

/** CI renders with software GL at ~1 fps on High: wait for frames, never wall-clock time. */
async function waitFrames(page: Page, n: number) {
  const start = await page.evaluate(() => window.__citadelWater!.frames());
  await page.waitForFunction((f) => window.__citadelWater!.frames() >= f, start + n, {
    timeout: 120_000,
  });
}

/** Stats refresh every 15 frames; wait for a fresh sample. */
async function freshStats(page: Page) {
  await waitFrames(page, 16);
  return page.evaluate(() => window.__citadelStats!);
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, timeout: 60_000 });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

for (const tier of ['low', 'high'] as const) {
  test(`water (${tier}): river crossing, bend and long view within budget`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(tier === 'high' ? 300_000 : 180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/water.html?engine=webgl&tier=${tier}&hud=0`);
    await waitReady(page);

    // The terrain's placeholder ribbon is replaced, not drawn underneath.
    expect(await page.evaluate(() => window.__citadelWater!.placeholder)).toBe(false);

    for (const view of ['crossing', 'bend', 'long'] as const) {
      await page.evaluate((v) => window.__citadelWater!.view(v), view);
      const stats = await freshStats(page);
      console.log(
        `[water] ${tier} ${view}: ${stats.drawCalls} draws, ${stats.triangles} tris, ${stats.activeMeshes} meshes`,
      );
      expect(stats.backend).toBe('webgl2');
      expect(stats.tier).toBe(tier);
      expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
      expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);
      await shot(page, testInfo, `water-${tier}-${view}`);
    }

    await page.evaluate(() => window.__citadelWater!.view('top'));
    const top = await freshStats(page);
    console.log(`[water] ${tier} top: ${top.drawCalls} draws, ${top.triangles} tris`);
    expect(top.triangles).toBeLessThanOrEqual(BUDGET.triangles);
    await shot(page, testInfo, `water-${tier}-top`);

    const w = await page.evaluate(() => ({
      stats: window.__citadelWater!.stats,
      motes: window.__citadelWater!.motes(),
    }));
    console.log(
      `[water] ${w.stats.chunks} chunks, ${w.stats.triangles} tris, ${w.stats.vertices} verts, build ${w.stats.buildMs} ms, motes ${w.motes}/${w.stats.motes}`,
    );
    // The whole river is a few thousand quads: a small fraction of the budget even if all on screen.
    expect(w.stats.triangles).toBeLessThan(60_000);
    if (tier === 'low') expect(w.motes).toBe(0);
    else expect(w.motes).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

test('water follows the river data and the day/night hook', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/water.html?engine=webgl&tier=low&hud=0');
  await waitReady(page);

  // Water stands over the riverbed at every interior waypoint and flows downstream (south-east).
  const pts = map.river.waypoints.slice(1, -1);
  const samples = await page.evaluate(
    (ps) =>
      ps.map((p) => ({
        depth: window.__citadelWater!.depthAt(p.x, p.z),
        flow: window.__citadelWater!.flowAt(p.x, p.z),
      })),
    pts,
  );
  samples.forEach((s, i) => {
    const label = `waypoint (${pts[i]!.x}, ${pts[i]!.z})`;
    expect(s.depth, label).toBeGreaterThan(0.8);
    expect(s.flow.dx, label).toBeGreaterThan(0.5);
    expect(s.flow.dz, label).toBeLessThan(0.1);
    expect(s.flow.speed, label).toBeGreaterThan(0.5);
  });
  // Dry land on the lanes' high ground is not water.
  expect(await page.evaluate(() => window.__citadelWater!.depthAt(-6000, -6000))).toBeLessThan(0);
  expect(await page.evaluate(() => window.__citadelWater!.flowAt(-6000, -6000).speed)).toBe(0);

  // Night: the lighting hook recolours without recompiling or erroring; tier switch adds motes.
  await page.evaluate(() => {
    window.__citadelWater!.setDaylight(0.1);
    window.__citadelWater!.setTier('medium');
  });
  const stats = await freshStats(page);
  expect(stats.tier).toBe('medium');
  expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  await page.waitForFunction(() => window.__citadelWater!.motes() > 0, null, { timeout: 60_000 });
  await shot(page, testInfo, 'water-medium-night-crossing');
  expect(errors).toEqual([]);
});
