/**
 * Draws every VFX sprite and decal into one canvas. All of it is original,
 * procedural art (CC0-clean by construction, nothing downloaded), drawn once
 * at startup.
 *
 * Shapes are white with alpha so they can be tinted per effect: particles via
 * their colour, decals via a per-instance colour that multiplies the texel.
 * Decal edges carry a dark halo so they stay readable on light and dark ground.
 */
import {
  ATLAS_CELL,
  ATLAS_SIZE,
  CELL_PAD,
  CONE_DRAWN_HALF_ANGLE,
  DECAL_CELLS,
  PARTICLE_CELLS,
  RING_INNER,
  cellOrigin,
} from './atlasLayout';

type Ctx = CanvasRenderingContext2D;

const S = ATLAS_CELL;
const P = CELL_PAD;
const C = S / 2;
/** Radius of circle-like decals, in px. */
const R = S / 2 - P;
const HALO = 'rgba(0,0,0,0.5)';
const HALO_WIDTH = 13;
const CORE_WIDTH = 5;

/** Small deterministic PRNG so the atlas is identical on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inCell(ctx: Ctx, index: number, draw: (ctx: Ctx) => void): void {
  const { x, y } = cellOrigin(index);
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.rect(0, 0, S, S);
  ctx.clip();
  draw(ctx);
  ctx.restore();
}

function radial(ctx: Ctx, x: number, y: number, r: number, stops: [number, number][]) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, a] of stops) g.addColorStop(at, `rgba(255,255,255,${a})`);
  return g;
}

/** Strokes the current path twice: a dark halo, then the white core. */
function outlined(ctx: Ctx, path: () => void, core = CORE_WIDTH, halo = HALO_WIDTH): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = HALO;
  ctx.lineWidth = halo;
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = core;
  ctx.beginPath();
  path();
  ctx.stroke();
}

// ---- particle sprites ---------------------------------------------------------

function drawDot(ctx: Ctx) {
  ctx.fillStyle = radial(ctx, C, C, C - P, [
    [0, 1],
    [0.2, 0.9],
    [0.5, 0.35],
    [1, 0],
  ]);
  ctx.fillRect(0, 0, S, S);
}

function drawSpark(ctx: Ctx) {
  // Long axis is vertical: stretched billboards align it with the velocity.
  ctx.save();
  ctx.translate(C, C);
  ctx.scale(0.32, 1);
  ctx.fillStyle = radial(ctx, 0, 0, C - P, [
    [0, 1],
    [0.35, 0.85],
    [1, 0],
  ]);
  ctx.fillRect(-S, -S, 2 * S, 2 * S);
  ctx.restore();
  const g = ctx.createLinearGradient(0, P, 0, S - P);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(C - 3, P, 6, S - 2 * P);
}

function drawRing(ctx: Ctx) {
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 10;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(C, C, C - P - 12, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSmoke(ctx: Ctx) {
  const rnd = mulberry32(7);
  for (let i = 0; i < 10; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * 24;
    const x = C + Math.cos(a) * d;
    const y = C + Math.sin(a) * d;
    const r = 20 + rnd() * 20;
    ctx.fillStyle = radial(ctx, x, y, r, [
      [0, 0.55],
      [0.6, 0.28],
      [1, 0],
    ]);
    ctx.fillRect(0, 0, S, S);
  }
  // Keep the puff round and inside the cell.
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = radial(ctx, C, C, C - P, [
    [0, 1],
    [0.7, 0.9],
    [1, 0],
  ]);
  ctx.fillRect(0, 0, S, S);
}

function drawStreak(ctx: Ctx) {
  // A tapered vertical blade, brightest toward the head (top).
  const g = ctx.createLinearGradient(0, S - P, 0, P);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.75, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.shadowColor = 'rgba(255,255,255,0.8)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(C, P);
  ctx.lineTo(C + 6, P + (S - 2 * P) * 0.25);
  ctx.lineTo(C, S - P);
  ctx.lineTo(C - 6, P + (S - 2 * P) * 0.25);
  ctx.closePath();
  ctx.fill();
}

function drawFeather(ctx: Ctx) {
  const top = P + 2;
  const bottom = S - P - 2;
  const vane = () => {
    ctx.beginPath();
    ctx.moveTo(C, bottom - 14);
    ctx.bezierCurveTo(C - 34, S * 0.7, C - 30, S * 0.22, C, top);
    ctx.bezierCurveTo(C + 28, S * 0.22, C + 32, S * 0.7, C, bottom - 14);
    ctx.closePath();
  };
  const g = ctx.createLinearGradient(0, bottom, 0, top);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = g;
  vane();
  ctx.fill();
  // Barb notches: cut thin diagonal gaps out of the vane.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = 'rgba(0,0,0,1)';
  ctx.lineWidth = 2;
  const rnd = mulberry32(11);
  for (let i = 0; i < 7; i++) {
    const y = S * 0.3 + i * 9 + rnd() * 4;
    const side = i % 2 === 0 ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(C + side * (8 + rnd() * 6), y);
    ctx.lineTo(C + side * 40, y - 14);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  // Shaft.
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(C, bottom);
  ctx.lineTo(C, top + 6);
  ctx.stroke();
}

function drawShard(ctx: Ctx) {
  // An angular stone chip with one lit and one shaded facet.
  const pts: [number, number][] = [
    [C - 6, P + 10],
    [C + 30, C - 18],
    [C + 22, C + 30],
    [C - 14, S - P - 8],
    [C - 34, C + 4],
  ];
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(150,150,150,1)';
  ctx.beginPath();
  ctx.moveTo(C + 2, C);
  ctx.lineTo(C + 22, C + 30);
  ctx.lineTo(C - 14, S - P - 8);
  ctx.closePath();
  ctx.fill();
}

// ---- ground decals ------------------------------------------------------------

function circlePath(ctx: Ctx, r: number) {
  ctx.moveTo(C + r, C);
  ctx.arc(C, C, r, 0, Math.PI * 2);
}

function drawCircleFill(ctx: Ctx) {
  ctx.fillStyle = radial(ctx, C, C, R, [
    [0, 0.35],
    [0.7, 0.55],
    [0.96, 1],
    [1, 0],
  ]);
  ctx.beginPath();
  circlePath(ctx, R);
  ctx.fill();
}

function drawCircleEdge(ctx: Ctx) {
  outlined(ctx, () => circlePath(ctx, R - 1));
}

function drawRingFill(ctx: Ctx) {
  const inner = R * RING_INNER;
  const g = ctx.createRadialGradient(C, C, inner, C, C, R);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.9, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  circlePath(ctx, R);
  ctx.moveTo(C + inner, C);
  ctx.arc(C, C, inner, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
}

function drawRingEdge(ctx: Ctx) {
  outlined(ctx, () => {
    circlePath(ctx, R - 1);
    ctx.moveTo(C + R * RING_INNER, C);
    ctx.arc(C, C, R * RING_INNER, 0, Math.PI * 2);
  });
}

/** Wedge with its apex at the bottom pad and its arc touching the top pad. */
function conePath(ctx: Ctx, inset = 0) {
  const ax = C;
  const ay = S - P;
  const r = S - 2 * P - inset;
  const up = -Math.PI / 2;
  ctx.moveTo(ax, ay);
  ctx.arc(ax, ay, r, up - CONE_DRAWN_HALF_ANGLE, up + CONE_DRAWN_HALF_ANGLE);
  ctx.closePath();
}

function drawConeFill(ctx: Ctx) {
  const r = S - 2 * P;
  ctx.fillStyle = radial(ctx, C, S - P, r, [
    [0, 0.3],
    [0.75, 0.55],
    [0.97, 1],
    [1, 0],
  ]);
  ctx.beginPath();
  conePath(ctx);
  ctx.fill();
}

function drawConeEdge(ctx: Ctx) {
  outlined(ctx, () => conePath(ctx, 1));
}

function drawLineFill(ctx: Ctx) {
  // Start at the bottom of the cell, end at the top: brighter toward the far end.
  const g = ctx.createLinearGradient(0, S - P, 0, P);
  g.addColorStop(0, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.85, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.97, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0.2)');
  ctx.fillStyle = g;
  ctx.fillRect(P, P, S - 2 * P, S - 2 * P);
}

function drawLineEdge(ctx: Ctx) {
  // Side rails only: a line decal stretches far more along its length than its
  // width, so an end cap would smear. The fill's bright far end marks the tip.
  // Rails are thicker than other edges: lines are often narrow (≈1 m), and the
  // rail width scales with the decal's width.
  const x0 = P + 4;
  const x1 = S - P - 4;
  outlined(
    ctx,
    () => {
      ctx.moveTo(x0, S - P);
      ctx.lineTo(x0, P);
      ctx.moveTo(x1, S - P);
      ctx.lineTo(x1, P);
    },
    9,
    16,
  );
}

function drawCrack(ctx: Ctx) {
  const rnd = mulberry32(23);
  type Seg = [number, number, number, number, number];
  const segs: Seg[] = [];
  const grow = (x: number, y: number, angle: number, length: number, width: number) => {
    let a = angle;
    let px = x;
    let py = y;
    let travelled = 0;
    while (travelled < length) {
      const step = 5 + rnd() * 6;
      a += (rnd() - 0.5) * 0.9;
      const nx = px + Math.cos(a) * step;
      const ny = py + Math.sin(a) * step;
      if (Math.hypot(nx - C, ny - C) > R - 4) break;
      const w = width * (1 - travelled / length) + 0.8;
      segs.push([px, py, nx, ny, w]);
      if (rnd() < 0.18 && width > 1.5)
        grow(nx, ny, a + (rnd() < 0.5 ? -1 : 1) * 0.8, length * 0.45, width * 0.6);
      px = nx;
      py = ny;
      travelled += step;
    }
  };
  const branches = 7;
  for (let i = 0; i < branches; i++) {
    grow(C, C, (i / branches) * Math.PI * 2 + rnd() * 0.5, R * (0.65 + rnd() * 0.35), 3.2);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of ['halo', 'core'] as const) {
    ctx.strokeStyle = pass === 'halo' ? HALO : '#fff';
    for (const [x0, y0, x1, y1, w] of segs) {
      ctx.lineWidth = pass === 'halo' ? w + 5 : w;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
}

const PAINTERS: Record<number, (ctx: Ctx) => void> = {
  [PARTICLE_CELLS.dot]: drawDot,
  [PARTICLE_CELLS.spark]: drawSpark,
  [PARTICLE_CELLS.ring]: drawRing,
  [PARTICLE_CELLS.smoke]: drawSmoke,
  [PARTICLE_CELLS.streak]: drawStreak,
  [PARTICLE_CELLS.feather]: drawFeather,
  [PARTICLE_CELLS.shard]: drawShard,
  [DECAL_CELLS.circleFill]: drawCircleFill,
  [DECAL_CELLS.circleEdge]: drawCircleEdge,
  [DECAL_CELLS.ringFill]: drawRingFill,
  [DECAL_CELLS.ringEdge]: drawRingEdge,
  [DECAL_CELLS.coneFill]: drawConeFill,
  [DECAL_CELLS.coneEdge]: drawConeEdge,
  [DECAL_CELLS.lineFill]: drawLineFill,
  [DECAL_CELLS.lineEdge]: drawLineEdge,
  [DECAL_CELLS.crack]: drawCrack,
};

/** Paints the whole atlas onto a 512² 2D context (transparent background). */
export function paintAtlas(ctx: Ctx): void {
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  for (const [index, paint] of Object.entries(PAINTERS)) inCell(ctx, Number(index), paint);
}
