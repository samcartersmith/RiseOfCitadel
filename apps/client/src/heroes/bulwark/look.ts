import '@babylonjs/core/Rendering/outlineRenderer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { UnitLook } from '../../units/look';
import type { Team } from '../../units/unitState';
import { bulwarkToonMaterial } from './material';

/**
 * Bulwark's UnitLook: the Citadel toon material (M1-02) on his generated atlas,
 * dyed per team through his own atlas mask (BULWARK_TEAM_MASK), plus Babylon's
 * outline renderer for hover/selection like the other looks. Same interface as
 * units/look.ts, so UnitView can drive it once it can host hero models.
 */
export function createBulwarkLook(meshes: readonly AbstractMesh[], scene: Scene): UnitLook {
  const like = meshes.find((m) => m.material)?.material ?? null;
  const targets = meshes.filter((m) => m.material);
  return {
    setTeam(team: Team) {
      const mat = bulwarkToonMaterial(scene, team, like);
      for (const m of targets) m.material = mat;
    },
    setHighlight(mode, color) {
      const on = mode !== 'none';
      for (const m of targets) {
        m.renderOutline = on;
        if (on) {
          m.outlineColor = new Color3(color[0], color[1], color[2]);
          m.outlineWidth = mode === 'selected' ? 0.035 : 0.02;
        }
      }
    },
    dispose() {
      for (const m of targets) m.renderOutline = false;
    },
  };
}
