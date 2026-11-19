import { expect, test, type TestInfo, type Page } from '@playwright/test';

/**
 * Regression for M1-13b: merging a KayKit character (mergeModel.ts) must not
 * move a single vertex. Quantized GLBs give every body part its own skin, and
 * the old merge put every part on the first part's skeleton, mirroring the
 * Knight's body behind its head. We compare CPU-skinned world bounds of an
 * unmerged knight with two merged ones (merged under a rotated parent, and
 * merged by loadModel then parented), in the same pose, under two rotations.
 */

/** World units. The knight is ~2.5 tall at config scale, ×2.5 display scale here. */
const TOL = 0.02;

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, timeout: 60_000 });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('unit merge: merged knight matches unmerged knight vertex for vertex', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Few units so the check itself isn't starved on software GL.
  await page.goto('/units.html?engine=webgl&n=4');
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 120_000 });
  await page.evaluate(() => window.__citadelUnits!.pause(true));

  const r = await page.evaluate(() => window.__citadelUnits!.mergeCheck({ keep: true }));
  await testInfo.attach('merge-check', {
    body: JSON.stringify(r, null, 2),
    contentType: 'application/json',
  });
  console.log(`[merge] meshes ${JSON.stringify(r.meshCounts)}`);

  // Close-up first (so a failure still has the picture): unmerged (left), merged under parent (middle), merged by loadModel (right).
  await page.evaluate(() => {
    const cam = window.__citadelCamera!;
    cam.focusOn({ x: 0, z: 30 }, { instant: true });
  });
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height / 2);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -300);
  await page.waitForFunction(() => {
    const c = window.__citadelCamera!.getState();
    return Math.abs(c.distance - c.minDistance) < 0.5;
  });
  const f = await page.evaluate(() => window.__citadelUnits!.frames());
  await page.waitForFunction((t) => window.__citadelUnits!.frames() >= t, f + 3, {
    timeout: 60_000,
  });
  await shot(page, testInfo, 'merge-knights-closeup');
  // Merging really happened (1 draw call per knight) and kept every vertex.
  expect(r.meshCounts.unmerged).toBeGreaterThan(5);
  expect(r.meshCounts.mergedUnderParent).toBe(1);
  expect(r.meshCounts.mergedByLoadModel).toBe(1);
  for (let pass = 0; pass < 2; pass++) {
    const ref = r.unmerged[pass]!;
    for (const variant of [r.mergedUnderParent[pass]!, r.mergedByLoadModel[pass]!]) {
      expect(variant.vertices).toBe(ref.vertices);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(variant.min[k]! - ref.min[k]!)).toBeLessThan(TOL);
        expect(Math.abs(variant.max[k]! - ref.max[k]!)).toBeLessThan(TOL);
        expect(Math.abs(variant.centroid[k]! - ref.centroid[k]!)).toBeLessThan(TOL);
      }
    }
  }

  expect(errors).toEqual([]);
});
