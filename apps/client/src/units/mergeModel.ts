import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Bone } from '@babylonjs/core/Bones/bone';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { Node } from '@babylonjs/core/node';
import { rebakeSkinnedPart, type RebakedStreams, type SkinDesc } from './skinRemap';

/**
 * Draw-call reduction for KayKit-style characters (docs/design/units.md §4).
 *
 * A KayKit character is ~6 skinned body parts plus rigid props (sword,
 * shield, hat, cape) parented to attachment bones: ~10 draw calls per unit,
 * so 50 units would be ~500. All parts share one material and one set of
 * joint nodes, so we fold every *visible* part into one skinned mesh per
 * material, on the first skinned part's skeleton:
 *
 * - Skinned parts are first unified onto that skeleton (`unifySkins`). Each
 *   part has its own glTF skin (own Babylon Skeleton, own joint order, own
 *   inverse bind matrices with the part's dequantization folded in), so its
 *   vertices are rebaked into the reference bind space and its joint indices
 *   remapped by joint node. Merging parts without this mirrored the Knight's
 *   body behind its head.
 * - Rigid props are re-expressed in bind space and skinned 100% to the bone
 *   their attachment node hangs off, so they still follow the hand/head.
 *
 * The result is 1 draw call per hero model and 2 for skeleton_minion (body +
 * glowing eyes). Animation groups keep working because they animate the bone
 * transform nodes, not the meshes. Hidden spare props are left untouched.
 * Works at any pose and under any parent transform (rotated, scaled).
 *
 * Returns the meshes to render, or the input unchanged when the model doesn't
 * fit the assumptions (skins that can't be unified, >4 influences, no skin).
 */
export function mergeSkinnedParts(
  root: TransformNode,
  meshes: readonly AbstractMesh[],
  name: string,
): AbstractMesh[] {
  const visible = meshes.filter(
    (m): m is Mesh => m instanceof Mesh && m.isEnabled() && m.getTotalVertices() > 0,
  );
  const skinned = visible.filter((m) => m.skeleton);
  const ref = skinned[0];
  if (!ref || !ref.skeleton) return [...meshes];
  const skeleton = ref.skeleton;
  if (visible.some((m) => m.isVerticesDataPresent(VertexBuffer.MatricesIndicesExtraKind))) {
    return [...meshes];
  }
  const unified = unifySkins(skinned, skeleton);
  if (!unified) return [...meshes];

  // Bring every world matrix and bone matrix up to date for the current (rest) pose.
  root.computeWorldMatrix(true);
  for (const n of root.getDescendants(false)) {
    (n as TransformNode).computeWorldMatrix?.(true);
  }
  skeleton.prepare(true);
  const boneMatrices = skeleton.getTransformMatrices(ref);
  const refWorld = ref.computeWorldMatrix(true);
  // Skinned parts must share a world transform, otherwise their vertices aren't in one space.
  for (const m of skinned) {
    if (!matricesClose(m.computeWorldMatrix(true), refWorld)) return [...meshes];
  }

  const boneByNode = new Map<Node, Bone>();
  for (const b of skeleton.bones) {
    const tn = b.getTransformNode();
    if (tn) boneByNode.set(tn, b);
  }
  const boneIndexOf = (b: Bone) => {
    const i = b.getIndex();
    return i >= 0 ? i : skeleton.bones.indexOf(b);
  };

  // Group by material: one merged mesh (one draw call) per material.
  const groups = new Map<number, Mesh[]>();
  for (const m of visible) {
    const key = m.material?.uniqueId ?? -1;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(m);
  }

  const out: Mesh[] = [];
  const consumed: Mesh[] = [];
  const tmp = new Vector3();
  const invRef = new Matrix();
  for (const group of groups.values()) {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const mIdx: number[] = [];
    const mW: number[] = [];
    let ok = true;
    for (const m of group) {
      const rebaked = unified.get(m);
      const pos = rebaked?.positions ?? m.getVerticesData(VertexBuffer.PositionKind);
      const nrm = rebaked ? rebaked.normals : m.getVerticesData(VertexBuffer.NormalKind);
      const uv = m.getVerticesData(VertexBuffer.UVKind);
      const idx = m.getIndices();
      if (!pos || !idx) {
        ok = false;
        break;
      }
      const base = positions.length / 3;
      const count = pos.length / 3;
      let xform: Matrix | null = null;
      let boneIndex = 0;
      if (!m.skeleton) {
        // Rigid prop: find the bone its attachment node belongs to.
        let n: Node | null = m.parent;
        let bone: Bone | undefined;
        while (n && !(bone = boneByNode.get(n))) n = n.parent;
        if (!bone) {
          ok = false;
          break;
        }
        boneIndex = boneIndexOf(bone);
        const boneMat = Matrix.FromArray(boneMatrices, boneIndex * 16);
        boneMat.multiplyToRef(refWorld, invRef);
        invRef.invert();
        xform = m.computeWorldMatrix(true).multiply(invRef);
      }
      for (let i = 0; i < count; i++) {
        tmp.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
        if (xform) Vector3.TransformCoordinatesToRef(tmp, xform, tmp);
        positions.push(tmp.x, tmp.y, tmp.z);
        if (nrm) {
          tmp.set(nrm[i * 3]!, nrm[i * 3 + 1]!, nrm[i * 3 + 2]!);
          if (xform) Vector3.TransformNormalToRef(tmp, xform, tmp);
          tmp.normalize();
          normals.push(tmp.x, tmp.y, tmp.z);
        } else normals.push(0, 1, 0);
        if (uv) uvs.push(uv[i * 2]!, uv[i * 2 + 1]!);
        else uvs.push(0, 0);
      }
      if (m.skeleton) {
        const mi = rebaked?.matricesIndices ?? m.getVerticesData(VertexBuffer.MatricesIndicesKind);
        const mw = m.getVerticesData(VertexBuffer.MatricesWeightsKind);
        if (!mi || !mw || mi.length !== count * 4 || mw.length !== count * 4) {
          ok = false;
          break;
        }
        for (let i = 0; i < count * 4; i++) {
          mIdx.push(mi[i]!);
          mW.push(mw[i]!);
        }
      } else {
        for (let i = 0; i < count; i++) {
          mIdx.push(boneIndex, 0, 0, 0);
          mW.push(1, 0, 0, 0);
        }
      }
      for (let i = 0; i < idx.length; i++) indices.push(idx[i]! + base);
    }
    if (!ok) {
      for (const m of out) m.dispose();
      return [...meshes];
    }
    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.uvs = uvs;
    vd.indices = indices;
    vd.matricesIndices = mIdx;
    vd.matricesWeights = mW;
    const merged = new Mesh(`${name}-merged-${out.length}`, root.getScene());
    vd.applyToMesh(merged, false);
    merged.parent = ref.parent;
    merged.position.copyFrom(ref.position);
    if (ref.rotationQuaternion) merged.rotationQuaternion = ref.rotationQuaternion.clone();
    else merged.rotation.copyFrom(ref.rotation);
    merged.scaling.copyFrom(ref.scaling);
    merged.material = group[0]!.material;
    // Keep the glTF winding (a new Mesh defaults to the opposite, which flips lighting).
    merged.sideOrientation = ref.sideOrientation;
    merged.skeleton = skeleton;
    merged.numBoneInfluencers = 4;
    out.push(merged);
    consumed.push(...group);
  }
  for (const m of consumed) m.dispose(true, false);
  const kept = meshes.filter((m) => !consumed.includes(m as Mesh));
  return [...out, ...kept];
}

/** A Babylon skeleton as a pure SkinDesc: joint keys (bone node ids) and IBMs by joint index. */
function skinDesc(sk: Skeleton): SkinDesc {
  const indexOf = (b: Bone) => {
    const i = b.getIndex();
    return i >= 0 ? i : sk.bones.indexOf(b);
  };
  let n = 0;
  for (const b of sk.bones) n = Math.max(n, indexOf(b) + 1);
  const keys: (string | number | undefined)[] = new Array<undefined>(n).fill(undefined);
  const ibm = new Float32Array(n * 16);
  for (const b of sk.bones) {
    const i = indexOf(b);
    const tn = b.getTransformNode();
    keys[i] = tn ? tn.uniqueId : `bone:${b.name}`;
    ibm.set(b.getAbsoluteInverseBindMatrix().m, i * 16);
  }
  return { keys, ibm };
}

/**
 * Plan how every skinned part lands on `skeleton` (docs/design/units.md §4).
 * Parts already on it map to null (use their streams as they are); parts on
 * another skeleton get rebaked streams (positions/normals in `skeleton`'s bind
 * space, joint indices remapped by joint node). Returns null, touching
 * nothing, if any part can't be unified. Pure with respect to the meshes: no
 * geometry is modified (clones share geometry with the cached container).
 */
export function unifySkins(
  skinned: readonly Mesh[],
  skeleton: Skeleton,
): Map<Mesh, RebakedStreams | null> | null {
  const out = new Map<Mesh, RebakedStreams | null>();
  const descs = new Map<Skeleton, SkinDesc>();
  const descOf = (sk: Skeleton) => {
    let d = descs.get(sk);
    if (!d) descs.set(sk, (d = skinDesc(sk)));
    return d;
  };
  for (const m of skinned) {
    const sk = m.skeleton;
    if (!sk) return null;
    if (sk === skeleton) {
      out.set(m, null);
      continue;
    }
    const positions = m.getVerticesData(VertexBuffer.PositionKind);
    const matricesIndices = m.getVerticesData(VertexBuffer.MatricesIndicesKind);
    const matricesWeights = m.getVerticesData(VertexBuffer.MatricesWeightsKind);
    if (!positions || !matricesIndices || !matricesWeights) return null;
    const rebaked = rebakeSkinnedPart(
      {
        positions,
        normals: m.getVerticesData(VertexBuffer.NormalKind),
        matricesIndices,
        matricesWeights,
      },
      descOf(sk),
      descOf(skeleton),
    );
    if (!rebaked) return null;
    out.set(m, rebaked);
  }
  return out;
}

function matricesClose(a: Matrix, b: Matrix, eps = 1e-4): boolean {
  const x = a.m;
  const y = b.m;
  for (let i = 0; i < 16; i++) if (Math.abs(x[i]! - y[i]!) > eps) return false;
  return true;
}
