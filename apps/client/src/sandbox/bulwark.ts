/**
 * Bulwark sandbox (/bulwark.html): the M1-11 hero next to a stock KayKit
 * Knight, with buttons for every logical state, team and silhouette toggles,
 * and a MOBA-camera view (default zoom) for the silhouette check.
 *
 * Query: ?view=close|moba  ?team=wardens|hollow  ?silhouette=1  ?merge=0  ?engine=webgl
 * Keys: 1-9, 0, - play a state on Bulwark · B plays on both · S silhouette · V view · T team.
 * Debug hook for tests: window.__citadelBulwark.
 */
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { createEngine } from '../render/engine';
import { cameraPose, DEFAULT_CAMERA_CONFIG, initialState } from '../camera/rig';
import { LOGICAL_STATES, type LogicalState } from '../units/states';
import { MODEL_CONFIGS } from '../units/modelConfig';
import { loadModel, type LoadedModel } from '../units/loadModel';
import type { Team } from '../units/unitState';
import { loadBulwark, type BulwarkModel } from '../heroes/bulwark/bulwark';
import { mergeSkinnedParts } from '../units/mergeModel';
import { BULWARK_TEAM_MASK } from '../heroes/bulwark/material';
import { applyCitadelToon } from '../render/shaders/applyCitadelToon';
import { inTeamMask, teamMaskFor, type UvRect } from '../render/shaders/teamMask';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Material } from '@babylonjs/core/Materials/material';

type Who = 'bulwark' | 'knight';
type View = 'close' | 'moba';
interface RenderStats {
  triangles: number;
  drawCalls: number;
  meshes: number;
}

export interface CitadelBulwarkDebug {
  states: readonly LogicalState[];
  play(state: LogicalState, who?: Who | 'both', speed?: number): boolean;
  state(who?: Who): LogicalState | null;
  clip(who?: Who): string | null;
  duration(state: LogicalState, who?: Who): number;
  progress(who?: Who): number;
  /** Per-instance counts (enabled meshes only). */
  stats(): Record<Who, RenderStats>;
  /** Scene-wide counters from the last frame (SceneInstrumentation). */
  sceneStats(): { drawCalls: number; activeMeshes: number; triangles: number };
  setTeam(team: Team): void;
  setSilhouette(on: boolean): void;
  setView(view: View): void;
  /** Hide the knight and the ground so scene counters measure Bulwark alone. */
  setSolo(on: boolean): void;
  /** Share of each model's visible pixels inside its toon team mask (current view and pose). */
  teamCoverage(): Promise<Record<Who, number>>;
  /** Screen-space box (CSS px) around both models, for screenshot clips. */
  screenRect(): { x: number; y: number; width: number; height: number };
  frames(): number;
  /** The Babylon scene, for poking at things from the console. */
  scene: Scene;
}

declare global {
  interface Window {
    __citadelReady?: boolean;
    __citadelBulwark?: CitadelBulwarkDebug;
  }
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'];
/** Same convention as /units.html: heroes drawn 2.5× so they read at the MOBA camera's default distance. */
const MOBA_SCALE = 2.5;
const params = new URLSearchParams(location.search);

const canvas = document.getElementById('game') as HTMLCanvasElement;
const labelsEl = document.getElementById('labels') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;

const { engine } = await createEngine(canvas);
const scene = new Scene(engine);
const BG = Color4.FromHexString('#1B1A1FFF');
scene.clearColor = BG;
const instrumentation = new SceneInstrumentation(scene);
instrumentation.captureRenderTime = false;

// Close-up orbit camera (front view: glTF characters face +Z).
const orbit = new ArcRotateCamera(
  'orbit',
  Math.PI / 2 - 0.35,
  1.2,
  7.5,
  new Vector3(0, 1.1, 0),
  scene,
);
orbit.lowerRadiusLimit = 2.5;
orbit.upperRadiusLimit = 30;
orbit.wheelPrecision = 40;
orbit.minZ = 0.1;
orbit.attachControl(true);

// MOBA camera at its default pose (M1-03 rig), static: no edge pan to drift the silhouette shot.
const moba = new TargetCamera('moba', Vector3.Zero(), scene);
{
  const pose = cameraPose(initialState(DEFAULT_CAMERA_CONFIG), DEFAULT_CAMERA_CONFIG);
  moba.fov = DEFAULT_CAMERA_CONFIG.fov;
  moba.minZ = 0.5;
  moba.maxZ = 600;
  moba.position.set(...pose.position);
  moba.setTarget(new Vector3(...pose.target));
}

new HemisphericLight('sky', new Vector3(0, 1, 0), scene).intensity = 0.75;
const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.6), scene);
sun.intensity = 0.9;

const ground = MeshBuilder.CreateGround('ground', { width: 40, height: 40 }, scene);
const groundMat = new StandardMaterial('m-ground', scene);
groundMat.diffuseColor = Color3.FromHexString('#5E7F45');
groundMat.specularColor = Color3.Black();
ground.material = groundMat;

const [bulwark, knight] = await Promise.all([
  loadBulwark(scene, {
    team: params.get('team') === 'hollow' ? 'hollow' : 'wardens',
    merge: params.get('merge') !== '0',
  }),
  loadModel(scene, MODEL_CONFIGS.knight),
]);
// The stock knight goes through the same merge fix-ups (heroes/bulwark/merge.ts) for a fair comparison.
if (params.get('merge') !== '0')
  knight.meshes = mergeSkinnedParts(knight.root, knight.meshes, 'knight');
const knightToon = (t: Team) =>
  applyCitadelToon(knight.root, {
    team: t === 'neutral' ? null : t === 'wardens' ? 'warden' : 'hollow',
    teamMask: teamMaskFor('knight'),
  });
const knightSource = knight.meshes.find((m) => m.material)?.material ?? null;
knightToon(params.get('team') === 'hollow' ? 'hollow' : 'wardens');
const models: Record<Who, LoadedModel> = { bulwark, knight };
const holders = {} as Record<Who, TransformNode>;
for (const who of ['bulwark', 'knight'] as const) {
  const h = new TransformNode(`holder-${who}`, scene);
  models[who].root.parent = h;
  holders[who] = h;
}

// ---- view, silhouette, team ------------------------------------------------------
let view: View = params.get('view') === 'moba' ? 'moba' : 'close';
let silhouette = false;
let solo = false;
let team: Team = params.get('team') === 'hollow' ? 'hollow' : 'wardens';

function layout() {
  const s = view === 'moba' ? MOBA_SCALE : 1;
  // Seen from the front, Bulwark on screen-left. Both turned a little so the shield face shows.
  const gap = 1.35 * s;
  holders.bulwark.position.set(view === 'moba' ? -gap : gap, 0, 0);
  holders.knight.position.set(view === 'moba' ? gap : -gap, 0, 0);
  // The MOBA camera looks toward +Z, so face the models back at it (yaw π).
  const yaw = view === 'moba' ? Math.PI : 0;
  holders.bulwark.rotation.y = yaw + 0.35;
  holders.knight.rotation.y = yaw + 0.35;
  for (const h of Object.values(holders)) h.scaling.setAll(s);
  scene.activeCamera = view === 'moba' ? moba : orbit;
  if (view === 'moba') orbit.detachControl();
  else orbit.attachControl(true);
}

const black = new StandardMaterial('m-silhouette', scene);
black.disableLighting = true;
black.diffuseColor = Color3.Black();
black.emissiveColor = Color3.Black();
black.specularColor = Color3.Black();
black.backFaceCulling = false;
const savedMaterials = new Map<AbstractMesh, Material | null>();

function characterMeshes(): AbstractMesh[] {
  return [...bulwark.meshes, ...knight.meshes].filter((m) => m.isEnabled() && !m.isDisposed());
}

function setSilhouette(on: boolean) {
  if (on === silhouette) return;
  silhouette = on;
  if (on) {
    for (const m of characterMeshes()) {
      savedMaterials.set(m, m.material);
      m.material = black;
      m.renderOutline = false;
    }
  } else {
    for (const [m, mat] of savedMaterials) m.material = mat;
    savedMaterials.clear();
  }
  scene.clearColor = on ? new Color4(1, 1, 1, 1) : BG;
  ground.setEnabled(!on && !solo);
  refresh();
}

function setTeam(t: Team) {
  team = t;
  const wasSilhouette = silhouette;
  setSilhouette(false);
  bulwark.setTeam(t);
  // Re-derive the knight's toon material from its original glTF material for the new team.
  for (const m of knight.meshes) if (m.material && knightSource) m.material = knightSource;
  knightToon(t);
  setSilhouette(wasSilhouette);
  refresh();
}

function setSolo(on: boolean) {
  solo = on;
  holders.knight.setEnabled(!on);
  ground.setEnabled(!on && !silhouette);
}

// ---- team-colour coverage ----------------------------------------------------------
// Renders each model with an unlit "mask" material (white = inside its toon team
// mask, dark grey = elsewhere) on a blue background and counts pixels: the share
// of the hero's visible surface that carries team colour (art direction §2.2: ≥ 20%).

function maskTextureFromRects(name: string, rects: readonly UvRect[]): RawTexture {
  const n = 64;
  const px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const on = inTeamMask((x + 0.5) / n, (y + 0.5) / n, rects);
      const o = (y * n + x) * 4;
      px[o] = px[o + 1] = px[o + 2] = on ? 255 : 40;
      px[o + 3] = 255;
    }
  const t = RawTexture.CreateRGBATexture(
    px,
    n,
    n,
    scene,
    false,
    false,
    Texture.NEAREST_SAMPLINGMODE,
  );
  t.name = name;
  return t;
}

function maskMaterial(name: string, rects: readonly UvRect[]): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveTexture = maskTextureFromRects(`${name}-tex`, rects);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.backFaceCulling = false;
  return m;
}
const maskMats: Record<Who, StandardMaterial> = {
  bulwark: maskMaterial('m-mask-bulwark', BULWARK_TEAM_MASK),
  knight: maskMaterial('m-mask-knight', teamMaskFor('knight')),
};

let frameWaiters: (() => void)[] = [];
const nextFrame = () => new Promise<void>((r) => frameWaiters.push(r));

async function teamCoverage(): Promise<Record<Who, number>> {
  const wasSilhouette = silhouette;
  setSilhouette(false);
  const saved = new Map<AbstractMesh, Material | null>();
  for (const who of ['bulwark', 'knight'] as const)
    for (const m of models[who].meshes)
      if (m.isEnabled() && m.material) {
        saved.set(m, m.material);
        m.material = maskMats[who];
        m.renderOutline = false;
      }
  scene.clearColor = new Color4(0, 0, 1, 1);
  ground.setEnabled(false);
  await nextFrame();
  await nextFrame();
  const w = engine.getRenderWidth();
  const h = engine.getRenderHeight();
  const px = (await engine.readPixels(0, 0, w, h)) as Uint8Array;
  for (const [m, mat] of saved) m.material = mat;
  scene.clearColor = BG;
  ground.setEnabled(!solo);
  setSilhouette(wasSilhouette);
  // Split the screen at the midpoint between the two models.
  const mid = Vector3.Project(
    holders.bulwark.position.add(holders.knight.position).scale(0.5),
    Matrix.IdentityReadOnly,
    scene.getTransformMatrix(),
    scene.activeCamera!.viewport.toGlobal(w, h),
  ).x;
  const count = { bulwark: [0, 0], knight: [0, 0] } as Record<Who, [number, number]>;
  const bulwarkLeft =
    Vector3.Project(
      holders.bulwark.position,
      Matrix.IdentityReadOnly,
      scene.getTransformMatrix(),
      scene.activeCamera!.viewport.toGlobal(w, h),
    ).x < mid;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const r = px[o]!;
      const b = px[o + 2]!;
      if (b > 200 && r < 60) continue; // background
      const who: Who = x < mid === bulwarkLeft ? 'bulwark' : 'knight';
      count[who][1]++;
      if (r > 150) count[who][0]++;
    }
  const frac = ([t, all]: [number, number]) => (all ? Math.round((t / all) * 1000) / 1000 : 0);
  return { bulwark: frac(count.bulwark), knight: frac(count.knight) };
}

// ---- UI ----------------------------------------------------------------------------
let both = false;
let frames = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

const labelEls: Record<Who, HTMLDivElement> = { bulwark: el('div'), knight: el('div') };
labelsEl.append(labelEls.bulwark, labelEls.knight);

function play(state: LogicalState, who: Who | 'both' = 'bulwark', speed = 1): boolean {
  const targets: Who[] = who === 'both' ? ['bulwark', 'knight'] : [who];
  let ok = true;
  for (const w of targets) ok = models[w].animator.play(state, { speed }) && ok;
  return ok;
}

const stateButtons: HTMLButtonElement[] = [];
LOGICAL_STATES.forEach((state, i) => {
  const b = el('button', `${state} (${KEYS[i]})`);
  b.dataset.state = state;
  b.onclick = () => play(state, both ? 'both' : 'bulwark');
  stateButtons.push(b);
  panel.append(b);
});
panel.append(el('span', '|'));
const bothBtn = el('button', 'both (B)');
bothBtn.onclick = () => {
  both = !both;
  refresh();
};
const teamBtn = el('button');
teamBtn.onclick = () => setTeam(team === 'wardens' ? 'hollow' : 'wardens');
const silBtn = el('button', 'silhouette (S)');
silBtn.onclick = () => setSilhouette(!silhouette);
const viewBtn = el('button');
viewBtn.onclick = () => {
  view = view === 'close' ? 'moba' : 'close';
  layout();
  refresh();
};
panel.append(bothBtn, teamBtn, silBtn, viewBtn);

function refresh() {
  bothBtn.classList.toggle('on', both);
  silBtn.classList.toggle('on', silhouette);
  teamBtn.textContent = `team: ${team} (T)`;
  viewBtn.textContent = `view: ${view} (V)`;
}

window.addEventListener('keydown', (e) => {
  const i = KEYS.indexOf(e.key);
  if (i >= 0 && LOGICAL_STATES[i]) play(LOGICAL_STATES[i], both ? 'both' : 'bulwark');
  else if (e.key === 'b' || e.key === 'B') bothBtn.click();
  else if (e.key === 's' || e.key === 'S') silBtn.click();
  else if (e.key === 't' || e.key === 'T') teamBtn.click();
  else if (e.key === 'v' || e.key === 'V') viewBtn.click();
});

function stats(): Record<Who, RenderStats> {
  const count = (meshes: AbstractMesh[]): RenderStats => {
    let triangles = 0;
    let drawCalls = 0;
    let n = 0;
    for (const m of meshes) {
      if (!m.isEnabled() || !m.isVisible || m.getTotalIndices() === 0) continue;
      n++;
      triangles += m.getTotalIndices() / 3;
      drawCalls += m.subMeshes?.length ?? 1;
    }
    return { triangles, drawCalls, meshes: n };
  };
  return { bulwark: (bulwark as BulwarkModel).renderStats(), knight: count(knight.meshes) };
}

function updateLabels() {
  const s = stats();
  for (const who of ['bulwark', 'knight'] as const) {
    const a = models[who].animator;
    labelEls[who].textContent =
      `${who === 'bulwark' ? 'Bulwark (M1-11)' : 'stock KayKit Knight'}\n` +
      `${a.state ?? '-'} → ${a.activeClip ?? '-'} ${(a.progress * 100).toFixed(0).padStart(3)}%\n` +
      `${s[who].triangles} tris · ${s[who].drawCalls} draw call(s)`;
  }
}

function screenRect() {
  const s = view === 'moba' ? MOBA_SCALE : 1;
  const cam = scene.activeCamera!;
  const w = engine.getRenderWidth();
  const h = engine.getRenderHeight();
  const vp = cam.viewport.toGlobal(w, h);
  const vpm = scene.getTransformMatrix();
  const ratio = canvas.clientWidth / w;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const hld of Object.values(holders)) {
    if (!hld.isEnabled()) continue;
    for (const dx of [-1.3, 1.3])
      for (const dy of [0, 2.7])
        for (const dz of [-1, 1]) {
          const p = Vector3.Project(
            hld.position.add(new Vector3(dx * s, dy * s, dz * s)),
            Matrix.IdentityReadOnly,
            vpm,
            vp,
          );
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
          y0 = Math.min(y0, p.y);
          y1 = Math.max(y1, p.y);
        }
  }
  const pad = 8;
  const x = Math.max(0, x0 * ratio - pad);
  const y = Math.max(0, y0 * ratio - pad);
  return {
    x,
    y,
    width: Math.min(canvas.clientWidth - x, (x1 - x0) * ratio + 2 * pad),
    height: Math.min(canvas.clientHeight - y, (y1 - y0) * ratio + 2 * pad),
  };
}

window.__citadelBulwark = {
  states: LOGICAL_STATES,
  play,
  state: (who = 'bulwark') => models[who].animator.state,
  clip: (who = 'bulwark') => models[who].animator.activeClip,
  duration: (state, who = 'bulwark') => models[who].animator.durationOf(state),
  progress: (who = 'bulwark') => models[who].animator.progress,
  stats,
  sceneStats: () => ({
    drawCalls: instrumentation.drawCallsCounter.current,
    activeMeshes: scene.getActiveMeshes().length,
    triangles: scene.getActiveIndices() / 3,
  }),
  setTeam,
  setSilhouette,
  setView: (v) => {
    view = v;
    layout();
    refresh();
  },
  setSolo,
  screenRect,
  teamCoverage,
  frames: () => frames,
  scene,
};

layout();
refresh();
if (params.get('silhouette') === '1') setSilhouette(true);

engine.runRenderLoop(() => {
  scene.render();
  frames++;
  const waiters = frameWaiters;
  frameWaiters = [];
  for (const w of waiters) w();
  if (frames % 6 === 0) updateLabels();
  if (frames === 30) window.__citadelReady = true;
});
window.addEventListener('resize', () => engine.resize());
