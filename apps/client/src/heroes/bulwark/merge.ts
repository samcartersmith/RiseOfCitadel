/**
 * Merge fix-ups for KayKit characters (docs/design/heroes/bulwark.md §6).
 *
 * `mergeSkinnedParts` (units/mergeModel.ts, M1-13) assumes every skinned part
 * of a character shares one skeleton. In our pipeline's GLBs they don't:
 * `pnpm assets:build` quantizes each mesh (KHR_mesh_quantization), and
 * gltf-transform folds each mesh's dequantization transform into that mesh's
 * own skin (its inverse bind matrices). Babylon loads one Skeleton per skin, so
 * merging the parts onto the first part's skeleton puts every other part in the
 * wrong space (the body ends up mirrored behind the head).
 *
 * `unifySkins` re-expresses each part's vertices in the first part's bind
 * space (one constant matrix per part: IBM_part · IBM_ref⁻¹) and points it at
 * the shared skeleton, after which merging is exact. `mergeCharacter` runs
 * that, then the merge, then copies the glTF winding onto the merged meshes.
 *
 * These belong in units/mergeModel.ts; they live here until a units/ PR picks
 * them up (this PR may not edit that module).
 */
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { mergeSkinnedParts } from '../../units/mergeModel';

/** Max per-element difference between per-joint corrections we accept as "constant". */
const EPS = 1e-3;

/**
 * Make every enabled skinned part use the first part's skeleton, rewriting
 * vertex positions/normals into that skeleton's bind space. Returns false (and
 * changes nothing further) if a part's correction isn't the same for every
 * joint, i.e. the skins genuinely differ.
 */
export function unifySkins(meshes: readonly AbstractMesh[]): boolean {
  const skinned = meshes.filter(
    (m): m is Mesh =>
      m instanceof Mesh && !!m.skeleton && m.isEnabled() && m.getTotalVertices() > 0,
  );
  const ref = skinned[0]?.skeleton;
  if (!ref) return true;
  for (const m of skinned) {
    const sk = m.skeleton!;
    if (sk === ref) continue;
    if (sk.bones.length !== ref.bones.length) return false;
    const correction = (j: number) =>
      sk.bones[j]!.getAbsoluteInverseBindMatrix().multiply(
        Matrix.Invert(ref.bones[j]!.getAbsoluteInverseBindMatrix()),
      );
    const c = correction(0);
    for (let j = 1; j < sk.bones.length; j++) {
      const cj = correction(j).m;
      for (let k = 0; k < 16; k++)
        if (Math.abs(cj[k]! - c.m[k]!) > EPS * (1 + Math.abs(c.m[k]!))) return false;
    }
    const normalMatrix = Matrix.Invert(c).transpose();
    m.makeGeometryUnique();
    const pos = m.getVerticesData(VertexBuffer.PositionKind);
    const nrm = m.getVerticesData(VertexBuffer.NormalKind);
    const v = new Vector3();
    if (pos) {
      const out = new Float32Array(pos.length);
      for (let i = 0; i < pos.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(pos[i]!, pos[i + 1]!, pos[i + 2]!, c, v);
        out[i] = v.x;
        out[i + 1] = v.y;
        out[i + 2] = v.z;
      }
      m.setVerticesData(VertexBuffer.PositionKind, out, false);
    }
    if (nrm) {
      const out = new Float32Array(nrm.length);
      for (let i = 0; i < nrm.length; i += 3) {
        Vector3.TransformNormalFromFloatsToRef(nrm[i]!, nrm[i + 1]!, nrm[i + 2]!, normalMatrix, v);
        v.normalize();
        out[i] = v.x;
        out[i + 1] = v.y;
        out[i + 2] = v.z;
      }
      m.setVerticesData(VertexBuffer.NormalKind, out, false);
    }
    m.skeleton = ref;
  }
  return true;
}

/**
 * `mergeSkinnedParts` with the fix-ups above: unify skins first, then copy
 * the glTF meshes' winding (clockwise; a `new Mesh` defaults to
 * counter-clockwise, which flips two-sided lighting) onto the merged meshes.
 * Falls back to the unmerged meshes if the skins can't be unified.
 */
export function mergeCharacter(
  root: TransformNode,
  meshes: readonly AbstractMesh[],
  name: string,
): AbstractMesh[] {
  const gltf = meshes.find((m): m is Mesh => m instanceof Mesh && !!m.skeleton);
  if (!gltf) return [...meshes];
  const side = gltf.sideOrientation;
  if (!unifySkins(meshes)) return [...meshes];
  const before = new Set(meshes);
  const out = mergeSkinnedParts(root, meshes, name);
  for (const m of out) if (!before.has(m) && m instanceof Mesh) m.sideOrientation = side;
  return out;
}
