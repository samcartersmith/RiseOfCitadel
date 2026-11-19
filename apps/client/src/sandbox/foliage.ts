/**
 * Foliage sandbox (/foliage.html): the Citadel terrain with every tree
 * (M1-07) and the M1-06 river under the MOBA camera. View presets cover a lane edge, the dense
 * Warden jungle, the Hollow jungle, the river between both biomes and a
 * top-down of the whole map. A "chop" button hides random trees near the
 * camera through `setTreeVisible`, the M2 tree-destruction path.
 *
 * URL: `?view=lane|jungle|hollow|biomes|top`, `?tier=`, `?engine=webgl`, `?hud=0`.
 * Debug hook for tests: window.__citadelFoliage.
 */
import { Scene } from '@babylonjs/core/scene';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createEngine } from '../render/engine';
import { createQualityController } from '../render/tiers';
import { createPerfHud } from '../render/hud';
import { readStats, type CitadelStats } from '../render/stats';
import type { QualityTier } from '../render/quality';
import { createMobaCamera } from '../camera/mobaCamera';
import { createTerrain, MAP_TO_WORLD } from '../map/terrain';
import { createFoliage, type FoliageStats } from '../map/foliage';
import { createWater } from '../map/water';
import { mulberry32 } from '../map/foliage/placement';

type View = 'lane' | 'jungle' | 'hollow' | 'biomes' | 'top';
const VIEWS: readonly View[] = ['lane', 'jungle', 'hollow', 'biomes', 'top'];

/** Map-unit focus points for the MOBA-camera presets. */
const FOCUS: Record<Exclude<View, 'top'>, { x: number; z: number }> = {
  // Warden safe lane (bottom) with the south-edge forest behind it.
  lane: { x: 2400, z: -6900 },
  // The densest MOBA view over the Warden primary jungle (found by scanning the scatter).
  jungle: { x: -1500, z: -5250 },
  // The densest view on the whole map: the Hollow primary jungle.
  hollow: { x: 1250, z: 4750 },
  // The river west of mid: Warden secondary jungle below, Hollow primary jungle above.
  biomes: { x: -2900, z: 1500 },
};

export interface CitadelFoliageDebug {
  view(v: View): void;
  currentView(): View;
  frames(): number;
  treeCount: number;
  hiddenCount(): number;
  /** Hides `n` random visible trees near the camera focus; returns their IDs. */
  chop(n: number): number[];
  /** Shows every chopped tree again. */
  regrow(): void;
  setTreeVisible(id: number, visible: boolean): void;
  isTreeVisible(id: number): boolean;
  /** Trees per species / biome. */
  census(): { species: Record<string, number>; biome: [number, number] };
  stats(): FoliageStats;
  setTier(tier: QualityTier): void;
  scene: Scene;
}

declare global {
  interface Window {
    __citadelReady?: boolean;
    __citadelStats?: CitadelStats;
    __citadelSetTier?: (tier: QualityTier) => void;
    __citadelFoliage?: CitadelFoliageDebug;
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

const top = new TargetCamera('top-camera', new Vector3(0, 400, -0.05), scene);
top.setTarget(Vector3.Zero());
top.mode = Camera.ORTHOGRAPHIC_CAMERA;
top.minZ = 300;
top.maxZ = 1000;
const MAP_HALF = 8000 * S;
const fitTop = () => {
  const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
  const h = MAP_HALF * 1.03;
  top.orthoTop = h;
  top.orthoBottom = -h;
  top.orthoLeft = -h * aspect;
  top.orthoRight = h * aspect;
};
fitTop();

// Same rig as the boot scene (render/scene.ts); M1-09 replaces it.
new HemisphericLight('sky', new Vector3(0, 1, 0), scene).intensity = 0.6;
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.4), scene);
sun.intensity = 0.9;

const quality = createQualityController(engine, scene, backend);
const terrain = await createTerrain(scene, { riverPlaceholder: false });
const water = createWater(scene, { sampler: terrain.sampler, tier: quality.tier });
const foliage = await createFoliage(scene, { sampler: terrain.sampler, tier: quality.tier });
const lodBias = (t: QualityTier) => (t === 'low' ? 0.6 : 1);
terrain.setLodBias(lodBias(quality.tier));
const setTier = (t: QualityTier) => {
  quality.setTier(t);
  terrain.setLodBias(lodBias(t));
  foliage.setTier(t);
  water.setTier(t);
};
window.__citadelSetTier = setTier;
const hud = createPerfHud(overlay, setTier);

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
const chopBtn = document.createElement('button');
chopBtn.type = 'button';
chopBtn.textContent = 'chop 25 trees';
chopBtn.addEventListener('click', () => chop(25));
const regrowBtn = document.createElement('button');
regrowBtn.type = 'button';
regrowBtn.textContent = 'regrow';
regrowBtn.addEventListener('click', () => regrow());
const windLabel = document.createElement('label');
windLabel.textContent = 'wind ';
const windInput = document.createElement('input');
windInput.type = 'range';
windInput.min = '0';
windInput.max = '3';
windInput.step = '0.1';
windInput.value = '1';
windInput.addEventListener('input', () => (foliage.wind.strength = Number(windInput.value)));
windLabel.append(windInput);
panel.append(chopBtn, regrowBtn, windLabel);

let view: View = 'jungle';
let focus = FOCUS.jungle;
function setView(v: View) {
  view = v;
  if (v === 'top') {
    scene.activeCamera = top;
  } else {
    scene.activeCamera = moba.camera;
    focus = FOCUS[v];
    moba.focusOn({ x: focus.x * S, z: focus.z * S }, { instant: true });
  }
  for (const [k, b] of viewBtns) b.classList.toggle('on', k === v);
}

// ---- chopping (exercises setTreeVisible) ---------------------------------------------
const chopped: number[] = [];
const rand = mulberry32(1234);
function chop(n: number): number[] {
  const st = moba.getState().focus;
  const near = foliage.trees.filter(
    (t) =>
      foliage.isTreeVisible(t.id) &&
      Math.abs(t.x - st.x) < 45 &&
      t.z - st.z > -20 &&
      t.z - st.z < 40,
  );
  const pool = near.length >= n ? near : foliage.trees.filter((t) => foliage.isTreeVisible(t.id));
  const out: number[] = [];
  while (out.length < n && pool.length) {
    const [t] = pool.splice(Math.floor(rand() * pool.length), 1);
    foliage.setTreeVisible(t!.id, false);
    out.push(t!.id);
  }
  chopped.push(...out);
  return out;
}
function regrow() {
  for (const id of chopped.splice(0)) foliage.setTreeVisible(id, true);
}

const startView = params.get('view');
setView(VIEWS.includes(startView as View) ? (startView as View) : 'jungle');

window.__citadelFoliage = {
  view: setView,
  currentView: () => view,
  frames: () => frames,
  treeCount: foliage.treeCount,
  hiddenCount: () => foliage.hiddenCount,
  chop,
  regrow,
  setTreeVisible: foliage.setTreeVisible,
  isTreeVisible: foliage.isTreeVisible,
  census: () => {
    const species: Record<string, number> = {};
    const biome: [number, number] = [0, 0];
    for (const t of foliage.trees) {
      species[t.species] = (species[t.species] ?? 0) + 1;
      biome[t.biome]++;
    }
    return { species, biome };
  },
  stats: () => foliage.stats,
  setTier,
  scene,
};

await scene.whenReadyAsync();
let frames = 0;
readStats(engine, scene, backend, quality.tier);
engine.runRenderLoop(() => {
  scene.render();
  frames++;
  if (frames % 15 === 0) {
    const stats = readStats(engine, scene, backend, quality.tier);
    window.__citadelStats = stats;
    const f = foliage.stats;
    hud.update(stats, [
      `view    ${view}`,
      `trees   ${f.trees} (${f.hidden} hidden)`,
      `cells   ${f.nearCells} near, grass ${f.grassCells}`,
      `models  ${Math.round(f.downloadBytes / 1024)} KB`,
    ]);
    // Ready on the first stats sample: CI renders High at about 1 fps.
    window.__citadelReady = true;
  }
});
window.addEventListener('resize', () => {
  engine.resize();
  fitTop();
});
