import { expect, test, type Page } from '@playwright/test';
import { MODEL_CONFIGS, MODEL_IDS } from '../src/units/modelConfig';
import { LOGICAL_STATES, LOOPING_STATES, type LogicalState } from '../src/units/states';

const knight = MODEL_CONFIGS.knight;

const stateOf = (page: Page, model = 'knight') =>
  page.evaluate((m) => window.__citadelAnim!.state(m as 'knight'), model);
const clipOf = (page: Page, model = 'knight') =>
  page.evaluate((m) => window.__citadelAnim!.clip(m as 'knight'), model);
const play = (page: Page, state: LogicalState, speed = 1) =>
  page.evaluate(
    ([s, sp]) => window.__citadelAnim!.play('knight', s as LogicalState, sp as number),
    [state, speed] as const,
  );

test.describe('animation sandbox', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/anim.html?engine=webgl');
    await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 30_000 });
  });

  test('all four models load idling, and screenshot', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const id of MODEL_IDS) {
      expect(await stateOf(page, id)).toBe('idle');
      expect(await clipOf(page, id)).toBe(MODEL_CONFIGS[id].clips.idle);
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: testInfo.outputPath('anim-models.png') });
    await testInfo.attach('anim-models', {
      path: testInfo.outputPath('anim-models.png'),
      contentType: 'image/png',
    });
    expect(errors).toEqual([]);
  });

  test('screenshot mid-attack and mid-cast for all models', async ({ page }, testInfo) => {
    for (const state of ['attack1', 'cast2'] as const) {
      await page.evaluate((s) => {
        const a = window.__citadelAnim!;
        for (const id of a.models) a.play(id, s);
      }, state);
      await page.waitForTimeout(450);
      for (const id of MODEL_IDS) expect(await stateOf(page, id)).toBe(state);
      const path = testInfo.outputPath(`anim-${state}.png`);
      await page.screenshot({ path });
      await testInfo.attach(`anim-${state}`, { path, contentType: 'image/png' });
      await page.waitForFunction(() => window.__citadelAnim!.state('knight') === 'idle');
    }
  });

  test('knight plays every logical state', async ({ page }) => {
    await page.evaluate(() => window.__citadelAnim!.setBlend(0.1));
    for (const state of LOGICAL_STATES) {
      // Reset to idle between states so each change is observable.
      await play(page, 'idle');
      expect(await play(page, state)).toBe(true);
      expect(await stateOf(page)).toBe(state);
      expect(await clipOf(page)).toBe(knight.clips[state]);

      if (LOOPING_STATES.has(state)) {
        // Loops keep playing.
        await page.waitForTimeout(600);
        expect(await stateOf(page)).toBe(state);
      } else if (state === 'death') {
        // Death holds its last frame instead of returning to idle.
        const secs = await page.evaluate(() => window.__citadelAnim!.duration('knight', 'death'));
        await page.waitForTimeout(secs * 1000 + 500);
        expect(await stateOf(page)).toBe('death');
      } else {
        // One-shots return to idle on their own (played fast to keep the test short).
        await play(page, state, 3);
        await page.waitForFunction(() => window.__citadelAnim!.state('knight') === 'idle', null, {
          timeout: 10_000,
        });
        expect(await clipOf(page)).toBe(knight.clips.idle);
      }
    }
  });

  test('crossfade blends weights and attack point fires once per attack', async ({ page }) => {
    await page.evaluate(() => window.__citadelAnim!.setBlend(1));
    await play(page, 'run');
    await page.waitForTimeout(250);
    const mid = await page.evaluate(() => window.__citadelAnim!.weights('knight'));
    expect(mid.length).toBe(2); // run fading in, idle fading out
    const sum = mid.reduce((s, w) => s + w.weight, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(mid[0]!.clip).toBe(knight.clips.run);
    expect(mid[0]!.weight).toBeGreaterThan(0);
    expect(mid[0]!.weight).toBeLessThan(1);

    await page.evaluate(() => window.__citadelAnim!.setBlend(0.1));
    const before = await page.evaluate(() => window.__citadelAnim!.attackPoints.knight);
    await play(page, 'attack1', 2);
    await page.waitForFunction(() => window.__citadelAnim!.state('knight') === 'idle', null, {
      timeout: 10_000,
    });
    const after = await page.evaluate(() => window.__citadelAnim!.attackPoints.knight);
    expect(after - before).toBe(1);
  });
});
