import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';

/**
 * Pure skin-unification math for mergeModel.ts (docs/design/units.md §4).
 * No meshes or scenes, so it is unit-tested in skinRemap.test.ts.
 *
 * Babylon skins a vertex as  v · IBM[j] · W[j]  (row vectors), where IBM is a
 * joint's inverse bind matrix and W the joint's current world matrix. KayKit
 * GLBs give every body part its own skin over the same joint nodes, and our
 * asset pipeline's quantization folds each part's dequantization transform D
 * into that part's IBMs: IBM_part[j] = D · IBM_ref[j']. So a part's vertices
 * can be moved into the reference skin's bind space with one constant matrix,
 * v' = v · D, and its joint indices remapped j → j'; after that the part skins
 * identically on the reference skeleton.
 */

/** A part's skin: per-joint-index keys (what joint node it is) and inverse bind matrices. */
export interface SkinDesc {
  /** keys[j] identifies the joint at index j (a node id or name); undefined = unused slot. */
  keys: readonly (string | number | undefined)[];
  /** 16 floats per joint index (Babylon's row-major Matrix.m layout). */
  ibm: ArrayLike<number>;
}

/** Vertex streams of one skinned part (4 influences per vertex). */
export interface SkinnedStreams {
  positions: ArrayLike<number>;
  normals?: ArrayLike<number> | null;
  matricesIndices: ArrayLike<number>;
  matricesWeights: ArrayLike<number>;
}

export interface RebakedStreams {
  positions: Float32Array;
  normals: Float32Array | null;
  matricesIndices: Float32Array;
}

/** For each source joint index, the target joint index with the same key, or -1. */
export function buildBoneRemap(
  source: readonly (string | number | undefined)[],
  target: readonly (string | number | undefined)[],
): Int32Array {
  const at = new Map<string | number, number>();
  target.forEach((k, i) => {
    if (k !== undefined && !at.has(k)) at.set(k, i);
  });
  const map = new Int32Array(source.length).fill(-1);
  source.forEach((k, i) => {
    if (k !== undefined) map[i] = at.get(k) ?? -1;
  });
  return map;
}

/**
 * Remap 4-influence joint indices through `map`. Returns null when a weighted
 * influence points at a joint the target doesn't have. Unweighted slots map to 0.
 */
export function remapInfluences(
  indices: ArrayLike<number>,
  weights: ArrayLike<number>,
  map: Int32Array,
): Float32Array | null {
  const out = new Float32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const j = map[indices[i]!] ?? -1;
    if (j < 0) {
      if (weights[i]! > 0) return null;
      out[i] = 0;
    } else out[i] = j;
  }
  return out;
}

/**
 * The constant matrix C with IBM_src[j] = C · IBM_tgt[map[j]] for every joint
 * in `joints`, or null if no single C fits (the skins genuinely differ).
 */
export function skinCorrection(
  src: ArrayLike<number>,
  tgt: ArrayLike<number>,
  map: Int32Array,
  joints: Iterable<number>,
  eps = 1e-3,
): Matrix | null {
  let c: Matrix | null = null;
  const inv = new Matrix();
  const cj = new Matrix();
  for (const j of joints) {
    const t = map[j] ?? -1;
    if (t < 0) return null;
    Matrix.FromArrayToRef(tgt, t * 16, inv);
    inv.invert();
    Matrix.FromArray(src, j * 16).multiplyToRef(inv, cj);
    if (!c) {
      c = cj.clone();
      continue;
    }
    for (let k = 0; k < 16; k++) {
      if (Math.abs(cj.m[k]! - c.m[k]!) > eps * (1 + Math.abs(c.m[k]!))) return null;
    }
  }
  return c ?? Matrix.Identity();
}

/** Joint indices that carry weight in a 4-influence stream. */
export function usedJoints(indices: ArrayLike<number>, weights: ArrayLike<number>): Set<number> {
  const used = new Set<number>();
  for (let i = 0; i < indices.length; i++) if (weights[i]! > 0) used.add(indices[i]!);
  return used;
}

/**
 * Re-express a skinned part, authored against skin `src`, so that it skins
 * identically against skin `tgt`: positions/normals are baked through the
 * constant correction and joint indices are remapped by key. Returns null
 * if that is impossible (missing joints, or no constant correction).
 */
export function rebakeSkinnedPart(
  part: SkinnedStreams,
  src: SkinDesc,
  tgt: SkinDesc,
  eps = 1e-3,
): RebakedStreams | null {
  const map = buildBoneRemap(src.keys, tgt.keys);
  const matricesIndices = remapInfluences(part.matricesIndices, part.matricesWeights, map);
  if (!matricesIndices) return null;
  const c = skinCorrection(
    src.ibm,
    tgt.ibm,
    map,
    usedJoints(part.matricesIndices, part.matricesWeights),
    eps,
  );
  if (!c) return null;
  const normalMatrix = Matrix.Invert(c).transpose();
  const v = new Vector3();
  const p = part.positions;
  const positions = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(p[i]!, p[i + 1]!, p[i + 2]!, c, v);
    positions[i] = v.x;
    positions[i + 1] = v.y;
    positions[i + 2] = v.z;
  }
  let normals: Float32Array | null = null;
  const n = part.normals;
  if (n) {
    normals = new Float32Array(n.length);
    for (let i = 0; i < n.length; i += 3) {
      Vector3.TransformNormalFromFloatsToRef(n[i]!, n[i + 1]!, n[i + 2]!, normalMatrix, v);
      v.normalize();
      normals[i] = v.x;
      normals[i + 1] = v.y;
      normals[i + 2] = v.z;
    }
  }
  return { positions, normals, matricesIndices };
}
