import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import { DEFAULT_FALLBACK, LOOPING_STATES, type LogicalState } from './states';

export { LOGICAL_STATES, LOOPING_STATES, type LogicalState } from './states';

/**
 * The slice of Babylon's AnimationGroup the controller uses. Keeping it
 * structural means the controller can be unit-tested with plain objects.
 */
export type AnimationGroupLike = Pick<
  AnimationGroup,
  'name' | 'from' | 'to' | 'weight' | 'speedRatio' | 'start' | 'stop' | 'targetedAnimations'
>;

export interface AnimationControllerOptions {
  /** Default crossfade time in seconds (default 0.2). */
  blendTime?: number;
  /** Base playback speed per state (from the model config). */
  clipSpeed?: Partial<Record<LogicalState, number>>;
  /** State to start in (default 'idle'). Pass null to start with nothing playing. */
  initialState?: LogicalState | null;
  /**
   * Drive the controller from this scene's frame loop. Without it, call
   * `update(dtSeconds)` yourself.
   */
  scene?: Scene;
}

export interface PlayOptions {
  /** Crossfade time in seconds for this transition (defaults to the controller's blendTime). */
  blend?: number;
  /** One-off speed multiplier for this play, on top of the state's base and persistent speed. */
  speed?: number;
  /** Where a one-shot goes when it ends. `null` holds the last frame. */
  fallback?: LogicalState | null;
  /** Restart a looping state that is already playing (one-shots always restart). */
  restart?: boolean;
}

export type AnimationEventHandler = (state: LogicalState, clip: string) => void;

interface ClipEvent {
  state: LogicalState;
  /** Normalized time in [0, 1]. */
  at: number;
  handler: AnimationEventHandler;
}

interface Track {
  state: LogicalState;
  group: AnimationGroupLike;
  /** Clip length in seconds at speed 1. */
  duration: number;
  loop: boolean;
  /** Playback speed this track was started with. */
  speed: number;
  /** Seconds of clip time played (scaled by speed). */
  elapsed: number;
  /** Weight at the moment it started fading out (outgoing tracks only). */
  fadeFrom: number;
  weight: number;
  fallback: LogicalState | null;
  /** True once the one-shot has handed over to its fallback. */
  done: boolean;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Plays a model's animation groups by logical state, with weighted crossfades.
 *
 * - Looping states (`idle`, `run`, `channel`) play until replaced.
 * - One-shots (attacks, casts, `hit`, `victory`, `death`) play once, then
 *   crossfade to their fallback (`idle`, or hold the last frame for `death`).
 *   The fade back starts `blend` seconds before the clip ends, so there's no freeze.
 * - Weights always sum to 1 during a fade (even when interrupted mid-fade), so
 *   the rest pose never leaks in.
 * - `setSpeed` scales a state's playback (e.g. attack speed → attack clip speed).
 * - `onEvent` fires at a normalized clip time (the "attack point").
 */
export class AnimationController {
  readonly groups: ReadonlyMap<string, AnimationGroupLike>;
  blendTime: number;

  private readonly clips: Partial<Record<LogicalState, string>>;
  private readonly baseSpeed: Partial<Record<LogicalState, number>>;
  private readonly speedScale = new Map<LogicalState, number>();
  private readonly events: ClipEvent[] = [];
  private current: Track | null = null;
  private outgoing: Track[] = [];
  /** Fade-in progress of `current`, 0..1. */
  private fadeIn = 1;
  private fadeDuration = 0;
  private observer: Observer<Scene> | null = null;
  private scene: Scene | null = null;

  constructor(
    groups: readonly AnimationGroupLike[],
    clips: Partial<Record<LogicalState, string>>,
    options: AnimationControllerOptions = {},
  ) {
    this.groups = new Map(groups.map((g) => [g.name, g]));
    this.clips = clips;
    this.baseSpeed = options.clipSpeed ?? {};
    this.blendTime = options.blendTime ?? 0.2;
    for (const g of groups) g.stop();
    for (const [state, clip] of Object.entries(clips)) {
      if (!this.groups.has(clip))
        console.warn(`[citadel] animation: no clip "${clip}" for state "${state}"`);
    }
    if (options.scene) {
      const scene = options.scene;
      this.scene = scene;
      this.observer = scene.onBeforeAnimationsObservable.add(() => {
        this.update((scene.getEngine().getDeltaTime() / 1000) * scene.animationTimeScale);
      });
    }
    const initial = options.initialState === undefined ? 'idle' : options.initialState;
    if (initial) this.play(initial, { blend: 0 });
  }

  /** The logical state currently fading in or playing. */
  get state(): LogicalState | null {
    return this.current?.state ?? null;
  }

  /** Name of the clip currently fading in or playing. */
  get activeClip(): string | null {
    return this.current?.group.name ?? null;
  }

  /** Normalized time of the current clip (0..1; loops wrap). */
  get progress(): number {
    const t = this.current;
    if (!t || t.duration <= 0) return 0;
    return t.loop ? (t.elapsed / t.duration) % 1 : clamp01(t.elapsed / t.duration);
  }

  /** Clip mapped to a state, if the model has one. */
  clipFor(state: LogicalState): string | null {
    const clip = this.clips[state];
    return clip && this.groups.has(clip) ? clip : null;
  }

  /** Clip length in seconds at speed 1, or 0 if the state has no clip. */
  durationOf(state: LogicalState): number {
    const clip = this.clipFor(state);
    return clip ? clipDuration(this.groups.get(clip)!) : 0;
  }

  /**
   * Play a logical state. Returns false (and changes nothing) if the model has
   * no clip for it.
   */
  play(state: LogicalState, options: PlayOptions = {}): boolean {
    const clip = this.clipFor(state);
    if (!clip) return false;
    const group = this.groups.get(clip)!;
    const loop = LOOPING_STATES.has(state);
    const cur = this.current;
    if (cur && cur.state === state && loop && !options.restart) return true;

    const speed = this.speedFor(state) * (options.speed ?? 1);
    const blend = Math.max(0, options.blend ?? this.blendTime);
    const fallback = options.fallback !== undefined ? options.fallback : DEFAULT_FALLBACK[state];

    // Everything currently audible fades out from its present weight.
    const fading = cur ? [...this.outgoing, cur] : [...this.outgoing];
    this.outgoing = [];
    for (const t of fading) {
      if (t.group === group) {
        // Same clip restarting: it can't crossfade with itself, so it takes over.
        continue;
      }
      t.fadeFrom = t.weight;
      if (t.weight > 0) this.outgoing.push(t);
      else t.group.stop();
    }

    // Holding states (death) run Babylon's clip once so the last frame sticks;
    // everything else loops internally and we decide when it's finished.
    const babylonLoop = loop || fallback !== null;
    group.stop();
    group.start(babylonLoop, speed, group.from, group.to);
    this.current = {
      state,
      group,
      duration: clipDuration(group),
      loop,
      speed,
      elapsed: 0,
      fadeFrom: 0,
      weight: 0,
      fallback: loop ? null : fallback,
      done: false,
    };
    this.fadeDuration = blend;
    this.fadeIn = blend === 0 || this.outgoing.length === 0 ? 1 : 0;
    this.applyWeights();
    return true;
  }

  /**
   * Persistent speed multiplier for a state (e.g. attack speed: an attack
   * clip of 1.0 s at 1.7 attacks/s → `setSpeed('attack1', 1.7)`). Applies to
   * the running clip immediately if it's that state.
   */
  setSpeed(state: LogicalState, multiplier: number): void {
    this.speedScale.set(state, multiplier);
    const t = this.current;
    if (t && t.state === state) {
      t.speed = this.speedFor(state);
      t.group.speedRatio = t.speed;
    }
  }

  /**
   * Fire `handler` when `state`'s clip crosses normalized time `at` (0..1).
   * Looping states fire once per loop. Returns an unsubscribe function.
   */
  onEvent(state: LogicalState, at: number, handler: AnimationEventHandler): () => void {
    const ev: ClipEvent = { state, at: clamp01(at), handler };
    this.events.push(ev);
    return () => {
      const i = this.events.indexOf(ev);
      if (i >= 0) this.events.splice(i, 1);
    };
  }

  /** Advance blending, events and one-shot completion by `dt` seconds. */
  update(dt: number): void {
    if (dt < 0) return;
    if (this.fadeIn < 1) {
      this.fadeIn = this.fadeDuration > 0 ? clamp01(this.fadeIn + dt / this.fadeDuration) : 1;
    }
    // Outgoing tracks keep playing while they fade. A one-shot that finished
    // naturally still fires its late events (e.g. an attack point at 0.9);
    // an interrupted one (attack cancel) does not.
    for (const o of this.outgoing) {
      const prev = o.elapsed;
      o.elapsed += dt * o.speed;
      if (o.done) this.fireEvents(o, prev, o.elapsed);
    }
    const t = this.current;
    if (t) {
      const prev = t.elapsed;
      t.elapsed += dt * t.speed;
      this.fireEvents(t, prev, t.elapsed);
      if (!t.loop && !t.done && t.duration > 0) {
        const remaining = (t.duration - t.elapsed) / Math.max(t.speed, 1e-6);
        if (t.fallback !== null) {
          const blendOut = Math.min(this.blendTime, t.duration / Math.max(t.speed, 1e-6) / 2);
          if (remaining <= blendOut) {
            t.done = true;
            this.play(t.fallback, { blend: Math.max(0, remaining) });
          }
        } else if (t.elapsed >= t.duration) {
          t.done = true; // held on the last frame by Babylon (non-looping start)
        }
      }
    }
    this.applyWeights();
  }

  /** Stop everything and detach from the scene. */
  dispose(): void {
    if (this.observer && this.scene) this.scene.onBeforeAnimationsObservable.remove(this.observer);
    this.observer = null;
    for (const g of this.groups.values()) g.stop();
    this.current = null;
    this.outgoing = [];
    this.events.length = 0;
  }

  /** Debug snapshot: which clips are audible and at what weight. */
  debugWeights(): { clip: string; state: LogicalState; weight: number }[] {
    const all = this.current ? [this.current, ...this.outgoing] : this.outgoing;
    return all.map((t) => ({ clip: t.group.name, state: t.state, weight: t.weight }));
  }

  private speedFor(state: LogicalState): number {
    return (this.baseSpeed[state] ?? 1) * (this.speedScale.get(state) ?? 1);
  }

  private applyWeights(): void {
    const w = this.fadeIn;
    if (this.current) {
      this.current.weight = w;
      this.current.group.weight = w;
    }
    const total = this.outgoing.reduce((s, t) => s + t.fadeFrom, 0);
    const keep: Track[] = [];
    for (const t of this.outgoing) {
      t.weight = total > 0 ? (t.fadeFrom / total) * (1 - w) : 0;
      if (t.weight <= 1e-4) {
        t.weight = 0;
        t.group.stop();
      } else {
        t.group.weight = t.weight;
        keep.push(t);
      }
    }
    this.outgoing = keep;
  }

  private fireEvents(t: Track, from: number, to: number): void {
    if (t.duration <= 0 || this.events.length === 0) return;
    const a = from / t.duration;
    const b = to / t.duration;
    for (const ev of this.events.slice()) {
      if (ev.state !== t.state) continue;
      if (t.loop) {
        // Count crossings of at + k for every whole loop k between a and b.
        const first = Math.ceil(a - ev.at + (a === 0 && ev.at === 0 ? 0 : 1e-9));
        const last = Math.floor(b - ev.at);
        for (let k = Math.max(first, 0); k <= last; k++) ev.handler(t.state, t.group.name);
      } else if ((a < ev.at || (a === 0 && ev.at === 0)) && b >= ev.at && a <= 1) {
        ev.handler(t.state, t.group.name);
      }
    }
  }
}

/** Length of an animation group in seconds at speed 1. */
export function clipDuration(group: AnimationGroupLike): number {
  const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
  return Math.max(0, group.to - group.from) / fps;
}
