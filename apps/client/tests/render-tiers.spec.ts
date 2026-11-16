import { expect, test, type Page } from '@playwright/test';

// M1 per-view budget from docs/plan/roadmap.md.
const BUDGET = { drawCalls: 150, triangles: 300_000 };
const TIERS = ['high', 'medium', 'low'] as const;

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__citadelStats !== undefined);
}

for (const tier of TIERS) {
  test(`tier ${tier} renders within budget`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`/?engine=webgl&tier=${tier}`);
    await waitReady(page);

    const stats = await page.evaluate(() => window.__citadelStats!);
    console.log(`[render-tiers] ${tier}: ${stats.drawCalls} draws, ${stats.triangles} tris`);
    expect(stats.backend).toBe('webgl2');
    expect(stats.tier).toBe(tier);
    expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
    expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);
    expect(errors).toEqual([]);

    const file = testInfo.outputPath(`tier-${tier}.png`);
    await page.screenshot({ path: file });
    await testInfo.attach(`tier-${tier}`, { path: file, contentType: 'image/png' });
  });
}

test('tier switches at runtime and changes counters', async ({ page }) => {
  await page.goto('/?engine=webgl&tier=low');
  await waitReady(page);
  const low = await page.evaluate(() => window.__citadelStats!);

  await page.evaluate(() => window.__citadelSetTier!('high'));
  await page.waitForFunction(() => window.__citadelStats?.tier === 'high');
  // Let the stats refresh with a few full high-tier frames (shadow pass included).
  await page.waitForTimeout(500);
  const high = await page.evaluate(() => window.__citadelStats!);

  expect(high.tier).toBe('high');
  // The cascaded shadow pass re-draws the casters, so High costs more draws.
  expect(high.drawCalls).toBeGreaterThan(low.drawCalls);
  expect(high.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
});

test('backtick toggles the perf HUD', async ({ page }) => {
  await page.goto('/?engine=webgl');
  await waitReady(page);
  const overlay = page.locator('#overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('tier');
  await page.keyboard.press('Backquote');
  await expect(overlay).toBeHidden();
  await page.keyboard.press('Backquote');
  await expect(overlay).toBeVisible();
});
