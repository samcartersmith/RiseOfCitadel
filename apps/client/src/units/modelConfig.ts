/**
 * View config per base model: where the GLB lives, how big it is, which
 * attached prop meshes are visible, and which clip plays for each logical state.
 *
 * Pure data (no Babylon), so the asset tooling tests can check that every clip
 * and prop named here survives the pipeline (tools/assets/modelConfig.test.ts).
 * How to add a model: docs/design/hero-pipeline.md.
 */
import type { LogicalState } from './states';

export type ModelId = 'knight' | 'rogue_hooded' | 'mage' | 'skeleton_minion';

export interface ModelViewConfig {
  id: ModelId;
  /** Served path of the processed GLB (apps/client/public/models/...). */
  url: string;
  /** Uniform scale relative to a standard hero (1 = hero size). */
  scale: number;
  /**
   * Attached prop meshes (weapons, shields, hats...). `show` lists the ones this
   * view uses; `hide` lists ones still in the GLB that start disabled (spares for
   * kit-bashing). Unlisted props are left as they are.
   */
  props: { show: readonly string[]; hide: readonly string[] };
  /** Logical state → animation group name in the GLB. */
  clips: Readonly<Record<LogicalState, string>>;
  /** Per-state base playback speed (defaults to 1). Multiplied by runtime speed scales. */
  clipSpeed?: Readonly<Partial<Record<LogicalState, number>>>;
  /** Default crossfade time in seconds. */
  blendTime?: number;
  /**
   * UnitView (M1-13): height above the feet, in world units at scale 1, where
   * the HP bar is anchored (just over the head/hat). Multiplied by `scale`.
   */
  barAnchorHeight?: number;
  /** UnitView: selection ring radius in world units at scale 1. Multiplied by `scale`. */
  selectionRadius?: number;
}

/**
 * Animation clips each model keeps beyond `clips` (spares for later kit-bashes).
 * The asset manifest's `keepAnimations` must contain clips + spares.
 */
export const SPARE_CLIPS: Readonly<Record<ModelId, readonly string[]>> = {
  knight: ['Walking_A', 'Block', 'Hit_B', 'Death_B'],
  rogue_hooded: ['Walking_A', '1H_Ranged_Reload', 'Hit_A', 'Death_A'],
  mage: ['Walking_A', '2H_Melee_Idle', 'Hit_B', 'Death_B'],
  skeleton_minion: ['Walking_D_Skeletons', 'Idle_Combat', 'Spawn_Ground_Skeletons', 'Death_A'],
};

export const MODEL_CONFIGS: Readonly<Record<ModelId, ModelViewConfig>> = {
  // Bulwark's base body: one-handed weapon (mace stand-in) + rectangular shield (gate-shield stand-in).
  knight: {
    id: 'knight',
    url: '/models/kaykit-adventurers/knight.glb',
    scale: 1,
    props: {
      show: ['1H_Sword', 'Rectangle_Shield', 'Knight_Helmet', 'Knight_Cape'],
      hide: ['Round_Shield', '2H_Sword'],
    },
    barAnchorHeight: 2.5,
    selectionRadius: 0.85,
    clips: {
      idle: 'Idle',
      run: 'Running_A',
      attack1: '1H_Melee_Attack_Chop', // mace swing
      attack2: 'Block_Attack', // shield bash
      cast1: '1H_Melee_Attack_Stab', // charge impact
      cast2: 'Spellcast_Raise', // horn raise
      cast3: '2H_Melee_Attack_Chop', // overhead shield slam
      channel: 'Blocking',
      death: 'Death_A',
      victory: 'Cheer',
      hit: 'Hit_A',
    },
  },
  // Kestrel's base body: the 1H crossbow stands in for the bow until M2-16.
  rogue_hooded: {
    id: 'rogue_hooded',
    url: '/models/kaykit-adventurers/rogue_hooded.glb',
    scale: 1,
    props: {
      show: ['1H_Crossbow', 'Rogue_Cape'],
      hide: ['Knife', 'Knife_Offhand'],
    },
    barAnchorHeight: 2.4,
    selectionRadius: 0.8,
    clips: {
      idle: 'Idle',
      run: 'Running_A',
      attack1: '1H_Ranged_Shoot',
      attack2: '2H_Ranged_Shoot',
      cast1: 'Dodge_Forward', // windstep
      cast2: 'Spellcast_Shoot', // point: send the bird
      cast3: 'Throw',
      channel: '1H_Ranged_Aiming',
      death: 'Death_B',
      victory: 'Cheer',
      hit: 'Hit_B',
    },
  },
  // Cinderwright's and Lantern's base body: the long staff (hammer-staff / lantern pole stand-in).
  mage: {
    id: 'mage',
    url: '/models/kaykit-adventurers/mage.glb',
    scale: 1,
    props: {
      show: ['2H_Staff', 'Mage_Hat', 'Mage_Cape'],
      hide: ['1H_Wand', 'Spellbook'],
    },
    barAnchorHeight: 2.9,
    selectionRadius: 0.8,
    clips: {
      idle: 'Idle',
      run: 'Running_A',
      attack1: 'Spellcast_Shoot', // flick a droplet / launch a light mote
      attack2: '2H_Melee_Attack_Slice', // staff swing
      cast1: 'Spellcast_Long',
      cast2: 'Spellcast_Raise', // raise lantern / crucible
      cast3: '2H_Melee_Attack_Chop', // overhead "pour"
      channel: 'Spellcasting',
      death: 'Death_A',
      victory: 'Cheer',
      hit: 'Hit_A',
    },
  },
  // Hollow lane creep. Unarmed for now; M1-14 attaches a blade, so attacks use 1H clips.
  skeleton_minion: {
    id: 'skeleton_minion',
    url: '/models/kaykit-skeletons/skeleton_minion.glb',
    scale: 0.85,
    props: { show: [], hide: [] },
    barAnchorHeight: 2.2,
    selectionRadius: 0.75,
    clips: {
      idle: 'Idle',
      run: 'Running_A',
      attack1: '1H_Melee_Attack_Chop',
      attack2: '1H_Melee_Attack_Slice_Diagonal',
      cast1: 'Spellcast_Shoot',
      cast2: 'Spellcast_Raise',
      cast3: 'Spellcast_Summon',
      channel: 'Spellcasting',
      death: 'Death_C_Skeletons',
      victory: 'Taunt',
      hit: 'Hit_B',
    },
  },
};

export const MODEL_IDS = Object.keys(MODEL_CONFIGS) as ModelId[];

/** Every clip a model's GLB must contain: the mapped clips plus spares, de-duplicated. */
export function requiredClips(id: ModelId): string[] {
  return [...new Set([...Object.values(MODEL_CONFIGS[id].clips), ...SPARE_CLIPS[id]])];
}
