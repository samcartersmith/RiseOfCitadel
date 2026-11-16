import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { Rgb, UnitId } from './unitState';

export type RingKind = 'selected' | 'hover';

export interface RingEntry {
  id: UnitId;
  kind: RingKind;
  x: number;
  z: number;
  /** Ring radius in world units. */
  radius: number;
  color: Rgb;
  alpha: number;
}

/** Ground offset so rings don't z-fight the terrain. */
const RING_Y = 0.04;

/** Flat annulus in the XZ plane, outer radius 1. */
function ringGeometry(inner: number, segments: number): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    positions.push(s * inner, 0, c * inner, s, 0, c);
    normals.push(0, 1, 0, 0, 1, 0);
    if (i < segments) {
      const k = i * 2;
      indices.push(k, k + 1, k + 3, k, k + 3, k + 2);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.indices = indices;
  return vd;
}

/**
 * Selection and hover rings for every unit in ONE draw call: a thin-instanced
 * flat ring with per-instance colour (relation-tinted for selection, a faint
 * pale ring for hover). Zero instances → zero draw calls.
 */
export class RingRenderer {
  readonly mesh: Mesh;
  private capacity = 0;
  private matrices = new Float32Array(0);
  private colors = new Float32Array(0);
  private entries: RingEntry[] = [];

  constructor(scene: Scene) {
    this.mesh = new Mesh('unit-rings', scene);
    ringGeometry(0.84, 48).applyToMesh(this.mesh, false);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    const mat = new StandardMaterial('unit-rings', scene);
    mat.disableLighting = true;
    // Unlit: the output is emissive × per-instance colour.
    mat.diffuseColor = Color3.Black();
    mat.emissiveColor = Color3.White();
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    mat.zOffset = -2;
    this.mesh.material = mat;
    this.ensureCapacity(16);
    // Never drop to 0 instances: the material's INSTANCES/INSTANCESCOLOR defines are
    // computed from hasThinInstances and aren't refreshed when the count comes back.
    // An empty frame hides the mesh instead (0 draw calls either way).
    this.mesh.thinInstanceCount = 1;
    this.mesh.isVisible = false;
  }

  get count(): number {
    return this.entries.length;
  }

  /** Rings drawn for a unit this frame. */
  ringsFor(id: UnitId): RingKind[] {
    return this.entries.filter((e) => e.id === id).map((e) => e.kind);
  }

  setEntries(entries: RingEntry[]): void {
    this.entries = entries;
    this.ensureCapacity(entries.length);
    const m = this.matrices;
    const c = this.colors;
    entries.forEach((e, i) => {
      const o = i * 16;
      m[o] = e.radius;
      m[o + 5] = 1;
      m[o + 10] = e.radius;
      m[o + 12] = e.x;
      m[o + 13] = RING_Y;
      m[o + 14] = e.z;
      m[o + 15] = 1;
      const q = i * 4;
      c[q] = e.color[0];
      c[q + 1] = e.color[1];
      c[q + 2] = e.color[2];
      c[q + 3] = e.alpha;
    });
    this.mesh.thinInstanceBufferUpdated('matrix');
    this.mesh.thinInstanceBufferUpdated('color');
    this.mesh.thinInstanceCount = Math.max(1, entries.length);
    this.mesh.isVisible = entries.length > 0;
  }

  dispose(): void {
    this.mesh.material?.dispose();
    this.mesh.dispose();
  }

  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    let cap = Math.max(this.capacity, 16);
    while (cap < n) cap *= 2;
    this.capacity = cap;
    this.matrices = new Float32Array(cap * 16);
    this.colors = new Float32Array(cap * 4);
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
  }
}
