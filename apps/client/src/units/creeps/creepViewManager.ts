import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { BarRenderer, type BarEntry } from '../bars';
import { RingRenderer, type RingEntry } from '../rings';
import { barFill, barLayoutFor, initialTrail, stepTrail, type TrailState } from '../barMath';
import { DEFAULT_SMOOTHING, smoothPosition, stepFacing, type SmoothingOptions } from '../motion';
import { pickNearest, type ScreenTarget } from '../diff';
import {
  UNIT_COLORS,
  relationColor,
  relationOf,
  type Team,
  type UnitId,
  type UnitViewState,
} from '../unitState';
import { CreepAnimator, type CreepTrack } from './creepAnim';
import { CreepBatch, type CreepLook } from './creepBatch';
import { buildCreepMesh } from './creepMesh';
import { CREEP_TYPES, type CreepModelId } from './creepTypes';

/**
 * The plain state that drives a creep, neutral or boss: exactly UnitViewState
 * (docs/design/units.md §1) with a creep model id. The M2 bridge builds the
 * same objects for heroes and creeps and routes them by `isCreepModelId`.
 */
export type CreepViewState = Omit<UnitViewState, 'modelId'> & { modelId: CreepModelId };

export interface CreepViewOptions {
  smoothing?: SmoothingOptions;
  /** Max turn speed in rad/s (0 = snap). Default 14, like UnitView. */
  turnRate?: number;
  /** The local player's team, for ally/enemy bar colours. Default 'wardens'. */
  localTeam?: Team;
  /** Extra uniform scale on top of each type's config scale (sandbox; see units.md §7). */
  displayScale?: number;
  /** 'toon' (default): the M1-02 toon material. 'unit-look': the installed UnitLook factory. */
  look?: CreepLook;
}

export interface CreepViewCounts {
  /** Units known (any load state). */
  views: number;
  /** Units whose type has finished loading. */
  loaded: number;
  /** Instances drawn last frame. */
  drawn: number;
  bars: number;
  rings: number;
  /** Creep types loaded (one mesh / one draw call each when on screen). */
  types: number;
}

export interface CreepTypeStats {
  id: CreepModelId;
  /** Triangles of one instance (the shared mesh). */
  triangles: number;
  instances: number;
  vat: { width: number; height: number };
}

interface CreepRecord {
  id: UnitId;
  modelId: CreepModelId;
  x: number;
  z: number;
  facing: number;
  track: CreepTrack | null;
  trail: TrailState;
  fill: number;
  state: CreepViewState;
}

const DEFAULT_BAR_ANCHOR = 2.4;

/**
 * Creep counterpart of UnitViewManager: `sync(states, dt)` once per render
 * frame. Instead of a model + skeleton per unit, every type is one CreepBatch
 * (one thin-instanced mesh with a baked animation texture), so 40 lane creeps
 * of 6 types cost 6 draw calls. Position/facing smoothing, bar damage trail,
 * death hold, visibility and picking behave like UnitView.
 */
export class CreepViewManager {
  readonly bars: BarRenderer;
  readonly rings: RingRenderer;
  private readonly scene: Scene;
  private readonly smoothing: SmoothingOptions;
  private readonly turnRate: number;
  private readonly displayScale: number;
  private localTeam: Team;
  private readonly records = new Map<UnitId, CreepRecord>();
  private readonly batches = new Map<CreepModelId, CreepBatch>();
  private readonly animators = new Map<CreepModelId, CreepAnimator>();
  private readonly loading = new Map<CreepModelId, Promise<void>>();
  private disposed = false;
  private readonly look: CreepLook;

  constructor(scene: Scene, options: CreepViewOptions = {}) {
    this.scene = scene;
    this.smoothing = options.smoothing ?? DEFAULT_SMOOTHING;
    this.turnRate = options.turnRate ?? 14;
    this.displayScale = options.displayScale ?? 1;
    this.localTeam = options.localTeam ?? 'wardens';
    this.look = options.look ?? 'toon';
    this.bars = new BarRenderer(scene);
    this.rings = new RingRenderer(scene);
  }

  /** Start loading types before any unit of them appears (e.g. at match start). */
  preload(ids: readonly CreepModelId[]): Promise<void> {
    return Promise.all(ids.map((id) => this.ensureType(id))).then(() => {});
  }

  /** Apply this frame's states. Ids not in `states` are dropped. */
  sync(states: readonly CreepViewState[], dt: number): void {
    const seen = new Set<UnitId>();
    for (const b of this.batches.values()) b.begin();
    const bars: BarEntry[] = [];
    const rings: RingEntry[] = [];
    for (const s of states) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      let r = this.records.get(s.id);
      if (!r || r.modelId !== s.modelId) {
        r = this.create(s);
        this.records.set(s.id, r);
      }
      this.update(r, s, dt);
      this.draw(r, bars, rings);
    }
    for (const id of this.records.keys()) if (!seen.has(id)) this.records.delete(id);
    for (const b of this.batches.values()) b.end();
    this.bars.setEntries(bars);
    this.rings.setEntries(rings);
  }

  get counts(): CreepViewCounts {
    let loaded = 0;
    for (const r of this.records.values()) if (this.batches.has(r.modelId)) loaded++;
    let drawn = 0;
    for (const b of this.batches.values()) drawn += b.count;
    return {
      views: this.records.size,
      loaded,
      drawn,
      bars: this.bars.count,
      rings: this.rings.count,
      types: this.batches.size,
    };
  }

  /** Per-type numbers for the doc table and the budget test. */
  typeStats(): CreepTypeStats[] {
    return [...this.batches.values()].map((b) => ({
      id: b.config.id,
      triangles: b.triangles,
      instances: b.count,
      vat: b.vatSize,
    }));
  }

  /** Resolves when every type in use (or preloading) has loaded. */
  async whenLoaded(): Promise<void> {
    await Promise.allSettled([...this.loading.values()]);
  }

  ids(): UnitId[] {
    return [...this.records.keys()];
  }

  /** Displayed position/facing/frame of a unit (debug/tests). */
  view(id: UnitId): { x: number; z: number; facing: number; frame: number | null } | undefined {
    const r = this.records.get(id);
    return r ? { x: r.x, z: r.z, facing: r.facing, frame: r.track?.frame ?? null } : undefined;
  }

  /** The clip a unit is showing (debug/tests), or null before its type loads. */
  shownState(id: UnitId): string | null {
    return this.records.get(id)?.track?.shown ?? null;
  }

  setLocalTeam(team: Team): void {
    this.localTeam = team;
  }

  barAnchorHeight(modelId: CreepModelId): number {
    const c = CREEP_TYPES[modelId];
    return (c.barAnchorHeight ?? DEFAULT_BAR_ANCHOR) * c.scale * this.displayScale;
  }

  /** Canvas position (CSS px) of a unit's body centre, or null. */
  screenPos(id: UnitId): { x: number; y: number } | null {
    const r = this.records.get(id);
    const cam = this.scene.activeCamera;
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!r || !cam || !canvas) return null;
    const vp = cam.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight);
    const p = new Vector3(r.x, this.barAnchorHeight(r.modelId) * 0.45, r.z);
    const s = Vector3.Project(p, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), vp);
    return { x: s.x, y: s.y };
  }

  /** The visible creep under a canvas point (CSS px), screen-space like UnitViewManager.pick. */
  pick(x: number, y: number): UnitId | null {
    const cam = this.scene.activeCamera;
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!cam || !canvas) return null;
    const vp = cam.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight);
    const transform = this.scene.getTransformMatrix();
    const targets: ScreenTarget[] = [];
    const p = new Vector3();
    const top = new Vector3();
    for (const r of this.records.values()) {
      if (!r.state.visible || !r.track) continue;
      const h = this.barAnchorHeight(r.modelId);
      p.set(r.x, h * 0.45, r.z);
      top.set(r.x, h, r.z);
      const sp = Vector3.Project(p, Matrix.IdentityReadOnly, transform, vp);
      const st = Vector3.Project(top, Matrix.IdentityReadOnly, transform, vp);
      if (sp.z < 0 || sp.z > 1) continue;
      targets.push({
        id: r.id,
        x: sp.x,
        y: sp.y,
        radius: Math.max(12, Math.abs(sp.y - st.y) * 1.1),
        depth: Vector3.Distance(cam.globalPosition, p),
      });
    }
    return pickNearest(targets, x, y);
  }

  dispose(): void {
    this.disposed = true;
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
    this.records.clear();
    this.bars.dispose();
    this.rings.dispose();
  }

  // ---- internals -----------------------------------------------------------------

  private ensureType(id: CreepModelId): Promise<void> {
    let p = this.loading.get(id);
    if (!p) {
      const config = CREEP_TYPES[id];
      p = buildCreepMesh(this.scene, config)
        .then((data) => {
          if (this.disposed) {
            data.release();
            data.mesh.dispose();
            return;
          }
          const batch = new CreepBatch(this.scene, config, data, this.look);
          this.batches.set(id, batch);
          this.animators.set(id, new CreepAnimator(batch.clips, config));
        })
        .catch((err: unknown) => {
          console.error(`[citadel] creep type ${id} failed to load`, err);
          throw err;
        });
      this.loading.set(id, p);
    }
    return p;
  }

  private create(s: CreepViewState): CreepRecord {
    void this.ensureType(s.modelId).catch(() => {});
    const fill = barFill(s.hp, s.maxHp);
    return {
      id: s.id,
      modelId: s.modelId,
      x: s.position.x,
      z: s.position.z,
      facing: s.facing,
      track: null,
      trail: initialTrail(fill),
      fill,
      state: s,
    };
  }

  private update(r: CreepRecord, s: CreepViewState, dt: number): void {
    const snap = !!s.snap || r.track === null;
    const next = smoothPosition({ x: r.x, z: r.z }, s.position, dt, this.smoothing, snap);
    r.x = next.x;
    r.z = next.z;
    r.facing = stepFacing(r.facing, s.facing, dt, snap ? 0 : this.turnRate);
    const fill = barFill(s.hp, s.maxHp);
    r.trail = s.snap ? initialTrail(fill) : stepTrail(r.trail, r.fill, fill, dt);
    r.fill = fill;
    r.state = s;
    const anim = this.animators.get(r.modelId);
    if (!anim) return;
    if (!r.track) r.track = anim.start(s, r.id);
    else anim.step(r.track, s, dt, r.id);
  }

  private draw(r: CreepRecord, bars: BarEntry[], rings: RingEntry[]): void {
    const s = r.state;
    const batch = this.batches.get(r.modelId);
    if (!batch || !r.track || !s.visible) return;
    const config = CREEP_TYPES[r.modelId];
    batch.add(r.x, r.z, r.facing, config.scale * this.displayScale, r.track.frame);

    const rel = relationOf(s.team, this.localTeam);
    if (s.hp > 0 && s.animState !== 'death') {
      bars.push({
        id: r.id,
        x: r.x,
        y: this.barAnchorHeight(r.modelId),
        z: r.z,
        hpFill: r.fill,
        trailFill: Math.max(r.fill, r.trail.value),
        manaFill: -1,
        tickMaxHp: 0,
        layout: barLayoutFor(false, false),
        color: relationColor(rel),
        alpha: 1,
      });
    }
    const radius = config.selectionRadius * config.scale * this.displayScale;
    if (s.selected) {
      rings.push({
        id: r.id,
        kind: 'selected',
        x: r.x,
        z: r.z,
        radius,
        color: relationColor(rel),
        alpha: 0.95,
      });
    }
    if (s.hovered) {
      rings.push({
        id: r.id,
        kind: 'hover',
        x: r.x,
        z: r.z,
        radius: s.selected ? radius * 1.18 : radius,
        color: UNIT_COLORS.hover,
        alpha: 0.45,
      });
    }
  }
}
