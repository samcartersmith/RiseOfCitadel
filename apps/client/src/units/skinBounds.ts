import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';

/** World-space extent of a set of (possibly skinned) meshes, CPU-skinned in the current pose. */
export interface SkinnedBounds {
  min: [number, number, number];
  max: [number, number, number];
  centroid: [number, number, number];
  vertices: number;
}

/**
 * CPU-skin every enabled mesh under `root` in its current pose and return the
 * world-space bounding box, vertex centroid and vertex count. Used by the
 * merge regression test (tests/unitMerge.spec.ts) to compare a merged and an
 * unmerged instance of the same model; merging must not move any vertex.
 */
export function skinnedWorldBounds(
  root: TransformNode,
  meshes: readonly AbstractMesh[],
): SkinnedBounds {
  root.computeWorldMatrix(true);
  for (const n of root.getDescendants(false)) (n as TransformNode).computeWorldMatrix?.(true);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const sum = new Vector3();
  const v = new Vector3();
  let count = 0;
  const prepared = new Set<unknown>();
  for (const m of meshes) {
    if (!m.isEnabled() || m.getTotalVertices() === 0) continue;
    if (m.skeleton && !prepared.has(m.skeleton)) {
      m.skeleton.prepare(true);
      prepared.add(m.skeleton);
    }
    const pos = m.getPositionData(true, false);
    if (!pos) continue;
    const world = m.computeWorldMatrix(true);
    for (let i = 0; i < pos.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(pos[i]!, pos[i + 1]!, pos[i + 2]!, world, v);
      min.minimizeInPlace(v);
      max.maximizeInPlace(v);
      sum.addInPlace(v);
      count++;
    }
  }
  const c = count ? sum.scale(1 / count) : sum;
  return {
    min: [min.x, min.y, min.z],
    max: [max.x, max.y, max.z],
    centroid: [c.x, c.y, c.z],
    vertices: count,
  };
}
