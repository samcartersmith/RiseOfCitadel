/**
 * VFX sandbox (/vfx.html): a ground plane (moss half, ash half, a river strip)
 * with buttons for every particle preset, telegraph shape and intent,
 * projectiles, and a 50-effect stress spawn for the budget check.
 *
 * `?engine=webgl` forces WebGL2, `?particles=cpu|gpu` forces the particle
 * backend, `?tier=` picks the quality tier. Debug hook for tests: window.__citadelVfx.
 */
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createEngine } from '../render/engine';
import { createQualityController } from '../render/tiers';
import { createPerfHud } from '../render/hud';
import { readStats, type CitadelStats } from '../render/stats';
import {
  createVfx,
  withVfxStats,
  INTENTS,
  PRESET_NAMES,
  TELEGRAPH_SHAPES,
  type Intent,
  type PresetName,
  type TelegraphShape,
  type VfxStats,
} from '../vfx';

export interface CitadelVfxDebug {
  presets: readonly PresetName[];
  shapes: readonly TelegraphShape[];
  intents: readonly Intent[];
  play(preset: PresetName, x?: number, z?: number): void;
  telegraph(shape: TelegraphShape, intent: Intent, x?: number, z?: number, fillTime?: number): void;
  projectile(kind: 'straight' | 'arc' | 'homing'): void;
  /** Lays out every intent on both ground colours (persistent until stopAll). */
  showcase(): number;
  /** Spawns `n` concurrent effects of mixed kinds. Returns how many were started. */
  stress(n?: number): number;
  stopAll(): void;
  stats(): VfxStats;
  /** Highest draw-call count of any frame since the last reset. */
  peakDrawCalls(): number;
  resetPeak(): void;
  frames(): number;
  setTimeScale(scale: number): void;
}

declare global {
  interface Window {
    __citadelReady?: boolean;
    __citadelStats?: CitadelStats;
    __citadelVfx?: CitadelVfxDebug;
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;

const { engine, backend } = await createEngine(canvas);
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#1B1A1FFF');

// Fixed MOBA-like view: ~55° pitch looking north (+Z). Drag to orbit, wheel to zoom.
const camera = new ArcRotateCamera('cam', -Math.PI / 2, 0.62, 34, new Vector3(0, 0, 0), scene);
camera.lowerRadiusLimit = 8;
camera.upperRadiusLimit = 70;
camera.wheelPrecision = 20;
camera.attachControl(true);

new HemisphericLight('sky', new Vector3(0, 1, 0), scene).intensity = 0.6;
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.4), scene);
sun.intensity = 0.9;

function flat(name: string, hex: string) {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = Color3.Black();
  return m;
}
// Readability check: telegraphs must read on both the Warden moss and the Hollow ash.
const moss = MeshBuilder.CreateGround('ground-moss', { width: 26, height: 40 }, scene);
moss.position.x = -13;
moss.material = flat('m-moss', '#6F9A4E');
const ash = MeshBuilder.CreateGround('ground-ash', { width: 26, height: 40 }, scene);
ash.position.x = 13;
ash.material = flat('m-ash', '#5E5A63');
const river = MeshBuilder.CreateGround('river', { width: 52, height: 3 }, scene);
river.position.set(0, 0.01, 11);
const riverMat = flat('m-river', '#7FE3E0');
riverMat.emissiveColor = Color3.FromHexString('#2A5F5D');
river.material = riverMat;

// A marker that runs in a circle: carries the trail and aura demos and is the homing target.
const runner = MeshBuilder.CreateSphere('runner', { diameter: 0.8, segments: 12 }, scene);
runner.material = flat('m-runner', '#E8B54A');
const caster = new TransformNode('caster', scene);
caster.position.set(0, 1, -10);

const quality = createQualityController(engine, scene, backend);
const vfx = createVfx(scene, { tier: quality.tier });
const hud = createPerfHud(overlay, (tier) => {
  quality.setTier(tier);
  vfx.setTier(tier);
});

// Ambient river light: always on.
vfx.play('motes', { at: { x: -8, y: 0, z: 11 }, area: 8 });
vfx.play('motes', { at: { x: 8, y: 0, z: 11 }, area: 8 });

// ---- actions ---------------------------------------------------------------------
const FEATHER_WHITE = '#F4F1E8';
const ACTION_SPOT = { x: 0, z: 2 };

function play(preset: PresetName, x = ACTION_SPOT.x, z = ACTION_SPOT.z) {
  switch (preset) {
    case 'trail':
      vfx.attach('trail', runner, { duration: 3, color: '#FFE6A3' });
      break;
    case 'aura':
      vfx.attach('aura', runner, { duration: 4, offset: { x: 0, y: -0.4, z: 0 } });
      break;
    case 'embers':
      vfx.play('embers', { at: { x, y: 0, z }, duration: 3 });
      break;
    case 'motes':
      vfx.play('motes', { at: { x, y: 0, z }, duration: 4, area: 3, color: '#E8B54A' });
      break;
    default:
      vfx.play(preset, { at: { x, y: 0.6, z } });
  }
}

function telegraph(
  shape: TelegraphShape,
  intent: Intent,
  x = ACTION_SPOT.x,
  z = ACTION_SPOT.z,
  fillTime = 1,
) {
  const at = { x, z };
  switch (shape) {
    case 'circle':
      // Crucible Drop: 1 s fill, then the pour lands.
      vfx.telegraph({
        shape,
        at,
        radius: 2.5,
        intent,
        fillTime,
        onFilled: () => {
          vfx.play('impactBurst', { at: { x, y: 0.4, z }, color: '#FF8A3D' });
          vfx.play('dustPuff', { at: { x, y: 0.2, z } });
        },
      });
      break;
    case 'ring':
      vfx.telegraph({ shape, at, radius: 3.5, intent, fillTime });
      break;
    case 'cone':
      vfx.telegraph({ shape, at, length: 6, angle: Math.PI / 3, intent, fillTime, yaw: 0 });
      break;
    case 'line':
      vfx.telegraph({ shape, at, length: 9, width: 1.6, intent, fillTime, yaw: 0 });
      break;
    case 'crack':
      vfx.telegraph({ shape, at, radius: 3, color: '#E8B54A', hold: 1.5, fadeOut: 0.6 });
      break;
  }
}

function projectile(kind: 'straight' | 'arc' | 'homing') {
  const from = caster.position;
  if (kind === 'straight') {
    vfx.projectile({ from, to: { x: 6, y: 1, z: 4 }, speed: 16, color: FEATHER_WHITE });
  } else if (kind === 'arc') {
    // Slag Bolt-style glob: arcs, lands in a splash.
    vfx.projectile({
      from,
      to: { x: -6, y: 0.2, z: 4 },
      speed: 12,
      arcHeight: 4,
      color: '#FF8A3D',
      size: 0.55,
      onArrive: (at) => vfx.play('dustPuff', { at, scale: 0.7 }),
    });
  } else {
    vfx.projectile({ from, target: runner, speed: 14, arcHeight: 1, color: '#7FE3E0' });
  }
}

function showcase(): number {
  const persistent = Number.POSITIVE_INFINITY;
  let n = 0;
  INTENTS.forEach((intent, i) => {
    // Row 1: filled circles, each intent on moss (left) and ash (right).
    for (const side of [-1, 1]) {
      const x = side * (4 + i * 5.5);
      vfx.telegraph({ shape: 'circle', at: { x, z: 2 }, radius: 2.2, intent, hold: persistent });
      n++;
    }
  });
  // Row 2: one shape per intent, mid-fill, mirrored on both grounds.
  const shapes: [TelegraphShape, Intent][] = [
    ['ring', 'enemyDisable'],
    ['cone', 'allyBuff'],
    ['line', 'damage'],
    ['circle', 'neutral'],
  ];
  shapes.forEach(([shape, intent], i) => {
    for (const side of [-1, 1]) {
      const x = side * (4 + i * 5.5);
      const common = { at: { x, z: -7 }, intent, fillTime: 8, hold: persistent };
      if (shape === 'cone') vfx.telegraph({ ...common, shape, length: 4.5, angle: Math.PI / 2.5 });
      else if (shape === 'line') vfx.telegraph({ ...common, shape, length: 5, width: 1.4 });
      else vfx.telegraph({ ...common, shape, radius: 2.2 });
      n++;
    }
  });
  vfx.telegraph({
    shape: 'crack',
    at: { x: 0, z: -2.5 },
    radius: 2,
    color: '#E8B54A',
    hold: persistent,
  });
  return n + 1;
}

const stressNodes: TransformNode[] = [];
for (let i = 0; i < 10; i++) stressNodes.push(new TransformNode(`stress-${i}`, scene));

function stress(n = 50): number {
  for (let i = 0; i < n; i++) {
    const x = -15 + (i % 10) * 3.3;
    const z = -9 + Math.floor(i / 10) * 4;
    const at = { x, y: 0.5, z };
    switch (i % 10) {
      case 0:
        vfx.play('impactBurst', { at });
        break;
      case 1:
        vfx.play('sparkShower', { at, duration: 1.5 });
        break;
      case 2:
        vfx.play('dustPuff', { at });
        break;
      case 3:
        vfx.play('embers', { at, duration: 2.5, area: 1 });
        break;
      case 4: {
        const node = stressNodes[Math.floor(i / 10) % stressNodes.length]!;
        node.position.set(x, 0.1, z);
        vfx.attach('aura', node, { duration: 2.5 });
        break;
      }
      case 5:
        vfx.telegraph({ shape: 'circle', at, radius: 1.4, intent: 'enemyDisable', fillTime: 2 });
        break;
      case 6:
        vfx.telegraph({ shape: 'cone', at, length: 2.5, intent: 'damage', fillTime: 2 });
        break;
      case 7:
        vfx.telegraph({
          shape: 'line',
          at,
          length: 3,
          width: 0.8,
          intent: 'allyBuff',
          fillTime: 2,
        });
        break;
      case 8:
        vfx.projectile({ from: at, to: { x: x + 2, y: 0.3, z: z + 3 }, speed: 3, arcHeight: 2 });
        break;
      case 9:
        vfx.telegraph({ shape: 'ring', at, radius: 1.4, intent: 'neutral', fillTime: 2 });
        break;
    }
  }
  return n;
}

// ---- UI ------------------------------------------------------------------------
function row(label: string): HTMLDivElement {
  const r = document.createElement('div');
  r.className = 'row';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = label;
  r.append(l);
  panel.append(r);
  return r;
}
function button(parent: HTMLElement, text: string, onClick: () => void, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  parent.append(b);
}

const particlesRow = row('particles');
for (const p of PRESET_NAMES) button(particlesRow, p, () => play(p));
button(particlesRow, 'feather burst', () =>
  vfx.play('dustPuff', { at: { x: 0, y: 0.8, z: 2 }, cell: 'feather', color: FEATHER_WHITE }),
);
const telegraphRow = row('telegraphs');
button(telegraphRow, 'circle (disable, 1 s)', () => telegraph('circle', 'enemyDisable'), 'warn');
button(telegraphRow, 'ring (disable)', () => telegraph('ring', 'enemyDisable'), 'warn');
button(telegraphRow, 'cone (damage)', () => telegraph('cone', 'damage'));
button(telegraphRow, 'line (damage)', () => telegraph('line', 'damage'));
button(telegraphRow, 'circle (ally buff)', () => telegraph('circle', 'allyBuff'), 'ally');
button(telegraphRow, 'circle (neutral)', () => telegraph('circle', 'neutral'));
button(telegraphRow, 'crack', () => telegraph('crack', 'neutral'));
button(telegraphRow, 'intent showcase', () => showcase());
const miscRow = row('projectiles');
button(miscRow, 'straight', () => projectile('straight'));
button(miscRow, 'arced', () => projectile('arc'));
button(miscRow, 'homing', () => projectile('homing'));
button(miscRow, 'stress ×50', () => stress(50), 'warn');
button(miscRow, 'stop all', () => vfx.stopAll());
button(miscRow, 'slow-mo', () => vfx.setTimeScale(vfx.timeScale === 1 ? 0.25 : 1));

// ---- debug hook + render loop ----------------------------------------------------
let frames = 0;
let peak = 0;
window.__citadelVfx = {
  presets: PRESET_NAMES,
  shapes: TELEGRAPH_SHAPES,
  intents: INTENTS,
  play,
  telegraph,
  projectile,
  showcase,
  stress,
  stopAll: () => vfx.stopAll(),
  stats: () => vfx.stats(),
  peakDrawCalls: () => peak,
  resetPeak: () => {
    peak = 0;
  },
  frames: () => frames,
  setTimeScale: (s) => vfx.setTimeScale(s),
};

readStats(engine, scene, backend, quality.tier); // attach instrumentation before the first frame
let runnerAngle = 0;
engine.runRenderLoop(() => {
  runnerAngle += (engine.getDeltaTime() / 1000) * 0.9;
  runner.position.set(Math.cos(runnerAngle) * 6, 0.9, 2 + Math.sin(runnerAngle) * 4);
  scene.render();
  frames++;
  const stats = withVfxStats(readStats(engine, scene, backend, quality.tier), vfx);
  peak = Math.max(peak, stats.drawCalls);
  window.__citadelStats = stats;
  if (frames % 3 === 0) {
    const s = vfx.stats();
    hud.update(stats, [
      `vfx     ${s.active.total} active / ${s.pooled.total} pooled`,
      `parts   ${s.backend} (${s.particleSystems} systems)`,
    ]);
  }
  if (frames === 30) window.__citadelReady = true;
});
window.addEventListener('resize', () => engine.resize());
