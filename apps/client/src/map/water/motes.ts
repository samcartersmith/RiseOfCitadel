/**
 * Drifting light motes over the river (High and Medium only): one small CPU
 * ParticleSystem, one draw call, additive. Motes spawn over open water near
 * the camera's focus and drift downstream with the local flow, rising slowly.
 * The dot texture is generated in code (no download).
 */
import '@babylonjs/core/Particles/particleSystemComponent';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { CustomParticleEmitter } from '@babylonjs/core/Particles/EmitterTypes/customParticleEmitter';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { pointAt, type RiverPath } from './riverPath';
import { hexToRgb } from './waterLook';

export interface MoteOptions {
  path: RiverPath;
  /** World units per map unit. */
  scale: number;
  /** Water surface, world units. */
  levelY: number;
  /** Water depth at a map point (map units; ≤ 0 is dry). */
  depthAt(x: number, z: number): number;
  /** Half-width (map units) of the band motes spawn in. */
  spawnHalfWidth: number;
  /** Arc length (map units) either side of the focus that motes spawn over. */
  spawnRange: number;
  /** Flow speed at a signed distance from the centreline (world units / s). */
  speedAt(across: number): number;
  /** Starting focus (map-space arc length). */
  focus: number;
}

export interface RiverMotes {
  readonly system: ParticleSystem;
  /** Re-centre spawning on a map-space arc length along the river. */
  setFocus(s: number): void;
  setColor(hex: string, intensity: number): void;
  dispose(): void;
}

/** Same group as VFX particles (vfx/particles.ts VFX_RENDER_GROUP). */
export const MOTE_RENDER_GROUP = 1;

/** Small seeded RNG (mulberry32), so motes don't depend on Math.random. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dotTexture(scene: Scene): RawTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      // Bright core, soft halo.
      const a = Math.max(0, 1 - d) ** 2 * 0.7 + Math.max(0, 1 - d * 2.5) * 0.3;
      data.set([255, 255, 255, Math.round(Math.min(1, a) * 255)], (y * n + x) * 4);
    }
  }
  const tex = new RawTexture(
    data,
    n,
    n,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  tex.name = 'river-mote';
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

export function createRiverMotes(scene: Scene, capacity: number, opts: MoteOptions): RiverMotes {
  const { path, scale: S } = opts;
  const random = rng(0x5eed);
  const ps = new ParticleSystem('river-motes', capacity, scene);
  ps.particleTexture = dotTexture(scene);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.emitter = Vector3.Zero();
  ps.isLocal = false;
  ps.minLifeTime = 3;
  ps.maxLifeTime = 6;
  ps.emitRate = capacity / 4.5;
  ps.minSize = 0.5;
  ps.maxSize = 1.1;
  ps.minEmitPower = 1;
  ps.maxEmitPower = 1;
  ps.gravity = Vector3.Zero();
  ps.updateSpeed = 1 / 60;
  // Babylon draws particles before transparent meshes in a group, so in group 0 the
  // water would paint over them. Group 1 (shared with VFX, vfx/particles.ts) keeps the
  // depth buffer, so motes still hide behind banks and cliffs.
  ps.renderingGroupId = MOTE_RENDER_GROUP;
  scene.setRenderingAutoClearDepthStencil(MOTE_RENDER_GROUP, false, false, false);

  let focus = opts.focus;
  let tx = 1;
  let tz = 0;
  let speed = 0.5;
  const emitter = new CustomParticleEmitter();
  emitter.particlePositionGenerator = (_i, _p, out) => {
    // A few tries to land on open water rather than a dry bank.
    for (let k = 0; k < 4; k++) {
      const s = focus + (random() * 2 - 1) * opts.spawnRange;
      const c = pointAt(path, s);
      const across = (random() * 2 - 1) * opts.spawnHalfWidth;
      const x = c.x - c.tz * across;
      const z = c.z + c.tx * across;
      if (opts.depthAt(x, z) > 4 || k === 3) {
        tx = c.tx;
        tz = c.tz;
        speed = opts.speedAt(across);
        out.set(x * S, opts.levelY + 0.1 + random() * 0.7, z * S);
        return;
      }
    }
  };
  emitter.particleDirectionGenerator = (_i, _p, out) => {
    // Drift a bit slower than the surface, with a slow rise and a little wander.
    const k = speed * (0.45 + random() * 0.3);
    out.set(
      tx * k + (random() - 0.5) * 0.15,
      0.04 + random() * 0.1,
      tz * k + (random() - 0.5) * 0.15,
    );
  };
  ps.particleEmitterType = emitter;

  const setColor = (hex: string, intensity: number) => {
    const [r, g, b] = hexToRgb(hex);
    const c = (a: number) => new Color4(r * intensity, g * intensity, b * intensity, a);
    // Fade in and out over each mote's life.
    ps.removeColorGradient(0);
    ps.removeColorGradient(0.25);
    ps.removeColorGradient(0.75);
    ps.removeColorGradient(1);
    ps.addColorGradient(0, c(0));
    ps.addColorGradient(0.25, c(0.9));
    ps.addColorGradient(0.75, c(0.7));
    ps.addColorGradient(1, c(0));
  };
  setColor('#BFF6F0', 1.3);

  ps.preWarmCycles = 300;
  ps.preWarmStepOffset = 2;
  ps.start();

  return {
    system: ps,
    setFocus(s) {
      const next = Math.max(0, Math.min(path.length, s));
      const jump = Math.abs(next - focus) > opts.spawnRange * 0.75;
      focus = next;
      if (jump) {
        // Teleported (minimap jump, view preset): respawn around the new focus at once.
        ps.reset();
        ps.stop();
        ps.start();
      }
    },
    setColor,
    dispose() {
      ps.particleTexture?.dispose();
      ps.dispose();
    },
  };
}
