/**
 * CitadelToonMaterial: the one stylized material every unit, structure and
 * prop uses (art direction §1.2). It is a StandardMaterial with a material
 * plugin, so Babylon still provides skinning, instances, thin instances,
 * shadows, fog, clip planes and image processing on both WebGL2 (GLSL) and
 * WebGPU (native WGSL, no glslang/twgsl download). The plugin swaps the
 * lighting for a banded sun + hemispheric ambient, a rim light, a world-space
 * height gradient, a palette gradient-map and a team-colour mask.
 *
 * Parameters live on `material.toon` and are uniforms: changing them never
 * recompiles the shader. Docs: docs/design/toon-shader.md.
 */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Nullable } from '@babylonjs/core/types';
import { findSunLight } from '../shadows';
import { buildPaletteLut, CITADEL_RAMP_STOPS, PALETTE_LUT_SIZE, type RampStop } from './palette';
import { packTeamRects, type UvRect } from './teamMask';
import { DEFAULT_TOON_PARAMS, rampUniforms, type ToonParams } from './toonParams';
import {
  TOON_FRAGMENT_UNIFORMS_GLSL,
  TOON_FRAGMENT_UNIFORMS_WGSL,
  TOON_SAMPLER,
  TOON_UNIFORMS,
  toonFragmentCode,
} from './toonShaderCode';

const paletteTextures = new WeakMap<Scene, RawTexture>();

/**
 * The palette gradient-map LUT for a scene (256 × 1 RGBA, built in code from
 * the art-direction palette). Shared by every toon material in the scene.
 */
export function getPaletteLut(scene: Scene): RawTexture {
  let tex = paletteTextures.get(scene);
  if (!tex) {
    tex = createPaletteLut(scene, CITADEL_RAMP_STOPS);
    paletteTextures.set(scene, tex);
    tex.onDisposeObservable.addOnce(() => paletteTextures.delete(scene));
  }
  return tex;
}

/** Builds a LUT texture from custom ramp stops (e.g. a per-zone palette). */
export function createPaletteLut(scene: Scene, stops: readonly RampStop[]): RawTexture {
  const tex = new RawTexture(
    buildPaletteLut(stops, PALETTE_LUT_SIZE),
    PALETTE_LUT_SIZE,
    1,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  tex.name = 'citadel-palette-lut';
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

const FALLBACK_SUN = new Vector3(0.4, 1, -0.6).normalize();
const UP = new Vector3(0, 1, 0);
const tmpDir = new Vector3();
const tmpColor = new Color3();

/**
 * The plugin that turns a StandardMaterial into the toon material. Use
 * CitadelToonMaterial rather than attaching it by hand.
 */
export class CitadelToonPlugin extends MaterialPluginBase {
  /** Ramp, rim, height, palette and team parameters (plain data; edit freely). */
  readonly params: ToonParams;
  /** Team-mask UV rectangles (max 4). */
  teamRects: readonly UvRect[] = [];
  /** Gradient-map LUT. Defaults to the scene's shared palette LUT. */
  paletteTexture: RawTexture;

  private readonly colors = {
    sky: new Color3(),
    ground: new Color3(),
    rim: new Color3(),
    heightTint: new Color3(),
    team: new Color3(),
  };
  private readonly colorKeys: Record<keyof CitadelToonPlugin['colors'], string> = {
    sky: '',
    ground: '',
    rim: '',
    heightTint: '',
    team: '',
  };

  constructor(material: StandardMaterial, params: Partial<ToonParams> = {}) {
    super(material, 'CitadelToon', 200, { CITADEL_TOON: false, CUSTOMUSERLIGHTING: false });
    this.params = { ...DEFAULT_TOON_PARAMS, ...params };
    this.paletteTexture = getPaletteLut(material.getScene());
    this._enable(true);
  }

  override getClassName(): string {
    return 'CitadelToonPlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL || shaderLanguage === ShaderLanguage.WGSL;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['CITADEL_TOON'] = true;
    defines['CUSTOMUSERLIGHTING'] = true;
  }

  override isReadyForSubMesh(): boolean {
    return this.paletteTexture.isReady();
  }

  override getSamplers(samplers: string[]): void {
    samplers.push(TOON_SAMPLER);
  }

  override getUniforms(shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL) {
    return {
      ubo: TOON_UNIFORMS.map((name) => ({ name, size: 4, type: 'vec4' })),
      fragment:
        shaderLanguage === ShaderLanguage.WGSL
          ? TOON_FRAGMENT_UNIFORMS_WGSL
          : TOON_FRAGMENT_UNIFORMS_GLSL,
    };
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Nullable<Record<string, string>> {
    if (shaderType !== 'fragment') return null;
    return toonFragmentCode(shaderLanguage === ShaderLanguage.WGSL);
  }

  /** Re-parses a hex colour only when it changed (bind runs every frame). */
  private color(key: keyof CitadelToonPlugin['colors'], hex: string, linear = true): Color3 {
    const c = this.colors[key];
    if (this.colorKeys[key] !== hex) {
      const parsed = Color3.FromHexString(hex);
      c.copyFrom(linear ? parsed.toLinearSpace() : parsed);
      this.colorKeys[key] = hex;
    }
    return c;
  }

  override bindForSubMesh(ubo: UniformBuffer, scene: Scene): void {
    const p = this.params;
    const ramp = rampUniforms(p);
    ubo.updateFloat4('toonRamp', ramp.t1, ramp.t2, p.bandSoftness, p.shadowLevel);
    ubo.updateFloat4('toonRamp2', ramp.mid, p.paletteStrength, p.rimWidth, p.rimSoftness);

    // Sun: the same light the shadow generator uses.
    const sun = findSunLight(scene);
    if (sun && sun.isEnabled()) {
      tmpDir.copyFrom(sun.direction).normalize().scaleInPlace(-1);
      ubo.updateFloat4('toonSun', tmpDir.x, tmpDir.y, tmpDir.z, sun.intensity);
      const sc = sun.diffuse.toLinearSpaceToRef(tmpColor);
      ubo.updateFloat4('toonSunColor', sc.r, sc.g, sc.b, p.rimLightInfluence);
    } else {
      ubo.updateFloat4('toonSun', FALLBACK_SUN.x, FALLBACK_SUN.y, FALLBACK_SUN.z, sun ? 0 : 0.9);
      ubo.updateFloat4('toonSunColor', 1, 1, 1, p.rimLightInfluence);
    }

    // Hemispheric ambient: our palette colours scaled by the scene's hemi light.
    const hemi = scene.lights.find((l) => l instanceof HemisphericLight) as
      HemisphericLight | undefined;
    const hemiIntensity =
      (hemi ? (hemi.isEnabled() ? hemi.intensity : 0) : 0.6) * p.ambientStrength;
    const hemiDir = hemi ? tmpDir.copyFrom(hemi.direction).normalize() : UP;
    const sky = this.color('sky', p.ambientSky);
    const ground = this.color('ground', p.ambientGround);
    ubo.updateFloat4(
      'toonSky',
      sky.r * hemiIntensity,
      sky.g * hemiIntensity,
      sky.b * hemiIntensity,
      0,
    );
    ubo.updateFloat4(
      'toonGround',
      ground.r * hemiIntensity,
      ground.g * hemiIntensity,
      ground.b * hemiIntensity,
      0,
    );
    ubo.updateFloat4('toonHemiDir', hemiDir.x, hemiDir.y, hemiDir.z, 0);

    const rim = this.color('rim', p.rimColor);
    ubo.updateFloat4('toonRimColor', rim.r, rim.g, rim.b, p.rimIntensity);
    ubo.updateFloat4(
      'toonHeight',
      p.heightBase,
      p.heightRange,
      p.heightStrength,
      this.diffuseIsLinear() ? 1 : 0,
    );
    const ht = this.color('heightTint', p.heightTint);
    ubo.updateFloat4('toonHeightTint', ht.r, ht.g, ht.b, 0);

    const team = this.color('team', p.teamColor ?? '#000000', false);
    ubo.updateFloat4('toonTeamColor', team.r, team.g, team.b, p.teamColor ? p.teamStrength : 0);
    const rects = packTeamRects(this.teamRects);
    rects.forEach((r, i) => ubo.updateFloat4(`toonTeamRect${i}`, r[0], r[1], r[2], r[3]));

    ubo.setTexture(TOON_SAMPLER, this.paletteTexture);
  }

  /**
   * glTF base-colour textures load into sRGB buffers, so the GPU hands the
   * shader linear values; StandardMaterial expects gamma. The shader undoes it.
   */
  private diffuseIsLinear(): boolean {
    const tex = (this._material as StandardMaterial).diffuseTexture as
      (BaseTexture & { _useSRGBBuffer?: boolean }) | null;
    if (!tex) return false;
    return !!(tex._useSRGBBuffer ?? tex.getInternalTexture()?._useSRGBBuffer);
  }

  override getActiveTextures(activeTextures: BaseTexture[]): void {
    activeTextures.push(this.paletteTexture);
  }
}

export interface CitadelToonMaterialOptions {
  params?: Partial<ToonParams>;
  teamRects?: readonly UvRect[];
}

/**
 * The shared toon material. Set the base colour through `diffuseTexture`
 * (KayKit palette atlases) and/or `diffuseColor`; tune the look through
 * `material.toon.params`.
 */
export class CitadelToonMaterial extends StandardMaterial {
  readonly toon: CitadelToonPlugin;

  constructor(name: string, scene: Scene, options: CitadelToonMaterialOptions = {}) {
    super(name, scene);
    this.specularColor = Color3.Black();
    this.toon = new CitadelToonPlugin(this, options.params);
    if (options.teamRects) this.toon.teamRects = options.teamRects;
  }
}
