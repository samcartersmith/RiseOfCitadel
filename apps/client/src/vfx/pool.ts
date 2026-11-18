/**
 * Generic object pool. Pure TypeScript (no Babylon) so it is unit-tested in Node.
 *
 * Every VFX primitive (particle rigs, telegraphs, projectiles) is created once
 * and recycled through one of these, so casting an ability never allocates
 * engine objects after warm-up.
 */
export interface PoolOptions<T> {
  /** Builds a new item. Only called while the pool is below `max`. */
  create: () => T;
  /** Runs when an item is handed out (before the caller configures it). */
  onAcquire?: (item: T) => void;
  /** Runs when an item comes back: stop it, hide it, clear references. */
  onRelease?: (item: T) => void;
  /** Hard cap on items ever created (active + free). Defaults to unbounded. */
  max?: number;
}

export class Pool<T> {
  private readonly free: T[] = [];
  /** Insertion-ordered, so the first entry is always the oldest active item. */
  private readonly active = new Set<T>();
  private created = 0;
  readonly max: number;

  constructor(private readonly options: PoolOptions<T>) {
    this.max = options.max ?? Number.POSITIVE_INFINITY;
  }

  /** Items currently handed out. */
  get activeCount(): number {
    return this.active.size;
  }

  /** Items sitting in the pool, ready to reuse. */
  get freeCount(): number {
    return this.free.length;
  }

  /** Items ever created (active + free). */
  get size(): number {
    return this.created;
  }

  /** Creates up to `count` free items ahead of time (never past `max`). */
  prewarm(count: number): void {
    while (this.created < this.max && this.free.length < count) {
      this.free.push(this.options.create());
      this.created++;
    }
  }

  /**
   * Hands out a free item, creating one if the pool is below `max`.
   * Returns null when every item is in use; see `acquireOrSteal`.
   */
  acquire(): T | null {
    let item = this.free.pop();
    if (item === undefined) {
      if (this.created >= this.max) return null;
      item = this.options.create();
      this.created++;
    }
    this.active.add(item);
    this.options.onAcquire?.(item);
    return item;
  }

  /**
   * Like `acquire`, but when the pool is exhausted it recycles the oldest
   * active item first. That keeps the effect budget hard-capped: a 51st
   * concurrent cast replaces the oldest one instead of allocating.
   */
  acquireOrSteal(): T {
    const item = this.acquire();
    if (item !== null) return item;
    const oldest = this.oldestActive();
    if (oldest === undefined) throw new Error('Pool with max 0 cannot hand out items');
    this.release(oldest);
    return this.acquire()!;
  }

  /** Returns an item to the pool. Returns false if it was not active (double release). */
  release(item: T): boolean {
    if (!this.active.delete(item)) return false;
    this.options.onRelease?.(item);
    this.free.push(item);
    return true;
  }

  isActive(item: T): boolean {
    return this.active.has(item);
  }

  oldestActive(): T | undefined {
    for (const item of this.active) return item;
    return undefined;
  }

  /** Releases every active item. */
  releaseAll(): void {
    for (const item of [...this.active]) this.release(item);
  }

  /** Visits every item ever created (for disposal or global setting changes). */
  forEach(fn: (item: T) => void): void {
    for (const item of this.active) fn(item);
    for (const item of this.free) fn(item);
  }
}
