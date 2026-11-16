import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { Scene } from '@babylonjs/core/scene';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Backend } from './engine';

const instruments = new WeakMap<Scene, SceneInstrumentation>();

export interface CitadelStats {
  backend: Backend;
  fps: number;
  drawCalls: number;
  activeMeshes: number;
  activeIndices: number;
  totalVertices: number;
}

/**
 * Deterministic engine counters for CI budget checks (exposed on
 * window.__citadelStats). FPS is included for the dev overlay only;
 * CI never asserts on it because runners have no GPU.
 */
export function readStats(engine: AbstractEngine, scene: Scene, backend: Backend): CitadelStats {
  let inst = instruments.get(scene);
  if (!inst) {
    inst = new SceneInstrumentation(scene);
    instruments.set(scene, inst);
  }
  return {
    backend,
    fps: Math.round(engine.getFps()),
    drawCalls: inst.drawCallsCounter.lastSecAverage || inst.drawCallsCounter.current,
    activeMeshes: scene.getActiveMeshes().length,
    activeIndices: scene.getActiveIndices(),
    totalVertices: scene.getTotalVertices(),
  };
}
