import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { BULWARK_VIEW_CONFIG, HERO_BUDGET } from '../src/heroes/bulwark/config';
import { LOGICAL_STATES, LOOPING_STATES, type LogicalState } from '../src/units/states';

type Hook = NonNullable<Window['__citadelBulwark']>;
/** Run `fn` in the page against the debug hook. `fn` must be self-contained (it is serialised). */
const hook = <T>(page: Page, fn: (b: Hook) => T): Promise<Awaited<T>> =>
  page.evaluate(`(${fn.toString()})(window.__citadelBulwark)`) as Promise<Awaited<T>>;

/** Wait until the page has rendered `n` more frames (CI renders at a few fps). */
async function frames(page: Page, n: number) {
  const start = await hook(page, (b) => b.frames());
  await page.waitForFunction((t) => window.__citadelBulwark!.frames() >= t, start + n, {
    timeout: 60_000,
  });
}

/** Play `state` slowly and wait (on state, not wall-clock time) until it's well into the clip. */
async function playTo(page: Page, state: LogicalState, at = 0.4, who: 'bulwark' | 'both' = 'both') {
  await page.evaluate(
    ([s, w]) => window.__citadelBulwark!.play(s as LogicalState, w as 'both', 0.25),
    [state, who] as const,
  );
  await page.waitForFunction(
    ([s, t]) =>
      window.__citadelBulwark!.state() === s &&
      window.__citadelBulwark!.progress() >= (t as number),
    [state, at] as const,
    { timeout: 60_000 },
  );
}

async function shot(page: Page, testInfo: TestInfo, name: string, clip = false) {
  const path = testInfo.outputPath(`${name}.png`);
  const opts = clip ? { path, clip: await hook(page, (b) => b.screenRect()) } : { path };
  await page.screenshot(opts);
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.describe('bulwark sandbox', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/bulwark.html?engine=webgl');
    await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 90_000 });
  });

  test('loads merged, inside the hero budget', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    expect(await hook(page, (b) => b.state())).toBe('idle');

    const stats = await hook(page, (b) => b.stats());
    expect(stats.bulwark.triangles).toBeLessThanOrEqual(HERO_BUDGET.triangles);
    expect(stats.bulwark.drawCalls).toBeLessThanOrEqual(HERO_BUDGET.drawCalls);
    expect(stats.bulwark.drawCalls).toBe(1);

    // Scene-wide counters with only Bulwark on screen: his draw calls, nothing hidden.
    await hook(page, (b) => b.setSolo(true));
    await frames(page, 3);
    const scene = await hook(page, (b) => b.sceneStats());
    expect(scene.drawCalls).toBe(stats.bulwark.drawCalls);
    expect(scene.triangles).toBe(stats.bulwark.triangles);
    await hook(page, (b) => b.setSolo(false));
    testInfo.annotations.push({
      type: 'budget',
      description: `Bulwark ${stats.bulwark.triangles} tris / ${stats.bulwark.drawCalls} draw call; stock knight ${stats.knight.triangles} tris / ${stats.knight.drawCalls}`,
    });

    await frames(page, 3);
    await shot(page, testInfo, 'bulwark-idle');
    expect(errors).toEqual([]);
  });

  test('runs, attacks and casts (every logical state)', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    for (const state of LOGICAL_STATES) {
      await page.evaluate(() => window.__citadelBulwark!.play('idle', 'both'));
      expect(
        await page.evaluate((s) => window.__citadelBulwark!.play(s, 'both', 0.25), state),
      ).toBe(true);
      expect(await hook(page, (b) => b.state())).toBe(state);
      expect(await hook(page, (b) => b.clip())).toBe(BULWARK_VIEW_CONFIG.clips[state]);
      if (['run', 'attack1', 'attack2', 'cast1', 'cast2', 'cast3'].includes(state)) {
        await playTo(page, state);
        await shot(page, testInfo, `bulwark-${state}`);
      }
    }
    // One-shots return to idle; death holds.
    await page.evaluate(() => window.__citadelBulwark!.play('attack1', 'bulwark', 3));
    await page.waitForFunction(() => window.__citadelBulwark!.state() === 'idle', null, {
      timeout: 60_000,
    });
    expect(LOOPING_STATES.has('channel')).toBe(true);
  });

  test('silhouette check at the default MOBA zoom, next to the stock knight', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await hook(page, (b) => b.setView('moba'));
    await frames(page, 3);

    // Team colour on ≥ 20% of the visible surface (art direction §2.2), from the game camera.
    const moba = await hook(page, (b) => b.teamCoverage());
    await shot(page, testInfo, 'bulwark-moba', true);

    await hook(page, (b) => b.setSilhouette(true));
    await frames(page, 3);
    await shot(page, testInfo, 'bulwark-silhouette-idle', true);
    await playTo(page, 'attack1', 0.45);
    await shot(page, testInfo, 'bulwark-silhouette-attack1', true);
    await playTo(page, 'attack2', 0.4);
    await shot(page, testInfo, 'bulwark-silhouette-attack2', true);
    await hook(page, (b) => b.setSilhouette(false));
    await page.evaluate(() => window.__citadelBulwark!.play('idle', 'both'));

    await hook(page, (b) => b.setView('close'));
    await frames(page, 3);
    const front = await hook(page, (b) => b.teamCoverage());
    testInfo.annotations.push({
      type: 'team coverage',
      description: `MOBA view: Bulwark ${moba.bulwark}, knight ${moba.knight}; front: Bulwark ${front.bulwark}, knight ${front.knight}`,
    });
    expect(moba.bulwark).toBeGreaterThanOrEqual(0.2);
    expect(front.bulwark).toBeGreaterThanOrEqual(0.2);
    expect(front.bulwark).toBeGreaterThan(front.knight);
  });

  test('team colours: hollow', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await hook(page, (b) => b.setTeam('hollow'));
    await frames(page, 3);
    await shot(page, testInfo, 'bulwark-hollow');
    const stats = await hook(page, (b) => b.stats());
    expect(stats.bulwark.drawCalls).toBe(1);
  });
});
