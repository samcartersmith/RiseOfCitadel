/**
 * Rebindable action → key map. Keys are `KeyboardEvent.code` values (layout
 * independent, so "KeyW" is the same physical key on QWERTY and AZERTY).
 * An action may have several keys. No UI yet; the settings screen will call
 * `setBinding`. Persisted to localStorage when it's available.
 */

export const ACTIONS = [
  'cameraPanUp',
  'cameraPanDown',
  'cameraPanLeft',
  'cameraPanRight',
  'cameraCenterHero',
] as const;

export type Action = (typeof ACTIONS)[number];
export type Bindings = Record<Action, string[]>;

/** Arrow keys pan by default. WASD is off by default (it'll be used for abilities). */
export const DEFAULT_BINDINGS: Readonly<Bindings> = Object.freeze({
  cameraPanUp: ['ArrowUp'],
  cameraPanDown: ['ArrowDown'],
  cameraPanLeft: ['ArrowLeft'],
  cameraPanRight: ['ArrowRight'],
  cameraCenterHero: ['Space'],
});

/** Opt-in preset: arrows plus WASD for camera pan. */
export const WASD_PAN_BINDINGS: Partial<Bindings> = {
  cameraPanUp: ['ArrowUp', 'KeyW'],
  cameraPanDown: ['ArrowDown', 'KeyS'],
  cameraPanLeft: ['ArrowLeft', 'KeyA'],
  cameraPanRight: ['ArrowRight', 'KeyD'],
};

export const STORAGE_KEY = 'citadel.bindings.v1';

/** The subset of the Web Storage API we use, so tests can pass a fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // e.g. storage disabled / sandboxed iframe
  }
}

function cloneDefaults(): Bindings {
  const out = {} as Bindings;
  for (const a of ACTIONS) out[a] = [...DEFAULT_BINDINGS[a]];
  return out;
}

function isAction(k: string): k is Action {
  return (ACTIONS as readonly string[]).includes(k);
}

function parse(raw: string | null): Partial<Bindings> {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return {};
    const out: Partial<Bindings> = {};
    for (const [k, v] of Object.entries(data)) {
      if (isAction(k) && Array.isArray(v) && v.every((c) => typeof c === 'string')) {
        out[k] = v as string[];
      }
    }
    return out;
  } catch {
    return {};
  }
}

export class InputBindings {
  private map: Bindings;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: KeyValueStore | null = defaultStore()) {
    this.map = cloneDefaults();
    try {
      Object.assign(this.map, parse(this.store?.getItem(STORAGE_KEY) ?? null));
    } catch {
      // storage unavailable: keep defaults
    }
  }

  get(action: Action): readonly string[] {
    return this.map[action];
  }

  all(): Readonly<Bindings> {
    return this.map;
  }

  /** True if `code` is bound to `action`. */
  matches(action: Action, code: string): boolean {
    return this.map[action].includes(code);
  }

  /** Every action bound to `code`. */
  actionsFor(code: string): Action[] {
    return ACTIONS.filter((a) => this.map[a].includes(code));
  }

  setBinding(action: Action, codes: string | readonly string[]): void {
    this.map[action] = typeof codes === 'string' ? [codes] : [...codes];
    this.save();
  }

  apply(preset: Partial<Bindings>): void {
    for (const [k, v] of Object.entries(preset)) {
      if (isAction(k) && v) this.map[k] = [...v];
    }
    this.save();
  }

  reset(): void {
    this.map = cloneDefaults();
    try {
      this.store?.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable: defaults still apply for this session
    }
    this.emit();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private save() {
    try {
      this.store?.setItem(STORAGE_KEY, JSON.stringify(this.map));
    } catch {
      // quota exceeded / storage disabled: keep the in-memory binding
    }
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

let shared: InputBindings | null = null;

/** The app-wide bindings instance, loaded from localStorage on first use. */
export function getBindings(): InputBindings {
  shared ??= new InputBindings();
  return shared;
}

/** Shorthand for `getBindings().setBinding(...)`. */
export function setBinding(action: Action, codes: string | readonly string[]): void {
  getBindings().setBinding(action, codes);
}
