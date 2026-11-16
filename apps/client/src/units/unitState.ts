/**
 * The plain-data contract that drives a UnitView (docs/design/units.md).
 *
 * No Babylon types: in M2 the sim bridge (M2-12) builds these from snapshots,
 * and in M3 the netcode interpolates them, so they must stay cheap to copy,
 * compare and serialise.
 */
import type { ModelId } from './modelConfig';
import type { LogicalState } from './states';

export type Team = 'wardens' | 'hollow' | 'neutral';
export const TEAMS: readonly Team[] = ['wardens', 'hollow', 'neutral'];

/** Sim entity id. Stable for the unit's lifetime; never reused while a view exists. */
export type UnitId = number;

export interface UnitViewState {
  id: UnitId;
  modelId: ModelId;
  team: Team;
  /** Ground position (world units). y comes from the terrain, not the state. */
  position: { x: number; z: number };
  /** Facing in radians. 0 faces +z (north); positive turns toward +x (clockwise seen from above). */
  facing: number;
  /** Logical animation state (states.ts). */
  animState: LogicalState;
  /**
   * Bump this to replay a one-shot that is already the current `animState`
   * (e.g. the next swing of a continuous attack). Optional; omit for loops.
   */
  animSeq?: number;
  /** Attack animation speed multiplier (attack-speed → clip speed). 1 = clip's natural speed. */
  attackSpeedScale: number;
  hp: number;
  maxHp: number;
  /** Heroes only; omit (or set maxMana 0) for units without mana. */
  mana?: number;
  maxMana?: number;
  /** Heroes only. */
  level?: number;
  isHero: boolean;
  selected: boolean;
  hovered: boolean;
  /** False when hidden by fog or not yet spawned: the model, bar and rings all hide. */
  visible: boolean;
  /**
   * Skip position/facing smoothing for this update (spawn, respawn, blink,
   * teleport). The view jumps straight to the state.
   */
  snap?: boolean;
}

/** How a unit relates to the local player; drives bar and ring colours. */
export type Relation = 'ally' | 'enemy' | 'neutral';

export function relationOf(team: Team, localTeam: Team): Relation {
  if (team === 'neutral') return 'neutral';
  if (localTeam === 'neutral') return 'enemy';
  return team === localTeam ? 'ally' : 'enemy';
}

/** RGB in 0..1. */
export type Rgb = readonly [number, number, number];

const hex = (h: string): Rgb => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/**
 * Readability colours (art-direction.md §2.1/§2.2). Relation colours are for
 * bars and selection rings; faction colours are for the model rim.
 */
export const UNIT_COLORS = {
  ally: hex('#46A758'),
  enemy: hex('#E5484D'),
  neutral: hex('#E8C547'),
  mana: hex('#3E8EDE'),
  trail: hex('#F4E3B5'),
  barBack: hex('#1B1A1F'),
  hover: hex('#F4EFE4'),
  faction: {
    wardens: hex('#E8B54A'),
    hollow: hex('#8E5BD9'),
    neutral: hex('#B9B2A3'),
  } as Readonly<Record<Team, Rgb>>,
} as const;

export function relationColor(rel: Relation): Rgb {
  return UNIT_COLORS[rel];
}
