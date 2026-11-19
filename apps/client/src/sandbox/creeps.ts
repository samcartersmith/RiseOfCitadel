/**
 * Creep sandbox (/creeps.html). Scenes (`?scene=`, also buttons):
 *
 * - `lane`    (default) every lane creep type × idle / walk / attack / death, close up.
 * - `neutral` every neutral camp family and the boss × idle / walk / attack / death.
 * - `wave`    two 20-creep lane waves clashing (40 creeps) at the default MOBA zoom:
 *             the budget scene the Playwright test measures.
 * - `camps`   the four neutral camps and the boss pit at default zoom.
 *
 * Everything is driven through plain CreepViewStates by a seeded fake "sim",
 * like /units.html. Debug hook: window.__citadelCreeps. Ready flag:
 * window.__citadelReady (30 frames after every type has loaded).
 */
import { Scene } from '@babylonjs/core/scene';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createEngine } from '../render/engine';
import { readStats } from '../render/stats';
import { createPerfHud } from '../render/hud';
import { createMobaCamera } from '../camera/mobaCamera';
import { facingOf } from '../units/motion';
import { setUnitLookFactory } from '../units/look';
import type { LogicalState } from '../units/states';
import type { Team, UnitId } from '../units/unitState';
import {
  CreepViewManager,
  type CreepTypeStats,
  type CreepViewCounts,
  type CreepViewState,
} from '../units/creeps/creepViewManager';
import { CREEP_TYPES, NEUTRAL_CAMPS, type CreepModelId } from '../units/creeps/creepTypes';

export type CreepScene = 'lane' | 'neutral' | 'wave' | 'camps';
const SCENES: CreepScene[] = ['lane', 'neutral', 'wave', 'camps'];

export interface CitadelCreepsDebug {
  scene(): CreepScene;
  counts(): CreepViewCounts;
  typeStats(): CreepTypeStats[];
  ids(): UnitId[];
  state(id: UnitId): CreepViewState | undefined;
  /** The logical state the unit's animation is actually showing. */
  shown(id: UnitId): string | null;
  /** VAT row the unit drew last frame. */
  frame(id: UnitId): number | null;
  /** Freeze the fake driver (positions, hp and states stay as they are). */
  pause(paused: boolean): void;
  /** Force one unit into a logical state (bumps animSeq so one-shots replay). */
  play(id: UnitId, state: LogicalState): void;
  screenPos(id: UnitId): { x: number; y: number } | null;
  pick(x: number, y: number): UnitId | null;
  select(id: UnitId | null): void;
  frames(): number;
}

declare global {
  interface Window {
    __citadelCreeps?: CitadelCreepsDebug;
  }
}

const params = new URLSearchParams(location.search);
const sceneName: CreepScene = SCENES.includes(params.get('scene') as CreepScene)
  ? (params.get('scene') as CreepScene)
  : 'lane';
/** Same display convention as /units.html (docs/design/units.md §7). */
const DISPLAY_SCALE = Number(params.get('scale') ?? 2.5) || 2.5;
const K = DISPLAY_SCALE / 2.5;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const labelsEl = document.getElementById('labels') as HTMLDivElement;

const { engine, backend } = await createEngine(canvas);
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#1B1A1FFF');
const closeUp = sceneName === 'lane' || sceneName === 'neutral';
const camera = createMobaCamera(
  scene,
  sceneName === 'lane'
    ? { defaultDistance: 34, minDistance: 20 }
    : sceneName === 'neutral'
      ? { defaultDistance: 50, minDistance: 20 }
      : {},
);
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
const ground = MeshBuilder.CreateGround('ground', { width: 90, height: 90 }, scene);
ground.material = flat('m-ground', '#5E7F45');
ground.isPickable = false;
if (sceneName === 'wave' || sceneName === 'lane') {
  const lane = MeshBuilder.CreateGround('lane', { width: 90, height: 12 }, scene);
  lane.position.y = 0.01;
  lane.material = flat('m-lane', '#8A7A5C');
  lane.isPickable = false;
}
if (sceneName === 'camps') {
  const pit = MeshBuilder.CreateDisc('boss-pit', { radius: 7 * K, tessellation: 24 }, scene);
  pit.rotation.x = Math.PI / 2;
  pit.position.y = 0.02;
  pit.material = flat('m-pit', '#4A4552');
  pit.isPickable = false;
}

if (params.get('look') === '0') {
  setUnitLookFactory(() => ({ setTeam() {}, setHighlight() {}, dispose() {} }));
}
// `?toon=0` shades with the installed UnitLook (M1-13 fallback rim) instead of the toon material.
const manager = new CreepViewManager(scene, {
  localTeam: 'wardens',
  displayScale: DISPLAY_SCALE,
  look: params.get('toon') === '0' ? 'unit-look' : 'toon',
});

// ---- Fake driver ----------------------------------------------------------------

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
const rand = mulberry32(1414);
const between = (a: number, b: number) => a + (b - a) * rand();

type Role = 'show-idle' | 'show-run' | 'show-attack' | 'show-death' | 'fighter' | 'camp';
interface Driven {
  s: CreepViewState;
  role: Role;
  timer: number;
  home: { x: number; z: number };
  /** Lane fighters: range and speed. */
  range: number;
  speed: number;
  damage: number;
  target: UnitId | null;
  dead: boolean;
}

const units: Driven[] = [];
const byId = new Map<UnitId, Driven>();
let paused = false;
let nextId = 1;

function addUnit(
  modelId: CreepModelId,
  x: number,
  z: number,
  facing: number,
  role: Role,
  opts: Partial<Pick<Driven, 'range' | 'speed' | 'damage'>> = {},
): Driven {
  const cfg = CREEP_TYPES[modelId];
  const maxHp = cfg.category === 'boss' ? 6000 : cfg.category === 'neutral' ? 700 : 550;
  const d: Driven = {
    s: {
      id: nextId++,
      modelId,
      team: cfg.team,
      position: { x, z },
      facing,
      animState: 'idle',
      animSeq: 0,
      attackSpeedScale: 1,
      hp: maxHp * (role === 'fighter' ? 1 : between(0.6, 1)),
      maxHp,
      isHero: false,
      selected: false,
      hovered: false,
      visible: true,
      snap: true,
    },
    role,
    timer: between(0, 0.8),
    home: { x, z },
    range: opts.range ?? 3 * K,
    speed: opts.speed ?? 5 * K,
    damage: opts.damage ?? 20,
    target: null,
    dead: false,
  };
  units.push(d);
  byId.set(d.s.id, d);
  return d;
}

const SHOW_ROLES: Role[] = ['show-idle', 'show-run', 'show-attack', 'show-death'];
const STATE_LABELS = ['idle', 'walk', 'attack', 'death'];
const labels: { el: HTMLDivElement; id: UnitId }[] = [];
function label(id: UnitId, text: string) {
  const el = document.createElement('div');
  el.className = 'creep-label';
  el.textContent = text;
  labelsEl.append(el);
  labels.push({ el, id });
}

/** Gallery: one column per type, rows = idle / walk / attack / death. */
function gallery(types: CreepModelId[], spacingX: number, spacingZ: number) {
  const x0 = (-(types.length - 1) * spacingX) / 2;
  types.forEach((t, c) => {
    SHOW_ROLES.forEach((role, r) => {
      const d = addUnit(t, x0 + c * spacingX, ((3 - r) * spacingZ - 1.5 * spacingZ) * 1, 0, role);
      d.s.facing = Math.PI + 0.5; // three-quarter view toward the (south) camera
      if (r === 0) label(d.s.id, CREEP_TYPES[t].name);
    });
  });
  // Row labels on the left.
  SHOW_ROLES.forEach((_, r) => {
    const first = units[r];
    if (first) label(first.s.id, '');
  });
}

if (sceneName === 'lane') {
  gallery(
    [
      'warden_melee',
      'warden_ranged',
      'warden_siege',
      'hollow_melee',
      'hollow_ranged',
      'hollow_siege',
    ],
    6.5 * K,
    5 * K,
  );
} else if (sceneName === 'neutral') {
  const types: CreepModelId[] = [
    'neutral_small',
    'neutral_medium',
    'neutral_large',
    'neutral_ancient',
    'boss',
  ];
  const xs = [-22, -15, -7, 2, 17].map((x) => x * K);
  types.forEach((t, c) => {
    const big = t === 'boss';
    SHOW_ROLES.forEach((role, r) => {
      // The boss is too big for a column: a 2 × 2 block (back: idle, walk; front: attack, death).
      const z = big ? (r < 2 ? 5.5 : -5.5) * K : (1.5 - r) * 6 * K;
      const x = big ? xs[c]! + (r % 2 ? 5 : -5) * K : xs[c]!;
      const d = addUnit(t, x, z, Math.PI + 0.5, role);
      if (r === 0) label(d.s.id, CREEP_TYPES[t].name);
    });
  });
} else if (sceneName === 'wave') {
  // Two waves of 20: 12 melee, 6 ranged, 2 siege per side, in loose ranks.
  const wave = (team: Team) => {
    const side = team === 'wardens' ? -1 : 1;
    const ids: Record<'melee' | 'ranged' | 'siege', CreepModelId> =
      team === 'wardens'
        ? { melee: 'warden_melee', ranged: 'warden_ranged', siege: 'warden_siege' }
        : { melee: 'hollow_melee', ranged: 'hollow_ranged', siege: 'hollow_siege' };
    const facing = team === 'wardens' ? Math.PI / 2 : -Math.PI / 2;
    for (let i = 0; i < 12; i++) {
      addUnit(
        ids.melee,
        side * (6 + (i % 3) * 2) * K,
        (Math.floor(i / 3) - 1.5) * 2.4 * K,
        facing,
        'fighter',
        {
          range: 2.6 * K,
          speed: 5 * K,
          damage: between(14, 22),
        },
      );
    }
    for (let i = 0; i < 6; i++) {
      addUnit(
        ids.ranged,
        side * (13 + (i % 2) * 2) * K,
        (Math.floor(i / 2) - 1) * 3 * K,
        facing,
        'fighter',
        {
          range: 9 * K,
          speed: 5 * K,
          damage: between(12, 18),
        },
      );
    }
    for (let i = 0; i < 2; i++) {
      addUnit(ids.siege, side * 19 * K, (i ? 3 : -3) * K, facing, 'fighter', {
        range: 13 * K,
        speed: 3.5 * K,
        damage: 30,
      });
    }
  };
  wave('wardens');
  wave('hollow');
} else {
  // Camps around a central boss pit.
  const spots = [
    { x: -20, z: 12 },
    { x: 20, z: 12 },
    { x: -20, z: -12 },
    { x: 20, z: -12 },
  ];
  NEUTRAL_CAMPS.forEach((camp, i) => {
    const c = spots[i]!;
    camp.units.forEach((t, j) => {
      const a = (j / camp.units.length) * Math.PI * 2 + i;
      const size = Math.max(...camp.units.map((u) => CREEP_TYPES[u].scale));
      const r = camp.units.length > 1 ? 2.6 * Math.max(1, size) : 0;
      const d = addUnit(t, (c.x + Math.cos(a) * r) * K, (c.z + Math.sin(a) * r) * K, 0, 'camp');
      d.s.facing = facingOf(-Math.cos(a), -Math.sin(a), 0);
      if (j === 0) label(d.s.id, `${camp.family}: ${CREEP_TYPES[t].name}`);
    });
  });
  const boss = addUnit('boss', 0, 0, Math.PI, 'camp');
  label(boss.s.id, CREEP_TYPES.boss.name);
}

function nearestFoe(u: Driven): Driven | null {
  let best: Driven | null = null;
  let bestD = Infinity;
  for (const o of units) {
    if (o.dead || o.s.team === u.s.team || o.role !== 'fighter') continue;
    const d = (o.s.position.x - u.s.position.x) ** 2 + (o.s.position.z - u.s.position.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function swing(u: Driven, state: LogicalState = 'attack1') {
  u.s.animState = state;
  u.s.animSeq = (u.s.animSeq ?? 0) + 1;
}

function stepUnit(u: Driven, dt: number) {
  const s = u.s;
  s.snap = false;
  u.timer -= dt;
  switch (u.role) {
    case 'show-idle':
      s.animState = 'idle';
      return;
    case 'show-run':
      s.animState = 'run';
      return;
    case 'show-attack':
      if (u.timer <= 0) {
        swing(u, s.animSeq! % 3 === 2 ? 'attack2' : 'attack1');
        u.timer = 1.6;
      }
      return;
    case 'show-death':
      // Die, lie there a moment, stand back up (respawn), repeat.
      if (u.timer <= 0) {
        if (s.animState === 'death') {
          s.animState = 'idle';
          s.hp = s.maxHp;
          s.snap = true;
          u.timer = 0.6;
        } else {
          s.animState = 'death';
          s.hp = 0;
          u.timer = 3;
        }
      }
      return;
    case 'camp':
      // Idle, with the odd swing or shuffle so every clip shows up.
      if (u.timer <= 0) {
        const r = rand();
        if (r < 0.45) {
          swing(u, r < 0.2 ? 'attack2' : 'attack1');
          u.timer = between(1.5, 3);
        } else {
          s.animState = 'idle';
          u.timer = between(1, 3);
        }
      }
      return;
    case 'fighter':
      stepFighter(u, dt);
      return;
  }
}

function stepFighter(u: Driven, dt: number) {
  const s = u.s;
  if (u.dead) {
    if (u.timer <= 0) {
      // Respawn at the back of the wave.
      u.dead = false;
      s.hp = s.maxHp;
      s.animState = 'idle';
      s.position = { x: u.home.x * 1.15, z: u.home.z };
      s.snap = true;
      u.timer = between(0.2, 0.8);
    }
    return;
  }
  const foe = nearestFoe(u);
  if (!foe) {
    s.animState = 'idle';
    return;
  }
  // Lane creeps hold their rank (z) and advance along the lane (x) until the
  // nearest enemy is in range, so the two waves meet as lines, not a column.
  const dx = foe.s.position.x - s.position.x;
  const dz = foe.s.position.z - s.position.z;
  const d = Math.abs(dx);
  s.facing = facingOf(dx, dz * 0.3, s.facing);
  if (d > u.range) {
    const step = Math.min(u.speed * dt, d - u.range * 0.9);
    s.position = { x: s.position.x + Math.sign(dx) * step, z: s.position.z };
    s.animState = 'run';
    return;
  }
  if (s.animState === 'run') s.animState = 'idle';
  if (u.timer <= 0) {
    swing(u);
    u.timer = between(1.2, 1.6);
    foe.s.hp = Math.max(0, foe.s.hp - u.damage);
    if (foe.s.hp <= 0 && !foe.dead) {
      foe.dead = true;
      foe.s.animState = 'death';
      foe.timer = 3.5;
    }
  }
}

// ---- Input + panel --------------------------------------------------------------
let pointer: { x: number; y: number } | null = null;
canvas.addEventListener('pointermove', (e) => (pointer = { x: e.offsetX, y: e.offsetY }));
canvas.addEventListener('pointerleave', () => (pointer = null));
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const id = manager.pick(e.offsetX, e.offsetY);
  for (const u of units) u.s.selected = u.s.id === id;
});
for (const name of SCENES) {
  const b = document.createElement('button');
  b.textContent = name;
  b.disabled = name === sceneName;
  b.onclick = () => {
    params.set('scene', name);
    location.search = params.toString();
  };
  panel.append(b);
}
const pauseBtn = document.createElement('button');
pauseBtn.textContent = 'pause driver';
pauseBtn.onclick = () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'resume driver' : 'pause driver';
};
const hint = document.createElement('span');
hint.textContent = 'click: select · wheel: zoom · arrows/edge: pan';
panel.append(pauseBtn, hint);
if (closeUp) {
  const legend = document.createElement('span');
  legend.textContent = `rows (back→front): ${STATE_LABELS.join(' · ')}`;
  panel.append(legend);
}

const hud = createPerfHud(overlay, () => {});

let frames = 0;
window.__citadelCreeps = {
  scene: () => sceneName,
  counts: () => manager.counts,
  typeStats: () => manager.typeStats(),
  ids: () => units.map((u) => u.s.id),
  state: (id) => {
    const s = byId.get(id)?.s;
    return s ? structuredClone(s) : undefined;
  },
  shown: (id) => manager.shownState(id),
  frame: (id) => manager.view(id)?.frame ?? null,
  pause: (p) => {
    paused = p;
  },
  play: (id, state) => {
    const u = byId.get(id);
    if (u) swing(u, state);
  },
  screenPos: (id) => manager.screenPos(id),
  pick: (x, y) => manager.pick(x, y),
  select: (id) => {
    for (const u of units) u.s.selected = u.s.id === id;
  },
  frames: () => frames,
};

// ---- Frame loop -------------------------------------------------------------------
const usedTypes = [...new Set(units.map((u) => u.s.modelId))];
void manager.preload(usedTypes);
let readyAt = -1;
readStats(engine, scene, backend, 'low');
engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  if (!paused) for (const u of units) stepUnit(u, dt);
  else for (const u of units) u.s.snap = false;
  const hovered = pointer ? manager.pick(pointer.x, pointer.y) : null;
  for (const u of units) u.s.hovered = u.s.id === hovered;
  manager.sync(
    units.map((u) => u.s),
    dt,
  );
  scene.render();
  frames++;
  for (const l of labels) {
    const p = manager.screenPos(l.id);
    const h = l.el.textContent ? 1 : 0;
    l.el.style.display = p && h ? 'block' : 'none';
    if (p) {
      const top = manager.screenPos(l.id);
      l.el.style.left = `${p.x}px`;
      l.el.style.top = `${(top?.y ?? p.y) - 40 * K}px`;
    }
  }
  if (frames % 15 === 0) {
    const stats = readStats(engine, scene, backend, 'low');
    window.__citadelStats = stats;
    const c = manager.counts;
    hud.update(stats, [
      `scene   ${sceneName}`,
      `creeps  ${c.drawn}/${c.views} (${c.types} types)`,
      `bars    ${c.bars}`,
    ]);
  }
  const c = manager.counts;
  if (readyAt < 0 && c.loaded === units.length && c.types === usedTypes.length) readyAt = frames;
  if (readyAt >= 0 && frames - readyAt >= 30 && frames % 15 === 0) window.__citadelReady = true;
});
window.addEventListener('resize', () => engine.resize());
