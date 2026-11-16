import { QUALITY_TIERS, type QualityTier } from './quality';
import type { CitadelStats } from './stats';

export interface PerfHud {
  /** Redraws the panel. `extraLines` lets other systems (net, sim) add rows. */
  update(stats: CitadelStats, extraLines?: readonly string[]): void;
  toggle(force?: boolean): void;
  readonly visible: boolean;
}

/** Same budget as docs/plan/roadmap.md (M1); rows turn red when over it. */
const BUDGET = { drawCalls: 150, triangles: 300_000, jsHeapMB: 400 };

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * Perf HUD in the `#overlay` element. Backtick toggles it; `?hud=0` starts
 * hidden. Tier buttons switch quality at runtime without a reload.
 */
export function createPerfHud(
  root: HTMLElement,
  onSelectTier: (tier: QualityTier) => void,
): PerfHud {
  root.textContent = '';
  const body = document.createElement('div');
  body.className = 'hud-body';
  const tiers = document.createElement('div');
  tiers.className = 'hud-tiers';
  const buttons = new Map<QualityTier, HTMLButtonElement>();
  for (const tier of QUALITY_TIERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = tier;
    b.addEventListener('click', () => onSelectTier(tier));
    buttons.set(tier, b);
    tiers.append(b);
  }
  const hint = document.createElement('div');
  hint.className = 'hud-hint';
  hint.textContent = '` toggles';
  root.append(body, tiers, hint);

  let visible = new URLSearchParams(location.search).get('hud') !== '0';
  const apply = () => root.classList.toggle('hidden', !visible);
  apply();

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Backquote' || e.repeat || isTyping(e.target)) return;
    hud.toggle();
  });

  const row = (label: string, value: string, over = false) =>
    `<span class="${over ? 'over' : ''}">${label.padEnd(8)}${value}</span>`;

  const hud: PerfHud = {
    get visible() {
      return visible;
    },
    toggle(force) {
      visible = force ?? !visible;
      apply();
    },
    update(s, extraLines = []) {
      if (!visible) return;
      const lines = [
        row('backend', s.backend),
        row('tier', s.tier),
        row('fps', String(s.fps)),
        row('frame', `${s.frameTimeMs.toFixed(1)} ms (cpu ${s.cpuFrameMs.toFixed(1)})`),
        row('draws', String(s.drawCalls), s.drawCalls > BUDGET.drawCalls),
        row('meshes', String(s.activeMeshes)),
        row('tris', s.triangles.toLocaleString('en-US'), s.triangles > BUDGET.triangles),
      ];
      if (s.jsHeapMB !== null) {
        lines.push(row('heap', `${s.jsHeapMB.toFixed(0)} MB`, s.jsHeapMB > BUDGET.jsHeapMB));
      }
      for (const l of extraLines) lines.push(`<span>${l.replace(/[<&]/g, '')}</span>`);
      body.innerHTML = lines.join('\n');
      for (const [tier, b] of buttons) b.classList.toggle('active', tier === s.tier);
    },
  };
  return hud;
}
