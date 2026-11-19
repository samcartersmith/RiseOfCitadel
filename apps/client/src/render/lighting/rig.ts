/**
 * The day/night lighting rig (M1-09). One `t ∈ [0, 1)` drives everything:
 * the key light (sun by day, moon by night: one DirectionalLight named `sun`,
 * so the cascaded shadow map is never rebuilt), the hemispheric ambient (and
 * the toon/terrain ambient + rim tints), fog, clear colour, the gradient sky
 * dome, the colour grade, and night-emitter brightness. Keyframes are pure
 * data in keyframes.ts.
 *
 *   const rig = createLightingRig(scene, { t: PHASES.noon });
 *   rig.setT(0.6);          // scrub
 *   rig.setCycle(240);      // auto-cycle, seconds per day (0 = stop)
 *
 * Every per-`t` change is a uniform, light property or vertex-colour write:
 * nothing toggles a define, so scrubbing never compiles a shader. Fog mode is
 * set once at creation. Docs: docs/design/lighting.md.
 */
import { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import type { Material } from '@babylonjs/core/Materials/material';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { setColorGradeHook } from '../pipeline';
import { DEFAULT_TOON_PARAMS } from '../shaders/toonParams';
import { publishLighting } from './events';
import { loadEnvironment, type LoadedEnvironment } from './environment';
import {
  applyIbl,
  hexToLinear,
  LIGHTING_KEYFRAMES,
  linearToGamma,
  samplePalette,
  tintOver,
  wrapT,
  type IblIrradiance,
  type LightingKeyframe,
  type LightingPalette,
  type Rgb,
} from './keyframes';
import {
  NIGHT_EMITTER_PREFIXES,
  registerNightEmitter,
  setNightEmitterFactor,
} from './nightEmitters';
import { setSceneLightTint, type SceneLightTint } from './sceneTint';
import { createSkyDome, type SkyDome } from './skyDome';

const BASE_URL = import.meta.env.BASE_URL;
export const SKY_ENV_URL = `${BASE_URL}sky/sky-env.hdr`;
export const SKY_CLOUDS_URL = `${BASE_URL}sky/sky-clouds.jpg`;

export interface LightingRigOptions {
  /** Starting time of day (default noon). */
  t?: number;
  keyframes?: readonly LightingKeyframe[];
  /** Gradient sky dome (default on). */
  sky?: boolean;
  /** HDR environment URL, or false for none. Loaded after the scene's first ready. */
  environment?: string | false;
  /** Own the colour grade's exposure/contrast/curves (default true). */
  grade?: boolean;
  /** Auto-register materials named with NIGHT_EMITTER_PREFIXES (default true). */
  autoEmitters?: boolean;
  /** Publish `window.__citadelLighting` (setT/getT) (default true). */
  exposeGlobal?: boolean;
}

export interface LightingRig {
  readonly scene: Scene;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphericLight;
  readonly sky: SkyDome | null;
  getT(): number;
  setT(t: number): void;
  /** The current palette (linear RGB). */
  palette(): LightingPalette;
  /** Auto-cycle: seconds per full day, 0 to stop. */
  setCycle(secondsPerDay: number): void;
  cycleSeconds(): number;
  /** Resolves when the environment texture is in (null if disabled or failed). */
  readonly environment: Promise<LoadedEnvironment | null>;
  dispose(): void;
}

export interface CitadelLightingGlobal {
  setT(t: number): void;
  getT(): number;
}

declare global {
  interface Window {
    __citadelLighting?: CitadelLightingGlobal;
  }
}

const BASE_SKY = hexToLinear(DEFAULT_TOON_PARAMS.ambientSky);
const BASE_GROUND = hexToLinear(DEFAULT_TOON_PARAMS.ambientGround);
const BASE_RIM = hexToLinear(DEFAULT_TOON_PARAMS.rimColor);

const setGamma = (target: Color3, c: Rgb) => {
  const g = linearToGamma(c);
  target.set(g[0], g[1], g[2]);
};

/** Finds or creates the light, so a scene's existing `sun`/hemi are adopted rather than doubled. */
function adoptLights(scene: Scene) {
  const sun =
    (scene.lights.find((l) => l instanceof DirectionalLight && l.name === 'sun') as
      DirectionalLight | undefined) ??
    new DirectionalLight('sun', new Vector3(-0.5, -1, 0.4), scene);
  const hemi =
    (scene.lights.find((l) => l instanceof HemisphericLight) as HemisphericLight | undefined) ??
    new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
  hemi.direction.set(0, 1, 0);
  sun.specular = Color3.Black();
  hemi.specular = Color3.Black();
  return { sun, hemi };
}

export function createLightingRig(scene: Scene, opts: LightingRigOptions = {}): LightingRig {
  const keys = opts.keyframes ?? LIGHTING_KEYFRAMES;
  const { sun, hemi } = adoptLights(scene);
  const sky = opts.sky === false ? null : createSkyDome(scene, SKY_CLOUDS_URL);

  // Fog mode is a shader define: set it once, then only colour/density change.
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogEnabled = true;

  const tint: SceneLightTint = {
    sky: [1, 1, 1],
    ground: [1, 1, 1],
    rim: [1, 1, 1],
    rimIntensity: 1,
  };
  setSceneLightTint(scene, tint);

  let t = wrapT(opts.t ?? 0.25);
  let ibl: IblIrradiance | null = null;
  let current: LightingPalette = applyIbl(samplePalette(t, keys), ibl);
  let gradeIntensity = 1;
  let cycle = 0;
  let disposed = false;

  const gradeOn = opts.grade !== false;
  const applyGrade = (g: number) => {
    gradeIntensity = g;
    const ip = scene.imageProcessingConfiguration;
    const p = current;
    // Only write on change: these setters notify every material.
    // Exactly 1 drops the EXPOSURE/CONTRAST defines (a recompile): never land on it.
    const exposure = Math.abs(p.exposure - 1) < 1e-3 ? 1.001 : p.exposure;
    const contrast = Math.abs(p.contrast - 1) < 1e-3 ? 1.001 : p.contrast;
    // These two setters re-flag every material's image-processing defines, so they're
    // quantised (steps of 0.004 are invisible); the curves below are plain uniforms.
    if (Math.abs(ip.exposure - exposure) > 4e-3) ip.exposure = exposure;
    if (Math.abs(ip.contrast - contrast) > 4e-3) ip.contrast = contrast;
    const c = ip.colorCurves;
    if (c) {
      const k = Math.max(0.5, g);
      c.globalSaturation = p.saturation * k;
      c.highlightsHue = p.highlightsHue;
      c.highlightsDensity = p.highlightsDensity * k;
      c.shadowsHue = p.shadowsHue;
      c.shadowsDensity = p.shadowsDensity * k;
      c.shadowsExposure = p.shadowsExposure * k;
    }
  };

  const apply = () => {
    const p = current;
    const d = p.sunDirection;
    sun.direction.set(-d[0], -d[1], -d[2]);
    setGamma(sun.diffuse, p.sunColor);
    sun.intensity = p.sunIntensity;

    hemi.intensity = p.ambientIntensity;
    setGamma(hemi.diffuse, p.ambientSky);
    setGamma(hemi.groundColor, p.ambientGround);
    const ts = tintOver(p.ambientSky, BASE_SKY);
    const tg = tintOver(p.ambientGround, BASE_GROUND);
    const tr = tintOver(p.rimColor, BASE_RIM);
    tint.sky = [ts[0], ts[1], ts[2]];
    tint.ground = [tg[0], tg[1], tg[2]];
    tint.rim = [tr[0], tr[1], tr[2]];
    tint.rimIntensity = p.rimIntensity;

    setGamma(scene.fogColor, p.fogColor);
    scene.fogDensity = p.fogDensity;
    const h = linearToGamma(p.skyHorizon);
    scene.clearColor.set(h[0], h[1], h[2], 1);
    sky?.update(p);
    if (gradeOn) applyGrade(gradeIntensity);
    setNightEmitterFactor(scene, p.emissive);
    publishLighting(scene, p);
  };

  const setT = (next: number) => {
    t = wrapT(next);
    current = applyIbl(samplePalette(t, keys), ibl);
    apply();
  };

  // Night emitters by naming convention. Materials get their emissive after construction,
  // so new ones are registered on the next frame.
  const pending: Material[] = [];
  const matches = (m: Material) => NIGHT_EMITTER_PREFIXES.some((p) => m.name.startsWith(p));
  let materialObserver: Observer<Material> | null = null;
  if (opts.autoEmitters !== false) {
    for (const m of scene.materials) if (matches(m)) registerNightEmitter(m);
    materialObserver = scene.onNewMaterialAddedObservable.add((m) => {
      if (matches(m)) pending.push(m);
    });
  }

  const frameObserver = scene.onBeforeRenderObservable.add(() => {
    while (pending.length) registerNightEmitter(pending.pop()!);
    if (cycle > 0) {
      const dt = Math.min(scene.getEngine().getDeltaTime(), 100) / 1000;
      setT(t + dt / cycle);
    }
  });

  if (gradeOn) setColorGradeHook(scene, applyGrade);
  apply();

  const environment: Promise<LoadedEnvironment | null> =
    opts.environment === false
      ? Promise.resolve(null)
      : new Promise<LoadedEnvironment | null>((resolve) => {
          // Lazy: after the scene's first ready, so it never delays the first frame.
          scene.executeWhenReady(() => {
            void loadEnvironment(scene, opts.environment || SKY_ENV_URL).then((env) => {
              if (env && !disposed) {
                ibl = env.irradiance;
                setT(t);
              }
              resolve(env);
            });
          });
        });

  const rig: LightingRig = {
    scene,
    sun,
    hemi,
    sky,
    getT: () => t,
    setT,
    palette: () => current,
    setCycle(s) {
      cycle = Math.max(0, s);
    },
    cycleSeconds: () => cycle,
    environment,
    dispose() {
      disposed = true;
      scene.onBeforeRenderObservable.remove(frameObserver);
      scene.onNewMaterialAddedObservable.remove(materialObserver);
      if (gradeOn) setColorGradeHook(scene, null);
      setSceneLightTint(scene, null);
      publishLighting(scene, null);
      sky?.dispose();
      if (window.__citadelLighting === global) delete window.__citadelLighting;
    },
  };
  const global: CitadelLightingGlobal = { setT, getT: () => t };
  if (opts.exposeGlobal !== false) window.__citadelLighting = global;
  return rig;
}
