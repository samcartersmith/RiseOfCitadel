/**
 * Shader snippets the terrain splat plugin injects into StandardMaterial, in
 * GLSL (WebGL2) and WGSL (WebGPU). Same hook strategy as the toon shader
 * (render/shaders/toonShaderCode.ts):
 * - `CUSTOMUSERLIGHTING` records the sun's cascaded-shadow term and discards
 *   Babylon's own lighting sum;
 * - `CUSTOM_FRAGMENT_MAIN_BEGIN` does every texture fetch, at the top of main,
 *   so WGSL's uniformity rules allow implicit-derivative (mipmapped) sampling;
 * - `CUSTOM_FRAGMENT_BEFORE_FOG` blends the layers through their palette ramps
 *   and lights them with the toon ramp, so fog and image processing still run after.
 *
 * Layers (splatPalette.ts), painted in order: grass, forest floor (control B),
 * lane dirt (control R), base paving (control A), bank sand and riverbed (by
 * height below `low`), rock (by slope, or anything above the high ground).
 * Control G is the biome: 0 = Warden, 1 = Hollow.
 */
import { SPLAT_LAYERS, rampUniformName, type DetailChannel } from './splatPalette';

export const TERRAIN_BASE_UNIFORMS = [
  'terrainMap', // 1 / map size (scene units), unused ×3
  'terrainTile', // 1 / fine tile, 1 / coarse tile, coarse mix, posterize softness
  'terrainLevels', // low y, river y, rock-above y, slope where rock starts
  'terrainRamp', // toon ramp: t1, t2, softness, shadowLevel
  'terrainRamp2', // midLevel, unused ×3
  'terrainSun', // direction to the sun (xyz), intensity
  'terrainSunColor', // linear rgb, unused
  'terrainSky', // ambient sky, linear rgb × hemi intensity
  'terrainGround', // ambient ground, linear rgb × hemi intensity
  'terrainHemiDir', // hemispheric up (xyz)
] as const;

export const TERRAIN_RAMP_UNIFORMS: readonly string[] = SPLAT_LAYERS.flatMap((_, i) =>
  (['w', 'h'] as const).flatMap((b) => ([0, 1, 2] as const).map((s) => rampUniformName(i, b, s))),
);

export const TERRAIN_UNIFORMS: readonly string[] = [
  ...TERRAIN_BASE_UNIFORMS,
  ...TERRAIN_RAMP_UNIFORMS,
];

export const TERRAIN_CONTROL_SAMPLER = 'terrainControlSampler';
export const TERRAIN_DETAIL_SAMPLER = 'terrainDetailSampler';

const decl = (wgsl: boolean) =>
  TERRAIN_UNIFORMS.map((u) => (wgsl ? `uniform ${u}: vec4f;` : `uniform vec4 ${u};`)).join('\n');

export const TERRAIN_FRAGMENT_UNIFORMS_GLSL = `#ifdef CITADEL_TERRAIN\n${decl(false)}\n#endif\n`;
export const TERRAIN_FRAGMENT_UNIFORMS_WGSL = `#ifdef CITADEL_TERRAIN\n${decl(true)}\n#endif\n`;

/** Detail luminance variable for a channel (fine/coarse mixed; rock is biplanar). */
const lumaOf = (ch: DetailChannel) => (ch === 'a' ? 'terrainRockL' : `terrainDetail.${ch}`);

/** One layer's ramp colour expression. `u` prefixes uniforms (`uniforms.` in WGSL). */
function rampCall(i: number, u: string, g: string): string {
  const n = (b: 'w' | 'h', s: 0 | 1 | 2) => `${u}${rampUniformName(i, b, s)}`;
  return `terrainRampColor(${n('w', 0)}, ${n('w', 1)}, ${n('w', 2)}, ${n('h', 0)}, ${n('h', 1)}, ${n('h', 2)}, ${g}, ${lumaOf(SPLAT_LAYERS[i]!.channel)})`;
}

const layerIndex = (id: string) => SPLAT_LAYERS.findIndex((l) => l.id === id);

// ---------------------------------------------------------------------------- GLSL
function definitionsGlsl(): string {
  return /* glsl */ `
#ifdef CITADEL_TERRAIN
uniform sampler2D ${TERRAIN_CONTROL_SAMPLER};
uniform sampler2D ${TERRAIN_DETAIL_SAMPLER};

float terrainSunShadow = 1.0;
vec4 terrainCtrl = vec4(0.0);
vec4 terrainDetail = vec4(0.5);
float terrainRockL = 0.5;

vec3 computeCustomDiffuseLighting(lightingInfo info, vec3 diffuseBase, float shadow) {
  terrainSunShadow = min(terrainSunShadow, shadow);
  return vec3(0.0);
}
vec3 computeCustomSpecularLighting(lightingInfo info, vec3 specularBase, float shadow) {
  return vec3(0.0);
}

vec3 terrainRampColor(vec4 w0, vec4 w1, vec4 w2, vec4 h0, vec4 h1, vec4 h2, float g, float l) {
  float c = clamp(0.5 + (l - 0.5) * w0.a, 0.0, 1.0);
  // Soft posterise into 4 steps: painted bands instead of photo gradients.
  float b = c * 4.0;
  c = clamp((floor(b) + smoothstep(0.5 - terrainTile.w, 0.5 + terrainTile.w, fract(b))) / 4.0, 0.0, 1.0);
  vec3 lo = mix(w0.rgb, h0.rgb, g);
  vec3 mi = mix(w1.rgb, h1.rgb, g);
  vec3 hi = mix(w2.rgb, h2.rgb, g);
  return c < 0.5 ? mix(lo, mi, c * 2.0) : mix(mi, hi, c * 2.0 - 1.0);
}

// Height-aware blend: the layer bites in where its own detail is bright.
float terrainBite(float w, float d) {
  return smoothstep(0.4, 0.6, w + (d - 0.5) * 0.4);
}

float terrainBand(float x) {
  float w = max(terrainRamp.z, 1e-4);
  float b1 = smoothstep(terrainRamp.x - w, terrainRamp.x + w, x);
  float b2 = smoothstep(terrainRamp.y - w, terrainRamp.y + w, x);
  return mix(mix(terrainRamp.w, terrainRamp2.x, b1), 1.0, b2);
}
#endif
`;
}

function mainBeginGlsl(): string {
  return /* glsl */ `
#ifdef CITADEL_TERRAIN
{
  vec3 tp = vPositionW;
  terrainCtrl = texture2D(${TERRAIN_CONTROL_SAMPLER}, tp.xz * terrainMap.x + 0.5);
  vec4 fine = texture2D(${TERRAIN_DETAIL_SAMPLER}, tp.xz * terrainTile.x);
  vec4 coarse = texture2D(${TERRAIN_DETAIL_SAMPLER}, tp.xz * terrainTile.y + vec2(0.37, 0.71));
  terrainDetail = mix(fine, coarse, terrainTile.z);
  // Rock: biplanar on cliffs so it doesn't stretch down the faces.
  vec3 an = abs(normalize(vNormalW));
  float sx = texture2D(${TERRAIN_DETAIL_SAMPLER}, tp.zy * terrainTile.x).a;
  float sz = texture2D(${TERRAIN_DETAIL_SAMPLER}, tp.xy * terrainTile.x).a;
  float side = (sx * an.x + sz * an.z) / max(an.x + an.z, 1e-3);
  terrainRockL = mix(terrainDetail.a, side, smoothstep(0.3, 0.7, 1.0 - an.y));
}
#endif
`;
}

function beforeFogGlsl(): string {
  const r = (id: string) => rampCall(layerIndex(id), '', 'g');
  return /* glsl */ `
#ifdef CITADEL_TERRAIN
{
  vec3 n = normalW;
  float g = terrainCtrl.g;
  vec3 c = ${r('grass')};
  c = mix(c, ${r('forest')}, terrainBite(terrainCtrl.b, terrainDetail.r));
  c = mix(c, ${r('dirt')}, terrainBite(terrainCtrl.r, terrainDetail.g));
  c = mix(c, ${r('paving')}, terrainBite(terrainCtrl.a, terrainDetail.b));
  float depth = clamp((terrainLevels.x - vPositionW.y) / max(terrainLevels.x - terrainLevels.y, 1e-3), 0.0, 1.0);
  c = mix(c, ${r('sand')}, terrainBite(smoothstep(0.08, 0.35, depth), terrainDetail.b));
  c = mix(c, ${r('riverbed')}, smoothstep(0.45, 0.85, depth));
  float slope = 1.0 - n.y;
  float rockW = max(smoothstep(terrainLevels.w, terrainLevels.w + 0.12, slope + (terrainRockL - 0.5) * 0.12),
                    smoothstep(terrainLevels.z, terrainLevels.z + 0.6, vPositionW.y));
  c = mix(c, ${r('rock')}, rockW);

  float ndl = max(dot(n, terrainSun.xyz), 0.0);
  float band = terrainBand(ndl * terrainSunShadow);
  vec3 ambient = mix(terrainGround.rgb, terrainSky.rgb, dot(n, terrainHemiDir.xyz) * 0.5 + 0.5);
  vec3 lit = pow(max(c, vec3(0.0)), vec3(2.2)) * (ambient + terrainSunColor.rgb * terrainSun.w * band);
  color.rgb = pow(max(lit, vec3(0.0)), vec3(1.0 / 2.2));
}
#endif
`;
}

// ---------------------------------------------------------------------------- WGSL
function definitionsWgsl(): string {
  return /* wgsl */ `
#ifdef CITADEL_TERRAIN
var ${TERRAIN_CONTROL_SAMPLER}Sampler: sampler;
var ${TERRAIN_CONTROL_SAMPLER}: texture_2d<f32>;
var ${TERRAIN_DETAIL_SAMPLER}Sampler: sampler;
var ${TERRAIN_DETAIL_SAMPLER}: texture_2d<f32>;

var<private> terrainSunShadow: f32 = 1.0;
var<private> terrainCtrl: vec4f = vec4f(0.0);
var<private> terrainDetail: vec4f = vec4f(0.5);
var<private> terrainRockL: f32 = 0.5;

fn computeCustomDiffuseLighting(info: lightingInfo, diffuseBase: vec3f, shadow: f32) -> vec3f {
  terrainSunShadow = min(terrainSunShadow, shadow);
  return vec3f(0.0);
}
fn computeCustomSpecularLighting(info: lightingInfo, specularBase: vec3f, shadow: f32) -> vec3f {
  return vec3f(0.0);
}

fn terrainRampColor(w0: vec4f, w1: vec4f, w2: vec4f, h0: vec4f, h1: vec4f, h2: vec4f, g: f32, l: f32) -> vec3f {
  var c = clamp(0.5 + (l - 0.5) * w0.a, 0.0, 1.0);
  let b = c * 4.0;
  c = clamp((floor(b) + smoothstep(0.5 - uniforms.terrainTile.w, 0.5 + uniforms.terrainTile.w, fract(b))) / 4.0, 0.0, 1.0);
  let lo = mix(w0.rgb, h0.rgb, g);
  let mi = mix(w1.rgb, h1.rgb, g);
  let hi = mix(w2.rgb, h2.rgb, g);
  return select(mix(mi, hi, c * 2.0 - 1.0), mix(lo, mi, c * 2.0), c < 0.5);
}

fn terrainBite(w: f32, d: f32) -> f32 {
  return smoothstep(0.4, 0.6, w + (d - 0.5) * 0.4);
}

fn terrainBand(x: f32) -> f32 {
  let w = max(uniforms.terrainRamp.z, 1e-4);
  let b1 = smoothstep(uniforms.terrainRamp.x - w, uniforms.terrainRamp.x + w, x);
  let b2 = smoothstep(uniforms.terrainRamp.y - w, uniforms.terrainRamp.y + w, x);
  return mix(mix(uniforms.terrainRamp.w, uniforms.terrainRamp2.x, b1), 1.0, b2);
}
#endif
`;
}

function mainBeginWgsl(): string {
  const C = TERRAIN_CONTROL_SAMPLER;
  const D = TERRAIN_DETAIL_SAMPLER;
  return /* wgsl */ `
#ifdef CITADEL_TERRAIN
{
  let tp = fragmentInputs.vPositionW;
  terrainCtrl = textureSample(${C}, ${C}Sampler, tp.xz * uniforms.terrainMap.x + 0.5);
  let fine = textureSample(${D}, ${D}Sampler, tp.xz * uniforms.terrainTile.x);
  let coarse = textureSample(${D}, ${D}Sampler, tp.xz * uniforms.terrainTile.y + vec2f(0.37, 0.71));
  terrainDetail = mix(fine, coarse, uniforms.terrainTile.z);
  let an = abs(normalize(fragmentInputs.vNormalW));
  let sx = textureSample(${D}, ${D}Sampler, tp.zy * uniforms.terrainTile.x).a;
  let sz = textureSample(${D}, ${D}Sampler, tp.xy * uniforms.terrainTile.x).a;
  let side = (sx * an.x + sz * an.z) / max(an.x + an.z, 1e-3);
  terrainRockL = mix(terrainDetail.a, side, smoothstep(0.3, 0.7, 1.0 - an.y));
}
#endif
`;
}

function beforeFogWgsl(): string {
  const r = (id: string) => rampCall(layerIndex(id), 'uniforms.', 'g');
  return /* wgsl */ `
#ifdef CITADEL_TERRAIN
{
  let n = normalW;
  let g = terrainCtrl.g;
  let posY = fragmentInputs.vPositionW.y;
  var c = ${r('grass')};
  c = mix(c, ${r('forest')}, terrainBite(terrainCtrl.b, terrainDetail.r));
  c = mix(c, ${r('dirt')}, terrainBite(terrainCtrl.r, terrainDetail.g));
  c = mix(c, ${r('paving')}, terrainBite(terrainCtrl.a, terrainDetail.b));
  let depth = clamp((uniforms.terrainLevels.x - posY) / max(uniforms.terrainLevels.x - uniforms.terrainLevels.y, 1e-3), 0.0, 1.0);
  c = mix(c, ${r('sand')}, terrainBite(smoothstep(0.08, 0.35, depth), terrainDetail.b));
  c = mix(c, ${r('riverbed')}, smoothstep(0.45, 0.85, depth));
  let slope = 1.0 - n.y;
  let rockW = max(smoothstep(uniforms.terrainLevels.w, uniforms.terrainLevels.w + 0.12, slope + (terrainRockL - 0.5) * 0.12),
                  smoothstep(uniforms.terrainLevels.z, uniforms.terrainLevels.z + 0.6, posY));
  c = mix(c, ${r('rock')}, rockW);

  let ndl = max(dot(n, uniforms.terrainSun.xyz), 0.0);
  let band = terrainBand(ndl * terrainSunShadow);
  let ambient = mix(uniforms.terrainGround.rgb, uniforms.terrainSky.rgb, dot(n, uniforms.terrainHemiDir.xyz) * 0.5 + 0.5);
  let lit = pow(max(c, vec3f(0.0)), vec3f(2.2)) * (ambient + uniforms.terrainSunColor.rgb * uniforms.terrainSun.w * band);
  color = vec4f(pow(max(lit, vec3f(0.0)), vec3f(1.0 / 2.2)), color.a);
}
#endif
`;
}

export function terrainFragmentCode(wgsl: boolean): Record<string, string> {
  return wgsl
    ? {
        CUSTOM_FRAGMENT_DEFINITIONS: definitionsWgsl(),
        CUSTOM_FRAGMENT_MAIN_BEGIN: mainBeginWgsl(),
        CUSTOM_FRAGMENT_BEFORE_FOG: beforeFogWgsl(),
      }
    : {
        CUSTOM_FRAGMENT_DEFINITIONS: definitionsGlsl(),
        CUSTOM_FRAGMENT_MAIN_BEGIN: mainBeginGlsl(),
        CUSTOM_FRAGMENT_BEFORE_FOG: beforeFogGlsl(),
      };
}
