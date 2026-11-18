/**
 * Convert the models listed in each pack manifest into web-ready GLBs:
 * optional per-model trimming (keepAnimations / keepNodes / removeNodes, see modelOptions.ts),
 * then dedup + keyframe resample + prune + weld (+ optional meshopt `simplify`) + KHR_mesh_quantization (decoded natively by
 * Babylon, no extra decoder download; `quantize: false` opts out per model).
 * Output: apps/client/public/models/<pack>/<out>.glb
 *
 * Texture compression (KTX2/Basis) and meshopt are added in M1 once budgets
 * show they're needed.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, resample, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { loadManifests, MODELS_OUT, rawDir } from './manifest';
import { optionTransforms } from './modelOptions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
// `pnpm assets:build <pack-id> ...` rebuilds only those packs (default: all).
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let built = 0;
let missing = 0;

for (const m of loadManifests()) {
  if (only.length && !only.includes(m.id)) continue;
  for (const model of m.models ?? []) {
    const src = join(rawDir(m.id), model.src);
    if (!existsSync(src)) {
      missing++;
      console.warn(`missing ${m.id}/${model.src} (run pnpm assets:fetch)`);
      continue;
    }
    const doc = await io.read(src);
    await doc.transform(
      ...optionTransforms(model),
      dedup(),
      resample(),
      prune(),
      weld(),
      ...(model.simplify
        ? [
            simplify({
              simplifier: MeshoptSimplifier,
              ratio: model.simplify.ratio,
              error: model.simplify.error ?? 0.01,
            }),
            prune(),
          ]
        : []),
      ...(model.quantize === false ? [] : [quantize()]),
    );
    const outDir = join(MODELS_OUT, m.id);
    mkdirSync(outDir, { recursive: true });
    const out = join(outDir, `${model.out}.glb`);
    const previous = existsSync(out) ? statSync(out).size : null;
    await io.write(out, doc);
    built++;
    const kb = (n: number) => `${Math.round(n / 1024)} KB`;
    const anims = doc.getRoot().listAnimations().length;
    console.log(
      `built  ${m.id}/${model.out}.glb  src ${kb(statSync(src).size)}` +
        (previous !== null ? `, was ${kb(previous)}` : '') +
        ` -> ${kb(statSync(out).size)}  (${anims} animations)`,
    );
  }
}
console.log(`${built} model(s) built, ${missing} missing`);
process.exit(missing ? 1 : 0);
