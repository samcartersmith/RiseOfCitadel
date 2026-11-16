import { describe, expect, it } from 'vitest';
import {
  CREEP_BAR,
  DEFAULT_TRAIL,
  HERO_BAR,
  barFill,
  barLayoutFor,
  initialTrail,
  stepTrail,
  tickFractions,
  tickSpacingPx,
  type TrailState,
} from './barMath';

describe('barFill', () => {
  it('is value/max clamped to [0, 1]', () => {
    expect(barFill(50, 200)).toBe(0.25);
    expect(barFill(-5, 100)).toBe(0);
    expect(barFill(150, 100)).toBe(1);
  });
  it('is 0 for a bad max or NaN', () => {
    expect(barFill(10, 0)).toBe(0);
    expect(barFill(10, -1)).toBe(0);
    expect(barFill(NaN, 100)).toBe(0);
  });
});

describe('damage trail', () => {
  const run = (t: TrailState, prev: number, fill: number, dt: number) =>
    stepTrail(t, prev, fill, dt, DEFAULT_TRAIL);

  it('holds at the old HP after damage, then drains to the new HP', () => {
    let t = initialTrail(1);
    t = run(t, 1, 0.6, 0.016);
    expect(t.value).toBe(1); // still showing the chunk that was lost
    expect(t.hold).toBeCloseTo(DEFAULT_TRAIL.holdSeconds);
    // During the hold nothing moves.
    t = run(t, 0.6, 0.6, DEFAULT_TRAIL.holdSeconds / 2);
    expect(t.value).toBe(1);
    // After the hold it drains at drainPerSecond...
    t = run(t, 0.6, 0.6, DEFAULT_TRAIL.holdSeconds / 2 + 0.001);
    t = run(t, 0.6, 0.6, 0.1);
    expect(t.value).toBeCloseTo(1 - DEFAULT_TRAIL.drainPerSecond * 0.1, 2);
    // ...and stops exactly at the fill.
    for (let i = 0; i < 100; i++) t = run(t, 0.6, 0.6, 0.05);
    expect(t.value).toBe(0.6);
  });

  it('restarts the hold on fresh damage', () => {
    let t = initialTrail(1);
    t = run(t, 1, 0.8, 0.016);
    t = run(t, 0.8, 0.8, 0.3);
    t = run(t, 0.8, 0.7, 0.016);
    expect(t.hold).toBeCloseTo(DEFAULT_TRAIL.holdSeconds);
    expect(t.value).toBe(1);
  });

  it('follows healing instantly and never sits below the fill', () => {
    let t: TrailState = { value: 0.5, hold: 0.2 };
    t = run(t, 0.4, 0.9, 0.016);
    expect(t).toEqual({ value: 0.9, hold: 0 });
  });
});

describe('ticks', () => {
  it('places a tick every 100 HP, excluding the ends', () => {
    expect(tickFractions(250)).toEqual([0.4, 0.8]);
    expect(tickFractions(300).map((x) => +x.toFixed(4))).toEqual([0.3333, 0.6667]);
    expect(tickFractions(100)).toEqual([]);
    expect(tickFractions(0)).toEqual([]);
  });

  it('spacing in pixels matches the bar width, and drops ticks that would smear', () => {
    expect(tickSpacingPx(700, HERO_BAR.width)).toBeCloseTo(72 / 7);
    expect(tickSpacingPx(5000, HERO_BAR.width)).toBe(0); // 1.4 px apart: too dense
    expect(tickSpacingPx(80, HERO_BAR.width)).toBe(0); // no full chunk
  });
});

describe('barLayoutFor', () => {
  it('heroes get the wide bar with a mana row; creeps the small one', () => {
    expect(barLayoutFor(true, true)).toEqual(HERO_BAR);
    expect(barLayoutFor(true, false).manaHeight).toBe(0);
    expect(barLayoutFor(false, true)).toEqual(CREEP_BAR);
    expect(CREEP_BAR.width).toBeLessThan(HERO_BAR.width);
  });
});
