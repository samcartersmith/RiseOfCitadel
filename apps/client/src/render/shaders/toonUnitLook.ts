/**
 * The toon material's UnitLook (the seam M1-13 left in units/look.ts):
 * `installToonUnitLook()` once at startup and every UnitView created after
 * that is drawn with CitadelToonMaterial, team-coloured through its atlas mask.
 * Highlights use Babylon's outline renderer, like the fallback look.
 */
import '@babylonjs/core/Rendering/outlineRenderer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { setUnitLookFactory, type UnitLook, type UnitLookFactory } from '../../units/look';
import type { Team as UnitTeam } from '../../units/unitState';
import { toonMaterialFor } from './applyCitadelToon';
import { modelIdForMeshNames, teamMaskFor } from './teamMask';

/** Neutral units get no team tint; factions map to the shader's team colours. */
const TEAM_OF: Record<UnitTeam, 'warden' | 'hollow' | null> = {
  wardens: 'warden',
  hollow: 'hollow',
  neutral: null,
};

export const createToonUnitLook: UnitLookFactory = (meshes) => {
  const originals = new Map<AbstractMesh, Material | null>(meshes.map((m) => [m, m.material]));
  const id = modelIdForMeshNames(meshes.map((m) => m.name));
  const teamMask = id ? teamMaskFor(id) : [];
  const look: UnitLook = {
    setTeam(team) {
      for (const [mesh, src] of originals) {
        if (src) mesh.material = toonMaterialFor(src, { team: TEAM_OF[team], teamMask });
      }
    },
    setHighlight(mode, color) {
      const on = mode !== 'none';
      for (const mesh of originals.keys()) {
        mesh.renderOutline = on;
        if (on) {
          mesh.outlineColor = new Color3(color[0], color[1], color[2]);
          mesh.outlineWidth = mode === 'selected' ? 0.035 : 0.02;
        }
      }
    },
    dispose() {
      for (const mesh of originals.keys()) mesh.renderOutline = false;
      originals.clear();
    },
  };
  return look;
};

/** Makes UnitViews created from now on use the toon material. */
export function installToonUnitLook(): void {
  setUnitLookFactory(createToonUnitLook);
}
