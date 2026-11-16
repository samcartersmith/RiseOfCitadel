import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import type { Scene } from '@babylonjs/core/scene';
import type { Backend } from './engine';
import { createPostPipeline } from './pipeline';
import { chooseTier, hardwareScalingFor, TIER_SETTINGS, type QualityTier } from './quality';
import { applyShadowSettings } from './shadows';

export interface QualityController {
  readonly tier: QualityTier;
  /** Why the starting tier was picked (`url`, `webgl2`, `mobile`, …). */
  readonly reason: string;
  /** Switches tier at runtime: resolution, AA, post-processing and shadows. No reload. */
  setTier(tier: QualityTier): void;
  dispose(): void;
}

/**
 * Owns everything that changes with the quality tier. Create it once after the
 * scene exists; it follows active-camera swaps and devicePixelRatio changes.
 */
export function createQualityController(
  engine: AbstractEngine,
  scene: Scene,
  backend: Backend,
): QualityController {
  const choice = chooseTier(engine, backend);
  let tier = choice.tier;
  let pipeline: DefaultRenderingPipeline | null = null;

  const applyScaling = () => {
    engine.setHardwareScalingLevel(hardwareScalingFor(TIER_SETTINGS[tier]));
  };
  const rebuildPipeline = () => {
    pipeline?.dispose();
    pipeline = createPostPipeline(scene, TIER_SETTINGS[tier]);
  };
  const apply = () => {
    applyScaling();
    rebuildPipeline();
    applyShadowSettings(scene, TIER_SETTINGS[tier]);
  };

  const cameraObserver = scene.onActiveCameraChanged.add(rebuildPipeline);
  window.addEventListener('resize', applyScaling);
  apply();

  return {
    get tier() {
      return tier;
    },
    reason: choice.reason,
    setTier(next) {
      if (next === tier) return;
      tier = next;
      apply();
    },
    dispose() {
      scene.onActiveCameraChanged.remove(cameraObserver);
      window.removeEventListener('resize', applyScaling);
      pipeline?.dispose();
      pipeline = null;
    },
  };
}
