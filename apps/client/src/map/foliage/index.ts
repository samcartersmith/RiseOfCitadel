/**
 * Foliage (M1-07): every tree on the Citadel map as thin instances, with
 * vertex-shader wind, a cheaper far LOD, a shared shadow-caster proxy and
 * grass tufts near the camera on High.
 *
 *   const foliage = await createFoliage(scene, { tier: quality.tier });
 *   foliage.setTreeVisible(id, false);   // O(1), no buffer rebuild (M2 tree destruction)
 *   foliage.setTier('high');             // grass on, LOD distances back to 100%
 *
 * Layout: the map is cut into square cells (50 world units, the terrain chunk
 * size). Each cell holds, per species, one near-LOD mesh and one far-LOD mesh
 * that share the cell's instance-matrix array, plus one shadow-caster mesh for
 * all its trees. Babylon frustum-culls cells; the foliage system picks near or
 * far per cell from the camera distance. Placement is pure (placement.ts) and
 * shared with the M2 sim. Docs: docs/design/foliage.md.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Geometry } from '@babylonjs/core/Meshes/geometry';
import { Buffer, VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../../render/quality';
import { registerShadowCaster } from '../../render/shadows';
import { getCitadelHeightSampler, type HeightSampler } from '../terrain/sampler';
import { MAP_TO_WORLD } from '../scale';
import { createFoliageMaterial, type FoliageMaterial, type WindState } from './foliageMaterial';
import { parseGlb, readFirstImage, readFirstMesh, sampleAtlas } from './glb';
import {
  scatterGrass,
  scatterTrees,
  type GrassTuning,
  type ScatterResult,
  type ScatterTuning,
} from './placement';
import { pickSpecies, SPECIES, type SpeciesDef } from './species';
import {
  buildCasterProxy,
  buildGrassTuft,
  buildProxy,
  hexToRgb,
  recolorTree,
  triangleCount,
  type MeshArrays,
  type TreeShape,
} from './treeGeometry';

export { scatterTrees, scatterGrass, DEFAULT_SCATTER_TUNING } from './placement';
export { SPECIES, pickSpecies } from './species';

/** Layer bit for shadow-only proxies: cameras (default mask 0x0FFFFFFF) skip them, shadow maps don't. */
export const SHADOW_ONLY_LAYER = 0x10000000;

export interface FoliageOptions {
  sampler?: HeightSampler;
  /** Starting tier: grass only on High, LOD distances × 0.7 on Low. */
  tier?: QualityTier;
  /** Base URL of the models folder. Default `/models`. */
  modelsBase?: string;
  /** Cell size (world units). Default 50. */
  cellSize?: number;
  /** Camera distance (world units) where a cell switches to the far LOD. Default 95. */
  lodDistance?: number;
  /** Camera distance to a cell's centre within which grass is drawn (High). Default 75. */
  grassDistance?: number;
  /**
   * Camera distance to a cell's centre within which its shadow caster is
   * submitted. The cascaded shadow map draws every visible caster in every
   * cascade, so far cells are switched off here. Default 100.
   */
  shadowDistance?: number;
  scatter?: Partial<ScatterTuning>;
  grass?: Partial<GrassTuning>;
  species?: readonly SpeciesDef[];
}

export interface TreeInfo {
  id: number;
  /** World position of the trunk base. */
  x: number;
  y: number;
  z: number;
  species: string;
  biome: 0 | 1;
  zone: string;
}

export interface SpeciesStats {
  id: string;
  count: number;
  nearTris: number;
  farTris: number;
  /** World height of an average (scale 1) tree. */
  height: number;
}

export interface FoliageStats {
  trees: number;
  hidden: number;
  cells: number;
  /** Mesh pairs (cell × species). */
  groups: number;
  species: SpeciesStats[];
  casterTris: number;
  grassTris: number;
  grassCells: number;
  grassTufts: number;
  /** Near-LOD cells this frame. */
  nearCells: number;
  /** Bytes fetched for the tree models. */
  downloadBytes: number;
  loadMs: number;
  scatterMs: number;
  rejected: ScatterResult['rejected'];
}

export interface Foliage {
  readonly trees: readonly TreeInfo[];
  readonly treeCount: number;
  /** Hide (false) or show a tree by its stable ID. O(1); the GPU upload is batched per frame. */
  setTreeVisible(id: number, visible: boolean): void;
  isTreeVisible(id: number): boolean;
  readonly hiddenCount: number;
  setTier(tier: QualityTier): void;
  /** Multiplies the LOD and grass distances. */
  setLodBias(bias: number): void;
  readonly wind: WindState;
  readonly stats: FoliageStats;
  /** Every foliage mesh (for debugging and tests). */
  readonly meshes: readonly Mesh[];
  dispose(): void;
}

interface Group {
  near: Mesh;
  far: Mesh;
  matrices: Float32Array;
  dirty: boolean;
}

interface Cell {
  cx: number;
  cz: number;
  center: Vector3;
  groups: Group[];
  caster: Mesh | null;
  casterMatrices: Float32Array;
  casterDirty: boolean;
  grass: Mesh | null | undefined;
  near: boolean;
}

interface SpeciesAsset {
  def: SpeciesDef;
  near: SharedGeometry;
  far: SharedGeometry;
  shape: TreeShape;
  material: FoliageMaterial;
  /** World units per model unit at tree scale 1. */
  baseScale: number;
  nearTris: number;
  farTris: number;
}

const GRASS_COLORS = {
  warden: hexToRgb('#86A85A'),
  hollow: hexToRgb('#8C8698'),
};

/**
 * GPU vertex data shared by many meshes. Thin-instance buffers are stored on a
 * mesh's Geometry, so every cell mesh needs its own Geometry; the vertex
 * buffers themselves (positions, normals, colours) are uploaded once and
 * shared. Only the small index buffer is per mesh.
 */
interface SharedGeometry {
  buffers: Buffer[];
  kinds: { kind: string; buffer: Buffer; size: number }[];
  indices: Uint32Array;
  vertexCount: number;
}

function shareGeometry(scene: Scene, m: MeshArrays): SharedGeometry {
  const engine = scene.getEngine();
  const pos = new Buffer(engine, m.positions, false, 3);
  const nrm = new Buffer(engine, m.normals, false, 3);
  const col = new Buffer(engine, m.colors, false, 4);
  return {
    buffers: [pos, nrm, col],
    kinds: [
      { kind: VertexBuffer.PositionKind, buffer: pos, size: 3 },
      { kind: VertexBuffer.NormalKind, buffer: nrm, size: 3 },
      { kind: VertexBuffer.ColorKind, buffer: col, size: 4 },
    ],
    indices: m.indices,
    vertexCount: m.positions.length / 3,
  };
}

function attachGeometry(scene: Scene, mesh: Mesh, g: SharedGeometry): void {
  const geo = new Geometry(`${mesh.name}-geo`, scene);
  for (const k of g.kinds) {
    geo.setVerticesBuffer(k.buffer.createVertexBuffer(k.kind, 0, k.size), g.vertexCount);
  }
  geo.setIndices(g.indices, g.vertexCount);
  geo.applyToMesh(mesh);
}

async function decodeImage(bytes: Uint8Array, mimeType: string) {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mimeType }), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement('canvas'), {
          width: bitmap.width,
          height: bitmap.height,
        });
  const ctx = canvas.getContext('2d') as
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('foliage: no 2D canvas to decode the atlas');
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  bitmap.close();
  return { data, width: canvas.width, height: canvas.height };
}

export async function createFoliage(scene: Scene, opts: FoliageOptions = {}): Promise<Foliage> {
  const t0 = performance.now();
  const sampler = opts.sampler ?? getCitadelHeightSampler();
  const speciesDefs = opts.species ?? SPECIES;
  const S = MAP_TO_WORLD;
  const cellSize = opts.cellSize ?? 50;
  const lodBase = opts.lodDistance ?? 95;
  const grassBase = opts.grassDistance ?? 75;
  const shadowBase = opts.shadowDistance ?? 100;
  let lodBias = 1;
  let grassOn = false;

  // ---- placement (pure)
  const ts = performance.now();
  const scatter = scatterTrees(sampler.field, opts.scatter);
  const scatterMs = performance.now() - ts;

  // ---- models: fetch once per GLB, re-bake per species
  const base = opts.modelsBase ?? '/models';
  const urls = [...new Set(speciesDefs.map((s) => s.model))];
  let downloadBytes = 0;
  const sources = new Map(
    await Promise.all(
      urls.map(async (u) => {
        const res = await fetch(`${base}/${u}`);
        if (!res.ok) throw new Error(`foliage: GET ${u} -> ${res.status}`);
        const buf = await res.arrayBuffer();
        downloadBytes += buf.byteLength;
        const glb = parseGlb(buf);
        const mesh = readFirstMesh(glb);
        const img = readFirstImage(glb);
        const px = await decodeImage(img.bytes, img.mimeType);
        const atlasColors = sampleAtlas(mesh.uvs, px.data, px.width, px.height);
        return [u, { ...mesh, atlasColors }] as const;
      }),
    ),
  );

  const wind: WindState = { dirX: 0.8, dirZ: 0.6, time: 0, strength: 1 };
  const assets: SpeciesAsset[] = speciesDefs.map((def) => {
    const src = sources.get(def.model)!;
    const { arrays, shape } = recolorTree(src, def);
    const proxy = buildProxy(shape, def);
    const near = shareGeometry(scene, arrays);
    const far = shareGeometry(scene, proxy);
    const material = createFoliageMaterial(`foliage-${def.id}`, scene, wind, {
      modelHeight: shape.top,
      amplitude: def.wind,
      frequency: 1.4,
      lean: 0.35,
      colorJitter: 0.16,
    });
    return {
      def,
      near,
      far,
      shape,
      material,
      baseScale: def.height / shape.top,
      nearTris: triangleCount(arrays),
      farTris: triangleCount(proxy),
    };
  });

  // ---- trees → cells
  const extent = Math.max(sampler.field.map.size.width, sampler.field.map.size.depth) * S;
  const perSide = Math.ceil(extent / cellSize);
  const cellOf = (x: number, z: number) => {
    const i = Math.min(perSide - 1, Math.max(0, Math.floor((x + extent / 2) / cellSize)));
    const j = Math.min(perSide - 1, Math.max(0, Math.floor((z + extent / 2) / cellSize)));
    return j * perSide + i;
  };

  const n = scatter.trees.length;
  const trees: TreeInfo[] = new Array(n);
  const original = new Float32Array(n * 16);
  const casterOriginal = new Float32Array(n * 16);
  const speciesOf = new Uint8Array(n);
  const cellIndex = new Int32Array(n);
  const counts = new Array<number>(speciesDefs.length).fill(0);
  const mtx = new Matrix();
  const quat = new Quaternion();
  const scl = new Vector3();
  const pos = new Vector3();
  for (const t of scatter.trees) {
    const sp = pickSpecies(t.biome, t.pick, speciesDefs);
    const a = assets[sp]!;
    const x = t.x * S;
    const z = t.z * S;
    // Lowest ground under the trunk, so roots never float on a slope.
    let y = sampler.heightAt(x, z);
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2;
      y = Math.min(y, sampler.heightAt(x + Math.cos(ang) * 0.6, z + Math.sin(ang) * 0.6));
    }
    y -= 0.1;
    const s = a.baseScale * t.scale;
    Quaternion.RotationYawPitchRollToRef(t.yaw, 0, 0, quat);
    pos.set(x, y, z);
    Matrix.ComposeToRef(scl.setAll(s), quat, pos, mtx);
    mtx.copyToArray(original, t.id * 16);
    const r = a.shape.canopyRadius * s * 2;
    Matrix.ComposeToRef(scl.set(r, a.shape.top * s, r), quat, pos, mtx);
    mtx.copyToArray(casterOriginal, t.id * 16);
    speciesOf[t.id] = sp;
    cellIndex[t.id] = cellOf(x, z);
    counts[sp]!++;
    trees[t.id] = { id: t.id, x, y, z, species: a.def.id, biome: t.biome, zone: t.zone };
  }

  // Bucket by cell, then species; remember each tree's slot.
  const groupOf = new Int32Array(n);
  const slotOf = new Int32Array(n);
  const casterSlotOf = new Int32Array(n);
  const buckets = new Map<number, number[][]>();
  for (let id = 0; id < n; id++) {
    let b = buckets.get(cellIndex[id]!);
    if (!b) {
      b = speciesDefs.map(() => []);
      buckets.set(cellIndex[id]!, b);
    }
    b[speciesOf[id]!]!.push(id);
  }

  const casterGeometry = shareGeometry(scene, buildCasterProxy());
  const casterMaterial = new StandardMaterial('foliage-caster', scene);
  const casterTris = triangleCount(buildCasterProxy());
  const groups: Group[] = [];
  const cells = new Map<number, Cell>();
  const meshes: Mesh[] = [];
  const freeze = (m: Mesh) => {
    m.isPickable = false;
    m.doNotSyncBoundingInfo = true;
    m.freezeWorldMatrix();
    meshes.push(m);
  };
  const setInstances = (m: Mesh, data: Float32Array) => {
    m.thinInstanceSetBuffer('matrix', data, 16, false);
    m.thinInstanceRefreshBoundingInfo(false);
  };

  for (const [ci, perSpecies] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const cx = ci % perSide;
    const cz = Math.floor(ci / perSide);
    const centerX = -extent / 2 + (cx + 0.5) * cellSize;
    const centerZ = -extent / 2 + (cz + 0.5) * cellSize;
    const cell: Cell = {
      cx,
      cz,
      center: new Vector3(centerX, sampler.heightAt(centerX, centerZ), centerZ),
      groups: [],
      caster: null,
      casterMatrices: new Float32Array(0),
      casterDirty: false,
      grass: undefined,
      near: true,
    };
    const all: number[] = [];
    perSpecies.forEach((ids, sp) => {
      if (!ids.length) return;
      const a = assets[sp]!;
      const data = new Float32Array(ids.length * 16);
      ids.forEach((id, slot) => {
        data.set(original.subarray(id * 16, id * 16 + 16), slot * 16);
        groupOf[id] = groups.length;
        slotOf[id] = slot;
        all.push(id);
      });
      const near = new Mesh(`foliage_${cx}_${cz}_${a.def.id}`, scene);
      attachGeometry(scene, near, a.near);
      near.material = a.material;
      const far = new Mesh(`foliage_${cx}_${cz}_${a.def.id}_far`, scene);
      attachGeometry(scene, far, a.far);
      far.material = a.material;
      far.isVisible = false;
      for (const m of [near, far]) {
        freeze(m);
        setInstances(m, data);
      }
      const g: Group = { near, far, matrices: data, dirty: false };
      groups.push(g);
      cell.groups.push(g);
    });
    // One shadow caster for every tree in the cell (shadow maps only).
    const cm = new Float32Array(all.length * 16);
    all.forEach((id, slot) => {
      cm.set(casterOriginal.subarray(id * 16, id * 16 + 16), slot * 16);
      casterSlotOf[id] = slot;
    });
    const caster = new Mesh(`foliage_${cx}_${cz}_caster`, scene);
    attachGeometry(scene, caster, casterGeometry);
    caster.material = casterMaterial;
    caster.layerMask = SHADOW_ONLY_LAYER;
    freeze(caster);
    setInstances(caster, cm);
    registerShadowCaster(caster, false);
    cell.caster = caster;
    cell.casterMatrices = cm;
    cells.set(ci, cell);
  }

  // ---- grass (High only, built lazily per cell near the camera)
  const tuft = buildGrassTuft();
  const tuftTris = triangleCount(tuft);
  const grassGeometry = shareGeometry(scene, tuft);
  const grassMaterial = createFoliageMaterial(
    'foliage-grass',
    scene,
    wind,
    { modelHeight: 1, amplitude: 0.14, frequency: 2.2, lean: 0.4, colorJitter: 0.22 },
    { twoSided: true },
  );
  let grassCells = 0;
  let grassTufts = 0;
  const grassCellsList: Cell[] = [];
  const ensureGrassCell = (ci: number): Cell => {
    let cell = cells.get(ci);
    if (!cell) {
      const cx = ci % perSide;
      const cz = Math.floor(ci / perSide);
      const centerX = -extent / 2 + (cx + 0.5) * cellSize;
      const centerZ = -extent / 2 + (cz + 0.5) * cellSize;
      cell = {
        cx,
        cz,
        center: new Vector3(centerX, sampler.heightAt(centerX, centerZ), centerZ),
        groups: [],
        caster: null,
        casterMatrices: new Float32Array(0),
        casterDirty: false,
        grass: undefined,
        near: true,
      };
      cells.set(ci, cell);
    }
    return cell;
  };
  for (let ci = 0; ci < perSide * perSide; ci++) grassCellsList.push(ensureGrassCell(ci));

  const buildGrass = (cell: Cell): Mesh | null => {
    const minX = -extent / 2 + cell.cx * cellSize;
    const minZ = -extent / 2 + cell.cz * cellSize;
    const pts = scatterGrass(
      sampler.field,
      { minX: minX / S, minZ: minZ / S, maxX: (minX + cellSize) / S, maxZ: (minZ + cellSize) / S },
      opts.grass,
    );
    const count = pts.length / 5;
    if (!count) return null;
    const mats = new Float32Array(count * 16);
    const cols = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const x = pts[i * 5]! * S;
      const z = pts[i * 5 + 1]! * S;
      const s = pts[i * 5 + 3]!;
      Quaternion.RotationYawPitchRollToRef(pts[i * 5 + 2]!, 0, 0, quat);
      pos.set(x, sampler.heightAt(x, z) - 0.05, z);
      Matrix.ComposeToRef(scl.set(s * 1.1, s, s * 1.1), quat, pos, mtx);
      mtx.copyToArray(mats, i * 16);
      const f = pts[i * 5 + 4]!;
      for (let k = 0; k < 3; k++) {
        cols[i * 4 + k] = GRASS_COLORS.warden[k]! * (1 - f) + GRASS_COLORS.hollow[k]! * f;
      }
      cols[i * 4 + 3] = 1;
    }
    const m = new Mesh(`foliage_${cell.cx}_${cell.cz}_grass`, scene);
    attachGeometry(scene, m, grassGeometry);
    m.material = grassMaterial;
    freeze(m);
    m.thinInstanceSetBuffer('matrix', mats, 16, true);
    m.thinInstanceSetBuffer('color', cols, 4, true);
    m.thinInstanceRefreshBoundingInfo(false);
    grassCells++;
    grassTufts += count;
    return m;
  };

  // ---- visibility by ID
  const visible = new Uint8Array(n).fill(1);
  let hidden = 0;
  const collapse = (arr: Float32Array, o: number) => {
    // Zero the 3×3 (keep translation and w): every vertex lands on the trunk base.
    for (let k = 0; k < 12; k++) if (k % 4 !== 3) arr[o + k] = 0;
  };
  const casterCellOf = (id: number) => cells.get(cellIndex[id]!)!;

  const setTreeVisible = (id: number, on: boolean) => {
    if (id < 0 || id >= n || !Number.isInteger(id)) throw new RangeError(`no tree ${id}`);
    if ((visible[id] === 1) === on) return;
    visible[id] = on ? 1 : 0;
    hidden += on ? -1 : 1;
    const g = groups[groupOf[id]!]!;
    const o = slotOf[id]! * 16;
    const cell = casterCellOf(id);
    const co = casterSlotOf[id]! * 16;
    if (on) {
      g.matrices.set(original.subarray(id * 16, id * 16 + 16), o);
      cell.casterMatrices.set(casterOriginal.subarray(id * 16, id * 16 + 16), co);
    } else {
      collapse(g.matrices, o);
      collapse(cell.casterMatrices, co);
    }
    g.dirty = true;
    cell.casterDirty = true;
  };

  // ---- per frame: wind clock, batched uploads, LOD and grass
  let nearCells = 0;
  const observer: Observer<Scene> = scene.onBeforeRenderObservable.add(() => {
    wind.time += Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
    for (const g of groups) {
      if (!g.dirty) continue;
      g.dirty = false;
      g.near.thinInstanceBufferUpdated('matrix');
      g.far.thinInstanceBufferUpdated('matrix');
    }
    const cam = scene.activeCamera;
    if (!cam) return;
    const eye = cam.globalPosition;
    const lod = lodBase * lodBias;
    const grassD = grassBase * lodBias;
    nearCells = 0;
    for (const cell of cells.values()) {
      if (cell.casterDirty && cell.caster) {
        cell.casterDirty = false;
        cell.caster.thinInstanceBufferUpdated('matrix');
      }
      const d = Vector3.Distance(eye, cell.center);
      const near = d < lod;
      if (near) nearCells += cell.groups.length ? 1 : 0;
      if (near !== cell.near) {
        cell.near = near;
        for (const g of cell.groups) {
          g.near.isVisible = near;
          g.far.isVisible = !near;
        }
      }
      if (cell.caster) cell.caster.isVisible = d < shadowBase;
      const wantGrass = grassOn && d < grassD;
      if (wantGrass && cell.grass === undefined) cell.grass = buildGrass(cell);
      if (cell.grass) cell.grass.isVisible = wantGrass;
    }
  });

  const applyTier = (tier: QualityTier) => {
    grassOn = tier === 'high';
    lodBias = tier === 'low' ? 0.7 : 1;
    if (!grassOn) for (const c of grassCellsList) if (c.grass) c.grass.isVisible = false;
  };
  applyTier(opts.tier ?? 'high');

  const loadMs = performance.now() - t0;
  const speciesStats: SpeciesStats[] = assets.map((a, i) => ({
    id: a.def.id,
    count: counts[i]!,
    nearTris: a.nearTris,
    farTris: a.farTris,
    height: a.def.height,
  }));

  return {
    trees,
    treeCount: n,
    setTreeVisible,
    isTreeVisible: (id) => visible[id] === 1,
    get hiddenCount() {
      return hidden;
    },
    setTier: applyTier,
    setLodBias(b) {
      lodBias = b;
    },
    wind,
    get stats(): FoliageStats {
      return {
        trees: n,
        hidden,
        cells: [...cells.values()].filter((c) => c.groups.length).length,
        groups: groups.length,
        species: speciesStats,
        casterTris,
        grassTris: tuftTris,
        grassCells,
        grassTufts,
        nearCells,
        downloadBytes,
        loadMs: Math.round(loadMs),
        scatterMs: Math.round(scatterMs),
        rejected: scatter.rejected,
      };
    },
    meshes,
    dispose() {
      scene.onBeforeRenderObservable.remove(observer);
      for (const m of meshes) m.dispose();
      for (const a of assets) {
        for (const b of [...a.near.buffers, ...a.far.buffers]) b.dispose();
        a.material.dispose();
      }
      for (const b of [...casterGeometry.buffers, ...grassGeometry.buffers]) b.dispose();
      casterMaterial.dispose();
      grassMaterial.dispose();
    },
  };
}
