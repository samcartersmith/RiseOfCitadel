/**
 * Vertex-shader wind for foliage (M1-07), injected into the toon material by
 * FoliageWindPlugin in GLSL (WebGL2) and WGSL (WebGPU). Both versions must
 * stay in sync (windShaderCode.test.ts checks the hooks and uniforms).
 *
 * - Sway is applied to the world position after the instance transform
 *   (`CUSTOM_VERTEX_UPDATE_WORLDPOS`), weighted by the vertex's model-space
 *   height squared, so trunks stay put and canopies move.
 * - The phase comes from a hash of the instance's world translation, so no
 *   per-instance attribute is needed and neighbouring trees never sway in step.
 * - The offset scales with the instance's own scale, so a hidden tree
 *   (collapsed matrix, see foliage/index.ts) stays collapsed.
 * - `CUSTOM_VERTEX_MAIN_END` jitters the vertex colour per instance (±w/2)
 *   so a grove of one species doesn't read as copies.
 */

export const WIND_UNIFORMS = [
  'foliageWind', // dir.x, dir.z, amplitude (model units at the crown), time (s)
  'foliageWind2', // 1 / model height, frequency (rad/s), lean bias, colour jitter
] as const;

const declGlsl = WIND_UNIFORMS.map((u) => `uniform vec4 ${u};`).join('\n');
const declWgsl = WIND_UNIFORMS.map((u) => `uniform ${u}: vec4f;`).join('\n');

export const WIND_VERTEX_UNIFORMS_GLSL = `#ifdef CITADEL_WIND\n${declGlsl}\n#endif\n`;
export const WIND_VERTEX_UNIFORMS_WGSL = `#ifdef CITADEL_WIND\n${declWgsl}\n#endif\n`;

const definitionsGlsl = /* glsl */ `
#ifdef CITADEL_WIND
float citadelWindHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
#endif
`;

const worldPosGlsl = /* glsl */ `
#ifdef CITADEL_WIND
{
  vec3 windBase = finalWorld[3].xyz;
  float windScale = length(finalWorld[1].xyz);
  float windH = clamp(positionUpdated.y * foliageWind2.x, 0.0, 1.0);
  float windW = windH * windH;
  float windPhase = citadelWindHash(windBase.xz) * 6.2831853;
  float windT = foliageWind.w * foliageWind2.y;
  float windGust = 0.65 + 0.35 * sin(foliageWind.w * 0.37 + dot(windBase.xz, vec2(0.021, 0.013)));
  float windSway = sin(windT + windPhase) * 0.75 + sin(windT * 2.31 + windPhase * 1.7) * 0.25;
  vec2 windDir = foliageWind.xy;
  vec2 windOff = windDir * (windSway + foliageWind2.z) * windGust
    + vec2(-windDir.y, windDir.x) * sin(windT * 1.73 + windPhase * 2.3) * 0.3;
  worldPos.xz += windOff * foliageWind.z * windW * windScale;
}
#endif
`;

const mainEndGlsl = /* glsl */ `
#if defined(CITADEL_WIND) && defined(VERTEXCOLOR)
  vColor.rgb *= 1.0 + (citadelWindHash(finalWorld[3].xz + vec2(17.0, 31.0)) - 0.5) * foliageWind2.w;
#endif
`;

const definitionsWgsl = /* wgsl */ `
#ifdef CITADEL_WIND
fn citadelWindHash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}
#endif
`;

const worldPosWgsl = /* wgsl */ `
#ifdef CITADEL_WIND
{
  let windBase = finalWorld[3].xyz;
  let windScale = length(finalWorld[1].xyz);
  let windH = clamp(positionUpdated.y * uniforms.foliageWind2.x, 0.0, 1.0);
  let windW = windH * windH;
  let windPhase = citadelWindHash(windBase.xz) * 6.2831853;
  let windT = uniforms.foliageWind.w * uniforms.foliageWind2.y;
  let windGust = 0.65 + 0.35 * sin(uniforms.foliageWind.w * 0.37 + dot(windBase.xz, vec2f(0.021, 0.013)));
  let windSway = sin(windT + windPhase) * 0.75 + sin(windT * 2.31 + windPhase * 1.7) * 0.25;
  let windDir = uniforms.foliageWind.xy;
  let windOff = windDir * (windSway + uniforms.foliageWind2.z) * windGust
    + vec2f(-windDir.y, windDir.x) * sin(windT * 1.73 + windPhase * 2.3) * 0.3;
  let windD = windOff * uniforms.foliageWind.z * windW * windScale;
  worldPos = vec4f(worldPos.x + windD.x, worldPos.y, worldPos.z + windD.y, worldPos.w);
}
#endif
`;

const mainEndWgsl = /* wgsl */ `
#if defined(CITADEL_WIND) && defined(VERTEXCOLOR)
  vertexOutputs.vColor = vec4f(vertexOutputs.vColor.rgb * (1.0 + (citadelWindHash(finalWorld[3].xz + vec2f(17.0, 31.0)) - 0.5) * uniforms.foliageWind2.w), vertexOutputs.vColor.a);
#endif
`;

export function windVertexCode(wgsl: boolean): Record<string, string> {
  return wgsl
    ? {
        CUSTOM_VERTEX_DEFINITIONS: definitionsWgsl,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: worldPosWgsl,
        CUSTOM_VERTEX_MAIN_END: mainEndWgsl,
      }
    : {
        CUSTOM_VERTEX_DEFINITIONS: definitionsGlsl,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: worldPosGlsl,
        CUSTOM_VERTEX_MAIN_END: mainEndGlsl,
      };
}

/** CPU mirror of the sway weight: 0 at the ground, 1 at the crown (tests and docs). */
export function windWeight(modelY: number, modelHeight: number): number {
  const h = Math.min(1, Math.max(0, modelY / modelHeight));
  return h * h;
}
