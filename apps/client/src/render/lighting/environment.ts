/**
 * Environment texture from the Poly Haven HDRI (CC0, assets-src/polyhaven-sky).
 * `tools/assets/sky-env.ts` box-filters it to a 128 × 64 RGBE file (~32 KB);
 * here it becomes a 32² cube, GGX-prefiltered on load, set as the scene's
 * environment (subtle IBL for any PBR material) and reduced to two hemisphere
 * irradiance colours that tint the toon/terrain ambient by the palette's
 * `iblMix`. Loading is lazy and optional: the rig looks right without it.
 */
import { HDRCubeTexture } from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import type { Scene } from '@babylonjs/core/scene';
import { irradianceUpDown, type IblIrradiance, type Rgb } from './keyframes';

export interface LoadedEnvironment {
  texture: HDRCubeTexture;
  irradiance: IblIrradiance | null;
  /** Bytes transferred for the HDR file (resource timing; 0 if the browser hides it). */
  bytes: number;
}

const rgb = (v: { x: number; y: number; z: number }): Rgb => [v.x, v.y, v.z];

function transferBytes(url: string): number {
  const abs = new URL(url, location.href).href;
  const entry = performance.getEntriesByType('resource').find((e) => e.name === abs) as
    PerformanceResourceTiming | undefined;
  return entry ? entry.encodedBodySize || entry.transferSize : 0;
}

/** Loads the HDR as a prefiltered cube environment. Resolves null (with a warning) on failure. */
export function loadEnvironment(
  scene: Scene,
  url: string,
  intensity = 0.4,
): Promise<LoadedEnvironment | null> {
  return new Promise((resolve) => {
    let texture: HDRCubeTexture | null = null;
    const done = () => {
      if (!texture) return;
      scene.environmentTexture = texture;
      scene.environmentIntensity = intensity;
      const sp = texture.sphericalPolynomial;
      const irradiance = sp
        ? irradianceUpDown({ y: rgb(sp.y), xx: rgb(sp.xx), yy: rgb(sp.yy), zz: rgb(sp.zz) })
        : null;
      resolve({ texture, irradiance, bytes: transferBytes(url) });
    };
    try {
      texture = new HDRCubeTexture(
        url,
        scene,
        32, // face size: diffuse/rough IBL needs no more
        false, // mipmaps (the prefiltered roughness chain)
        true, // spherical harmonics, for the ambient tint
        false, // linear data
        true, // GGX-prefilter on load
        () => done(),
        (msg) => {
          console.warn('[citadel] lighting: environment failed to load', msg);
          resolve(null);
        },
      );
      texture.name = 'citadel-sky-env';
    } catch (err) {
      console.warn('[citadel] lighting: environment failed to load', err);
      resolve(null);
    }
  });
}
