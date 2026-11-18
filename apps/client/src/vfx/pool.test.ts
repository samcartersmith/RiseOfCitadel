import { describe, expect, it } from 'vitest';
import { Pool } from './pool';

function counterPool(max?: number) {
  let made = 0;
  const released: number[] = [];
  const pool = new Pool<{ id: number; resets: number }>({
    create: () => ({ id: ++made, resets: 0 }),
    onRelease: (item) => {
      item.resets++;
      released.push(item.id);
    },
    max,
  });
  return { pool, released, made: () => made };
}

describe('Pool', () => {
  it('reuses released items instead of creating new ones', () => {
    const { pool, made } = counterPool();
    const a = pool.acquire()!;
    pool.release(a);
    const b = pool.acquire()!;
    expect(b).toBe(a);
    expect(made()).toBe(1);
    expect(b.resets).toBe(1);
  });

  it('tracks active, free and created counts', () => {
    const { pool } = counterPool();
    const items = [pool.acquire()!, pool.acquire()!, pool.acquire()!];
    expect(pool.activeCount).toBe(3);
    expect(pool.freeCount).toBe(0);
    pool.release(items[1]!);
    expect(pool.activeCount).toBe(2);
    expect(pool.freeCount).toBe(1);
    expect(pool.size).toBe(3);
  });

  it('ignores double release', () => {
    const { pool, released } = counterPool();
    const a = pool.acquire()!;
    expect(pool.release(a)).toBe(true);
    expect(pool.release(a)).toBe(false);
    expect(released).toEqual([1]);
    expect(pool.freeCount).toBe(1);
  });

  it('returns null past max, and acquireOrSteal recycles the oldest active item', () => {
    const { pool, released, made } = counterPool(2);
    const a = pool.acquire()!;
    const b = pool.acquire()!;
    expect(pool.acquire()).toBeNull();
    const c = pool.acquireOrSteal();
    expect(c).toBe(a); // oldest was recycled
    expect(released).toEqual([a.id]);
    expect(made()).toBe(2);
    expect(pool.isActive(b)).toBe(true);
    expect(pool.oldestActive()).toBe(b);
  });

  it('prewarm creates free items up to max', () => {
    const { pool, made } = counterPool(3);
    pool.prewarm(5);
    expect(made()).toBe(3);
    expect(pool.freeCount).toBe(3);
    expect(pool.activeCount).toBe(0);
  });

  it('releaseAll returns everything and forEach visits every item', () => {
    const { pool } = counterPool();
    pool.acquire();
    pool.acquire();
    pool.prewarm(3);
    pool.releaseAll();
    expect(pool.activeCount).toBe(0);
    let n = 0;
    pool.forEach(() => n++);
    expect(n).toBe(pool.size);
  });

  it('steady-state churn never allocates once warm', () => {
    const { pool, made } = counterPool(8);
    const live: { id: number; resets: number }[] = [];
    for (let frame = 0; frame < 1000; frame++) {
      live.push(pool.acquireOrSteal());
      if (live.length > 5) pool.release(live.shift()!);
    }
    expect(made()).toBeLessThanOrEqual(6);
  });
});
