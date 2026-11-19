import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { TierSettings } from './quality';

/**
 * Called after the base grade is applied, with the tier's grade intensity. The
 * lighting rig (render/lighting) registers one so its time-of-day exposure,
 * contrast and curves survive tier switches and pipeline rebuilds.
 */
export type ColorGradeHook = (intensity: number) => void;
const gradeHooks = new WeakMap<Scene, ColorGradeHook>();
const gradeIntensities = new WeakMap<Scene, number>();

/** Registers (or with null, clears) the scene's colour-grade hook and runs it once. */
export function setColorGradeHook(scene: Scene, hook: ColorGradeHook | null): void {
  if (!hook) {
    gradeHooks.delete(scene);
    return;
  }
  gradeHooks.set(scene, hook);
  hook(gradeIntensities.get(scene) ?? 1);
}

/**
 * Colour grade toward the art-direction palette (docs/design/art-direction.md §2.1):
 * warm gold highlights (Warden hearth-light), a faint violet lift in the shadows
 * (Hollow), and a saturation/contrast boost so ACES doesn't wash the palette out.
 * `intensity` scales the grade per tier (0 = neutral apart from tonemapping).
 */
export function applyColorGrade(scene: Scene, intensity: number): void {
  const ip = scene.imageProcessingConfiguration;
  ip.isEnabled = true;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  // The placeholder rig lights surfaces at ~1.4x, so no extra exposure; contrast and
  // saturation offset the flattening ACES applies to the mids.
  ip.exposure = 1.0;
  ip.contrast = 1.25;

  const g = Math.max(0.5, intensity); // the grade carries the look, keep some on every tier
  const curves = new ColorCurves();
  curves.globalSaturation = 18 * g;
  curves.highlightsHue = 42; // Warden gold
  curves.highlightsDensity = 18 * g;
  curves.highlightsSaturation = 10 * g;
  curves.shadowsHue = 268; // Hollow violet
  curves.shadowsDensity = 22 * g;
  curves.shadowsSaturation = 8 * g;
  curves.shadowsExposure = 4 * g; // lift the blacks a touch so dark ash stays readable
  ip.colorCurves = curves;
  ip.colorCurvesEnabled = true;

  ip.vignetteEnabled = intensity > 0;
  ip.vignetteWeight = 1.6 * intensity;
  ip.vignetteStretch = 0.4;
  ip.vignetteCameraFov = 0.6;
  ip.vignetteColor = new Color4(0.07, 0.04, 0.1, 0); // violet-black, not grey

  gradeIntensities.set(scene, intensity);
  gradeHooks.get(scene)?.(intensity);
}

/**
 * Builds the DefaultRenderingPipeline for a tier, or returns null when the tier
 * runs without post-processing (Low). The pipeline is rebuilt on every tier
 * change and whenever the active camera is swapped (M1-03 replaces the camera).
 */
export function createPostPipeline(
  scene: Scene,
  settings: TierSettings,
): DefaultRenderingPipeline | null {
  applyColorGrade(scene, settings.postIntensity);
  const camera = scene.activeCamera;
  if (settings.postIntensity <= 0 || !camera) {
    // Image processing (tonemap + grade) then runs inside the materials: no extra pass.
    scene.imageProcessingConfiguration.applyByPostProcess = false;
    return null;
  }

  const pipeline = new DefaultRenderingPipeline('citadel-post', true, scene, [camera], false);
  pipeline.samples = settings.msaaSamples;
  pipeline.fxaaEnabled = settings.fxaa;
  pipeline.imageProcessingEnabled = true;

  pipeline.bloomEnabled = settings.bloom;
  if (settings.bloom) {
    // Subtle: only emissive-ish highlights (braziers, river, VFX) should glow.
    pipeline.bloomThreshold = 0.85;
    pipeline.bloomWeight = 0.25 * settings.postIntensity;
    pipeline.bloomKernel = settings.msaaSamples > 1 ? 64 : 48;
    pipeline.bloomScale = 0.5;
  }
  pipeline.prepare();
  return pipeline;
}
