/**
 * Convert the models listed in each pack manifest into web-ready GLBs:
 * dedup + keyframe resample + prune + weld + KHR_mesh_quantization (decoded natively by Babylon,
 * no extra decoder download). Output: apps/client/public/models/<pack>/<out>.glb
 *
 * Texture compression (KTX2/Basis) and meshopt are added in M1 once budgets
 * show they're needed.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, resample, weld } from '@gltf-transform/functions';
import { loadManifests, MODELS_OUT, rawDir } from './manifest';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
let built = 0;
let missing = 0;

for (const m of loadManifests()) {
  for (const model of m.models ?? []) {
    const src = join(rawDir(m.id), model.src);
    if (!existsSync(src)) {
      missing++;
      console.warn(`missing ${m.id}/${model.src} (run pnpm assets:fetch)`);
      continue;
    }
    const doc = await io.read(src);
    await doc.transform(dedup(), resample(), prune(), weld(), quantize());
    const outDir = join(MODELS_OUT, m.id);
    mkdirSync(outDir, { recursive: true });
    const out = join(outDir, `${model.out}.glb`);
    await io.write(out, doc);
    built++;
    const kb = (n: number) => `${Math.round(n / 1024)} KB`;
    console.log(
      `built  ${m.id}/${model.out}.glb  ${kb(statSync(src).size)} -> ${kb(statSync(out).size)}`,
    );
  }
}
console.log(`${built} model(s) built, ${missing} missing`);
process.exit(missing ? 1 : 0);
