/**
 * Builds structure variants from recipes and places them from map data.
 *
 * Per variant: every part is merged into one mesh per (LOD, hover group,
 * material channel): the shared atlas body material, plus one emissive mesh
 * per glow colour. Each placement is a TransformNode with InstancedMeshes of
 * those sources, so all three Warden T1 towers draw in one call per channel,
 * and Babylon picks the LOD per instance. LOD1 drops `detail` parts, halves
 * primitive sides and runs vertex-clustering decimation on the body.
 * See docs/design/structures.md.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateTorusVertexData } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import '@babylonjs/core/Meshes/instancedMesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { Owner, Structure } from '@citadel/content';
import { CitadelToonMaterial } from '../../render/shaders/citadelToonMaterial';
import { TEAM_COLORS } from '../../render/shaders/palette';
import { atlasCell, KAYKIT_ATLAS } from '../../render/shaders/teamMask';
import { registerShadowCaster, registerShadowReceiver } from '../../render/shadows';
import {
  appendGeom,
  decimateByClustering,
  emptyGeom,
  flatShade,
  swatchUvs,
  transformGeom,
  triangleCount,
  windingSign,
  type Geom,
} from './geometry';
import { loadKitLibrary, type KitLibrary } from './kitParts';
import {
  countByVariant,
  placeStructures,
  type HeightAt,
  type StructurePlacement,
  type VariantId,
} from './placement';
import {
  GLOW_COLORS,
  isKitPart,
  piecesFor,
  footprintRadii,
  RECIPES,
  SWATCHES,
  TEAM_SWATCH,
  type GlowId,
  type Part,
  type PrimPart,
  type Recipe,
} from './recipes';

/** Distance (camera to structure, world units) where LOD1 takes over. */
export const DEFAULT_LOD1_DISTANCE = 105;
/** Vertex-clustering cell for LOD1 bodies, world units. */
export const LOD1_CELL = 0.32;

const DEG = Math.PI / 180;

/** Body tint per owner (multiplies the atlas): Hollow stone turns to violet ash. */
const BODY_TINT: Record<Owner, string> = {
  wardens: '#FFFFFF',
  hollow: '#A39BB3',
  neutral: '#E6DED0',
};
/** Team colour per owner; neutral shops get Warden bronze on their team swatch. */
const TEAM_TINT: Record<Owner, string> = {
  wardens: TEAM_COLORS.warden,
  hollow: TEAM_COLORS.hollow,
  neutral: '#B07A3C',
};

type Channel = 'body' | GlowId;
type Group = 'static' | 'float';

export interface VariantStats {
  variant: VariantId;
  /** Triangles of one instance at LOD0 / LOD1 (all channels). */
  trisLod0: number;
  trisLod1: number;
  /** Source meshes per LOD = draw calls per visible batch of this variant. */
  drawsPerLod: number;
  castsShadow: boolean;
  instances: number;
}

export interface StructureSet {
  root: TransformNode;
  placements: StructurePlacement[];
  /** Placement root nodes by structure id. */
  nodes: Map<string, TransformNode>;
  instances: InstancedMesh[];
  stats: VariantStats[];
  /** Instance meshes registered as shadow casters. */
  casterCount: number;
  /** Placement count per variant (equals the map's structure count in total). */
  counts: Map<VariantId, number>;
  setLodDistance(d: number): void;
  /** Force one LOD for every structure (debug/screenshots), or null for distance-based. */
  forceLod(level: 0 | 1 | null): void;
  /** How many instances currently render at each LOD (after the last frame). */
  lodUsage(): { lod0: number; lod1: number };
  dispose(): void;
}

export interface StructureSetOptions {
  /** Terrain height (world units) at a world point. Default: flat ground at y = 0. */
  heightAt?: HeightAt;
  /** Map units per world unit (default MAP_UNITS_PER_WORLD_UNIT). */
  scale?: number;
  /** Register shadow casters per the recipe policy (default true). */
  shadows?: boolean;
  /** Animate hovering parts (default true). */
  animate?: boolean;
  lodDistance?: number;
  /** Where the hexagon GLBs are served (tests can point elsewhere). */
  pieceBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// Geometry for parts
// ---------------------------------------------------------------------------

function fromVertexData(vd: VertexData): Geom {
  return {
    positions: Array.from(vd.positions ?? []),
    normals: Array.from(vd.normals ?? []),
    uvs: Array.from(vd.uvs ?? []),
    indices: Array.from(vd.indices ?? []),
  };
}

/** Babylon's own winding convention, measured once from its box builder. */
function babylonWinding(): 1 | -1 {
  return windingSign(fromVertexData(CreateBoxVertexData({ size: 1 }))) >= 0 ? 1 : -1;
}

/** Faces of a convex shape point away from `center`; fixes order and normal together. */
function orientOutward(g: Geom, center: readonly [number, number, number], sign: 1 | -1): Geom {
  const flat = flatShade(g, sign);
  for (let t = 0; t < flat.indices.length; t += 3) {
    const v = flat.indices[t]! * 3;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      const i = flat.indices[t + k]! * 3;
      cx += flat.positions[i]! / 3;
      cy += flat.positions[i + 1]! / 3;
      cz += flat.positions[i + 2]! / 3;
    }
    const d =
      (cx - center[0]) * flat.normals[v]! +
      (cy - center[1]) * flat.normals[v + 1]! +
      (cz - center[2]) * flat.normals[v + 2]!;
    if (d < 0) {
      const b = flat.indices[t + 1]!;
      flat.indices[t + 1] = flat.indices[t + 2]!;
      flat.indices[t + 2] = b;
      for (let k = 0; k < 3; k++) {
        const i = flat.indices[t + k]! * 3;
        flat.normals[i] = -flat.normals[i]!;
        flat.normals[i + 1] = -flat.normals[i + 1]!;
        flat.normals[i + 2] = -flat.normals[i + 2]!;
      }
    }
  }
  return flat;
}

function primGeom(part: PrimPart, lod: 0 | 1, sign: 1 | -1): Geom {
  const s = part.prim;
  switch (s.type) {
    case 'cylinder': {
      const sides = lod === 1 && s.sides > 6 ? Math.max(6, Math.round(s.sides / 2)) : s.sides;
      const g = fromVertexData(
        CreateCylinderVertexData({
          height: s.height,
          diameterTop: s.top,
          diameterBottom: s.bottom,
          tessellation: sides,
        }),
      );
      // Low-sided prisms get hard facets like the KayKit pieces.
      const shaped = sides <= 8 ? flatShade(g, sign) : g;
      return transformGeom(shaped, { translate: [0, s.height / 2, 0] });
    }
    case 'box': {
      const g = fromVertexData(CreateBoxVertexData({ width: s.w, height: s.h, depth: s.d }));
      return transformGeom(g, { translate: [0, s.h / 2, 0] });
    }
    case 'torus': {
      const sides = lod === 1 ? Math.max(6, Math.round(s.sides / 2)) : s.sides;
      return fromVertexData(
        CreateTorusVertexData({
          diameter: s.diameter,
          thickness: s.thickness,
          tessellation: sides,
        }),
      );
    }
    case 'crystal': {
      const r = s.width / 2;
      const mid = s.height * 0.42;
      const positions = [0, s.height, 0, 0, 0, 0, r, mid, 0, 0, mid, r, -r, mid, 0, 0, mid, -r];
      const indices = [0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 2, 1, 3, 2, 1, 4, 3, 1, 5, 4, 1, 2, 5];
      const g: Geom = {
        positions,
        normals: new Array(18).fill(0),
        uvs: new Array(12).fill(0),
        indices,
      };
      return orientOutward(g, [0, mid, 0], sign);
    }
  }
}

function partTransform(p: Part) {
  const sc = p.scale ?? 1;
  return {
    scale: (typeof sc === 'number' ? [sc, sc, sc] : sc) as [number, number, number],
    rotY: (p.rotY ?? 0) * DEG,
    rotX: (p.rotX ?? 0) * DEG,
    rotZ: (p.rotZ ?? 0) * DEG,
    translate: (p.at ?? [0, 0, 0]) as [number, number, number],
  };
}

function channelOf(p: Part): Channel {
  return !isKitPart(p) && p.glow ? p.glow : 'body';
}

/** Merged geometry per (group, channel) for one recipe at one LOD. */
export function recipeGeometry(
  recipe: Recipe,
  lod: 0 | 1,
  kit: KitLibrary,
  sign: 1 | -1,
): Map<`${Group}|${Channel}`, Geom> {
  const out = new Map<`${Group}|${Channel}`, Geom>();
  for (const p of recipe.parts) {
    if (lod === 1 && p.detail) continue;
    let g: Geom;
    if (isKitPart(p)) {
      const src = kit.pieces.get(p.piece);
      if (!src) throw new Error(`kit piece ${p.piece} not loaded`);
      g = src;
    } else {
      g = primGeom(p, lod, sign);
      if (!p.glow) {
        const [c, r] = SWATCHES[p.swatch ?? 'stone'];
        g = swatchUvs(g, c, r, KAYKIT_ATLAS);
      }
    }
    const key = `${p.float ? 'float' : 'static'}|${channelOf(p)}` as const;
    let dst = out.get(key);
    if (!dst) out.set(key, (dst = emptyGeom()));
    appendGeom(dst, transformGeom(g, partTransform(p)));
  }
  if (lod === 1) {
    for (const [key, g] of out) {
      if (key.endsWith('|body')) out.set(key, decimateByClustering(g, LOD1_CELL, KAYKIT_ATLAS));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function makeMaterials(scene: Scene, atlas: BaseTexture) {
  const body = new Map<Owner, CitadelToonMaterial>();
  const glow = new Map<GlowId, CitadelToonMaterial>();
  const bodyFor = (owner: Owner) => {
    let m = body.get(owner);
    if (!m) {
      m = new CitadelToonMaterial(`structure:body:${owner}`, scene, {
        // Structures are ~3× hero height and stand on terrain at varying heights,
        // so the hero-tuned height gradient is off; the plinths ground them instead.
        params: { teamColor: TEAM_TINT[owner], heightStrength: 0, rimIntensity: 0.5 },
        teamRects: [atlasCell(TEAM_SWATCH[0], TEAM_SWATCH[1])],
      });
      m.diffuseTexture = atlas;
      m.diffuseColor = Color3.FromHexString(BODY_TINT[owner]);
      body.set(owner, m);
    }
    return m;
  };
  const glowFor = (id: GlowId) => {
    let m = glow.get(id);
    if (!m) {
      m = new CitadelToonMaterial(`structure:glow:${id}`, scene, {
        params: { rimIntensity: 0, heightStrength: 0, paletteStrength: 0 },
      });
      m.diffuseColor = Color3.Black();
      m.emissiveColor = Color3.FromHexString(GLOW_COLORS[id]);
      glow.set(id, m);
    }
    return m;
  };
  return { bodyFor, glowFor, all: () => [...body.values(), ...glow.values()] };
}

// ---------------------------------------------------------------------------
// Variants + placement
// ---------------------------------------------------------------------------

interface VariantSources {
  /** LOD0 source meshes (LOD1 hangs off each as an LOD level). */
  sources: { mesh: Mesh; lod1: Mesh | null; group: Group; channel: Channel }[];
  stats: VariantStats;
  recipe: Recipe;
}

function toMesh(name: string, g: Geom, scene: Scene): Mesh {
  const vd = new VertexData();
  vd.positions = g.positions;
  vd.normals = g.normals;
  vd.uvs = g.uvs;
  vd.indices = g.indices;
  const m = new Mesh(name, scene);
  vd.applyToMesh(m, false);
  // Sources only feed instances.
  m.isVisible = false;
  m.isPickable = false;
  return m;
}

function buildVariant(
  scene: Scene,
  variant: VariantId,
  recipe: Recipe,
  kit: KitLibrary,
  sign: 1 | -1,
  mats: ReturnType<typeof makeMaterials>,
  lodDistance: number,
  parent: TransformNode,
): VariantSources {
  const owner = variant.split(':')[0] as Owner;
  const g0 = recipeGeometry(recipe, 0, kit, sign);
  const g1 = recipeGeometry(recipe, 1, kit, sign);
  const sources: VariantSources['sources'] = [];
  let trisLod0 = 0;
  let trisLod1 = 0;
  for (const [key, geom] of g0) {
    const [group, channel] = key.split('|') as [Group, Channel];
    const material = channel === 'body' ? mats.bodyFor(owner) : mats.glowFor(channel);
    const mesh = toMesh(`structure:${variant}:${key}:lod0`, geom, scene);
    mesh.material = material;
    mesh.parent = parent;
    trisLod0 += triangleCount(geom);
    const geom1 = g1.get(key);
    let lod1: Mesh | null = null;
    if (geom1 && geom1.indices.length) {
      lod1 = toMesh(`structure:${variant}:${key}:lod1`, geom1, scene);
      lod1.material = material;
      lod1.parent = parent;
      lod1.isVisible = true; // LOD levels are never drawn on their own (Babylon blocks them)
      mesh.addLODLevel(lodDistance, lod1);
      trisLod1 += triangleCount(geom1);
    } else {
      mesh.addLODLevel(lodDistance, null); // detail-only channel: gone at LOD1
    }
    registerShadowReceiver(mesh);
    if (lod1) registerShadowReceiver(lod1);
    sources.push({ mesh, lod1, group, channel });
  }
  return {
    sources,
    recipe,
    stats: {
      variant,
      trisLod0,
      trisLod1,
      drawsPerLod: sources.length,
      castsShadow: recipe.castsShadow,
      instances: 0,
    },
  };
}

/** Deterministic per-structure phase so hovering parts don't bob in sync. */
function phaseOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

/**
 * Loads the kit pieces, builds every variant the map uses and places one
 * instance group per structure. Structures whose variant has no recipe are
 * skipped with a warning (none in citadel.json; the unit tests check that).
 */
export async function createStructureSet(
  scene: Scene,
  structures: readonly Structure[],
  opts: StructureSetOptions = {},
): Promise<StructureSet> {
  const placements = placeStructures(structures, {
    scale: opts.scale,
    heightAt: opts.heightAt,
    footprintRadius: footprintRadii(),
  });
  const variants = [...new Set(placements.map((p) => p.variant))].filter((v) => {
    if (RECIPES.has(v)) return true;
    console.warn(`[citadel] structures: no recipe for ${v}; skipped`);
    return false;
  });
  const sign = babylonWinding();
  const kit = await loadKitLibrary(scene, piecesFor(variants), sign, opts.pieceBaseUrl);
  const mats = makeMaterials(scene, kit.atlas);
  let lodDistance = opts.lodDistance ?? DEFAULT_LOD1_DISTANCE;

  const root = new TransformNode('structures', scene);
  const sourcesRoot = new TransformNode('structures:sources', scene);
  sourcesRoot.parent = root;
  const built = new Map<VariantId, VariantSources>();
  for (const v of variants) {
    built.set(
      v,
      buildVariant(scene, v, RECIPES.get(v)!, kit, sign, mats, lodDistance, sourcesRoot),
    );
  }

  const nodes = new Map<string, TransformNode>();
  const instances: InstancedMesh[] = [];
  const hovering: { node: TransformNode; phase: number; hover: NonNullable<Recipe['hover']> }[] =
    [];
  let casterCount = 0;
  for (const p of placements) {
    const vs = built.get(p.variant);
    if (!vs) continue;
    vs.stats.instances++;
    const node = new TransformNode(`structure:${p.id}`, scene);
    node.parent = root;
    node.position.set(p.x, p.y, p.z);
    node.rotation.y = p.rotationY;
    nodes.set(p.id, node);
    let floatNode: TransformNode | null = null;
    for (const s of vs.sources) {
      const inst = s.mesh.createInstance(`${p.id}:${s.group}:${s.channel}`);
      inst.isPickable = false;
      if (s.group === 'float') {
        if (!floatNode) {
          floatNode = new TransformNode(`structure:${p.id}:float`, scene);
          floatNode.parent = node;
          if (vs.recipe.hover && opts.animate !== false) {
            hovering.push({ node: floatNode, phase: phaseOf(p.id), hover: vs.recipe.hover });
          }
        }
        inst.parent = floatNode;
      } else {
        inst.parent = node;
      }
      if (opts.shadows !== false && vs.recipe.castsShadow && s.channel === 'body') {
        registerShadowCaster(inst, false);
        casterCount++;
      }
      instances.push(inst);
    }
  }
  // Static placements never move: freeze their matrices (hovering children still update).
  root.computeWorldMatrix(true);
  for (const node of nodes.values()) node.computeWorldMatrix(true);
  for (const inst of instances) {
    inst.computeWorldMatrix(true);
    if (!inst.parent?.name.endsWith(':float')) inst.freezeWorldMatrix();
  }

  let observer: Observer<Scene> | null = null;
  if (hovering.length) {
    let t = 0;
    observer = scene.onBeforeRenderObservable.add(() => {
      t += Math.min(scene.getEngine().getDeltaTime(), 100) / 1000;
      for (const h of hovering) {
        h.node.position.y =
          Math.sin((t / h.hover.period) * Math.PI * 2 + h.phase) * h.hover.amplitude;
        h.node.rotation.y = h.phase + t * h.hover.spin;
      }
    });
  }

  let forced: 0 | 1 | null = null;
  const applyLod = () => {
    for (const vs of built.values()) {
      for (const s of vs.sources) {
        for (const level of [...s.mesh.getLODLevels()]) s.mesh.removeLODLevel(level.mesh as Mesh);
        if (forced === 0) continue; // LOD0 everywhere: no levels
        s.mesh.addLODLevel(forced === 1 ? 0 : lodDistance, s.lod1);
      }
    }
  };

  return {
    root,
    placements,
    nodes,
    instances,
    stats: [...built.values()].map((b) => b.stats),
    casterCount,
    counts: countByVariant(placements),
    setLodDistance(d) {
      lodDistance = d;
      applyLod();
    },
    forceLod(level) {
      forced = level;
      applyLod();
    },
    lodUsage() {
      let lod0 = 0;
      let lod1 = 0;
      const camera = scene.activeCamera;
      if (!camera) return { lod0, lod1 };
      for (const vs of built.values()) {
        for (const s of vs.sources) {
          if (s.channel !== 'body' || s.group !== 'static') continue;
          for (const inst of s.mesh.instances) {
            if (!camera.isInFrustum(inst)) continue;
            const lod = s.mesh.getLOD(camera, inst.getBoundingInfo().boundingSphere);
            if (lod === s.mesh) lod0++;
            else if (lod) lod1++;
          }
        }
      }
      return { lod0, lod1 };
    },
    dispose() {
      if (observer) scene.onBeforeRenderObservable.remove(observer);
      root.dispose(false, false);
      for (const m of mats.all()) m.dispose();
    },
  };
}
