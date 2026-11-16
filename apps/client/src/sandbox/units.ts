/**
 * Unit sandbox (/units.html): N units (default 50, `?n=`) driven by a fake
 * "sim" through plain UnitViewStates, rendered by UnitViewManager under the
 * MOBA camera. Heroes (knight / rogue_hooded / mage) and skeleton creeps on
 * both teams plus a few neutrals walk, fight, take damage, die and respawn.
 *
 * Click selects (shift adds), hovering highlights. Slider: unit count 0-100.
 * Debug hook for tests: window.__citadelUnits. Ready flag: window.__citadelReady.
 */
import { Scene } from '@babylonjs/core/scene';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createEngine } from '../render/engine';
import { readStats, type CitadelStats } from '../render/stats';
import { createPerfHud } from '../render/hud';
import { createMobaCamera, type MobaCamera } from '../camera/mobaCamera';
import { UnitViewManager, type UnitViewCounts } from '../units/unitViewManager';
import { facingOf } from '../units/motion';
import { setUnitLookFactory } from '../units/look';
import type { RingKind } from '../units/rings';
import type { ModelId } from '../units/modelConfig';
import type { Team, UnitId, UnitViewState } from '../units/unitState';

export interface CitadelUnitsDebug {
  count(): number;
  setCount(n: number): void;
  ids(): UnitId[];
  counts(): UnitViewCounts;
  state(id: UnitId): UnitViewState | undefined;
  /** Select one unit (null clears). */
  select(id: UnitId | null): void;
  hover(id: UnitId | null): void;
  /** Deal damage (reduces hp; kills at 0). */
  damage(id: UnitId, amount: number): void;
  /** Bring every unit back to full HP and alive (deterministic test baseline). */
  reviveAll(): void;
  /** Stop the fake driver from moving units or changing hp. */
  pause(paused: boolean): void;
  /** The bar actually uploaded for this unit last frame, or null if none drawn. */
  bar(id: UnitId): { hp: number; trail: number; mana: number } | null;
  /** Rings uploaded for this unit last frame. */
  rings(id: UnitId): RingKind[];
  /** Canvas position (CSS px) of a unit's body centre. */
  screenPos(id: UnitId): { x: number; y: number } | null;
  pick(x: number, y: number): UnitId | null;
  frames(): number;
}

declare global {
  interface Window {
    __citadelReady?: boolean;
    __citadelStats?: CitadelStats;
    __citadelCamera?: MobaCamera;
    __citadelUnits?: CitadelUnitsDebug;
  }
}

const MAX_UNITS = 100;
/**
 * Units are drawn larger than their config scale so they read at the MOBA
 * camera's default distance (same convention as the boot scene's sample hero).
 * Hero world scale vs. camera distance is still open (docs/design/units.md §7).
 * `?scale=1` shows true config scale.
 */
const DISPLAY_SCALE = Number(new URLSearchParams(location.search).get('scale') ?? 2.5) || 2.5;
/** Driver distances (spawn areas, speeds, ranges) are tuned for scale 2.5 and follow the display scale. */
const K = DISPLAY_SCALE / 2.5;
const params = new URLSearchParams(location.search);
let targetCount = Math.max(0, Math.min(MAX_UNITS, Number(params.get('n') ?? 50) || 0));
if (params.get('n') === '0') targetCount = 0;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;

const { engine, backend } = await createEngine(canvas);
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#1B1A1FFF');
const camera = createMobaCamera(scene);
window.__citadelCamera = camera;
(window as unknown as { __citadelScene: Scene }).__citadelScene = scene;

new HemisphericLight('sky', new Vector3(0, 1, 0), scene).intensity = 0.75;
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.4), scene);
sun.intensity = 0.85;

const flat = (name: string, hex: string) => {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = Color3.Black();
  return m;
};
const ground = MeshBuilder.CreateGround('ground', { width: 80, height: 80 }, scene);
ground.material = flat('m-ground', '#5E7F45');
ground.isPickable = false;
const lane = MeshBuilder.CreateGround('lane', { width: 80, height: 10 }, scene);
lane.position.y = 0.01;
lane.material = flat('m-lane', '#8A7A5C');
lane.isPickable = false;

if (params.get('look') === '0') {
  setUnitLookFactory(() => ({ setTeam() {}, setHighlight() {}, dispose() {} }));
}
const manager = new UnitViewManager(scene, {
  localTeam: 'wardens',
  mergeMeshes: params.get('merge') !== '0',
  displayScale: DISPLAY_SCALE,
});

// ---- Fake driver -------------------------------------------------------------
// A stand-in for the M2 sim: it owns plain states and mutates them; the view
// layer only ever sees the state array. Seeded so screenshots are repeatable.

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1337);
const between = (a: number, b: number) => a + (b - a) * rand();

type Mode = 'walk' | 'idle' | 'attack' | 'dead';
interface Driven {
  s: UnitViewState;
  mode: Mode;
  timer: number;
  target: { x: number; z: number };
  targetUnit: UnitId | null;
  swingTimer: number;
  speed: number;
  damage: number;
  range: number;
}

const HERO_MODELS: ModelId[] = ['knight', 'rogue_hooded', 'mage'];

function spawnPoint(team: Team, i: number): { x: number; z: number } {
  if (team === 'neutral') {
    return { x: K * between(-8, 8), z: K * (i % 2 ? 1 : -1) * between(15, 19) };
  }
  const side = team === 'wardens' ? -1 : 1;
  return { x: K * side * between(6, 21), z: K * between(-11, 11) };
}

/** Deterministic roster: unit i always has the same team/model, so the slider just adds/removes the tail. */
function makeUnit(i: number): Driven {
  const id = i + 1;
  const neutral = i % 12 === 11;
  const team: Team = neutral ? 'neutral' : i % 2 === 0 ? 'wardens' : 'hollow';
  const isHero = !neutral && (i >> 1) % 5 === 0;
  const modelId: ModelId = isHero ? HERO_MODELS[(i >> 1) % 3]! : 'skeleton_minion';
  const maxHp = isHero ? 600 + 100 * Math.floor(between(0, 6)) : neutral ? 650 : 450;
  const maxMana = isHero ? 300 + 50 * Math.floor(between(0, 4)) : undefined;
  const p = spawnPoint(team, i);
  return {
    s: {
      id,
      modelId,
      team,
      position: p,
      facing: team === 'hollow' ? -Math.PI / 2 : Math.PI / 2,
      animState: 'idle',
      animSeq: 0,
      attackSpeedScale: isHero ? between(1, 1.6) : 1,
      hp: maxHp * between(0.55, 1),
      maxHp,
      ...(isHero ? { mana: maxMana! * between(0.3, 1), maxMana, level: 1 + (i % 6) } : {}),
      isHero,
      selected: false,
      hovered: false,
      visible: true,
      snap: true,
    },
    mode: 'idle',
    timer: between(0, 1.5),
    target: p,
    targetUnit: null,
    swingTimer: 0,
    speed: K * (isHero ? 8 : 6.5),
    damage: isHero ? between(45, 70) : between(14, 24),
    range: K * (modelId === 'rogue_hooded' || modelId === 'mage' ? 10 : 3.2),
  };
}

const units: Driven[] = [];
const byId = new Map<UnitId, Driven>();
let paused = false;

function setCount(n: number) {
  targetCount = Math.max(0, Math.min(MAX_UNITS, Math.round(n)));
  while (units.length < targetCount) {
    const u = makeUnit(units.length);
    units.push(u);
    byId.set(u.s.id, u);
  }
  while (units.length > targetCount) byId.delete(units.pop()!.s.id);
}

function nearestFoe(u: Driven, maxDist: number): Driven | null {
  let best: Driven | null = null;
  let bestD = maxDist * maxDist;
  for (const o of units) {
    if (o === u || o.mode === 'dead' || o.s.team === u.s.team) continue;
    // Neutrals only fight back; lane units mostly ignore them.
    if (u.s.team !== 'neutral' && o.s.team === 'neutral' && rand() < 0.7) continue;
    const d = (o.s.position.x - u.s.position.x) ** 2 + (o.s.position.z - u.s.position.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function hit(target: Driven, amount: number) {
  if (target.mode === 'dead') return;
  target.s.hp = Math.max(0, target.s.hp - amount);
  if (target.s.hp <= 0) {
    target.mode = 'dead';
    target.timer = 4;
    target.s.animState = 'death';
  }
}

function stepUnit(u: Driven, dt: number) {
  const s = u.s;
  s.snap = false;
  u.timer -= dt;
  if (s.isHero && s.maxMana) s.mana = Math.min(s.maxMana, (s.mana ?? 0) + 6 * dt);
  if (s.isHero && u.mode !== 'dead') s.hp = Math.min(s.maxHp, s.hp + 4 * dt);
  switch (u.mode) {
    case 'dead':
      if (u.timer <= 0) {
        s.position = spawnPoint(s.team, s.id);
        s.hp = s.maxHp;
        s.animState = 'idle';
        s.snap = true;
        u.mode = 'idle';
        u.timer = 1;
      }
      return;
    case 'walk': {
      const dx = u.target.x - s.position.x;
      const dz = u.target.z - s.position.z;
      const d = Math.hypot(dx, dz);
      const step = u.speed * dt;
      if (d <= step || u.timer <= 0) {
        u.mode = 'idle';
        u.timer = between(0.3, 1.2);
        s.animState = 'idle';
      } else {
        s.position = { x: s.position.x + (dx / d) * step, z: s.position.z + (dz / d) * step };
        s.facing = facingOf(dx, dz, s.facing);
        s.animState = 'run';
      }
      return;
    }
    case 'attack': {
      const foe = u.targetUnit !== null ? byId.get(u.targetUnit) : undefined;
      if (!foe || foe.mode === 'dead' || u.timer <= 0) {
        u.mode = 'idle';
        u.timer = between(0.2, 0.8);
        s.animState = 'idle';
        return;
      }
      s.facing = facingOf(foe.s.position.x - s.position.x, foe.s.position.z - s.position.z);
      u.swingTimer -= dt;
      if (u.swingTimer <= 0) {
        const castNow = s.isHero && (s.mana ?? 0) > 80 && rand() < 0.2;
        s.animState = castNow ? (rand() < 0.5 ? 'cast1' : 'cast2') : 'attack1';
        s.animSeq = (s.animSeq ?? 0) + 1;
        if (castNow) s.mana = (s.mana ?? 0) - 80;
        hit(foe, u.damage * (castNow ? 2.5 : 1));
        u.swingTimer = 1.3 / s.attackSpeedScale;
      }
      return;
    }
    case 'idle': {
      if (u.timer > 0) return;
      // Only fight what's close; otherwise wander the unit's own side of the lane.
      const foe = rand() < 0.6 ? nearestFoe(u, 11 * K) : null;
      if (foe) {
        const d = Math.hypot(foe.s.position.x - s.position.x, foe.s.position.z - s.position.z);
        if (d <= u.range + 0.5 * K) {
          u.mode = 'attack';
          u.targetUnit = foe.s.id;
          u.timer = between(2, 5);
          u.swingTimer = between(0, 0.4);
          return;
        }
        // Close in, stopping at range.
        const k = (d - u.range * 0.8) / d;
        u.target = {
          x: s.position.x + (foe.s.position.x - s.position.x) * k,
          z: s.position.z + (foe.s.position.z - s.position.z) * k,
        };
      } else if (s.team === 'neutral') {
        const home = spawnPoint('neutral', s.id);
        u.target = { x: home.x, z: s.position.z > 0 ? Math.abs(home.z) : -Math.abs(home.z) };
      } else {
        const side = s.team === 'wardens' ? -1 : 1;
        u.target = { x: K * side * between(2, 20), z: K * between(-11, 11) };
      }
      u.mode = 'walk';
      u.timer = 6;
      return;
    }
  }
}

setCount(targetCount);

// ---- Input: click to select, hover ---------------------------------------------
let pointer: { x: number; y: number } | null = null;
let forcedHover: UnitId | null | undefined; // set by the debug hook; undefined = follow the pointer
canvas.addEventListener('pointermove', (e) => (pointer = { x: e.offsetX, y: e.offsetY }));
canvas.addEventListener('pointerleave', () => (pointer = null));
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const id = manager.pick(e.offsetX, e.offsetY);
  if (!e.shiftKey) for (const u of units) u.s.selected = false;
  if (id !== null) {
    const u = byId.get(id);
    if (u) u.s.selected = e.shiftKey ? !u.s.selected : true;
  }
});

// ---- Panel ---------------------------------------------------------------------
const countLabel = document.createElement('label');
countLabel.textContent = 'units ';
const slider = document.createElement('input');
Object.assign(slider, { type: 'range', min: '0', max: String(MAX_UNITS), step: '1' });
slider.value = String(targetCount);
const countValue = document.createElement('span');
countValue.textContent = String(targetCount);
slider.oninput = () => {
  setCount(Number(slider.value));
  countValue.textContent = String(targetCount);
};
countLabel.append(slider, countValue);
const pauseBtn = document.createElement('button');
pauseBtn.textContent = 'pause driver';
pauseBtn.onclick = () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'resume driver' : 'pause driver';
};
const hint = document.createElement('span');
hint.textContent = 'click: select · shift+click: add · wheel: zoom · arrows/edge: pan';
panel.append(countLabel, pauseBtn, hint);

const hud = createPerfHud(overlay, () => {});

// ---- Debug hook ----------------------------------------------------------------
function screenPos(id: UnitId): { x: number; y: number } | null {
  const v = manager.get(id);
  const cam = scene.activeCamera;
  if (!v || !cam) return null;
  const p = new Vector3(v.position.x, v.barAnchorHeight * 0.45, v.position.z);
  const vp = cam.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight);
  const s = Vector3.Project(p, Matrix.IdentityReadOnly, scene.getTransformMatrix(), vp);
  return { x: s.x, y: s.y };
}

let frames = 0;
window.__citadelUnits = {
  count: () => units.length,
  setCount: (n) => {
    setCount(n);
    slider.value = String(targetCount);
    countValue.textContent = String(targetCount);
  },
  ids: () => units.map((u) => u.s.id),
  counts: () => manager.counts,
  state: (id) => {
    const s = byId.get(id)?.s;
    return s ? structuredClone(s) : undefined;
  },
  select: (id) => {
    for (const u of units) u.s.selected = u.s.id === id;
  },
  hover: (id) => {
    forcedHover = id;
  },
  damage: (id, amount) => {
    const u = byId.get(id);
    if (u) hit(u, amount);
  },
  reviveAll: () => {
    for (const u of units) {
      u.s.hp = u.s.maxHp;
      u.s.animState = 'idle';
      u.mode = 'idle';
      u.timer = 0.5;
    }
  },
  pause: (p) => {
    paused = p;
  },
  bar: (id) => {
    const e = manager.bars.entry(id);
    return e ? { hp: e.hpFill, trail: e.trailFill, mana: e.manaFill } : null;
  },
  rings: (id) => manager.rings.ringsFor(id),
  screenPos,
  pick: (x, y) => manager.pick(x, y),
  frames: () => frames,
};

// ---- Frame loop ----------------------------------------------------------------
let readyAt = -1;
let states: UnitViewState[] = [];
readStats(engine, scene, backend, 'low'); // attach instrumentation before the first frame
engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  if (!paused) for (const u of units) stepUnit(u, dt);
  else for (const u of units) u.s.snap = false;
  const hovered =
    forcedHover !== undefined ? forcedHover : pointer ? manager.pick(pointer.x, pointer.y) : null;
  states = units.map((u) => {
    u.s.hovered = u.s.id === hovered;
    return u.s;
  });
  manager.sync(states, dt);
  scene.render();
  frames++;
  if (frames % 15 === 0) {
    const stats = readStats(engine, scene, backend, 'low');
    window.__citadelStats = stats;
    const c = manager.counts;
    hud.update(stats, [
      `units   ${c.loaded}/${c.views}`,
      `bars    ${c.bars}`,
      `rings   ${c.rings}`,
    ]);
  }
  const c = manager.counts;
  if (readyAt < 0 && c.loaded === units.length) readyAt = frames;
  if (readyAt >= 0 && frames - readyAt >= 30 && frames % 15 === 0) window.__citadelReady = true;
});
window.addEventListener('resize', () => engine.resize());
