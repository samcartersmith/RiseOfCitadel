import { expect, test, type Page, type TestInfo } from '@playwright/test';

// M1 per-view budget from docs/plan/roadmap.md.
const BUDGET = { drawCalls: 150, triangles: 300_000 };

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 150_000 });
  await page.waitForFunction(
    () => window.__citadelStats !== undefined && !!window.__citadelFoliage,
  );
}

/** CI renders with software GL at ~1 fps on High: wait for frames, never wall-clock time. */
async function waitFrames(page: Page, n: number) {
  const start = await page.evaluate(() => window.__citadelFoliage!.frames());
  await page.waitForFunction((f) => window.__citadelFoliage!.frames() >= f, start + n, {
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

type View = 'lane' | 'jungle' | 'hollow' | 'biomes' | 'top';

async function checkView(page: Page, testInfo: TestInfo, tier: string, view: View) {
  await page.evaluate((v) => window.__citadelFoliage!.view(v), view);
  const stats = await freshStats(page);
  console.log(
    `[foliage] ${tier} ${view}: ${stats.drawCalls} draws, ${stats.triangles} tris, ${stats.activeMeshes} meshes`,
  );
  expect(stats.backend).toBe('webgl2');
  expect(stats.tier).toBe(tier);
  if (view !== 'top') expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);
  await shot(page, testInfo, `foliage-${tier}-${view}`);
  return stats;
}

for (const tier of ['low', 'high'] as const) {
  test(`foliage (${tier}): 1500+ trees, dense jungle views within budget`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/foliage.html?engine=webgl&tier=${tier}&hud=0&view=jungle`);
    await waitReady(page);

    const census = await page.evaluate(() => ({
      count: window.__citadelFoliage!.treeCount,
      ...window.__citadelFoliage!.census(),
    }));
    console.log(`[foliage] ${census.count} trees`, JSON.stringify(census.species));
    expect(census.count).toBeGreaterThanOrEqual(1500);
    expect(census.biome[0]).toBeGreaterThan(600);
    expect(census.biome[1]).toBeGreaterThan(600);
    expect(Object.keys(census.species).length).toBeGreaterThanOrEqual(6);

    // The densest MOBA views on the map (one per biome).
    await checkView(page, testInfo, tier, 'jungle');
    await checkView(page, testInfo, tier, 'hollow');
    // Whole map at once (every cell far LOD); only triangles are asserted. Low only: it is
    // the same picture on High minus shadows, and High frames are slow on CI's software GL.
    if (tier === 'low') await checkView(page, testInfo, tier, 'top');

    const f = await page.evaluate(() => window.__citadelFoliage!.stats());
    console.log(
      `[foliage] ${tier}: ${f.cells} cells, ${f.groups} groups, grass cells ${f.grassCells} (${f.grassTufts} tufts), models ${f.downloadBytes} B, load ${f.loadMs} ms, scatter ${f.scatterMs} ms`,
    );
    for (const s of f.species) {
      console.log(`[foliage]   ${s.id}: ${s.count} trees, ${s.nearTris} / ${s.farTris} tris`);
    }
    // Grass is a High-only feature.
    if (tier === 'high') expect(f.grassTufts).toBeGreaterThan(0);
    else expect(f.grassTufts).toBe(0);
    expect(f.downloadBytes).toBeLessThan(200 * 1024);
    expect(errors).toEqual([]);
  });
}

// One view per test: CI renders High at about 1 fps in software GL.
for (const view of ['lane', 'biomes'] as const) {
  test(`foliage (high): ${view} view`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/foliage.html?engine=webgl&tier=high&hud=0&view=${view}`);
    await waitReady(page);
    await checkView(page, testInfo, 'high', view);
    expect(errors).toEqual([]);
  });
}

test('foliage: setTreeVisible hides and shows trees without extra draw calls', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/foliage.html?engine=webgl&tier=low&hud=0&view=jungle');
  await waitReady(page);

  const before = await freshStats(page);
  expect(await page.evaluate(() => window.__citadelFoliage!.hiddenCount())).toBe(0);

  const ids = await page.evaluate(() => window.__citadelFoliage!.chop(40));
  expect(ids).toHaveLength(40);
  expect(new Set(ids).size).toBe(40);
  const state = await page.evaluate(
    (list) => ({
      hidden: window.__citadelFoliage!.hiddenCount(),
      visible: list.map((id) => window.__citadelFoliage!.isTreeVisible(id)),
    }),
    ids,
  );
  expect(state.hidden).toBe(40);
  expect(state.visible.every((v) => !v)).toBe(true);

  const after = await freshStats(page);
  console.log(
    `[foliage] chop 40: draws ${before.drawCalls} -> ${after.drawCalls}, tris ${before.triangles} -> ${after.triangles}`,
  );
  // Same buffers, same meshes: hiding never adds draw calls or meshes.
  expect(after.drawCalls).toBeLessThanOrEqual(before.drawCalls);
  expect(after.activeMeshes).toBeLessThanOrEqual(before.activeMeshes);
  await shot(page, testInfo, 'foliage-low-jungle-chopped');

  // Idempotent, and reversible by ID.
  await page.evaluate((id) => window.__citadelFoliage!.setTreeVisible(id, false), ids[0]!);
  expect(await page.evaluate(() => window.__citadelFoliage!.hiddenCount())).toBe(40);
  await page.evaluate(() => window.__citadelFoliage!.regrow());
  expect(await page.evaluate(() => window.__citadelFoliage!.hiddenCount())).toBe(0);
  const regrown = await freshStats(page);
  expect(regrown.drawCalls).toBe(before.drawCalls);
  expect(regrown.triangles).toBe(before.triangles);

  // Unknown IDs are rejected.
  const bad = await page.evaluate(() => {
    try {
      window.__citadelFoliage!.setTreeVisible(1e9, false);
      return 'accepted';
    } catch (e) {
      return (e as Error).name;
    }
  });
  expect(bad).toBe('RangeError');
  expect(errors).toEqual([]);
});
