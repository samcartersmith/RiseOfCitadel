/**
 * River water (M1-06): a stylised, cheap water surface along the map's river.
 *
 *   const terrain = await createTerrain(scene, { riverPlaceholder: false });
 *   const water = createWater(scene, { sampler: terrain.sampler, tier });
 *   water.setTier('low');                          // motes off on Low
 *   water.setLighting(waterLightingFor(daylight)); // M1-09 day/night hook
 *
 * Pure path/flow/geometry maths lives in riverPath.ts (unit tested); the look
 * and the day/night colours in waterLook.ts; the GLSL + WGSL plugin in
 * waterMaterial.ts / waterShaderCode.ts. Docs: docs/design/water.md.
 */
import '@babylonjs/core/Culling/ray'; // Camera.getForwardRay
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../../render/quality';
import { registerShadowReceiver } from '../../render/shadows';
import { MAP_TO_WORLD, MAP_UNITS_PER_WORLD_UNIT } from '../scale';
import { getCitadelHeightSampler, type HeightSampler } from '../terrain/sampler';
import { createRiverMotes, type RiverMotes } from './motes';
import {
  buildRiverPath,
  buildWaterChunks,
  DEFAULT_FLOW,
  flowAt as flowAtPath,
  flowSpeed,
  projectOnPath,
  type Flow,
  type FlowProfile,
  type RiverPath,
} from './riverPath';
import type { WaterLighting, WaterLook } from './waterLook';
import { WaterMaterial } from './waterMaterial';

export * from './riverPath';
export * from './waterLook';
export { WaterMaterial, WaterPlugin } from './waterMaterial';

export interface WaterOptions {
  sampler?: HeightSampler;
  /** Water surface height, map units. Default: 55% of the way from the riverbed to low ground. */
  level?: number;
  /** Ribbon half-width, map units (wider than the wet channel; the banks clip it). Default 600. */
  halfWidth?: number;
  /** Vertices across the ribbon. Default 40 (~0.95 world units apart). */
  columns?: number;
  /** Map units between cross-sections along the river. Default 30 (~0.94 world units). */
  spacing?: number;
  /** Cross-sections per chunk (frustum-culling granularity). Default 48 (~45 world units). */
  rowsPerChunk?: number;
  /** Starting quality tier: motes on High (140) and Medium (70), none on Low. */
  tier?: QualityTier;
  look?: Partial<WaterLook>;
  flow?: Partial<FlowProfile>;
}

export interface WaterStats {
  chunks: number;
  triangles: number;
  vertices: number;
  /** CPU time to build the path and meshes, ms. */
  buildMs: number;
  /** Mote capacity at the current tier (0 on Low). */
  motes: number;
}

export interface Water {
  readonly path: RiverPath;
  /** Water surface height, world units. */
  readonly level: number;
  readonly meshes: readonly Mesh[];
  readonly material: WaterMaterial;
  readonly motes: RiverMotes | null;
  readonly stats: WaterStats;
  /** Flow at a world point (world units in; speed in world units / s, 0 off the river). */
  flowAt(x: number, z: number): Flow;
  /** Water depth at a world point (world units; ≤ 0 is dry ground). */
  depthAt(x: number, z: number): number;
  setTier(tier: QualityTier): void;
  /** Day/night colour hook for M1-09 (all uniforms, never recompiles). */
  setLighting(lighting: Partial<WaterLighting>): void;
  /** Freeze the animation clock (screenshots); `null` resumes. */
  setTime(seconds: number | null): void;
  dispose(): void;
}

export const MOTES_PER_TIER: Readonly<Record<QualityTier, number>> = {
  high: 140,
  medium: 70,
  low: 0,
};

export function createWater(scene: Scene, opts: WaterOptions = {}): Water {
  const t0 = performance.now();
  const sampler = opts.sampler ?? getCitadelHeightSampler();
  const { map, levels } = sampler.field;
  const S = MAP_TO_WORLD;
  const level = opts.level ?? levels.river + (levels.low - levels.river) * 0.55;
  const halfWidth = opts.halfWidth ?? 600;
  const flowProfile: FlowProfile = { ...DEFAULT_FLOW, ...opts.flow };
  const path = buildRiverPath(map.river.waypoints, {
    spacing: opts.spacing ?? 30,
    limit: map.size.width / 2 - 20,
  });
  const chunks = buildWaterChunks(path, {
    heightAt: sampler.mapHeightAt,
    level,
    halfWidth,
    columns: opts.columns ?? 40,
    rowsPerChunk: opts.rowsPerChunk ?? 48,
    scale: S,
    cullDepth: 12,
    flow: flowProfile,
  });

  const material = new WaterMaterial('river-water', scene, { halfWidth: halfWidth * S }, opts.look);
  let triangles = 0;
  let vertices = 0;
  const meshes = chunks.map((c, i) => {
    const mesh = new Mesh(`river-water_${i}`, scene);
    const vd = new VertexData();
    vd.positions = c.positions;
    vd.normals = c.normals;
    vd.indices = c.indices;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesBuffer(
      new VertexBuffer(scene.getEngine(), c.data, 'waterData', false, false, 4),
    );
    mesh.setVerticesBuffer(
      new VertexBuffer(scene.getEngine(), c.flow, 'waterFlow', false, false, 2),
    );
    mesh.material = material;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    registerShadowReceiver(mesh);
    triangles += c.triangles;
    vertices += c.positions.length / 3;
    return mesh;
  });

  const depthAtMap = (x: number, z: number) => level - sampler.mapHeightAt(x, z);
  const levelY = level * S;
  const makeMotes = (tier: QualityTier, focus: number): RiverMotes | null => {
    const n = MOTES_PER_TIER[tier];
    if (!n) return null;
    const m = createRiverMotes(scene, n, {
      path,
      scale: S,
      levelY,
      depthAt: depthAtMap,
      spawnHalfWidth: flowProfile.wetHalfWidth * 0.9,
      spawnRange: 1800,
      speedAt: (a) => flowSpeed(a, flowProfile),
      focus,
    });
    m.setColor(material.water.look.mote, material.water.look.moteIntensity);
    return m;
  };

  // Where the camera looks at the water: its forward ray meets the water plane.
  const focusS = (): number | null => {
    const cam = scene.activeCamera;
    if (!cam) return null;
    const dir = cam.getForwardRay(1).direction;
    const pos = cam.globalPosition;
    const t = dir.y < -1e-3 ? (levelY - pos.y) / dir.y : 0;
    const hit = pos.add(dir.scale(Math.max(0, t)));
    return projectOnPath(path, hit.x * MAP_UNITS_PER_WORLD_UNIT, hit.z * MAP_UNITS_PER_WORLD_UNIT)
      .s;
  };

  let tier: QualityTier = opts.tier ?? 'medium';
  let motes = makeMotes(tier, focusS() ?? path.length / 2);
  let frozen: number | null = null;
  let frame = 0;
  const tick: Observer<Scene> = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
    material.water.time = frozen ?? material.water.time + dt;
    if (motes && frame++ % 10 === 0) {
      const s = focusS();
      if (s !== null) motes.setFocus(s);
    }
  });

  const stats: WaterStats = {
    chunks: meshes.length,
    triangles,
    vertices,
    buildMs: Math.round(performance.now() - t0),
    motes: MOTES_PER_TIER[tier],
  };

  return {
    path,
    level: levelY,
    meshes,
    material,
    get motes() {
      return motes;
    },
    stats,
    flowAt: (x, z) =>
      flowAtPath(path, x * MAP_UNITS_PER_WORLD_UNIT, z * MAP_UNITS_PER_WORLD_UNIT, flowProfile),
    depthAt: (x, z) => depthAtMap(x * MAP_UNITS_PER_WORLD_UNIT, z * MAP_UNITS_PER_WORLD_UNIT) * S,
    setTier(next) {
      if (next === tier) return;
      tier = next;
      motes?.dispose();
      motes = makeMotes(tier, focusS() ?? path.length / 2);
      stats.motes = MOTES_PER_TIER[tier];
    },
    setLighting(lighting) {
      Object.assign(material.water.look, lighting);
      motes?.setColor(material.water.look.mote, material.water.look.moteIntensity);
    },
    setTime(seconds) {
      frozen = seconds;
      if (seconds !== null) material.water.time = seconds;
    },
    dispose() {
      scene.onBeforeRenderObservable.remove(tick);
      motes?.dispose();
      for (const m of meshes) m.dispose();
      material.dispose();
    },
  };
}
