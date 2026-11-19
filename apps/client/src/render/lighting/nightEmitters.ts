/**
 * Night emitters: materials whose emissive brightens as night falls
 * (braziers, crystals, the Hearthstone, the rift). Any module can register a
 * mesh or a material; the lighting rig scales each one's emissive colour by
 * the palette's `emissive` factor. Only `emissiveColor` (a uniform) changes,
 * so scrubbing time never recompiles a shader.
 *
 *   registerNightEmitter(brazierFlameMaterial);      // full response
 *   registerNightEmitter(lanternMesh, 0.5);          // half the night boost
 *
 * The rig also registers every material whose name starts with one of
 * NIGHT_EMITTER_PREFIXES (the structures' `structure:glow:*`), so M1-08
 * needs no code change.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';

/** Material-name prefixes the rig picks up automatically. */
export const NIGHT_EMITTER_PREFIXES: readonly string[] = ['structure:glow:'];

type Emissive = Material & { emissiveColor: Color3 };

interface Entry {
  base: Color3;
  strength: number;
}

interface Registry {
  entries: Map<Emissive, Entry>;
  factor: number;
}

const registries = new WeakMap<Scene, Registry>();

function registryFor(scene: Scene): Registry {
  let r = registries.get(scene);
  if (!r) {
    r = { entries: new Map(), factor: 1 };
    registries.set(scene, r);
  }
  return r;
}

const hasEmissive = (m: Material | null | undefined): m is Emissive =>
  !!m && (m as unknown as { emissiveColor?: unknown }).emissiveColor instanceof Color3;

/** Emissive multiplier for one emitter at a palette factor: 1 + (factor − 1) × strength. */
export function emitterScale(factor: number, strength: number): number {
  return Math.max(0, 1 + (factor - 1) * strength);
}

function apply(entry: Entry, mat: Emissive, factor: number) {
  entry.base.scaleToRef(emitterScale(factor, entry.strength), mat.emissiveColor);
}

/**
 * Registers a mesh's material (or a material) as a night emitter. Its current
 * emissive colour is the daytime base. `strength` scales the night boost
 * (1 = full, 0 = unaffected). Returns an unregister function that restores the base.
 */
export function registerNightEmitter(target: AbstractMesh | Material, strength = 1): () => void {
  const mat = 'emissiveColor' in target ? (target as Material) : (target as AbstractMesh).material;
  if (!hasEmissive(mat)) {
    console.warn(`[citadel] registerNightEmitter: ${target.name} has no emissive material`);
    return () => {};
  }
  const reg = registryFor(mat.getScene());
  let entry = reg.entries.get(mat);
  if (entry) {
    entry.strength = strength;
  } else {
    entry = { base: mat.emissiveColor.clone(), strength };
    reg.entries.set(mat, entry);
    mat.onDisposeObservable.addOnce(() => reg.entries.delete(mat));
  }
  apply(entry, mat, reg.factor);
  return () => unregisterNightEmitter(mat);
}

export function unregisterNightEmitter(mat: Material): void {
  const reg = registries.get(mat.getScene());
  const entry = reg?.entries.get(mat as Emissive);
  if (!reg || !entry) return;
  (mat as Emissive).emissiveColor.copyFrom(entry.base);
  reg.entries.delete(mat as Emissive);
}

/** Sets the scene's emissive factor and rescales every registered emitter. */
export function setNightEmitterFactor(scene: Scene, factor: number): void {
  const reg = registryFor(scene);
  reg.factor = factor;
  for (const [mat, entry] of reg.entries) apply(entry, mat, factor);
}

/** Registered emitters in a scene (for debugging and tests). */
export function nightEmitters(scene: Scene): { name: string; strength: number; scale: number }[] {
  const reg = registries.get(scene);
  if (!reg) return [];
  return [...reg.entries].map(([m, e]) => ({
    name: m.name,
    strength: e.strength,
    scale: emitterScale(reg.factor, e.strength),
  }));
}
