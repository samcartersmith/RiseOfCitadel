/**
 * Minimal GLB reader for the foliage models (M1-07). The trees are static,
 * single-primitive, KHR_mesh_quantization meshes produced by the asset
 * pipeline (tools/assets/build.ts), and the renderer re-bakes them into
 * vertex-coloured thin-instance meshes, so it reads the binary directly
 * instead of instantiating glTF scene graphs. Pure: no DOM, no Babylon.
 */

interface GltfJson {
  accessors: {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    normalized?: boolean;
    count: number;
    type: string;
  }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  meshes: {
    primitives: { attributes: Record<string, number>; indices?: number; material?: number }[];
  }[];
  nodes: {
    mesh?: number;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
  }[];
  images?: { bufferView?: number; mimeType?: string }[];
}

export interface Glb {
  json: GltfJson;
  bin: DataView;
}

export function parseGlb(buffer: ArrayBuffer): Glb {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let offset = 12;
  let json: GltfJson | null = null;
  let bin: DataView | null = null;
  while (offset < view.byteLength) {
    const len = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, len))) as GltfJson;
    } else if (type === 0x004e4942) {
      bin = new DataView(buffer, start, len);
    }
    offset = start + len;
  }
  if (!json || !bin) throw new Error('GLB missing JSON or BIN chunk');
  return { json, bin };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** Reads an accessor as floats, applying `normalized` integer decoding. */
export function readAccessor(glb: Glb, index: number): Float32Array {
  const a = glb.json.accessors[index]!;
  const bv = glb.json.bufferViews[a.bufferView ?? 0]!;
  const comps = COMPONENTS[a.type]!;
  const size = BYTES[a.componentType]!;
  const stride = bv.byteStride ?? comps * size;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float32Array(a.count * comps);
  const d = glb.bin;
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < comps; c++) {
      const o = base + i * stride + c * size;
      let v: number;
      switch (a.componentType) {
        case 5120:
          v = d.getInt8(o);
          if (a.normalized) v = Math.max(v / 127, -1);
          break;
        case 5121:
          v = d.getUint8(o);
          if (a.normalized) v /= 255;
          break;
        case 5122:
          v = d.getInt16(o, true);
          if (a.normalized) v = Math.max(v / 32767, -1);
          break;
        case 5123:
          v = d.getUint16(o, true);
          if (a.normalized) v /= 65535;
          break;
        case 5125:
          v = d.getUint32(o, true);
          break;
        default:
          v = d.getFloat32(o, true);
      }
      out[i * comps + c] = v;
    }
  }
  return out;
}

export interface GlbMesh {
  /** Positions in the model's own units, converted to Babylon's left-handed axes (z negated). */
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/**
 * The first mesh node, with its node translation/scale applied (quantized
 * meshes carry their dequantisation in the node). Rotations on the node are
 * not supported (none of the foliage models has one) and throw.
 */
export function readFirstMesh(glb: Glb): GlbMesh {
  const node = glb.json.nodes.find((n) => n.mesh !== undefined);
  if (!node) throw new Error('GLB has no mesh node');
  if (node.matrix || (node.rotation && Math.abs(node.rotation[3]! - 1) > 1e-6)) {
    throw new Error('foliage GLB nodes must not be rotated');
  }
  const prim = glb.json.meshes[node.mesh!]!.primitives[0]!;
  const pos = readAccessor(glb, prim.attributes['POSITION']!);
  const nrm = readAccessor(glb, prim.attributes['NORMAL']!);
  const uvs = readAccessor(glb, prim.attributes['TEXCOORD_0']!);
  const idx = prim.indices !== undefined ? readAccessor(glb, prim.indices) : null;
  const t = node.translation ?? [0, 0, 0];
  const s = node.scale ?? [1, 1, 1];
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = pos[i * 3]! * s[0]! + t[0]!;
    pos[i * 3 + 1] = pos[i * 3 + 1]! * s[1]! + t[1]!;
    pos[i * 3 + 2] = -(pos[i * 3 + 2]! * s[2]! + t[2]!);
    // Normals: inverse-transpose of a scale is 1/s; renormalise. Negate z with the positions.
    let nx = nrm[i * 3]! / s[0]!;
    let ny = nrm[i * 3 + 1]! / s[1]!;
    let nz = -nrm[i * 3 + 2]! / s[2]!;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    nrm[i * 3] = nx;
    nrm[i * 3 + 1] = ny;
    nrm[i * 3 + 2] = nz;
  }
  const indices = idx ? Uint32Array.from(idx) : Uint32Array.from({ length: n }, (_, i) => i);
  return { positions: pos, normals: nrm, uvs, indices };
}

/** The first embedded image's bytes and MIME type. */
export function readFirstImage(glb: Glb): { bytes: Uint8Array; mimeType: string } {
  const img = glb.json.images?.[0];
  if (!img || img.bufferView === undefined) throw new Error('GLB has no embedded image');
  const bv = glb.json.bufferViews[img.bufferView]!;
  const bytes = new Uint8Array(
    glb.bin.buffer,
    glb.bin.byteOffset + (bv.byteOffset ?? 0),
    bv.byteLength,
  );
  return { bytes, mimeType: img.mimeType ?? 'image/png' };
}

/** Samples an RGBA8 image at each vertex UV (nearest texel, glTF UV origin top-left). */
export function sampleAtlas(
  uvs: ArrayLike<number>,
  pixels: ArrayLike<number>,
  width: number,
  height: number,
): Float32Array {
  const n = uvs.length / 2;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = Math.min(width - 1, Math.max(0, Math.floor(uvs[i * 2]! * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(uvs[i * 2 + 1]! * height)));
    const o = (y * width + x) * 4;
    out[i * 3] = pixels[o]! / 255;
    out[i * 3 + 1] = pixels[o + 1]! / 255;
    out[i * 3 + 2] = pixels[o + 2]! / 255;
  }
  return out;
}
