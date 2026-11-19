/**
 * Lighting sandbox (/lighting.html): the full Citadel terrain and river
 * water, every structure, a few lane creeps and Bulwark under the M1-09 day/night rig.
 * The dev panel has the day↔night slider, phase presets, an auto-cycle
 * toggle and view presets; the perf HUD has the tier switch.
 *
 * URL: `?t=0..1` (start time), `?view=mid|wardens|hollow|horizon`, `?cycle=<s per day>`,
 * `?tier=`, `?engine=webgl`, `?hud=0`.
 * Debug hooks: window.__citadelLighting (setT/getT plus sandbox extras),
 * window.__citadelReady, window.__citadelStats.
 */
import { Scene } from '@babylonjs/core/scene';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { MapSpec } from '@citadel/content';
import citadelJson from '../../../../packages/content/data/map/citadel.json';
import { createEngine } from '../render/engine';
import { createQualityController } from '../render/tiers';
import { createPerfHud } from '../render/hud';
import { readStats, type CitadelStats } from '../render/stats';
import type { QualityTier } from '../render/quality';
import { getShadowGenerator, registerShadowCaster } from '../render/shadows';
import {
  createLightingRig,
  nightEmitters,
  onLightingChange,
  PHASES,
  type CitadelLightingGlobal,
  type LightingPalette,
  type Phase,
} from '../render/lighting';
import { createMobaCamera } from '../camera/mobaCamera';
import { createTerrain, MAP_TO_WORLD } from '../map/terrain';
import { createStructureSet } from '../map/structures';
import { createWater, waterLightingFor } from '../map/water';
import { CreepViewManager, type CreepViewState } from '../units/creeps/creepViewManager';
import type { CreepModelId } from '../units/creeps/creepTypes';
import { loadBulwark } from '../heroes/bulwark/bulwark';

type View = 'mid' | 'wardens' | 'hollow' | 'horizon';
const VIEWS: readonly View[] = ['mid', 'wardens', 'hollow', 'horizon'];
/** World-unit MOBA focus points. */
const FOCUS: Record<Exclude<View, 'horizon'>, { x: number; z: number }> = {
  mid: { x: -6, z: -6 }, // the mid-lane river crossing: both banks, the creeps and Bulwark
  wardens: { x: -168, z: -172 }, // Hearthstone and the Warden base
  hollow: { x: 172, z: 166 }, // Hollow Crown and the Hollow base (cliffs face the camera)
};

export interface CitadelLightingDebug extends CitadelLightingGlobal {
  palette(): LightingPalette;
  setPhase(p: Phase): void;
  setCycle(secondsPerDay: number): void;
  view(v: View): void;
  currentView(): View;
  frames(): number;
  /** Compiled shader programs (engine-wide) and materials: must not change while scrubbing. */
  effectCount(): number;
  materialCount(): number;
  /** uniqueId of the cascaded shadow generator and its map (null below High). */
  shadowIds(): { generator: string; map: number } | null;
  emitters(): { name: string; strength: number; scale: number }[];
  /** Mean CPU cost of one setT (ms), measured over n calls; restores t. */
  benchSetT(n: number): number;
  env(): { ready: boolean; bytes: number; cloudsBytes: number };
  setTier(tier: QualityTier): void;
  scene: Scene;
}

declare global {
  interface Window {
    __citadelReady?: boolean;
    __citadelStats?: CitadelStats;
    __citadelSetTier?: (tier: QualityTier) => void;
    __citadelLightingDebug?: CitadelLightingDebug;
  }
}

// Room for every module request in dev, so the sky files' byte counts stay in resource timing.
performance.setResourceTimingBufferSize(4000);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const params = new URLSearchParams(location.search);
const map = citadelJson as unknown as MapSpec;

const { engine, backend } = await createEngine(canvas);
const scene = new Scene(engine);

const S = MAP_TO_WORLD;
const half = 7400 * S;
const moba = createMobaCamera(scene, {
  bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
});
// A low "horizon" camera over the Warden jungle toward the centre: shows the sky dome and
// the whole lit map at a glance (the MOBA camera never sees the horizon).
const horizon = new TargetCamera('horizon-camera', new Vector3(-250, 70, -300), scene);
horizon.setTarget(new Vector3(30, 0, 20));
horizon.fov = 0.9;
horizon.minZ = 1;
horizon.maxZ = 1200;

// The rig goes first: it owns the `sun` the shadow generator keys off.
const startT = params.has('t') ? Number(params.get('t')) : PHASES.noon;
const rig = createLightingRig(scene, { t: Number.isFinite(startT) ? startT : PHASES.noon });

const quality = createQualityController(engine, scene, backend);
const terrain = await createTerrain(scene, { riverPlaceholder: false });
// M1-06 water: sun/ambient come from the scene lights; its own day/night colours follow the rig.
const water = createWater(scene, { sampler: terrain.sampler, tier: quality.tier });
onLightingChange(scene, (p) => water.setLighting(waterLightingFor(1 - p.night)));
const lodBias = (t: QualityTier) => (t === 'low' ? 0.6 : 1);
terrain.setLodBias(lodBias(quality.tier));
const structures = await createStructureSet(scene, map.structures, {
  heightAt: terrain.sampler.heightAt,
});

// ---- units: a small mid-lane skirmish at the river crossing ------------------------------
const DISPLAY_SCALE = 2.5; // units.md §7
const creeps = new CreepViewManager(scene, { displayScale: DISPLAY_SCALE });
const lane = (x: number, z: number, modelId: CreepModelId, id: number): CreepViewState => ({
  id,
  modelId,
  team: modelId.startsWith('warden') ? 'wardens' : 'hollow',
  position: { x, z },
  facing: modelId.startsWith('warden') ? Math.PI / 4 : (Math.PI * 5) / 4,
  animState: 'idle',
  attackSpeedScale: 1,
  hp: 550,
  maxHp: 550,
  isHero: false,
  selected: false,
  hovered: false,
  visible: true,
  snap: true,
});
const creepStates: CreepViewState[] = [
  lane(-24, -18, 'warden_melee', 1),
  lane(-19, -23, 'warden_melee', 2),
  lane(-28, -27, 'warden_ranged', 3),
  lane(12, 17, 'hollow_melee', 4),
  lane(17, 12, 'hollow_melee', 5),
  lane(21, 22, 'hollow_ranged', 6),
];
await creeps.preload([...new Set(creepStates.map((c) => c.modelId))]);

const bulwark = await loadBulwark(scene, { team: 'wardens' });
const holder = new TransformNode('bulwark-holder', scene);
bulwark.root.parent = holder;
holder.scaling.setAll(DISPLAY_SCALE);
holder.position.set(-14, terrain.sampler.heightAt(-14, -10), -10);
holder.rotation.y = Math.PI / 4 + Math.PI; // faces up-lane, three-quarter to the camera
bulwark.animator.play('idle');
for (const m of bulwark.meshes) if (m.isEnabled()) registerShadowCaster(m, false);

const setTier = (t: QualityTier) => {
  quality.setTier(t);
  terrain.setLodBias(lodBias(t));
  water.setTier(t);
};
window.__citadelSetTier = setTier;
const hud = createPerfHud(overlay, setTier);

// ---- dev panel -----------------------------------------------------------------------------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}
const timeLabel = el('label', 'time ');
const slider = el('input');
slider.id = 'time';
slider.type = 'range';
slider.min = '0';
slider.max = '1';
slider.step = '0.001';
const clock = el('span');
clock.className = 'clock';
timeLabel.append(slider, clock);
panel.append(timeLabel);
/** t → a 24 h clock (dawn 06:00, noon 12:00, dusk 18:00, midnight 00:00). */
const clockText = (t: number) => {
  const mins = Math.round(((t * 24 + 6) % 24) * 60) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};
const syncPanel = () => {
  const t = rig.getT();
  if (document.activeElement !== slider) slider.value = String(t);
  clock.textContent = clockText(t);
};
slider.addEventListener('input', () => {
  setCycle(0);
  rig.setT(Number(slider.value));
  syncPanel();
});

for (const phase of Object.keys(PHASES) as Phase[]) {
  const b = el('button', phase);
  b.type = 'button';
  b.addEventListener('click', () => setPhase(phase));
  panel.append(b);
}
const cycleBtn = el('button', 'auto-cycle');
cycleBtn.type = 'button';
const CYCLE_SECONDS = 120;
cycleBtn.addEventListener('click', () => setCycle(rig.cycleSeconds() > 0 ? 0 : CYCLE_SECONDS));
panel.append(cycleBtn);

const viewBtns = new Map<View, HTMLButtonElement>();
for (const v of VIEWS) {
  const b = el('button', v);
  b.type = 'button';
  b.addEventListener('click', () => setView(v));
  panel.append(b);
  viewBtns.set(v, b);
}

function setPhase(p: Phase) {
  setCycle(0);
  rig.setT(PHASES[p]);
  syncPanel();
}
function setCycle(s: number) {
  rig.setCycle(s);
  cycleBtn.classList.toggle('on', s > 0);
}
let view: View = 'mid';
function setView(v: View) {
  view = v;
  if (v === 'horizon') {
    scene.activeCamera = horizon;
  } else {
    scene.activeCamera = moba.camera;
    moba.focusOn(FOCUS[v], { instant: true });
  }
  for (const [k, b] of viewBtns) b.classList.toggle('on', k === v);
}
const startView = params.get('view') as View;
setView(VIEWS.includes(startView) ? startView : 'mid');
if (params.has('cycle')) setCycle(Number(params.get('cycle')) || 0);
syncPanel();

// ---- debug hook ------------------------------------------------------------------------------
let envReady = false;
let envBytes = 0;
void rig.environment.then((env) => {
  envReady = true;
  envBytes = env?.bytes ?? 0;
});
const resourceBytes = (suffix: string) => {
  const e = performance.getEntriesByType('resource').find((r) => r.name.endsWith(suffix)) as
    PerformanceResourceTiming | undefined;
  return e ? e.encodedBodySize || e.transferSize : 0;
};
const compiledEffects = () =>
  Object.keys((engine as unknown as { _compiledEffects: Record<string, unknown> })._compiledEffects)
    .length;

const debug: CitadelLightingDebug = {
  setT: (t) => {
    setCycle(0);
    rig.setT(t);
    syncPanel();
  },
  getT: () => rig.getT(),
  palette: () => rig.palette(),
  setPhase,
  setCycle,
  view: setView,
  currentView: () => view,
  frames: () => frames,
  effectCount: compiledEffects,
  materialCount: () => scene.materials.length,
  shadowIds: () => {
    const g = getShadowGenerator(scene);
    const m = g?.getShadowMap();
    return g && m ? { generator: g.id, map: m.uniqueId } : null;
  },
  emitters: () => nightEmitters(scene),
  benchSetT: (n) => {
    const t0 = rig.getT();
    const start = performance.now();
    for (let i = 0; i < n; i++) rig.setT(i / n);
    const ms = (performance.now() - start) / n;
    rig.setT(t0);
    return ms;
  },
  env: () => ({ ready: envReady, bytes: envBytes, cloudsBytes: resourceBytes('sky-clouds.jpg') }),
  setTier,
  scene,
};
window.__citadelLighting = debug;
window.__citadelLightingDebug = debug;

// ---- render loop -----------------------------------------------------------------------------
await scene.whenReadyAsync();
let frames = 0;
readStats(engine, scene, backend, quality.tier); // attach instrumentation before the first frame
engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  creeps.sync(creepStates, dt);
  for (const c of creepStates) c.snap = false;
  scene.render();
  frames++;
  if (rig.cycleSeconds() > 0 && frames % 4 === 0) syncPanel();
  if (frames % 15 === 0) {
    const stats = readStats(engine, scene, backend, quality.tier);
    window.__citadelStats = stats;
    const p = rig.palette();
    hud.update(stats, [
      `view    ${view}`,
      `time    ${clockText(p.t)} (t ${p.t.toFixed(3)})`,
      `sun     el ${p.sunElevation.toFixed(0)}° × ${p.sunIntensity.toFixed(2)}`,
      `env     ${envReady ? `${Math.round(envBytes / 1024)} KB` : 'loading'}`,
      `structs ${structures.instances.length} inst`,
    ]);
    if (frames >= 30 && creeps.counts.loaded === creepStates.length) window.__citadelReady = true;
  }
});
window.addEventListener('resize', () => engine.resize());
