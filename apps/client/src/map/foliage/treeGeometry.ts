/**
 * Pure geometry for foliage (M1-07): recolouring a loaded tree into the
 * Citadel palette as vertex colours, and generating the far-LOD proxies, the
 * shared shadow-caster proxy and the grass tuft. No Babylon, no DOM.
 */
import type { ProxyShape, Ramp, SpeciesDef } from './species';

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** RGBA, 0..1 sRGB (StandardMaterial vertex colours). */
  colors: Float32Array;
}

/** A tree mesh as read from the GLB, with the atlas colour sampled at each vertex (RGB 0..1). */
export interface SourceTree {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  indices: ArrayLike<number>;
  atlasColors: ArrayLike<number>;
}

/** What the recolour pass measured about a tree (model units). */
export interface TreeShape {
  /** Top of the model (y). Ground is y = 0. */
  top: number;
  /** Canopy (foliage) vertical extent and radius; for a bare tree, the branch crown. */
  canopyBottom: number;
  canopyTop: number;
  canopyRadius: number;
  /** Fraction of vertices classified as foliage. */
  foliageShare: number;
}

// --------------------------------------------------------------------- colour helpers

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Colour at t (0..1) along a 3-stop ramp. */
export function rampAt(ramp: Ramp, t: number, out: number[] = [0, 0, 0]): number[] {
  const c = Math.min(1, Math.max(0, t));
  const [a, b] = c < 0.5 ? [ramp[0], ramp[1]] : [ramp[1], ramp[2]];
  const k = c < 0.5 ? c * 2 : (c - 0.5) * 2;
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  for (let i = 0; i < 3; i++) out[i] = ca[i]! + (cb[i]! - ca[i]!) * k;
  return out;
}

export const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Leaves or bark? KayKit atlases paint foliage in saturated greens/teals (or
 * saturated orange-gold on the Halloween pines) and bark in browns and greys.
 * Greens (hue 60°–200°) above 30% saturation, or anything above 62%
 * saturation, count as foliage.
 */
export function isFoliageColor(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const sat = max > 0 ? d / max : 0;
  if (d < 1e-6) return false;
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / d + 6) % 6);
  else if (max === g) hue = 60 * ((b - r) / d + 2);
  else hue = 60 * ((r - g) / d + 4);
  if (hue >= 60 && hue <= 200 && sat > 0.3) return true;
  return sat > 0.62;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Recolours a tree into its species' palette: every vertex is classified as
 * foliage or bark from its atlas colour, its luma is normalised across that
 * class (so the KayKit swatch gradients spread over the whole ramp), mixed
 * with height (lighter toward the crown) and mapped through the species ramp.
 * Vertices near the ground get a little baked occlusion.
 */
export function recolorTree(
  src: SourceTree,
  species: Pick<SpeciesDef, 'foliage' | 'bark'>,
): { arrays: MeshArrays; shape: TreeShape } {
  const n = src.positions.length / 3;
  const leaf = new Uint8Array(n);
  const l = new Float32Array(n);
  let top = 0;
  const range = { leaf: [Infinity, -Infinity], bark: [Infinity, -Infinity] };
  let leaves = 0;
  for (let i = 0; i < n; i++) {
    const r = src.atlasColors[i * 3]!;
    const g = src.atlasColors[i * 3 + 1]!;
    const b = src.atlasColors[i * 3 + 2]!;
    leaf[i] = isFoliageColor(r, g, b) ? 1 : 0;
    l[i] = luma(r, g, b);
    const k = leaf[i] ? range.leaf : range.bark;
    k[0] = Math.min(k[0]!, l[i]!);
    k[1] = Math.max(k[1]!, l[i]!);
    leaves += leaf[i]!;
    top = Math.max(top, src.positions[i * 3 + 1]!);
  }
  const bare = leaves < n * 0.1;
  let cb = Infinity;
  let ct = -Infinity;
  let cr = 0;
  const colors = new Float32Array(n * 4);
  const c = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = src.positions[i * 3]!;
    const y = src.positions[i * 3 + 1]!;
    const z = src.positions[i * 3 + 2]!;
    const isLeaf = leaf[i] === 1;
    const k = isLeaf ? range.leaf : range.bark;
    const span = k[1]! - k[0]!;
    const tl = span > 1e-4 ? (l[i]! - k[0]!) / span : 0.5;
    const th = top > 0 ? Math.max(0, y) / top : 0;
    const t = isLeaf ? 0.15 + 0.55 * tl + 0.3 * th : 0.1 + 0.45 * tl + 0.45 * th;
    rampAt(isLeaf ? species.foliage : species.bark, t, c);
    const ao = 0.7 + 0.3 * smooth(0, 0.3, th);
    colors[i * 4] = c[0]! * ao;
    colors[i * 4 + 1] = c[1]! * ao;
    colors[i * 4 + 2] = c[2]! * ao;
    colors[i * 4 + 3] = 1;
    // Canopy extents: the leaves, or for a bare tree the upper 55% of the branches.
    if (bare ? th > 0.45 : isLeaf) {
      cb = Math.min(cb, y);
      ct = Math.max(ct, y);
      cr = Math.max(cr, Math.hypot(x, z));
    }
  }
  return {
    arrays: {
      positions: Float32Array.from(src.positions),
      normals: Float32Array.from(src.normals),
      indices: orientWinding(src.positions, src.normals, Uint32Array.from(src.indices)).indices,
      colors,
    },
    shape: {
      top,
      canopyBottom: Number.isFinite(cb) ? cb : top * 0.4,
      canopyTop: Number.isFinite(ct) ? ct : top,
      canopyRadius: cr || top * 0.3,
      foliageShare: leaves / Math.max(1, n),
    },
  };
}

/**
 * Face normal in Babylon's convention (what `VertexData.ComputeNormals` and
 * front-face culling agree on): with u = b − a and v = c − a, n = v × u.
 */
export function faceNormal(
  p: ArrayLike<number>,
  ia: number,
  ib: number,
  ic: number,
): [number, number, number] {
  const ux = p[ib * 3]! - p[ia * 3]!;
  const uy = p[ib * 3 + 1]! - p[ia * 3 + 1]!;
  const uz = p[ib * 3 + 2]! - p[ia * 3 + 2]!;
  const vx = p[ic * 3]! - p[ia * 3]!;
  const vy = p[ic * 3 + 1]! - p[ia * 3 + 1]!;
  const vz = p[ic * 3 + 2]! - p[ia * 3 + 2]!;
  return [vy * uz - vz * uy, vz * ux - vx * uz, vx * uy - vy * ux];
}

/**
 * Makes triangle winding agree with the stored vertex normals (majority vote)
 * and returns the indices, flipped in place if needed. Geometry copied out of
 * a glTF (right-handed, counter-clockwise) into a plain Babylon mesh needs it.
 */
export function orientWinding(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  indices: Uint32Array,
): { indices: Uint32Array; flipped: boolean } {
  let agree = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    const f = faceNormal(positions, a, b, c);
    let d = 0;
    for (const v of [a, b, c]) {
      d += f[0] * normals[v * 3]! + f[1] * normals[v * 3 + 1]! + f[2] * normals[v * 3 + 2]!;
    }
    agree += d >= 0 ? 1 : -1;
  }
  if (agree >= 0) return { indices, flipped: false };
  for (let t = 0; t < indices.length; t += 3) {
    const tmp = indices[t + 1]!;
    indices[t + 1] = indices[t + 2]!;
    indices[t + 2] = tmp;
  }
  return { indices, flipped: true };
}

// --------------------------------------------------------------------- flat-shaded builder

/** Collects coloured triangles and emits flat-shaded arrays (one normal per face). */
class TriBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  tri(a: number[], b: number[], c: number[], ca: number[], cb = ca, cc = ca): void {
    this.pos.push(...a, ...b, ...c);
    this.col.push(...ca, 1, ...cb, 1, ...cc, 1);
  }
  quad(a: number[], b: number[], c: number[], d: number[], ca: number[], cb = ca): void {
    // a-b bottom, d-c top; colours: bottom ca, top cb.
    this.tri(a, b, c, ca, ca, cb);
    this.tri(a, c, d, ca, cb, cb);
  }
  build(): MeshArrays {
    const positions = Float32Array.from(this.pos);
    const n = positions.length / 3;
    const normals = new Float32Array(n * 3);
    for (let t = 0; t < n; t += 3) {
      const o = t * 3;
      const f = faceNormal(positions, t, t + 1, t + 2);
      const len = Math.hypot(f[0], f[1], f[2]) || 1;
      const nx = f[0] / len;
      const ny = f[1] / len;
      const nz = f[2] / len;
      for (let k = 0; k < 3; k++) {
        normals[o + k * 3] = nx;
        normals[o + k * 3 + 1] = ny;
        normals[o + k * 3 + 2] = nz;
      }
    }
    const indices = new Uint32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    return { positions, normals, indices, colors: Float32Array.from(this.col) };
  }
}

const ring = (segments: number, radius: number, y: number, phase = 0): number[][] =>
  Array.from({ length: segments }, (_, i) => {
    const a = phase + (i / segments) * Math.PI * 2;
    return [Math.cos(a) * radius, y, Math.sin(a) * radius];
  });

/** Side wall between two rings (lower → upper), outward-facing in Babylon's winding. */
function band(b: TriBuilder, lo: number[][], hi: number[][], cLo: number[], cHi: number[]) {
  const s = lo.length;
  for (let i = 0; i < s; i++) {
    const j = (i + 1) % s;
    b.quad(lo[i]!, lo[j]!, hi[j]!, hi[i]!, cLo, cHi);
  }
}

function fan(
  b: TriBuilder,
  rim: number[][],
  apex: number[],
  cRim: number[],
  cApex: number[],
  up: boolean,
) {
  const s = rim.length;
  for (let i = 0; i < s; i++) {
    const j = (i + 1) % s;
    if (up) b.tri(rim[i]!, rim[j]!, apex, cRim, cRim, cApex);
    else b.tri(rim[j]!, rim[i]!, apex, cRim, cRim, cApex);
  }
}

/**
 * Far-LOD stand-in for a species: a 4-sided trunk plus a faceted canopy (a
 * cone or a rounded double cone), vertex-coloured from the species ramps, in
 * the model's own units so it shares the near mesh's material, instance
 * matrices and wind weights. Dead trees ('bare') get a tapered trunk with
 * three closed branch prisms.
 */
export function buildProxy(
  shape: TreeShape,
  species: Pick<SpeciesDef, 'foliage' | 'bark' | 'proxy'>,
): MeshArrays {
  const b = new TriBuilder();
  const { canopyBottom: y0, canopyTop: y1, canopyRadius: R, top } = shape;
  const bark = rampAt(species.bark, 0.35);
  const barkHi = rampAt(species.bark, 0.6);
  const trunkR = Math.max(R * 0.12, top * 0.025);
  const kind: ProxyShape = species.proxy;
  if (kind === 'bare') return bareProxy(b, shape, species, trunkR);
  const trunkTop = y0 + (y1 - y0) * 0.25;
  band(
    b,
    ring(4, trunkR, 0, Math.PI / 4),
    ring(4, trunkR * 0.7, trunkTop, Math.PI / 4),
    bark,
    barkHi,
  );
  if (kind === 'cone') {
    const lo = rampAt(species.foliage, 0.3);
    const hi = rampAt(species.foliage, 0.85);
    const base = ring(6, R, y0);
    fan(b, base, [0, y1, 0], lo, hi, true);
    fan(b, base, [0, y0 + (y1 - y0) * 0.05, 0], lo, lo, false);
  } else {
    const c0 = rampAt(species.foliage, 0.25);
    const c1 = rampAt(species.foliage, 0.5);
    const c2 = rampAt(species.foliage, 0.75);
    const c3 = rampAt(species.foliage, 0.95);
    const r1 = ring(5, R, y0 + (y1 - y0) * 0.35);
    const r2 = ring(5, R * 0.72, y0 + (y1 - y0) * 0.75, Math.PI / 5);
    fan(b, r1, [0, y0, 0], c1, c0, false);
    band(b, r1, r2, c1, c2);
    fan(b, r2, [0, y1, 0], c2, c3, true);
  }
  return b.build();
}

const shift = (pts: number[][], dx: number, dz: number) =>
  pts.map(([x, y, z]) => [x! + dx, y!, z! + dz]);

/** Dead-tree stand-in: a tapered trunk and three closed branch prisms reaching up to the crown. */
function bareProxy(
  b: TriBuilder,
  shape: TreeShape,
  species: Pick<SpeciesDef, 'bark'>,
  trunkR: number,
): MeshArrays {
  const { canopyRadius: R, top } = shape;
  const lo = rampAt(species.bark, 0.3);
  const mid = rampAt(species.bark, 0.55);
  const hi = rampAt(species.bark, 0.85);
  band(b, ring(4, trunkR, 0, Math.PI / 4), ring(4, trunkR * 0.3, top * 0.9, Math.PI / 4), lo, mid);
  for (let k = 0; k < 3; k++) {
    const a = 0.4 + (k / 3) * Math.PI * 2;
    const base = ring(3, trunkR * 0.45, top * (0.42 + k * 0.1), a);
    const tip = shift(
      ring(3, trunkR * 0.12, top * 0.97, a),
      Math.cos(a) * R * 0.85,
      Math.sin(a) * R * 0.85,
    );
    band(b, base, tip, mid, hi);
  }
  return b.build();
}

/**
 * The shared shadow-caster proxy: a unit tree (height 1, canopy radius 0.5)
 * that every species uses, scaled per instance to that tree's height and
 * canopy radius. One mesh per cell casts for every species, which keeps the
 * shadow passes at one draw per cell per cascade.
 */
export function buildCasterProxy(): MeshArrays {
  const b = new TriBuilder();
  const c = [0, 0, 0];
  band(b, ring(3, 0.06, 0), ring(3, 0.05, 0.4), c, c);
  const r1 = ring(5, 0.5, 0.5);
  const r2 = ring(5, 0.34, 0.8, Math.PI / 5);
  fan(b, r1, [0, 0.28, 0], c, c, false);
  band(b, r1, r2, c, c);
  fan(b, r2, [0, 1, 0], c, c, true);
  return b.build();
}

/**
 * A grass tuft: `blades` tapered single triangles leaning outward, height 1,
 * grey value gradient (base dark, tip light) that the per-instance colour
 * tints to the biome. Normals point up so tufts light like the ground under
 * them; the material draws both sides.
 */
export function buildGrassTuft(blades = 5): MeshArrays {
  const pos: number[] = [];
  const col: number[] = [];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + (i % 2) * 0.4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const r0 = 0.08 + (i % 3) * 0.04;
    const w = 0.07;
    const lean = 0.28 + (i % 2) * 0.12;
    const h = 0.75 + ((i * 37) % 5) * 0.06;
    // Base edge perpendicular to the lean direction.
    pos.push(ca * r0 - sa * w, 0, sa * r0 + ca * w);
    pos.push(ca * r0 + sa * w, 0, sa * r0 - ca * w);
    pos.push(ca * (r0 + lean), h, sa * (r0 + lean));
    col.push(0.55, 0.55, 0.55, 1, 0.55, 0.55, 0.55, 1, 1, 1, 1, 1);
  }
  const n = pos.length / 3;
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) normals[i * 3 + 1] = 1;
  const indices = new Uint32Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  return { positions: Float32Array.from(pos), normals, indices, colors: Float32Array.from(col) };
}

export const triangleCount = (m: { indices: ArrayLike<number> }): number => m.indices.length / 3;
