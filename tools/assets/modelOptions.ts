/**
 * Per-model pipeline options (manifest `models[]` fields): strip unused
 * animations and drop unused prop meshes so shipped GLBs only carry what the
 * client's model configs use. All options are optional; a model entry without
 * them is processed exactly as before.
 */
import type { Document, Node, Transform } from '@gltf-transform/core';

export interface ModelOptions {
  /** Keep only these animations (by name). Every name must exist in the source. */
  keepAnimations?: string[];
  /**
   * Keep only these mesh-bearing nodes (by name). Any other node with a mesh is
   * removed, including skinned body parts, so list those too. Nodes without a
   * mesh (bones, attachment slots) are never removed by this option.
   */
  keepNodes?: string[];
  /** Remove these nodes (by name) and their subtrees. Every name must exist. */
  removeNodes?: string[];
  /**
   * Apply KHR_mesh_quantization (default true). Set false if quantized
   * positions/weights ever break a model's skinning.
   */
  quantize?: boolean;
}

/** Throws if any requested name is missing, so manifest typos fail the build loudly. */
export function assertAllPresent(kind: string, requested: string[], available: string[]): void {
  const have = new Set(available);
  const missing = requested.filter((n) => !have.has(n));
  if (missing.length) {
    throw new Error(
      `${kind} not found in source: ${missing.join(', ')}\n  available: ${available.join(', ')}`,
    );
  }
}

/** Dispose every animation whose name isn't in `keep`. Orphaned samplers/accessors go in prune(). */
export function keepAnimations(keep: string[]): Transform {
  return function keepAnimationsTransform(doc: Document) {
    const anims = doc.getRoot().listAnimations();
    assertAllPresent(
      'keepAnimations',
      keep,
      anims.map((a) => a.getName()),
    );
    const set = new Set(keep);
    for (const a of anims) {
      if (set.has(a.getName())) continue;
      // Dispose children explicitly: an orphaned sampler still holds links to its
      // accessors, which would stop prune() from removing the keyframe data.
      for (const c of a.listChannels()) c.dispose();
      for (const s of a.listSamplers()) s.dispose();
      a.dispose();
    }
  };
}

function disposeSubtree(node: Node): void {
  for (const child of node.listChildren()) disposeSubtree(child);
  node.dispose();
}

/** Remove named nodes (and children), and/or every mesh node not in `keep`. */
export function filterNodes(opts: { keep?: string[]; remove?: string[] }): Transform {
  return function filterNodesTransform(doc: Document) {
    const nodes = doc.getRoot().listNodes();
    const names = nodes.map((n) => n.getName());
    if (opts.remove?.length) {
      assertAllPresent('removeNodes', opts.remove, names);
      const remove = new Set(opts.remove);
      for (const n of nodes) if (remove.has(n.getName()) && !n.isDisposed()) disposeSubtree(n);
    }
    if (opts.keep) {
      assertAllPresent('keepNodes', opts.keep, names);
      const keep = new Set(opts.keep);
      for (const n of doc.getRoot().listNodes()) {
        if (n.getMesh() && !keep.has(n.getName())) n.dispose();
      }
    }
  };
}

/** The option transforms to run before the standard dedup/resample/prune/weld steps. */
export function optionTransforms(opts: ModelOptions): Transform[] {
  const out: Transform[] = [];
  if (opts.keepAnimations) out.push(keepAnimations(opts.keepAnimations));
  if (opts.keepNodes || opts.removeNodes)
    out.push(filterNodes({ keep: opts.keepNodes, remove: opts.removeNodes }));
  return out;
}
