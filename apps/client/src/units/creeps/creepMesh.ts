import '@babylonjs/loaders/glTF/2.0';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { Bone } from '@babylonjs/core/Bones/bone';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Node } from '@babylonjs/core/node';
import type { Scene } from '@babylonjs/core/scene';
import type { ClipSource } from './creepAnim';
import type { CreepTypeConfig } from './creepTypes';
import { moveToCell, recolorPart } from './swatch';
import { SIEGE_CLIPS, siegePose, type SiegeClip } from './siegePose';

/**
 * A creep type's merged, recoloured, skin-weighted mesh plus a sampler for its
 * clips, ready to bake (creepBatch.ts). The mesh is detached and sits at the
 * origin with an identity transform: every transform the GLB hierarchy applied
 * (glTF handedness flip, quantisation scales) is folded into the sampled bone
 * matrices, so a thin instance's matrix is the unit's whole world transform.
 */
export interface CreepMeshData {
  mesh: Mesh;
  /** Bones in the rig; the baked texture is (boneCount + 1) * 4 texels wide. */
  boneCount: number;
  clips: ClipSource[];
  /** Write the (boneCount + 1) skinning matrices for `clip` at `t` seconds into `out`. */
  sample(clip: string, t: number, out: Float32Array): void;
  /** Free the loader leftovers (source meshes, skeleton, animation groups) once baked. */
  release(): void;
}

/** Each type loads its GLBs once; the containers are consumed (added to the scene, then freed). */
function load(scene: Scene, url: string): Promise<AssetContainer> {
  return LoadAssetContainerAsync(url, scene);
}

/** Dispose a consumed container but keep `keep` (the atlas our material still samples). */
function disposeKeeping(c: AssetContainer, keep: BaseTexture | null): void {
  if (keep) c.textures = c.textures.filter((t) => t !== keep);
  c.dispose();
}

function albedoOf(meshes: readonly AbstractMesh[]): BaseTexture | null {
  for (const m of meshes) {
    const mat = m.material;
    if (mat instanceof PBRMaterial && mat.albedoTexture) return mat.albedoTexture;
    if (mat instanceof StandardMaterial && mat.diffuseTexture) return mat.diffuseTexture;
  }
  return null;
}

function creepMaterial(name: string, scene: Scene, albedo: BaseTexture | null): StandardMaterial {
  const m = new StandardMaterial(`creep-${name}`, scene);
  if (albedo) m.diffuseTexture = albedo;
  m.specularColor = Color3.Black();
  return m;
}

/** A rig of `n` identity bones: only there so the material compiles its skinning path. */
function placeholderSkeleton(name: string, n: number, scene: Scene): Skeleton {
  const sk = new Skeleton(`creep-${name}`, `creep-${name}`, scene);
  for (let i = 0; i < n; i++) new Bone(`b${i}`, sk);
  return sk;
}

interface Builder {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
  mIdx: number[];
  mW: number[];
}

const newBuilder = (): Builder => ({
  positions: [],
  normals: [],
  uvs: [],
  colors: [],
  indices: [],
  mIdx: [],
  mW: [],
});

function finish(b: Builder, name: string, scene: Scene, flipWinding: boolean): Mesh {
  if (flipWinding) {
    for (let i = 0; i < b.indices.length; i += 3) {
      const t = b.indices[i + 1]!;
      b.indices[i + 1] = b.indices[i + 2]!;
      b.indices[i + 2] = t;
    }
  }
  const vd = new VertexData();
  vd.positions = b.positions;
  vd.normals = b.normals;
  vd.uvs = b.uvs;
  vd.colors = b.colors;
  vd.indices = b.indices;
  vd.matricesIndices = b.mIdx;
  vd.matricesWeights = b.mW;
  const mesh = new Mesh(`creep-${name}`, scene);
  vd.applyToMesh(mesh, false);
  mesh.isPickable = false;
  return mesh;
}

/** Bone owning a rigid part: walk up from its parent to the first node a bone is linked to. */
function boneIndexFor(node: Node, boneByNode: Map<Node, Bone>, skeleton: Skeleton): number {
  let n: Node | null = node.parent;
  while (n) {
    const bone = boneByNode.get(n);
    if (bone) {
      const i = bone.getIndex();
      return i >= 0 ? i : skeleton.bones.indexOf(bone);
    }
    n = n.parent;
  }
  return -1;
}

/**
 * Skinned KayKit character → one mesh. Weapons from `config.props` are hung on
 * their hand slots first; every visible part (skinned body parts and rigid
 * props) is folded into a single skinned mesh with one material, recoloured
 * per `config.recolor`. Same idea as ../mergeModel.ts, plus vertex colours and
 * merging across materials (the skeletons' separate glow-eye material).
 */
export async function buildSkinnedCreep(
  scene: Scene,
  config: CreepTypeConfig,
): Promise<CreepMeshData> {
  const [body, ...props] = await Promise.all([
    load(scene, config.url),
    ...(config.props ?? []).map((p) => load(scene, p.url)),
  ]);
  body.addAllToScene();
  const root = body.rootNodes[0] as TransformNode;
  (config.props ?? []).forEach((p, i) => {
    const pc = props[i]!;
    pc.addAllToScene();
    const slot = body.transformNodes.find((n) => n.name === p.slot);
    if (!slot) throw new Error(`${config.id}: slot ${p.slot} not found`);
    // Keep each prop node's own local transform (it carries the quantisation
    // scale); drop only the prop file's handedness root.
    for (const top of pc.rootNodes[0]!.getChildren()) (top as TransformNode).parent = slot;
    pc.rootNodes[0]!.dispose();
  });

  const all = root.getChildMeshes(false);
  const parts = all.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
  const skinned = parts.filter((m) => m.skeleton);
  const ref = skinned[0];
  if (!ref?.skeleton) throw new Error(`${config.id}: no skinned part`);
  const skeleton = ref.skeleton;
  const albedo = albedoOf(parts);
  // The loader auto-plays the first clip; park everything so the bind pose is stable.
  for (const g of body.animationGroups) g.stop();

  root.computeWorldMatrix(true);
  for (const n of root.getDescendants(false)) (n as TransformNode).computeWorldMatrix?.(true);
  skeleton.prepare(true);
  const bind = skeleton.getTransformMatrices(ref);
  const refWorld = ref.computeWorldMatrix(true).clone();

  const boneByNode = new Map<Node, Bone>();
  for (const b of skeleton.bones) {
    const tn = b.getTransformNode();
    if (tn) boneByNode.set(tn, b);
  }
  const indexOf = (b: Bone) => {
    const i = b.getIndex();
    return i >= 0 ? i : skeleton.bones.indexOf(b);
  };
  /**
   * KayKit GLBs give every skinned part its own glTF skin, and the joint order
   * differs between them, so Babylon builds one Skeleton per part. Remap each
   * part's joint indices onto `ref`'s skeleton through the shared bone nodes.
   */
  const remapFor = (sk: Skeleton): Int32Array => {
    const map = new Int32Array(sk.bones.length + 1).fill(-1);
    for (const b of sk.bones) {
      const tn = b.getTransformNode();
      const target = (tn && boneByNode.get(tn)) || skeleton.bones.find((x) => x.name === b.name);
      if (target) map[indexOf2(sk, b)] = indexOf(target);
    }
    return map;
  };
  const indexOf2 = (sk: Skeleton, b: Bone) => {
    const i = b.getIndex();
    return i >= 0 ? i : sk.bones.indexOf(b);
  };

  const out = newBuilder();
  const tmp = new Vector3();
  const inv = new Matrix();
  for (const m of parts) {
    const pos = m.getVerticesData(VertexBuffer.PositionKind);
    const nrm = m.getVerticesData(VertexBuffer.NormalKind);
    const uvSrc = m.getVerticesData(VertexBuffer.UVKind);
    const idx = m.getIndices();
    if (!pos || !idx) continue;
    const count = pos.length / 3;
    const base = out.positions.length / 3;
    let xform: Matrix | null = null;
    let bone = 0;
    if (!m.skeleton) {
      bone = boneIndexFor(m, boneByNode, skeleton);
      if (bone < 0) throw new Error(`${config.id}: rigid part ${m.name} is not under a bone`);
      Matrix.FromArray(bind, bone * 16).multiplyToRef(refWorld, inv);
      inv.invert();
      xform = m.computeWorldMatrix(true).multiply(inv);
    } else if (m.skeleton !== skeleton) {
      // Each part's skin has its own inverse bind matrices (gltf-transform's
      // quantisation folds the part's dequantise transform into them), so its
      // vertices live in their own space. Bring them into ref's skin space:
      // v · M_part[j] = (v · D) · M_ref[j] with D = M_part[j] · M_ref[j]⁻¹,
      // the same for every joint.
      const sk = m.skeleton;
      sk.prepare(true);
      const pm = sk.getTransformMatrices(m);
      const map = remapFor(sk);
      const mi = m.getVerticesData(VertexBuffer.MatricesIndicesKind);
      const jp = mi ? mi[0]! : 0;
      const jr = map[jp]!;
      if (jr >= 0) {
        Matrix.FromArray(bind, jr * 16).invertToRef(inv);
        xform = Matrix.FromArray(pm, jp * 16).multiply(inv);
      }
    }
    for (let i = 0; i < count; i++) {
      tmp.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
      if (xform) Vector3.TransformCoordinatesToRef(tmp, xform, tmp);
      out.positions.push(tmp.x, tmp.y, tmp.z);
      if (nrm) {
        tmp.set(nrm[i * 3]!, nrm[i * 3 + 1]!, nrm[i * 3 + 2]!);
        if (xform) Vector3.TransformNormalToRef(tmp, xform, tmp);
        tmp.normalize();
        out.normals.push(tmp.x, tmp.y, tmp.z);
      } else out.normals.push(0, 1, 0);
    }
    const uvs = uvSrc ? Array.from(uvSrc) : new Array<number>(count * 2).fill(0.01);
    const colors = new Array<number>(count * 4);
    recolorPart(uvs, colors, m.name, config.recolor);
    out.uvs.push(...uvs);
    out.colors.push(...colors);
    if (m.skeleton) {
      const mi = m.getVerticesData(VertexBuffer.MatricesIndicesKind);
      const mw = m.getVerticesData(VertexBuffer.MatricesWeightsKind);
      if (!mi || !mw || mi.length !== count * 4)
        throw new Error(`${config.id}: bad skin on ${m.name}`);
      const map = m.skeleton === skeleton ? null : remapFor(m.skeleton);
      for (let i = 0; i < count * 4; i++) {
        const j = map ? map[mi[i]!]! : mi[i]!;
        if (j < 0 && mw[i]! > 0)
          throw new Error(`${config.id}: ${m.name} uses a joint not in the rig`);
        out.mIdx.push(Math.max(0, j));
        out.mW.push(mw[i]!);
      }
    } else {
      for (let i = 0; i < count; i++) {
        out.mIdx.push(bone, 0, 0, 0);
        out.mW.push(1, 0, 0, 0);
      }
    }
    for (let i = 0; i < idx.length; i++) out.indices.push(idx[i]! + base);
  }

  // glTF triangles wind counter-clockwise; Babylon (left-handed) treats
  // clockwise as front. The loader's mirrored root normally reconciles the two,
  // and our bone matrices carry that mirror (refWorld), so the GPU sees a
  // mirrored mesh with an identity world. Keep the winding when refWorld
  // mirrors; reverse it only if it doesn't.
  const mesh = finish(out, config.id, scene, refWorld.determinant() > 0);
  const boneCount = skeleton.bones.length;
  mesh.skeleton = placeholderSkeleton(config.id, boneCount, scene);
  mesh.numBoneInfluencers = 4;
  mesh.material = creepMaterial(config.id, scene, albedo);
  for (const m of parts) m.setEnabled(false);

  const groups = new Map(body.animationGroups.map((g) => [g.name, g]));
  for (const g of groups.values()) g.stop();
  const clips: ClipSource[] = [];
  const fpsOf = new Map<string, number>();
  for (const name of new Set(Object.values(config.clips))) {
    const g = groups.get(name);
    if (!g) throw new Error(`${config.id}: clip ${name} missing from ${config.url}`);
    const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    fpsOf.set(name, fps);
    clips.push({
      name,
      duration: Math.max(1 / 30, (g.to - g.from) / fps),
      loop: name === config.clips.idle || name === config.clips.run,
    });
  }

  const m4 = new Matrix();
  const r4 = new Matrix();
  let active: string | null = null;
  return {
    mesh,
    boneCount,
    clips,
    sample(clip, t, target) {
      const g = groups.get(clip)!;
      if (active !== clip) {
        if (active) groups.get(active)!.stop();
        g.start(false, 1, g.from, g.to);
        g.pause();
        active = clip;
      }
      g.goToFrame(Math.min(g.to, g.from + t * fpsOf.get(clip)!));
      skeleton.prepare(true);
      const mats = skeleton.getTransformMatrices(ref);
      for (let b = 0; b <= boneCount; b++) {
        if ((b + 1) * 16 > mats.length) break;
        Matrix.FromArrayToRef(mats, b * 16, m4);
        m4.multiplyToRef(refWorld, r4);
        r4.copyToArray(target, b * 16);
      }
    },
    release() {
      if (active) groups.get(active)?.stop();
      disposeKeeping(body, albedo);
      for (const p of props) disposeKeeping(p, albedo);
    },
  };
}

// ---- Siege engine -----------------------------------------------------------------

/** Rig of the code-built siege engine. */
const SIEGE_BONES = { body: 0, arm: 1, frontAxle: 2, backAxle: 3 } as const;
const SIEGE_BONE_COUNT = 4;

/** Chassis layout at scale 1 (world units; hero ≈ 2.4 tall). */
const CHASSIS = {
  width: 1.5,
  length: 2.1,
  thick: 0.22,
  deckY: 0.55,
  wheelR: 0.36,
  wheelW: 0.16,
  wheelX: 0.86,
  axleZ: 0.68,
  turretHeight: 1.35,
};

/** Hexagon-atlas swatches for the code-built parts. */
const WOOD_CELL = 6;
const WHEEL_CELL = 5;
const IRON_CELL = 3;

function pushVertexData(
  b: Builder,
  vd: VertexData,
  xform: Matrix,
  cell: number,
  bone: number,
  part: string,
  config: CreepTypeConfig,
) {
  const base = b.positions.length / 3;
  const p = vd.positions!;
  const n = vd.normals!;
  const tmp = new Vector3();
  const count = p.length / 3;
  for (let i = 0; i < count; i++) {
    tmp.set(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!);
    Vector3.TransformCoordinatesToRef(tmp, xform, tmp);
    b.positions.push(tmp.x, tmp.y, tmp.z);
    tmp.set(n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!);
    Vector3.TransformNormalToRef(tmp, xform, tmp);
    tmp.normalize();
    b.normals.push(tmp.x, tmp.y, tmp.z);
    b.mIdx.push(bone, 0, 0, 0);
    b.mW.push(1, 0, 0, 0);
  }
  // Code-built parts map onto one swatch, shaded down the gradient by height.
  const uvs: number[] = [];
  const src = vd.uvs;
  for (let i = 0; i < count; i++) {
    const v = src ? 0.15 + 0.7 * src[i * 2 + 1]! : 0.5;
    const [cu, cv] = moveToCell(0.5 / 8, v / 4, cell);
    uvs.push(cu, cv);
  }
  const colors = new Array<number>(count * 4);
  recolorPart(uvs, colors, part, config.recolor);
  b.uvs.push(...uvs);
  b.colors.push(...colors);
  const idx = vd.indices!;
  for (let i = 0; i < idx.length; i++) b.indices.push(idx[i]! + base);
}

/**
 * The siege engine: KayKit's catapult turret and arm (from the hexagon pack's
 * catapult tower) on a wheeled chassis built here, rigged to 4 bones (body,
 * arm, two axles) and animated procedurally (siegePose.ts).
 */
export async function buildSiegeCreep(
  scene: Scene,
  config: CreepTypeConfig,
): Promise<CreepMeshData> {
  const c = await load(scene, config.url);
  c.addAllToScene();
  const root = c.rootNodes[0] as TransformNode;
  root.computeWorldMatrix(true);
  for (const n of root.getDescendants(false)) (n as TransformNode).computeWorldMatrix?.(true);
  const meshes = root.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
  // Quantisation can leave a mesh on an unnamed child of its named node, so match the parent too.
  const named = (m: AbstractMesh, prefix: string) =>
    m.name.startsWith(prefix) ||
    (!m.name.startsWith('catapult') && !!m.parent?.name.startsWith(prefix));
  const arm = meshes.find((m) => named(m, 'catapult_arm'));
  const turret = meshes.find((m) => m !== arm && named(m, 'catapult_turret'));
  if (!turret || !arm) throw new Error(`${config.id}: catapult parts missing`);
  const albedo = albedoOf(meshes);

  // Normalise the turret to the chassis: base centred on the deck, fixed height.
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of [turret, arm]) {
    m.refreshBoundingInfo({});
    const bb = m.getBoundingInfo().boundingBox;
    lo.minimizeInPlace(bb.minimumWorld);
    hi.maximizeInPlace(bb.maximumWorld);
  }
  const k = CHASSIS.turretHeight / (hi.y - lo.y);
  const cx = (lo.x + hi.x) / 2;
  const cz = (lo.z + hi.z) / 2;
  // The KayKit turret throws toward -Z; turn it to face +Z (unit facing 0).
  const fit = Matrix.Translation(-cx, -lo.y, -cz)
    .multiply(Matrix.Scaling(k, k, k))
    .multiply(Matrix.RotationY(Math.PI))
    .multiply(Matrix.Translation(0, CHASSIS.deckY + CHASSIS.thick / 2, -0.1));

  const b = newBuilder();
  for (const [m, bone] of [
    [turret, SIEGE_BONES.body],
    [arm, SIEGE_BONES.arm],
  ] as const) {
    const vd = VertexData.ExtractFromMesh(m as Mesh, true, true);
    const xform = m.computeWorldMatrix(true).multiply(fit);
    const base = b.positions.length / 3;
    const tmp = new Vector3();
    const p = vd.positions!;
    const n = vd.normals!;
    const count = p.length / 3;
    for (let i = 0; i < count; i++) {
      tmp.set(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!);
      Vector3.TransformCoordinatesToRef(tmp, xform, tmp);
      b.positions.push(tmp.x, tmp.y, tmp.z);
      tmp.set(n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!);
      Vector3.TransformNormalToRef(tmp, xform, tmp);
      tmp.normalize();
      b.normals.push(tmp.x, tmp.y, tmp.z);
      b.mIdx.push(bone, 0, 0, 0);
      b.mW.push(1, 0, 0, 0);
    }
    const uvs = Array.from(vd.uvs ?? new Array<number>(count * 2).fill(0.01));
    const colors = new Array<number>(count * 4);
    recolorPart(uvs, colors, m.name, config.recolor);
    b.uvs.push(...uvs);
    b.colors.push(...colors);
    // Same winding rule as the skinned path: glTF is CCW; keep it under the root mirror.
    const idx = vd.indices!;
    const mirror = xform.determinant() > 0;
    for (let i = 0; i < idx.length; i += 3) {
      b.indices.push(
        idx[i]! + base,
        idx[mirror ? i + 2 : i + 1]! + base,
        idx[mirror ? i + 1 : i + 2]! + base,
      );
    }
  }
  // Arm pivot: the arm node's origin, in our space.
  const armPivot = Vector3.TransformCoordinates(
    Vector3.Zero(),
    arm.computeWorldMatrix(true).multiply(fit),
  );

  // Chassis: deck, two side rails, a tow beam and four wheels.
  const deck = CreateBoxVertexData({
    width: CHASSIS.width,
    height: CHASSIS.thick,
    depth: CHASSIS.length,
  });
  pushVertexData(
    b,
    deck,
    Matrix.Translation(0, CHASSIS.deckY, 0),
    WOOD_CELL,
    SIEGE_BONES.body,
    'deck',
    config,
  );
  for (const sx of [-1, 1]) {
    const rail = CreateBoxVertexData({ width: 0.2, height: 0.32, depth: CHASSIS.length + 0.3 });
    pushVertexData(
      b,
      rail,
      Matrix.Translation(sx * (CHASSIS.width / 2 - 0.02), CHASSIS.deckY + 0.24, 0),
      config.teamCell ?? IRON_CELL,
      SIEGE_BONES.body,
      'rail',
      config,
    );
  }
  const beam = CreateBoxVertexData({ width: 0.16, height: 0.14, depth: 0.7 });
  pushVertexData(
    b,
    beam,
    Matrix.Translation(0, CHASSIS.deckY - 0.02, CHASSIS.length / 2 + 0.3),
    WOOD_CELL,
    SIEGE_BONES.body,
    'beam',
    config,
  );
  const wheel = CreateCylinderVertexData({
    height: CHASSIS.wheelW,
    diameter: CHASSIS.wheelR * 2,
    tessellation: 10,
  });
  const axleY = CHASSIS.wheelR;
  for (const [z, bone] of [
    [CHASSIS.axleZ, SIEGE_BONES.frontAxle],
    [-CHASSIS.axleZ, SIEGE_BONES.backAxle],
  ] as const) {
    for (const sx of [-1, 1]) {
      const xf = Matrix.RotationZ(Math.PI / 2).multiply(
        Matrix.Translation(sx * CHASSIS.wheelX, axleY, z),
      );
      pushVertexData(b, wheel, xf, WHEEL_CELL, bone, 'wheel', config);
    }
  }

  const mesh = finish(b, config.id, scene, false);
  mesh.skeleton = placeholderSkeleton(config.id, SIEGE_BONE_COUNT, scene);
  mesh.numBoneInfluencers = 1;
  mesh.material = creepMaterial(config.id, scene, albedo);
  for (const m of meshes) m.setEnabled(false);

  const pivotBody = new Vector3(0, CHASSIS.deckY, 0);
  const clipByName = new Map<string, SiegeClip>(
    (Object.keys(SIEGE_CLIPS) as SiegeClip[]).map((k2) => [SIEGE_CLIPS[k2].name, k2]),
  );
  const about = (pivot: Vector3, rot: Matrix) =>
    Matrix.Translation(-pivot.x, -pivot.y, -pivot.z)
      .multiply(rot)
      .multiply(Matrix.Translation(pivot.x, pivot.y, pivot.z));
  return {
    mesh,
    boneCount: SIEGE_BONE_COUNT,
    clips: (Object.keys(SIEGE_CLIPS) as SiegeClip[]).map((k2) => ({ ...SIEGE_CLIPS[k2] })),
    sample(clip, t, target) {
      const p = siegePose(clipByName.get(clip)!, t);
      const bodyM = about(
        pivotBody,
        Matrix.RotationX(p.bodyPitch).multiply(Matrix.RotationZ(p.bodyRoll)),
      ).multiply(Matrix.Translation(0, p.bodyY, 0));
      // Positive arm = thrown forward (+Z): rotate about X toward +Z.
      const armM = about(armPivot, Matrix.RotationX(p.arm)).multiply(bodyM);
      const wheelM = (z: number) =>
        about(new Vector3(0, axleY, z), Matrix.RotationX(p.wheel)).multiply(bodyM);
      bodyM.copyToArray(target, SIEGE_BONES.body * 16);
      armM.copyToArray(target, SIEGE_BONES.arm * 16);
      wheelM(CHASSIS.axleZ).copyToArray(target, SIEGE_BONES.frontAxle * 16);
      wheelM(-CHASSIS.axleZ).copyToArray(target, SIEGE_BONES.backAxle * 16);
      Matrix.IdentityReadOnly.copyToArray(target, SIEGE_BONE_COUNT * 16);
    },
    release() {
      disposeKeeping(c, albedo);
    },
  };
}

export function buildCreepMesh(scene: Scene, config: CreepTypeConfig): Promise<CreepMeshData> {
  return config.build === 'siege'
    ? buildSiegeCreep(scene, config)
    : buildSkinnedCreep(scene, config);
}
