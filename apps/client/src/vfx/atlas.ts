import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import { ATLAS_SIZE } from './atlasLayout';
import { paintAtlas } from './atlasDraw';

/**
 * Generates the VFX atlas once per scene. Particle systems sample it through
 * sprite-sheet cells; decals map their quads' UVs onto their cells.
 */
export function createVfxAtlas(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture(
    'vfx-atlas',
    { width: ATLAS_SIZE, height: ATLAS_SIZE },
    scene,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  paintAtlas(texture.getContext() as unknown as CanvasRenderingContext2D);
  texture.update(true);
  return texture;
}
