import { describe, expect, it } from 'vitest';
import { LOGICAL_STATES, type LogicalState } from '../states';
import {
  CreepAnimator,
  clipFinished,
  frameAt,
  layoutClips,
  phaseOf,
  totalFrames,
  type AnimInput,
} from './creepAnim';

const baked = layoutClips([
  { name: 'Idle', duration: 2, loop: true },
  { name: 'Walk', duration: 1, loop: true },
  { name: 'Chop', duration: 0.5, loop: false },
  { name: 'Death', duration: 1, loop: false },
]);

const clips = Object.fromEntries(LOGICAL_STATES.map((s) => [s, 'Idle'])) as Record<
  LogicalState,
  string
>;
Object.assign(clips, { run: 'Walk', attack1: 'Chop', attack2: 'Chop', death: 'Death' });
const anim = new CreepAnimator(baked, { clips, clipSpeed: { run: 1.5 } });
const input = (animState: LogicalState, animSeq?: number, attackSpeedScale = 1): AnimInput => ({
  animState,
  animSeq,
  attackSpeedScale,
});

describe('layoutClips', () => {
  it('packs clips back to back; one-shots get a closing frame', () => {
    expect(baked.map((c) => [c.start, c.count])).toEqual([
      [0, 60],
      [60, 30],
      [90, 16],
      [106, 31],
    ]);
    expect(totalFrames(baked)).toBe(137);
  });
});

describe('frameAt / clipFinished', () => {
  const [idle, , chop] = baked;
  it('wraps loops and clamps one-shots', () => {
    expect(frameAt(idle!, 0)).toBe(0);
    expect(frameAt(idle!, 2)).toBe(0);
    expect(frameAt(idle!, 2.5)).toBe(15);
    expect(frameAt(chop!, 0)).toBe(90);
    expect(frameAt(chop!, 0.5)).toBe(105);
    expect(frameAt(chop!, 9)).toBe(105);
    expect(frameAt(chop!, -1)).toBe(90);
  });
  it('only one-shots finish', () => {
    expect(clipFinished(chop!, 0.49)).toBe(false);
    expect(clipFinished(chop!, 0.5)).toBe(true);
    expect(clipFinished(idle!, 100)).toBe(false);
  });
});

describe('phaseOf', () => {
  it('is deterministic, in [0,1) and spread out', () => {
    const ps = Array.from({ length: 200 }, (_, i) => phaseOf(i + 1));
    expect(phaseOf(7)).toBe(phaseOf(7));
    expect(ps.every((p) => p >= 0 && p < 1)).toBe(true);
    expect(new Set(ps.map((p) => Math.floor(p * 10))).size).toBe(10);
  });
});

describe('CreepAnimator', () => {
  it('rejects maps naming clips that were not baked', () => {
    expect(() => new CreepAnimator(baked, { clips: { ...clips, hit: 'Nope' } })).toThrow(/Nope/);
  });

  it('starts loops at a per-unit phase and one-shots at frame 0', () => {
    const a = anim.start(input('idle'), 1);
    const b = anim.start(input('idle'), 2);
    expect(a.frame).not.toBe(b.frame);
    expect(anim.start(input('attack1', 1), 1).frame).toBe(90);
  });

  it('applies clip speed and attack speed scale', () => {
    expect(anim.speedFor('run', 2)).toBe(1.5);
    expect(anim.speedFor('attack1', 2)).toBe(2);
    expect(anim.speedFor('attack2', 0)).toBe(1);
  });

  it('falls back to idle after an attack, replays on a new animSeq', () => {
    const t = anim.start(input('attack1', 1), 5);
    anim.step(t, input('attack1', 1), 0.25, 5);
    expect(t.shown).toBe('attack1');
    expect(t.frame).toBe(90 + 7);
    anim.step(t, input('attack1', 1), 0.3, 5);
    expect(t.shown).toBe('idle');
    expect(t.frame).toBeLessThan(60);
    // Same seq: stays idle.
    anim.step(t, input('attack1', 1), 0.1, 5);
    expect(t.shown).toBe('idle');
    // New seq: replays from the top.
    anim.step(t, input('attack1', 2), 0.1, 5);
    expect(t.shown).toBe('attack1');
    expect(t.frame).toBe(90);
  });

  it('attack speed scale shortens the swing', () => {
    const t = anim.start(input('attack1', 1, 2), 5);
    anim.step(t, input('attack1', 1, 2), 0.26, 5);
    expect(t.shown).toBe('idle');
  });

  it('holds the last frame of death', () => {
    const t = anim.start(input('run'), 3);
    anim.step(t, input('death', 1), 0, 3);
    expect(t.frame).toBe(106);
    for (let i = 0; i < 10; i++) anim.step(t, input('death', 1), 0.5, 3);
    expect(t.shown).toBe('death');
    expect(t.frame).toBe(136);
  });

  it('loops keep playing until the state changes', () => {
    const t = anim.start(input('run'), 9);
    for (let i = 0; i < 100; i++) anim.step(t, input('run'), 0.05, 9);
    expect(t.shown).toBe('run');
    expect(t.frame).toBeGreaterThanOrEqual(60);
    expect(t.frame).toBeLessThan(90);
  });
});
