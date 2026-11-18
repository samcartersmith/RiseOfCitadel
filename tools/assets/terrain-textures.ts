/**
 * Builds the terrain detail atlas (M1-05) from the ambientCG terrain pack:
 *
 *   pnpm assets:fetch ambientcg-terrain
 *   pnpm exec tsx tools/assets/terrain-textures.ts
 *
 * Each layer's colour map is reduced to luminance, lightly blurred, contrast-normalised (2nd–98th
 * percentile → 0..1) and downscaled. The four tiles go into one 2 × 2 grayscale
 * JPEG; the client splits it into the R, G, B, A channels of one texture. Colour
 * comes from palette ramps in the terrain shader, not from the photos, which is
 * what keeps the terrain on the art-direction palette.
 *
 * Output: apps/client/public/terrain/terrain-detail.jpg
 */
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { ROOT, rawDir } from './manifest';

/** Atlas layout: index = channel (R, G, B, A) = tile (top-left, top-right, bottom-left, bottom-right). */
export const TERRAIN_LAYERS = ['Grass004', 'Ground037', 'Ground054', 'Rock030'] as const;
const TILE = Number(process.env.TERRAIN_TILE ?? 256);
const QUALITY = Number(process.env.TERRAIN_QUALITY ?? 80);

const out = join(ROOT, 'apps', 'client', 'public', 'terrain', 'terrain-detail.jpg');
const src = rawDir('ambientcg-terrain');

async function layer(name: string): Promise<Buffer> {
  const { data } = await sharp(join(src, `${name}_1K-JPG_Color.jpg`))
    .resize(TILE, TILE, { kernel: 'lanczos3' })
    .grayscale()
    .blur(0.6) // soften photo speckle: the shader wants painterly breakup, not grain
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hist = new Array<number>(256).fill(0);
  for (const v of data) hist[v]!++;
  const pct = (p: number) => {
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i]!;
      if (acc >= p * data.length) return i;
    }
    return 255;
  };
  const lo = pct(0.02);
  const hi = Math.max(lo + 1, pct(0.98));
  const outBuf = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    outBuf[i] = Math.round(Math.min(1, Math.max(0, (data[i]! - lo) / (hi - lo))) * 255);
  }
  console.log(`layer  ${name}: luma ${lo}..${hi} -> 0..255`);
  return outBuf;
}

const tiles = await Promise.all(TERRAIN_LAYERS.map(layer));
const atlas = Buffer.alloc(TILE * 2 * TILE * 2);
tiles.forEach((tile, t) => {
  const ox = (t % 2) * TILE;
  const oy = Math.floor(t / 2) * TILE;
  for (let y = 0; y < TILE; y++) {
    tile.copy(atlas, (oy + y) * TILE * 2 + ox, y * TILE, (y + 1) * TILE);
  }
});
mkdirSync(join(out, '..'), { recursive: true });
await sharp(atlas, { raw: { width: TILE * 2, height: TILE * 2, channels: 1 } })
  .jpeg({ quality: QUALITY, mozjpeg: true })
  .toFile(out);
console.log(`wrote  ${out} (${TILE * 2}², ${Math.round(statSync(out).size / 1024)} KB)`);
