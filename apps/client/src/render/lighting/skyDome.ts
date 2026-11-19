/**
 * Gradient sky dome that follows the time of day. One draw call: a low-poly
 * hemisphere (plus a skirt below the horizon) with per-vertex colours for the
 * zenith → horizon gradient, multiplied by a grayscale cloud mask baked from
 * the Poly Haven HDRI (tools/assets/sky-env.ts). Plain StandardMaterial with
 * lighting off, so it runs on WebGL2 and WebGPU with no custom shader; only
 * the colour vertex buffer changes with `t`.
 *
 * The MOBA camera looks ~55° down and never sees the horizon; the dome shows
 * in low/free cameras and wherever the view runs past the map edge.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { linearToGamma, type LightingPalette } from './keyframes';

export interface SkyDome {
  mesh: Mesh;
  material: StandardMaterial;
  update(p: LightingPalette): void;
  dispose(): void;
}

const SEGMENTS = 32;
/** Open-sky value of the baked cloud mask (tools/assets/sky-env.ts). */
const CLOUD_FLOOR = 0.72;
/** Elevation rings in degrees, from below the horizon up to the zenith. */
const RINGS = [-30, -6, 0, 6, 14, 26, 42, 62, 90];

export function createSkyDome(scene: Scene, cloudsUrl: string | null, radius = 450): SkyDome {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const heights: number[] = []; // 0 at/below the horizon … 1 at the zenith, per vertex
  for (let r = 0; r < RINGS.length; r++) {
    const el = (RINGS[r]! * Math.PI) / 180;
    for (let s = 0; s <= SEGMENTS; s++) {
      const az = (s / SEGMENTS) * Math.PI * 2;
      positions.push(
        Math.sin(az) * Math.cos(el) * radius,
        Math.sin(el) * radius,
        Math.cos(az) * Math.cos(el) * radius,
      );
      // Cloud mask rows run zenith (top, v = 1 with invertY) → horizon (v = 0).
      uvs.push(s / SEGMENTS, Math.max(0, RINGS[r]!) / 90);
      heights.push(Math.max(0, RINGS[r]!) / 90);
    }
  }
  const row = SEGMENTS + 1;
  for (let r = 0; r < RINGS.length - 1; r++) {
    for (let s = 0; s < SEGMENTS; s++) {
      const a = r * row + s;
      const b = a + row;
      // Wound to face inward (the camera is inside).
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const mesh = new Mesh('sky-dome', scene);
  // Parented so scene-wide "every root mesh casts" loops (main.ts placeholder wiring) skip it.
  const root = new TransformNode('lighting', scene);
  mesh.parent = root;
  const vd = new VertexData();
  vd.positions = positions;
  vd.uvs = uvs;
  vd.indices = indices;
  vd.colors = new Array<number>((positions.length / 3) * 4).fill(1);
  vd.applyToMesh(mesh, false);
  mesh.setVerticesData(VertexBuffer.ColorKind, vd.colors, true);
  mesh.infiniteDistance = true;
  mesh.applyFog = false;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;

  const material = new StandardMaterial('sky-dome', scene);
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = Color3.White(); // final = emissive × texture × vertex colour
  if (cloudsUrl) {
    const tex = new Texture(cloudsUrl, scene, true, true, Texture.BILINEAR_SAMPLINGMODE);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    material.diffuseTexture = tex;
  }
  material.disableDepthWrite = true;
  mesh.material = material;
  mesh.renderingGroupId = 0;
  mesh.alphaIndex = -1;

  const colors = new Float32Array((positions.length / 3) * 4);
  // The cloud mask is CLOUD_FLOOR in open sky and 1 in clouds: dividing the gradient by the
  // floor keeps open sky exactly on the keyframe colours and lifts clouds above them.
  const gain = cloudsUrl ? 1 / CLOUD_FLOOR : 1;
  return {
    mesh,
    material,
    update(p) {
      const z = linearToGamma(p.skyZenith);
      const h = linearToGamma(p.skyHorizon);
      for (let i = 0; i < heights.length; i++) {
        // Ease toward the zenith so the warm horizon band stays thin.
        const k = Math.pow(heights[i]!, 0.6);
        const below = positions[i * 3 + 1]! < 0 ? 0.75 : 1; // darker skirt under the horizon
        for (let c = 0; c < 3; c++)
          colors[i * 4 + c] = (h[c]! + (z[c]! - h[c]!) * k) * below * gain;
        colors[i * 4 + 3] = 1;
      }
      mesh.updateVerticesData(VertexBuffer.ColorKind, colors);
    },
    dispose() {
      material.diffuseTexture?.dispose();
      material.dispose();
      mesh.dispose();
      root.dispose();
    },
  };
}
