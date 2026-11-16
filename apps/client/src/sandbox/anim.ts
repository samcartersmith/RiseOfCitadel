/**
 * Animation sandbox (/anim.html): the four base models side by side, with
 * buttons and hotkeys for every logical state and a blend-time slider.
 *
 * Keys: 1-9, 0, - play a state · ←/→ (or Tab) select a model · A toggles "all models".
 * Debug hook for tests: window.__citadelAnim.
 */
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createEngine } from '../render/engine';
import { LOGICAL_STATES, type LogicalState } from '../units/states';
import { MODEL_CONFIGS, MODEL_IDS, type ModelId } from '../units/modelConfig';
import { loadModel, type LoadedModel } from '../units/loadModel';

export interface CitadelAnimDebug {
  models: ModelId[];
  states: readonly LogicalState[];
  play(model: ModelId, state: LogicalState, speed?: number): boolean;
  state(model: ModelId): LogicalState | null;
  clip(model: ModelId): string | null;
  weights(model: ModelId): { clip: string; state: LogicalState; weight: number }[];
  duration(model: ModelId, state: LogicalState): number;
  setBlend(seconds: number): void;
  /** How many times each model's attack1 "attack point" event (t = 0.5) has fired. */
  attackPoints: Record<ModelId, number>;
}

declare global {
  interface Window {
    __citadelReady?: boolean;
    __citadelAnim?: CitadelAnimDebug;
  }
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'];
const ATTACK_POINT = 0.5;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const labelsEl = document.getElementById('labels') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;

const { engine } = await createEngine(canvas);
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#1B1A1FFF');

// glTF characters face +Z, so the camera sits on +Z looking back at them.
const camera = new ArcRotateCamera('cam', Math.PI / 2, 1.2, 9.5, new Vector3(0, 1.1, 0), scene);
camera.lowerRadiusLimit = 3;
camera.upperRadiusLimit = 30;
camera.wheelPrecision = 40;
camera.attachControl(true);

new HemisphericLight('sky', new Vector3(0, 1, 0), scene).intensity = 0.7;
const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.6), scene);
sun.intensity = 0.9;

const ground = MeshBuilder.CreateGround('ground', { width: 14, height: 6 }, scene);
const groundMat = new StandardMaterial('m-ground', scene);
groundMat.diffuseColor = Color3.FromHexString('#6F9A4E');
groundMat.specularColor = Color3.Black();
ground.material = groundMat;

const SPACING = 2.4;
const loaded = await Promise.all(MODEL_IDS.map((id) => loadModel(scene, MODEL_CONFIGS[id])));
const models = new Map<ModelId, LoadedModel>();
const attackPoints = Object.fromEntries(MODEL_IDS.map((id) => [id, 0])) as Record<ModelId, number>;
const flashUntil = new Map<ModelId, number>();

loaded.forEach((m, i) => {
  const id = m.config.id;
  models.set(id, m);
  // Seen from +Z, screen-left is +X: lay them out so the order matches the labels.
  m.root.position.x = ((loaded.length - 1) / 2 - i) * SPACING;
  m.animator.onEvent('attack1', ATTACK_POINT, () => {
    attackPoints[id]++;
    flashUntil.set(id, performance.now() + 150);
  });
});

// ---- UI ----------------------------------------------------------------------
let selected: ModelId = 'knight';
let allModels = false;
let blendTime = 0.2;
let speed = 1;

const labelEls = new Map<ModelId, HTMLDivElement>();
for (const id of MODEL_IDS) {
  const div = document.createElement('div');
  labelsEl.append(div);
  labelEls.set(id, div);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

const modelButtons = new Map<ModelId, HTMLButtonElement>();
for (const id of MODEL_IDS) {
  const b = el('button', id);
  b.onclick = () => select(id);
  modelButtons.set(id, b);
  panel.append(b);
}
const allBtn = el('button', 'all (A)');
allBtn.onclick = () => {
  allModels = !allModels;
  refreshButtons();
};
panel.append(allBtn, el('span', '|'));

LOGICAL_STATES.forEach((state, i) => {
  const b = el('button', `${state} (${KEYS[i]})`);
  b.dataset.state = state;
  b.onclick = () => trigger(state);
  panel.append(b);
});

const blendLabel = el('label', 'blend ');
const blendInput = el('input');
Object.assign(blendInput, { type: 'range', min: '0', max: '1', step: '0.05', value: '0.2' });
const blendValue = el('span', '0.20s');
blendInput.oninput = () => setBlend(Number(blendInput.value));
blendLabel.append(blendInput, blendValue);

const speedLabel = el('label', 'speed ');
const speedInput = el('input');
Object.assign(speedInput, { type: 'range', min: '0.25', max: '3', step: '0.25', value: '1' });
const speedValue = el('span', '1.00x');
speedInput.oninput = () => {
  speed = Number(speedInput.value);
  speedValue.textContent = `${speed.toFixed(2)}x`;
};
speedLabel.append(speedInput, speedValue);
panel.append(blendLabel, speedLabel);

function setBlend(seconds: number) {
  blendTime = seconds;
  for (const m of models.values()) m.animator.blendTime = seconds;
  blendInput.value = String(seconds);
  blendValue.textContent = `${seconds.toFixed(2)}s`;
}

function select(id: ModelId) {
  selected = id;
  refreshButtons();
}

function refreshButtons() {
  for (const [id, b] of modelButtons) b.classList.toggle('on', id === selected && !allModels);
  allBtn.classList.toggle('on', allModels);
}

function trigger(state: LogicalState) {
  const targets = allModels ? MODEL_IDS : [selected];
  for (const id of targets) models.get(id)!.animator.play(state, { speed, blend: blendTime });
}

window.addEventListener('keydown', (e) => {
  const i = KEYS.indexOf(e.key);
  if (i >= 0 && LOGICAL_STATES[i]) trigger(LOGICAL_STATES[i]);
  else if (e.key === 'ArrowRight' || e.key === 'Tab' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    const n = MODEL_IDS.length;
    select(MODEL_IDS[(MODEL_IDS.indexOf(selected) + dir + n) % n]!);
  } else if (e.key === 'a' || e.key === 'A') {
    allModels = !allModels;
    refreshButtons();
  }
});
refreshButtons();

function updateLabels() {
  const now = performance.now();
  for (const [id, m] of models) {
    const div = labelEls.get(id)!;
    const a = m.animator;
    div.textContent = `${id}\n${a.state ?? '-'} → ${a.activeClip ?? '-'}\n${(a.progress * 100).toFixed(0).padStart(3)}%  hits ${attackPoints[id]}`;
    div.classList.toggle('sel', allModels || id === selected);
    div.classList.toggle('flash', (flashUntil.get(id) ?? 0) > now);
  }
}

// ---- debug hook + render loop ----------------------------------------------------
const get = (id: ModelId) => {
  const m = models.get(id);
  if (!m) throw new Error(`unknown model ${id}`);
  return m.animator;
};
window.__citadelAnim = {
  models: MODEL_IDS,
  states: LOGICAL_STATES,
  play: (id, state, s = 1) => get(id).play(state, { speed: s, blend: blendTime }),
  state: (id) => get(id).state,
  clip: (id) => get(id).activeClip,
  weights: (id) => get(id).debugWeights(),
  duration: (id, state) => get(id).durationOf(state),
  setBlend,
  attackPoints,
};

let frames = 0;
engine.runRenderLoop(() => {
  scene.render();
  frames++;
  if (frames % 6 === 0) updateLabels();
  if (frames === 30) window.__citadelReady = true;
});
window.addEventListener('resize', () => engine.resize());
