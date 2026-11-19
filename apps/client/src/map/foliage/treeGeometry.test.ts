import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGlb, readFirstImage, readFirstMesh } from './glb';
import { SPECIES } from './species';
import {
  buildCasterProxy,
  buildGrassTuft,
  buildProxy,
  faceNormal,
  hexToRgb,
  isFoliageColor,
  orientWinding,
  rampAt,
  recolorTree,
  triangleCount,
} from './treeGeometry';
import { WIND_UNIFORMS, windVertexCode, windWeight } from './windShaderCode';

const modelsDir = new URL('../../../public/models/', import.meta.url);
const load = (rel: string) => {
  const buf = readFileSync(new URL(rel, modelsDir));
  return parseGlb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
};

/** Fake atlas colours: foliage green above y = 30% of the top, brown bark below. */
function fakeAtlas(positions: Float32Array): Float32Array {
  let top = 0;
  for (let i = 1; i < positions.length; i += 3) top = Math.max(top, positions[i]!);
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length / 3; i++) {
    const leaf = positions[i * 3 + 1]! > top * 0.3;
    out.set(leaf ? [0, 0.45, 0.31] : [0.68, 0.42, 0.31], i * 3);
  }
  return out;
}

describe('glb reader', () => {
  it('reads every species model (quantized) with its embedded atlas', () => {
    for (const s of SPECIES) {
      const glb = load(s.model);
      const mesh = readFirstMesh(glb);
      expect(mesh.positions.length % 3).toBe(0);
      expect(mesh.indices.length % 3).toBe(0);
      expect(mesh.uvs.length / 2).toBe(mesh.positions.length / 3);
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 1; i < mesh.positions.length; i += 3) {
        minY = Math.min(minY, mesh.positions[i]!);
        maxY = Math.max(maxY, mesh.positions[i]!);
      }
      // Trees stand on y = 0 with roots a little below.
      expect(minY).toBeLessThan(0.05);
      expect(maxY).toBeGreaterThan(0.9);
      for (let i = 0; i < mesh.normals.length; i += 3) {
        expect(
          Math.hypot(mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!),
        ).toBeCloseTo(1, 3);
      }
      const img = readFirstImage(glb);
      expect(img.mimeType).toBe('image/png');
      expect(img.bytes[1]).toBe(0x50); // 'P' of the PNG signature
    }
  });

  it('dequantizes the KayKit pine to its source height', () => {
    const mesh = readFirstMesh(load('foliage-kaykit-halloween/pine_tall.glb'));
    let maxY = -Infinity;
    for (let i = 1; i < mesh.positions.length; i += 3) maxY = Math.max(maxY, mesh.positions[i]!);
    expect(maxY).toBeCloseTo(6.92, 1);
  });
});

describe('recolour', () => {
  it('classifies KayKit foliage and bark swatches', () => {
    const c = (hex: string) => hexToRgb(hex);
    for (const leaf of ['#007450', '#00a95d', '#b77332', '#d19846']) {
      expect(isFoliageColor(...c(leaf)), leaf).toBe(true);
    }
    for (const bark of ['#ad6c4f', '#8f4f3b', '#584b45', '#78685d', '#808080']) {
      expect(isFoliageColor(...c(bark)), bark).toBe(false);
    }
  });

  it('maps a ramp end to end', () => {
    const r = ['#000000', '#808080', '#ffffff'] as const;
    expect(rampAt(r, 0)).toEqual([0, 0, 0]);
    expect(rampAt(r, 1)).toEqual([1, 1, 1]);
    expect(rampAt(r, 0.5)[0]).toBeCloseTo(128 / 255, 5);
  });

  it('recolours a real tree into its species palette and measures the canopy', () => {
    const species = SPECIES.find((s) => s.id === 'warden-oak')!;
    const mesh = readFirstMesh(load(species.model));
    const { arrays, shape } = recolorTree(
      { ...mesh, atlasColors: fakeAtlas(mesh.positions) },
      species,
    );
    expect(arrays.colors.length).toBe((arrays.positions.length / 3) * 4);
    expect(shape.top).toBeGreaterThan(1);
    expect(shape.canopyBottom).toBeLessThan(shape.canopyTop);
    expect(shape.canopyRadius).toBeGreaterThan(0.2);
    expect(shape.foliageShare).toBeGreaterThan(0.3);
    // Leaves come out green (G channel dominant), within the ramp's range.
    let greenest = 0;
    for (let i = 0; i < arrays.colors.length; i += 4) {
      if (
        arrays.colors[i + 1]! > arrays.colors[i]! &&
        arrays.colors[i + 1]! > arrays.colors[i + 2]!
      )
        greenest++;
    }
    expect(greenest / (arrays.colors.length / 4)).toBeGreaterThan(0.3);
  });

  it('orients winding to match the normals', () => {
    const species = SPECIES[0]!;
    const mesh = readFirstMesh(load(species.model));
    const { arrays } = recolorTree({ ...mesh, atlasColors: fakeAtlas(mesh.positions) }, species);
    let agree = 0;
    for (let t = 0; t < arrays.indices.length; t += 3) {
      const [a, b, c] = [arrays.indices[t]!, arrays.indices[t + 1]!, arrays.indices[t + 2]!];
      const f = faceNormal(arrays.positions, a, b, c);
      const n = arrays.normals;
      agree += f[0] * n[a * 3]! + f[1] * n[a * 3 + 1]! + f[2] * n[a * 3 + 2]! >= 0 ? 1 : 0;
    }
    expect(agree / (arrays.indices.length / 3)).toBeGreaterThan(0.9);
    // Flipping is reversible.
    const idx = Uint32Array.from([0, 1, 2]);
    const pos = [0, 0, 0, 1, 0, 0, 0, 0, 1];
    const f = faceNormal(pos, 0, 1, 2);
    const nrm = [...f, ...f, ...f].map((v) => -v);
    expect(orientWinding(pos, nrm, idx).flipped).toBe(true);
    expect(Array.from(idx)).toEqual([0, 2, 1]);
  });
});

describe('proxies', () => {
  const shape = {
    top: 1.1,
    canopyBottom: 0.15,
    canopyTop: 1.1,
    canopyRadius: 0.34,
    foliageShare: 0.8,
  };
  it('builds far-LOD proxies far cheaper than the source trees, facing outward', () => {
    for (const proxy of ['cone', 'round'] as const) {
      const m = buildProxy(shape, { ...SPECIES[0]!, proxy });
      expect(triangleCount(m)).toBeLessThanOrEqual(30);
      // Side faces point away from the trunk axis.
      for (let t = 0; t < m.indices.length; t += 3) {
        const o = t * 3;
        const cx = (m.positions[o]! + m.positions[o + 3]! + m.positions[o + 6]!) / 3;
        const cz = (m.positions[o + 2]! + m.positions[o + 5]! + m.positions[o + 8]!) / 3;
        const out = cx * m.normals[o]! + cz * m.normals[o + 2]!;
        // Canopy undersides face down (and a touch inward); everything else faces out.
        if (m.normals[o + 1]! < -0.9) continue;
        expect(out, `${proxy} face ${t / 3}`).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  it('builds a closed 26-triangle dead-tree proxy', () => {
    const m = buildProxy(shape, { ...SPECIES[0]!, proxy: 'bare' });
    expect(triangleCount(m)).toBe(26);
    let top = 0;
    for (let i = 1; i < m.positions.length; i += 3) top = Math.max(top, m.positions[i]!);
    expect(top).toBeLessThanOrEqual(shape.top);
  });

  it('builds a unit caster proxy and a grass tuft', () => {
    const c = buildCasterProxy();
    let top = 0;
    for (let i = 1; i < c.positions.length; i += 3) top = Math.max(top, c.positions[i]!);
    expect(top).toBeCloseTo(1, 5);
    expect(triangleCount(c)).toBeLessThanOrEqual(30);
    const g = buildGrassTuft(5);
    expect(triangleCount(g)).toBe(5);
  });
});

describe('wind shader', () => {
  it('injects the same hooks in GLSL and WGSL and reads every uniform', () => {
    const glsl = windVertexCode(false);
    const wgsl = windVertexCode(true);
    expect(Object.keys(glsl).sort()).toEqual(Object.keys(wgsl).sort());
    const g = Object.values(glsl).join('\n');
    const w = Object.values(wgsl).join('\n');
    for (const u of WIND_UNIFORMS) {
      expect(g).toContain(u);
      expect(w).toContain(`uniforms.${u}`);
    }
    expect(g).toContain('worldPos');
    expect(w).toContain('worldPos');
  });

  it('sways the crown, not the roots', () => {
    expect(windWeight(0, 10)).toBe(0);
    expect(windWeight(-1, 10)).toBe(0);
    expect(windWeight(5, 10)).toBeCloseTo(0.25);
    expect(windWeight(10, 10)).toBe(1);
  });
});
