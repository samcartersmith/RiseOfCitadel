import { expect, test } from '@playwright/test';

// Stats budget for the M0 boot scene. M1-01 replaces these with the real
// per-view budget from docs/plan/roadmap.md.
const BUDGET = { drawCalls: 150, triangles: 300_000 };

test('boot scene renders within budget', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?engine=webgl');
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__citadelStats !== undefined);

  const stats = await page.evaluate(() => window.__citadelStats!);
  expect(stats.backend).toBe('webgl2');
  expect(stats.activeMeshes).toBeGreaterThan(0);
  expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(stats.activeIndices / 3).toBeLessThanOrEqual(BUDGET.triangles);
  expect(errors).toEqual([]);

  await page.screenshot({ path: testInfo.outputPath('boot.png') });
  await testInfo.attach('boot', {
    path: testInfo.outputPath('boot.png'),
    contentType: 'image/png',
  });
});
