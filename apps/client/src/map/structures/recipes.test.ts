import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STRUCTURE_KINDS } from './placement';
import { isKitPart, PIECE_IDS, piecesFor, RECIPES, recipeVariants, SWATCHES } from './recipes';

const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../../assets-src/kaykit-medieval-hexagon/manifest.json', import.meta.url),
    ),
    'utf8',
  ),
) as { models: { out: string }[] };

describe('structure recipes', () => {
  it('covers every kind for both factions, plus the neutral shops', () => {
    for (const side of ['wardens', 'hollow'] as const) {
      for (const kind of STRUCTURE_KINDS) {
        if (kind === 'shop_side' || kind === 'shop_secret') continue;
        expect(RECIPES.has(`${side}:${kind}`), `${side}:${kind}`).toBe(true);
      }
    }
    expect(RECIPES.has('neutral:shop_side')).toBe(true);
    expect(RECIPES.has('neutral:shop_secret')).toBe(true);
    expect(recipeVariants()).toHaveLength(RECIPES.size);
  });

  it('only uses pieces the asset pipeline builds', () => {
    const built = new Set(manifest.models.map((m) => m.out));
    for (const id of PIECE_IDS) expect(built.has(id), id).toBe(true);
    expect(piecesFor(RECIPES.keys()).every((p) => built.has(p))).toBe(true);
  });

  it('every part is well formed', () => {
    for (const [v, r] of RECIPES) {
      expect(r.parts.length, v).toBeGreaterThan(0);
      expect(r.footprint, v).toBeGreaterThan(0);
      // LOD1 keeps something: detail parts are never the whole structure.
      expect(
        r.parts.some((p) => !p.detail),
        v,
      ).toBe(true);
      for (const p of r.parts) {
        for (const n of p.at ?? []) expect(Number.isFinite(n), v).toBe(true);
        if (!isKitPart(p) && p.swatch) expect(SWATCHES[p.swatch], v).toBeDefined();
      }
      if (r.parts.some((p) => p.float))
        expect(r.hover, `${v} floats but has no hover`).toBeDefined();
    }
  });

  it('tall silhouettes cast shadows; low structures do not (shadow policy)', () => {
    for (const [v, r] of RECIPES) {
      const tall = v.includes('tower') || v.endsWith(':ancient');
      expect(r.castsShadow, v).toBe(tall);
    }
  });
});
