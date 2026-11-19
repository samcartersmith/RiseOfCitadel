/**
 * Terrain (M1-05): builds the Citadel ground from the map data at load time.
 *
 *   const terrain = await createTerrain(scene);
 *   terrain.sampler.heightAt(wx, wz); // stand things on it (world units)
 *
 * Pure height maths lives in heightfield.ts / heightGrid.ts / sampler.ts (no
 * DOM, unit tested). This file turns it into chunked, LOD'd Babylon meshes
 * with the splat material. Docs: docs/design/terrain.md.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { registerShadowReceiver } from '../../render/shadows';
import { buildChunkArrays } from './chunkGeometry';
import { bakeControlMap } from './controlMap';
import { getCitadelHeightSampler, MAP_TO_WORLD, type HeightSampler } from './sampler';
import { TerrainMaterial, type TerrainLook } from './terrainMaterial';
import { createControlTexture, loadDetailTexture } from './textures';

export {
  createHeightSampler,
  getCitadelHeightSampler,
  mapToWorld,
  MAP_TO_WORLD,
  MAP_UNITS_PER_WORLD_UNIT,
  type HeightSampler,
} from './sampler';

export interface TerrainOptions {
  sampler?: HeightSampler;
  /** Grid cells per chunk side (full detail). Default 64 → 10 × 10 chunks of 50 world units. */
  chunkCells?: number;
  /** Camera distance (world units) where chunks switch to ½ and ¼ detail. */
  lodDistances?: readonly [number, number];
  /** Control map resolution (texels per side). */
  controlSize?: number;
  /** Placeholder water ribbon in the riverbed until M1-06 lands. Default true. */
  riverPlaceholder?: boolean;
  look?: Partial<TerrainLook>;
}

export interface TerrainStats {
  chunks: number;
  /** Surface triangles per chunk at each LOD. */
  trianglesPerChunk: readonly number[];
  /** Time to bake the control map / build the meshes (ms, CPU). The height grid is baked by the sampler. */
  controlMs: number;
  meshMs: number;
  /** Bytes downloaded for terrain textures. */
  textureBytes: number;
}

export interface Terrain {
  readonly sampler: HeightSampler;
  readonly material: TerrainMaterial;
  /** Full-detail chunk meshes (each owns its LOD levels). */
  readonly chunks: readonly Mesh[];
  readonly river: Mesh | null;
  readonly stats: TerrainStats;
  /** Multiplies the LOD switch distances (Low tier uses < 1). */
  setLodBias(bias: number): void;
  dispose(): void;
}

const LOD_STRIDES = [1, 2, 4] as const;
const DEFAULT_LOD: readonly [number, number] = [95, 170];

export async function createTerrain(scene: Scene, opts: TerrainOptions = {}): Promise<Terrain> {
  const sampler = opts.sampler ?? getCitadelHeightSampler();
  const { grid, field } = sampler;
  const L = field.levels;
  const S = MAP_TO_WORLD;
  const cells = opts.chunkCells ?? 64;
  const perSide = (grid.size - 1) / cells;
  if (!Number.isInteger(perSide))
    throw new Error(`chunkCells ${cells} must divide ${grid.size - 1}`);

  const t0 = performance.now();
  const controlSize = opts.controlSize ?? 512;
  const control = createControlTexture(scene, bakeControlMap(field, controlSize), controlSize);
  const t1 = performance.now();
  const detail = await loadDetailTexture(scene);

  const mapSize = Math.max(field.map.size.width, field.map.size.depth) * S;
  const material = new TerrainMaterial(
    'terrain',
    scene,
    control,
    detail.texture,
    { low: L.low * S, river: L.river * S, rockAbove: (L.high + 70) * S, mapSize },
    opts.look,
  );

  const t2 = performance.now();
  const chunks: Mesh[] = [];
  const allMeshes: Mesh[] = [];
  const lodMeshes: Mesh[][] = [];
  const triangles: number[] = [];
  for (let cj = 0; cj < perSide; cj++) {
    for (let ci = 0; ci < perSide; ci++) {
      const levels = LOD_STRIDES.map((stride, li) => {
        const arrays = buildChunkArrays(grid, { ci, cj, cells, stride, scale: S, skirtDepth: 3 });
        if (ci === 0 && cj === 0) triangles.push(arrays.surfaceTriangles);
        const mesh = new Mesh(`terrain_${ci}_${cj}${li ? `_lod${li}` : ''}`, scene);
        const vd = new VertexData();
        vd.positions = arrays.positions;
        vd.normals = arrays.normals;
        vd.indices = arrays.indices;
        vd.applyToMesh(mesh, false);
        mesh.material = material;
        mesh.isPickable = li === 0;
        mesh.freezeWorldMatrix();
        mesh.doNotSyncBoundingInfo = true;
        registerShadowReceiver(mesh);
        allMeshes.push(mesh);
        return mesh;
      });
      chunks.push(levels[0]!);
      lodMeshes.push(levels);
    }
  }
  const lodBase = opts.lodDistances ?? DEFAULT_LOD;
  const applyLod = (bias: number) => {
    for (const [base, ...rest] of lodMeshes) {
      for (const m of rest) base!.removeLODLevel(m);
      rest.forEach((m, i) => base!.addLODLevel(lodBase[i]! * bias, m));
    }
  };
  applyLod(1);
  const t3 = performance.now();

  const river =
    opts.riverPlaceholder === false ? null : createRiverPlaceholder(scene, field.map, L);

  return {
    sampler,
    material,
    chunks,
    river,
    stats: {
      chunks: chunks.length,
      trianglesPerChunk: triangles,
      controlMs: Math.round(t1 - t0),
      meshMs: Math.round(t3 - t2),
      textureBytes: detail.bytes,
    },
    setLodBias: applyLod,
    dispose() {
      for (const m of allMeshes) m.dispose();
      river?.dispose();
      material.dispose();
      control.dispose();
      detail.texture.dispose();
    },
  };
}

/**
 * Flat translucent ribbon over the riverbed, a stand-in for the M1-06 water
 * shader so the river reads in screenshots. One draw call.
 */
function createRiverPlaceholder(
  scene: Scene,
  map: HeightSampler['field']['map'],
  L: HeightSampler['field']['levels'],
): Mesh {
  const S = MAP_TO_WORLD;
  // Stop short of the map edge (the border rock covers the rest).
  const edge = map.size.width / 2 - 250;
  const pts = map.river.waypoints.map((p) => {
    const k = Math.abs(p.x) > edge ? edge / Math.abs(p.x) : 1;
    return { x: p.x * k, z: p.z * k };
  });
  const half = map.river.width / 2 - 40;
  const y = (L.river + (L.low - L.river) * 0.55) * S;
  const left: Vector3[] = [];
  const right: Vector3[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    left.push(new Vector3((p.x + nx * half) * S, y, (p.z + nz * half) * S));
    right.push(new Vector3((p.x - nx * half) * S, y, (p.z - nz * half) * S));
  });
  const mesh = MeshBuilder.CreateRibbon(
    'river-placeholder',
    { pathArray: [right, left], sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  const mat = new StandardMaterial('river-placeholder', scene);
  const c = Color3.FromHexString('#7FE3E0');
  mat.diffuseColor = c.scale(0.6);
  mat.emissiveColor = c.scale(0.35);
  mat.specularColor = Color3.Black();
  mat.alpha = 0.5;
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  return mesh;
}
