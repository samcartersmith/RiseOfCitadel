import { describe, expect, it } from 'vitest';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import {
  buildBoneRemap,
  rebakeSkinnedPart,
  remapInfluences,
  skinCorrection,
  type SkinDesc,
} from './skinRemap';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMatrix(r: () => number, uniformScale = true): Matrix {
  const q = Quaternion.RotationYawPitchRoll(r() * 6, r() * 6, r() * 6);
  const s = uniformScale
    ? Vector3.One().scale(0.5 + r())
    : new Vector3(0.5 + r(), 0.5 + r(), 0.5 + r());
  const t = new Vector3(r() * 4 - 2, r() * 4 - 2, r() * 4 - 2);
  return Matrix.Compose(s, q, t);
}

/** Babylon's linear-blend skinning of one vertex (row vectors: v · IBM · W). */
function skin(
  pos: ArrayLike<number>,
  idx: ArrayLike<number>,
  w: ArrayLike<number>,
  vi: number,
  desc: SkinDesc,
  world: Map<string | number, Matrix>,
): Vector3 {
  const out = new Vector3();
  const v = new Vector3(pos[vi * 3]!, pos[vi * 3 + 1]!, pos[vi * 3 + 2]!);
  for (let k = 0; k < 4; k++) {
    const weight = w[vi * 4 + k]!;
    if (weight === 0) continue;
    const j = idx[vi * 4 + k]!;
    const m = Matrix.FromArray(desc.ibm, j * 16).multiply(world.get(desc.keys[j]!)!);
    out.addInPlace(Vector3.TransformCoordinates(v, m).scale(weight));
  }
  return out;
}

describe('buildBoneRemap', () => {
  it('maps joints by key regardless of order, -1 when missing', () => {
    const map = buildBoneRemap(['hips', 'spine', 'head', 'tail'], ['head', 'hips', 'spine']);
    expect([...map]).toEqual([1, 2, 0, -1]);
  });
  it('ignores unused slots', () => {
    expect([...buildBoneRemap([undefined, 'a'], ['a'])]).toEqual([-1, 0]);
  });
});

describe('remapInfluences', () => {
  it('remaps weighted influences and zeroes unweighted unmapped ones', () => {
    const map = Int32Array.from([2, -1, 0]);
    const out = remapInfluences([0, 2, 1, 1], [0.7, 0.3, 0, 0], map);
    expect(out && [...out]).toEqual([2, 0, 0, 0]);
  });
  it('fails when a weighted influence has no target joint', () => {
    expect(remapInfluences([1, 0, 0, 0], [1, 0, 0, 0], Int32Array.from([0, -1]))).toBeNull();
  });
});

describe('skinCorrection', () => {
  it('rejects skins that differ by more than one constant matrix', () => {
    const r = rng(3);
    const a = randomMatrix(r);
    const b = randomMatrix(r);
    const src = new Float32Array(32);
    const tgt = new Float32Array(32);
    src.set(a.m, 0);
    src.set(b.m, 16);
    tgt.set(Matrix.Identity().m, 0);
    tgt.set(Matrix.Identity().m, 16);
    expect(skinCorrection(src, tgt, Int32Array.from([0, 1]), [0, 1])).toBeNull();
    // Only joint 0 used: any single matrix fits.
    expect(skinCorrection(src, tgt, Int32Array.from([0, 1]), [0])).not.toBeNull();
  });
});

describe('rebakeSkinnedPart', () => {
  const JOINTS = ['root', 'hips', 'spine', 'chest', 'head', 'arm.l', 'arm.r', 'leg.l'];

  function setup(seed: number) {
    const r = rng(seed);
    // Reference skin: joints in one order, arbitrary IBMs.
    const tgtKeys = [...JOINTS];
    const tgtIbm = new Float32Array(JOINTS.length * 16);
    JOINTS.forEach((_, i) => tgtIbm.set(randomMatrix(r).m, i * 16));
    // Part skin: same joint nodes in a different order, IBMs with a quantization
    // transform folded in (IBM_part[j] = D · IBM_ref[j']).
    const order = [3, 0, 7, 5, 1, 6, 2, 4];
    const srcKeys = order.map((i) => JOINTS[i]!);
    const d = randomMatrix(r);
    const srcIbm = new Float32Array(JOINTS.length * 16);
    order.forEach((ti, si) => {
      srcIbm.set(d.multiply(Matrix.FromArray(tgtIbm, ti * 16)).m, si * 16);
    });
    // A part with multi-joint weights.
    const n = 40;
    const positions = Array.from({ length: n * 3 }, () => r() * 2 - 1);
    const normals = Array.from({ length: n * 3 }, () => r() * 2 - 1);
    const matricesIndices: number[] = [];
    const matricesWeights: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.floor(r() * 8);
      const b = (a + 1 + Math.floor(r() * 7)) % 8;
      const wa = 0.2 + r() * 0.6;
      matricesIndices.push(a, b, 0, 0);
      matricesWeights.push(wa, 1 - wa, 0, 0);
    }
    // A posed skeleton: arbitrary world matrix per joint node.
    const world = new Map<string | number, Matrix>(JOINTS.map((k) => [k, randomMatrix(r)]));
    return {
      part: { positions, normals, matricesIndices, matricesWeights },
      src: { keys: srcKeys, ibm: srcIbm } satisfies SkinDesc,
      tgt: { keys: tgtKeys, ibm: tgtIbm } satisfies SkinDesc,
      world,
    };
  }

  it('skins every vertex identically on the reference skeleton (any pose, permuted joints)', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { part, src, tgt, world } = setup(seed);
      const out = rebakeSkinnedPart(part, src, tgt);
      expect(out).not.toBeNull();
      for (let vi = 0; vi < part.positions.length / 3; vi++) {
        const before = skin(
          part.positions,
          part.matricesIndices,
          part.matricesWeights,
          vi,
          src,
          world,
        );
        const after = skin(
          out!.positions,
          out!.matricesIndices,
          part.matricesWeights,
          vi,
          tgt,
          world,
        );
        expect(Vector3.Distance(before, after)).toBeLessThan(1e-3);
      }
    }
  });

  it('is the identity for a part already on the reference skin', () => {
    const { part, tgt } = setup(9);
    const out = rebakeSkinnedPart(part, tgt, tgt)!;
    for (let i = 0; i < part.positions.length; i++) {
      expect(out.positions[i]).toBeCloseTo(part.positions[i]!, 5);
    }
    expect([...out.matricesIndices]).toEqual(part.matricesIndices);
  });

  it('keeps normals unit length and rotated with the correction', () => {
    const { part, src, tgt } = setup(5);
    const out = rebakeSkinnedPart(part, src, tgt)!;
    for (let i = 0; i < out.normals!.length; i += 3) {
      const len = Math.hypot(out.normals![i]!, out.normals![i + 1]!, out.normals![i + 2]!);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('refuses a part whose skin is not a constant correction of the reference', () => {
    const { part, src, tgt } = setup(6);
    const broken = { keys: src.keys, ibm: Float32Array.from(src.ibm) };
    broken.ibm.set(Matrix.Translation(5, 0, 0).m, 0);
    expect(rebakeSkinnedPart(part, broken, tgt)).toBeNull();
  });
});
