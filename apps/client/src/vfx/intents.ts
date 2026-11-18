/**
 * Telegraph intent colours and styling. Pure TypeScript.
 *
 * Priority follows docs/design/art-direction.md §2.2:
 *   enemy hard disables (red-edged) > ally buffs > damage > ambient/neutral.
 * Higher priority decals draw on top, have stronger edges and pulse harder.
 */
export type Intent = 'enemyDisable' | 'allyBuff' | 'damage' | 'neutral';

export const INTENTS: readonly Intent[] = ['enemyDisable', 'allyBuff', 'damage', 'neutral'];

export interface IntentStyle {
  /** Edge (outline) colour. */
  edge: string;
  /** Fill colour. */
  fill: string;
  /** Draw order: higher draws on top. */
  priority: number;
  edgeAlpha: number;
  fillAlpha: number;
  /** Edge pulse amplitude, 0..1. */
  pulse: number;
}

export const INTENT_STYLES: Readonly<Record<Intent, IntentStyle>> = {
  // Danger / enemy highlight from the master palette (§2.1).
  enemyDisable: {
    edge: '#E5484D',
    fill: '#E5484D',
    priority: 3,
    edgeAlpha: 1,
    fillAlpha: 0.42,
    pulse: 0.3,
  },
  // Ally highlight from the master palette (§2.1).
  allyBuff: {
    edge: '#46A758',
    // A lighter fill than the edge, so the area still separates from Warden moss.
    fill: '#7CD38A',
    priority: 2,
    edgeAlpha: 1,
    fillAlpha: 0.36,
    pulse: 0.12,
  },
  // Molten amber: warm like danger but clearly not the disable red.
  damage: {
    edge: '#F5A524',
    fill: '#F5A524',
    priority: 1,
    edgeAlpha: 0.95,
    fillAlpha: 0.3,
    pulse: 0.08,
  },
  // Warden cream: indicators with no gameplay threat (range previews, ambient).
  neutral: {
    edge: '#EFE6D2',
    fill: '#EFE6D2',
    priority: 0,
    edgeAlpha: 0.7,
    fillAlpha: 0.16,
    pulse: 0,
  },
};

export function isIntent(value: unknown): value is Intent {
  return typeof value === 'string' && (INTENTS as readonly string[]).includes(value);
}

/** Linear 0..1 RGB from `#RGB` or `#RRGGBB`. Throws on anything else. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Bad colour "${hex}"`);
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
