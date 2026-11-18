import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import { toonMaterialFor } from '../../render/shaders/applyCitadelToon';
import type { CitadelToonMaterial } from '../../render/shaders/citadelToonMaterial';
import type { Team } from '../../units/unitState';
import { ATLAS_SIZE } from './config';
import { BULWARK_TEAM_MASK, buildAtlasPixels } from './palette';

export { BULWARK_TEAM_MASK };

/** UnitView teams → toon team colours (neutral = undyed cloth), as in toonUnitLook.ts. */
const TOON_TEAM: Record<Team, 'warden' | 'hollow' | null> = {
  wardens: 'warden',
  hollow: 'hollow',
  neutral: null,
};

const bases = new WeakMap<Scene, StandardMaterial>();
const masks = new WeakMap<Scene, RawTexture>();

function atlasTexture(scene: Scene, name: string, pixels: Uint8Array): RawTexture {
  const tex = RawTexture.CreateRGBATexture(
    pixels,
    ATLAS_SIZE,
    ATLAS_SIZE,
    scene,
    true,
    false, // row 0 is the top of the image, matching glTF UVs (v = 0 at the top)
    Constants.TEXTURE_TRILINEAR_SAMPLINGMODE,
  );
  tex.name = name;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

/**
 * The plain (untoned) Bulwark material: the generated palette atlas, one per
 * scene. It's the *source* the toon material is derived from, and what the
 * sandbox shows with `?toon=0`. `like` copies culling from the KayKit material
 * (double-sided). Winding lives on the meshes (glTF meshes are clockwise).
 */
export function bulwarkBaseMaterial(scene: Scene, like?: Material | null): StandardMaterial {
  const hit = bases.get(scene);
  if (hit) return hit;
  const m = new StandardMaterial('bulwark-atlas', scene);
  m.diffuseTexture = atlasTexture(scene, 'bulwark-atlas', buildAtlasPixels(ATLAS_SIZE));
  m.specularColor = new Color3(0.06, 0.055, 0.05);
  m.backFaceCulling = like ? like.backFaceCulling : false;
  m.twoSidedLighting = !m.backFaceCulling;
  bases.set(scene, m);
  return m;
}

/**
 * The toon material for one team: shared by every Bulwark instance of that
 * team (cached by applyCitadelToon), so no per-unit materials or draw calls.
 */
export function bulwarkToonMaterial(
  scene: Scene,
  team: Team,
  like?: Material | null,
): CitadelToonMaterial {
  return toonMaterialFor(bulwarkBaseMaterial(scene, like), {
    team: TOON_TEAM[team],
    teamMask: BULWARK_TEAM_MASK,
  });
}

/** White-on-black team mask texture (debug view and coverage measurement). */
export function bulwarkTeamMaskTexture(scene: Scene): RawTexture {
  let m = masks.get(scene);
  if (!m) {
    m = atlasTexture(scene, 'bulwark-team-mask', buildAtlasPixels(ATLAS_SIZE, true));
    masks.set(scene, m);
  }
  return m;
}
