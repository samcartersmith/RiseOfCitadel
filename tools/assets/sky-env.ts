/**
 * Builds the lighting rig's sky assets (M1-09) from the Poly Haven HDRI:
 *
 *   pnpm assets:fetch polyhaven-sky
 *   pnpm exec tsx tools/assets/sky-env.ts
 *
 * Outputs (apps/client/public/sky/):
 * - `sky-env.hdr`: the HDRI box-filtered down to 128 × 64 (flat RGBE). The client loads it
 *   lazily as an `HDRCubeTexture` (32² faces, GGX-prefiltered on load) for subtle IBL and
 *   reads its spherical harmonics to tint the hemispheric ambient. Downscaling first is what
 *   keeps it ~32 KB instead of 1.4 MB: diffuse/rough IBL never needs the detail.
 * - `sky-clouds.jpg`: a grayscale cloud mask of the upper hemisphere (512 × 128,
 *   zenith at the top row; open sky 0.72, clouds 1). The sky dome multiplies its
 *   time-of-day gradient by it, so
 *   colour always comes from the rig's keyframes and only the cloud shapes come from the photo.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { ROOT, rawDir } from './manifest';

const SRC = join(rawDir('polyhaven-sky'), 'kloofendal_48d_partly_cloudy_puresky_1k.hdr');
const OUT_DIR = join(ROOT, 'apps', 'client', 'public', 'sky');
const ENV_W = 128;
const ENV_H = 64;
const CLOUD_W = 512;
const CLOUD_H = 128;
/** Mask value of open sky (must match CLOUD_FLOOR in apps/client/src/render/lighting/skyDome.ts). */
const CLOUD_FLOOR = 0.72;

/** Reads a Radiance .hdr (RLE or flat RGBE) into linear float RGB. */
function readHdr(buf: Buffer): { w: number; h: number; rgb: Float32Array } {
  let pos = 0;
  const line = () => {
    const start = pos;
    while (buf[pos] !== 0x0a) pos++;
    return buf.toString('ascii', start, pos++);
  };
  if (!line().startsWith('#?')) throw new Error('not a Radiance HDR');
  for (let l = line(); l !== ''; l = line()) {
    if (l.startsWith('FORMAT=') && l !== 'FORMAT=32-bit_rle_rgbe') throw new Error(l);
  }
  const m = /^-Y (\d+) \+X (\d+)$/.exec(line());
  if (!m) throw new Error('unsupported HDR orientation');
  const h = Number(m[1]);
  const w = Number(m[2]);
  const rgbe = new Uint8Array(w * h * 4);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (buf[pos] === 2 && buf[pos + 1] === 2 && ((buf[pos + 2]! << 8) | buf[pos + 3]!) === w) {
      pos += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          let n = buf[pos++]!;
          if (n > 128) {
            n -= 128;
            const v = buf[pos++]!;
            for (let i = 0; i < n; i++) scan[x++ * 4 + c] = v;
          } else {
            for (let i = 0; i < n; i++) scan[x++ * 4 + c] = buf[pos++]!;
          }
        }
      }
    } else {
      scan.set(buf.subarray(pos, pos + w * 4));
      pos += w * 4;
    }
    rgbe.set(scan, y * w * 4);
  }
  const rgb = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const e = rgbe[i * 4 + 3]!;
    const f = e ? Math.pow(2, e - 136) : 0;
    rgb[i * 3] = rgbe[i * 4]! * f;
    rgb[i * 3 + 1] = rgbe[i * 4 + 1]! * f;
    rgb[i * 3 + 2] = rgbe[i * 4 + 2]! * f;
  }
  return { w, h, rgb };
}

/** Box-filters an equirect image down by integer factors. */
function downsample(src: { w: number; h: number; rgb: Float32Array }, w: number, h: number) {
  const fx = src.w / w;
  const fy = src.h / h;
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = Math.floor(y * fy); sy < Math.floor((y + 1) * fy); sy++) {
        for (let sx = Math.floor(x * fx); sx < Math.floor((x + 1) * fx); sx++) {
          const i = (sy * src.w + sx) * 3;
          r += src.rgb[i]!;
          g += src.rgb[i + 1]!;
          b += src.rgb[i + 2]!;
        }
      }
      const n = Math.floor(fx) * Math.floor(fy);
      out.set([r / n, g / n, b / n], (y * w + x) * 3);
    }
  }
  return out;
}

/** Writes flat (non-RLE) RGBE; Babylon's reader accepts both. */
function writeHdr(w: number, h: number, rgb: Float32Array): Buffer {
  const header = Buffer.from(
    `#?RADIANCE\n# ${ENV_W}x${ENV_H} box-filtered from Poly Haven kloofendal_48d_partly_cloudy_puresky (CC0)\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`,
    'ascii',
  );
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3]!;
    const g = rgb[i * 3 + 1]!;
    const b = rgb[i * 3 + 2]!;
    const v = Math.max(r, g, b);
    if (v < 1e-32) continue;
    const e = Math.ceil(Math.log2(v) + 1e-9);
    const f = 256 / Math.pow(2, e);
    px[i * 4] = Math.min(255, Math.floor(r * f));
    px[i * 4 + 1] = Math.min(255, Math.floor(g * f));
    px[i * 4 + 2] = Math.min(255, Math.floor(b * f));
    px[i * 4 + 3] = e + 128;
  }
  // A first pixel of (2, 2, <128) would read as an RLE marker; nudge it (sky is never that dark).
  if (px[0] === 2 && px[1] === 2 && px[2]! < 128) px[0] = 3;
  return Buffer.concat([header, px]);
}

const src = readHdr(readFileSync(SRC));
console.log(`source  ${src.w} x ${src.h}, ${Math.round(statSync(SRC).size / 1024)} KB`);
mkdirSync(OUT_DIR, { recursive: true });

const env = downsample(src, ENV_W, ENV_H);
const envOut = join(OUT_DIR, 'sky-env.hdr');
writeFileSync(envOut, writeHdr(ENV_W, ENV_H, env));
console.log(`env     ${ENV_W} x ${ENV_H} -> ${Math.round(statSync(envOut).size / 1024)} KB`);

// Cloud mask: the upper half of the equirect (zenith row 0 → horizon). Clouds are bright and
// grey, open sky is blue: whiteness = 1 − (b − r)/b, normalised to the 5th–99th percentile.
const half = { w: src.w, h: src.h / 2, rgb: src.rgb.subarray(0, (src.w * src.h * 3) / 2) };
const up = downsample(half, CLOUD_W, CLOUD_H);
const raw = new Float32Array(CLOUD_W * CLOUD_H);
for (let i = 0; i < raw.length; i++) {
  const r = up[i * 3]!;
  const b = up[i * 3 + 2]!;
  raw[i] = b > 1e-6 ? Math.min(1, Math.max(0, 1 - (b - r) / b)) : 0;
}
const sorted = Float32Array.from(raw).sort();
const lo = sorted[Math.floor(sorted.length * 0.05)]!;
const hi = sorted[Math.floor(sorted.length * 0.99)]!;
const mask = Buffer.alloc(raw.length);
for (let i = 0; i < raw.length; i++) {
  const c = Math.min(1, Math.max(0, (raw[i]! - lo) / Math.max(hi - lo, 1e-6)));
  // Open sky = CLOUD_FLOOR, clouds = 1: the dome divides its gradient by the floor.
  mask[i] = Math.round((CLOUD_FLOOR + (1 - CLOUD_FLOOR) * c * c * (3 - 2 * c)) * 255);
}
const cloudOut = join(OUT_DIR, 'sky-clouds.jpg');
await sharp(mask, { raw: { width: CLOUD_W, height: CLOUD_H, channels: 1 } })
  .blur(0.8)
  .jpeg({ quality: 78 })
  .toFile(cloudOut);
console.log(`clouds  ${CLOUD_W} x ${CLOUD_H} -> ${Math.round(statSync(cloudOut).size / 1024)} KB`);
