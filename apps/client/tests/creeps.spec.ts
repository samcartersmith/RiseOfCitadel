import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { CREEP_TYPES, type CreepModelId } from '../src/units/creeps/creepTypes';

/** Roadmap M1 budget (docs/design/rendering.md). */
const BUDGET = { drawCalls: 150, triangles: 300_000 };

type CreepsHook = NonNullable<Window['__citadelCreeps']>;
/** Run `fn` in the page against the debug hook. `fn` must be self-contained (it is serialised). */
const creeps = <T>(page: Page, fn: (c: CreepsHook) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__citadelCreeps)`) as Promise<T>;

/** Wait until the page has rendered `n` more frames (CI renders at a few fps). */
async function frames(page: Page, n: number) {
  const start = await page.evaluate(() => window.__citadelCreeps!.frames());
  await page.waitForFunction((target) => window.__citadelCreeps!.frames() >= target, start + n, {
    timeout: 60_000,
  });
}

/** Wait for a fresh __citadelStats sample (published every 15 frames). */
async function freshStats(page: Page) {
  await page.evaluate(() => {
    window.__citadelStats = undefined;
  });
  await page.waitForFunction(() => window.__citadelStats !== undefined, null, { timeout: 60_000 });
  return page.evaluate(() => window.__citadelStats!);
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function open(page: Page, scene: string) {
  await page.goto(`/creeps.html?engine=webgl&scene=${scene}`);
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 120_000 });
  // Park the pointer mid-screen: headless can report (0,0), inside the camera's edge-pan band.
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height / 2);
}

/** Every creep type in view stays inside its own triangle budget. */
async function expectTypeBudgets(page: Page) {
  const types = await creeps(page, (c) => c.typeStats());
  for (const t of types) {
    expect(t.triangles, `${t.id} triangles per instance`).toBeLessThanOrEqual(
      CREEP_TYPES[t.id as CreepModelId].maxTriangles,
    );
  }
  return types;
}

/**
 * Drive one unit of every type through attack → (auto) idle → death, checking
 * the animation each one actually shows. Waits on state, never on time.
 */
async function cycleAnimations(page: Page) {
  await creeps(page, (c) => c.pause(true));
  const picks = await creeps(page, (c) => {
    const seen = new Set<string>();
    return c.ids().filter((id) => {
      const m = c.state(id)!.modelId;
      if (seen.has(m)) return false;
      seen.add(m);
      return true;
    });
  });
  const allShow = (state: string) =>
    page.waitForFunction(
      ([ids, s]) => ids.every((id) => window.__citadelCreeps!.shown(id) === s),
      [picks, state] as const,
      { timeout: 60_000 },
    );

  await page.evaluate(
    (ids) => ids.forEach((id) => window.__citadelCreeps!.play(id, 'attack1')),
    picks,
  );
  await allShow('attack1');
  // A finished attack falls back to idle by itself.
  await allShow('idle');
  await page.evaluate(
    (ids) => ids.forEach((id) => window.__citadelCreeps!.play(id, 'death')),
    picks,
  );
  await allShow('death');
  // Death holds its last frame: once settled, the frame stops changing.
  await page.waitForFunction(
    (ids) => {
      const c = window.__citadelCreeps!;
      const w = window as unknown as { __deathFrames?: string; __deathStable?: number };
      const now = JSON.stringify(ids.map((id) => c.frame(id)));
      w.__deathStable = now === w.__deathFrames ? (w.__deathStable ?? 0) + 1 : 0;
      w.__deathFrames = now;
      return w.__deathStable >= 10;
    },
    picks,
    { timeout: 60_000, polling: 'raf' },
  );
  return picks.length;
}

test('creeps: 40-creep lane wave inside the budget', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, 'wave');

  const counts = await creeps(page, (c) => c.counts());
  expect(counts.views).toBe(40);
  expect(counts.loaded).toBe(40);
  expect(counts.drawn).toBe(40);
  expect(counts.types).toBe(6);

  const stats = await freshStats(page);
  const types = await expectTypeBudgets(page);
  console.log(
    `[creeps] 40 lane creeps: drawCalls=${stats.drawCalls} triangles=${stats.triangles} ` +
      types.map((t) => `${t.id}=${t.triangles}x${t.instances}`).join(' '),
  );
  await testInfo.attach('stats-wave', {
    body: JSON.stringify({ stats, types }, null, 2),
    contentType: 'application/json',
  });
  expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);
  // One draw call per creep type: the whole wave costs only a handful.
  expect(stats.drawCalls).toBeLessThanOrEqual(types.length + 6);
  await shot(page, testInfo, 'creeps-wave');

  // Picking goes through the shared helper and finds the creep under its screen position.
  const id = (await creeps(page, (c) => c.ids()))[0]!;
  await creeps(page, (c) => c.pause(true));
  await frames(page, 2);
  const p = await page.evaluate((i) => window.__citadelCreeps!.screenPos(i), id);
  expect(p).not.toBeNull();
  expect(await page.evaluate((q) => window.__citadelCreeps!.pick(q.x, q.y), p!)).not.toBeNull();

  expect(errors).toEqual([]);
});

test('creeps: lane gallery animates idle, walk, attack and death', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, 'lane');
  expect((await creeps(page, (c) => c.counts())).types).toBe(6);
  await expectTypeBudgets(page);
  await shot(page, testInfo, 'creeps-lane');
  expect(await cycleAnimations(page)).toBe(6);
  expect(errors).toEqual([]);
});

test('creeps: neutrals and boss animate inside their budgets', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, 'neutral');
  expect((await creeps(page, (c) => c.counts())).types).toBe(5);
  const stats = await freshStats(page);
  expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);
  await expectTypeBudgets(page);
  await shot(page, testInfo, 'creeps-neutral');
  expect(await cycleAnimations(page)).toBe(5);
  expect(errors).toEqual([]);
});

test('creeps: camps around the boss pit', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, 'camps');
  const stats = await freshStats(page);
  expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);
  await shot(page, testInfo, 'creeps-camps');
  expect(errors).toEqual([]);
});
