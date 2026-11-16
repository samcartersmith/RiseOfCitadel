import { Rng } from './rng';

/** Simulation rate. Everything in the sim is expressed in ticks. */
export const TICK_RATE = 30;
export const TICK_SECONDS = 1 / TICK_RATE;

export interface WorldOptions {
  seed: number;
}

/**
 * M0 stub of the simulation world. M2-01 replaces this with the real
 * entity store, command queue and systems; the public shape (tick(),
 * hash()) is what the server, client bridge and replay tools rely on.
 */
export class World {
  readonly rng: Rng;
  tick = 0;

  constructor(options: WorldOptions) {
    this.rng = new Rng(options.seed);
  }

  /** Advance the simulation by exactly one fixed tick. */
  step(): void {
    this.tick += 1;
  }

  /** Cheap state hash used by replay/determinism checks (FNV-1a). */
  hash(): number {
    let h = 0x811c9dc5;
    for (const v of [this.tick, this.rng.getState()]) {
      h ^= v >>> 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }
}
