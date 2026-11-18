/**
 * Bakes the splat control map: RGBA8, one texel per `map size / size` map
 * units, row 0 = the map's south edge (z = −size/2), column 0 = west.
 * R = lane dirt, G = biome (0 Warden, 1 Hollow), B = forest floor, A = base paving.
 * Generated at load time from the map data, so it costs no download. Pure.
 */
import type { SplatSample, TerrainField } from './heightfield';

export function bakeControlMap(field: TerrainField, size: number): Uint8Array {
  const extent = Math.max(field.map.size.width, field.map.size.depth);
  const texel = extent / size;
  const out = new Uint8Array(size * size * 4);
  const s: SplatSample = { lane: 0, faction: 0, forest: 0, court: 0 };
  for (let j = 0; j < size; j++) {
    const z = -extent / 2 + (j + 0.5) * texel;
    for (let i = 0; i < size; i++) {
      field.splatAt(-extent / 2 + (i + 0.5) * texel, z, s);
      const o = (j * size + i) * 4;
      out[o] = Math.round(s.lane * 255);
      out[o + 1] = Math.round(s.faction * 255);
      out[o + 2] = Math.round(s.forest * 255);
      out[o + 3] = Math.round(s.court * 255);
    }
  }
  return out;
}
