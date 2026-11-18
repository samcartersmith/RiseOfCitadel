/**
 * applyCitadelToon: restyle a loaded model (glTF or hand-built) with the
 * shared toon material, keeping each mesh's base-colour texture.
 *
 * Materials are cached per scene by (texture or colour, emissive, sidedness,
 * team, mask, variant), so ten Warden knights share one material and the
 * originals in the AssetContainer are never modified. Draw calls are one per
 * mesh either way; sharing keeps shader variants and state changes down.
 */
import type { Material } from '@babylonjs/core/Materials/material';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { CitadelToonMaterial } from './citadelToonMaterial';
import { isTeam, TEAM_COLORS, type Team } from './palette';
import { teamMaskKey, type UvRect } from './teamMask';
import type { ToonParams } from './toonParams';

export interface ApplyToonOptions {
  /** Team tint for masked texels: a faction, a hex colour, or null/omitted for none. */
  team?: Team | string | null;
  /** Atlas UV rectangles that take the team colour (see teamMask.ts → TEAM_MASKS). */
  teamMask?: readonly UvRect[];
  /** Parameter overrides, applied when a material is first created. */
  params?: Partial<ToonParams>;
  /**
   * Separates caches when two callers need different params for the same
   * texture and team (e.g. the boot scene's 3× display-scaled hero).
   */
  variant?: string;
}

export interface ApplyToonResult {
  /** Distinct toon materials now used under the root. */
  materials: CitadelToonMaterial[];
  /** Meshes whose material was swapped. */
  meshes: AbstractMesh[];
}

/** The slice of PBRMaterial / StandardMaterial we read; duck-typed to avoid importing PBR. */
interface SourceMaterialLike extends Material {
  albedoTexture?: BaseTexture | null;
  albedoColor?: Color3;
  diffuseTexture?: BaseTexture | null;
  diffuseColor?: Color3;
  emissiveColor?: Color3;
}

const caches = new WeakMap<Scene, Map<string, CitadelToonMaterial>>();

function cacheFor(scene: Scene): Map<string, CitadelToonMaterial> {
  let c = caches.get(scene);
  if (!c) {
    c = new Map();
    caches.set(scene, c);
  }
  return c;
}

function resolveTeam(team: ApplyToonOptions['team']): string | null {
  if (!team) return null;
  return isTeam(team) ? TEAM_COLORS[team] : team;
}

/** Number of cached toon materials in a scene (for the debug hook and tests). */
export function toonMaterialCount(scene: Scene): number {
  return caches.get(scene)?.size ?? 0;
}

/**
 * The toon material for one source material: an existing cached one, or a new
 * one that takes over its texture, colours and sidedness.
 */
export function toonMaterialFor(
  source: Material,
  options: ApplyToonOptions = {},
): CitadelToonMaterial {
  const scene = source.getScene();
  if (source instanceof CitadelToonMaterial) return source;
  const src = source as SourceMaterialLike;
  const texture = src.albedoTexture ?? src.diffuseTexture ?? null;
  const base = src.albedoColor ?? src.diffuseColor ?? Color3.White();
  const emissive = src.emissiveColor ?? Color3.Black();
  const teamColor = resolveTeam(options.team);
  const mask = options.teamMask ?? [];
  const key = [
    texture ? `t${texture.uniqueId}` : `c${base.toHexString()}`,
    `e${emissive.toHexString()}`,
    source.backFaceCulling ? 'cull' : 'two',
    `s${source.sideOrientation ?? 'mesh'}`,
    teamColor ?? 'noteam',
    teamMaskKey(mask),
    options.variant ?? '',
  ].join('|');

  const cache = cacheFor(scene);
  const hit = cache.get(key);
  if (hit) return hit;

  const mat = new CitadelToonMaterial(`toon:${source.name}:${teamColor ?? 'none'}`, scene, {
    params: { ...options.params, teamColor },
    teamRects: mask,
  });
  if (texture) mat.diffuseTexture = texture;
  mat.diffuseColor = texture ? Color3.White() : base.clone();
  mat.emissiveColor = emissive.clone();
  // glTF materials carry their winding (the loader flips handedness at the root);
  // merged meshes rely on it, so copy it or two-sided lighting flips normals.
  mat.sideOrientation = source.sideOrientation;
  mat.backFaceCulling = source.backFaceCulling;
  mat.twoSidedLighting = !source.backFaceCulling;
  mat.alpha = source.alpha;
  cache.set(key, mat);
  mat.onDisposeObservable.addOnce(() => {
    if (cache.get(key) === mat) cache.delete(key);
  });
  return mat;
}

/**
 * Walks `root` and its descendants and swaps every mesh's material for the
 * matching toon material. Meshes without a material are skipped; multi-
 * materials are not used by our packs and are left untouched (a warning is
 * logged).
 */
export function applyCitadelToon(
  root: TransformNode | AbstractMesh,
  options: ApplyToonOptions = {},
): ApplyToonResult {
  const meshes: AbstractMesh[] = root.getChildMeshes(false);
  if ('material' in root) meshes.unshift(root as AbstractMesh);
  const used = new Set<CitadelToonMaterial>();
  const swapped: AbstractMesh[] = [];
  for (const mesh of meshes) {
    const m = mesh.material;
    if (!m) continue;
    if (m.getClassName() === 'MultiMaterial') {
      console.warn(`[citadel] toon: ${mesh.name} has a MultiMaterial; left unchanged`);
      continue;
    }
    const toon = toonMaterialFor(m, options);
    mesh.material = toon;
    used.add(toon);
    swapped.push(mesh);
  }
  return { materials: [...used], meshes: swapped };
}
