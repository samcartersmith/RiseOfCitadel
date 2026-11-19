/**
 * Terrain sandbox (/terrain.html): the full Citadel terrain under the MOBA
 * camera, with view presets (lane, river crossing, base, top-down of the
 * whole map), the tier switch and an overlay of the map diagram
 * (docs/design/map-citadel.svg) in top-down view to check alignment.
 *
 * URL: `?view=lane|river|base|top`, `?tier=`, `?engine=webgl`, `?overlay=1`.
 * Debug hook for tests: window.__citadelTerrain.
 */
import { Scene } from '@babylonjs/core/scene';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Culling/ray';
import { createEngine } from '../render/engine';
import { createQualityController } from '../render/tiers';
import { createPerfHud } from '../render/hud';
import { readStats, type CitadelStats } from '../render/stats';
import type { QualityTier } from '../render/quality';
import { createMobaCamera } from '../camera/mobaCamera';
import { createTerrain, MAP_TO_WORLD, type TerrainStats } from '../map/terrain';
import mapSvgUrl from '../../../../docs/design/map-citadel.svg?url';

type View = 'lane' | 'river' | 'base' | 'top';
const VIEWS: readonly View[] = ['lane', 'river', 'base', 'top'];

/** Map-unit focus points for the MOBA-camera presets. */
const FOCUS: Record<Exclude<View, 'top'>, { x: number; z: number }> = {
  // Warden safe lane (bottom), between the T1 and the lane's midpoint.
  lane: { x: 1400, z: -6650 },
  // Mid lane crossing the river at the centre.
  river: { x: 0, z: 0 },
  // Hollow base from below: its cliffs face the camera (south-west), with the mid ramp.
  // (The Warden base's cliffs face north-east, away from the fixed MOBA camera.)
  base: { x: 3900, z: 3500 },
};

export interface CitadelTerrainDebug {
  view(v: View): void;
  currentView(): View;
  frames(): number;
  /** Sampler height at a map point (map units). */
  heightAt(x: number, z: number): number;
  /** Height of the rendered mesh under a map point (map units), by ray cast; null if missed. */
  meshHeightAt(x: number, z: number): number | null;
  levels: { river: number; low: number; mid: number; high: number };
  /** Region (id, tag, height level) at a map point. */
  regionAt(x: number, z: number): { id: string; tag: string; height: string } | null;
  stats: TerrainStats;
  setTier(tier: QualityTier): void;
  setOverlay(on: boolean): void;
  scene: Scene;
}

declare global {
  interface Window {
    __citadelReady?: boolean;
    __citadelStats?: CitadelStats;
    __citadelSetTier?: (tier: QualityTier) => void;
    __citadelTerrain?: CitadelTerrainDebug;
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const mapImg = document.getElementById('map-overlay') as HTMLImageElement;
const params = new URLSearchParams(location.search);

const { engine, backend } = await createEngine(canvas);
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#1B1A1FFF');

const S = MAP_TO_WORLD;
const half = 7400 * S;
const moba = createMobaCamera(scene, {
  bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
});

// Top-down orthographic camera over the whole map (+z up the screen, like the SVG).
// A hair south of straight down, so the default Y-up camera keeps +z at the top of the screen.
const top = new TargetCamera('top-camera', new Vector3(0, 400, -0.05), scene);
top.setTarget(Vector3.Zero());
top.mode = Camera.ORTHOGRAPHIC_CAMERA;
// Babylon's LOD uses minZ as the distance for orthographic cameras: 300 selects the ¼-detail chunks.
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
const terrain = await createTerrain(scene);
const lodBias = (t: QualityTier) => (t === 'low' ? 0.6 : 1);
terrain.setLodBias(lodBias(quality.tier));
const setTier = (t: QualityTier) => {
  quality.setTier(t);
  terrain.setLodBias(lodBias(t));
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
const overlayBtn = document.createElement('button');
overlayBtn.type = 'button';
overlayBtn.textContent = 'map overlay';
overlayBtn.addEventListener('click', () => setOverlay(mapImg.hidden));
panel.append(overlayBtn);

let view: View = 'lane';
function setView(v: View) {
  view = v;
  if (v === 'top') {
    scene.activeCamera = top;
  } else {
    scene.activeCamera = moba.camera;
    const f = FOCUS[v];
    moba.focusOn({ x: f.x * S, z: f.z * S }, { instant: true });
  }
  for (const [k, b] of viewBtns) b.classList.toggle('on', k === v);
  placeOverlay();
}

mapImg.src = mapSvgUrl;
function setOverlay(on: boolean) {
  mapImg.hidden = !on;
  overlayBtn.classList.toggle('on', on);
  placeOverlay();
}
/** Pins the SVG so its map square (24..1024 px of 1348 × 1048) covers the terrain's. */
function placeOverlay() {
  if (mapImg.hidden) return;
  if (view !== 'top') {
    mapImg.style.display = 'none';
    return;
  }
  mapImg.style.display = '';
  const w = engine.getRenderWidth();
  const h = engine.getRenderHeight();
  const vp = top.viewport.toGlobal(w, h);
  const tm = top.getTransformationMatrix();
  const nw = Vector3.Project(new Vector3(-MAP_HALF, 0, MAP_HALF), Matrix.IdentityReadOnly, tm, vp);
  const se = Vector3.Project(new Vector3(MAP_HALF, 0, -MAP_HALF), Matrix.IdentityReadOnly, tm, vp);
  const k = canvas.clientWidth / w;
  const px = ((se.x - nw.x) * k) / 1000; // CSS px per SVG px
  mapImg.style.left = `${nw.x * k - 24 * px}px`;
  mapImg.style.top = `${nw.y * k - 24 * px}px`;
  mapImg.style.width = `${1348 * px}px`;
  mapImg.style.height = `${1048 * px}px`;
}

const startView = params.get('view');
setView(VIEWS.includes(startView as View) ? (startView as View) : 'lane');
setOverlay(params.get('overlay') === '1');

// ---- debug hook + render loop -------------------------------------------------------
const ray = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 1000);
window.__citadelTerrain = {
  view: setView,
  currentView: () => view,
  frames: () => frames,
  heightAt: (x, z) => terrain.sampler.mapHeightAt(x, z),
  meshHeightAt: (x, z) => {
    ray.origin.set(x * S, 200, z * S);
    const hit = scene.pickWithRay(ray, (m) => terrain.chunks.includes(m as never));
    return hit?.hit && hit.pickedPoint ? hit.pickedPoint.y / S : null;
  },
  levels: { ...terrain.sampler.field.levels },
  regionAt: (x, z) => {
    const r = terrain.sampler.field.regionAt(x, z);
    return r ? { id: r.id, tag: r.tag, height: r.height } : null;
  },
  stats: terrain.stats,
  setTier,
  setOverlay,
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
      `chunks  ${terrain.stats.chunks}`,
      `tex     ${Math.round(terrain.stats.textureBytes / 1024)} KB`,
    ]);
    if (frames >= 30) window.__citadelReady = true;
  }
});
window.addEventListener('resize', () => {
  engine.resize();
  fitTop();
  placeOverlay();
});
