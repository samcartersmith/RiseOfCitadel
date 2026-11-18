/**
 * Per-instance animation for baked (vertex-animation-texture) creeps.
 *
 * Every frame of every clip a creep type uses is baked once into one texture
 * (creepBatch.ts). Each instance then only needs a frame index, which the CPU
 * picks here from the unit's logical state and passes to the GPU as a
 * per-instance attribute. No skeleton per unit, no crossfades: a state change
 * cuts straight to the new clip, which reads fine at creep size.
 *
 * Semantics follow UnitView (docs/design/units.md §2): loops play until the
 * state changes; a one-shot replays when `animSeq` changes; a finished one-shot
 * falls back to idle on its own, except death, which holds its last frame.
 *
 * Pure (no Babylon), unit-tested in creepAnim.test.ts.
 */
import { DEFAULT_FALLBACK, LOOPING_STATES, type LogicalState } from '../states';

/** Frames per second the clips are baked at. */
export const VAT_FPS = 30;

export interface ClipSource {
  name: string;
  /** Clip length in seconds at speed 1. */
  duration: number;
  loop: boolean;
}

/** Where a clip lives in the baked texture. */
export interface BakedClip {
  name: string;
  /** First texture row of the clip. */
  start: number;
  /** Rows the clip occupies. */
  count: number;
  duration: number;
  loop: boolean;
}

/**
 * Lay clips out back to back. A loop bakes `round(duration * fps)` frames (its
 * last frame would equal its first); a one-shot bakes one more so it ends
 * exactly on its final pose.
 */
export function layoutClips(clips: readonly ClipSource[], fps = VAT_FPS): BakedClip[] {
  const out: BakedClip[] = [];
  let start = 0;
  for (const c of clips) {
    const frames = Math.max(1, Math.round(c.duration * fps));
    const count = c.loop ? frames : frames + 1;
    out.push({ name: c.name, start, count, duration: c.duration, loop: c.loop });
    start += count;
  }
  return out;
}

export function totalFrames(clips: readonly BakedClip[]): number {
  return clips.reduce((n, c) => n + c.count, 0);
}

/** Texture row for `elapsed` seconds into a clip (loops wrap, one-shots clamp). */
export function frameAt(clip: BakedClip, elapsed: number, fps = VAT_FPS): number {
  let i = Math.floor(Math.max(0, elapsed) * fps + 1e-6);
  if (clip.loop) i %= clip.count;
  else i = Math.min(clip.count - 1, i);
  return clip.start + i;
}

/** Has a one-shot played to its end? (Loops never finish.) */
export function clipFinished(clip: BakedClip, elapsed: number): boolean {
  return !clip.loop && elapsed >= clip.duration;
}

/** Deterministic per-unit phase in [0, 1) so a crowd's idles and walks don't march in step. */
export function phaseOf(id: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface CreepClipMap {
  /** Logical state → clip name (must exist in `clips`). */
  clips: Readonly<Record<LogicalState, string>>;
  /** Base playback speed per state (default 1). */
  clipSpeed?: Readonly<Partial<Record<LogicalState, number>>>;
}

/** One instance's animation track. Plain data so it is cheap to keep per unit. */
export interface CreepTrack {
  /** The state being shown (may differ from the requested one after a one-shot ends). */
  shown: LogicalState;
  /** Logical state last requested by the unit's state object. */
  requested: LogicalState;
  seq: number | undefined;
  /** Seconds of clip time played (already scaled by speed). */
  elapsed: number;
  /** Texture row to draw this frame. */
  frame: number;
}

export interface AnimInput {
  animState: LogicalState;
  animSeq?: number;
  attackSpeedScale: number;
}

export class CreepAnimator {
  private readonly byName = new Map<string, BakedClip>();
  constructor(
    readonly baked: readonly BakedClip[],
    readonly map: CreepClipMap,
  ) {
    for (const c of baked) this.byName.set(c.name, c);
    for (const name of Object.values(map.clips)) {
      if (!this.byName.has(name)) throw new Error(`clip "${name}" is not baked`);
    }
  }

  clipFor(state: LogicalState): BakedClip {
    return this.byName.get(this.map.clips[state])!;
  }

  speedFor(state: LogicalState, attackSpeedScale: number): number {
    const base = this.map.clipSpeed?.[state] ?? 1;
    const k = state === 'attack1' || state === 'attack2' ? attackSpeedScale : 1;
    return base * (k > 0 ? k : 1);
  }

  /** A fresh track. Loops start at a per-unit phase; one-shots start at their first frame. */
  start(input: AnimInput, id: number): CreepTrack {
    const t: CreepTrack = {
      shown: input.animState,
      requested: input.animState,
      seq: input.animSeq,
      elapsed: 0,
      frame: 0,
    };
    const clip = this.clipFor(t.shown);
    if (clip.loop) t.elapsed = phaseOf(id) * clip.duration;
    t.frame = frameAt(clip, t.elapsed);
    return t;
  }

  /** Advance a track by `dt` seconds for this frame's state. Mutates and returns `t`. */
  step(t: CreepTrack, input: AnimInput, dt: number, id: number): CreepTrack {
    const replay =
      input.animSeq !== undefined &&
      input.animSeq !== t.seq &&
      !LOOPING_STATES.has(input.animState);
    if (input.animState !== t.requested || replay) {
      t.requested = input.animState;
      t.shown = input.animState;
      const clip = this.clipFor(t.shown);
      t.elapsed = clip.loop ? phaseOf(id) * clip.duration : 0;
    } else {
      t.elapsed += dt * this.speedFor(t.shown, input.attackSpeedScale);
    }
    t.seq = input.animSeq;

    let clip = this.clipFor(t.shown);
    if (clipFinished(clip, t.elapsed)) {
      const next = DEFAULT_FALLBACK[t.shown];
      if (next === null || next === t.shown) {
        // Hold the last frame (death).
        t.elapsed = clip.duration;
      } else {
        const over = t.elapsed - clip.duration;
        t.shown = next;
        clip = this.clipFor(next);
        t.elapsed = clip.loop ? (phaseOf(id) * clip.duration + over) % clip.duration : over;
      }
    }
    t.frame = frameAt(clip, t.elapsed);
    return t;
  }
}
