import { readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

// M1 per-view budget from docs/plan/roadmap.md.
const BUDGET = { drawCalls: 150, triangles: 300_000 };

interface V2 {
  x: number;
  z: number;
}
interface MapJson {
  heightLevels: Record<'river' | 'low' | 'mid' | 'high', number>;
  river: { waypoints: V2[] };
  regions: { id: string; tag: string; height: 'river' | 'low' | 'mid' | 'high'; polygon: V2[] }[];
  structures: { id: string; type: string; tier?: number; position: V2 }[];
}
const map = JSON.parse(
  readFileSync(new URL('../../../packages/content/data/map/citadel.json', import.meta.url), 'utf8'),
) as MapJson;

const centroid = (poly: V2[]): V2 => {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j]!.x * poly[i]!.z - poly[i]!.x * poly[j]!.z;
    a += f;
    cx += (poly[j]!.x + poly[i]!.x) * f;
    cz += (poly[j]!.z + poly[i]!.z) * f;
  }
  return { x: cx / (3 * a), z: cz / (3 * a) };
};

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__citadelReady === true, null, { timeout: 120_000 });
  await page.waitForFunction(
    () => window.__citadelStats !== undefined && !!window.__citadelTerrain,
  );
}

/** CI renders with software GL at ~1 fps on High: wait for frames, never wall-clock time. */
async function waitFrames(page: Page, n: number) {
  const start = await page.evaluate(() => window.__citadelTerrain!.frames());
  await page.waitForFunction((f) => window.__citadelTerrain!.frames() >= f, start + n, {
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

for (const tier of ['low', 'high'] as const) {
  test(`terrain (${tier}): MOBA views within budget, top-down of the whole map`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(tier === 'high' ? 360_000 : 180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/terrain.html?engine=webgl&tier=${tier}&hud=0`);
    await waitReady(page);

    for (const view of ['lane', 'river', 'base'] as const) {
      await page.evaluate((v) => window.__citadelTerrain!.view(v), view);
      const stats = await freshStats(page);
      console.log(
        `[terrain] ${tier} ${view}: ${stats.drawCalls} draws, ${stats.triangles} tris, ${stats.activeMeshes} meshes`,
      );
      expect(stats.backend).toBe('webgl2');
      expect(stats.tier).toBe(tier);
      expect(stats.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
      expect(stats.triangles).toBeLessThanOrEqual(BUDGET.triangles);
      await shot(page, testInfo, `terrain-${tier}-${view}`);
    }

    await page.evaluate(() => window.__citadelTerrain!.view('top'));
    const top = await freshStats(page);
    console.log(`[terrain] ${tier} top: ${top.drawCalls} draws, ${top.triangles} tris`);
    // Whole map at once: every chunk on screen, all at ¼ detail.
    expect(top.triangles).toBeLessThanOrEqual(BUDGET.triangles);
    await shot(page, testInfo, `terrain-${tier}-top`);
    if (tier === 'low') {
      await page.evaluate(() => window.__citadelTerrain!.setOverlay(true));
      await waitFrames(page, 2);
      await shot(page, testInfo, 'terrain-low-top-overlay');
    }

    const t = await page.evaluate(() => window.__citadelTerrain!.stats);
    console.log(
      `[terrain] ${t.chunks} chunks, tris/chunk ${t.trianglesPerChunk.join('/')}, control ${t.controlMs} ms, meshes ${t.meshMs} ms, textures ${t.textureBytes} B`,
    );
    expect(t.textureBytes).toBeLessThan(200 * 1024);
    expect(errors).toEqual([]);
  });
}

test('terrain heights line up with the map data', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/terrain.html?engine=webgl&tier=low&hud=0');
  await waitReady(page);
  const L = map.heightLevels;

  const checks: { what: string; p: V2; expect: number; tol: number; atLeast?: boolean }[] = [];
  for (const r of map.regions) {
    const c = centroid(r.polygon);
    if (r.tag === 'base' || r.tag === 'highground' || r.tag === 'pit') {
      checks.push({ what: `${r.id} (${r.tag})`, p: c, expect: L[r.height], tol: 8 });
    } else if (r.tag === 'unwalkable') {
      checks.push({ what: `${r.id} (rock)`, p: c, expect: L.high, tol: 0, atLeast: true });
    }
  }
  for (const p of map.river.waypoints.slice(1, -1)) {
    checks.push({ what: `river (${p.x}, ${p.z})`, p, expect: L.river, tol: 6 });
  }
  for (const s of map.structures) {
    if (s.type === 'ancient' || s.type === 'fountain') {
      checks.push({ what: s.id, p: s.position, expect: L.high, tol: 8 });
    }
    if (s.type === 'tower' && (s.tier === 1 || s.tier === 2)) {
      checks.push({ what: s.id, p: s.position, expect: L.low, tol: 20 });
    }
  }

  const results = await page.evaluate(
    (pts) =>
      pts.map((p) => ({
        sampler: window.__citadelTerrain!.heightAt(p.x, p.z),
        mesh: window.__citadelTerrain!.meshHeightAt(p.x, p.z),
        region: window.__citadelTerrain!.regionAt(p.x, p.z),
      })),
    checks.map((c) => c.p),
  );
  checks.forEach((c, i) => {
    const r = results[i]!;
    const label = `${c.what}: sampler ${r.sampler.toFixed(1)}, mesh ${r.mesh?.toFixed(1)}`;
    if (c.atLeast) expect(r.sampler, label).toBeGreaterThan(c.expect);
    else expect(Math.abs(r.sampler - c.expect), label).toBeLessThanOrEqual(c.tol);
    // The rendered mesh is where the sampler says it is.
    expect(r.mesh, label).not.toBeNull();
    expect(Math.abs(r.mesh! - r.sampler), label).toBeLessThan(1);
  });
  console.log(`[terrain] ${checks.length} height checks passed`);
});
