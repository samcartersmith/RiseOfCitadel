import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import {
  DECAL_CELLS,
  cellUv,
  coneScaleX,
  decalQuadExtents,
  type DecalCell,
  type DecalShape,
} from './atlasLayout';
import { MAX_TELEGRAPHS_PER_SHAPE } from './budget';
import { INTENT_STYLES, hexToRgb, type Intent, type IntentStyle } from './intents';
import { yawFromDirection } from './path';
import { Pool } from './pool';
import {
  makeTiming,
  pulseFactor,
  telegraphFrame,
  type TelegraphFrame,
  type TelegraphTiming,
} from './telegraphTiming';

export type TelegraphShape = DecalShape;
export const TELEGRAPH_SHAPES: readonly TelegraphShape[] = [
  'circle',
  'ring',
  'cone',
  'line',
  'crack',
];

export interface TelegraphOptions {
  shape: TelegraphShape;
  /** Centre (circle, ring, crack) or origin (cone apex, line start) on the ground. */
  at: { x: number; z: number };
  /** Circle/ring/crack radius, and the cone's length when `length` is omitted. */
  radius?: number;
  /** Cone or line length. */
  length?: number;
  /** Line width. */
  width?: number;
  /** Cone full angle in radians (default 60°). */
  angle?: number;
  /** Facing (radians about +Y, 0 = +Z). `direction` wins when both are given. */
  yaw?: number;
  direction?: { x: number; z: number };
  /** Colour language; see intents.ts. Default `damage` (`neutral` for cracks). */
  intent?: Intent;
  /** Overrides the intent colours (cracks and one-off decals). */
  color?: string;
  /** Seconds for the fill to reach the edge (e.g. Crucible Drop's 1 s delay). 0 = instant. */
  fillTime?: number;
  /** Seconds to stay up after filling. Infinity = until `stop()`. */
  hold?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Fires once, the frame the fill completes (or immediately for instant decals). */
  onFilled?: () => void;
}

/** Decal heights above the ground plane (y = 0 until M1-05 terrain lands). */
const Y = { crack: 0.03, back: 0.04, fill: 0.045, edge: 0.05 } as const;
const BASE_ALPHA_INDEX = 1000;

export class Telegraph {
  serial = 0;
  shape: TelegraphShape = 'circle';
  x = 0;
  z = 0;
  yaw = 0;
  sx = 1;
  sz = 1;
  style: IntentStyle = INTENT_STYLES.damage;
  readonly edgeRgb: [number, number, number] = [1, 1, 1];
  readonly fillRgb: [number, number, number] = [1, 1, 1];
  timing: TelegraphTiming = makeTiming();
  age = 0;
  stoppedAt: number | undefined = undefined;
  onFilled: (() => void) | null = null;
  filledFired = false;
  readonly frame: TelegraphFrame = { fill: 0, alpha: 0, flash: 0, phase: 'filling' };

  get alive(): boolean {
    return this.frame.phase !== 'done';
  }

  /** Ends the hold now and fades out. Safe to call on a finished telegraph. */
  stop(): void {
    if (this.alive && this.stoppedAt === undefined) this.stoppedAt = this.age;
  }
}

interface Layer {
  mesh: Mesh;
  matrices: Float32Array;
  colors: Float32Array;
  capacity: number;
  count: number;
}

const tmpScale = new Vector3();
const tmpPos = new Vector3();
const tmpQuat = new Quaternion();
const tmpMat = new Matrix();

function buildQuad(name: string, shape: DecalShape, cell: DecalCell, scene: Scene): Mesh {
  const { x0, x1, z0, z1 } = decalQuadExtents(shape);
  const uv = cellUv(DECAL_CELLS[cell]);
  const data = new VertexData();
  data.positions = [x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1];
  data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  data.uvs = [uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1];
  data.indices = [0, 2, 1, 0, 3, 2];
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  return mesh;
}

/**
 * Ground telegraphs. Every decal of a given shape and layer is one thin
 * instance of a shared quad, so all telegraphs together cost at most nine
 * draw calls (fill + edge per shape, plus cracks) however many are up.
 */
export class TelegraphRenderer {
  private readonly material: StandardMaterial;
  private readonly fill = new Map<TelegraphShape, Layer>();
  private readonly edge = new Map<TelegraphShape, Layer>();
  private readonly layers: Layer[] = [];
  private readonly pools = new Map<TelegraphShape, Pool<Telegraph>>();
  private readonly active: Telegraph[] = [];
  private readonly scratch: Telegraph[] = [];
  private time = 0;
  private serial = 0;

  constructor(scene: Scene, atlas: Texture) {
    const mat = new StandardMaterial('vfx-decal', scene);
    mat.diffuseTexture = atlas;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.diffuseColor = Color3.White();
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    // Intent colours are a gameplay language: keep them exact, untouched by the
    // in-material tonemap/grade the Low tier applies to world materials.
    const ip = new ImageProcessingConfiguration();
    ip.isEnabled = false;
    mat.imageProcessingConfiguration = ip;
    this.material = mat;

    const cells: Record<Exclude<TelegraphShape, 'crack'>, [DecalCell, DecalCell]> = {
      circle: ['circleFill', 'circleEdge'],
      ring: ['ringFill', 'ringEdge'],
      cone: ['coneFill', 'coneEdge'],
      line: ['lineFill', 'lineEdge'],
    };
    for (const [shape, [fillCell, edgeCell]] of Object.entries(cells) as [
      TelegraphShape,
      [DecalCell, DecalCell],
    ][]) {
      // Two fill instances per telegraph: the faint full area and the growing fill.
      this.fill.set(
        shape,
        this.makeLayer(`vfx-decal-${shape}-fill`, shape, fillCell, 2, 10, scene),
      );
      this.edge.set(
        shape,
        this.makeLayer(`vfx-decal-${shape}-edge`, shape, edgeCell, 1, 20, scene),
      );
    }
    this.edge.set('crack', this.makeLayer('vfx-decal-crack', 'crack', 'crack', 1, 0, scene));
    this.layers.push(...this.fill.values(), ...this.edge.values());

    for (const shape of TELEGRAPH_SHAPES) {
      this.pools.set(
        shape,
        new Pool<Telegraph>({
          create: () => new Telegraph(),
          max: MAX_TELEGRAPHS_PER_SHAPE,
          onRelease: (t) => {
            t.onFilled = null;
            t.frame.phase = 'done';
          },
        }),
      );
    }
  }

  private makeLayer(
    name: string,
    shape: TelegraphShape,
    cell: DecalCell,
    perTelegraph: number,
    alphaIndex: number,
    scene: Scene,
  ): Layer {
    const mesh = buildQuad(name, shape, cell, scene);
    mesh.material = this.material;
    mesh.alphaIndex = BASE_ALPHA_INDEX + alphaIndex;
    mesh.hasVertexAlpha = true;
    const capacity = MAX_TELEGRAPHS_PER_SHAPE * perTelegraph;
    const matrices = new Float32Array(capacity * 16);
    const colors = new Float32Array(capacity * 4);
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    mesh.thinInstanceSetBuffer('color', colors, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.isVisible = false;
    return { mesh, matrices, colors, capacity, count: 0 };
  }

  get activeCount(): number {
    return this.active.length;
  }

  get pooledCount(): number {
    let n = 0;
    for (const pool of this.pools.values()) n += pool.freeCount;
    return n;
  }

  /** Draw calls the decals cost this frame (visible layers). */
  get drawLayers(): number {
    let n = 0;
    for (const layer of this.layers) if (layer.count) n++;
    return n;
  }

  show(opts: TelegraphOptions): Telegraph {
    const pool = this.pools.get(opts.shape)!;
    const stolen = pool.activeCount >= pool.max ? pool.oldestActive() : undefined;
    if (stolen) this.release(stolen);
    const t = pool.acquireOrSteal();
    t.serial = ++this.serial;
    t.shape = opts.shape;
    t.x = opts.at.x;
    t.z = opts.at.z;
    t.yaw = opts.direction ? yawFromDirection(opts.direction.x, opts.direction.z) : (opts.yaw ?? 0);
    const radius = opts.radius ?? 2;
    switch (opts.shape) {
      case 'circle':
      case 'ring':
      case 'crack':
        t.sx = t.sz = radius;
        break;
      case 'cone': {
        const length = opts.length ?? radius;
        t.sz = length;
        t.sx = coneScaleX(length, (opts.angle ?? Math.PI / 3) / 2);
        break;
      }
      case 'line':
        t.sz = opts.length ?? 6;
        t.sx = opts.width ?? 1.2;
        break;
    }
    const intent = opts.intent ?? (opts.shape === 'crack' ? 'neutral' : 'damage');
    t.style = INTENT_STYLES[intent];
    const edge = opts.color ? hexToRgb(opts.color) : hexToRgb(t.style.edge);
    const fill = opts.color ? edge : hexToRgb(t.style.fill);
    t.edgeRgb[0] = edge[0];
    t.edgeRgb[1] = edge[1];
    t.edgeRgb[2] = edge[2];
    t.fillRgb[0] = fill[0];
    t.fillRgb[1] = fill[1];
    t.fillRgb[2] = fill[2];
    const timing = t.timing;
    timing.fadeIn = opts.fadeIn ?? 0.08;
    timing.fillTime = opts.fillTime ?? 0;
    timing.flash = 0.18;
    timing.hold = opts.hold ?? (timing.fillTime > 0 ? 0.05 : 1);
    timing.fadeOut = opts.fadeOut ?? 0.25;
    t.age = 0;
    t.stoppedAt = undefined;
    t.filledFired = false;
    t.onFilled = opts.onFilled ?? null;
    t.frame.phase = 'filling';
    t.frame.fill = 0;
    t.frame.alpha = 0;
    this.active.push(t);
    return t;
  }

  /** Advances every telegraph and rewrites the instance buffers. */
  update(dt: number): void {
    this.time += dt;
    // Age, fire callbacks, retire finished ones.
    for (let i = this.active.length - 1; i >= 0; i--) {
      const t = this.active[i]!;
      t.age += dt;
      telegraphFrame(t.age, t.timing, t.stoppedAt, t.frame);
      if (!t.filledFired && t.frame.fill >= 1) {
        t.filledFired = true;
        t.onFilled?.();
      }
      if (t.frame.phase === 'done') this.release(t);
    }
    // Higher priority draws later (on top) within each layer.
    const sorted = this.scratch;
    sorted.length = 0;
    for (const t of this.active) sorted.push(t);
    sorted.sort((a, b) => a.style.priority - b.style.priority || a.serial - b.serial);

    for (const layer of this.layers) layer.count = 0;
    for (const t of sorted) this.writeInstances(t);
    for (const layer of this.layers) this.flush(layer);
  }

  private writeInstances(t: Telegraph): void {
    const f = t.frame;
    const s = t.style;
    if (t.shape === 'crack') {
      this.push(this.edge.get('crack')!, t, Y.crack, t.sx, t.sz, t.edgeRgb, s.edgeAlpha * f.alpha);
      return;
    }
    const fillLayer = this.fill.get(t.shape)!;
    const instant = t.timing.fillTime <= 0;
    const boost = 1 + 0.6 * f.flash;
    if (!instant) {
      // Faint full-size area so the final footprint is readable from the start.
      this.push(fillLayer, t, Y.back, t.sx, t.sz, t.fillRgb, s.fillAlpha * 0.45 * f.alpha);
    }
    const fill = instant ? 1 : Math.max(0.001, f.fill);
    const fx = t.shape === 'line' ? t.sx : t.sx * fill;
    const fz = t.sz * fill;
    const fillAlpha = Math.min(1, s.fillAlpha * f.alpha * (1 + 1.2 * f.flash));
    this.push(fillLayer, t, Y.fill, fx, fz, t.fillRgb, fillAlpha, boost);
    const pulse = pulseFactor(this.time, s.pulse, f.fill);
    const edgeAlpha = Math.min(1, s.edgeAlpha * f.alpha * pulse + 0.4 * f.flash * f.alpha);
    this.push(this.edge.get(t.shape)!, t, Y.edge, t.sx, t.sz, t.edgeRgb, edgeAlpha, boost);
  }

  private push(
    layer: Layer,
    t: Telegraph,
    y: number,
    sx: number,
    sz: number,
    rgb: readonly [number, number, number],
    alpha: number,
    boost = 1,
  ): void {
    if (layer.count >= layer.capacity) return;
    const i = layer.count++;
    tmpScale.set(sx, 1, sz);
    tmpPos.set(t.x, y, t.z);
    Quaternion.RotationYawPitchRollToRef(t.yaw, 0, 0, tmpQuat);
    Matrix.ComposeToRef(tmpScale, tmpQuat, tmpPos, tmpMat);
    tmpMat.copyToArray(layer.matrices, i * 16);
    const c = i * 4;
    layer.colors[c] = rgb[0] * boost;
    layer.colors[c + 1] = rgb[1] * boost;
    layer.colors[c + 2] = rgb[2] * boost;
    layer.colors[c + 3] = alpha;
  }

  private flush(layer: Layer): void {
    const visible = layer.count > 0;
    layer.mesh.isVisible = visible;
    if (!visible) return;
    layer.mesh.thinInstanceCount = layer.count;
    layer.mesh.thinInstanceBufferUpdated('matrix');
    layer.mesh.thinInstanceBufferUpdated('color');
  }

  private release(t: Telegraph): void {
    const i = this.active.indexOf(t);
    if (i >= 0) {
      this.active[i] = this.active[this.active.length - 1]!;
      this.active.pop();
    }
    this.pools.get(t.shape)!.release(t);
  }

  clear(): void {
    for (const t of [...this.active]) this.release(t);
    for (const layer of this.layers) {
      layer.count = 0;
      layer.mesh.isVisible = false;
    }
  }

  dispose(): void {
    this.clear();
    for (const layer of this.layers) layer.mesh.dispose();
    this.material.dispose();
  }
}
