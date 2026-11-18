import '@babylonjs/core/Meshes/thinInstanceMesh';
import { BakedVertexAnimationManager } from '@babylonjs/core/BakedVertexAnimation/bakedVertexAnimationManager';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import { layoutClips, totalFrames, VAT_FPS, type BakedClip } from './creepAnim';
import type { CreepMeshData } from './creepMesh';
import type { CreepTypeConfig } from './creepTypes';
import { createUnitLook, type UnitLook } from '../look';
import { toonMaterialFor } from '../../render/shaders/applyCitadelToon';
import { atlasCell } from '../../render/shaders/teamMask';

/** How a creep type is shaded: the toon material, or whatever UnitLook factory is installed. */
export type CreepLook = 'toon' | 'unit-look';

/**
 * One creep type on screen: a single mesh, thin-instanced once per visible
 * unit, animated by a baked vertex animation texture (VAT). One draw call per
 * type regardless of count (docs/design/creeps.md §2).
 *
 * The texture holds every bone matrix of every baked frame (row = frame,
 * (bones + 1) × 4 RGBA float texels per row). Each instance carries its world
 * matrix and the row to read, as Babylon's `bakedVertexAnimationSettingsInstanced`
 * attribute set to (frame, frame, 0, 0): with zero speed the shader reads
 * exactly that row, so the CPU (creepAnim.ts) has full control over timing.
 */
export class CreepBatch {
  readonly config: CreepTypeConfig;
  readonly mesh: Mesh;
  readonly clips: readonly BakedClip[];
  /** Triangles per instance. */
  readonly triangles: number;
  /** VAT size in texels (debug/doc numbers). */
  readonly vatSize: { width: number; height: number };
  private readonly vat: RawTexture;
  private readonly manager: BakedVertexAnimationManager;
  private readonly look: UnitLook | null;
  private readonly sourceMaterial: Material | null;
  private capacity = 0;
  private matrices = new Float32Array(0);
  private settings = new Float32Array(0);
  private n = 0;

  constructor(
    scene: Scene,
    config: CreepTypeConfig,
    data: CreepMeshData,
    look: CreepLook = 'toon',
  ) {
    this.config = config;
    this.mesh = data.mesh;
    this.triangles = (data.mesh.getIndices()?.length ?? 0) / 3;

    // Bake every clip, back to back.
    this.clips = layoutClips(data.clips, VAT_FPS);
    const width = (data.boneCount + 1) * 4;
    const height = totalFrames(this.clips);
    const floatsPerFrame = width * 4;
    const pixels = new Float32Array(floatsPerFrame * height);
    const frame = new Float32Array(floatsPerFrame);
    for (const clip of this.clips) {
      for (let i = 0; i < clip.count; i++) {
        frame.fill(0);
        data.sample(clip.name, Math.min(clip.duration, i / VAT_FPS), frame);
        pixels.set(frame, (clip.start + i) * floatsPerFrame);
      }
    }
    data.release();
    this.vatSize = { width, height };
    this.vat = RawTexture.CreateRGBATexture(
      pixels,
      width,
      height,
      scene,
      false,
      false,
      Texture.NEAREST_NEAREST,
      Constants.TEXTURETYPE_FLOAT,
    );
    this.vat.name = `creep-vat-${config.id}`;
    this.manager = new BakedVertexAnimationManager(scene);
    this.manager.texture = this.vat;
    this.mesh.bakedVertexAnimationManager = this.manager;

    // Look: the M1-02 toon material by default, team-coloured through the
    // type's team swatch; or the UnitLook seam (whatever factory is installed,
    // e.g. the M1-13 fallback rim). A whole type shares one team; per-unit
    // highlight is the selection ring.
    this.sourceMaterial = this.mesh.material;
    if (look === 'toon' && this.sourceMaterial) {
      const cell = config.teamCell;
      const faction =
        config.team === 'neutral' ? null : config.team === 'wardens' ? 'warden' : 'hollow';
      this.mesh.material = toonMaterialFor(this.sourceMaterial, {
        team: faction && cell !== undefined ? faction : null,
        teamMask: faction && cell !== undefined ? [atlasCell(cell % 8, Math.floor(cell / 8))] : [],
        variant: 'creep',
      });
      this.look = null;
    } else {
      this.look = createUnitLook([this.mesh], scene);
      this.look.setTeam(config.team);
    }

    this.mesh.alwaysSelectAsActiveMesh = true; // instances span the map; skip bounds upkeep
    this.mesh.doNotSyncBoundingInfo = true;
    this.ensureCapacity(16);
    this.mesh.thinInstanceCount = 1; // keep the INSTANCES define stable (see ../rings.ts)
    this.mesh.isVisible = false;
  }

  /** Instances drawn last frame. */
  get count(): number {
    return this.n;
  }

  /** Start filling this frame's instances. */
  begin(): void {
    this.n = 0;
  }

  /**
   * Add one instance: world position, facing (radians, 0 = +Z), uniform scale
   * and the VAT row to show.
   */
  add(x: number, z: number, facing: number, scale: number, frame: number): void {
    this.ensureCapacity(this.n + 1);
    const o = this.n * 16;
    const m = this.matrices;
    // Scale · RotationY(facing) · Translation, row-major (Babylon's layout).
    const c = Math.cos(facing) * scale;
    const s = Math.sin(facing) * scale;
    m[o] = c;
    m[o + 1] = 0;
    m[o + 2] = -s;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = scale;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = s;
    m[o + 9] = 0;
    m[o + 10] = c;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = 0;
    m[o + 14] = z;
    m[o + 15] = 1;
    const q = this.n * 4;
    this.settings[q] = frame;
    this.settings[q + 1] = frame;
    this.settings[q + 2] = 0;
    this.settings[q + 3] = 0;
    this.n++;
  }

  /** Upload this frame's instances. */
  end(): void {
    this.mesh.thinInstanceBufferUpdated('matrix');
    this.mesh.thinInstanceBufferUpdated('bakedVertexAnimationSettingsInstanced');
    this.mesh.thinInstanceCount = Math.max(1, this.n);
    // With 0 instances Babylon would draw the mesh once un-instanced; hide it instead.
    this.mesh.isVisible = this.n > 0;
  }

  dispose(): void {
    this.look?.dispose();
    this.mesh.skeleton?.dispose();
    const rim = this.mesh.material;
    this.mesh.dispose(false, false);
    // Toon materials are shared through their cache; only a private rim material is ours.
    if (rim && rim !== this.sourceMaterial && this.look) rim.dispose();
    this.sourceMaterial?.dispose();
    this.manager.dispose();
    this.vat.dispose();
  }

  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    let cap = Math.max(16, this.capacity);
    while (cap < n) cap *= 2;
    const m = new Float32Array(cap * 16);
    const st = new Float32Array(cap * 4);
    m.set(this.matrices);
    st.set(this.settings);
    this.matrices = m;
    this.settings = st;
    this.capacity = cap;
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer(
      'bakedVertexAnimationSettingsInstanced',
      this.settings,
      4,
      false,
    );
  }
}
