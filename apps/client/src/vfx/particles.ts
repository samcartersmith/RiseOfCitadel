import '@babylonjs/core/Particles/particleSystemComponent';
import '@babylonjs/core/Particles/webgl2ParticleSystem';
import '@babylonjs/core/Particles/computeShaderParticleSystem';
// GPU particles on WebGPU run as compute shaders, which need the engine extension.
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { GPUParticleSystem } from '@babylonjs/core/Particles/gpuParticleSystem';
import type { BoxParticleEmitter } from '@babylonjs/core/Particles/EmitterTypes/boxParticleEmitter';
import type { ConeParticleEmitter } from '@babylonjs/core/Particles/EmitterTypes/coneParticleEmitter';
import type { CylinderParticleEmitter } from '@babylonjs/core/Particles/EmitterTypes/cylinderParticleEmitter';
import type { HemisphericParticleEmitter } from '@babylonjs/core/Particles/EmitterTypes/hemisphericParticleEmitter';
import type { SphereParticleEmitter } from '@babylonjs/core/Particles/EmitterTypes/sphereParticleEmitter';
import type { IParticleEmitterType } from '@babylonjs/core/Particles/EmitterTypes/IParticleEmitterType';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../render/quality';
import { ATLAS_CELL, PARTICLE_CELLS, spriteSheetCell, type ParticleCell } from './atlasLayout';
import { scaledCount, scaledRate } from './budget';
import { hexToRgb } from './intents';
import type { EmitterShape, ParticleLayer, PresetDef, PresetName } from './presets';

export type ParticleBackend = 'gpu' | 'cpu';
export type ParticleBackendRequest = ParticleBackend | 'auto';
type AnySystem = ParticleSystem | GPUParticleSystem;

/** Particles and projectile heads draw after group 0, so they sit on top of ground decals. */
export const VFX_RENDER_GROUP = 1;
/** Extra seconds after the last particle should have died before a rig is recycled. */
const RELEASE_SLACK = 0.15;

/**
 * GPU particles (transform feedback on WebGL2, compute shaders on WebGPU) when
 * the engine supports them, CPU particles otherwise or when asked.
 */
export function pickParticleBackend(request: ParticleBackendRequest): ParticleBackend {
  if (request === 'cpu') return 'cpu';
  return GPUParticleSystem.IsSupported ? 'gpu' : 'cpu';
}

export interface RigCastOptions {
  /** Tint override, linear 0..1 RGB. */
  color: readonly [number, number, number] | null;
  scale: number;
  /** Half-size (x/z) of box emitters, e.g. the motes area. Null keeps the preset's. */
  area: number | null;
  /** Sprite override for the first layer. */
  cell: ParticleCell | null;
  /** Seconds to emit (rate layers). Infinity = until stopped. */
  emitFor: number;
  tier: QualityTier;
}

interface LayerRuntime {
  ps: AnySystem;
  layer: ParticleLayer;
  emitter: IParticleEmitterType;
  /** Preset colours, parsed once. */
  rgb1: [number, number, number];
  rgb2: [number, number, number];
}

function v3(t: readonly [number, number, number], out: Vector3 = new Vector3()): Vector3 {
  return out.set(t[0], t[1], t[2]);
}

function createEmitter(ps: AnySystem, shape: EmitterShape): IParticleEmitterType {
  switch (shape.kind) {
    case 'point':
      return ps.createPointEmitter(v3(shape.dir1), v3(shape.dir2));
    case 'sphere':
      return ps.createSphereEmitter(shape.radius, 1);
    case 'hemisphere':
      return ps.createHemisphericEmitter(shape.radius, 1);
    case 'cone':
      return ps.createConeEmitter(shape.radius, shape.angle);
    case 'box':
      return ps.createBoxEmitter(v3(shape.dir1), v3(shape.dir2), v3(shape.min), v3(shape.max));
    case 'cylinder':
      return ps.createDirectedCylinderEmitter(
        shape.radius,
        shape.height,
        1,
        v3(shape.dir1),
        v3(shape.dir2),
      );
  }
}

/** Resizes an emitter in place (no allocation) for a cast's scale/area. */
function sizeEmitter(rt: LayerRuntime, scale: number, area: number | null): void {
  const shape = rt.layer.emitter;
  switch (shape.kind) {
    case 'sphere':
      (rt.emitter as SphereParticleEmitter).radius = shape.radius * scale;
      break;
    case 'hemisphere':
      (rt.emitter as HemisphericParticleEmitter).radius = shape.radius * scale;
      break;
    case 'cone':
      (rt.emitter as ConeParticleEmitter).radius = shape.radius * scale;
      break;
    case 'cylinder':
      (rt.emitter as CylinderParticleEmitter).radius = shape.radius * scale;
      break;
    case 'box': {
      const box = rt.emitter as BoxParticleEmitter;
      const hx = area ?? shape.max[0];
      const hz = area ?? shape.max[2];
      box.minEmitBox.set(
        area !== null ? -hx : shape.min[0] * scale,
        shape.min[1],
        area !== null ? -hz : shape.min[2] * scale,
      );
      box.maxEmitBox.set(
        area !== null ? hx : shape.max[0] * scale,
        shape.max[1],
        area !== null ? hz : shape.max[2] * scale,
      );
      break;
    }
    case 'point':
      break;
  }
}

/**
 * One pooled instance of a preset: a particle system per layer, all sharing
 * one emitter position. Created once, restarted for every cast.
 */
export class ParticleRig {
  /** World position all layers emit from. Updated each frame while following. */
  readonly origin = new Vector3();
  readonly offset = new Vector3();
  follow: TransformNode | null = null;
  /** Follows a point that something else moves (projectile trails). */
  followPoint: Vector3 | null = null;
  serial = 0;
  age = 0;
  /** True while handed out by the pool (playing or fading). */
  active = false;
  private emitFor = 0;
  private stoppedAt = -1;
  private endAt = Number.POSITIVE_INFINITY;
  private readonly layers: LayerRuntime[] = [];
  private readonly maxLife: number;

  constructor(
    readonly preset: PresetName,
    readonly def: PresetDef,
    scene: Scene,
    backend: ParticleBackend,
    atlas: Texture,
    timeScale: number,
  ) {
    let maxLife = 0;
    def.layers.forEach((layer, i) => {
      const name = `vfx-${preset}-${i}`;
      const ps: AnySystem =
        backend === 'gpu'
          ? new GPUParticleSystem(
              name,
              { capacity: layer.capacity, emitRateControl: true },
              scene,
              null,
              true,
            )
          : new ParticleSystem(name, layer.capacity, scene, null, true);
      ps.particleTexture = atlas;
      ps.spriteCellWidth = ATLAS_CELL;
      ps.spriteCellHeight = ATLAS_CELL;
      ps.spriteCellChangeSpeed = 0;
      ps.spriteRandomStartCell = false;
      ps.emitter = this.origin;
      ps.renderingGroupId = VFX_RENDER_GROUP;
      ps.updateSpeed = timeScale / 60;
      ps.minLifeTime = layer.life[0];
      ps.maxLifeTime = layer.life[1];
      ps.gravity = v3(layer.gravity);
      ps.blendMode =
        layer.blend === 'add' ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
      if (layer.stretched) ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
      if (layer.spin) {
        ps.minAngularSpeed = layer.spin[0];
        ps.maxAngularSpeed = layer.spin[1];
      }
      if (layer.rotation) {
        ps.minInitialRotation = layer.rotation[0];
        ps.maxInitialRotation = layer.rotation[1];
      }
      for (const [t, f] of layer.sizeCurve ?? []) ps.addSizeGradient(t, f);
      const emitter = createEmitter(ps, layer.emitter);
      this.layers.push({
        ps,
        layer,
        emitter,
        rgb1: hexToRgb(layer.color),
        rgb2: hexToRgb(layer.color2 ?? layer.color),
      });
      maxLife = Math.max(maxLife, layer.life[1]);
    });
    this.maxLife = maxLife;
  }

  get systemCount(): number {
    return this.layers.length;
  }

  /** True once emission has stopped and every particle has had time to die. */
  get finished(): boolean {
    return this.age >= this.endAt;
  }

  /** EffectHandle: still playing (or its particles still fading). */
  get alive(): boolean {
    return this.active;
  }

  /** EffectHandle: stop emitting; live particles fade out, then the rig returns to the pool. */
  stop(): void {
    if (this.active) this.stopEmitting();
  }

  get emitting(): boolean {
    return this.stoppedAt < 0;
  }

  setTimeScale(timeScale: number): void {
    for (const { ps } of this.layers) ps.updateSpeed = timeScale / 60;
  }

  start(opts: RigCastOptions): void {
    this.age = 0;
    this.stoppedAt = -1;
    this.endAt = Number.POSITIVE_INFINITY;
    this.emitFor = opts.emitFor;
    this.syncFollow();
    this.layers.forEach((rt, i) => {
      const { ps, layer } = rt;
      const cell = spriteSheetCell(PARTICLE_CELLS[i === 0 && opts.cell ? opts.cell : layer.cell]);
      ps.startSpriteCellID = cell;
      ps.endSpriteCellID = cell;
      this.applyColor(rt, opts.color);
      ps.minSize = layer.size[0] * opts.scale;
      ps.maxSize = layer.size[1] * opts.scale;
      ps.minEmitPower = layer.speed[0] * opts.scale;
      ps.maxEmitPower = layer.speed[1] * opts.scale;
      sizeEmitter(rt, opts.scale, opts.area);
      if (layer.burst) {
        ps.emitRate = 0;
        ps.manualEmitCount = scaledCount(layer.burst, opts.tier);
      } else {
        ps.manualEmitCount = -1;
        ps.emitRate = scaledRate(layer.rate ?? 0, opts.tier);
      }
      ps.start();
    });
  }

  /**
   * Starts every layer with nothing to emit so the scene compiles its shaders
   * now rather than on the first real cast (a GPU system emits nothing until
   * its effect is ready, which would swallow a short burst). Draws nothing.
   */
  warm(): void {
    for (const { ps } of this.layers) {
      ps.emitRate = 0;
      ps.manualEmitCount = 0;
      ps.start();
    }
  }

  /** Advances the rig's clock; stops emission once `emitFor` has elapsed. */
  update(dt: number): void {
    this.age += dt;
    this.syncFollow();
    if (this.stoppedAt < 0 && this.age >= this.emitFor && this.age > 0) this.stopEmitting();
  }

  /** Graceful stop: no new particles, live ones finish their lifetime. */
  stopEmitting(): void {
    if (this.stoppedAt >= 0) return;
    this.stoppedAt = this.age;
    // Particles live in world space, so the emitter can stop tracking whatever it followed.
    this.follow = null;
    this.followPoint = null;
    for (const { ps, layer } of this.layers) if (!layer.burst) ps.stop();
    this.endAt = this.age + this.maxLife + RELEASE_SLACK;
  }

  /** Hard stop: clears every particle now. Called when the rig returns to the pool. */
  clear(): void {
    for (const { ps } of this.layers) {
      ps.stop();
      ps.reset();
    }
    this.follow = null;
    this.followPoint = null;
    this.offset.setAll(0);
    this.stoppedAt = 0;
    this.endAt = 0;
  }

  dispose(): void {
    // The atlas is shared, so never let a system dispose its texture.
    for (const { ps } of this.layers) ps.dispose(false);
    this.layers.length = 0;
  }

  private syncFollow(): void {
    if (this.follow) {
      this.origin.copyFrom(this.follow.getAbsolutePosition()).addInPlace(this.offset);
    } else if (this.followPoint) {
      this.origin.copyFrom(this.followPoint).addInPlace(this.offset);
    }
  }

  private applyColor(rt: LayerRuntime, override: readonly [number, number, number] | null): void {
    const { ps, layer } = rt;
    const alpha = layer.alpha ?? 1;
    const [r, g, b] = override ?? rt.rgb1;
    ps.color1.set(r, g, b, alpha);
    if (override) {
      // With an override the second colour is a lighter mix, so the tint keeps some sparkle.
      ps.color2.set(r + (1 - r) * 0.45, g + (1 - g) * 0.45, b + (1 - b) * 0.45, alpha);
    } else {
      ps.color2.set(rt.rgb2[0], rt.rgb2[1], rt.rgb2[2], alpha);
    }
    if (layer.blend === 'add') ps.colorDead.set(0, 0, 0, 0);
    else ps.colorDead.set(r * 0.8, g * 0.8, b * 0.8, 0);
  }
}
