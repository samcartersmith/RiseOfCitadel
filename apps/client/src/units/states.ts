/**
 * Logical animation states shared by every unit model. Gameplay code (and,
 * later, the sim bridge) only ever talks in these names; each model config
 * maps them to the clips that exist in its GLB. See docs/design/hero-pipeline.md.
 *
 * Pure data: no Babylon imports, so tools and tests can use it too.
 */
export const LOGICAL_STATES = [
  'idle',
  'run',
  'attack1',
  'attack2',
  'cast1',
  'cast2',
  'cast3',
  'channel',
  'death',
  'victory',
  'hit',
] as const;

export type LogicalState = (typeof LOGICAL_STATES)[number];

/** States that loop until something else is played. Everything else is a one-shot. */
export const LOOPING_STATES: ReadonlySet<LogicalState> = new Set(['idle', 'run', 'channel']);

/**
 * Where a one-shot goes when it finishes. `null` means "hold the last frame"
 * (a dead unit stays down until the view plays something else, e.g. respawn → idle).
 */
export const DEFAULT_FALLBACK: Readonly<Record<LogicalState, LogicalState | null>> = {
  idle: 'idle',
  run: 'run',
  attack1: 'idle',
  attack2: 'idle',
  cast1: 'idle',
  cast2: 'idle',
  cast3: 'idle',
  channel: 'channel',
  death: null,
  victory: 'idle',
  hit: 'idle',
};

export function isLogicalState(s: string): s is LogicalState {
  return (LOGICAL_STATES as readonly string[]).includes(s);
}
