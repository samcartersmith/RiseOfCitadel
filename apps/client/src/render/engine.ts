import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';

export type Backend = 'webgpu' | 'webgl2';

/**
 * Prefer WebGPU, fall back to WebGL2. `?engine=webgl` forces the fallback
 * (useful for testing the path most browsers without WebGPU will take).
 */
export async function createEngine(
  canvas: HTMLCanvasElement,
): Promise<{ engine: AbstractEngine; backend: Backend }> {
  const forced = new URLSearchParams(location.search).get('engine');
  if (forced !== 'webgl' && (await WebGPUEngine.IsSupportedAsync)) {
    try {
      const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
      await engine.initAsync();
      return { engine, backend: 'webgpu' };
    } catch (err) {
      console.warn('[citadel] WebGPU init failed, falling back to WebGL2', err);
    }
  }
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
  return { engine, backend: 'webgl2' };
}
