/**
 * Structures sandbox (/structures.html), two modes:
 *
 * - `?mode=gallery` (default): every structure variant, Wardens (back row),
 *   Hollow (middle) and neutral shops (front), with a displayed-scale hero
 *   beside the Warden T1 for scale.
 * - `?mode=map`: every structure from citadel.json placed by the loader on a
 *   flat stand-in ground (lanes and river as flat strips), seen from the MOBA
 *   camera. Views: `wardens_base` (the densest view), `hollow_base`, `mid`,
 *   `overview`.
 *
 * The camera uses the MOBA rig's own pose maths (camera/rig.ts) without its
 * input, so views are deterministic for tests. `?tier=` and `?engine=webgl`
 * work as in the game. Debug hook: window.__citadelStructures.
 */
import { Scene } from '@babylonjs/core/scene';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { MapSpec, Structure } from '@citadel/content';
import citadelJson from '../../../../packages/content/data/map/citadel.json';
import { createEngine } from '../render/engine';
import { createQualityController } from '../render/tiers';
import { createPerfHud } from '../render/hud';
import { readStats, type CitadelStats } from '../render/stats';
import type { QualityTier } from '../render/quality';
import { registerShadowCaster, registerShadowReceiver } from '../render/shadows';
import { CitadelToonMaterial } from '../render/shaders/citadelToonMaterial';
import { applyCitadelToon } from '../render/shaders/applyCitadelToon';
import { teamMaskFor } from '../render/shaders/teamMask';
import { cameraPose, DEFAULT_CAMERA_CONFIG } from '../camera/rig';
import { MODEL_CONFIGS } from '../units/modelConfig';
import { loadModel } from '../units/loadModel';
import {
  createStructureSet,
  MAP_UNITS_PER_WORLD_UNIT,
  recipeVariants,
  type StructureSet,
  type VariantStats,
} from '../map/structures';
import { parseVariant, type VariantId } from '../map/structures/placement';

type Mode = 'gallery' | 'map';
type MapView = 'wardens_base' | 'hollow_base' | 'mid' | 'overview';
type GalleryView = 'overview' | 'towers' | 'core' | 'neutral';

export interface CitadelStructuresDebug {
  mode: Mode;
  /** Structures in the source data (map mode: citadel.json; gallery: one per variant). */
  expected: number;
  /** Structures the loader placed. */
  placed: number;
  instances: number;
  variants: VariantStats[];
  counts: Record<string, number>;
  casterCount: number;
  materialCount: number;
  frames(): number;
  view(name: MapView | GalleryView | VariantId): void;
  forceLod(level: 0 | 1 | null): void;
  lodUsage(): { lod0: number; lod1: number };
  scene: Scene;
}

declare global {
  interface Window {
    __citadelReady?: boolean;
    __citadelStats?: CitadelStats;
    __citadelSetTier?: (tier: QualityTier) => void;
    __citadelStructures?: CitadelStructuresDebug;
  }
}

const params = new URLSearchParams(location.search);
const mode: Mode = params.get('mode') === 'map' ? 'map' : 'gallery';
const map = citadelJson as unknown as MapSpec;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const labelsEl = document.getElementById('labels') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;

const { engine, backend } = await createEngine(canvas);
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#1B1A1FFF');

// ---- camera: the MOBA rig's pose (55° pitch at default distance), no input ----
const camera = new TargetCamera('moba-camera', Vector3.Zero(), scene);
camera.fov = DEFAULT_CAMERA_CONFIG.fov;
camera.minZ = 0.5;
camera.maxZ = 2000;
function setCamera(x: number, z: number, distance: number) {
  const cfg = {
    ...DEFAULT_CAMERA_CONFIG,
    maxDistance: Math.max(distance, DEFAULT_CAMERA_CONFIG.maxDistance),
  };
  const pose = cameraPose(
    {
      focus: { x, z },
      velocity: { x: 0, z: 0 },
      distance,
      targetDistance: distance,
      focusGoal: null,
    },
    cfg,
  );
  camera.position.set(...pose.position);
  camera.setTarget(new Vector3(...pose.target));
}

// Same light rig as the boot scene (render/scene.ts); M1-09 replaces it.
new HemisphericLight('sky', new Vector3(0, 1, 0), scene).intensity = 0.6;
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.4), scene);
sun.intensity = 0.9;

function flatToon(name: string, hex: string) {
  const m = new CitadelToonMaterial(name, scene, {
    params: { heightStrength: 0, rimIntensity: 0 },
  });
  m.diffuseColor = Color3.FromHexString(hex);
  return m;
}

/** Flat strips along a polyline, merged into one mesh (one draw call). */
function strip(
  name: string,
  points: readonly { x: number; z: number }[],
  width: number,
  y: number,
  hex: string,
) {
  const parts: Mesh[] = [];
  const s = MAP_UNITS_PER_WORLD_UNIT;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z) / s;
    const seg = MeshBuilder.CreateGround(
      `${name}${i}`,
      { width: width / s, height: len + width / s },
      scene,
    );
    seg.position.set((a.x + b.x) / 2 / s, y, (a.z + b.z) / 2 / s);
    seg.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    parts.push(seg);
  }
  const merged = Mesh.MergeMeshes(parts, true)!;
  merged.name = name;
  merged.material = flatToon(`m:${name}`, hex);
  registerShadowReceiver(merged);
  return merged;
}

// ---- ground ----------------------------------------------------------------
const worldSize = map.size.width / MAP_UNITS_PER_WORLD_UNIT;
const ground = MeshBuilder.CreateGround(
  'ground',
  mode === 'map' ? { width: worldSize, height: worldSize } : { width: 300, height: 140 },
  scene,
);
ground.material = flatToon('m:ground', '#6F7F55');
registerShadowReceiver(ground);
if (mode === 'map') {
  for (const lane of map.lanes)
    strip(`lane-${lane.id}`, lane.waypoints, lane.width, 0.02, '#9C8A68');
  strip('river', map.river.waypoints, map.river.width, 0.04, '#7FE3E0');
}

// ---- structures ------------------------------------------------------------
const GALLERY_SPACING = 30;
const GALLERY_ROWS: Record<string, number> = { wardens: 30, hollow: 0, neutral: -30 };
let galleryStructures: Structure[] = [];
const galleryPos = new Map<VariantId, { x: number; z: number }>();
if (mode === 'gallery') {
  const variants = recipeVariants();
  const cols = new Map<string, number>();
  galleryStructures = variants.map((v) => {
    const { owner, kind } = parseVariant(v);
    const col = cols.get(owner) ?? 0;
    cols.set(owner, col + 1);
    const neutralOffset = owner === 'neutral' ? 7 : 0; // under the shop column
    const x = (col + neutralOffset - 4) * GALLERY_SPACING;
    const z = GALLERY_ROWS[owner]!;
    galleryPos.set(v, { x, z });
    const tier = kind.startsWith('tower_t') ? Number(kind.slice(7)) : undefined;
    return {
      id: v.replace(':', '_'),
      faction: owner,
      type: kind.startsWith('tower') ? 'tower' : (kind as Structure['type']),
      ...(tier ? { tier } : {}),
      position: { x: x * MAP_UNITS_PER_WORLD_UNIT, z: z * MAP_UNITS_PER_WORLD_UNIT },
      facing: 270, // fronts toward the camera (south)
    } as Structure;
  });
}
const source = mode === 'map' ? map.structures : galleryStructures;
const set: StructureSet = await createStructureSet(scene, source, {
  lodDistance: params.has('lod') ? Number(params.get('lod')) : undefined,
});

// A displayed-scale hero (UnitView draws heroes at 2.5×) beside the Warden T1, for scale.
if (mode === 'gallery' && params.get('hero') !== '0') {
  const knight = await loadModel(scene, MODEL_CONFIGS.knight);
  const slot = new TransformNode('hero-scale', scene);
  const t1 = galleryPos.get('wardens:tower_t1')!;
  slot.position.set(t1.x + 9, 0, t1.z - 6);
  slot.rotation.y = Math.PI;
  slot.scaling.setAll(2.5);
  knight.root.parent = slot;
  applyCitadelToon(knight.root, { team: 'warden', teamMask: teamMaskFor('knight') });
  for (const m of knight.meshes) if (m.isEnabled()) registerShadowCaster(m, false);
}

// ---- views -----------------------------------------------------------------
const s = MAP_UNITS_PER_WORLD_UNIT;
const MAP_VIEWS: Record<MapView, [number, number, number]> = {
  // Ancient, both T4s, fountain, base shop and the mid barracks in one screen.
  wardens_base: [-5600 / s, -5800 / s, DEFAULT_CAMERA_CONFIG.defaultDistance],
  hollow_base: [5800 / s, 5600 / s, DEFAULT_CAMERA_CONFIG.defaultDistance],
  mid: [0, 0, DEFAULT_CAMERA_CONFIG.defaultDistance],
  overview: [0, -40, 560],
};
const GALLERY_VIEWS: Record<GalleryView, [number, number, number]> = {
  overview: [0, -10, 230],
  towers: [-2.5 * GALLERY_SPACING, 2, 115],
  core: [2 * GALLERY_SPACING, 2, 135],
  neutral: [3.5 * GALLERY_SPACING, -30, DEFAULT_CAMERA_CONFIG.defaultDistance],
};
function view(name: string) {
  if (mode === 'map' && name in MAP_VIEWS) setCamera(...MAP_VIEWS[name as MapView]);
  else if (mode === 'gallery' && name in GALLERY_VIEWS)
    setCamera(...GALLERY_VIEWS[name as GalleryView]);
  else if (galleryPos.has(name as VariantId)) {
    const p = galleryPos.get(name as VariantId)!;
    setCamera(p.x, p.z + 4, DEFAULT_CAMERA_CONFIG.defaultDistance * 0.7);
  } else {
    const st = set.placements.find((p) => p.id === name);
    if (st) setCamera(st.x, st.z, DEFAULT_CAMERA_CONFIG.defaultDistance);
  }
  for (const [k, b] of viewBtns) b.classList.toggle('on', k === name);
}

// ---- UI --------------------------------------------------------------------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}
const viewBtns = new Map<string, HTMLButtonElement>();
for (const v of Object.keys(mode === 'map' ? MAP_VIEWS : GALLERY_VIEWS)) {
  const b = el('button', v.replace('_', ' '));
  b.onclick = () => view(v);
  viewBtns.set(v, b);
  panel.append(b);
}
const lodBtn = el('button', 'LOD: auto');
let lodMode: 0 | 1 | null = null;
lodBtn.onclick = () => {
  lodMode = lodMode === null ? 0 : lodMode === 0 ? 1 : null;
  set.forceLod(lodMode);
  lodBtn.textContent = `LOD: ${lodMode ?? 'auto'}`;
};
panel.append(lodBtn);
const other = el('a', mode === 'map' ? 'gallery mode' : 'whole-map mode');
other.href = `?mode=${mode === 'map' ? 'gallery' : 'map'}${params.has('tier') ? `&tier=${params.get('tier')}` : ''}`;
other.style.color = '#E8B54A';
panel.append(other);

// Labels under each gallery item.
const labelEls: { div: HTMLDivElement; at: Vector3 }[] = [];
if (mode === 'gallery') {
  for (const [v, p] of galleryPos) {
    const { owner, kind } = parseVariant(v);
    const d = el('div', kind.replace('_', ' '));
    d.className = owner === 'wardens' ? 'warden' : owner === 'hollow' ? 'hollow' : '';
    d.style.transform = 'translate(-50%, 0)';
    labelsEl.append(d);
    labelEls.push({ div: d, at: new Vector3(p.x, 0, p.z - 9) });
  }
}
function updateLabels() {
  if (!labelEls.length) return;
  const w = engine.getRenderWidth();
  const h = engine.getRenderHeight();
  const viewport = camera.viewport.toGlobal(w, h);
  const scale = canvas.clientWidth / w;
  const transform = scene.getTransformMatrix();
  for (const l of labelEls) {
    const p = Vector3.Project(l.at, Matrix.IdentityReadOnly, transform, viewport);
    const visible = p.z > 0 && p.z < 1;
    l.div.style.display = visible ? '' : 'none';
    l.div.style.left = `${p.x * scale}px`;
    l.div.style.top = `${p.y * scale}px`;
  }
}

view(params.get('view') ?? (mode === 'map' ? 'wardens_base' : 'overview'));

const quality = createQualityController(engine, scene, backend);
const hud = createPerfHud(overlay, (tier) => quality.setTier(tier));
window.__citadelSetTier = (tier) => quality.setTier(tier);

let frames = 0;
window.__citadelStructures = {
  mode,
  expected: source.length,
  placed: set.nodes.size,
  instances: set.instances.length,
  variants: set.stats,
  counts: Object.fromEntries(set.counts),
  casterCount: set.casterCount,
  materialCount: new Set(set.instances.map((i) => i.sourceMesh.material)).size,
  frames: () => frames,
  view,
  forceLod: (level) => set.forceLod(level),
  lodUsage: () => set.lodUsage(),
  scene,
};

await scene.whenReadyAsync();
readStats(engine, scene, backend, quality.tier); // attach instrumentation before the first frame
engine.runRenderLoop(() => {
  scene.render();
  frames++;
  if (frames % 6 === 0) updateLabels();
  if (frames % 15 === 0) {
    const stats = readStats(engine, scene, backend, quality.tier);
    window.__citadelStats = stats;
    const lod = set.lodUsage();
    hud.update(stats, [`structures ${set.nodes.size}`, `LOD0 ${lod.lod0} · LOD1 ${lod.lod1}`]);
    if (frames >= 30) window.__citadelReady = true;
  }
});
window.addEventListener('resize', () => engine.resize());
