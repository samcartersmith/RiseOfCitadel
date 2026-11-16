import '@babylonjs/loaders/glTF/2.0';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { AnimationController, type AnimationControllerOptions } from './animation';
import type { ModelViewConfig } from './modelConfig';

export interface LoadedModel {
  config: ModelViewConfig;
  /** Root node of this instance: position/rotate/scale this. */
  root: TransformNode;
  meshes: AbstractMesh[];
  animator: AnimationController;
  dispose(): void;
}

const containers = new Map<string, Promise<AssetContainer>>();

function container(scene: Scene, url: string): Promise<AssetContainer> {
  const key = `${scene.uid}|${url}`;
  let p = containers.get(key);
  if (!p) {
    p = LoadAssetContainerAsync(url, scene);
    containers.set(key, p);
    p.catch(() => containers.delete(key));
  }
  return p;
}

/** Does this mesh belong to the named prop? (glTF primitives load as `<name>_primitive<n>`.) */
function isProp(mesh: AbstractMesh, name: string): boolean {
  return mesh.name === name || mesh.name.startsWith(`${name}_primitive`);
}

/**
 * Apply a config's prop visibility to a set of meshes. Returns the names in
 * `show`/`hide` that matched nothing (so callers and tests can flag typos).
 */
export function applyPropVisibility(
  meshes: readonly AbstractMesh[],
  props: ModelViewConfig['props'],
): string[] {
  const missing: string[] = [];
  const set = (names: readonly string[], enabled: boolean) => {
    for (const name of names) {
      const hits = meshes.filter((m) => isProp(m, name));
      if (hits.length === 0) missing.push(name);
      for (const m of hits) m.setEnabled(enabled);
    }
  };
  set(props.show, true);
  set(props.hide, false);
  return missing;
}

/**
 * Load (once per scene, then clone) a model from its view config, hide the
 * spare props and wrap its animation groups in an AnimationController that
 * starts idling.
 */
export async function loadModel(
  scene: Scene,
  config: ModelViewConfig,
  options: Omit<AnimationControllerOptions, 'scene' | 'clipSpeed'> = {},
): Promise<LoadedModel> {
  const c = await container(scene, config.url);
  // Keep original names so prop and clip lookups work; skinned meshes must be clones.
  const inst = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
  const root = inst.rootNodes[0] as TransformNode;
  root.scaling.scaleInPlace(config.scale);
  const meshes = root.getChildMeshes(false);
  const missing = applyPropVisibility(meshes, config.props);
  if (missing.length)
    console.warn(`[citadel] ${config.id}: props not found in GLB: ${missing.join(', ')}`);
  const animator = new AnimationController(inst.animationGroups, config.clips, {
    blendTime: config.blendTime,
    clipSpeed: config.clipSpeed,
    ...options,
    scene,
  });
  return {
    config,
    root,
    meshes,
    animator,
    dispose() {
      animator.dispose();
      inst.dispose();
    },
  };
}
