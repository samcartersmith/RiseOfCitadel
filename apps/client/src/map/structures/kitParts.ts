/**
 * Loads the processed KayKit Medieval Hexagon pieces (apps/client/public/models/
 * kaykit-medieval-hexagon/*.glb, built by `pnpm assets:build` from the pack
 * manifest) and flattens each into plain geometry arrays in the piece's own
 * space, so recipes can kit-bash them. All pieces share one 1024² gradient
 * atlas; the first piece's texture is kept and every other copy is disposed.
 */
import '@babylonjs/loaders/glTF/2.0';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { appendGeom, emptyGeom, withWinding, type Geom } from './geometry';
import type { PieceId } from './recipes';

export const PIECE_BASE_URL = '/models/kaykit-medieval-hexagon';

export interface KitLibrary {
  pieces: Map<PieceId, Geom>;
  /** The shared KayKit hexagon atlas (glTF UV convention, invertY = false). */
  atlas: BaseTexture;
}

interface MaterialWithTexture {
  albedoTexture?: BaseTexture | null;
  diffuseTexture?: BaseTexture | null;
}

/** Bakes every mesh of a loaded piece (incl. the glTF root's handedness flip) into one Geom. */
function extract(meshes: readonly Mesh[], winding: 1 | -1): Geom {
  const out = emptyGeom();
  const p = new Vector3();
  for (const m of meshes) {
    const pos = m.getVerticesData(VertexBuffer.PositionKind);
    const nrm = m.getVerticesData(VertexBuffer.NormalKind);
    const uv = m.getVerticesData(VertexBuffer.UVKind);
    const idx = m.getIndices();
    if (!pos || !idx) continue;
    const world = m.computeWorldMatrix(true);
    const g: Geom = { positions: [], normals: [], uvs: [], indices: Array.from(idx) };
    for (let i = 0; i < pos.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(pos[i]!, pos[i + 1]!, pos[i + 2]!, world, p);
      g.positions.push(p.x, p.y, p.z);
      if (nrm) {
        Vector3.TransformNormalFromFloatsToRef(nrm[i]!, nrm[i + 1]!, nrm[i + 2]!, world, p);
        p.normalize();
        g.normals.push(p.x, p.y, p.z);
      } else g.normals.push(0, 1, 0);
    }
    for (let i = 0; i < pos.length / 3; i++) g.uvs.push(uv?.[i * 2] ?? 0, uv?.[i * 2 + 1] ?? 0);
    // The root's mirror flips triangle order; restore one convention for everything.
    appendGeom(out, withWinding(g, winding));
  }
  return out;
}

const libraries = new WeakMap<Scene, Map<string, Promise<KitLibrary>>>();

/**
 * Loads the named pieces once per scene. `winding` is the scene-wide triangle
 * convention (see geometry.windingSign), measured from Babylon's own builders.
 */
export function loadKitLibrary(
  scene: Scene,
  ids: readonly PieceId[],
  winding: 1 | -1,
  baseUrl = PIECE_BASE_URL,
): Promise<KitLibrary> {
  const key = `${baseUrl}|${[...ids].sort().join(',')}`;
  let perScene = libraries.get(scene);
  if (!perScene) libraries.set(scene, (perScene = new Map()));
  const hit = perScene.get(key);
  if (hit) return hit;
  const p = (async () => {
    const containers = await Promise.all(
      ids.map((id) => LoadAssetContainerAsync(`${baseUrl}/${id}.glb`, scene)),
    );
    let atlas: BaseTexture | null = null;
    const pieces = new Map<PieceId, Geom>();
    containers.forEach((c, i) => {
      const meshes = c.meshes.filter(
        (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
      );
      pieces.set(ids[i]!, extract(meshes, winding));
      if (!atlas) {
        const mat = meshes.find((m) => m.material)?.material as MaterialWithTexture | undefined;
        const tex = mat?.albedoTexture ?? mat?.diffuseTexture ?? null;
        if (tex) {
          atlas = tex;
          // Keep this one texture alive past the container's disposal.
          c.textures.splice(c.textures.indexOf(tex as never), 1);
          scene.addTexture(tex as never);
        }
      }
      c.dispose();
    });
    if (!atlas) throw new Error('kit pieces carry no atlas texture');
    return { pieces, atlas };
  })();
  perScene.set(key, p);
  p.catch(() => perScene.delete(key));
  return p;
}
