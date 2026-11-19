import { expect, test, type Page, type TestInfo } from '@playwright/test';

// M1 per-view budget from docs/plan/roadmap.md.
const BUDGET = { drawCalls: 150, triangles: 300_000 };
const PHASES = ['dawn', 'noon', 'dusk', 'midnight'] as const;

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 150_000 });
  await page.waitForFunction(
    () => window.__citadelStats !== undefined && !!window.__citadelLightingDebug,
  );
  // The HDR environment loads lazily after the first ready; counters settle once it's in.
  await page.waitForFunction(() => window.__citadelLightingDebug!.env().ready, null, {
    timeout: 120_000,
  });
}

/** CI renders with software GL at ~1 fps on High: wait for frames, never wall-clock time. */
async function waitFrames(page: Page, n: number) {
  const start = await page.evaluate(() => window.__citadelLightingDebug!.frames());
  await page.waitForFunction((f) => window.__citadelLightingDebug!.frames() >= f, start + n, {
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

const counters = (page: Page) =>
  page.evaluate(() => {
    const d = window.__citadelLightingDebug!;
    return { effects: d.effectCount(), materials: d.materialCount(), shadow: d.shadowIds() };
  });

for (const tier of ['low', 'high'] as const) {
  test(`lighting (${tier}): dawn/noon/dusk/midnight within budget, no recompiles while scrubbing`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(tier === 'high' ? 360_000 : 180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/lighting.html?engine=webgl&tier=${tier}&hud=0&view=mid`);
    await waitReady(page);
    await waitFrames(page, 4);

    const env = await page.evaluate(() => window.__citadelLightingDebug!.env());
    console.log(`[lighting] env: hdr ${env.bytes} B, clouds ${env.cloudsBytes} B`);
    expect(env.bytes).toBeGreaterThan(0);
    expect(env.bytes).toBeLessThan(64 * 1024);

    const before = await counters(page);
    if (tier === 'high') expect(before.shadow).not.toBeNull();

    for (const phase of PHASES) {
      await page.evaluate((p) => window.__citadelLightingDebug!.setPhase(p), phase);
      const stats = await freshStats(page);
      const pal = await page.evaluate(() => window.__citadelLightingDebug!.palette());
      console.log(
        `[lighting] ${tier} ${phase}: ${stats.drawCalls} draws, ${stats.triangles} tris, ` +
          `sun el ${pal.sunElevation.toFixed(0)}° × ${pal.sunIntensity.toFixed(2)}, emissive ×${pal.emissive.toFixed(2)}`,
      );
      expect(stats.backend).toBe('webgl2');
      expect(stats.tier).toBe(tier);
      expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
      expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);
      await shot(page, testInfo, `lighting-${tier}-${phase}`);
    }

    // Scrub through the whole cycle: only uniforms change, so nothing compiles,
    // no material appears and the shadow generator/map are the same objects.
    const steps = tier === 'high' ? 8 : 24;
    for (let i = 0; i <= steps; i++) {
      await page.evaluate((t) => window.__citadelLightingDebug!.setT(t), i / steps);
      await waitFrames(page, 2);
    }
    const after = await counters(page);
    console.log(`[lighting] ${tier} counters before/after scrub`, before, after);
    expect(after).toEqual(before);
    expect(errors).toEqual([]);
  });
}

test('lighting (low): factions at noon, night emitters, setT/getT hook', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/lighting.html?engine=webgl&tier=low&hud=0&view=wardens');
  await waitReady(page);

  // The public hook every page gets from the rig.
  await page.evaluate(() => window.__citadelLighting!.setT(0.25));
  expect(await page.evaluate(() => window.__citadelLighting!.getT())).toBeCloseTo(0.25, 6);

  for (const view of ['wardens', 'hollow'] as const) {
    await page.evaluate((v) => window.__citadelLightingDebug!.view(v), view);
    const stats = await freshStats(page);
    console.log(`[lighting] low noon ${view}: ${stats.drawCalls} draws, ${stats.triangles} tris`);
    expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
    expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);
    await shot(page, testInfo, `lighting-low-noon-${view}`);
  }

  // Structure glows are picked up by name and brighten at night.
  const noon = await page.evaluate(() => window.__citadelLightingDebug!.emitters());
  expect(noon.map((e) => e.name).sort()).toEqual(
    expect.arrayContaining(['structure:glow:gold', 'structure:glow:violet']),
  );
  await page.evaluate(() => window.__citadelLightingDebug!.setPhase('midnight'));
  const night = await page.evaluate(() => window.__citadelLightingDebug!.emitters());
  for (const e of night)
    expect(e.scale).toBeGreaterThan(noon.find((n) => n.name === e.name)!.scale);
  await waitFrames(page, 2);
  await shot(page, testInfo, 'lighting-low-midnight-hollow');

  // Auto-cycle advances t on its own.
  const t0 = await page.evaluate(() => window.__citadelLighting!.getT());
  await page.evaluate(() => window.__citadelLightingDebug!.setCycle(10));
  await waitFrames(page, 10);
  await page.evaluate(() => window.__citadelLightingDebug!.setCycle(0));
  expect(await page.evaluate(() => window.__citadelLighting!.getT())).not.toBeCloseTo(t0, 4);
  expect(errors).toEqual([]);
});
