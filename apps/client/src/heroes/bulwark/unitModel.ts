/**
 * Registers Bulwark as a UnitView model (`modelId: 'bulwark'`) through the
 * units/ registration seam (units/modelRegistry.ts), so the unit layer can
 * host him without importing heroes/. See docs/design/units.md §9.
 */
import { registerUnitModel } from '../../units/modelRegistry';
import { loadBulwark } from './bulwark';
import { BULWARK_VIEW_CONFIG } from './config';
import { createBulwarkLook } from './look';

export const BULWARK_MODEL_ID = 'bulwark';

/** Call once at startup (idempotent), before any UnitView with `modelId: 'bulwark'` is created. */
export function registerBulwarkUnitModel(): void {
  registerUnitModel(BULWARK_MODEL_ID, {
    config: BULWARK_VIEW_CONFIG,
    // UnitView owns the look (team + highlight), so the loader returns the plain atlas.
    load: (scene, { mergeMeshes, initialState }) =>
      loadBulwark(scene, { merge: mergeMeshes, look: false, initialState }),
    look: createBulwarkLook,
  });
}
