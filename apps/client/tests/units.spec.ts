import { expect, test, type Page, type TestInfo } from '@playwright/test';

/** Roadmap M1 budget (docs/design/rendering.md). */
const BUDGET = { drawCalls: 150, triangles: 300_000 };
const UNITS = 50;

type UnitsHook = NonNullable<Window['__citadelUnits']>;
/** Run `fn` in the page against the debug hook. `fn` must be self-contained (it is serialised). */
const units = <T>(page: Page, fn: (u: UnitsHook) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__citadelUnits)`) as Promise<T>;

/** Wait until the page has rendered `n` more frames (CI renders at a few fps). */
async function frames(page: Page, n: number) {
  const start = await page.evaluate(() => window.__citadelUnits!.frames());
  await page.waitForFunction((target) => window.__citadelUnits!.frames() >= target, start + n, {
    timeout: 30_000,
  });
}

/** Wait for a fresh __citadelStats sample (published every 15 frames). */
async function freshStats(page: Page) {
  await page.evaluate(() => {
    window.__citadelStats = undefined;
  });
  await page.waitForFunction(() => window.__citadelStats !== undefined, null, { timeout: 30_000 });
  return page.evaluate(() => window.__citadelStats!);
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('unit views: 50 units inside budget, bars, selection, damage', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/units.html?engine=webgl');
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 90_000 });
  // Park the pointer mid-screen: headless can report (0,0), inside the camera's edge-pan band.
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height / 2);

  const counts = await units(page, (u) => u.counts());
  expect(counts.views).toBe(UNITS);
  expect(counts.loaded).toBe(UNITS);

  // Everyone alive and frozen so every unit shows a bar and nothing moves under the asserts.
  await units(page, (u) => {
    u.reviveAll();
    u.pause(true);
    u.hover(null); // whatever sits under the parked pointer must not add a hover ring
  });
  await frames(page, 2);
  const ids = await units(page, (u) => u.ids());
  expect(ids).toHaveLength(UNITS);
  const bars = await page.evaluate((all) => all.map((id) => window.__citadelUnits!.bar(id)), ids);
  expect(bars.every((b) => b !== null && b.hp > 0.99)).toBe(true);
  expect((await units(page, (u) => u.counts())).bars).toBe(UNITS);

  // Budget, from the engine counters.
  const stats = await freshStats(page);
  console.log(
    `[units] ${UNITS} units: drawCalls=${stats.drawCalls} triangles=${stats.triangles} activeMeshes=${stats.activeMeshes}`,
  );
  await testInfo.attach('stats-50', {
    body: JSON.stringify(stats, null, 2),
    contentType: 'application/json',
  });
  expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);
  await shot(page, testInfo, 'units-50-default');

  // Selecting through the hook shows the selection ring (and nothing else is ringed).
  const hero = await units(page, (u) => u.ids().find((id) => u.state(id)!.isHero)!);
  await page.evaluate((id) => window.__citadelUnits!.select(id), hero);
  await page.waitForFunction((id) => window.__citadelUnits!.rings(id).includes('selected'), hero, {
    timeout: 30_000,
  });
  expect((await units(page, (u) => u.counts())).rings).toBe(1);

  // Damage through the hook: the uploaded bar fill drops and a trail segment appears.
  const before = (await page.evaluate((id) => window.__citadelUnits!.bar(id), hero))!;
  const maxHp = (await page.evaluate((id) => window.__citadelUnits!.state(id)!.maxHp, hero))!;
  await page.evaluate(({ id, dmg }) => window.__citadelUnits!.damage(id, dmg), {
    id: hero,
    dmg: maxHp * 0.4,
  });
  await page.waitForFunction(
    ([id, hp]) => (window.__citadelUnits!.bar(id)?.hp ?? 1) < hp - 0.3,
    [hero, before.hp] as const,
    { timeout: 30_000 },
  );
  const after = (await page.evaluate((id) => window.__citadelUnits!.bar(id), hero))!;
  expect(after.hp).toBeCloseTo(before.hp - 0.4, 2);
  expect(after.trail).toBeGreaterThan(after.hp);

  // Zoom in on the selected, damaged hero for a readability screenshot.
  await page.evaluate((id) => {
    const s = window.__citadelUnits!.state(id)!;
    window.__citadelCamera!.focusOn(s.position, { instant: true });
  }, hero);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -300);
  await page.waitForFunction(() => {
    const c = window.__citadelCamera!.getState();
    return Math.abs(c.distance - c.minDistance) < 0.5;
  });
  await frames(page, 2);
  await shot(page, testInfo, 'units-selected-zoomed');

  // A real click selects whatever the screen-space picker says is under the cursor.
  const pos = (await page.evaluate((id) => window.__citadelUnits!.screenPos(id), hero))!;
  const expected = await page.evaluate(([x, y]) => window.__citadelUnits!.pick(x, y), [
    pos.x,
    pos.y,
  ] as const);
  expect(expected).not.toBeNull();
  await page.evaluate(() => window.__citadelUnits!.select(null));
  await page.mouse.click(pos.x, pos.y);
  await page.waitForFunction((id) => window.__citadelUnits!.state(id!)!.selected, expected, {
    timeout: 30_000,
  });
  await page.mouse.move(vp.width / 2, vp.height / 2);

  expect(errors).toEqual([]);
});

test('unit views: 100 units (measured, budget not asserted)', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/units.html?engine=webgl&n=100');
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 120_000 });
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await units(page, (u) => {
    u.reviveAll();
    u.pause(true);
  });
  await frames(page, 2);
  expect((await units(page, (u) => u.counts())).bars).toBe(100);
  const stats = await freshStats(page);
  console.log(`[units] 100 units: drawCalls=${stats.drawCalls} triangles=${stats.triangles}`);
  await testInfo.attach('stats-100', {
    body: JSON.stringify(stats, null, 2),
    contentType: 'application/json',
  });
  await shot(page, testInfo, 'units-100-default');
  expect(errors).toEqual([]);
});

test('unit views: registered custom model (Bulwark) gets a bar, a ring and its look', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/units.html?engine=webgl&n=32');
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 120_000 });
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await units(page, (u) => {
    u.reviveAll();
    u.pause(true);
  });
  const ids = await units(page, (u) => u.ids().filter((id) => u.state(id)!.modelId === 'bulwark'));
  expect(ids.length).toBeGreaterThan(0);
  const id = ids[0]!;
  await page.evaluate((x) => window.__citadelUnits!.select(x), id);
  await page.waitForFunction((x) => window.__citadelUnits!.rings(x).includes('selected'), id, {
    timeout: 60_000,
  });
  const bar = await page.evaluate((x) => window.__citadelUnits!.bar(x), id);
  expect(bar).not.toBeNull();
  expect(bar!.mana).toBeGreaterThanOrEqual(0); // hero bar with a mana row
  // UnitView used Bulwark's own loader (merged to one mesh) and look (toon material).
  const meshes = await page.evaluate((x) => window.__citadelUnits!.unitMeshes(x), id);
  console.log(`[units] bulwark meshes ${JSON.stringify(meshes)}`);
  expect(meshes).toHaveLength(1);
  expect(meshes[0]!.name).toBe('bulwark-merged-0');
  expect(meshes[0]!.toon).toBe(true);
  // Base models get the toon look installed at startup too.
  const knight = await units(page, (u) => u.ids().find((i) => u.state(i)!.modelId === 'knight')!);
  const knightMeshes = await page.evaluate((x) => window.__citadelUnits!.unitMeshes(x), knight);
  expect(knightMeshes.every((m) => m.toon)).toBe(true);

  await page.evaluate((x) => {
    const s = window.__citadelUnits!.state(x)!;
    window.__citadelCamera!.focusOn(s.position, { instant: true });
  }, id);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -300);
  await page.waitForFunction(() => {
    const c = window.__citadelCamera!.getState();
    return Math.abs(c.distance - c.minDistance) < 0.5;
  });
  await frames(page, 3);
  const path = testInfo.outputPath('units-bulwark-selected.png');
  await page.screenshot({ path, timeout: 60_000 });
  await testInfo.attach('units-bulwark-selected', { path, contentType: 'image/png' });
  expect(errors).toEqual([]);
});
