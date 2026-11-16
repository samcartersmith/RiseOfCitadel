import '@babylonjs/core/Rendering/outlineRenderer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import { UNIT_COLORS, type Rgb, type Team } from './unitState';

/**
 * How a unit's *model* shows team and highlight state. This is the seam the
 * M1-02 toon material plugs into: it supplies its own `UnitLookFactory`
 * (team rim + outline in the toon shader) via `setUnitLookFactory`, and
 * UnitView never needs to change. See docs/design/units.md §5.
 */
export type Highlight = 'none' | 'hover' | 'selected';

export interface UnitLook {
  /** Called when the unit's team changes (and once at creation). */
  setTeam(team: Team): void;
  /** Called whenever the highlight or its colour changes. */
  setHighlight(mode: Highlight, color: Rgb): void;
  dispose(): void;
}

export type UnitLookFactory = (meshes: readonly AbstractMesh[], scene: Scene) => UnitLook;

let factory: UnitLookFactory = createFallbackLook;

/** Replace the look for units created from now on (M1-02's toon material calls this). */
export function setUnitLookFactory(next: UnitLookFactory | null): void {
  factory = next ?? createFallbackLook;
}

export function createUnitLook(meshes: readonly AbstractMesh[], scene: Scene): UnitLook {
  return factory(meshes, scene);
}

// ---- Fallback (until the toon shader lands) ----------------------------------

/** One team-rim material per (source material, team), shared by every unit. */
const rimMaterials = new WeakMap<Scene, Map<string, Material>>();

/**
 * Team-rim version of a model material: an unlit-ish StandardMaterial on the
 * same albedo texture with an emissive fresnel rim in the faction colour.
 * Shared, so it costs no extra draw calls or shader variants per unit.
 * Materials without an albedo texture (e.g. glowing eyes) are left alone.
 */
function rimMaterialFor(source: Material, team: Team, scene: Scene): Material {
  let cache = rimMaterials.get(scene);
  if (!cache) rimMaterials.set(scene, (cache = new Map()));
  const key = `${source.uniqueId}|${team}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const albedo =
    source instanceof PBRMaterial
      ? source.albedoTexture
      : source instanceof StandardMaterial
        ? source.diffuseTexture
        : null;
  if (!albedo) {
    cache.set(key, source);
    return source;
  }
  const m = new StandardMaterial(`unit-rim-${source.name}-${team}`, scene);
  m.diffuseTexture = albedo;
  // glTF materials are wound counter-clockwise (the loader flips handedness at the root).
  m.sideOrientation = source.sideOrientation;
  m.backFaceCulling = source.backFaceCulling;
  m.specularColor = Color3.Black();
  const [r, g, b] = UNIT_COLORS.faction[team];
  const rim = new Color3(r, g, b);
  // A faint faction tint over the whole body plus a strong rim on silhouette edges.
  m.emissiveColor = rim.scale(team === 'neutral' ? 0.04 : 0.12);
  const fresnel = new FresnelParameters();
  fresnel.leftColor = rim.scale(team === 'neutral' ? 0.4 : 1.25);
  fresnel.rightColor = Color3.Black();
  fresnel.power = 1.6;
  fresnel.bias = 0.08;
  m.emissiveFresnelParameters = fresnel;
  // Add emissive on top of the lit texture instead of multiplying it by the
  // albedo, so the rim still reads on dark textures (skeleton creeps).
  m.useEmissiveAsIllumination = true;
  cache.set(key, m);
  return m;
}

/**
 * Fallback look: team-coloured fresnel rim through shared per-team materials,
 * plus Babylon's outline renderer on selected/hovered units only (one extra
 * draw call per outlined mesh, so at most a handful per frame).
 */
export function createFallbackLook(meshes: readonly AbstractMesh[], scene: Scene): UnitLook {
  const originals = new Map<AbstractMesh, Material | null>(meshes.map((m) => [m, m.material]));
  return {
    setTeam(team) {
      for (const [mesh, src] of originals) {
        if (src) mesh.material = rimMaterialFor(src, team, scene);
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
}
