/**
 * Toon shader sandbox (/toon.html): the four KayKit base models idling in
 * three rows: original materials (back), Warden-tinted toon (middle) and
 * Hollow-tinted toon (front). A thin-instanced row of stone markers shows the
 * same material on untextured, instanced geometry.
 *
 * Sliders tune ramp, rim, palette and team-colour strength live (uniforms
 * only, no recompiles). `?tier=` and `?engine=webgl` work as in the game.
 * Debug hook for tests: window.__citadelToon.
 */
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createEngine } from '../render/engine';
import { createQualityController } from '../render/tiers';
import { createPerfHud } from '../render/hud';
import { readStats, type CitadelStats } from '../render/stats';
import type { QualityTier } from '../render/quality';
import { registerShadowCaster, registerShadowReceiver } from '../render/shadows';
import { MODEL_CONFIGS, MODEL_IDS, type ModelId } from '../units/modelConfig';
import { loadModel, type LoadedModel } from '../units/loadModel';
import { createToonUnitLook } from '../render/shaders/toonUnitLook';
import { CitadelToonMaterial } from '../render/shaders/citadelToonMaterial';
import type { UvRect } from '../render/shaders/teamMask';
import { DEFAULT_TOON_PARAMS, type ToonParams } from '../render/shaders/toonParams';

type RowId = 'original' | 'warden' | 'hollow';
type View = 'close' | 'moba';

/** Numeric params the sliders (and the debug hook) can set. */
const SLIDERS = [
  { key: 'shadowThreshold', label: 'shadow band', min: 0, max: 1, step: 0.01 },
  { key: 'litThreshold', label: 'lit band', min: 0, max: 1, step: 0.01 },
  { key: 'bandSoftness', label: 'softness', min: 0, max: 0.2, step: 0.005 },
  { key: 'ambientStrength', label: 'ambient', min: 0, max: 3, step: 0.05 },
  { key: 'rimIntensity', label: 'rim', min: 0, max: 2, step: 0.05 },
  { key: 'rimWidth', label: 'rim width', min: 0, max: 1, step: 0.01 },
  { key: 'paletteStrength', label: 'palette', min: 0, max: 1, step: 0.05 },
  { key: 'teamStrength', label: 'team', min: 0, max: 1, step: 0.05 },
  { key: 'heightStrength', label: 'height', min: 0, max: 1, step: 0.05 },
] as const satisfies readonly {
  key: keyof ToonParams;
  label: string;
  min: number;
  max: number;
  step: number;
}[];

type SliderKey = (typeof SLIDERS)[number]['key'];

export interface CitadelToonDebug {
  rows: RowId[];
  models: ModelId[];
  /** Distinct toon materials in the scene (shared across instances). */
  materialCount(): number;
  /** Fraction of a row's meshes that use the toon material (originals: 0). */
  toonFraction(row: RowId): number;
  /** Frames rendered so far (tests wait on this instead of wall-clock time). */
  frames(): number;
  params(): ToonParams;
  setParam(key: SliderKey, value: number): void;
  setBands(bands: 2 | 3): void;
  view(mode: View): void;
  /** Linear distance fog (StandardMaterial fog runs after the toon colour). */
  setFog(on: boolean): void;
  /** Overrides one model's team mask (for picking atlas swatches). */
  setTeamMask(model: ModelId, rects: UvRect[]): void;
  thinInstances: number;
  /** Meshes registered as shadow casters. */
  casterCount: number;
  shadowsReceived(): boolean;
  /** The Babylon scene, for poking at things from the console. */
  scene: Scene;
}

declare global {
  interface Window {
    __citadelReady?: boolean;
    __citadelStats?: CitadelStats;
    __citadelSetTier?: (tier: QualityTier) => void;
    __citadelToon?: CitadelToonDebug;
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const labelsEl = document.getElementById('labels') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;

const { engine, backend } = await createEngine(canvas);
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#1B1A1FFF');

// Like the game camera, this one sits south (-Z) looking north, with the sun
// over its right shoulder; each model is turned to face the camera.
const VIEWS: Record<View, { beta: number; radius: number; target: Vector3 }> = {
  close: { beta: 1.12, radius: 13.5, target: new Vector3(0, 0.6, 0) },
  // ~55° pitch at mid zoom, like the game camera (docs/design/camera.md).
  moba: { beta: (35 * Math.PI) / 180, radius: 26, target: new Vector3(0, 0, 0) },
};
const camera = new ArcRotateCamera(
  'cam',
  -Math.PI / 2,
  VIEWS.close.beta,
  VIEWS.close.radius,
  VIEWS.close.target.clone(),
  scene,
);
camera.lowerRadiusLimit = 3;
camera.upperRadiusLimit = 60;
camera.wheelPrecision = 30;
camera.attachControl(true);

// Same rig as the boot scene (render/scene.ts).
new HemisphericLight('sky', new Vector3(0, 1, 0), scene).intensity = 0.6;
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.4), scene);
sun.intensity = 0.9;

const ground = MeshBuilder.CreateGround('ground', { width: 16, height: 11 }, scene);
const groundMat = new CitadelToonMaterial('toon:ground', scene, {
  params: { heightStrength: 0, rimIntensity: 0 },
});
groundMat.diffuseColor = Color3.FromHexString('#6F9A4E');
ground.material = groundMat;
registerShadowReceiver(ground);

// ---- models ----------------------------------------------------------------------
const ROWS: { id: RowId; z: number }[] = [
  { id: 'original', z: 3 },
  { id: 'warden', z: 0 },
  { id: 'hollow', z: -3 },
];
const SPACING = 2.4;

/**
 * Cascaded shadows draw every caster once per cascade (3× on High) and Babylon
 * does no per-cascade culling, while an unmerged KayKit hero is 8-10 meshes.
 * All 12 models casting would cost ~330 extra draws, so by default only the
 * Warden rogue and the thin-instanced markers cast; everything receives.
 * `?casters=all` makes every model cast, for a local look (over budget).
 * (Models load unmerged: with M1-13's `mergeMeshes` this layout renders the
 * models scrambled, originals included; see the PR notes.)
 */
const ALL_CASTERS = new URLSearchParams(location.search).get('casters') === 'all';
const casters: AbstractMesh[] = [];
function addCaster(mesh: AbstractMesh) {
  registerShadowCaster(mesh, false);
  casters.push(mesh);
}

const rows = new Map<RowId, LoadedModel[]>();
for (const row of ROWS) {
  const loaded = await Promise.all(MODEL_IDS.map((id) => loadModel(scene, MODEL_CONFIGS[id])));
  loaded.forEach((m, i) => {
    // Seen from -Z, screen-left is -X: keep the same order as /anim.html.
    const slot = new TransformNode(`slot:${row.id}:${m.config.id}`, scene);
    slot.position.set((i - (loaded.length - 1) / 2) * SPACING, 0, row.z);
    slot.rotation.y = Math.PI; // glTF characters face +Z; turn them toward the camera
    m.root.parent = slot;
    if (row.id !== 'original') {
      // Through the UnitLook seam UnitView uses, so the sandbox exercises it too.
      createToonUnitLook(m.meshes, scene).setTeam(row.id === 'warden' ? 'wardens' : 'hollow');
    }
    for (const mesh of m.meshes) {
      if (!mesh.isEnabled()) continue;
      if (ALL_CASTERS || (row.id === 'warden' && m.config.id === 'rogue_hooded')) addCaster(mesh);
      registerShadowReceiver(mesh);
    }
  });
  rows.set(row.id, loaded);
}

// Thin-instanced stone markers: untextured toon geometry, one draw call.
const marker = MeshBuilder.CreateCylinder(
  'markers',
  { height: 1.2, diameterTop: 0.35, diameterBottom: 0.55, tessellation: 6 },
  scene,
);
const markerMat = new CitadelToonMaterial('toon:markers', scene);
markerMat.diffuseColor = Color3.FromHexString('#CFC6B4');
marker.material = markerMat;
const MARKERS = 8;
const markerMatrices = new Float32Array(MARKERS * 16);
for (let i = 0; i < MARKERS; i++) {
  const x = -7 + (14 * i) / (MARKERS - 1);
  Matrix.Translation(x, 0.6, 5).copyToArray(markerMatrices, i * 16);
}
marker.thinInstanceSetBuffer('matrix', markerMatrices, 16, true);
addCaster(marker);

const quality = createQualityController(engine, scene, backend);
const hud = createPerfHud(overlay, (tier) => quality.setTier(tier));
window.__citadelSetTier = (tier) => quality.setTier(tier);

// ---- UI ----------------------------------------------------------------------------
function toonMaterials(): CitadelToonMaterial[] {
  return scene.materials.filter((m): m is CitadelToonMaterial => m instanceof CitadelToonMaterial);
}
/** Unit materials only: the ground and markers keep their own rim/height settings. */
function unitMaterials(): CitadelToonMaterial[] {
  return toonMaterials().filter((m) => m !== groundMat && m !== markerMat);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

const params: ToonParams = { ...DEFAULT_TOON_PARAMS };
const sliderInputs = new Map<SliderKey, { input: HTMLInputElement; value: HTMLSpanElement }>();

function setParam(key: SliderKey, value: number) {
  params[key] = value;
  const mats =
    key === 'paletteStrength' || key.endsWith('Threshold') || key === 'bandSoftness'
      ? toonMaterials()
      : unitMaterials();
  for (const m of mats) m.toon.params[key] = value;
  const ui = sliderInputs.get(key);
  if (ui) {
    ui.input.value = String(value);
    ui.value.textContent = value.toFixed(2);
  }
}

function setBands(bands: 2 | 3) {
  params.bands = bands;
  for (const m of toonMaterials()) m.toon.params.bands = bands;
  bandsBtn.textContent = `${bands} bands`;
}

const bandsBtn = el('button', '3 bands');
bandsBtn.onclick = () => setBands(params.bands === 3 ? 2 : 3);
panel.append(bandsBtn);

for (const s of SLIDERS) {
  const label = el('label', `${s.label} `);
  const input = el('input');
  Object.assign(input, {
    type: 'range',
    min: String(s.min),
    max: String(s.max),
    step: String(s.step),
  });
  input.value = String(params[s.key]);
  input.dataset.param = s.key;
  const value = el('span', params[s.key].toFixed(2));
  input.oninput = () => setParam(s.key, Number(input.value));
  label.append(input, value);
  panel.append(label);
  sliderInputs.set(s.key, { input, value });
}

const fogBtn = el('button', 'fog');
fogBtn.onclick = () => setFog(scene.fogMode === Scene.FOGMODE_NONE);
panel.append(fogBtn);
function setFog(on: boolean) {
  scene.fogMode = on ? Scene.FOGMODE_LINEAR : Scene.FOGMODE_NONE;
  scene.fogColor = Color3.FromHexString('#1B1A1F');
  scene.fogStart = 10;
  scene.fogEnd = 22;
  fogBtn.classList.toggle('on', on);
}

const viewBtns = new Map<View, HTMLButtonElement>();
for (const v of ['close', 'moba'] as const) {
  const b = el('button', v === 'moba' ? 'MOBA view' : 'close view');
  b.onclick = () => setView(v);
  viewBtns.set(v, b);
  panel.append(b);
}
function setView(v: View) {
  const cfg = VIEWS[v];
  camera.alpha = -Math.PI / 2;
  camera.beta = cfg.beta;
  camera.radius = cfg.radius;
  camera.target.copyFrom(cfg.target);
  for (const [k, b] of viewBtns) b.classList.toggle('on', k === v);
}
setView(new URLSearchParams(location.search).get('view') === 'moba' ? 'moba' : 'close');

// Row labels follow the left end of each row on screen.
const ROW_TEXT: Record<RowId, string> = {
  original: 'original',
  warden: 'Warden toon',
  hollow: 'Hollow toon',
};
const labelEls = new Map<RowId, HTMLDivElement>();
for (const row of ROWS) {
  const d = el('div', ROW_TEXT[row.id]);
  d.className = row.id;
  labelsEl.append(d);
  labelEls.set(row.id, d);
}
function updateLabels() {
  const w = engine.getRenderWidth();
  const h = engine.getRenderHeight();
  const viewport = camera.viewport.toGlobal(w, h);
  const scale = canvas.clientWidth / w;
  const transform = scene.getTransformMatrix();
  for (const row of ROWS) {
    const p = Vector3.Project(
      new Vector3(-((MODEL_IDS.length - 1) / 2) * SPACING - 1.1, 0.9, row.z),
      Matrix.IdentityReadOnly,
      transform,
      viewport,
    );
    const d = labelEls.get(row.id)!;
    d.style.left = `${p.x * scale}px`;
    d.style.top = `${p.y * scale}px`;
  }
}

// ---- debug hook + render loop -------------------------------------------------------
window.__citadelToon = {
  rows: ROWS.map((r) => r.id),
  models: MODEL_IDS,
  materialCount: () => toonMaterials().length,
  toonFraction: (row) => {
    const meshes = rows.get(row)!.flatMap((m) => m.meshes.filter((x) => x.material));
    return meshes.filter((x) => x.material instanceof CitadelToonMaterial).length / meshes.length;
  },
  frames: () => frames,
  params: () => ({ ...params }),
  setParam,
  setBands,
  view: setView,
  setFog,
  setTeamMask: (model, rects) => {
    for (const row of ['warden', 'hollow'] as const) {
      const m = rows.get(row)!.find((x) => x.config.id === model)!;
      for (const mesh of m.meshes) {
        if (mesh.material instanceof CitadelToonMaterial) mesh.material.toon.teamRects = rects;
      }
    }
  },
  thinInstances: marker.thinInstanceCount,
  casterCount: casters.length,
  shadowsReceived: () => ground.receiveShadows,
  scene,
};

await scene.whenReadyAsync();
let frames = 0;
readStats(engine, scene, backend, quality.tier); // attach instrumentation before the first frame
engine.runRenderLoop(() => {
  scene.render();
  frames++;
  if (frames % 6 === 0) updateLabels();
  if (frames % 15 === 0) {
    const stats = readStats(engine, scene, backend, quality.tier);
    window.__citadelStats = stats;
    hud.update(stats, [`toon mats ${toonMaterials().length}`]);
    if (frames >= 30) window.__citadelReady = true;
  }
});
window.addEventListener('resize', () => engine.resize());
