/**
 * Bulwark's kit-bash parts, built from code (docs/design/heroes/bulwark.md §2).
 *
 * Each part is a rigid mesh attached to a Rig_Medium bone, like the KayKit
 * props it replaces (hero-pipeline.md §1). Geometry is authored in the bone's
 * local frame, in final model units: the loader cancels the bone proportion
 * scales (config.ts BONE_SCALES) on the part node, so pushing the shoulders
 * doesn't also inflate the shield.
 *
 * Frames (from the Knight's own props):
 * - `hips` (gate shield): at rest +Y is up, +Z forward, +X the hero's left
 *   (see SHIELD_MOUNT for why it isn't on the hand).
 * - `handslot.r` (weapon): like the stock 1H_Sword. +Y runs from the grip to
 *   the weapon head.
 * - `upperarm.l/.r` (pauldrons): +Y runs down the arm; at rest +Z is world up.
 *
 * Pure (no Babylon); shapes and budgets are checked in parts.test.ts.
 */
import {
  archOutline,
  box,
  cylinder,
  extrude,
  frame,
  hash01,
  lump,
  mergeMeshes,
  torus,
  type MeshData,
  type Vec3,
} from './geometry';
import { cellFor } from './palette';

export type AttachBone = 'hips' | 'handslot.r' | 'upperarm.l' | 'upperarm.r';

export interface PartSpec {
  name: string;
  bone: AttachBone;
  /** Offset of the part's origin (model units), in the part's own frame: it turns with `axes`. */
  position: Vec3;
  /**
   * Orientation: where the part's own +X, +Y and +Z axes point in the bone
   * frame (an orthonormal, right-handed basis).
   */
  axes: readonly [Vec3, Vec3, Vec3];
  build(): MeshData;
}

/** Gate-shield dimensions (model units, scale-1 hero is ~2.4 tall). */
export const SHIELD = {
  width: 1.45,
  height: 2.05,
  /** Thickness of the wooden gate slab. */
  thickness: 0.1,
  /** Stone arch frame band width and depth. */
  frameWidth: 0.1,
  frameDepth: 0.17,
  archSegments: 8,
} as const;

const C = {
  wood: cellFor('wood'),
  stone: cellFor('gateStone'),
  iron: cellFor('chain'),
  bronze: cellFor('trimBright'),
  team: cellFor('teamShield'),
  moss: cellFor('moss'),
  rubble: cellFor('rubble'),
  ember: cellFor('ember'),
  grip: cellFor('grip'),
  plate: cellFor('plateDark'),
};

/** The shield in its own frame: bottom edge at y = 0, outer face toward +Z, centred on x. */
export function buildGateShield(): MeshData {
  const { width: W, height: H, thickness: T, frameWidth: F, frameDepth: FD } = SHIELD;
  const r = W / 2;
  const spring = H - r;
  const outer = archOutline(W, H, SHIELD.archSegments);
  // Inner outline of the stone frame: the same arch inset by F. Same spring line, so the
  // band's sides stay F wide. The bottom stays open (no sill under the gate).
  const inner = archOutline(W - 2 * F, H - F, SHIELD.archSegments);
  const front = T / 2;
  const parts: MeshData[] = [];

  // Gate slab (wood planks) and the stone arch frame around it.
  parts.push(extrude(outer, T, C.wood));
  // archOutline lists [bottom-left, bottom-right, arc right→left]; the open band runs
  // counter-clockwise from the bottom-right corner, over the arch, to the bottom-left.
  const o: [number, number][] = [[r, 0], ...outer.slice(2), [-r, 0]];
  const i: [number, number][] = [[r - F, 0], ...inner.slice(2), [-r + F, 0]];
  parts.push(frame(o, i, FD, C.stone, false));
  // Keystone at the top of the arch.
  parts.push(box([0.2, 0.24, FD + 0.06], C.stone, { t: [0, H - 0.08, 0] }));
  // Plank seams: two vertical dark grooves on the face.
  for (const x of [-r / 3, r / 3]) {
    parts.push(
      box([0.025, spring + r * 0.85 - F, 0.012], C.iron, {
        t: [x, (spring + r * 0.85 - F) / 2, front + 0.004],
      }),
    );
  }
  // Iron bands with bronze studs.
  const bands = [0.22, spring * 0.62];
  for (const y of bands) {
    parts.push(box([W - 2 * F, 0.09, 0.03], C.iron, { t: [0, y, front + 0.012] }));
    for (let k = 0; k < 4; k++) {
      const x = -r + F + ((k + 0.5) / 4) * (W - 2 * F);
      parts.push(
        box([0.06, 0.06, 0.05], C.bronze, { t: [x, y, front + 0.03], r: [0, 0, Math.PI / 4] }),
      );
    }
  }
  // Banner (team cloth) hanging from a bronze rod under the arch: swallowtail.
  const bw = 0.98;
  const bl = 1.35;
  const rodY = spring + 0.05;
  parts.push(
    cylinder(0.025, 0.025, bw + 0.14, 6, C.bronze, {
      t: [0, rodY, front + 0.06],
      r: [0, 0, Math.PI / 2],
    }),
  );
  for (const x of [-(bw + 0.14) / 2, (bw + 0.14) / 2]) {
    parts.push(
      lump(6, 3, 0, 1, C.bronze, { t: [x, rodY, front + 0.06], s: [0.045, 0.045, 0.045] }),
    );
  }
  const notch = 0.2;
  const banner: [number, number][] = [
    [0, -bl + notch], // reflex vertex first: the fan starts here
    [bw / 2, -bl],
    [bw / 2, 0],
    [-bw / 2, 0],
    [-bw / 2, -bl],
  ];
  parts.push(extrude(banner, 0.025, C.team, { t: [0, rodY - 0.02, front + 0.045] }, 0));
  // Bronze hem on the banner's top.
  parts.push(box([bw + 0.02, 0.06, 0.04], C.bronze, { t: [0, rodY - 0.05, front + 0.05] }));

  // Chains hanging off both sides of the arch.
  for (const side of [-1, 1]) {
    const x = side * (r + 0.02);
    for (let k = 0; k < 5; k++) {
      parts.push(
        torus(0.05, 0.016, 6, 3, C.iron, {
          t: [x, spring - 0.02 - k * 0.085, front + 0.02],
          r: [0, k % 2 ? Math.PI / 2 : 0, Math.PI / 2],
          s: [1, 0.75, 1],
        }),
      );
    }
    // A hanging weight at the end: a small stone chunk.
    parts.push(
      lump(5, 3, 0.25, 40 + side, C.rubble, {
        t: [x, spring - 0.5, front + 0.02],
        s: [0.07, 0.08, 0.07],
      }),
    );
  }

  // Moss growing over the top of the arch and down the shoulders of the frame.
  const mossAt: [number, number, number][] = [];
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI;
    mossAt.push([Math.cos(a) * (r - F * 0.3), spring + Math.sin(a) * (r - F * 0.3), k]);
  }
  mossAt.push(
    [r - F * 0.4, spring - 0.25, 7],
    [-r + F * 0.4, spring - 0.32, 8],
    [-r + F * 0.5, 0.35, 9],
  );
  for (const [x, y, k] of mossAt) {
    const s = 0.75 + hash01(k + 7) * 0.5;
    parts.push(
      lump(6, 3, 0.3, 10 + k, C.moss, {
        t: [x, y, FD / 2 - 0.01],
        s: [0.11 * s, 0.08 * s, 0.07],
        r: [0, 0, hash01(k) * Math.PI],
      }),
    );
  }

  // A small brazier on the back, near the top: an iron bowl with embers (glows in the ult later).
  const by = spring - 0.05;
  const bz = -(T / 2 + 0.12);
  parts.push(box([0.05, 0.05, 0.14], C.iron, { t: [0, by - 0.08, -(T / 2 + 0.06)] }));
  parts.push(cylinder(0.12, 0.07, 0.1, 6, C.iron, { t: [0, by, bz] }));
  parts.push(lump(6, 3, 0.35, 3, C.ember, { t: [0, by + 0.07, bz], s: [0.09, 0.07, 0.09] }));
  return mergeMeshes(parts);
}

/** The mace, +Y from the grip to the head. Short and heavy. */
export function buildMace(): MeshData {
  const parts: MeshData[] = [];
  parts.push(cylinder(0.04, 0.045, 0.62, 6, C.grip, { t: [0, 0.2, 0] }));
  parts.push(lump(6, 3, 0, 2, C.bronze, { t: [0, -0.13, 0], s: [0.07, 0.06, 0.07] }));
  parts.push(cylinder(0.06, 0.06, 0.05, 6, C.bronze, { t: [0, 0.48, 0] }));
  // Head: an iron core with six stone-grey flanges and bronze caps.
  const hy = 0.66;
  parts.push(cylinder(0.1, 0.1, 0.26, 6, C.iron, { t: [0, hy, 0] }));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    parts.push(
      box([0.09, 0.26, 0.035], C.plate, {
        t: [Math.cos(a) * 0.13, hy, -Math.sin(a) * 0.13],
        r: [0, a, 0],
      }),
    );
  }
  parts.push(cylinder(0.07, 0.11, 0.06, 6, C.bronze, { t: [0, hy + 0.16, 0] }));
  parts.push(lump(6, 3, 0, 4, C.bronze, { t: [0, hy + 0.21, 0], s: [0.05, 0.05, 0.05] }));
  return mergeMeshes(parts);
}

/** Rough stone chunks bolted onto a pauldron (upper-arm frame, +Z = up at rest). */
export function buildPauldronStones(seed: number): MeshData {
  const parts: MeshData[] = [];
  const chunks: [Vec3, Vec3][] = [
    [
      [0.0, 0.12, 0.16],
      [0.13, 0.1, 0.09],
    ],
    [
      [-0.1, 0.16, 0.12],
      [0.09, 0.08, 0.08],
    ],
    [
      [0.1, 0.18, 0.12],
      [0.08, 0.07, 0.07],
    ],
  ];
  chunks.forEach(([t, s], k) => {
    parts.push(lump(5, 3, 0.3, seed * 10 + k, C.rubble, { t, s, r: [hash01(seed + k) * 2, 0, 0] }));
  });
  // A tuft of moss on the largest chunk.
  parts.push(lump(5, 3, 0.3, seed + 99, C.moss, { t: [0.0, 0.12, 0.25], s: [0.08, 0.07, 0.035] }));
  return mergeMeshes(parts);
}

const IDENTITY: readonly [Vec3, Vec3, Vec3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/**
 * Where the gate shield sits, in the `hips` frame (rest pose: +Y up, +Z
 * forward, +X the hero's left). It is planted in front of his left side and
 * turned a little outward.
 *
 * Why the hips and not `handslot.l`: the KayKit clips roll the left hand by
 * ~90° between poses (the stock shield is carried edge-forward at idle and
 * face-forward in Block/Blocking), so no fixed hand offset keeps a 2-unit gate
 * upright in every state; on the chest it tilts ~45° with the run lean. On the
 * hips it stays an upright wall in every clip and still bobs and turns with
 * the body. See docs/design/heroes/bulwark.md §1.
 */
export const SHIELD_MOUNT = {
  /** Shield bottom-centre relative to the hips bone (hips are ~0.41 above the feet). */
  offset: [0.42, -0.37, 0.48] as Vec3,
  /** Yaw toward the hero's left, radians. */
  yaw: 0.22,
};

const yawAxes = (a: number): readonly [Vec3, Vec3, Vec3] => [
  [Math.cos(a), 0, -Math.sin(a)],
  [0, 1, 0],
  [Math.sin(a), 0, Math.cos(a)],
];

/** Every kit-bash part and where it attaches. Tuned by eye in /bulwark.html. */
export const BULWARK_PARTS: readonly PartSpec[] = [
  {
    name: 'bulwark_gate_shield',
    bone: 'hips',
    position: SHIELD_MOUNT.offset,
    axes: yawAxes(SHIELD_MOUNT.yaw),
    build: buildGateShield,
  },
  {
    name: 'bulwark_mace',
    bone: 'handslot.r',
    position: [0, 0, 0],
    axes: IDENTITY,
    build: buildMace,
  },
  {
    name: 'bulwark_pauldron_l',
    bone: 'upperarm.l',
    position: [0, 0, 0],
    axes: IDENTITY,
    build: () => buildPauldronStones(1),
  },
  {
    name: 'bulwark_pauldron_r',
    bone: 'upperarm.r',
    position: [0, 0, 0],
    axes: IDENTITY,
    build: () => buildPauldronStones(2),
  },
];
