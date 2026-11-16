import '@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration';
import '@babylonjs/core/Shaders/ShadersInclude/instancesVertex';
import '@babylonjs/core/ShadersWGSL/ShadersInclude/instancesDeclaration';
import '@babylonjs/core/ShadersWGSL/ShadersInclude/instancesVertex';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { BarLayout } from './barMath';
import { UNIT_COLORS, type Rgb, type UnitId } from './unitState';

/** One unit's bar for this frame. */
export interface BarEntry {
  id: UnitId;
  /** World position of the bar anchor (above the unit's head). */
  x: number;
  y: number;
  z: number;
  hpFill: number;
  trailFill: number;
  /** Mana fill, or -1 for no mana row. */
  manaFill: number;
  /** Max HP for chunk ticks (heroes), 0 for none. */
  tickMaxHp: number;
  layout: BarLayout;
  color: Rgb;
  alpha: number;
}

/** Rendering group for bars: drawn after the world with a fresh depth buffer, so always on top. */
export const BAR_RENDERING_GROUP = 2;

const GLSL_VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec4 barA;
attribute vec4 barB;
attribute vec4 barC;
#include<instancesDeclaration>
uniform mat4 viewProjection;
uniform vec2 viewportPx;
uniform float pxScale;
varying vec2 vPx;
varying vec4 vA;
varying vec4 vB;
varying vec4 vC;
void main(void) {
#include<instancesVertex>
  vec4 clip = viewProjection * finalWorld * vec4(0.0, 0.0, 0.0, 1.0);
  float gap = barB.z > 0.0 ? 1.0 : 0.0;
  vec2 size = vec2(barB.x + 2.0, barB.y + barB.z + gap + 2.0);
  vec2 px = position.xy * size;
  vec2 offset = vec2(px.x - 0.5 * size.x, px.y + barB.w) * pxScale;
  clip.xy += offset * 2.0 / viewportPx * clip.w;
  if (clip.w <= 0.0 || barC.a <= 0.0) clip = vec4(2.0, 2.0, 2.0, 1.0);
  gl_Position = clip;
  vPx = vec2(px.x - 1.0, size.y - px.y - 1.0);
  vA = barA;
  vB = barB;
  vC = barC;
}
`;

const GLSL_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vPx;
varying vec4 vA;
varying vec4 vB;
varying vec4 vC;
uniform vec3 trailColor;
uniform vec3 manaColor;
uniform vec3 backColor;
void main(void) {
  float w = vB.x;
  float hh = vB.y;
  float mh = vB.z;
  float x = vPx.x;
  float y = vPx.y;
  vec3 col = vec3(0.02, 0.02, 0.025);
  if (x >= 0.0 && x < w) {
    float f = x / w;
    if (y >= 0.0 && y < hh) {
      if (f < vA.x) col = vC.rgb * (y < hh * 0.45 ? 1.15 : 0.9);
      else if (f < vA.y) col = trailColor;
      else col = backColor;
      if (vA.w > 0.0) {
        float spacing = w * 100.0 / vA.w;
        if (spacing >= 2.5 && x > 1.0 && mod(x, spacing) < 1.0) col *= 0.3;
      }
    } else if (mh > 0.0 && y >= hh + 1.0 && y < hh + 1.0 + mh) {
      col = f < vA.z ? manaColor * (y < hh + 1.0 + mh * 0.5 ? 1.15 : 0.9) : backColor;
    }
  }
  gl_FragColor = vec4(col, vC.a);
}
`;

const WGSL_VERTEX = /* wgsl */ `
attribute position : vec3<f32>;
attribute barA : vec4<f32>;
attribute barB : vec4<f32>;
attribute barC : vec4<f32>;
#include<instancesDeclaration>
uniform viewProjection : mat4x4<f32>;
uniform viewportPx : vec2<f32>;
uniform pxScale : f32;
varying vPx : vec2<f32>;
varying vA : vec4<f32>;
varying vB : vec4<f32>;
varying vC : vec4<f32>;
@vertex
fn main(input : VertexInputs) -> FragmentInputs {
#include<instancesVertex>
  let barB = vertexInputs.barB;
  var clip = uniforms.viewProjection * finalWorld * vec4<f32>(0.0, 0.0, 0.0, 1.0);
  var gap = 0.0;
  if (barB.z > 0.0) { gap = 1.0; }
  let size = vec2<f32>(barB.x + 2.0, barB.y + barB.z + gap + 2.0);
  let px = vertexInputs.position.xy * size;
  let offset = vec2<f32>(px.x - 0.5 * size.x, px.y + barB.w) * uniforms.pxScale;
  clip = vec4<f32>(clip.xy + offset * 2.0 / uniforms.viewportPx * clip.w, clip.z, clip.w);
  if (clip.w <= 0.0 || vertexInputs.barC.a <= 0.0) { clip = vec4<f32>(2.0, 2.0, 2.0, 1.0); }
  vertexOutputs.position = clip;
  vertexOutputs.vPx = vec2<f32>(px.x - 1.0, size.y - px.y - 1.0);
  vertexOutputs.vA = vertexInputs.barA;
  vertexOutputs.vB = barB;
  vertexOutputs.vC = vertexInputs.barC;
}
`;

const WGSL_FRAGMENT = /* wgsl */ `
varying vPx : vec2<f32>;
varying vA : vec4<f32>;
varying vB : vec4<f32>;
varying vC : vec4<f32>;
uniform trailColor : vec3<f32>;
uniform manaColor : vec3<f32>;
uniform backColor : vec3<f32>;
@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
  let vA = fragmentInputs.vA;
  let vB = fragmentInputs.vB;
  let w = vB.x;
  let hh = vB.y;
  let mh = vB.z;
  let x = fragmentInputs.vPx.x;
  let y = fragmentInputs.vPx.y;
  var col = vec3<f32>(0.02, 0.02, 0.025);
  if (x >= 0.0 && x < w) {
    let f = x / w;
    if (y >= 0.0 && y < hh) {
      if (f < vA.x) {
        col = fragmentInputs.vC.rgb * select(0.9, 1.15, y < hh * 0.45);
      } else if (f < vA.y) {
        col = uniforms.trailColor;
      } else {
        col = uniforms.backColor;
      }
      if (vA.w > 0.0) {
        let spacing = w * 100.0 / vA.w;
        if (spacing >= 2.5 && x > 1.0 && (x - spacing * floor(x / spacing)) < 1.0) { col = col * 0.3; }
      }
    } else if (mh > 0.0 && y >= hh + 1.0 && y < hh + 1.0 + mh) {
      if (f < vA.z) {
        col = uniforms.manaColor * select(0.9, 1.15, y < hh + 1.0 + mh * 0.5);
      } else {
        col = uniforms.backColor;
      }
    }
  }
  fragmentOutputs.color = vec4<f32>(col, fragmentInputs.vC.a);
}
`;

const v3 = (c: Rgb) => new Vector3(c[0], c[1], c[2]);

/**
 * All HP/mana bars in ONE draw call: a unit quad thin-instanced once per
 * visible unit, expanded in the vertex shader to a constant pixel size at the
 * projected anchor (so bars always face the camera and ignore zoom). The
 * fragment shader draws the frame, fill, damage trail, 100-HP chunk ticks and
 * the mana row from per-instance data. See docs/design/units.md §3.
 */
export class BarRenderer {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private capacity = 0;
  private matrices = new Float32Array(0);
  private a = new Float32Array(0);
  private b = new Float32Array(0);
  private c = new Float32Array(0);
  private entries: BarEntry[] = [];
  private byId = new Map<UnitId, BarEntry>();
  private readonly scene: Scene;
  private readonly viewport = new Vector2(1, 1);

  constructor(scene: Scene) {
    this.scene = scene;
    const engine = scene.getEngine();
    const wgsl = engine.isWebGPU;
    this.mesh = new Mesh('unit-bars', scene);
    const vd = new VertexData();
    vd.positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    vd.indices = [0, 1, 2, 0, 2, 3];
    vd.applyToMesh(this.mesh, true);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true; // bounds are meaningless for screen-space quads
    this.mesh.renderingGroupId = BAR_RENDERING_GROUP;
    this.mesh.doNotSyncBoundingInfo = true;

    this.material = new ShaderMaterial(
      'unit-bars',
      scene,
      wgsl
        ? { vertexSource: WGSL_VERTEX, fragmentSource: WGSL_FRAGMENT }
        : { vertexSource: GLSL_VERTEX, fragmentSource: GLSL_FRAGMENT },
      {
        attributes: ['position', 'barA', 'barB', 'barC'],
        uniforms: [
          'world',
          'viewProjection',
          'viewportPx',
          'pxScale',
          'trailColor',
          'manaColor',
          'backColor',
        ],
        needAlphaBlending: true,
        shaderLanguage: wgsl ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
      },
    );
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.depthFunction = Constants.ALWAYS;
    this.material.alphaMode = Constants.ALPHA_COMBINE;
    this.material.setVector3('trailColor', v3(UNIT_COLORS.trail));
    this.material.setVector3('manaColor', v3(UNIT_COLORS.mana));
    this.material.setVector3('backColor', v3(UNIT_COLORS.barBack));
    this.mesh.material = this.material;
    this.ensureCapacity(64);
    this.mesh.thinInstanceCount = 1; // see RingRenderer: keep the INSTANCES define stable
    this.mesh.isVisible = false;
  }

  /** Number of bars drawn this frame. */
  get count(): number {
    return this.entries.length;
  }

  /** The bar written for a unit this frame (tests/debug), or undefined if hidden. */
  entry(id: UnitId): Readonly<BarEntry> | undefined {
    return this.byId.get(id);
  }

  /**
   * Upload this frame's bars. Sorted back-to-front by camera depth so nearer
   * bars draw over farther ones. `entries` is not retained beyond the next call.
   */
  setEntries(entries: BarEntry[]): void {
    const eng = this.scene.getEngine();
    const w = eng.getRenderWidth();
    const css = eng.getRenderingCanvas()?.clientWidth || w;
    this.viewport.set(w, eng.getRenderHeight());
    this.material.setVector2('viewportPx', this.viewport);
    this.material.setFloat('pxScale', w / css);
    const cam = this.scene.activeCamera;
    if (cam) {
      const p = cam.globalPosition;
      const d = (e: BarEntry) => (e.x - p.x) ** 2 + (e.y - p.y) ** 2 + (e.z - p.z) ** 2;
      entries.sort((l, r) => d(r) - d(l));
    }
    this.entries = entries;
    this.byId.clear();
    this.ensureCapacity(entries.length);
    const { matrices: m, a, b, c } = this;
    entries.forEach((e, i) => {
      this.byId.set(e.id, e);
      const o = i * 16;
      m[o + 12] = e.x;
      m[o + 13] = e.y;
      m[o + 14] = e.z;
      const q = i * 4;
      a[q] = e.hpFill;
      a[q + 1] = Math.max(e.hpFill, e.trailFill);
      a[q + 2] = e.manaFill;
      a[q + 3] = e.tickMaxHp;
      b[q] = e.layout.width;
      b[q + 1] = e.layout.hpHeight;
      b[q + 2] = e.manaFill >= 0 ? e.layout.manaHeight : 0;
      b[q + 3] = e.layout.lift;
      c[q] = e.color[0];
      c[q + 1] = e.color[1];
      c[q + 2] = e.color[2];
      c[q + 3] = e.alpha;
    });
    this.mesh.thinInstanceBufferUpdated('matrix');
    this.mesh.thinInstanceBufferUpdated('barA');
    this.mesh.thinInstanceBufferUpdated('barB');
    this.mesh.thinInstanceBufferUpdated('barC');
    this.mesh.thinInstanceCount = Math.max(1, entries.length);
    this.mesh.isVisible = entries.length > 0;
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }

  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    let cap = Math.max(this.capacity, 64);
    while (cap < n) cap *= 2;
    this.capacity = cap;
    this.matrices = new Float32Array(cap * 16);
    for (let i = 0; i < cap; i++) {
      // Identity rotation/scale; only the translation column is written per frame.
      this.matrices[i * 16] = 1;
      this.matrices[i * 16 + 5] = 1;
      this.matrices[i * 16 + 10] = 1;
      this.matrices[i * 16 + 15] = 1;
    }
    this.a = new Float32Array(cap * 4);
    this.b = new Float32Array(cap * 4);
    this.c = new Float32Array(cap * 4);
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer('barA', this.a, 4, false);
    this.mesh.thinInstanceSetBuffer('barB', this.b, 4, false);
    this.mesh.thinInstanceSetBuffer('barC', this.c, 4, false);
  }
}
