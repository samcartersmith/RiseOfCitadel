/** Keyboard state tracking plus a tiny double-tap detector. */

/** Detects two taps within `windowMs`. Time is passed in so it's testable. */
export class DoubleTap {
  private last = -Infinity;

  constructor(private readonly windowMs = 300) {}

  /** Register a tap at `nowMs`; true if it completes a double tap. */
  tap(nowMs: number): boolean {
    const isDouble = nowMs - this.last <= this.windowMs;
    // A completed double tap resets, so a third quick tap starts a new pair.
    this.last = isDouble ? -Infinity : nowMs;
    return isDouble;
  }
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.isContentEditable ||
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT'
  );
}

/** Tracks held keys (by `KeyboardEvent.code`) on a window. */
export class KeyboardState {
  private readonly down = new Set<string>();
  private readonly pressListeners = new Set<(code: string, e: KeyboardEvent) => void>();
  private readonly cleanup: (() => void)[] = [];

  constructor(target: Window = window) {
    const onDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const fresh = !this.down.has(e.code) && !e.repeat;
      this.down.add(e.code);
      if (fresh) for (const fn of this.pressListeners) fn(e.code, e);
    };
    const onUp = (e: KeyboardEvent) => this.down.delete(e.code);
    const onBlur = () => this.down.clear(); // keyup never arrives after alt-tab
    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    target.addEventListener('blur', onBlur);
    this.cleanup.push(
      () => target.removeEventListener('keydown', onDown),
      () => target.removeEventListener('keyup', onUp),
      () => target.removeEventListener('blur', onBlur),
    );
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  anyDown(codes: readonly string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** Called once per physical press (auto-repeat is ignored). */
  onPress(fn: (code: string, e: KeyboardEvent) => void): () => void {
    this.pressListeners.add(fn);
    return () => this.pressListeners.delete(fn);
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.down.clear();
    this.pressListeners.clear();
  }
}
