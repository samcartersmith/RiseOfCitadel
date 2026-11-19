import type { Scene } from '@babylonjs/core/scene';
import type { LoadedModel } from './loadModel';
import type { LogicalState } from './states';
import type { UnitLookFactory } from './look';
import type { ModelId, ModelViewConfig } from './modelConfig';

/**
 * Registration seam for unit models that aren't a plain `loadModel` of a
 * base GLB (docs/design/units.md §9): kit-bashed heroes like Bulwark build
 * their model in code and bring their own look. The hero module registers
 * itself; units/ never imports heroes/.
 *
 *   registerUnitModel('bulwark', { config, load: (scene, o) => loadBulwark(scene, ...), look })
 *
 * UnitView then accepts `modelId: 'bulwark'` like any base model.
 */

/** A base model id, or any id registered with `registerUnitModel`. */
export type UnitModelId = ModelId | (string & {});

export interface UnitModelLoadOptions {
  /** Merge into 1-2 draw calls (UnitViewOptions.mergeMeshes). */
  mergeMeshes: boolean;
  /** State to start in; UnitView passes null and plays the state itself. */
  initialState: LogicalState | null;
}

export interface UnitModelSpec {
  /**
   * View config: UnitView reads `scale`, `barAnchorHeight` and
   * `selectionRadius` from it (the rest is the loader's business).
   */
  config: ModelViewConfig;
  /** Build one instance. The returned model's root is parented under the unit's node. */
  load(scene: Scene, options: UnitModelLoadOptions): Promise<LoadedModel>;
  /**
   * The model's own UnitLook. Takes precedence over the global factory
   * (`setUnitLookFactory`, e.g. the toon look); omitted = use the global one.
   */
  look?: UnitLookFactory;
}

const registry = new Map<string, UnitModelSpec>();

/** Register (or replace) a custom unit model. Call before creating views that use it. */
export function registerUnitModel(id: string, spec: UnitModelSpec): void {
  registry.set(id, spec);
}

/** The registered spec for `id`, if any. */
export function unitModelSpec(id: UnitModelId): UnitModelSpec | undefined {
  return registry.get(id);
}

/** Remove a registration (tests). */
export function unregisterUnitModel(id: string): void {
  registry.delete(id);
}
