/**
 * Procedural animation for the siege engines (docs/design/creeps.md §4).
 *
 * A siege engine is rigid parts on a 4-bone rig built in code: the body
 * (chassis + catapult turret), the throwing arm and the front/back axles.
 * These curves give each part's offset at time `t` into a clip; siegeMesh.ts
 * turns them into bone matrices and bakes them into the same kind of vertex
 * animation texture the skinned creeps use, so a siege engine is still one
 * draw call per type.
 *
 * Pure (no Babylon), unit-tested in siegePose.test.ts.
 */
import type { ClipSource } from './creepAnim';

export const SIEGE_CLIPS = {
  idle: { name: 'Siege_Idle', duration: 2, loop: true },
  move: { name: 'Siege_Move', duration: 1, loop: true },
  fire: { name: 'Siege_Fire', duration: 1.4, loop: false },
  wreck: { name: 'Siege_Wreck', duration: 1.6, loop: false },
} as const satisfies Record<string, ClipSource>;

export type SiegeClip = keyof typeof SIEGE_CLIPS;

export interface SiegePose {
  /** Body lift (world units at scale 1). */
  bodyY: number;
  /** Body pitch (radians, positive = nose down) and roll (radians). */
  bodyPitch: number;
  bodyRoll: number;
  /** Arm angle from rest (radians, positive = thrown forward). */
  arm: number;
  /** Wheel spin (radians). */
  wheel: number;
}

const ease = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Arm swing of a throw: a fast snap forward, a short hold, a slow winch back. */
export function throwCurve(t: number): number {
  const ARC = 1.9;
  if (t < 0.18) return ARC * ease(t / 0.18);
  if (t < 0.45) return ARC;
  return ARC * (1 - ease(clamp01((t - 0.45) / 0.85)));
}

/** Pose of a siege engine `t` seconds into a clip (one-shots clamp at their end). */
export function siegePose(clip: SiegeClip, t: number): SiegePose {
  const d = SIEGE_CLIPS[clip].duration;
  const p: SiegePose = { bodyY: 0, bodyPitch: 0, bodyRoll: 0, arm: 0, wheel: 0 };
  switch (clip) {
    case 'idle': {
      // A slow creak so a parked engine isn't dead still.
      const w = (2 * Math.PI * t) / d;
      p.bodyPitch = 0.012 * Math.sin(w);
      p.arm = 0.04 * (0.5 - 0.5 * Math.cos(w));
      break;
    }
    case 'move': {
      const w = (2 * Math.PI * t) / d;
      p.bodyY = 0.035 * Math.abs(Math.sin(2 * w));
      p.bodyRoll = 0.03 * Math.sin(w);
      p.bodyPitch = 0.015 * Math.sin(2 * w);
      p.arm = 0.05 * Math.sin(2 * w);
      // One full wheel turn per loop, so the loop is seamless.
      p.wheel = w;
      break;
    }
    case 'fire': {
      const tt = Math.min(t, d);
      p.arm = throwCurve(tt);
      // The chassis kicks back as the arm hits its stop, then settles.
      const kick = tt > 0.15 ? Math.exp(-(tt - 0.15) * 7) * Math.sin((tt - 0.15) * 22) : 0;
      p.bodyPitch = -0.07 * kick;
      p.bodyY = 0.03 * Math.max(0, kick);
      break;
    }
    case 'wreck': {
      const k = ease(clamp01(Math.min(t, d) / d));
      p.bodyRoll = 0.55 * k;
      p.bodyPitch = 0.18 * k;
      p.bodyY = -0.45 * k;
      p.arm = -0.6 * k;
      p.wheel = 0.8 * k;
      break;
    }
  }
  return p;
}
