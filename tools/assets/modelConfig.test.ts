/**
 * Keeps the client's model view configs and the asset manifests in sync:
 * every clip a config maps (plus its spares) must survive `keepAnimations`,
 * and every prop a config shows or hides must not be pruned by `removeNodes`.
 * Also checks the committed GLBs, so a stale `pnpm assets:build` is caught.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOGICAL_STATES } from '../../apps/client/src/units/states';
import { MODEL_CONFIGS, MODEL_IDS, requiredClips } from '../../apps/client/src/units/modelConfig';
import { loadManifests, MODELS_OUT } from './manifest';

const entries = loadManifests().flatMap((m) =>
  (m.models ?? []).map((model) => ({ pack: m.id, ...model })),
);

/** Animation and node names straight from a GLB's JSON chunk. */
function glbNames(file: string): { animations: string[]; nodes: string[] } {
  const b = readFileSync(file);
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as {
    animations?: { name: string }[];
    nodes?: { name: string }[];
  };
  return {
    animations: (json.animations ?? []).map((a) => a.name),
    nodes: (json.nodes ?? []).map((n) => n.name),
  };
}

describe.each(MODEL_IDS)('model config %s', (id) => {
  const config = MODEL_CONFIGS[id];
  const entry = entries.find((e) => `/models/${e.pack}/${e.out}.glb` === config.url);

  it('has a manifest entry for its URL', () => {
    expect(entry).toBeDefined();
  });

  it('maps every logical state', () => {
    expect(Object.keys(config.clips).sort()).toEqual([...LOGICAL_STATES].sort());
  });

  it('keeps every clip it uses in the manifest', () => {
    expect(entry?.keepAnimations).toBeDefined();
    expect([...entry!.keepAnimations!].sort()).toEqual(requiredClips(id).sort());
  });

  it('does not remove props it shows or hides', () => {
    const removed = new Set(entry?.removeNodes ?? []);
    for (const p of [...config.props.show, ...config.props.hide])
      expect(removed.has(p)).toBe(false);
    if (entry?.keepNodes) {
      for (const p of [...config.props.show, ...config.props.hide])
        expect(entry.keepNodes).toContain(p);
    }
  });

  it('matches the committed GLB', () => {
    const glb = glbNames(join(MODELS_OUT, config.url.replace(/^\/models\//, '')));
    expect(glb.animations.sort()).toEqual(requiredClips(id).sort());
    for (const p of [...config.props.show, ...config.props.hide]) expect(glb.nodes).toContain(p);
    for (const p of entry?.removeNodes ?? []) expect(glb.nodes).not.toContain(p);
  });
});
