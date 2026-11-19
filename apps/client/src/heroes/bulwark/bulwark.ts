/**
 * Bulwark (H01) model: KayKit Knight body + code-built kit-bash parts,
 * restyled with a generated palette atlas + the Citadel toon material, and
 * merged to one draw call.
 * See docs/design/heroes/bulwark.md.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Material } from '@babylonjs/core/Materials/material';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import { loadModel, type LoadedModel, type LoadModelOptions } from '../../units/loadModel';
import { mergeSkinnedParts } from '../../units/mergeModel';
import type { UnitLook } from '../../units/look';
import type { Team } from '../../units/unitState';
import { BONE_SCALES, BULWARK_VIEW_CONFIG, inheritedScale } from './config';
import { BULWARK_PARTS, type PartSpec } from './parts';
import { bulwarkBaseMaterial } from './material';
import { createBulwarkLook } from './look';

export interface LoadBulwarkOptions extends Omit<LoadModelOptions, 'mergeMeshes'> {
  team?: Team;
  /** Merge body + parts into one skinned mesh (default true). */
  merge?: boolean;
  /** Apply the UnitLook (toon material, team dye, outline). Default true; false = plain atlas. */
  look?: boolean;
  /** Push proportions (BONE_SCALES). Default true. */
  proportions?: boolean;
}

export interface BulwarkModel extends LoadedModel {
  /** UnitLook driving team colour + highlight (null when `look: false`). */
  look: UnitLook | null;
  setTeam(team: Team): void;
  /** Triangles and draw calls this instance renders (enabled meshes only). */
  renderStats(): { triangles: number; drawCalls: number; meshes: number };
}

function partMesh(spec: PartSpec, bone: TransformNode, scene: Scene): Mesh {
  const data = spec.build();
  const vd = new VertexData();
  vd.positions = data.positions;
  vd.normals = data.normals;
  vd.uvs = data.uvs;
  vd.indices = data.indices;
  const mesh = new Mesh(spec.name, scene);
  vd.applyToMesh(mesh, false);
  mesh.parent = bone;
  // Cancel the proportion scale the bone passes down, so parts keep model units.
  const k = 1 / inheritedScale(spec.bone);
  // `position` is given in the part's own (rotated) frame, so it turns with the part.
  const [ax, ay, az] = spec.axes;
  // Babylon matrices are row-vector: each row is the image of a basis axis.
  const q = Quaternion.FromRotationMatrix(
    Matrix.FromValues(...ax, 0, ...ay, 0, ...az, 0, 0, 0, 0, 1),
  );
  const p = new Vector3(...spec.position).applyRotationQuaternionInPlace(q).scaleInPlace(k);
  mesh.position.copyFrom(p);
  mesh.rotationQuaternion = q;
  mesh.scaling.setAll(k);
  return mesh;
}

/** Load one Bulwark instance (the Knight GLB is loaded once per scene and cloned). */
export async function loadBulwark(
  scene: Scene,
  options: LoadBulwarkOptions = {},
): Promise<BulwarkModel> {
  const {
    team = 'wardens',
    merge = true,
    look: useLook = true,
    proportions = true,
    ...anim
  } = options;
  const base = await loadModel(scene, BULWARK_VIEW_CONFIG, { ...anim, mergeMeshes: false });
  const { root } = base;
  const nodes = new Map<string, TransformNode>();
  for (const n of root.getDescendants(false)) nodes.set(n.name, n as TransformNode);
  const node = (name: string) => {
    const n = nodes.get(name);
    if (!n) throw new Error(`[citadel] bulwark: bone ${name} not found`);
    return n;
  };

  // Proportion push, re-applied after every animation step (clips key bone scale).
  let observer: Observer<Scene> | null = null;
  if (proportions) {
    const scaled = Object.entries(BONE_SCALES).map(([name, k]) => [node(name), k] as const);
    const apply = () => {
      for (const [n, k] of scaled) n.scaling.setAll(k);
    };
    apply();
    observer = scene.onAfterAnimationsObservable.add(apply);
  }

  const source = base.meshes.find((m) => m.material)?.material ?? null;
  const gltfSkin = base.meshes.find((m): m is Mesh => m instanceof Mesh && !!m.skeleton);
  const side = gltfSkin?.sideOrientation ?? Material.ClockWiseSideOrientation;
  const material = bulwarkBaseMaterial(scene, source);
  const parts = BULWARK_PARTS.map((spec) => partMesh(spec, node(spec.bone), scene));
  let meshes: AbstractMesh[] = [...base.meshes, ...parts];
  for (const m of meshes) if (m.isEnabled()) m.material = material;
  // Parts are authored with glTF winding (counter-clockwise, right-handed), like the body.
  for (const p of parts) p.sideOrientation = side;
  if (merge) meshes = mergeSkinnedParts(root, meshes, 'bulwark');

  const look = useLook ? createBulwarkLook(meshes, scene) : null;
  const setTeam = (t: Team) => look?.setTeam(t);
  setTeam(team);

  return {
    ...base,
    meshes,
    look,
    setTeam,
    renderStats() {
      let triangles = 0;
      let drawCalls = 0;
      let count = 0;
      for (const m of meshes) {
        if (!m.isEnabled() || !m.isVisible || m.getTotalIndices() === 0) continue;
        count++;
        triangles += m.getTotalIndices() / 3;
        drawCalls += m.subMeshes?.length ?? 1;
      }
      return { triangles, drawCalls, meshes: count };
    },
    dispose() {
      if (observer) scene.onAfterAnimationsObservable.remove(observer);
      look?.dispose();
      base.dispose();
    },
  };
}
