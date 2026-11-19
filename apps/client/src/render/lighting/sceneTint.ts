/**
 * Scene-wide lighting tints the toon and terrain material plugins multiply
 * into their own palette ambient and rim colours at bind time (CPU side, so
 * a change never recompiles a shader). The lighting rig writes them; scenes
 * without a rig get the identity and look exactly as before.
 */
import type { Scene } from '@babylonjs/core/scene';

export interface SceneLightTint {
  /** Linear RGB multipliers on the materials' `ambientSky` / `ambientGround`. */
  sky: [number, number, number];
  ground: [number, number, number];
  /** Linear RGB multiplier on the toon `rimColor`, and a multiplier on `rimIntensity`. */
  rim: [number, number, number];
  rimIntensity: number;
}

const IDENTITY: Readonly<SceneLightTint> = Object.freeze({
  sky: [1, 1, 1],
  ground: [1, 1, 1],
  rim: [1, 1, 1],
  rimIntensity: 1,
}) as Readonly<SceneLightTint>;

const tints = new WeakMap<Scene, SceneLightTint>();

/** The scene's current tint (identity until a lighting rig sets one). */
export function getSceneLightTint(scene: Scene): Readonly<SceneLightTint> {
  return tints.get(scene) ?? IDENTITY;
}

/** Sets (or with null, clears) the scene's tint. The object is kept by reference. */
export function setSceneLightTint(scene: Scene, tint: SceneLightTint | null): void {
  if (tint) tints.set(scene, tint);
  else tints.delete(scene);
}
