/**
 * Shader snippets the Citadel toon plugin injects into StandardMaterial, in
 * GLSL (WebGL2) and WGSL (WebGPU). Both versions must stay in sync; the maths
 * is mirrored on the CPU in toonParams.ts (`toonRamp`) and palette.ts (`luma`).
 *
 * How it hooks in (no Babylon internals are forked):
 * - `CUSTOMUSERLIGHTING` swaps the per-light accumulation in lightFragment for
 *   our `computeCustomDiffuseLighting`, which only records the smallest shadow
 *   term (the sun's cascaded shadow; other lights report 1) and adds nothing.
 *   Babylon keeps doing all the shadow-map sampling, so High-tier shadows and
 *   the shadows-off fallback (shadow = 1) work unchanged.
 * - `CUSTOM_FRAGMENT_BEFORE_FOG` replaces the lit colour with the toon result,
 *   so fog, image processing (Low-tier in-material tonemapping) and alpha still
 *   run after it.
 * Skinning, instances, thin instances, clip planes and fog are StandardMaterial
 * features and need nothing here.
 */

/** UBO members, all vec4 to keep std140 packing trivial. */
export const TOON_UNIFORMS = [
  'toonRamp', // t1, t2, softness, shadowLevel
  'toonRamp2', // midLevel, paletteStrength, rimWidth, rimSoftness
  'toonSun', // direction to the sun (xyz), intensity
  'toonSunColor', // linear rgb, rimLightInfluence
  'toonSky', // ambient sky, linear rgb × hemi intensity, unused
  'toonGround', // ambient ground, linear rgb × hemi intensity, unused
  'toonHemiDir', // hemispheric "up" (xyz), unused
  'toonRimColor', // linear rgb, intensity
  'toonHeight', // base, range, strength, 1 if the base texture samples linear (sRGB buffer)
  'toonHeightTint', // linear rgb, unused
  'toonTeamColor', // gamma rgb (blended into the albedo), strength
  'toonTeamRect0',
  'toonTeamRect1',
  'toonTeamRect2',
  'toonTeamRect3',
] as const;

export const TOON_SAMPLER = 'toonPaletteSampler';

const uniformDeclGlsl = TOON_UNIFORMS.map((u) => `uniform vec4 ${u};`).join('\n');
const uniformDeclWgsl = TOON_UNIFORMS.map((u) => `uniform ${u}: vec4f;`).join('\n');

export const TOON_FRAGMENT_UNIFORMS_GLSL = `#ifdef CITADEL_TOON\n${uniformDeclGlsl}\n#endif\n`;
export const TOON_FRAGMENT_UNIFORMS_WGSL = `#ifdef CITADEL_TOON\n${uniformDeclWgsl}\n#endif\n`;

// ---------------------------------------------------------------------------- GLSL
const definitionsGlsl = /* glsl */ `
#ifdef CITADEL_TOON
uniform sampler2D ${TOON_SAMPLER};

// Smallest shadow term over all lights = the sun's (only it has a shadow map).
float toonSunShadow = 1.0;

vec3 computeCustomDiffuseLighting(lightingInfo info, vec3 diffuseBase, float shadow) {
  toonSunShadow = min(toonSunShadow, shadow);
  return vec3(0.0);
}
vec3 computeCustomSpecularLighting(lightingInfo info, vec3 specularBase, float shadow) {
  return vec3(0.0);
}

float toonInRect(vec2 uv, vec4 r) {
  vec2 inside = step(r.xy, uv) * step(uv, r.zw);
  return inside.x * inside.y;
}

float toonTeamMask(vec2 uv) {
  return clamp(toonInRect(uv, toonTeamRect0) + toonInRect(uv, toonTeamRect1)
    + toonInRect(uv, toonTeamRect2) + toonInRect(uv, toonTeamRect3), 0.0, 1.0);
}

float toonBand(float x) {
  float w = max(toonRamp.z, 1e-4);
  float b1 = smoothstep(toonRamp.x - w, toonRamp.x + w, x);
  float b2 = smoothstep(toonRamp.y - w, toonRamp.y + w, x);
  float r = mix(toonRamp.w, toonRamp2.x, b1);
  return mix(r, 1.0, b2);
}

vec3 citadelToonShade(vec3 albedoIn, vec3 n, vec3 v, vec3 posW, vec2 uv, float sunShadow) {
  // glTF base colours load into sRGB buffers and sample linear; work in gamma.
  vec3 albedo = toonHeight.w > 0.5 ? pow(max(albedoIn, vec3(0.0)), vec3(1.0 / 2.2)) : albedoIn;
  // Palette gradient-map: look the texel's luma up in the palette LUT.
  float l = dot(albedo, vec3(0.299, 0.587, 0.114));
  vec3 mapped = texture2D(${TOON_SAMPLER}, vec2(clamp(l, 0.0, 1.0), 0.5)).rgb;
  vec3 c = mix(albedo, mapped, toonRamp2.y);

  // Team colour on masked atlas swatches, keeping the swatch's light-dark gradient.
  float m = toonTeamMask(uv) * toonTeamColor.a;
  c = mix(c, toonTeamColor.rgb * (0.6 + 0.7 * l), m);

  // Ramp-lit sun (cast shadows fall into the lower bands) + hemispheric ambient.
  float ndl = max(dot(n, toonSun.xyz), 0.0);
  float band = toonBand(ndl * sunShadow);
  vec3 ambient = mix(toonGround.rgb, toonSky.rgb, dot(n, toonHemiDir.xyz) * 0.5 + 0.5);
  // Lighting runs in linear space (like PBR), so the bands read the same as
  // the untouched originals; the result goes back to gamma for StandardMaterial.
  vec3 lit = pow(max(c, vec3(0.0)), vec3(2.2)) * (ambient + toonSunColor.rgb * toonSun.w * band);

  // Height gradient: darker toward the feet, in world space.
  float h = clamp((posW.y - toonHeight.x) / max(toonHeight.y, 1e-3), 0.0, 1.0);
  lit *= mix(mix(vec3(1.0), toonHeightTint.rgb, toonHeight.z), vec3(1.0), h);

  // Rim light on the silhouette, stronger on the sunny side.
  float fres = 1.0 - clamp(dot(n, v), 0.0, 1.0);
  float rim = smoothstep(1.0 - toonRamp2.z, 1.0 - toonRamp2.z + toonRamp2.w, fres);
  rim *= mix(1.0, band, toonSunColor.a);
  lit += toonRimColor.rgb * toonRimColor.a * rim;
  return pow(max(lit, vec3(0.0)), vec3(1.0 / 2.2));
}
#endif
`;

const beforeFogGlsl = /* glsl */ `
#ifdef CITADEL_TOON
{
  vec2 toonUV = vec2(0.0);
#ifdef DIFFUSE
  toonUV = vDiffuseUV;
#endif
  color.rgb = citadelToonShade(baseColor.rgb * diffuseColor, normalW, viewDirectionW, vPositionW, toonUV, toonSunShadow) + emissiveColor;
}
#endif
`;

// ---------------------------------------------------------------------------- WGSL
const definitionsWgsl = /* wgsl */ `
#ifdef CITADEL_TOON
var ${TOON_SAMPLER}Sampler: sampler;
var ${TOON_SAMPLER}: texture_2d<f32>;

var<private> toonSunShadow: f32 = 1.0;

fn computeCustomDiffuseLighting(info: lightingInfo, diffuseBase: vec3f, shadow: f32) -> vec3f {
  toonSunShadow = min(toonSunShadow, shadow);
  return vec3f(0.0);
}
fn computeCustomSpecularLighting(info: lightingInfo, specularBase: vec3f, shadow: f32) -> vec3f {
  return vec3f(0.0);
}

fn toonInRect(uv: vec2f, r: vec4f) -> f32 {
  let inside = step(r.xy, uv) * step(uv, r.zw);
  return inside.x * inside.y;
}

fn toonTeamMask(uv: vec2f) -> f32 {
  return clamp(toonInRect(uv, uniforms.toonTeamRect0) + toonInRect(uv, uniforms.toonTeamRect1)
    + toonInRect(uv, uniforms.toonTeamRect2) + toonInRect(uv, uniforms.toonTeamRect3), 0.0, 1.0);
}

fn toonBand(x: f32) -> f32 {
  let w = max(uniforms.toonRamp.z, 1e-4);
  let b1 = smoothstep(uniforms.toonRamp.x - w, uniforms.toonRamp.x + w, x);
  let b2 = smoothstep(uniforms.toonRamp.y - w, uniforms.toonRamp.y + w, x);
  let r = mix(uniforms.toonRamp.w, uniforms.toonRamp2.x, b1);
  return mix(r, 1.0, b2);
}

fn citadelToonShade(albedoIn: vec3f, n: vec3f, v: vec3f, posW: vec3f, uv: vec2f, sunShadow: f32) -> vec3f {
  let albedo = select(albedoIn, pow(max(albedoIn, vec3f(0.0)), vec3f(1.0 / 2.2)), uniforms.toonHeight.w > 0.5);
  let l = dot(albedo, vec3f(0.299, 0.587, 0.114));
  let mapped = textureSampleLevel(${TOON_SAMPLER}, ${TOON_SAMPLER}Sampler, vec2f(clamp(l, 0.0, 1.0), 0.5), 0.0).rgb;
  var c = mix(albedo, mapped, uniforms.toonRamp2.y);

  let m = toonTeamMask(uv) * uniforms.toonTeamColor.a;
  c = mix(c, uniforms.toonTeamColor.rgb * (0.6 + 0.7 * l), m);

  let ndl = max(dot(n, uniforms.toonSun.xyz), 0.0);
  let band = toonBand(ndl * sunShadow);
  let ambient = mix(uniforms.toonGround.rgb, uniforms.toonSky.rgb, dot(n, uniforms.toonHemiDir.xyz) * 0.5 + 0.5);
  var lit = pow(max(c, vec3f(0.0)), vec3f(2.2)) * (ambient + uniforms.toonSunColor.rgb * uniforms.toonSun.w * band);

  let h = clamp((posW.y - uniforms.toonHeight.x) / max(uniforms.toonHeight.y, 1e-3), 0.0, 1.0);
  lit *= mix(mix(vec3f(1.0), uniforms.toonHeightTint.rgb, uniforms.toonHeight.z), vec3f(1.0), h);

  let fres = 1.0 - clamp(dot(n, v), 0.0, 1.0);
  var rim = smoothstep(1.0 - uniforms.toonRamp2.z, 1.0 - uniforms.toonRamp2.z + uniforms.toonRamp2.w, fres);
  rim *= mix(1.0, band, uniforms.toonSunColor.a);
  lit += uniforms.toonRimColor.rgb * uniforms.toonRimColor.a * rim;
  return pow(max(lit, vec3f(0.0)), vec3f(1.0 / 2.2));
}
#endif
`;

const beforeFogWgsl = /* wgsl */ `
#ifdef CITADEL_TOON
{
  var toonUV = vec2f(0.0);
#ifdef DIFFUSE
  toonUV = fragmentInputs.vDiffuseUV;
#endif
  color = vec4f(citadelToonShade(baseColor.rgb * diffuseColor, normalW, viewDirectionW, fragmentInputs.vPositionW, toonUV, toonSunShadow) + emissiveColor, color.a);
}
#endif
`;

export function toonFragmentCode(wgsl: boolean): Record<string, string> {
  return wgsl
    ? { CUSTOM_FRAGMENT_DEFINITIONS: definitionsWgsl, CUSTOM_FRAGMENT_BEFORE_FOG: beforeFogWgsl }
    : { CUSTOM_FRAGMENT_DEFINITIONS: definitionsGlsl, CUSTOM_FRAGMENT_BEFORE_FOG: beforeFogGlsl };
}
