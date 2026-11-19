/**
 * Lighting & atmosphere (M1-09). Docs: docs/design/lighting.md.
 */
export { createLightingRig, SKY_CLOUDS_URL, SKY_ENV_URL } from './rig';
export type { CitadelLightingGlobal, LightingRig, LightingRigOptions } from './rig';
export { getLightingPalette, onLightingChange, type LightingListener } from './events';
export {
  emitterScale,
  NIGHT_EMITTER_PREFIXES,
  nightEmitters,
  registerNightEmitter,
  setNightEmitterFactor,
  unregisterNightEmitter,
} from './nightEmitters';
export {
  LIGHTING_KEYFRAMES,
  PHASES,
  samplePalette,
  type LightingKeyframe,
  type LightingPalette,
  type Phase,
  type Rgb,
} from './keyframes';
export { getSceneLightTint, type SceneLightTint } from './sceneTint';
