import { expect, test, type Page, type TestInfo } from '@playwright/test';

// M1 per-view budget from docs/plan/roadmap.md.
const DRAW_CALL_BUDGET = 150;

async function open(page: Page, query = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/vfx.html?engine=webgl${query}`);
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 45_000 });
  return errors;
}

/** Waits until the render loop has drawn `n` more frames (CI renders at a few fps). */
async function waitFrames(page: Page, n: number) {
  const start = await page.evaluate(() => window.__citadelVfx!.frames());
  await page.waitForFunction((target) => window.__citadelVfx!.frames() >= target, start + n, {
    timeout: 30_000,
  });
}

const activeTotal = (page: Page) => page.evaluate(() => window.__citadelVfx!.stats().active.total);

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.describe('vfx sandbox', () => {
  test('fires every preset, telegraph and projectile, then pools them all', async ({
    page,
  }, testInfo) => {
    const errors = await open(page);
    const baseline = await activeTotal(page); // ambient river motes

    // Every particle preset, spread out so the screenshot shows each one.
    const afterPresets = await page.evaluate(() => {
      const v = window.__citadelVfx!;
      // Slow-mo so the CI screenshot (a few fps) still catches the short bursts.
      v.setTimeScale(0.2);
      v.presets.forEach((p, i) => v.play(p, -12 + i * 4, 3));
      return { particles: v.stats().active.particles, presets: v.presets.length };
    });
    // Trail and aura demos follow the runner; every preset is one rig.
    expect(afterPresets.particles).toBe(baseline + afterPresets.presets);
    await waitFrames(page, 2);
    await shot(page, testInfo, 'vfx-presets');
    await page.evaluate(() => window.__citadelVfx!.setTimeScale(1));

    // Every telegraph shape in every intent.
    await page.evaluate(() => {
      const v = window.__citadelVfx!;
      v.shapes.forEach((shape, i) =>
        v.intents.forEach((intent, j) => v.telegraph(shape, intent, -12 + i * 6, -8 + j * 3, 1)),
      );
    });
    const fired = await page.evaluate(() => {
      const v = window.__citadelVfx!;
      const before = v.stats().active.particles;
      v.projectile('straight');
      v.projectile('arc');
      v.projectile('homing');
      const s = v.stats();
      return { ...s, trails: s.active.particles - before };
    });
    const shapeCount = await page.evaluate(
      () => window.__citadelVfx!.shapes.length * window.__citadelVfx!.intents.length,
    );
    expect(fired.active.telegraphs).toBe(shapeCount);
    expect(fired.active.projectiles).toBe(3);
    expect(fired.trails).toBe(3); // one trail rig per projectile

    await waitFrames(page, 2);
    await shot(page, testInfo, 'vfx-telegraphs');

    // Effects finish on their own and go back to their pools.
    await page.waitForFunction(
      (base) => {
        const s = window.__citadelVfx!.stats();
        return s.active.total === base && s.active.projectiles === 0;
      },
      baseline,
      { timeout: 45_000 },
    );
    const after = await page.evaluate(() => window.__citadelVfx!.stats());
    expect(after.pooled.telegraphs).toBeGreaterThanOrEqual(shapeCount);
    expect(after.pooled.projectiles).toBeGreaterThanOrEqual(3);
    expect(after.pooled.particles).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('intent showcase reads on moss and ash', async ({ page }, testInfo) => {
    const errors = await open(page);
    const n = await page.evaluate(() => window.__citadelVfx!.showcase());
    expect(n).toBeGreaterThan(0);
    await waitFrames(page, 4);
    await shot(page, testInfo, 'vfx-intents');
    expect(errors).toEqual([]);
  });

  for (const particles of ['gpu', 'cpu'] as const) {
    test(`stress: 50 concurrent effects stay within budget (${particles} particles)`, async ({
      page,
    }, testInfo) => {
      const errors = await open(page, `&particles=${particles}`);
      const backend = await page.evaluate(() => window.__citadelVfx!.stats().backend);
      if (particles === 'cpu') expect(backend).toBe('cpu');
      const baseline = await activeTotal(page);

      await page.evaluate(() => {
        window.__citadelVfx!.setTimeScale(0.5);
        window.__citadelVfx!.resetPeak();
      });
      const spawned = await page.evaluate(() => window.__citadelVfx!.stress(50));
      expect(spawned).toBe(50);
      // Projectile trails add rigs on top of the 50 requested effects.
      expect(await activeTotal(page)).toBeGreaterThanOrEqual(baseline + 50);

      await waitFrames(page, 3);
      await shot(page, testInfo, `vfx-stress-${particles}`);
      const mid = await page.evaluate(() => ({
        stats: window.__citadelStats!,
        peak: window.__citadelVfx!.peakDrawCalls(),
        vfx: window.__citadelVfx!.stats(),
      }));
      console.log(
        `[vfx] ${particles} (${mid.vfx.backend}) mid-stress: ${mid.stats.drawCalls} draws, ` +
          `peak ${mid.peak}, ${mid.vfx.active.total} active, ${mid.vfx.particleSystems} systems`,
      );
      expect(mid.stats.vfxActive).toBeGreaterThan(0);

      await page.waitForFunction(
        (base) => window.__citadelVfx!.stats().active.total === base,
        baseline,
        {
          timeout: 60_000,
        },
      );
      const peak = await page.evaluate(() => window.__citadelVfx!.peakDrawCalls());
      console.log(`[vfx] ${particles} stress peak draw calls: ${peak}`);
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThanOrEqual(DRAW_CALL_BUDGET);

      const after = await page.evaluate(() => window.__citadelVfx!.stats());
      expect(after.pooled.total).toBeGreaterThanOrEqual(50);
      expect(errors).toEqual([]);
    });
  }
});
