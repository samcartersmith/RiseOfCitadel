import { expect, test, type Page, type TestInfo } from '@playwright/test';

// M1 per-view budget from docs/plan/roadmap.md.
const BUDGET = { drawCalls: 150, triangles: 300_000 };

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__citadelStats !== undefined && !!window.__citadelToon);
}

/** CI renders with software GL at a few fps: wait for frames, never for wall-clock time. */
async function waitFrames(page: Page, n: number) {
  const start = await page.evaluate(() => window.__citadelToon!.frames());
  await page.waitForFunction((f) => window.__citadelToon!.frames() >= f, start + n, {
    timeout: 30_000,
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

const PAGES = [
  { name: 'default', url: '/toon.html?engine=webgl', tier: null },
  { name: 'high', url: '/toon.html?engine=webgl&tier=high', tier: 'high' },
] as const;

for (const p of PAGES) {
  test(`toon sandbox (${p.name}) restyles the models within budget`, async ({ page }, testInfo) => {
    // High tier (shadows + post) renders at ~1 fps under CI's software GL.
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(p.url);
    await waitReady(page);

    const toon = await page.evaluate(() => {
      const t = window.__citadelToon!;
      return {
        rows: t.rows.map((r) => [r, t.toonFraction(r)] as const),
        materials: t.materialCount(),
        thin: t.thinInstances,
        casters: t.casterCount,
        shadows: t.shadowsReceived(),
      };
    });
    // Originals untouched; both team rows fully restyled.
    expect(Object.fromEntries(toon.rows)).toEqual({ original: 0, warden: 1, hollow: 1 });
    // Shared materials: one per source material per team (knight, rogue, mage, and the
    // skeleton's two) × 2 teams, plus the ground and markers. Not one per mesh (72).
    expect(toon.materials).toBe(12);
    expect(toon.thin).toBe(8);

    const stats = await freshStats(page);
    console.log(
      `[toon] ${p.name}: tier ${stats.tier}, ${stats.drawCalls} draws, ${stats.triangles} tris, ${toon.casters} casters`,
    );
    expect(stats.backend).toBe('webgl2');
    if (p.tier) expect(stats.tier).toBe(p.tier);
    // Shadows are on exactly when the tier enables them; the material renders either way.
    expect(toon.shadows).toBe(stats.tier === 'high');
    expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
    expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);

    await shot(page, testInfo, `toon-${p.name}-close`);
    await page.evaluate(() => window.__citadelToon!.view('moba'));
    await waitFrames(page, 3);
    await shot(page, testInfo, `toon-${p.name}-moba`);
    expect(errors).toEqual([]);
  });
}

test('toon sliders retune every material live', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/toon.html?engine=webgl');
  await waitReady(page);

  const before = await page.evaluate(() => window.__citadelToon!.materialCount());
  // Drive the real slider for one param, the debug hook for the rest.
  await page.locator('input[data-param="paletteStrength"]').evaluate((el: HTMLInputElement) => {
    el.value = '1';
    el.dispatchEvent(new Event('input'));
  });
  await page.evaluate(() => {
    const t = window.__citadelToon!;
    t.setParam('rimIntensity', 1.6);
    t.setParam('teamStrength', 0.5);
    t.setBands(2);
    t.setFog(true);
  });
  await waitFrames(page, 3);
  const params = await page.evaluate(() => window.__citadelToon!.params());
  expect(params.paletteStrength).toBe(1);
  expect(params.rimIntensity).toBe(1.6);
  expect(params.teamStrength).toBe(0.5);
  expect(params.bands).toBe(2);
  // Uniform-only changes: no new materials.
  expect(await page.evaluate(() => window.__citadelToon!.materialCount())).toBe(before);
  await shot(page, testInfo, 'toon-retuned');
  expect(errors).toEqual([]);
});
