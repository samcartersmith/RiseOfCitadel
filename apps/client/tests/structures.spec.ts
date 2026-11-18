import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

// M1 per-view budget from docs/plan/roadmap.md.
const BUDGET = { drawCalls: 150, triangles: 300_000 };

const citadel = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../packages/content/data/map/citadel.json', import.meta.url)),
    'utf8',
  ),
) as { structures: { faction: string; type: string }[] };

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 120_000 });
  await page.waitForFunction(
    () => window.__citadelStats !== undefined && !!window.__citadelStructures,
  );
}

/** CI renders with software GL at ~1 fps on High: wait for frames, never wall-clock time. */
async function waitFrames(page: Page, n: number) {
  const start = await page.evaluate(() => window.__citadelStructures!.frames());
  await page.waitForFunction((f) => window.__citadelStructures!.frames() >= f, start + n, {
    timeout: 150_000,
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

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('structure gallery shows every variant for both factions', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/structures.html?engine=webgl&mode=gallery&tier=low');
  await waitReady(page);
  const info = await page.evaluate(() => {
    const d = window.__citadelStructures!;
    return {
      expected: d.expected,
      placed: d.placed,
      variants: d.variants,
      materials: d.materialCount,
    };
  });
  // 9 kinds per faction (T1-T4, 2 barracks, ancient, fountain, base shop) + 2 neutral shops.
  expect(info.expected).toBe(20);
  expect(info.placed).toBe(20);
  const names = info.variants.map((v) => v.variant).sort();
  for (const side of ['wardens', 'hollow']) {
    for (const kind of [
      'tower_t1',
      'tower_t2',
      'tower_t3',
      'tower_t4',
      'barracks_melee',
      'barracks_ranged',
      'ancient',
      'fountain',
      'shop_base',
    ]) {
      expect(names).toContain(`${side}:${kind}`);
    }
  }
  expect(names).toContain('neutral:shop_side');
  expect(names).toContain('neutral:shop_secret');
  for (const v of info.variants) {
    // Art direction §2.3: a structure is ≤ 6k triangles, and LOD1 is cheaper.
    expect(v.trisLod0, v.variant).toBeLessThanOrEqual(6000);
    expect(v.trisLod1, v.variant).toBeLessThan(v.trisLod0);
  }
  // One body material per owner + one per glow colour, shared by every variant.
  expect(info.materials).toBeLessThanOrEqual(6);

  for (const view of ['overview', 'towers', 'core', 'neutral'] as const) {
    await page.evaluate((v) => window.__citadelStructures!.view(v), view);
    const stats = await freshStats(page);
    console.log(`[structures] gallery ${view}: ${stats.drawCalls} draws, ${stats.triangles} tris`);
    expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
    expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);
    await shot(page, testInfo, `structures-gallery-${view}`);
  }
  expect(errors).toEqual([]);
});

const TIERS = [
  { tier: 'low', timeout: 180_000 },
  { tier: 'high', timeout: 180_000 },
] as const;

for (const t of TIERS) {
  test(`whole map places every structure from citadel.json within budget (${t.tier})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(t.timeout);
    const errors = collectErrors(page);
    await page.goto(`/structures.html?engine=webgl&mode=map&tier=${t.tier}`);
    await waitReady(page);
    const info = await page.evaluate(() => {
      const d = window.__citadelStructures!;
      return { expected: d.expected, placed: d.placed, counts: d.counts, casters: d.casterCount };
    });
    expect(info.expected).toBe(citadel.structures.length);
    expect(info.placed).toBe(citadel.structures.length);
    const total = Object.values(info.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(citadel.structures.length);
    expect(info.counts['wardens:tower_t4']).toBe(2);
    expect(info.counts['hollow:ancient']).toBe(1);

    // The base is the densest view: Ancient, both T4s, a T3, barracks.
    for (const view of ['wardens_base', 'hollow_base'] as const) {
      await page.evaluate((v) => window.__citadelStructures!.view(v), view);
      const stats = await freshStats(page);
      const lod = await page.evaluate(() => window.__citadelStructures!.lodUsage());
      console.log(
        `[structures] map ${t.tier} ${view}: ${stats.drawCalls} draws, ${stats.triangles} tris, ` +
          `LOD0 ${lod.lod0} / LOD1 ${lod.lod1}, ${info.casters} casters`,
      );
      expect(stats.backend).toBe('webgl2');
      expect(stats.tier).toBe(t.tier);
      expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
      expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);
      expect(lod.lod0).toBeGreaterThan(0);
      await shot(page, testInfo, `structures-map-${t.tier}-${view}`);
    }
    if (t.tier === 'low') {
      await page.evaluate(() => window.__citadelStructures!.view('overview'));
      const stats = await freshStats(page);
      const lod = await page.evaluate(() => window.__citadelStructures!.lodUsage());
      console.log(`[structures] map overview: ${stats.drawCalls} draws, ${stats.triangles} tris`);
      // Zoomed out over the whole map, everything is on LOD1 and still inside budget.
      expect(lod.lod0).toBe(0);
      expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
      expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);
      await shot(page, testInfo, 'structures-map-overview');
    }
    expect(errors).toEqual([]);
  });
}
