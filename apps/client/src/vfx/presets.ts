/**
 * Particle presets as plain data. Pure TypeScript.
 *
 * Counts are the High-tier budget; budget.ts scales them per tier. Time is in
 * seconds and distance in world units (1 unit ≈ 1 m) because every system runs
 * with `updateSpeed = 1/60`, which makes Babylon's particle clock real seconds.
 */
import type { ParticleCell } from './atlasLayout';

type V3 = readonly [number, number, number];

export type EmitterShape =
  | { kind: 'point'; dir1: V3; dir2: V3 }
  | { kind: 'sphere'; radius: number }
  | { kind: 'hemisphere'; radius: number }
  | { kind: 'cone'; radius: number; angle: number }
  | { kind: 'box'; min: V3; max: V3; dir1: V3; dir2: V3 }
  | { kind: 'cylinder'; radius: number; height: number; dir1: V3; dir2: V3 };

export interface ParticleLayer {
  cell: ParticleCell;
  /** Max live particles in this layer (buffer size, High tier). */
  capacity: number;
  /** One-shot count emitted on the first frame. */
  burst?: number;
  /** Particles per second while emitting. */
  rate?: number;
  /** Seconds of emission for `rate` layers. Infinity = until stopped. Ignored for bursts. */
  emitTime: number;
  life: readonly [number, number];
  size: readonly [number, number];
  /** Size over lifetime as [t, factor] keys (t in 0..1). */
  sizeCurve?: readonly (readonly [number, number])[];
  speed: readonly [number, number];
  gravity: V3;
  emitter: EmitterShape;
  /** Default tint (hex). A cast's `color` overrides it. */
  color: string;
  /** Second start colour; particles pick a random mix of `color` and this. */
  color2?: string;
  /** Start alpha (0..1). */
  alpha?: number;
  /** `add` glows (sparks, embers); `alpha` occludes (dust, smoke). */
  blend: 'add' | 'alpha';
  /** Stretch along the velocity (sparks, streaks). */
  stretched?: boolean;
  /** Angular speed range, radians per second. */
  spin?: readonly [number, number];
  /** Initial rotation range, radians. */
  rotation?: readonly [number, number];
}

export interface PresetDef {
  /** Loops keep emitting until stopped (or until the cast's `duration`). */
  loop: boolean;
  /** Should it follow a node? (trail, aura) Purely advisory, for docs and the demo. */
  attached: boolean;
  layers: readonly ParticleLayer[];
}

const UP: V3 = [0, 1, 0];

export const PRESETS = {
  /** Hit flash: a spray of sparks plus a shockwave ring. */
  impactBurst: {
    loop: false,
    attached: false,
    layers: [
      {
        cell: 'spark',
        capacity: 40,
        burst: 32,
        emitTime: 0,
        life: [0.25, 0.5],
        size: [0.4, 0.7],
        speed: [5, 10],
        gravity: [0, -9, 0],
        emitter: { kind: 'sphere', radius: 0.25 },
        color: '#FFD27A',
        color2: '#FFFFFF',
        blend: 'add',
        stretched: true,
      },
      {
        cell: 'ring',
        capacity: 2,
        burst: 1,
        emitTime: 0,
        life: [0.32, 0.32],
        size: [1, 1],
        sizeCurve: [
          [0, 0.4],
          [1, 4.5],
        ],
        speed: [0, 0],
        gravity: [0, 0, 0],
        emitter: { kind: 'point', dir1: UP, dir2: UP },
        color: '#FFE6A3',
        blend: 'add',
      },
    ],
  },
  /** Fountain of hot sparks (gold for Bulwark's impacts, orange for forge hits). */
  sparkShower: {
    loop: false,
    attached: false,
    layers: [
      {
        cell: 'spark',
        capacity: 80,
        rate: 160,
        emitTime: 0.4,
        life: [0.5, 0.9],
        size: [0.3, 0.5],
        speed: [6, 11],
        gravity: [0, -16, 0],
        emitter: { kind: 'cone', radius: 0.2, angle: 0.55 },
        color: '#FFC24A',
        color2: '#FFF1C7',
        blend: 'add',
        stretched: true,
      },
    ],
  },
  /** Low, soft dust cloud (footfalls, landings, Rampart Charge). */
  dustPuff: {
    loop: false,
    attached: false,
    layers: [
      {
        cell: 'smoke',
        capacity: 18,
        burst: 14,
        emitTime: 0,
        life: [0.7, 1.2],
        size: [1, 1.6],
        sizeCurve: [
          [0, 0.6],
          [1, 2.2],
        ],
        speed: [0.8, 2],
        gravity: [0, 0.5, 0],
        emitter: { kind: 'hemisphere', radius: 0.5 },
        color: '#C9B99A',
        color2: '#A8987C',
        alpha: 0.9,
        blend: 'alpha',
        spin: [-1.2, 1.2],
        rotation: [0, Math.PI * 2],
      },
    ],
  },
  /** World-space ribbon of glow behind a moving node (projectiles, dashes). */
  trail: {
    loop: true,
    attached: true,
    layers: [
      {
        cell: 'dot',
        capacity: 72,
        rate: 90,
        emitTime: Number.POSITIVE_INFINITY,
        life: [0.3, 0.45],
        size: [0.3, 0.45],
        sizeCurve: [
          [0, 1],
          [1, 0.15],
        ],
        speed: [0, 0.25],
        gravity: [0, 0, 0],
        emitter: { kind: 'sphere', radius: 0.06 },
        color: '#FFE6A3',
        blend: 'add',
      },
    ],
  },
  /** Looping motes rising around a unit (buffs, auras). */
  aura: {
    loop: true,
    attached: true,
    layers: [
      {
        cell: 'dot',
        capacity: 64,
        rate: 30,
        emitTime: Number.POSITIVE_INFINITY,
        life: [1, 1.6],
        size: [0.22, 0.4],
        sizeCurve: [
          [0, 0],
          [0.2, 1],
          [1, 0],
        ],
        speed: [0.4, 0.9],
        gravity: [0, 0.4, 0],
        emitter: {
          kind: 'cylinder',
          radius: 0.9,
          height: 0.1,
          dir1: [-0.05, 1, -0.05],
          dir2: [0.05, 1, 0.05],
        },
        color: '#46A758',
        color2: '#C8F5C0',
        blend: 'add',
      },
    ],
  },
  /** Rising embers (forge glow, burning ground). */
  embers: {
    loop: true,
    attached: false,
    layers: [
      {
        cell: 'spark',
        capacity: 72,
        rate: 30,
        emitTime: Number.POSITIVE_INFINITY,
        life: [1.4, 2.4],
        size: [0.18, 0.32],
        sizeCurve: [
          [0, 1],
          [1, 0.2],
        ],
        speed: [0.6, 1.6],
        gravity: [0, 0.8, 0],
        emitter: {
          kind: 'box',
          min: [-1, 0, -1],
          max: [1, 0.2, 1],
          dir1: [-0.35, 1, -0.35],
          dir2: [0.35, 1, 0.35],
        },
        color: '#FF8A3D',
        color2: '#FFD27A',
        blend: 'add',
      },
    ],
  },
  /** Slow ambient floating light (the river of raw light). */
  motes: {
    loop: true,
    attached: false,
    layers: [
      {
        cell: 'dot',
        capacity: 96,
        rate: 16,
        emitTime: Number.POSITIVE_INFINITY,
        life: [3.5, 6],
        size: [0.14, 0.3],
        sizeCurve: [
          [0, 0],
          [0.25, 1],
          [0.75, 1],
          [1, 0],
        ],
        speed: [0.1, 0.35],
        gravity: [0, 0.02, 0],
        emitter: {
          kind: 'box',
          min: [-3, 0.2, -3],
          max: [3, 1, 3],
          dir1: [-0.4, 0.4, -0.4],
          dir2: [0.4, 0.8, 0.4],
        },
        color: '#7FE3E0',
        color2: '#E8FFFE',
        blend: 'add',
      },
    ],
  },
} as const satisfies Record<string, PresetDef>;

export type PresetName = keyof typeof PRESETS;
export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

/**
 * Seconds from start until every particle of a cast is dead, given how long it
 * emitted (`emitFor`, for rate layers). Used to return rigs to the pool.
 */
export function presetLifetime(def: PresetDef, emitFor: number): number {
  let end = 0;
  for (const layer of def.layers) {
    const emitting = layer.burst ? 0 : Math.min(layer.emitTime, emitFor);
    end = Math.max(end, emitting + layer.life[1]);
  }
  return end;
}

/** Default emission time of a cast: the longest finite layer emitTime (0 for pure bursts). */
export function presetEmitTime(def: PresetDef): number {
  let t = 0;
  for (const layer of def.layers) if (!layer.burst) t = Math.max(t, layer.emitTime);
  return t;
}
