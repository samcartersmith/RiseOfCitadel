import { describe, expect, it } from 'vitest';
import { SIEGE_CLIPS, siegePose, throwCurve, type SiegeClip } from './siegePose';

describe('throwCurve', () => {
  it('snaps forward, holds, then winches back to rest', () => {
    expect(throwCurve(0)).toBe(0);
    expect(throwCurve(0.18)).toBeCloseTo(1.9);
    expect(throwCurve(0.3)).toBeCloseTo(1.9);
    expect(throwCurve(0.8)).toBeGreaterThan(0);
    expect(throwCurve(0.8)).toBeLessThan(1.9);
    expect(throwCurve(1.3)).toBeCloseTo(0);
    expect(throwCurve(5)).toBeCloseTo(0);
  });
});

describe('siegePose', () => {
  const close = (a: object, b: object) => {
    for (const [k, v] of Object.entries(a))
      expect(v).toBeCloseTo((b as Record<string, number>)[k]!, 6);
  };

  it('loops are seamless (pose at t=0 matches t=duration, mod a full wheel turn)', () => {
    for (const clip of ['idle', 'move'] as SiegeClip[]) {
      const a = siegePose(clip, 0);
      const b = siegePose(clip, SIEGE_CLIPS[clip].duration);
      close({ ...a, wheel: 0 }, { ...b, wheel: 0 });
      expect(Math.cos(a.wheel)).toBeCloseTo(Math.cos(b.wheel));
    }
  });

  it('fire throws the arm and ends at rest', () => {
    expect(siegePose('fire', 0.3).arm).toBeCloseTo(1.9);
    expect(Math.abs(siegePose('fire', SIEGE_CLIPS.fire.duration).arm)).toBeLessThan(0.01);
  });

  it('one-shots clamp past their end', () => {
    for (const clip of ['fire', 'wreck'] as SiegeClip[]) {
      const d = SIEGE_CLIPS[clip].duration;
      close(siegePose(clip, d + 3), siegePose(clip, d));
    }
  });

  it('wreck tips the engine over and sinks it', () => {
    const end = siegePose('wreck', SIEGE_CLIPS.wreck.duration);
    expect(end.bodyRoll).toBeGreaterThan(0.5);
    expect(end.bodyY).toBeLessThan(-0.4);
    close(siegePose('wreck', 0), { bodyY: 0, bodyPitch: 0, bodyRoll: 0, arm: 0, wheel: 0 });
  });
});
