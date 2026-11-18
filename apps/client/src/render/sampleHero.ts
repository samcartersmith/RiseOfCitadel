import type { Scene } from '@babylonjs/core/scene';
import { loadModel } from '../units/loadModel';
import { MODEL_CONFIGS } from '../units/modelConfig';
import { applyCitadelToon } from './shaders/applyCitadelToon';
import { teamMaskFor } from './shaders/teamMask';
import { DEFAULT_TOON_PARAMS } from './shaders/toonParams';
import { registerShadowReceiver } from './shadows';

/** The boot scene's camera is far out, so the sample hero is shown larger than game scale. */
const BOOT_DISPLAY_SCALE = 3;

/**
 * Boot-scene sample: the Knight (Bulwark's base body) through the M1-10 hero
 * pipeline (model config + AnimationController), idling with spare props hidden,
 * restyled with the Citadel toon material in Warden gold (M1-02).
 * M1-11 replaces it with the kit-bashed Bulwark.
 */
export async function loadSampleHero(scene: Scene): Promise<void> {
  const knight = await loadModel(scene, MODEL_CONFIGS.knight);
  knight.root.scaling.scaleInPlace(BOOT_DISPLAY_SCALE);
  applyCitadelToon(knight.root, {
    team: 'warden',
    teamMask: teamMaskFor('knight'),
    // The height gradient is in world units, so stretch it with the display scale.
    params: { heightRange: DEFAULT_TOON_PARAMS.heightRange * BOOT_DISPLAY_SCALE },
    variant: 'boot',
  });
  // Receive (self-)shadows on High; main.ts registers the knight as a caster.
  for (const mesh of knight.meshes) registerShadowReceiver(mesh);
}
