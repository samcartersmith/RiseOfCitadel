/**
 * Shader snippets the water plugin injects into StandardMaterial, in GLSL
 * (WebGL2) and WGSL (WebGPU). Same hook strategy as the toon and terrain
 * shaders (render/shaders/toonShaderCode.ts, map/terrain/terrainShaderCode.ts):
 * - two vertex attributes (`waterData`, `waterFlow`) are passed through as
 *   varyings: river-space position, water depth, flow speed and direction;
 * - `CUSTOMUSERLIGHTING` records the sun's cascaded-shadow term (High) and
 *   discards Babylon's own lighting sum;
 * - `CUSTOM_FRAGMENT_BEFORE_FOG` shades the water, so fog, image processing
 *   (Low-tier in-material tonemapping) and alpha still run after it.
 *
 * No textures: the ripples, streaks and foam break-up are value noise, so the
 * water costs no download and WGSL's uniformity rules never come into play.
 * The flow is a two-phase flow map in river space (riverPath.ts `flowPhases`).
 */

export const WATER_UNIFORMS = [
  'waterTime', // time (s), flow period (s), ribbon half-width (world), deep depth (world)
  'waterShallow', // gamma rgb, shallow alpha
  'waterDeep', // gamma rgb, deep alpha
  'waterFoam', // gamma rgb, foam depth (world)
  'waterStreak', // gamma rgb, streak strength
  'waterGlow', // gamma rgb, glow intensity
  'waterSkyTint', // gamma rgb, fresnel strength
  'waterSpec', // ripple strength, spec threshold (cos), spec strength, band softness
  'waterRamp', // toon ramp: t1, t2, softness, shadowLevel
  'waterRamp2', // midLevel, unused ×3
  'waterSun', // direction to the sun (xyz), intensity
  'waterSunColor', // linear rgb, unused
  'waterSky', // ambient sky, linear rgb × hemi intensity
  'waterGround', // ambient ground, linear rgb × hemi intensity
  'waterHemiDir', // hemispheric up (xyz)
] as const;

export const WATER_ATTRIBUTES = ['waterData', 'waterFlow'] as const;

const decl = (wgsl: boolean) =>
  WATER_UNIFORMS.map((u) => (wgsl ? `uniform ${u}: vec4f;` : `uniform vec4 ${u};`)).join('\n');

export const WATER_FRAGMENT_UNIFORMS_GLSL = `#ifdef CITADEL_WATER\n${decl(false)}\n#endif\n`;
export const WATER_FRAGMENT_UNIFORMS_WGSL = `#ifdef CITADEL_WATER\n${decl(true)}\n#endif\n`;

// ---------------------------------------------------------------------------- GLSL
const VERTEX_DEFS_GLSL = /* glsl */ `
#ifdef CITADEL_WATER
attribute vec4 waterData;
attribute vec2 waterFlow;
varying vec4 vWaterData;
varying vec2 vWaterFlow;
#endif
`;

const VERTEX_END_GLSL = /* glsl */ `
#ifdef CITADEL_WATER
vWaterData = waterData;
vWaterFlow = waterFlow;
#endif
`;

const FRAGMENT_DEFS_GLSL = /* glsl */ `
#ifdef CITADEL_WATER
varying vec4 vWaterData;
varying vec2 vWaterFlow;
float waterSunShadow = 1.0;

vec3 computeCustomDiffuseLighting(lightingInfo info, vec3 diffuseBase, float shadow) {
  waterSunShadow = min(waterSunShadow, shadow);
  return vec3(0.0);
}
vec3 computeCustomSpecularLighting(lightingInfo info, vec3 specularBase, float shadow) {
  return vec3(0.0);
}

// Sine-free hash (stable precision on mobile GPUs).
float waterHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float waterNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = waterHash(i);
  float b = waterHash(i + vec2(1.0, 0.0));
  float c = waterHash(i + vec2(0.0, 1.0));
  float d = waterHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Blend the two flow phases; rescale so the contrast doesn't dip mid-blend.
float waterPhaseMix(float n0, float n1, float w0) {
  float w1 = 1.0 - w0;
  return (n0 * w0 + n1 * w1 - 0.5) * inversesqrt(w0 * w0 + w1 * w1) + 0.5;
}
float waterBand(float x) {
  float w = max(waterRamp.z, 1e-4);
  float b1 = smoothstep(waterRamp.x - w, waterRamp.x + w, x);
  float b2 = smoothstep(waterRamp.y - w, waterRamp.y + w, x);
  return mix(mix(waterRamp.w, waterRamp2.x, b1), 1.0, b2);
}
#endif
`;

const BEFORE_FOG_GLSL = /* glsl */ `
#ifdef CITADEL_WATER
{
  float T = waterTime.x;
  float P = waterTime.y;
  float depth = vWaterData.z;
  float speed = vWaterData.w;
  // River space, world units: (across, along the flow).
  vec2 q = vec2(vWaterData.x * waterTime.z, vWaterData.y);
  // Two-phase flow map (riverPath.ts flowPhases).
  float c0 = T / P;
  float c1 = c0 + 0.5;
  float ph0 = fract(c0);
  float ph1 = fract(c1);
  float w0 = 1.0 - abs(1.0 - 2.0 * ph0);
  vec2 j0 = mod(floor(c0), 16.0) * vec2(3.7, 5.3);
  vec2 j1 = mod(floor(c1), 16.0) * vec2(3.7, 5.3) + vec2(0.5, 0.37);
  vec2 q0 = q - vec2(0.0, speed * P * ph0);
  vec2 q1 = q - vec2(0.0, speed * P * ph1);
  float streakN = waterPhaseMix(waterNoise(q0 * vec2(1.6, 0.09) + j0), waterNoise(q1 * vec2(1.6, 0.09) + j1), w0);
  // Calm the high-frequency detail with distance so far water doesn't sparkle into noise.
  float far = smoothstep(80.0, 170.0, length(vEyePosition.xyz - vPositionW));
  float rip = waterPhaseMix(waterNoise(q0 * vec2(1.3, 0.6) + j0.yx), waterNoise(q1 * vec2(1.3, 0.6) + j1.yx), w0);

  // Depth tint, softly posterised into 3 bands.
  float dd = clamp(depth / waterTime.w, 0.0, 1.0);
  float db = dd * 3.0;
  dd = clamp((floor(db) + smoothstep(0.5 - waterSpec.w, 0.5 + waterSpec.w, fract(db))) / 3.0, 0.0, 1.0);
  vec3 c = mix(waterShallow.rgb, waterDeep.rgb, dd);

  // Flow streaks, kept off the shallows.
  float streak = smoothstep(0.66, 0.71, streakN) * smoothstep(0.15, 0.45, depth / waterTime.w) * (1.0 - 0.6 * far);
  c = mix(c, waterStreak.rgb, streak * waterStreak.a);

  // Shoreline foam: a band from the waterline, broken up by drifting noise and lapping in and out.
  float foamN = waterNoise(vec2(q.x * 0.9, q.y * 0.35 - T * 0.2));
  float lap = 0.5 + 0.5 * sin(T * 1.3 + q.y * 0.4);
  float edge = depth / max(waterFoam.a, 1e-3) + (foamN - 0.5) * 0.7 - lap * 0.3;
  float foam = 1.0 - smoothstep(0.7, 0.8, edge);
  float ring = (1.0 - smoothstep(0.06, 0.12, abs(edge - 1.35 - lap * 0.35))) * step(0.5, foamN) * (1.0 - far);
  foam = max(foam, ring * 0.7);
  c = mix(c, waterFoam.rgb, foam);

  // Ripple normal: tilt "up" along and across the flow.
  vec3 fdir = normalize(vec3(vWaterFlow.x, 0.0, vWaterFlow.y));
  vec3 left = vec3(-fdir.z, 0.0, fdir.x);
  vec2 slope = (vec2(rip, streakN) - 0.5) * 2.0 * waterSpec.x;
  vec3 n = normalize(vec3(0.0, 1.0, 0.0) + fdir * slope.x + left * slope.y);
  vec3 v = viewDirectionW;

  // Toon lighting: banded sun on the flat surface, hard specular glints, a fresnel band.
  float ndl = max(waterSun.y, 0.0);
  float band = waterBand(ndl * waterSunShadow);
  vec3 ambient = mix(waterGround.rgb, waterSky.rgb, waterHemiDir.y * 0.5 + 0.5);
  vec3 sunLight = waterSunColor.rgb * waterSun.w;
  vec3 lit = pow(max(c, vec3(0.0)), vec3(2.2)) * (ambient + sunLight * band);
  float nh = dot(n, normalize(waterSun.xyz + v));
  float glint = smoothstep(waterSpec.y, waterSpec.y + 0.003, nh) * waterSunShadow * (1.0 - foam) * (1.0 - far);
  lit += sunLight * glint * waterSpec.z;
  // Fresnel from a gently rippled normal: a clean band, not blotches.
  float fr = 1.0 - clamp(dot(normalize(vec3(0.0, 1.0, 0.0) + (fdir * slope.x + left * slope.y) * 0.25), v), 0.0, 1.0);
  float fband = smoothstep(0.42, 0.48, fr) * waterSkyTint.a * (1.0 - foam);
  lit = mix(lit, pow(waterSkyTint.rgb, vec3(2.2)) * (ambient + sunLight * 0.5), fband * 0.5);
  // Raw-light glow, strongest in the deep channel so the depth still reads at night.
  lit += pow(waterGlow.rgb, vec3(2.2)) * waterGlow.a * mix(0.45, 1.0, dd) * (1.0 - foam * 0.6);

  float a = mix(waterShallow.a, waterDeep.a, dd);
  a = max(a, max(foam * 0.95, glint));
  a *= smoothstep(0.0, 0.03, depth);
  color = vec4(pow(max(lit, vec3(0.0)), vec3(1.0 / 2.2)), a);
}
#endif
`;

// ---------------------------------------------------------------------------- WGSL
const VERTEX_DEFS_WGSL = /* wgsl */ `
#ifdef CITADEL_WATER
attribute waterData: vec4f;
attribute waterFlow: vec2f;
varying vWaterData: vec4f;
varying vWaterFlow: vec2f;
#endif
`;

const VERTEX_END_WGSL = /* wgsl */ `
#ifdef CITADEL_WATER
vertexOutputs.vWaterData = input.waterData;
vertexOutputs.vWaterFlow = input.waterFlow;
#endif
`;

const FRAGMENT_DEFS_WGSL = /* wgsl */ `
#ifdef CITADEL_WATER
varying vWaterData: vec4f;
varying vWaterFlow: vec2f;
var<private> waterSunShadow: f32 = 1.0;

fn computeCustomDiffuseLighting(info: lightingInfo, diffuseBase: vec3f, shadow: f32) -> vec3f {
  waterSunShadow = min(waterSunShadow, shadow);
  return vec3f(0.0);
}
fn computeCustomSpecularLighting(info: lightingInfo, specularBase: vec3f, shadow: f32) -> vec3f {
  return vec3f(0.0);
}

fn waterHash(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + vec3f(dot(p3, p3.yzx + vec3f(33.33)));
  return fract((p3.x + p3.y) * p3.z);
}
fn waterNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (vec2f(3.0) - 2.0 * f);
  let a = waterHash(i);
  let b = waterHash(i + vec2f(1.0, 0.0));
  let c = waterHash(i + vec2f(0.0, 1.0));
  let d = waterHash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn waterPhaseMix(n0: f32, n1: f32, w0: f32) -> f32 {
  let w1 = 1.0 - w0;
  return (n0 * w0 + n1 * w1 - 0.5) * inverseSqrt(w0 * w0 + w1 * w1) + 0.5;
}
fn waterBand(x: f32) -> f32 {
  let w = max(uniforms.waterRamp.z, 1e-4);
  let b1 = smoothstep(uniforms.waterRamp.x - w, uniforms.waterRamp.x + w, x);
  let b2 = smoothstep(uniforms.waterRamp.y - w, uniforms.waterRamp.y + w, x);
  return mix(mix(uniforms.waterRamp.w, uniforms.waterRamp2.x, b1), 1.0, b2);
}
#endif
`;

const BEFORE_FOG_WGSL = /* wgsl */ `
#ifdef CITADEL_WATER
{
  let wd = fragmentInputs.vWaterData;
  let T = uniforms.waterTime.x;
  let P = uniforms.waterTime.y;
  let depth = wd.z;
  let speed = wd.w;
  let q = vec2f(wd.x * uniforms.waterTime.z, wd.y);
  let c0 = T / P;
  let c1 = c0 + 0.5;
  let ph0 = fract(c0);
  let ph1 = fract(c1);
  let w0 = 1.0 - abs(1.0 - 2.0 * ph0);
  let j0 = (floor(c0) % 16.0) * vec2f(3.7, 5.3);
  let j1 = (floor(c1) % 16.0) * vec2f(3.7, 5.3) + vec2f(0.5, 0.37);
  let q0 = q - vec2f(0.0, speed * P * ph0);
  let q1 = q - vec2f(0.0, speed * P * ph1);
  let streakN = waterPhaseMix(waterNoise(q0 * vec2f(1.6, 0.09) + j0), waterNoise(q1 * vec2f(1.6, 0.09) + j1), w0);
  let far = smoothstep(80.0, 170.0, length(scene.vEyePosition.xyz - fragmentInputs.vPositionW));
  let rip = waterPhaseMix(waterNoise(q0 * vec2f(1.3, 0.6) + j0.yx), waterNoise(q1 * vec2f(1.3, 0.6) + j1.yx), w0);

  var dd = clamp(depth / uniforms.waterTime.w, 0.0, 1.0);
  let db = dd * 3.0;
  dd = clamp((floor(db) + smoothstep(0.5 - uniforms.waterSpec.w, 0.5 + uniforms.waterSpec.w, fract(db))) / 3.0, 0.0, 1.0);
  var c = mix(uniforms.waterShallow.rgb, uniforms.waterDeep.rgb, dd);

  let streak = smoothstep(0.66, 0.71, streakN) * smoothstep(0.15, 0.45, depth / uniforms.waterTime.w) * (1.0 - 0.6 * far);
  c = mix(c, uniforms.waterStreak.rgb, streak * uniforms.waterStreak.a);

  let foamN = waterNoise(vec2f(q.x * 0.9, q.y * 0.35 - T * 0.2));
  let lap = 0.5 + 0.5 * sin(T * 1.3 + q.y * 0.4);
  let edge = depth / max(uniforms.waterFoam.a, 1e-3) + (foamN - 0.5) * 0.7 - lap * 0.3;
  var foam = 1.0 - smoothstep(0.7, 0.8, edge);
  let ring = (1.0 - smoothstep(0.06, 0.12, abs(edge - 1.35 - lap * 0.35))) * step(0.5, foamN) * (1.0 - far);
  foam = max(foam, ring * 0.7);
  c = mix(c, uniforms.waterFoam.rgb, foam);

  let fdir = normalize(vec3f(fragmentInputs.vWaterFlow.x, 0.0, fragmentInputs.vWaterFlow.y));
  let left = vec3f(-fdir.z, 0.0, fdir.x);
  let slope = (vec2f(rip, streakN) - vec2f(0.5)) * 2.0 * uniforms.waterSpec.x;
  let n = normalize(vec3f(0.0, 1.0, 0.0) + fdir * slope.x + left * slope.y);
  let v = viewDirectionW;

  let ndl = max(uniforms.waterSun.y, 0.0);
  let band = waterBand(ndl * waterSunShadow);
  let ambient = mix(uniforms.waterGround.rgb, uniforms.waterSky.rgb, uniforms.waterHemiDir.y * 0.5 + 0.5);
  let sunLight = uniforms.waterSunColor.rgb * uniforms.waterSun.w;
  var lit = pow(max(c, vec3f(0.0)), vec3f(2.2)) * (ambient + sunLight * band);
  let nh = dot(n, normalize(uniforms.waterSun.xyz + v));
  let glint = smoothstep(uniforms.waterSpec.y, uniforms.waterSpec.y + 0.003, nh) * waterSunShadow * (1.0 - foam) * (1.0 - far);
  lit = lit + sunLight * glint * uniforms.waterSpec.z;
  let fr = 1.0 - clamp(dot(normalize(vec3f(0.0, 1.0, 0.0) + (fdir * slope.x + left * slope.y) * 0.25), v), 0.0, 1.0);
  let fband = smoothstep(0.42, 0.48, fr) * uniforms.waterSkyTint.a * (1.0 - foam);
  lit = mix(lit, pow(uniforms.waterSkyTint.rgb, vec3f(2.2)) * (ambient + sunLight * 0.5), fband * 0.5);
  lit = lit + pow(uniforms.waterGlow.rgb, vec3f(2.2)) * uniforms.waterGlow.a * mix(0.45, 1.0, dd) * (1.0 - foam * 0.6);

  var a = mix(uniforms.waterShallow.a, uniforms.waterDeep.a, dd);
  a = max(a, max(foam * 0.95, glint));
  a = a * smoothstep(0.0, 0.03, depth);
  color = vec4f(pow(max(lit, vec3f(0.0)), vec3f(1.0 / 2.2)), a);
}
#endif
`;

export function waterShaderCode(shaderType: string, wgsl: boolean): Record<string, string> | null {
  if (shaderType === 'vertex') {
    return {
      CUSTOM_VERTEX_DEFINITIONS: wgsl ? VERTEX_DEFS_WGSL : VERTEX_DEFS_GLSL,
      CUSTOM_VERTEX_MAIN_END: wgsl ? VERTEX_END_WGSL : VERTEX_END_GLSL,
    };
  }
  if (shaderType === 'fragment') {
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: wgsl ? FRAGMENT_DEFS_WGSL : FRAGMENT_DEFS_GLSL,
      CUSTOM_FRAGMENT_BEFORE_FOG: wgsl ? BEFORE_FOG_WGSL : BEFORE_FOG_GLSL,
    };
  }
  return null;
}
