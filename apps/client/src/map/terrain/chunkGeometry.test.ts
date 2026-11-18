import { describe, expect, it } from 'vitest';
import { buildChunkArrays } from './chunkGeometry';
import { sampleHeightGrid } from './heightGrid';
import { bakeControlMap } from './controlMap';
import { createHeightSampler, MAP_TO_WORLD } from './sampler';
import { CITADEL_MAP } from './citadelMap';
import { SPLAT_LAYERS, rampColor } from './splatPalette';
import { TERRAIN_UNIFORMS, terrainFragmentCode } from './terrainShaderCode';

const sampler = createHeightSampler(CITADEL_MAP, { step: 100 }); // 161 × 161, fast
const S = MAP_TO_WORLD;

describe('chunk geometry', () => {
  // Chunk (2, 2) of 40 cells covers the Warden base cliff and the mid ramp region.
  const spec = { ci: 2, cj: 2, cells: 40, stride: 1, scale: S, skirtDepth: 2 };
  const c = buildChunkArrays(sampler.grid, spec);

  it('has the expected vertex and triangle counts', () => {
    expect(c.surfaceTriangles).toBe(40 * 40 * 2);
    expect(c.positions.length / 3).toBe(41 * 41 + 4 * 41);
    expect(c.indices.length / 3).toBe(c.surfaceTriangles + 4 * 40 * 4);
  });

  it('winds every surface triangle like Babylon ground (front faces up)', () => {
    const p = c.positions;
    for (let t = 0; t < c.surfaceTriangles; t++) {
      const [a, b, d] = [c.indices[t * 3]!, c.indices[t * 3 + 1]!, c.indices[t * 3 + 2]!];
      const ux = p[b * 3]! - p[a * 3]!;
      const uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
      const vx = p[d * 3]! - p[a * 3]!;
      const vz = p[d * 3 + 2]! - p[a * 3 + 2]!;
      expect(ux * vz - uz * vx).toBeGreaterThan(0);
    }
  });

  it('the sampler interpolates on the same triangles as the mesh', () => {
    const p = c.positions;
    for (let t = 0; t < c.surfaceTriangles; t += 7) {
      const ids = [c.indices[t * 3]!, c.indices[t * 3 + 1]!, c.indices[t * 3 + 2]!];
      // Centroid of the triangle: its height is the mean of the corners on that plane.
      const cx = ids.reduce((s, k) => s + p[k * 3]!, 0) / 3;
      const cy = ids.reduce((s, k) => s + p[k * 3 + 1]!, 0) / 3;
      const cz = ids.reduce((s, k) => s + p[k * 3 + 2]!, 0) / 3;
      expect(sampleHeightGrid(sampler.grid, cx / S, cz / S) * S).toBeCloseTo(cy, 4);
    }
  });

  it('lower LODs subsample the same grid', () => {
    const lod = buildChunkArrays(sampler.grid, { ...spec, stride: 4, skirtDepth: 0 });
    expect(lod.surfaceTriangles).toBe(10 * 10 * 2);
    expect(lod.positions[1]).toBe(c.positions[1]); // shared corner
    expect(() => buildChunkArrays(sampler.grid, { ...spec, stride: 3 })).toThrow();
  });
});

describe('control map', () => {
  it('stores lane, biome, forest and paving per texel, south row first', () => {
    const size = 64;
    const data = bakeControlMap(sampler.field, size);
    expect(data.length).toBe(size * size * 4);
    const texel = (x: number, z: number) => {
      const i = Math.floor(((x + 8000) / 16000) * size);
      const j = Math.floor(((z + 8000) / 16000) * size);
      return Array.from(data.slice((j * size + i) * 4, (j * size + i) * 4 + 4));
    };
    expect(texel(-6000, -6000)[1]).toBe(0); // Warden biome, south-west
    expect(texel(6000, 6000)[1]).toBe(255); // Hollow biome, north-east
    expect(texel(-6000, -6000)[3]).toBeGreaterThan(128); // paving around the Hearthstone
    expect(texel(-2700, -3100)[0]).toBeGreaterThan(200); // mid lane dirt
  });
});

describe('splat palette and shader code', () => {
  it('ramps map luminance 0 / 0.5 / 1 to their dark / mid / light stops', () => {
    const grass = SPLAT_LAYERS.find((l) => l.id === 'grass')!;
    const hex = (rgb: number[]) =>
      '#' +
      rgb
        .map((v) =>
          Math.round(v * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
        .toUpperCase();
    expect(hex(rampColor(grass.warden, 0))).toBe(grass.warden[0]);
    expect(hex(rampColor(grass.warden, 0.5))).toBe(grass.warden[1]);
    expect(hex(rampColor(grass.warden, 1))).toBe(grass.warden[2]);
    // Contrast < 1 pulls toward the mid stop.
    expect(hex(rampColor(grass.warden, 0, 0))).toBe(grass.warden[1]);
  });

  it('uses the art-direction palette anchors', () => {
    const all = SPLAT_LAYERS.flatMap((l) => [...l.warden, ...l.hollow]);
    expect(all).toContain('#6F9A4E'); // Warden moss
    const rock = SPLAT_LAYERS.find((l) => l.id === 'rock')!;
    expect(rock.warden[2]).toBe('#CFC6B4'); // Warden stone
  });

  it('GLSL and WGSL declare the same hooks and read every uniform', () => {
    const glsl = terrainFragmentCode(false);
    const wgsl = terrainFragmentCode(true);
    expect(Object.keys(glsl).sort()).toEqual(Object.keys(wgsl).sort());
    const glslAll = Object.values(glsl).join('\n');
    const wgslAll = Object.values(wgsl).join('\n');
    for (const u of TERRAIN_UNIFORMS) {
      expect(glslAll, u).toContain(u);
      expect(wgslAll, u).toContain(`uniforms.${u}`);
    }
    expect(SPLAT_LAYERS.length).toBeGreaterThanOrEqual(4);
    expect(SPLAT_LAYERS.length).toBeLessThanOrEqual(8);
  });
});
