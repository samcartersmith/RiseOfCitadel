/**
 * Water sandbox (/water.html): the Citadel terrain with the M1-06 river water
 * in place of the terrain's placeholder ribbon. MOBA-camera presets at the
 * mid river crossing and a river bend, a long low view down the river, a
 * top-down of the whole map, the tier switch and a daylight slider that
 * drives the water's day/night colour hook (what M1-09 will call).
 *
 * URL: `?view=crossing|bend|long|top`, `?tier=`, `?engine=webgl`, `?daylight=0..1`.
 * Debug hook for tests: window.__citadelWater.
 */
import { Scene } from '@babylonjs/core/scene';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createEngine } from '../render/engine';
import { createQualityController } from '../render/tiers';
import { createPerfHud } from '../render/hud';
import { readStats, type CitadelStats } from '../render/stats';
import type { QualityTier } from '../render/quality';
import { createMobaCamera } from '../camera/mobaCamera';
import { createTerrain, MAP_TO_WORLD } from '../map/terrain';
import { createWater, waterLightingFor, type Flow, type WaterStats } from '../map/water';

type View = 'crossing' | 'bend' | 'long' | 'top';
const VIEWS: readonly View[] = ['crossing', 'bend', 'long', 'top'];

/** Map-unit focus points for the MOBA-camera presets. */
const FOCUS: Record<'crossing' | 'bend', { x: number; z: number }> = {
  // Mid lane crossing the river at the centre of the map.
  crossing: { x: 0, z: 0 },
  // The top-left river bend, between the Warden and Hollow jungles.
  bend: { x: -4200, z: 2300 },
};

export interface CitadelWaterDebug {
  view(v: View): void;
  currentView(): View;
  frames(): number;
  stats: WaterStats;
  /** True while the terrain's placeholder ribbon exists (it shouldn't here). */
  placeholder: boolean;
  /** Flow at a map point (map units in; speed in world units / s). */
  flowAt(x: number, z: number): Flow;
  /** Water depth at a map point, world units (≤ 0 = dry). */
  depthAt(x: number, z: number): number;
  /** Live mote count (0 on Low). */
  motes(): number;
  setTier(tier: QualityTier): void;
  setDaylight(d: number): void;
  setTime(seconds: number | null): void;
  scene: Scene;
}

declare global {
  interface Window {
    __citadelReady?: boolean;
    __citadelStats?: CitadelStats;
    __citadelSetTier?: (tier: QualityTier) => void;
    __citadelWater?: CitadelWaterDebug;
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const params = new URLSearchParams(location.search);

const { engine, backend } = await createEngine(canvas);
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#1B1A1FFF');

const S = MAP_TO_WORLD;
const half = 7400 * S;
const moba = createMobaCamera(scene, {
  bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
});

// Long view: low over the north-west reach of the river, looking down it to the centre.
const long = new TargetCamera('long-camera', new Vector3(-6600 * S, 26, 4300 * S), scene);
long.setTarget(new Vector3(-1500 * S, -2, 800 * S));
long.fov = 0.75;
long.minZ = 0.5;
long.maxZ = 600;

// Top-down orthographic camera over the whole map (as in the terrain sandbox).
const top = new TargetCamera('top-camera', new Vector3(0, 400, -0.05), scene);
top.setTarget(Vector3.Zero());
top.mode = Camera.ORTHOGRAPHIC_CAMERA;
top.minZ = 300;
top.maxZ = 1000;
const fitTop = () => {
  const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
  const h = 8000 * S * 1.03;
  top.orthoTop = h;
  top.orthoBottom = -h;
  top.orthoLeft = -h * aspect;
  top.orthoRight = h * aspect;
};
fitTop();

// Same rig as the boot scene (render/scene.ts); M1-09 replaces it.
const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
sky.intensity = 0.6;
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.4), scene);
sun.intensity = 0.9;

const quality = createQualityController(engine, scene, backend);
const terrain = await createTerrain(scene, { riverPlaceholder: false });
const water = createWater(scene, { sampler: terrain.sampler, tier: quality.tier });
const lodBias = (t: QualityTier) => (t === 'low' ? 0.6 : 1);
terrain.setLodBias(lodBias(quality.tier));
const setTier = (t: QualityTier) => {
  quality.setTier(t);
  terrain.setLodBias(lodBias(t));
  water.setTier(t);
};
window.__citadelSetTier = setTier;
const hud = createPerfHud(overlay, setTier);

/**
 * Stand-in for M1-09: dims the placeholder sun/sky and pushes the matching
 * water colours through the water's lighting hook.
 */
const DAY_SUN = Color3.White();
const NIGHT_SUN = Color3.FromHexString('#8C96D8');
let daylight = 1;
function setDaylight(d: number) {
  daylight = Math.max(0, Math.min(1, d));
  sun.intensity = 0.15 + 0.75 * daylight;
  sun.diffuse = Color3.Lerp(NIGHT_SUN, DAY_SUN, daylight);
  sky.intensity = 0.25 + 0.35 * daylight;
  water.setLighting(waterLightingFor(daylight));
  slider.value = String(daylight);
}

// ---- panel -----------------------------------------------------------------------
const viewBtns = new Map<View, HTMLButtonElement>();
for (const v of VIEWS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = v === 'top' ? 'top-down' : v;
  b.addEventListener('click', () => setView(v));
  panel.append(b);
  viewBtns.set(v, b);
}
const label = document.createElement('label');
label.textContent = 'daylight';
const slider = document.createElement('input');
slider.type = 'range';
slider.min = '0';
slider.max = '1';
slider.step = '0.01';
slider.addEventListener('input', () => setDaylight(Number(slider.value)));
label.append(slider);
panel.append(label);

let view: View = 'crossing';
function setView(v: View) {
  view = v;
  if (v === 'top') scene.activeCamera = top;
  else if (v === 'long') scene.activeCamera = long;
  else {
    scene.activeCamera = moba.camera;
    const f = FOCUS[v];
    moba.focusOn({ x: f.x * S, z: f.z * S }, { instant: true });
  }
  for (const [k, b] of viewBtns) b.classList.toggle('on', k === v);
}

const startView = params.get('view');
setView(VIEWS.includes(startView as View) ? (startView as View) : 'crossing');
setDaylight(params.has('daylight') ? Number(params.get('daylight')) : 1);

// ---- debug hook + render loop -------------------------------------------------------
window.__citadelWater = {
  view: setView,
  currentView: () => view,
  frames: () => frames,
  stats: water.stats,
  placeholder: terrain.river !== null,
  flowAt: (x, z) => water.flowAt(x * S, z * S),
  depthAt: (x, z) => water.depthAt(x * S, z * S),
  motes: () => water.motes?.system.getActiveCount() ?? 0,
  setTier,
  setDaylight,
  setTime: (t) => water.setTime(t),
  scene,
};

await scene.whenReadyAsync();
let frames = 0;
readStats(engine, scene, backend, quality.tier); // attach instrumentation before the first frame
engine.runRenderLoop(() => {
  scene.render();
  frames++;
  if (frames % 15 === 0) {
    const stats = readStats(engine, scene, backend, quality.tier);
    window.__citadelStats = stats;
    hud.update(stats, [
      `view    ${view}`,
      `water   ${water.stats.chunks} chunks, ${Math.round(water.stats.triangles / 1000)}k tris`,
      `motes   ${water.motes?.system.getActiveCount() ?? 0}/${water.stats.motes}`,
      `day     ${daylight.toFixed(2)}`,
    ]);
    if (frames >= 30) window.__citadelReady = true;
  }
});
window.addEventListener('resize', () => {
  engine.resize();
  fitTop();
});
