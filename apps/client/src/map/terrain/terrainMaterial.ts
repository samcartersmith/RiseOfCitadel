/**
 * Terrain splat material: a StandardMaterial plus a material plugin, built
 * like the toon material (render/shaders/citadelToonMaterial.ts), so it runs
 * on WebGL2 (GLSL) and WebGPU (native WGSL) and keeps Babylon's cascaded
 * shadows, fog and Low-tier in-material image processing.
 */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Nullable } from '@babylonjs/core/types';
import { findSunLight } from '../../render/shadows';
import { DEFAULT_TOON_PARAMS, rampUniforms } from '../../render/shaders/toonParams';
import { DETAIL_TILE, SPLAT_LAYERS, hexToRgb, rampUniformName } from './splatPalette';
import {
  TERRAIN_CONTROL_SAMPLER,
  TERRAIN_DETAIL_SAMPLER,
  TERRAIN_FRAGMENT_UNIFORMS_GLSL,
  TERRAIN_FRAGMENT_UNIFORMS_WGSL,
  TERRAIN_UNIFORMS,
  terrainFragmentCode,
} from './terrainShaderCode';

/** Look knobs (all uniforms: changing one never recompiles). */
export interface TerrainLook {
  /** Scene units per repeat of the fine and coarse detail. */
  fineTile: number;
  coarseTile: number;
  /** 0 = fine only, 1 = coarse only. */
  coarseMix: number;
  /** Posterise softness (0 = hard steps, 0.5 = smooth). */
  posterSoftness: number;
  /** 1 − normal.y where rock starts. */
  rockSlope: number;
  /** Toon ramp, shared with units so terrain and heroes band the same way. */
  shadowThreshold: number;
  litThreshold: number;
  bandSoftness: number;
  shadowLevel: number;
  midLevel: number;
  ambientSky: string;
  ambientGround: string;
  ambientStrength: number;
}

export const DEFAULT_TERRAIN_LOOK: Readonly<TerrainLook> = {
  fineTile: DETAIL_TILE.fine,
  coarseTile: DETAIL_TILE.coarse,
  coarseMix: 0.35,
  posterSoftness: 0.3,
  rockSlope: 0.32,
  shadowThreshold: DEFAULT_TOON_PARAMS.shadowThreshold,
  litThreshold: 0.45,
  bandSoftness: 0.04,
  shadowLevel: 0.25,
  midLevel: 0.6,
  ambientSky: DEFAULT_TOON_PARAMS.ambientSky,
  ambientGround: DEFAULT_TOON_PARAMS.ambientGround,
  ambientStrength: DEFAULT_TOON_PARAMS.ambientStrength,
};

/** World heights the shader keys layers off (scene units). */
export interface TerrainLevels {
  low: number;
  river: number;
  /** Anything above this is rock (unwalkable relief). */
  rockAbove: number;
  /** Map size across, scene units. */
  mapSize: number;
}

const FALLBACK_SUN = new Vector3(0.4, 1, -0.6).normalize();
const UP = new Vector3(0, 1, 0);
const tmp = new Vector3();
const tmpColor = new Color3();

const linear = (hex: string): Color3 => Color3.FromHexString(hex).toLinearSpace();

export class TerrainSplatPlugin extends MaterialPluginBase {
  readonly look: TerrainLook;
  /** Packed ramp stops: [layer][w0 w1 w2 h0 h1 h2] → rgba (gamma rgb, contrast in .a). */
  private readonly ramps: Float32Array;

  constructor(
    material: StandardMaterial,
    public controlTexture: BaseTexture,
    public detailTexture: BaseTexture,
    public levels: TerrainLevels,
    look: Partial<TerrainLook> = {},
  ) {
    super(material, 'CitadelTerrain', 200, { CITADEL_TERRAIN: false, CUSTOMUSERLIGHTING: false });
    this.look = { ...DEFAULT_TERRAIN_LOOK, ...look };
    this.ramps = new Float32Array(SPLAT_LAYERS.length * 6 * 4);
    SPLAT_LAYERS.forEach((layer, i) => {
      [...layer.warden, ...layer.hollow].forEach((hex, s) => {
        const [r, g, b] = hexToRgb(hex);
        this.ramps.set([r, g, b, layer.contrast], (i * 6 + s) * 4);
      });
    });
    this._enable(true);
  }

  override getClassName(): string {
    return 'TerrainSplatPlugin';
  }

  override isCompatible(lang: ShaderLanguage): boolean {
    return lang === ShaderLanguage.GLSL || lang === ShaderLanguage.WGSL;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['CITADEL_TERRAIN'] = true;
    defines['CUSTOMUSERLIGHTING'] = true;
  }

  override isReadyForSubMesh(): boolean {
    return this.controlTexture.isReady() && this.detailTexture.isReady();
  }

  override getSamplers(samplers: string[]): void {
    samplers.push(TERRAIN_CONTROL_SAMPLER, TERRAIN_DETAIL_SAMPLER);
  }

  override getUniforms(lang: ShaderLanguage = ShaderLanguage.GLSL) {
    return {
      ubo: TERRAIN_UNIFORMS.map((name) => ({ name, size: 4, type: 'vec4' })),
      fragment:
        lang === ShaderLanguage.WGSL
          ? TERRAIN_FRAGMENT_UNIFORMS_WGSL
          : TERRAIN_FRAGMENT_UNIFORMS_GLSL,
    };
  }

  override getCustomCode(
    shaderType: string,
    lang: ShaderLanguage = ShaderLanguage.GLSL,
  ): Nullable<Record<string, string>> {
    if (shaderType !== 'fragment') return null;
    return terrainFragmentCode(lang === ShaderLanguage.WGSL);
  }

  override bindForSubMesh(ubo: UniformBuffer, scene: Scene): void {
    const p = this.look;
    const lv = this.levels;
    ubo.updateFloat4('terrainMap', 1 / lv.mapSize, 0, 0, 0);
    ubo.updateFloat4(
      'terrainTile',
      1 / p.fineTile,
      1 / p.coarseTile,
      p.coarseMix,
      p.posterSoftness,
    );
    ubo.updateFloat4('terrainLevels', lv.low, lv.river, lv.rockAbove, p.rockSlope);
    const ramp = rampUniforms({ ...p, bands: 3 });
    ubo.updateFloat4('terrainRamp', ramp.t1, ramp.t2, p.bandSoftness, p.shadowLevel);
    ubo.updateFloat4('terrainRamp2', ramp.mid, 0, 0, 0);

    const sun = findSunLight(scene);
    if (sun && sun.isEnabled()) {
      tmp.copyFrom(sun.direction).normalize().scaleInPlace(-1);
      ubo.updateFloat4('terrainSun', tmp.x, tmp.y, tmp.z, sun.intensity);
      const sc = sun.diffuse.toLinearSpaceToRef(tmpColor);
      ubo.updateFloat4('terrainSunColor', sc.r, sc.g, sc.b, 0);
    } else {
      ubo.updateFloat4('terrainSun', FALLBACK_SUN.x, FALLBACK_SUN.y, FALLBACK_SUN.z, sun ? 0 : 0.9);
      ubo.updateFloat4('terrainSunColor', 1, 1, 1, 0);
    }

    const hemi = scene.lights.find((l) => l instanceof HemisphericLight) as
      HemisphericLight | undefined;
    const k = (hemi ? (hemi.isEnabled() ? hemi.intensity : 0) : 0.6) * p.ambientStrength;
    const hemiDir = hemi ? tmp.copyFrom(hemi.direction).normalize() : UP;
    const sky = linear(p.ambientSky);
    const ground = linear(p.ambientGround);
    ubo.updateFloat4('terrainSky', sky.r * k, sky.g * k, sky.b * k, 0);
    ubo.updateFloat4('terrainGround', ground.r * k, ground.g * k, ground.b * k, 0);
    ubo.updateFloat4('terrainHemiDir', hemiDir.x, hemiDir.y, hemiDir.z, 0);

    const r = this.ramps;
    for (let i = 0; i < SPLAT_LAYERS.length; i++) {
      for (let s = 0; s < 6; s++) {
        const o = (i * 6 + s) * 4;
        const name = rampUniformName(i, s < 3 ? 'w' : 'h', (s % 3) as 0 | 1 | 2);
        ubo.updateFloat4(name, r[o]!, r[o + 1]!, r[o + 2]!, r[o + 3]!);
      }
    }
    ubo.setTexture(TERRAIN_CONTROL_SAMPLER, this.controlTexture);
    ubo.setTexture(TERRAIN_DETAIL_SAMPLER, this.detailTexture);
  }

  override getActiveTextures(active: BaseTexture[]): void {
    active.push(this.controlTexture, this.detailTexture);
  }
}

export class TerrainMaterial extends StandardMaterial {
  readonly splat: TerrainSplatPlugin;
  constructor(
    name: string,
    scene: Scene,
    control: BaseTexture,
    detail: BaseTexture,
    levels: TerrainLevels,
    look: Partial<TerrainLook> = {},
  ) {
    super(name, scene);
    this.specularColor = Color3.Black();
    this.splat = new TerrainSplatPlugin(this, control, detail, levels, look);
  }
}
