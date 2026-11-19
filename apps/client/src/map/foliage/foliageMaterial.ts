/**
 * Foliage materials: the shared Citadel toon material (so trees light like
 * units and structures) plus FoliageWindPlugin, a second material plugin
 * that adds vertex-shader wind in GLSL and WGSL. Colour comes from vertex
 * colours baked by treeGeometry.ts, so there is no texture to sample.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { Nullable } from '@babylonjs/core/types';
import { CitadelToonMaterial } from '../../render/shaders/citadelToonMaterial';
import {
  WIND_UNIFORMS,
  WIND_VERTEX_UNIFORMS_GLSL,
  WIND_VERTEX_UNIFORMS_WGSL,
  windVertexCode,
} from './windShaderCode';

/** Scene-wide wind, shared by every foliage material. Mutate freely (uniforms only). */
export interface WindState {
  /** Normalised direction on the ground plane. */
  dirX: number;
  dirZ: number;
  /** Seconds; advanced by the foliage system each frame. */
  time: number;
  /** Global multiplier on every material's amplitude (0 = still). */
  strength: number;
}

export interface WindParams {
  /** Model-space height of the mesh (sway weight reaches 1 here). */
  modelHeight: number;
  /** Crown displacement as a fraction of the model height. */
  amplitude: number;
  /** Sway angular frequency, rad/s. */
  frequency: number;
  /** Constant lean downwind, in units of the sway amplitude. */
  lean: number;
  /** Per-instance brightness jitter (0.12 = ±6%). */
  colorJitter: number;
}

export class FoliageWindPlugin extends MaterialPluginBase {
  constructor(
    material: StandardMaterial,
    readonly wind: WindState,
    readonly params: WindParams,
  ) {
    super(material, 'FoliageWind', 210, { CITADEL_WIND: false });
    this._enable(true);
  }

  override getClassName(): string {
    return 'FoliageWindPlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL || shaderLanguage === ShaderLanguage.WGSL;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['CITADEL_WIND'] = true;
  }

  override getUniforms(shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL) {
    return {
      ubo: WIND_UNIFORMS.map((name) => ({ name, size: 4, type: 'vec4' })),
      vertex:
        shaderLanguage === ShaderLanguage.WGSL
          ? WIND_VERTEX_UNIFORMS_WGSL
          : WIND_VERTEX_UNIFORMS_GLSL,
    };
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Nullable<Record<string, string>> {
    if (shaderType !== 'vertex') return null;
    return windVertexCode(shaderLanguage === ShaderLanguage.WGSL);
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    const p = this.params;
    const w = this.wind;
    ubo.updateFloat4(
      'foliageWind',
      w.dirX,
      w.dirZ,
      p.amplitude * p.modelHeight * w.strength,
      w.time,
    );
    ubo.updateFloat4('foliageWind2', 1 / p.modelHeight, p.frequency, p.lean, p.colorJitter);
  }
}

export interface FoliageMaterial extends CitadelToonMaterial {
  readonly wind: FoliageWindPlugin;
}

/** A vertex-coloured toon material with wind. */
export function createFoliageMaterial(
  name: string,
  scene: Scene,
  wind: WindState,
  params: WindParams,
  opts: { twoSided?: boolean } = {},
): FoliageMaterial {
  const mat = new CitadelToonMaterial(name, scene, {
    params: {
      // Colours are already palette-mapped by treeGeometry.ts; keep them.
      paletteStrength: 0,
      // Ground occlusion is baked into the vertex colours (terrain height varies).
      heightStrength: 0,
      rimIntensity: 0.35,
    },
  }) as FoliageMaterial;
  mat.diffuseColor = Color3.White();
  if (opts.twoSided) {
    mat.backFaceCulling = false;
    mat.twoSidedLighting = true;
  }
  (mat as { wind: FoliageWindPlugin }).wind = new FoliageWindPlugin(mat, wind, params);
  return mat;
}
