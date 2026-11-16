import '@babylonjs/loaders/glTF/2.0';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { Scene } from '@babylonjs/core/scene';

/**
 * M0-07 proof that the asset pipeline works: load the processed Knight
 * (Bulwark's base body) and loop its idle animation. M1-10/M1-11 replace
 * this with the real AnimationController and the kit-bashed Bulwark.
 */
export async function loadSampleHero(scene: Scene): Promise<void> {
  const result = await ImportMeshAsync('/models/kaykit-adventurers/knight.glb', scene);
  const root = result.meshes[0];
  if (root) root.scaling.setAll(3);
  for (const group of result.animationGroups) group.stop();
  result.animationGroups.find((g) => g.name === 'Idle')?.start(true);
}
