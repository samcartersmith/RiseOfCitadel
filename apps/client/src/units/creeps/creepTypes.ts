/**
 * Creep, neutral and boss view configs (docs/design/creeps.md).
 *
 * Pure data (no Babylon) so tests and tools can check it. Each type becomes ONE
 * thin-instanced mesh with one material and a baked animation texture, so a
 * type costs one draw call however many of it are on screen.
 */
import type { LogicalState } from '../states';
import type { Team } from '../unitState';
import type { RecolorRule } from './swatch';
import { SIEGE_CLIPS } from './siegePose';

export const CREEP_MODEL_IDS = [
  'warden_melee',
  'warden_ranged',
  'warden_siege',
  'hollow_melee',
  'hollow_ranged',
  'hollow_siege',
  'neutral_small',
  'neutral_medium',
  'neutral_large',
  'neutral_ancient',
  'boss',
] as const;

export type CreepModelId = (typeof CREEP_MODEL_IDS)[number];
export type CreepCategory = 'lane' | 'neutral' | 'boss';

export function isCreepModelId(id: string): id is CreepModelId {
  return (CREEP_MODEL_IDS as readonly string[]).includes(id);
}

/** A weapon GLB attached to a hand slot before merging. */
export interface CreepProp {
  url: string;
  /** Attachment node in the body GLB (e.g. `handslot.r`). */
  slot: string;
}

export interface CreepTypeConfig {
  id: CreepModelId;
  /** In-world name (original to this project). */
  name: string;
  category: CreepCategory;
  /** The team this type is drawn for. Lane creeps are per faction; neutrals and the boss are neutral. */
  team: Team;
  /** Processed GLB (apps/client/public/models/...). */
  url: string;
  /** How the mesh is built: a skinned KayKit character, or the code-built siege engine. */
  build: 'skinned' | 'siege';
  /** Uniform scale relative to a standard hero (1 = hero size). */
  scale: number;
  props?: readonly CreepProp[];
  /** Logical state → clip name (GLB animation group, or a SIEGE_CLIPS name). */
  clips: Readonly<Record<LogicalState, string>>;
  clipSpeed?: Readonly<Partial<Record<LogicalState, number>>>;
  /** A near-white swatch of this pack's atlas, used as the base for exact tints. */
  whiteCell: number;
  /**
   * Lane creeps: a light swatch the source model never samples. Faction-accent
   * parts are moved into it, and it is the toon shader's team mask (one atlas
   * rectangle, docs/design/toon-shader.md), so the accent is exactly the team
   * colour and nothing else is.
   */
  teamCell?: number;
  recolor: readonly RecolorRule[];
  /** HP bar anchor height above the feet, world units at scale 1 (times `scale`). */
  barAnchorHeight: number;
  /** Selection ring radius, world units at scale 1 (times `scale`). */
  selectionRadius: number;
  /** Art budget for the merged mesh (checked in the sandbox test). */
  maxTriangles: number;
}

/** Shared clip map for a melee/ranged humanoid: everything that isn't move/death is an attack. */
function humanoidClips(
  idle: string,
  run: string,
  attack1: string,
  attack2: string,
  death: string,
): Record<LogicalState, string> {
  return {
    idle,
    run,
    attack1,
    attack2,
    cast1: attack2,
    cast2: attack2,
    cast3: attack1,
    channel: idle,
    death,
    victory: idle,
    hit: idle,
  };
}

const SIEGE_CLIP_MAP: Record<LogicalState, string> = {
  idle: SIEGE_CLIPS.idle.name,
  run: SIEGE_CLIPS.move.name,
  attack1: SIEGE_CLIPS.fire.name,
  attack2: SIEGE_CLIPS.fire.name,
  cast1: SIEGE_CLIPS.fire.name,
  cast2: SIEGE_CLIPS.fire.name,
  cast3: SIEGE_CLIPS.fire.name,
  channel: SIEGE_CLIPS.idle.name,
  death: SIEGE_CLIPS.wreck.name,
  victory: SIEGE_CLIPS.idle.name,
  hit: SIEGE_CLIPS.idle.name,
};

// Faction and neutral colours (art-direction.md §2.1).
const GOLD = '#E8B54A';
const VIOLET = '#8E5BD9';
const RIVER = '#7FE3E0';

const ADV = '/models/creeps-kaykit-adventurers';
const SKL = '/models/creeps-kaykit-skeletons';
const HEX = '/models/creeps-kaykit-hexagon';

/** Walk clips are authored for a slower stride than lane creeps move at; speed them up a touch. */
const LANE_SPEED = { run: 1.25 } as const;

export const CREEP_TYPES: Readonly<Record<CreepModelId, CreepTypeConfig>> = {
  // ---- Wardens: stone, bronze, gold banners -------------------------------------
  warden_melee: {
    id: 'warden_melee',
    name: 'Warden Shieldbearer',
    category: 'lane',
    team: 'wardens',
    url: `${ADV}/warden_melee.glb`,
    build: 'skinned',
    scale: 0.8,
    clips: humanoidClips(
      'Idle',
      'Walking_A',
      '1H_Melee_Attack_Chop',
      '1H_Melee_Attack_Slice_Diagonal',
      'Death_A',
    ),
    clipSpeed: LANE_SPEED,
    whiteCell: 9,
    teamCell: 16,
    recolor: [
      { from: 8, to: 16, tint: GOLD }, // tabard + cape → Warden gold
      { from: 11, to: 16, tint: GOLD, parts: ['Shield'] }, // shield face: reads from the front
      { from: 7, to: 16, tint: GOLD }, // helmet crest, trim and boots
      { from: 6, tint: '#C9A27A' }, // leather → warm bronze
    ],
    barAnchorHeight: 2.5,
    selectionRadius: 0.8,
    maxTriangles: 2000,
  },
  warden_ranged: {
    id: 'warden_ranged',
    name: 'Warden Arbalist',
    category: 'lane',
    team: 'wardens',
    url: `${ADV}/warden_ranged.glb`,
    build: 'skinned',
    scale: 0.78,
    clips: humanoidClips('Idle', 'Walking_A', '1H_Ranged_Shoot', '1H_Ranged_Shooting', 'Death_B'),
    clipSpeed: LANE_SPEED,
    whiteCell: 16,
    teamCell: 31,
    recolor: [
      { from: 8, to: 31, tint: GOLD }, // tunic → gold (the front of the unit)
      { from: 9, to: 16, tint: '#9C7A4C' }, // cape + sleeves → bronze
    ],
    barAnchorHeight: 2.4,
    selectionRadius: 0.75,
    maxTriangles: 2000,
  },
  warden_siege: {
    id: 'warden_siege',
    name: 'Warden Stonethrower',
    category: 'lane',
    team: 'wardens',
    url: `${HEX}/siege_catapult.glb`,
    build: 'siege',
    scale: 1,
    clips: SIEGE_CLIP_MAP,
    whiteCell: 1,
    teamCell: 1,
    recolor: [
      { from: 26, to: 1, tint: GOLD },
      { from: 1, tint: GOLD, parts: ['rail'] }, // code-built side rails: team colour
    ],
    barAnchorHeight: 2.4,
    selectionRadius: 1.25,
    maxTriangles: 2000,
  },

  // ---- Hollow: ash, iron, cold violet fire -------------------------------------
  hollow_melee: {
    id: 'hollow_melee',
    name: 'Hollow Thrall',
    category: 'lane',
    team: 'hollow',
    url: `${SKL}/hollow_melee.glb`,
    build: 'skinned',
    scale: 0.82,
    props: [{ url: `${SKL}/prop_blade.glb`, slot: 'handslot.r' }],
    clips: humanoidClips(
      'Idle',
      'Walking_D_Skeletons',
      '1H_Melee_Attack_Chop',
      '1H_Melee_Attack_Slice_Diagonal',
      'Death_C_Skeletons',
    ),
    clipSpeed: LANE_SPEED,
    whiteCell: 16,
    teamCell: 8,
    recolor: [
      { from: 31, to: 16, tint: '#D9C2FF', parts: ['Eyes'] }, // eyes → pale violet glow
      { from: 5, to: 8, tint: VIOLET }, // cloak → Hollow violet
      { from: [11, 22], to: 8, tint: VIOLET, parts: ['Blade'] }, // blade → cold violet fire (front)
      { from: 9, tint: '#A8A2B4' }, // bone → cold ash
      { from: [6, 7], tint: '#6A6276' }, // straps → iron
    ],
    barAnchorHeight: 2.3,
    selectionRadius: 0.75,
    maxTriangles: 2000,
  },
  hollow_ranged: {
    id: 'hollow_ranged',
    name: 'Hollow Ashcaller',
    category: 'lane',
    team: 'hollow',
    url: `${SKL}/hollow_ranged.glb`,
    build: 'skinned',
    scale: 0.8,
    props: [{ url: `${SKL}/prop_staff.glb`, slot: 'handslot.r' }],
    clips: humanoidClips(
      'Idle',
      'Walking_D_Skeletons',
      'Spellcast_Shoot',
      'Spellcast_Raise',
      'Death_C_Skeletons',
    ),
    clipSpeed: LANE_SPEED,
    whiteCell: 16,
    teamCell: 8,
    recolor: [
      { from: 31, to: 16, tint: '#D9C2FF', parts: ['Eyes'] },
      { from: 18, to: 8, tint: VIOLET }, // robe + hat → violet
      { from: 9, tint: '#B4AEBE' },
      { from: [21, 17], tint: '#6E6878' }, // trim → iron
    ],
    barAnchorHeight: 2.6,
    selectionRadius: 0.75,
    maxTriangles: 2000,
  },
  hollow_siege: {
    id: 'hollow_siege',
    name: 'Hollow Gravecaster',
    category: 'lane',
    team: 'hollow',
    url: `${HEX}/siege_catapult.glb`,
    build: 'siege',
    scale: 1,
    clips: SIEGE_CLIP_MAP,
    whiteCell: 1,
    teamCell: 1,
    recolor: [
      { from: 26, to: 1, tint: VIOLET },
      { from: 1, tint: VIOLET, parts: ['rail'] },
      { from: [5, 6, 13, 14], tint: '#8C8494' }, // wood → ash-grey
      { from: 2, tint: '#9C96A6' },
    ],
    barAnchorHeight: 2.4,
    selectionRadius: 1.25,
    maxTriangles: 2000,
  },

  // ---- Neutral camps (river-side ruins; earthy, never gold or violet) -----------
  neutral_small: {
    id: 'neutral_small',
    name: 'Thicket Stalker',
    category: 'neutral',
    team: 'neutral',
    url: `${ADV}/neutral_small.glb`,
    build: 'skinned',
    scale: 0.68,
    clips: humanoidClips(
      'Idle',
      'Walking_A',
      'Dualwield_Melee_Attack_Stab',
      'Dualwield_Melee_Attack_Slice',
      'Death_A',
    ),
    whiteCell: 16,
    recolor: [
      { from: 9, to: 16, tint: '#5E7F3E' }, // hood + cape → moss
      { from: 8, to: 16, tint: '#7A6248' }, // tunic → bark brown
    ],
    barAnchorHeight: 2.3,
    selectionRadius: 0.7,
    maxTriangles: 2000,
  },
  neutral_medium: {
    id: 'neutral_medium',
    name: 'Hedge Seer',
    category: 'neutral',
    team: 'neutral',
    url: `${ADV}/neutral_medium.glb`,
    build: 'skinned',
    scale: 0.9,
    clips: humanoidClips('Idle', 'Walking_A', 'Spellcast_Shoot', 'Spellcast_Raise', 'Death_B'),
    whiteCell: 16,
    recolor: [
      { from: [8, 9], to: 16, tint: '#4F7A5C' }, // robe + hat → deep hedge green
      { from: 10, to: 16, tint: '#A0603A' }, // cape → rust
      { from: [23], tint: '#C8B48A' },
    ],
    barAnchorHeight: 2.9,
    selectionRadius: 0.8,
    maxTriangles: 3000,
  },
  neutral_large: {
    id: 'neutral_large',
    name: 'Cairn Ogre',
    category: 'neutral',
    team: 'neutral',
    url: `${ADV}/neutral_large.glb`,
    build: 'skinned',
    scale: 1.35,
    clips: humanoidClips(
      'Idle',
      'Walking_A',
      '2H_Melee_Attack_Chop',
      '2H_Melee_Attack_Slice',
      'Death_A',
    ),
    clipSpeed: { run: 0.9 },
    whiteCell: 16,
    recolor: [
      { from: 0, to: 16, tint: '#8E9E78' }, // skin → mossy stone
      { from: [8, 9], to: 16, tint: '#7B5A3C' }, // blue cloth → hide
    ],
    barAnchorHeight: 2.5,
    selectionRadius: 0.85,
    maxTriangles: 3000,
  },
  neutral_ancient: {
    id: 'neutral_ancient',
    name: 'Leyline Revenant',
    category: 'neutral',
    team: 'neutral',
    url: `${SKL}/neutral_ancient.glb`,
    build: 'skinned',
    scale: 1.6,
    props: [{ url: `${SKL}/prop_axe.glb`, slot: 'handslot.r' }],
    clips: humanoidClips(
      'Idle_Combat',
      'Walking_D_Skeletons',
      '2H_Melee_Attack_Chop',
      '2H_Melee_Attack_Slice',
      'Death_C_Skeletons',
    ),
    clipSpeed: { run: 0.85 },
    whiteCell: 16,
    recolor: [
      { from: 31, to: 16, tint: RIVER, parts: ['Eyes'] },
      { from: [18, 22], to: 16, tint: RIVER }, // cloak + helmet trim → river light
      { from: 3, tint: '#A9DCD8' }, // armour → ghostly leystone
      { from: 9, tint: '#D6E2DD' }, // bone → pale leystone
      { from: [6, 7], tint: '#4E6670' },
    ],
    barAnchorHeight: 2.3,
    selectionRadius: 0.8,
    maxTriangles: 4000,
  },

  // ---- Boss pit -------------------------------------------------------------------
  boss: {
    id: 'boss',
    name: 'The Sundered Sentinel',
    category: 'boss',
    team: 'neutral',
    url: `${ADV}/boss.glb`,
    build: 'skinned',
    scale: 2.2,
    clips: {
      idle: '2H_Melee_Idle',
      run: 'Walking_B',
      attack1: '2H_Melee_Attack_Chop',
      attack2: '2H_Melee_Attack_Spin',
      cast1: '2H_Melee_Attack_Spin',
      cast2: '2H_Melee_Attack_Spin',
      cast3: '2H_Melee_Attack_Chop',
      channel: '2H_Melee_Idle',
      death: 'Death_B',
      victory: '2H_Melee_Idle',
      hit: '2H_Melee_Idle',
    },
    clipSpeed: { attack1: 0.8, attack2: 0.8 },
    whiteCell: 9,
    recolor: [
      { from: [0, 1, 2], to: 9, tint: '#8F8C86' }, // face → weathered stone
      { from: 3, tint: '#5A5664' }, // plate → dark iron
      { from: 7, to: 9, tint: RIVER }, // crest, trim and boots → leyline light
      { from: 8, to: 9, tint: RIVER }, // tabard + cape → leyline light
      { from: 11, to: 9, tint: '#BFF5F2' }, // blade → glowing leystone
    ],
    barAnchorHeight: 2.6,
    selectionRadius: 0.75,
    maxTriangles: 6000,
  },
};

/** Neutral camp families and their usual composition (sandbox + M2 spawn reference). */
export const NEUTRAL_CAMPS: readonly { family: string; units: readonly CreepModelId[] }[] = [
  { family: 'small', units: ['neutral_small', 'neutral_small', 'neutral_small'] },
  { family: 'medium', units: ['neutral_medium', 'neutral_medium', 'neutral_small'] },
  { family: 'large', units: ['neutral_large', 'neutral_medium'] },
  { family: 'ancient', units: ['neutral_ancient', 'neutral_ancient'] },
];

/** The clip names a type's baked texture must contain (mapped clips, de-duplicated, in first-use order). */
export function bakedClipNames(id: CreepModelId): string[] {
  return [...new Set(Object.values(CREEP_TYPES[id].clips))];
}
