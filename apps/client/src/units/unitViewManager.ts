import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { BarRenderer, type BarEntry } from './bars';
import { RingRenderer, type RingEntry } from './rings';
import { UnitView, type UnitViewOptions } from './unitView';
import { diffStates, pickNearest, type ScreenTarget } from './diff';
import type { ModelId } from './modelConfig';
import type { Team, UnitId, UnitViewState } from './unitState';

export interface UnitViewCounts {
  /** Views alive (loaded or loading). */
  views: number;
  /** Views whose model has finished loading. */
  loaded: number;
  /** Bars drawn last frame. */
  bars: number;
  /** Rings drawn last frame. */
  rings: number;
}

/**
 * Owns every UnitView in a scene. Each frame, `sync(states, dt)` diffs the
 * incoming states by id (create / update / recreate on model change /
 * dispose) and redraws all bars and rings through two shared thin-instanced
 * meshes, so bars + rings cost 2 draw calls total regardless of unit count.
 */
export class UnitViewManager {
  readonly bars: BarRenderer;
  readonly rings: RingRenderer;
  private readonly views = new Map<UnitId, UnitView>();
  private readonly scene: Scene;
  private readonly options: UnitViewOptions;
  private warnedDuplicate = false;

  constructor(scene: Scene, options: UnitViewOptions = {}) {
    this.scene = scene;
    this.options = { ...options };
    this.bars = new BarRenderer(scene);
    this.rings = new RingRenderer(scene);
  }

  /** Apply this frame's states. Anything not in `states` is disposed. */
  sync(states: readonly UnitViewState[], dt: number): void {
    const live = new Map<UnitId, ModelId>();
    for (const [id, v] of this.views) live.set(id, v.modelId);
    const diff = diffStates(live, states);
    if (
      !this.warnedDuplicate &&
      diff.added.length + diff.kept.length + diff.replaced.length < states.length
    ) {
      this.warnedDuplicate = true;
      console.warn('[citadel] UnitViewManager.sync: duplicate unit ids; extra states ignored');
    }
    for (const id of diff.removed) this.remove(id);
    for (const id of diff.replaced) this.remove(id);

    const seen = new Set<UnitId>();
    const bars: BarEntry[] = [];
    const rings: RingEntry[] = [];
    for (const s of states) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      let view = this.views.get(s.id);
      if (!view) {
        view = new UnitView(this.scene, { ...s, snap: true }, this.options);
        view.ready.catch((err) => console.error(`[citadel] unit ${s.id} failed to load`, err));
        this.views.set(s.id, view);
      }
      view.update(s, dt);
      const bar = view.barEntry();
      if (bar) bars.push(bar);
      view.ringEntries(rings);
    }
    this.bars.setEntries(bars);
    this.rings.setEntries(rings);
  }

  get(id: UnitId): UnitView | undefined {
    return this.views.get(id);
  }

  ids(): UnitId[] {
    return [...this.views.keys()];
  }

  get counts(): UnitViewCounts {
    let loaded = 0;
    for (const v of this.views.values()) if (v.loaded) loaded++;
    return { views: this.views.size, loaded, bars: this.bars.count, rings: this.rings.count };
  }

  /** Resolves when every current view has loaded. */
  async whenLoaded(): Promise<void> {
    await Promise.allSettled([...this.views.values()].map((v) => v.ready));
  }

  setLocalTeam(team: Team): void {
    this.options.localTeam = team;
    for (const v of this.views.values()) v.setLocalTeam(team);
  }

  /**
   * The visible unit under a canvas point (CSS px), picked in screen space
   * against each unit's body centre. Cheap (no ray casts against skinned
   * meshes) and forgiving for small units at MOBA zoom.
   */
  pick(x: number, y: number): UnitId | null {
    const cam = this.scene.activeCamera;
    const engine = this.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    if (!cam || !canvas) return null;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const viewport = cam.viewport.toGlobal(w, h);
    const transform = this.scene.getTransformMatrix();
    const camPos = cam.globalPosition;
    const targets: ScreenTarget[] = [];
    const p = new Vector3();
    const top = new Vector3();
    for (const v of this.views.values()) {
      const s = v.state;
      if (!v.loaded || !s.visible) continue;
      const height = v.barAnchorHeight;
      p.set(v.position.x, height * 0.45, v.position.z);
      top.set(v.position.x, height, v.position.z);
      const sp = Vector3.Project(p, Matrix.IdentityReadOnly, transform, viewport);
      const st = Vector3.Project(top, Matrix.IdentityReadOnly, transform, viewport);
      if (sp.z < 0 || sp.z > 1) continue;
      targets.push({
        id: v.id,
        x: sp.x,
        y: sp.y,
        radius: Math.max(12, Math.abs(sp.y - st.y) * 1.1),
        depth: Vector3.Distance(camPos, p),
      });
    }
    return pickNearest(targets, x, y);
  }

  dispose(): void {
    for (const id of [...this.views.keys()]) this.remove(id);
    this.bars.dispose();
    this.rings.dispose();
  }

  private remove(id: UnitId): void {
    this.views.get(id)?.dispose();
    this.views.delete(id);
  }
}
