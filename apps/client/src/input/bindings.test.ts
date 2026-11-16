import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDINGS,
  InputBindings,
  STORAGE_KEY,
  WASD_PAN_BINDINGS,
  type KeyValueStore,
} from './bindings';
import { DoubleTap } from './keys';

function memoryStore(init: Record<string, string> = {}): KeyValueStore & { data: typeof init } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

const throwingStore: KeyValueStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('InputBindings', () => {
  it('starts from defaults: arrows pan, Space centers, WASD off', () => {
    const b = new InputBindings(memoryStore());
    expect(b.all()).toEqual(DEFAULT_BINDINGS);
    expect(b.matches('cameraPanUp', 'ArrowUp')).toBe(true);
    expect(b.matches('cameraPanUp', 'KeyW')).toBe(false);
    expect(b.actionsFor('Space')).toEqual(['cameraCenterHero']);
  });

  it('setBinding rebinds and persists', () => {
    const store = memoryStore();
    const b = new InputBindings(store);
    b.setBinding('cameraCenterHero', 'KeyF');
    expect(b.matches('cameraCenterHero', 'KeyF')).toBe(true);
    expect(b.matches('cameraCenterHero', 'Space')).toBe(false);
    const reloaded = new InputBindings(store);
    expect(reloaded.get('cameraCenterHero')).toEqual(['KeyF']);
  });

  it('applies the WASD preset and resets', () => {
    const store = memoryStore();
    const b = new InputBindings(store);
    b.apply(WASD_PAN_BINDINGS);
    expect(b.matches('cameraPanLeft', 'KeyA')).toBe(true);
    expect(b.matches('cameraPanLeft', 'ArrowLeft')).toBe(true);
    b.reset();
    expect(b.all()).toEqual(DEFAULT_BINDINGS);
    expect(store.data[STORAGE_KEY]).toBeUndefined();
  });

  it('works when storage is missing or throws', () => {
    for (const store of [null, throwingStore]) {
      const b = new InputBindings(store);
      expect(() => b.setBinding('cameraPanUp', ['KeyI'])).not.toThrow();
      expect(b.get('cameraPanUp')).toEqual(['KeyI']);
      expect(() => b.reset()).not.toThrow();
    }
  });

  it('ignores corrupt or unknown saved data', () => {
    const store = memoryStore({
      [STORAGE_KEY]: JSON.stringify({ cameraPanUp: ['KeyI'], bogus: ['KeyX'], cameraPanDown: 7 }),
    });
    const b = new InputBindings(store);
    expect(b.get('cameraPanUp')).toEqual(['KeyI']);
    expect(b.get('cameraPanDown')).toEqual(DEFAULT_BINDINGS.cameraPanDown);
    expect(new InputBindings(memoryStore({ [STORAGE_KEY]: '{nope' })).all()).toEqual(
      DEFAULT_BINDINGS,
    );
  });

  it('notifies listeners on change', () => {
    const b = new InputBindings(memoryStore());
    let calls = 0;
    const off = b.onChange(() => calls++);
    b.setBinding('cameraPanUp', 'KeyI');
    off();
    b.setBinding('cameraPanUp', 'KeyK');
    expect(calls).toBe(1);
  });
});

describe('DoubleTap', () => {
  it('fires on the second tap inside the window only', () => {
    const d = new DoubleTap(300);
    expect(d.tap(0)).toBe(false);
    expect(d.tap(200)).toBe(true);
    expect(d.tap(250)).toBe(false); // a third tap starts a new pair
    expect(d.tap(1000)).toBe(false);
    expect(d.tap(1400)).toBe(false); // too slow
  });
});
