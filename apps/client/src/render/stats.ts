import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { Scene } from '@babylonjs/core/scene';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Backend } from './engine';
import type { QualityTier } from './quality';

const instruments = new WeakMap<Scene, SceneInstrumentation>();

export interface CitadelStats {
  backend: Backend;
  tier: QualityTier;
  fps: number;
  /** Wall-clock time between frames, ms. */
  frameTimeMs: number;
  /** CPU time spent inside scene.render(), ms (average over the last second). */
  cpuFrameMs: number;
  drawCalls: number;
  activeMeshes: number;
  activeIndices: number;
  triangles: number;
  totalVertices: number;
  /** Used JS heap in MB where `performance.memory` exists (Chromium), else null. */
  jsHeapMB: number | null;
  /** Active VFX effects, when a VFX system publishes them (vfx/index.ts `withVfxStats`). */
  vfxActive?: number;
}

interface PerformanceMemory {
  memory?: { usedJSHeapSize: number };
}

function instrumentsFor(scene: Scene): SceneInstrumentation {
  let inst = instruments.get(scene);
  if (!inst) {
    inst = new SceneInstrumentation(scene);
    inst.captureFrameTime = true;
    instruments.set(scene, inst);
  }
  return inst;
}

/**
 * Deterministic engine counters for CI budget checks (exposed on
 * window.__citadelStats). FPS and timings are for the perf HUD only;
 * CI never asserts on them because runners have no GPU.
 */
export function readStats(
  engine: AbstractEngine,
  scene: Scene,
  backend: Backend,
  tier: QualityTier,
): CitadelStats {
  const inst = instrumentsFor(scene);
  const activeIndices = scene.getActiveIndices();
  const memory = (performance as Performance & PerformanceMemory).memory;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    backend,
    tier,
    fps: Math.round(engine.getFps()),
    frameTimeMs: round1(engine.getDeltaTime()),
    cpuFrameMs: round1(inst.frameTimeCounter.lastSecAverage),
    drawCalls: inst.drawCallsCounter.current,
    activeMeshes: scene.getActiveMeshes().length,
    activeIndices,
    triangles: Math.round(activeIndices / 3),
    totalVertices: scene.getTotalVertices(),
    jsHeapMB: memory ? round1(memory.usedJSHeapSize / 1048576) : null,
  };
}
