/**
 * Pure helpers for UnitViewManager: diffing incoming states against live
 * views, and screen-space picking. No Babylon.
 */
import type { ModelId } from './modelConfig';
import type { UnitId } from './unitState';

export interface StateDiff {
  /** Ids with no view yet: create. */
  added: UnitId[];
  /** Ids whose view exists but whose model changed (hero swap, morph): recreate. */
  replaced: UnitId[];
  /** Ids with a view and no state any more: dispose. */
  removed: UnitId[];
  /** Ids present in both with the same model: update in place. */
  kept: UnitId[];
}

/**
 * Compare live views (`id → modelId`) with this frame's states. Duplicate ids
 * in `states` are ignored after the first (the manager warns once).
 */
export function diffStates(
  live: ReadonlyMap<UnitId, ModelId>,
  states: Iterable<{ id: UnitId; modelId: ModelId }>,
): StateDiff {
  const diff: StateDiff = { added: [], replaced: [], removed: [], kept: [] };
  const seen = new Set<UnitId>();
  for (const s of states) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const model = live.get(s.id);
    if (model === undefined) diff.added.push(s.id);
    else if (model !== s.modelId) diff.replaced.push(s.id);
    else diff.kept.push(s.id);
  }
  for (const id of live.keys()) if (!seen.has(id)) diff.removed.push(id);
  return diff;
}

export interface ScreenTarget {
  id: UnitId;
  /** Screen position (CSS px) of the unit's body centre. */
  x: number;
  y: number;
  /** Pick radius in CSS px (roughly half the unit's on-screen height). */
  radius: number;
  /** Camera depth; used to prefer the nearer unit when two overlap. */
  depth: number;
}

/**
 * The unit under a screen point: the closest target whose pick circle
 * contains the point, preferring nearer-to-camera units when circles overlap
 * by similar amounts. Returns null if nothing is under the point.
 */
export function pickNearest(targets: Iterable<ScreenTarget>, x: number, y: number): UnitId | null {
  let best: UnitId | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d > t.radius) continue;
    // Normalised distance, nudged by depth so the front unit wins ties.
    const score = d / t.radius + t.depth * 1e-3;
    if (score < bestScore) {
      bestScore = score;
      best = t.id;
    }
  }
  return best;
}
