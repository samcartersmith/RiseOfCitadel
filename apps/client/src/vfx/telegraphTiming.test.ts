import { describe, expect, it } from 'vitest';
import { makeTiming, pulseFactor, telegraphFrame, totalDuration } from './telegraphTiming';

// Crucible Drop: a 1 s delayed area, then a short hold and fade.
const drop = makeTiming({ fadeIn: 0.1, fillTime: 1, flash: 0.2, hold: 0.1, fadeOut: 0.3 });

describe('telegraph timing', () => {
  it('fills linearly over fillTime', () => {
    expect(telegraphFrame(0, drop).fill).toBe(0);
    expect(telegraphFrame(0.25, drop).fill).toBeCloseTo(0.25);
    expect(telegraphFrame(0.5, drop).fill).toBeCloseTo(0.5);
    expect(telegraphFrame(1, drop).fill).toBe(1);
    expect(telegraphFrame(1.05, drop).fill).toBe(1);
  });

  it('fades in, holds at full alpha, then fades out', () => {
    expect(telegraphFrame(0, drop).alpha).toBe(0);
    expect(telegraphFrame(0.05, drop).alpha).toBeCloseTo(0.5);
    expect(telegraphFrame(0.5, drop).alpha).toBe(1);
    // holdEnd = 1.1, fadeOut 0.3
    expect(telegraphFrame(1.25, drop).alpha).toBeCloseTo(0.5);
    expect(telegraphFrame(1.41, drop).phase).toBe('done');
    expect(telegraphFrame(1.41, drop).alpha).toBe(0);
  });

  it('reports phases in order', () => {
    expect(telegraphFrame(0.5, drop).phase).toBe('filling');
    expect(telegraphFrame(1.05, drop).phase).toBe('hold');
    expect(telegraphFrame(1.2, drop).phase).toBe('fadeOut');
    expect(telegraphFrame(2, drop).phase).toBe('done');
  });

  it('flashes right after the fill completes', () => {
    expect(telegraphFrame(0.99, drop).flash).toBe(0);
    expect(telegraphFrame(1, drop).flash).toBe(1);
    expect(telegraphFrame(1.1, drop).flash).toBeCloseTo(0.5);
    expect(telegraphFrame(1.25, drop).flash).toBe(0);
  });

  it('instant decals are full immediately and never flash', () => {
    const instant = makeTiming({ fillTime: 0, hold: 2 });
    const f = telegraphFrame(0.5, instant);
    expect(f.fill).toBe(1);
    expect(f.flash).toBe(0);
    expect(f.phase).toBe('hold');
  });

  it('stopping early fades out from the stop time', () => {
    const forever = makeTiming({ fillTime: 0, hold: Number.POSITIVE_INFINITY, fadeOut: 0.2 });
    expect(totalDuration(forever)).toBe(Number.POSITIVE_INFINITY);
    expect(telegraphFrame(100, forever).phase).toBe('hold');
    expect(telegraphFrame(3.1, forever, 3).phase).toBe('fadeOut');
    expect(telegraphFrame(3.1, forever, 3).alpha).toBeCloseTo(0.5);
    expect(telegraphFrame(3.2, forever, 3).phase).toBe('done');
    expect(totalDuration(forever, 3)).toBeCloseTo(3.2);
  });

  it('total duration covers fill + hold + fade', () => {
    expect(totalDuration(drop)).toBeCloseTo(1.4);
  });

  it('writes into the provided frame object (no per-frame allocation)', () => {
    const out = { fill: 0, alpha: 0, flash: 0, phase: 'filling' as const };
    const res = telegraphFrame(0.5, drop, undefined, out);
    expect(res).toBe(out);
  });

  it('pulse stays within 1 - amplitude .. 1 and is steady at amplitude 0', () => {
    for (let t = 0; t < 2; t += 0.01) {
      const v = pulseFactor(t, 0.3, t / 2);
      expect(v).toBeGreaterThanOrEqual(0.7 - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(pulseFactor(0.4, 0, 0.5)).toBe(1);
  });
});
