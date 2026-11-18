import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOGICAL_STATES } from '../../units/states';
import { requiredClips } from '../../units/modelConfig';
import {
  BONE_PARENTS,
  BONE_SCALES,
  BULWARK_VIEW_CONFIG,
  HERO_BUDGET,
  inheritedScale,
} from './config';
import { triangleCount } from './geometry';
import { BULWARK_PARTS, SHIELD } from './parts';
import { TEAM_CELLS, cellFor, cellOf } from './palette';

/** Nodes and per-mesh triangle counts straight from the committed Knight GLB. */
function knightGlb() {
  const file = fileURLToPath(
    new URL('../../../public/models/kaykit-adventurers/knight.glb', import.meta.url),
  );
  const b = readFileSync(file);
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as {
    nodes: { name: string; mesh?: number }[];
    meshes: { primitives: { indices: number }[] }[];
    accessors: { count: number }[];
  };
  const tris = new Map<string, number>();
  for (const n of json.nodes) {
    if (n.mesh === undefined) continue;
    const m = json.meshes[n.mesh]!;
    tris.set(
      n.name,
      m.primitives.reduce((s, p) => s + json.accessors[p.indices]!.count / 3, 0),
    );
  }
  return { nodes: json.nodes.map((n) => n.name), tris };
}

const BODY_PARTS = [
  'Knight_ArmLeft',
  'Knight_ArmRight',
  'Knight_Body',
  'Knight_Head',
  'Knight_LegLeft',
  'Knight_LegRight',
];

describe('bulwark view config', () => {
  it('maps every logical state to a clip the Knight GLB keeps', () => {
    expect(Object.keys(BULWARK_VIEW_CONFIG.clips).sort()).toEqual([...LOGICAL_STATES].sort());
    const kept = new Set(requiredClips('knight'));
    for (const clip of Object.values(BULWARK_VIEW_CONFIG.clips)) expect(kept.has(clip)).toBe(true);
  });

  it('hides the stock sword and shields and keeps helmet + cape', () => {
    const { nodes } = knightGlb();
    for (const p of [...BULWARK_VIEW_CONFIG.props.show, ...BULWARK_VIEW_CONFIG.props.hide])
      expect(nodes).toContain(p);
    expect(BULWARK_VIEW_CONFIG.props.hide).toEqual(
      expect.arrayContaining(['1H_Sword', 'Rectangle_Shield', 'Round_Shield']),
    );
    expect(BULWARK_VIEW_CONFIG.props.show).toEqual(['Knight_Helmet', 'Knight_Cape']);
  });

  it('scales only Rig_Medium bones it knows the parents of', () => {
    const { nodes } = knightGlb();
    for (const bone of Object.keys(BONE_SCALES)) {
      expect(nodes).toContain(bone);
      expect(bone in BONE_PARENTS).toBe(true);
    }
    expect(inheritedScale('handslot.r')).toBeCloseTo(1.08 * 1.18 * 1.18, 6);
    expect(inheritedScale('hips')).toBe(1);
  });
});

describe('bulwark kit-bash parts', () => {
  const built = BULWARK_PARTS.map((p) => ({ spec: p, mesh: p.build() }));

  it('attach to bones that exist in the rig', () => {
    const { nodes } = knightGlb();
    for (const { spec } of built) {
      expect(nodes).toContain(spec.bone);
      expect(spec.bone in BONE_PARENTS).toBe(true);
      // Orthonormal, right-handed basis.
      const [x, y, z] = spec.axes;
      const dot = (a: readonly number[], b: readonly number[]) =>
        a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
      expect(dot(x, y)).toBeCloseTo(0, 6);
      expect(dot(y, z)).toBeCloseTo(0, 6);
      const cz = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
      expect(dot(cz, z)).toBeCloseTo(1, 6);
    }
  });

  it('are well-formed meshes', () => {
    for (const { mesh } of built) {
      const verts = mesh.positions.length / 3;
      expect(mesh.normals.length).toBe(mesh.positions.length);
      expect(mesh.uvs.length).toBe(verts * 2);
      for (const i of mesh.indices) expect(i).toBeLessThan(verts);
    }
  });

  it('carry team colour only on the shield banner', () => {
    for (const { spec, mesh } of built) {
      const cells = new Set<string>();
      for (let i = 0; i < mesh.uvs.length; i += 2)
        cells.add(cellOf(mesh.uvs[i]!, mesh.uvs[i + 1]!)!);
      const team = [...cells].filter((c) => TEAM_CELLS.includes(c as never));
      if (spec.name === 'bulwark_gate_shield') expect(team).toEqual([cellFor('teamShield')]);
      else expect(team).toEqual([]);
    }
  });

  it('keep the gate shield a tall arch', () => {
    expect(SHIELD.height).toBeGreaterThan(SHIELD.width);
    const shield = built.find((b) => b.spec.name === 'bulwark_gate_shield')!.mesh;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < shield.positions.length; i += 3) {
      lo = Math.min(lo, shield.positions[i]!);
      hi = Math.max(hi, shield.positions[i]!);
    }
    expect(hi - lo).toBeGreaterThanOrEqual(SHIELD.height);
  });

  it('fit the hero budget together with the visible Knight body', () => {
    const { tris } = knightGlb();
    const body = [...BODY_PARTS, ...BULWARK_VIEW_CONFIG.props.show].reduce(
      (s, n) => s + (tris.get(n) ?? 0),
      0,
    );
    const parts = built.reduce((s, b) => s + triangleCount(b.mesh), 0);
    expect(body).toBeGreaterThan(4000);
    expect(body + parts).toBeLessThanOrEqual(HERO_BUDGET.triangles);
  });
});
