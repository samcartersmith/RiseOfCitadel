/**
 * VFX library (roadmap M1-12): pooled particles, ground telegraphs and visual
 * projectiles built on one procedural atlas. See docs/design/vfx.md.
 *
 *   const vfx = createVfx(scene, { tier: quality.tier });
 *   vfx.play('impactBurst', { at: hitPoint, color: '#FFD27A' });
 *   vfx.attach('aura', heroRoot, { color: '#46A758', duration: 4 });
 *   vfx.telegraph({ shape: 'circle', at, radius: 3, intent: 'enemyDisable', fillTime: 1,
 *                   onFilled: () => vfx.play('dustPuff', { at }) });
 *   vfx.projectile({ from, to, speed: 14, arcHeight: 3, color: '#FF8A3D' });
 */
import type { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../render/quality';
import type { CitadelStats } from '../render/stats';
import { createVfxAtlas } from './atlas';
import type { ParticleCell } from './atlasLayout';
import { VFX_BUDGETS } from './budget';
import { TelegraphRenderer, type Telegraph, type TelegraphOptions } from './decals';
import { hexToRgb } from './intents';
import {
  ParticleRig,
  VFX_RENDER_GROUP,
  pickParticleBackend,
  type ParticleBackend,
  type ParticleBackendRequest,
} from './particles';
import type { Vec3Like } from './path';
import { Pool } from './pool';
import { PRESETS, PRESET_NAMES, presetEmitTime, type PresetName } from './presets';
import { ProjectileSystem, type Projectile, type ProjectileOptions } from './projectiles';

export type { Intent } from './intents';
export { INTENTS, INTENT_STYLES } from './intents';
export type { PresetName } from './presets';
export { PRESET_NAMES } from './presets';
export type { TelegraphOptions, TelegraphShape } from './decals';
export { TELEGRAPH_SHAPES } from './decals';
export type { ProjectileOptions } from './projectiles';
export type { ParticleBackend } from './particles';
export { VFX_RENDER_GROUP } from './particles';

export interface VfxOptions {
  /** Starting quality tier (from the render quality controller). */
  tier: QualityTier;
  /** `auto` (default) uses GPU particles where supported. `?particles=cpu|gpu` in the URL wins. */
  particles?: ParticleBackendRequest;
  /** Rigs to create per preset up front (default 1), so the first cast doesn't allocate. */
  prewarm?: number;
}

export interface PlayOptions {
  /** World position (ignored while following). Default origin. */
  at?: Vec3Like;
  /** Node to follow every frame (trail, aura). */
  follow?: TransformNode;
  /** Offset from `follow` (or `at`). */
  offset?: Vec3Like;
  /** Tint override (hex). */
  color?: string;
  /** Size multiplier for particles, speeds and emitter radius. */
  scale?: number;
  /** Seconds to emit. Loops run until `stop()` when omitted. */
  duration?: number;
  /** Half-size of box emitters (motes/embers area), world units. */
  area?: number;
  /** Sprite override for the first layer (e.g. `feather` bursts for Kestrel). */
  cell?: ParticleCell;
}

/** Anything a cast returns: check `alive`, `stop()` to end it early. */
export interface EffectHandle {
  readonly alive: boolean;
  readonly serial: number;
  stop(): void;
}

export interface VfxCounts {
  particles: number;
  telegraphs: number;
  projectiles: number;
  total: number;
}

export interface VfxStats {
  backend: ParticleBackend;
  tier: QualityTier;
  /** Effects currently playing (projectile trails count as particle effects). */
  active: VfxCounts;
  /** Recycled effects waiting in pools. */
  pooled: VfxCounts;
  /** Babylon particle systems ever created (pool high-water mark × layers). */
  particleSystems: number;
}

function urlParticleRequest(): ParticleBackendRequest | null {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get('particles');
  return v === 'cpu' || v === 'gpu' || v === 'auto' ? v : null;
}

export class Vfx {
  readonly backend: ParticleBackend;
  readonly atlas: DynamicTexture;
  private tierValue: QualityTier;
  private timeScaleValue = 1;
  private readonly rigPools = new Map<PresetName, Pool<ParticleRig>>();
  private readonly activeRigs: ParticleRig[] = [];
  private readonly telegraphs: TelegraphRenderer;
  private readonly projectiles: ProjectileSystem;
  private readonly observer: Observer<Scene>;
  private serial = 0;
  private systemsCreated = 0;

  constructor(
    private readonly scene: Scene,
    options: VfxOptions,
  ) {
    this.tierValue = options.tier;
    this.backend = pickParticleBackend(urlParticleRequest() ?? options.particles ?? 'auto');
    // Particles and projectile heads draw in their own group, after decals, but
    // keep the depth buffer so world geometry still hides them.
    scene.setRenderingAutoClearDepthStencil(VFX_RENDER_GROUP, false, false, false);
    this.atlas = createVfxAtlas(scene);

    for (const name of PRESET_NAMES) {
      const def = PRESETS[name];
      this.rigPools.set(
        name,
        new Pool<ParticleRig>({
          create: () => {
            const rig = new ParticleRig(
              name,
              def,
              scene,
              this.backend,
              this.atlas,
              this.timeScaleValue,
            );
            this.systemsCreated += rig.systemCount;
            return rig;
          },
          max: VFX_BUDGETS[this.tierValue].maxRigsPerPreset,
          onRelease: (rig) => rig.clear(),
        }),
      );
    }
    const prewarm = options.prewarm ?? 1;
    for (const pool of this.rigPools.values()) {
      pool.prewarm(prewarm);
      pool.forEach((rig) => rig.warm());
    }

    this.telegraphs = new TelegraphRenderer(scene, this.atlas);
    this.projectiles = new ProjectileSystem(scene, {
      startTrail: (preset, follow, rgb) => this.startRig(preset, {}, rgb, follow),
      playImpact: (preset, at, rgb) => {
        this.startRig(preset, { at }, rgb, null);
      },
    });

    const engine = scene.getEngine();
    this.observer = scene.onBeforeRenderObservable.add(() => {
      // Same clamp as Babylon's animation clock, so particles and pools agree.
      const dt = Math.min(engine.getDeltaTime() / 1000, 1) * this.timeScaleValue;
      this.update(dt);
    });
  }

  get tier(): QualityTier {
    return this.tierValue;
  }

  /** Changes particle counts for future casts (effects already playing keep theirs). */
  setTier(tier: QualityTier): void {
    this.tierValue = tier;
  }

  get timeScale(): number {
    return this.timeScaleValue;
  }

  /** Slow-motion for debugging and screenshots (1 = real time). */
  setTimeScale(scale: number): void {
    this.timeScaleValue = Math.max(0, scale);
    for (const pool of this.rigPools.values())
      pool.forEach((r) => r.setTimeScale(this.timeScaleValue));
  }

  /** Plays a particle preset. Loops (`trail`, `aura`, `embers`, `motes`) run until stopped or `duration`. */
  play(preset: PresetName, opts: PlayOptions = {}): EffectHandle {
    const rgb = opts.color ? hexToRgb(opts.color) : null;
    return this.startRig(preset, opts, rgb, null);
  }

  /** `play` attached to a node. */
  attach(
    preset: PresetName,
    node: TransformNode,
    opts: Omit<PlayOptions, 'follow'> = {},
  ): EffectHandle {
    return this.play(preset, { ...opts, follow: node });
  }

  /** Shows a ground telegraph / decal. */
  telegraph(opts: TelegraphOptions): EffectHandle {
    const t: Telegraph = this.telegraphs.show(opts);
    return t;
  }

  /** Launches a visual-only projectile. */
  projectile(opts: ProjectileOptions): EffectHandle {
    const p: Projectile = this.projectiles.launch(opts);
    return p;
  }

  stats(): VfxStats {
    let pooledParticles = 0;
    for (const pool of this.rigPools.values()) pooledParticles += pool.freeCount;
    const active = {
      particles: this.activeRigs.length,
      telegraphs: this.telegraphs.activeCount,
      projectiles: this.projectiles.activeCount,
      total: 0,
    };
    active.total = active.particles + active.telegraphs + active.projectiles;
    const pooled = {
      particles: pooledParticles,
      telegraphs: this.telegraphs.pooledCount,
      projectiles: this.projectiles.pooledCount,
      total: 0,
    };
    pooled.total = pooled.particles + pooled.telegraphs + pooled.projectiles;
    return {
      backend: this.backend,
      tier: this.tierValue,
      active,
      pooled,
      particleSystems: this.systemsCreated,
    };
  }

  /** Ends every effect immediately and returns it to its pool. */
  stopAll(): void {
    this.projectiles.clear();
    this.telegraphs.clear();
    for (const rig of [...this.activeRigs]) this.releaseRig(rig);
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.stopAll();
    this.projectiles.dispose();
    this.telegraphs.dispose();
    for (const pool of this.rigPools.values()) pool.forEach((r) => r.dispose());
    this.rigPools.clear();
    this.atlas.dispose();
  }

  private startRig(
    preset: PresetName,
    opts: PlayOptions,
    rgb: readonly [number, number, number] | null,
    followPoint: Vector3 | null,
  ): ParticleRig {
    const pool = this.rigPools.get(preset);
    if (!pool) throw new Error(`Unknown VFX preset "${preset}"`);
    if (pool.activeCount >= pool.max) {
      const oldest = pool.oldestActive();
      if (oldest) this.releaseRig(oldest);
    }
    const rig = pool.acquireOrSteal();
    rig.serial = ++this.serial;
    rig.follow = opts.follow ?? null;
    rig.followPoint = followPoint;
    const at = opts.at;
    const off = opts.offset;
    if (rig.follow || rig.followPoint) {
      rig.offset.set(off?.x ?? 0, off?.y ?? 0, off?.z ?? 0);
    } else {
      rig.origin.set(
        (at?.x ?? 0) + (off?.x ?? 0),
        (at?.y ?? 0) + (off?.y ?? 0),
        (at?.z ?? 0) + (off?.z ?? 0),
      );
    }
    const def = PRESETS[preset];
    rig.start({
      color: rgb,
      scale: opts.scale ?? 1,
      area: opts.area ?? null,
      cell: opts.cell ?? null,
      emitFor: opts.duration ?? (def.loop ? Number.POSITIVE_INFINITY : presetEmitTime(def)),
      tier: this.tierValue,
    });
    rig.active = true;
    this.activeRigs.push(rig);
    return rig;
  }

  private releaseRig(rig: ParticleRig): void {
    const i = this.activeRigs.indexOf(rig);
    if (i >= 0) {
      this.activeRigs[i] = this.activeRigs[this.activeRigs.length - 1]!;
      this.activeRigs.pop();
    }
    rig.active = false;
    this.rigPools.get(rig.preset)!.release(rig);
  }

  private update(dt: number): void {
    // Projectiles first: arrivals spawn impacts and stop trails this frame.
    this.projectiles.update(dt);
    for (let i = this.activeRigs.length - 1; i >= 0; i--) {
      const rig = this.activeRigs[i]!;
      rig.update(dt);
      if (rig.finished) this.releaseRig(rig);
    }
    this.telegraphs.update(dt);
  }
}

export function createVfx(scene: Scene, options: VfxOptions): Vfx {
  return new Vfx(scene, options);
}

/**
 * Additive hook for the perf counters: copies the active effect count onto a
 * stats snapshot before it is published on `window.__citadelStats`.
 */
export function withVfxStats(stats: CitadelStats, vfx: Vfx): CitadelStats {
  stats.vfxActive = vfx.stats().active.total;
  return stats;
}
