import { expect, test, type Page } from '@playwright/test';

const camState = (page: Page) => page.evaluate(() => window.__citadelCamera!.getState());

test('MOBA camera: wheel zoom, edge pan, bounds', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?engine=webgl');
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__citadelCamera !== undefined);

  const viewport = page.viewportSize()!;
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const start = await camState(page);
  expect(start.focus).toEqual({ x: 0, z: 0 });
  expect(start.pitchDeg).toBeGreaterThan(50);
  expect(start.pitchDeg).toBeLessThan(60);

  // Default framing screenshot: the boot scene should sit nicely in view.
  await page.mouse.move(cx, cy);
  await page.screenshot({ path: testInfo.outputPath('camera-default.png') });
  await testInfo.attach('camera-default', {
    path: testInfo.outputPath('camera-default.png'),
    contentType: 'image/png',
  });

  // Wheel zoom: in reduces distance, and never goes below the minimum.
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await camState(page)).distance).toBeLessThan(start.distance);
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await camState(page)).distance).toBeCloseTo(start.minDistance, 1);
  expect((await camState(page)).distance).toBeGreaterThanOrEqual(start.minDistance);

  // ...and zooming out stops at the maximum.
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await camState(page)).distance).toBeCloseTo(start.maxDistance, 1);
  expect((await camState(page)).distance).toBeLessThanOrEqual(start.maxDistance);

  // Edge pan: holding the pointer at the right edge moves focus +x.
  await page.mouse.move(viewport.width - 1, cy);
  await expect.poll(async () => (await camState(page)).focus.x).toBeGreaterThan(2);

  // Bounds: keep holding until it hits the map edge; it never goes past it.
  const samples: { x: number; z: number }[] = [];
  for (let i = 0; i < 20; i++) {
    samples.push((await camState(page)).focus);
    await page.waitForTimeout(100);
  }
  const { bounds } = start;
  for (const f of samples) {
    expect(f.x).toBeLessThanOrEqual(bounds.maxX);
    expect(f.x).toBeGreaterThanOrEqual(bounds.minX);
    expect(f.z).toBeLessThanOrEqual(bounds.maxZ);
    expect(f.z).toBeGreaterThanOrEqual(bounds.minZ);
  }
  expect(samples.at(-1)!.x).toBeCloseTo(bounds.maxX, 3);

  // Bottom-left corner: pans diagonally into the opposite corner and stays clamped.
  await page.mouse.move(0, viewport.height - 1);
  await expect
    .poll(async () => (await camState(page)).focus.x, { timeout: 10_000 })
    .toBe(bounds.minX);
  await expect
    .poll(async () => (await camState(page)).focus.z, { timeout: 10_000 })
    .toBe(bounds.minZ);

  // Pointer back in the middle: no drift.
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(500);
  const rest = (await camState(page)).focus;
  await page.waitForTimeout(300);
  expect((await camState(page)).focus).toEqual(rest);

  // Space recenters on the followed target (the origin for now).
  await page.keyboard.press('Space');
  await expect.poll(async () => (await camState(page)).focus).toEqual({ x: 0, z: 0 });

  // Middle-mouse drag grabs the map: dragging right moves the focus -x.
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx + 200, cy, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(async () => (await camState(page)).focus.x).toBeLessThan(-1);

  // Minimap jump API.
  await page.evaluate(() => window.__citadelCamera!.jumpTo({ x: 1, y: 0 }));
  expect((await camState(page)).focus).toEqual({ x: bounds.maxX, z: bounds.maxZ });
  await page.evaluate(() => window.__citadelCamera!.focusOn({ x: 0, z: 0 }, { instant: true }));

  await page.screenshot({ path: testInfo.outputPath('camera-zoomed-out.png') });
  await testInfo.attach('camera-zoomed-out', {
    path: testInfo.outputPath('camera-zoomed-out.png'),
    contentType: 'image/png',
  });
  expect(errors).toEqual([]);
});
