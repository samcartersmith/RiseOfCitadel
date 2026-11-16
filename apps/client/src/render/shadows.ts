import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { TierSettings } from './quality';

interface ShadowRegistry {
  casters: Map<AbstractMesh, boolean>; // mesh -> includeDescendants
  receivers: Set<AbstractMesh>;
  generator: CascadedShadowGenerator | null;
}

const registries = new WeakMap<Scene, ShadowRegistry>();

function registryFor(scene: Scene): ShadowRegistry {
  let reg = registries.get(scene);
  if (!reg) {
    reg = { casters: new Map(), receivers: new Set(), generator: null };
    registries.set(scene, reg);
  }
  return reg;
}

/**
 * Registers a mesh as a shadow caster. Safe to call on any tier: the mesh is
 * remembered and picked up whenever shadows turn on (High tier only).
 * `includeDescendants` covers glTF roots whose geometry lives in children.
 */
export function registerShadowCaster(mesh: AbstractMesh, includeDescendants = true): void {
  const reg = registryFor(mesh.getScene());
  if (reg.casters.has(mesh)) return;
  reg.casters.set(mesh, includeDescendants);
  reg.generator?.addShadowCaster(mesh, includeDescendants);
  mesh.onDisposeObservable.addOnce(() => unregisterShadowCaster(mesh));
}

export function unregisterShadowCaster(mesh: AbstractMesh): void {
  const reg = registries.get(mesh.getScene());
  if (!reg) return;
  const includeDescendants = reg.casters.get(mesh);
  if (includeDescendants === undefined) return;
  reg.casters.delete(mesh);
  reg.generator?.removeShadowCaster(mesh, includeDescendants);
}

/** Registers a mesh that should show shadows (terrain, structures). */
export function registerShadowReceiver(mesh: AbstractMesh): void {
  const reg = registryFor(mesh.getScene());
  if (reg.receivers.has(mesh)) return;
  reg.receivers.add(mesh);
  mesh.receiveShadows = reg.generator !== null;
  mesh.onDisposeObservable.addOnce(() => unregisterShadowReceiver(mesh));
}

export function unregisterShadowReceiver(mesh: AbstractMesh): void {
  const reg = registries.get(mesh.getScene());
  if (!reg?.receivers.delete(mesh)) return;
  mesh.receiveShadows = false;
}

/**
 * The scene's sun: the first directional light. Shadows key off it so the
 * scene/lighting modules (M1-03, M1-09) can own its creation.
 */
export function findSunLight(scene: Scene): DirectionalLight | null {
  return (
    (scene.lights.find(
      (l) => l instanceof DirectionalLight && l.name === 'sun',
    ) as DirectionalLight) ??
    (scene.lights.find((l) => l instanceof DirectionalLight) as DirectionalLight) ??
    null
  );
}

/** Creates or disposes the cascaded shadow map to match the tier. */
export function applyShadowSettings(scene: Scene, settings: TierSettings): void {
  const reg = registryFor(scene);
  reg.generator?.dispose();
  reg.generator = null;

  const sun = findSunLight(scene);
  const on = settings.shadows && sun !== null && CascadedShadowGenerator.IsSupported;
  if (on) {
    const csm = new CascadedShadowGenerator(settings.shadowMapSize, sun);
    csm.numCascades = settings.shadowCascades;
    csm.lambda = 0.85;
    csm.shadowMaxZ = 160; // beyond this the MOBA camera never looks
    csm.stabilizeCascades = true;
    csm.cascadeBlendPercentage = 0.1;
    csm.usePercentageCloserFiltering = true;
    csm.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    csm.bias = 0.004;
    csm.normalBias = 0.02;
    csm.darkness = 0.35; // keep shadows readable, never pitch black (art direction §2.2)
    for (const [mesh, includeDescendants] of reg.casters) {
      csm.addShadowCaster(mesh, includeDescendants);
    }
    reg.generator = csm;
  }
  for (const mesh of reg.receivers) mesh.receiveShadows = on;
}

/** The active generator, if any (for debugging and tests). */
export function getShadowGenerator(scene: Scene): CascadedShadowGenerator | null {
  return registries.get(scene)?.generator ?? null;
}
