/**
 * GPU textures for the terrain: the control map (baked in code) and the
 * detail atlas (one small grayscale JPEG, split into RGBA channels here).
 */
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Scene } from '@babylonjs/core/scene';

/** URL of the detail atlas (tools/assets/terrain-textures.ts). */
export const DETAIL_ATLAS_URL = `${import.meta.env.BASE_URL}terrain/terrain-detail.jpg`;

export function createControlTexture(scene: Scene, data: Uint8Array, size: number): RawTexture {
  const tex = new RawTexture(
    data,
    size,
    size,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  tex.name = 'terrain-control';
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

export interface DetailTexture {
  texture: RawTexture;
  /** Bytes downloaded for the atlas (from the response). */
  bytes: number;
}

/**
 * Loads the 2 × 2 grayscale atlas and interleaves its tiles into the R, G, B
 * and A channels of one repeating, mipmapped texture: one sampler for all
 * four ambientCG layers.
 */
export async function loadDetailTexture(
  scene: Scene,
  url = DETAIL_ATLAS_URL,
): Promise<DetailTexture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`terrain detail atlas ${url}: ${res.status}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  const w = bitmap.width;
  const h = bitmap.height;
  const tile = w / 2;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const src = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(tile * tile * 4);
  for (let t = 0; t < 4; t++) {
    const ox = (t % 2) * tile;
    const oy = Math.floor(t / 2) * tile;
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        out[(y * tile + x) * 4 + t] = src[((oy + y) * w + ox + x) * 4]!;
      }
    }
  }
  const texture = new RawTexture(
    out,
    tile,
    tile,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.name = 'terrain-detail';
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 4;
  return { texture, bytes: blob.size };
}
