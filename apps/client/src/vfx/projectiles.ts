import '@babylonjs/core/Meshes/thinInstanceMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { MAX_PROJECTILES } from './budget';
import { hexToRgb } from './intents';
import { arcLength, arcPoint, arcTangent, type Vec3Like } from './path';
import { Pool } from './pool';
import { VFX_RENDER_GROUP, type ParticleRig } from './particles';
import type { PresetName } from './presets';

export interface ProjectileOptions {
  from: Vec3Like;
  /** Fixed destination. Ignored when `target` is set. */
  to?: Vec3Like;
  /** Homing: the destination is re-read from this node every frame. */
  target?: TransformNode;
  /** World units per second along the path. */
  speed: number;
  /** Peak lift above the straight line, world units (0 = straight). */
  arcHeight?: number;
  /** Tint for the head, trail and impact (hex). */
  color?: string;
  /** Head diameter, world units (default 0.4). */
  size?: number;
  /** Moves this node instead of drawing the default glowing orb (it is not disposed). */
  visual?: TransformNode;
  /** Trail preset following the head, or null for none (default `trail`). */
  trail?: PresetName | null;
  /** Preset played where it lands, or null for none (default `impactBurst`). */
  impact?: PresetName | null;
  /** Called on arrival with the landing point (reused vector: copy it if you keep it). */
  onArrive?: (at: Vector3) => void;
}

/** What the projectile system needs from the VFX manager. */
export interface ProjectileHost {
  startTrail(
    preset: PresetName,
    follow: Vector3,
    color: readonly [number, number, number],
  ): ParticleRig;
  playImpact(preset: PresetName, at: Vector3, color: readonly [number, number, number]): void;
}

export class Projectile {
  serial = 0;
  readonly from = new Vector3();
  readonly to = new Vector3();
  readonly position = new Vector3();
  private readonly tangent = new Vector3();
  target: TransformNode | null = null;
  visual: TransformNode | null = null;
  speed = 1;
  arcHeight = 0;
  size = 0.4;
  travelled = 0;
  length = 0;
  readonly rgb: [number, number, number] = [1, 1, 1];
  trail: ParticleRig | null = null;
  trailSerial = 0;
  impact: PresetName | null = null;
  onArrive: ((at: Vector3) => void) | null = null;
  done = true;
  /** Set when the caller stops it early: it vanishes without an impact. */
  cancelled = false;

  get alive(): boolean {
    return !this.done;
  }

  /** Cancels the visual (no impact, no onArrive). */
  stop(): void {
    if (!this.done) this.cancelled = true;
  }

  /** 0..1 progress along the path. */
  get progress(): number {
    return this.length > 0 ? Math.min(1, this.travelled / this.length) : 1;
  }

  /** Advances along the path. Returns true on the frame it arrives. */
  advance(dt: number): boolean {
    if (this.target) {
      this.to.copyFrom(this.target.getAbsolutePosition());
      this.length = arcLength(this.from, this.to, this.arcHeight);
    }
    this.travelled += this.speed * dt;
    const t = this.progress;
    arcPoint(this.from, this.to, this.arcHeight, t, this.position);
    if (this.visual) {
      this.visual.position.copyFrom(this.position);
      arcTangent(this.from, this.to, this.arcHeight, t, this.tangent);
      if (this.tangent.lengthSquared() > 1e-8) {
        this.visual.lookAt(this.tangent.addInPlace(this.position));
      }
    }
    return t >= 1;
  }
}

const tmpMat = new Matrix();

/**
 * Visual-only projectiles: a head moving along a straight or arced path at a
 * speed, a trail, and an impact on arrival. The sim owns real projectiles
 * later (M2-08); this just draws them. All default heads are thin instances of
 * one orb mesh, so any number of them is a single draw call.
 */
export class ProjectileSystem {
  private readonly pool: Pool<Projectile>;
  private readonly active: Projectile[] = [];
  private readonly orb: Mesh;
  private readonly matrices = new Float32Array(MAX_PROJECTILES * 16);
  private readonly colors = new Float32Array(MAX_PROJECTILES * 4);
  private serial = 0;

  constructor(
    scene: Scene,
    private readonly host: ProjectileHost,
  ) {
    this.pool = new Pool<Projectile>({
      create: () => new Projectile(),
      max: MAX_PROJECTILES,
      onRelease: (p) => {
        p.done = true;
        p.target = null;
        p.visual = null;
        p.onArrive = null;
        if (p.trail && p.trail.serial === p.trailSerial) p.trail.stopEmitting();
        p.trail = null;
      },
    });
    const mat = new StandardMaterial('vfx-projectile', scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.specularColor = Color3.Black();
    this.orb = MeshBuilder.CreateIcoSphere(
      'vfx-projectile-orb',
      { radius: 0.5, subdivisions: 2 },
      scene,
    );
    this.orb.material = mat;
    this.orb.isPickable = false;
    this.orb.alwaysSelectAsActiveMesh = true;
    this.orb.renderingGroupId = VFX_RENDER_GROUP;
    this.orb.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.orb.thinInstanceSetBuffer('color', this.colors, 4, false);
    this.orb.thinInstanceCount = 0;
    this.orb.isVisible = false;
  }

  get activeCount(): number {
    return this.active.length;
  }

  get pooledCount(): number {
    return this.pool.freeCount;
  }

  launch(opts: ProjectileOptions): Projectile {
    if (this.pool.activeCount >= this.pool.max) {
      const oldest = this.pool.oldestActive();
      if (oldest) this.retire(oldest);
    }
    const p = this.pool.acquireOrSteal();
    p.serial = ++this.serial;
    p.done = false;
    p.cancelled = false;
    p.from.set(opts.from.x, opts.from.y, opts.from.z);
    p.target = opts.target ?? null;
    const to = p.target ? p.target.getAbsolutePosition() : (opts.to ?? opts.from);
    p.to.set(to.x, to.y, to.z);
    p.speed = Math.max(0.01, opts.speed);
    p.arcHeight = opts.arcHeight ?? 0;
    p.size = opts.size ?? 0.4;
    p.visual = opts.visual ?? null;
    p.travelled = 0;
    p.length = arcLength(p.from, p.to, p.arcHeight);
    p.position.copyFrom(p.from);
    const [r, g, b] = hexToRgb(opts.color ?? '#FFD27A');
    p.rgb[0] = r;
    p.rgb[1] = g;
    p.rgb[2] = b;
    p.impact = opts.impact === undefined ? 'impactBurst' : opts.impact;
    p.onArrive = opts.onArrive ?? null;
    const trail = opts.trail === undefined ? 'trail' : opts.trail;
    p.trail = trail ? this.host.startTrail(trail, p.position, p.rgb) : null;
    p.trailSerial = p.trail?.serial ?? 0;
    this.active.push(p);
    return p;
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]!;
      if (p.cancelled) {
        this.retire(p);
        continue;
      }
      if (p.advance(dt)) {
        if (p.impact) this.host.playImpact(p.impact, p.position, p.rgb);
        p.onArrive?.(p.position);
        this.retire(p);
      }
    }
    let n = 0;
    for (const p of this.active) {
      if (p.visual) continue;
      Matrix.ScalingToRef(p.size, p.size, p.size, tmpMat);
      tmpMat.setTranslation(p.position);
      tmpMat.copyToArray(this.matrices, n * 16);
      this.colors[n * 4] = p.rgb[0];
      this.colors[n * 4 + 1] = p.rgb[1];
      this.colors[n * 4 + 2] = p.rgb[2];
      this.colors[n * 4 + 3] = 1;
      n++;
    }
    this.orb.isVisible = n > 0;
    if (n > 0) {
      this.orb.thinInstanceCount = n;
      this.orb.thinInstanceBufferUpdated('matrix');
      this.orb.thinInstanceBufferUpdated('color');
    }
  }

  private retire(p: Projectile): void {
    const i = this.active.indexOf(p);
    if (i >= 0) {
      this.active[i] = this.active[this.active.length - 1]!;
      this.active.pop();
    }
    this.pool.release(p);
  }

  clear(): void {
    for (const p of [...this.active]) this.retire(p);
    this.orb.isVisible = false;
  }

  dispose(): void {
    this.clear();
    this.orb.material?.dispose();
    this.orb.dispose();
  }
}
