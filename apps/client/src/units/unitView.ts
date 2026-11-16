import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { loadModel, type LoadedModel } from './loadModel';
import { MODEL_CONFIGS, type ModelId, type ModelViewConfig } from './modelConfig';
import { LOOPING_STATES, type LogicalState } from './states';
import {
  DEFAULT_SMOOTHING,
  smoothPosition,
  stepFacing,
  type SmoothingOptions,
  type Vec2,
} from './motion';
import { barFill, barLayoutFor, initialTrail, stepTrail, type TrailState } from './barMath';
import { createUnitLook, type Highlight, type UnitLook } from './look';
import type { BarEntry } from './bars';
import type { RingEntry } from './rings';
import {
  UNIT_COLORS,
  relationColor,
  relationOf,
  type Relation,
  type Team,
  type UnitId,
  type UnitViewState,
} from './unitState';

export interface UnitViewOptions {
  /** Position smoothing; `{ rate: 0 }` turns it off (exact state every frame). */
  smoothing?: SmoothingOptions;
  /** Max turn speed in rad/s (0 = snap). Default 14 (≈ a half-turn in 0.22 s). */
  turnRate?: number;
  /** The local player's team, for ally/enemy colours. Default 'wardens'. */
  localTeam?: Team;
  /** Merge each model into 1-2 draw calls (mergeModel.ts). Default true; false is for debugging. */
  mergeMeshes?: boolean;
  /** Extra uniform scale on top of the model config (sandbox/debug). Default 1. */
  displayScale?: number;
}

/** Fallbacks when a model config has no explicit anchor/radius (heights at scale 1). */
const DEFAULT_BAR_ANCHOR = 2.6;
const DEFAULT_RING_RADIUS = 0.75;

/**
 * Presentation object for one unit (hero, creep, neutral). Owns the model
 * instance and its AnimationController and is driven ONLY by `update(state,
 * dt)` with a plain UnitViewState, so the M2 sim bridge can drive it without
 * touching Babylon. Bars and rings are not owned here: the view reports
 * `barEntry()`/`ringEntries()` and the manager draws all of them in shared
 * instanced meshes. See docs/design/units.md.
 */
export class UnitView {
  readonly id: UnitId;
  readonly modelId: ModelId;
  readonly config: ModelViewConfig;
  /** Our wrapper node: position + facing live here, the glTF root hangs under it. */
  readonly node: TransformNode;
  /** Resolves once the model is loaded (or rejects if it fails). */
  readonly ready: Promise<void>;

  /** Displayed (smoothed) ground position. */
  readonly position: Vec2;
  /** Displayed facing, radians. */
  facing: number;
  /** Last state applied. */
  state: UnitViewState;

  private model: LoadedModel | null = null;
  private look: UnitLook | null = null;
  private disposed = false;
  private readonly smoothing: SmoothingOptions;
  private readonly turnRate: number;
  private readonly displayScale: number;
  private localTeam: Team;
  private relation: Relation;
  private appliedTeam: Team | null = null;
  private appliedHighlight: Highlight | null = null;
  private appliedAnim: LogicalState | null = null;
  private appliedSeq: number | undefined;
  private appliedAttackScale = 1;
  private appliedVisible: boolean | null = null;
  private trail: TrailState;
  private prevFill: number;

  constructor(scene: Scene, state: UnitViewState, options: UnitViewOptions = {}) {
    this.id = state.id;
    this.modelId = state.modelId;
    this.config = MODEL_CONFIGS[state.modelId];
    this.smoothing = options.smoothing ?? DEFAULT_SMOOTHING;
    this.turnRate = options.turnRate ?? 14;
    this.displayScale = options.displayScale ?? 1;
    this.localTeam = options.localTeam ?? 'wardens';
    this.relation = relationOf(state.team, this.localTeam);
    this.state = state;
    this.position = { x: state.position.x, z: state.position.z };
    this.facing = state.facing;
    const fill = barFill(state.hp, state.maxHp);
    this.trail = initialTrail(fill);
    this.prevFill = fill;

    this.node = new TransformNode(`unit-${state.id}`, scene);
    this.node.scaling.setAll(this.displayScale);
    this.applyTransform();
    this.node.setEnabled(false); // shown once the model is in

    this.ready = loadModel(scene, this.config, {
      mergeMeshes: options.mergeMeshes ?? true,
      initialState: null,
    }).then((model) => {
      if (this.disposed) {
        model.dispose();
        return;
      }
      this.model = model;
      model.root.parent = this.node;
      for (const m of model.meshes) {
        m.isPickable = false; // picking is screen-space in the manager
        m.metadata = { unitId: this.id };
      }
      this.look = createUnitLook(model.meshes, scene);
      this.appliedAnim = null;
      this.appliedVisible = null;
      this.appliedTeam = null;
      this.appliedHighlight = null;
      this.applyState(this.state);
    });
  }

  get loaded(): boolean {
    return this.model !== null;
  }

  /** The animator, once loaded (debug/tests). */
  get animator() {
    return this.model?.animator ?? null;
  }

  /** World height of the bar anchor above the unit's feet. */
  get barAnchorHeight(): number {
    return (
      (this.config.barAnchorHeight ?? DEFAULT_BAR_ANCHOR) * this.config.scale * this.displayScale
    );
  }

  get ringRadius(): number {
    return (
      (this.config.selectionRadius ?? DEFAULT_RING_RADIUS) * this.config.scale * this.displayScale
    );
  }

  /** HP fill and trail as shown this frame. */
  get barFill(): { hp: number; trail: number } {
    return { hp: this.prevFill, trail: Math.max(this.prevFill, this.trail.value) };
  }

  setLocalTeam(team: Team): void {
    this.localTeam = team;
    this.appliedHighlight = null;
  }

  /**
   * Apply a new state. `dt` is the render-frame delta in seconds; smoothing
   * and the damage trail advance by it.
   */
  update(state: UnitViewState, dt: number): void {
    if (this.disposed) return;
    if (state.modelId !== this.modelId) {
      console.warn(`[citadel] unit ${this.id}: modelId changed; the manager should recreate it`);
    }
    const next = smoothPosition(this.position, state.position, dt, this.smoothing, !!state.snap);
    this.position.x = next.x;
    this.position.z = next.z;
    this.facing = state.snap
      ? stepFacing(this.facing, state.facing, dt, 0)
      : stepFacing(this.facing, state.facing, dt, this.turnRate);
    this.applyTransform();

    const fill = barFill(state.hp, state.maxHp);
    this.trail = state.snap ? initialTrail(fill) : stepTrail(this.trail, this.prevFill, fill, dt);
    this.prevFill = fill;

    this.state = state;
    this.applyState(state);
  }

  /** This frame's bar, or null when the unit shouldn't show one (hidden, dead, not loaded). */
  barEntry(): BarEntry | null {
    const s = this.state;
    if (!this.model || !s.visible || s.hp <= 0 || s.animState === 'death') return null;
    const hasMana = s.isHero && (s.maxMana ?? 0) > 0;
    return {
      id: this.id,
      x: this.position.x,
      y: this.barAnchorHeight,
      z: this.position.z,
      hpFill: this.prevFill,
      trailFill: Math.max(this.prevFill, this.trail.value),
      manaFill: hasMana ? barFill(s.mana ?? 0, s.maxMana ?? 0) : -1,
      tickMaxHp: s.isHero ? s.maxHp : 0,
      layout: barLayoutFor(s.isHero, hasMana),
      color: relationColor(this.relation),
      alpha: 1,
    };
  }

  /** Push this frame's selection/hover rings into `out`. */
  ringEntries(out: RingEntry[]): void {
    const s = this.state;
    if (!this.model || !s.visible) return;
    const r = this.ringRadius;
    if (s.selected) {
      out.push({
        id: this.id,
        kind: 'selected',
        x: this.position.x,
        z: this.position.z,
        radius: r,
        color: relationColor(this.relation),
        alpha: 0.95,
      });
    }
    if (s.hovered) {
      out.push({
        id: this.id,
        kind: 'hover',
        x: this.position.x,
        z: this.position.z,
        radius: s.selected ? r * 1.18 : r,
        color: UNIT_COLORS.hover,
        alpha: 0.45,
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.look?.dispose();
    this.model?.dispose();
    this.node.dispose();
    this.model = null;
  }

  private applyTransform(): void {
    this.node.position.set(this.position.x, 0, this.position.z);
    // glTF characters face +Z; facing 0 = +Z, positive turns toward +X (Babylon is left-handed).
    this.node.rotation.y = this.facing;
  }

  private applyState(s: UnitViewState): void {
    if (this.appliedVisible !== s.visible) {
      this.node.setEnabled(s.visible && this.model !== null);
      this.appliedVisible = this.model ? s.visible : null;
    }
    const model = this.model;
    if (!model || !this.look) return;

    if (this.appliedTeam !== s.team) {
      this.look.setTeam(s.team);
      this.appliedTeam = s.team;
      this.relation = relationOf(s.team, this.localTeam);
      this.appliedHighlight = null;
    }
    const hl: Highlight = s.selected ? 'selected' : s.hovered ? 'hover' : 'none';
    if (this.appliedHighlight !== hl) {
      this.look.setHighlight(hl, hl === 'hover' ? UNIT_COLORS.hover : relationColor(this.relation));
      this.appliedHighlight = hl;
    }

    const anim = model.animator;
    if (this.appliedAttackScale !== s.attackSpeedScale) {
      const k = s.attackSpeedScale > 0 ? s.attackSpeedScale : 1;
      anim.setSpeed('attack1', k);
      anim.setSpeed('attack2', k);
      this.appliedAttackScale = s.attackSpeedScale;
    }
    const replay =
      s.animSeq !== undefined && s.animSeq !== this.appliedSeq && !LOOPING_STATES.has(s.animState);
    if (this.appliedAnim !== s.animState || replay) {
      // First play after load snaps (no blend from the bind pose).
      anim.play(s.animState, {
        restart: replay,
        ...(this.appliedAnim === null ? { blend: 0 } : {}),
      });
      this.appliedAnim = s.animState;
    }
    this.appliedSeq = s.animSeq;
  }
}
