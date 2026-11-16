import type { Scene } from '@babylonjs/core/scene';
import { loadModel } from '../units/loadModel';
import { MODEL_CONFIGS } from '../units/modelConfig';

/** The boot scene's camera is far out, so the sample hero is shown larger than game scale. */
const BOOT_DISPLAY_SCALE = 3;

/**
 * Boot-scene sample: the Knight (Bulwark's base body) through the M1-10 hero
 * pipeline (model config + AnimationController), idling with spare props hidden.
 * M1-11 replaces it with the kit-bashed Bulwark.
 */
export async function loadSampleHero(scene: Scene): Promise<void> {
  const knight = await loadModel(scene, MODEL_CONFIGS.knight);
  knight.root.scaling.scaleInPlace(BOOT_DISPLAY_SCALE);
}
