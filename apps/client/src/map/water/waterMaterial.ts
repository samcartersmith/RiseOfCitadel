/**
 * Water material: a StandardMaterial plus a material plugin, built like the
 * toon and terrain materials, so it runs on WebGL2 (GLSL) and WebGPU (native
 * WGSL) and keeps Babylon's cascaded shadows (High), fog and Low-tier
 * in-material image processing. Alpha-blended; no render targets.
 */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Nullable } from '@babylonjs/core/types';
import { findSunLight } from '../../render/shadows';
import { DEFAULT_TOON_PARAMS, rampUniforms } from '../../render/shaders/toonParams';
import { DEFAULT_WATER_LOOK, hexToRgb, type WaterLook } from './waterLook';
import {
  WATER_ATTRIBUTES,
  WATER_FRAGMENT_UNIFORMS_GLSL,
  WATER_FRAGMENT_UNIFORMS_WGSL,
  WATER_UNIFORMS,
  waterShaderCode,
} from './waterShaderCode';

const FALLBACK_SUN = new Vector3(0.4, 1, -0.6).normalize();
const UP = new Vector3(0, 1, 0);
const tmp = new Vector3();
const tmpColor = new Color3();

/** Toon ramp shared with the terrain (terrainMaterial.ts DEFAULT_TERRAIN_LOOK). */
const RAMP = rampUniforms({ ...DEFAULT_TOON_PARAMS, litThreshold: 0.45, midLevel: 0.6, bands: 3 });

export interface WaterGeometryInfo {
  /** Ribbon half-width, world units. */
  halfWidth: number;
}

export class WaterPlugin extends MaterialPluginBase {
  look: WaterLook;
  /** Seconds; advanced by the owner (createWater) every frame. */
  time = 0;

  constructor(
    material: StandardMaterial,
    public geometry: WaterGeometryInfo,
    look: Partial<WaterLook> = {},
  ) {
    super(material, 'CitadelWater', 200, { CITADEL_WATER: false, CUSTOMUSERLIGHTING: false });
    this.look = { ...DEFAULT_WATER_LOOK, ...look };
    this._enable(true);
  }

  override getClassName(): string {
    return 'WaterPlugin';
  }

  override isCompatible(lang: ShaderLanguage): boolean {
    return lang === ShaderLanguage.GLSL || lang === ShaderLanguage.WGSL;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['CITADEL_WATER'] = true;
    defines['CUSTOMUSERLIGHTING'] = true;
  }

  override getAttributes(attributes: string[]): void {
    attributes.push(...WATER_ATTRIBUTES);
  }

  override getUniforms(lang: ShaderLanguage = ShaderLanguage.GLSL) {
    return {
      ubo: WATER_UNIFORMS.map((name) => ({ name, size: 4, type: 'vec4' })),
      fragment:
        lang === ShaderLanguage.WGSL ? WATER_FRAGMENT_UNIFORMS_WGSL : WATER_FRAGMENT_UNIFORMS_GLSL,
    };
  }

  override getCustomCode(
    shaderType: string,
    lang: ShaderLanguage = ShaderLanguage.GLSL,
  ): Nullable<Record<string, string>> {
    return waterShaderCode(shaderType, lang === ShaderLanguage.WGSL);
  }

  override bindForSubMesh(ubo: UniformBuffer, scene: Scene): void {
    const p = this.look;
    const rgb = (hex: string, a: number, name: string) => {
      const [r, g, b] = hexToRgb(hex);
      ubo.updateFloat4(name, r, g, b, a);
    };
    ubo.updateFloat4('waterTime', this.time, p.flowPeriod, this.geometry.halfWidth, p.deepDepth);
    rgb(p.shallow, p.shallowAlpha, 'waterShallow');
    rgb(p.deep, p.deepAlpha, 'waterDeep');
    rgb(p.foam, p.foamDepth, 'waterFoam');
    rgb(p.streak, p.streakStrength, 'waterStreak');
    rgb(p.glow, p.glowIntensity, 'waterGlow');
    rgb(p.skyTint, p.fresnel, 'waterSkyTint');
    ubo.updateFloat4(
      'waterSpec',
      p.rippleStrength,
      p.specThreshold,
      p.specStrength,
      p.bandSoftness,
    );
    ubo.updateFloat4('waterRamp', RAMP.t1, RAMP.t2, 0.04, 0.25);
    ubo.updateFloat4('waterRamp2', 0.6, 0, 0, 0);

    // Sun and ambient come from the scene's lights, like the terrain: M1-09's
    // day/night rig reaches the water without any call.
    const sun = findSunLight(scene);
    if (sun && sun.isEnabled()) {
      tmp.copyFrom(sun.direction).normalize().scaleInPlace(-1);
      ubo.updateFloat4('waterSun', tmp.x, tmp.y, tmp.z, sun.intensity);
      const sc = sun.diffuse.toLinearSpaceToRef(tmpColor);
      ubo.updateFloat4('waterSunColor', sc.r, sc.g, sc.b, 0);
    } else {
      ubo.updateFloat4('waterSun', FALLBACK_SUN.x, FALLBACK_SUN.y, FALLBACK_SUN.z, sun ? 0 : 0.9);
      ubo.updateFloat4('waterSunColor', 1, 1, 1, 0);
    }
    const hemi = scene.lights.find((l) => l instanceof HemisphericLight) as
      HemisphericLight | undefined;
    const k =
      (hemi ? (hemi.isEnabled() ? hemi.intensity : 0) : 0.6) * DEFAULT_TOON_PARAMS.ambientStrength;
    const hemiDir = hemi ? tmp.copyFrom(hemi.direction).normalize() : UP;
    const sky = Color3.FromHexString(DEFAULT_TOON_PARAMS.ambientSky).toLinearSpace();
    const ground = Color3.FromHexString(DEFAULT_TOON_PARAMS.ambientGround).toLinearSpace();
    ubo.updateFloat4('waterSky', sky.r * k, sky.g * k, sky.b * k, 0);
    ubo.updateFloat4('waterGround', ground.r * k, ground.g * k, ground.b * k, 0);
    ubo.updateFloat4('waterHemiDir', hemiDir.x, hemiDir.y, hemiDir.z, 0);
  }
}

export class WaterMaterial extends StandardMaterial {
  readonly water: WaterPlugin;
  constructor(
    name: string,
    scene: Scene,
    geometry: WaterGeometryInfo,
    look: Partial<WaterLook> = {},
  ) {
    super(name, scene);
    this.specularColor = Color3.Black();
    this.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.backFaceCulling = true;
    this.water = new WaterPlugin(this, geometry, look);
  }
}
