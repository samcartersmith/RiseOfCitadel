/**
 * Bulwark (H01) view config: base body, hidden stock props, clip mapping,
 * proportion push and budgets. Pure data, checked in config.test.ts.
 * See docs/design/heroes/bulwark.md.
 */
import { MODEL_CONFIGS, type ModelViewConfig } from '../../units/modelConfig';

/**
 * Bulwark is built on the KayKit Knight (Rig_Medium). It reuses the Knight's
 * GLB and clips (hero-pipeline.md §3) and swaps the stock weapon and shield
 * for code-built parts (parts.ts). The sword and every stock shield are hidden;
 * helmet and cape stay (restyled: the cape is team cloth).
 */
export const BULWARK_VIEW_CONFIG: ModelViewConfig = {
  ...MODEL_CONFIGS.knight,
  props: {
    show: ['Knight_Helmet', 'Knight_Cape'],
    hide: ['1H_Sword', '2H_Sword', 'Rectangle_Shield', 'Round_Shield'],
  },
  // Wider and heavier than the stock knight: the shield sits further out.
  selectionRadius: 1.0,
  barAnchorHeight: 2.6,
  // He's slow and heavy: a lumbering run and weighty swings.
  clipSpeed: { run: 0.85, attack1: 0.9, attack2: 0.9, cast3: 0.85 },
  blendTime: 0.2,
};

/**
 * Proportion push (art brief: "scale the shoulders and hands up"). Uniform
 * scales on Rig_Medium bones, re-applied after the animation step every frame
 * (KayKit clips key every bone's scale). Children inherit the scale, so the
 * head is scaled back down to keep the helmet stubby.
 */
export const BONE_SCALES: Readonly<Record<string, number>> = {
  chest: 1.08,
  'upperarm.l': 1.18,
  'upperarm.r': 1.18,
  'hand.l': 1.12,
  'hand.r': 1.18,
  head: 0.9,
};

/**
 * Parent chain of the bones we scale or attach to (Rig_Medium), used to
 * cancel inherited proportion scales on attached parts.
 */
export const BONE_PARENTS: Readonly<Record<string, string | null>> = {
  root: null,
  hips: 'root',
  spine: 'hips',
  chest: 'spine',
  head: 'chest',
  'upperarm.l': 'chest',
  'lowerarm.l': 'upperarm.l',
  'wrist.l': 'lowerarm.l',
  'hand.l': 'wrist.l',
  'handslot.l': 'hand.l',
  'upperarm.r': 'chest',
  'lowerarm.r': 'upperarm.r',
  'wrist.r': 'lowerarm.r',
  'hand.r': 'wrist.r',
  'handslot.r': 'hand.r',
};

/** Product of BONE_SCALES from `bone` up to the root (what a child of `bone` inherits). */
export function inheritedScale(bone: string): number {
  let k = 1;
  for (let b: string | null | undefined = bone; b; b = BONE_PARENTS[b]) k *= BONE_SCALES[b] ?? 1;
  return k;
}

/** Art-direction budgets for a hero (art-direction.md §2.3). */
export const HERO_BUDGET = { triangles: 8000, drawCalls: 2, materials: 2 } as const;

/** Atlas resolution: 8×4 gradient cells of 32×64 px. Gradients need no more. */
export const ATLAS_SIZE = 256;
