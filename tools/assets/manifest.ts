import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ASSETS_SRC = join(ROOT, 'assets-src');
export const MODELS_OUT = join(ROOT, 'apps', 'client', 'public', 'models');

export type Download =
  | { type: 'github-zip'; repo: string; ref: string }
  | { type: 'zip'; url: string }
  | { type: 'file'; url: string; filename: string };

export interface ModelEntry {
  /** Path inside the extracted raw/ folder (a .glb or .gltf). */
  src: string;
  /** Output name, written to apps/client/public/models/<pack>/<out>.glb */
  out: string;
}

export interface PackManifest {
  id: string;
  name: string;
  author: string;
  /** The creator's own page or repo. Never a mirror. */
  source: string;
  license: 'CC0-1.0';
  licenseUrl: string;
  /** Text that must appear in the downloaded license file (case-insensitive). */
  licenseMustContain?: string;
  /** Path to the license file inside raw/, verified after download. */
  licenseFile?: string;
  downloads: Download[];
  models?: ModelEntry[];
  usedFor: string;
}

export function loadManifests(): PackManifest[] {
  if (!existsSync(ASSETS_SRC)) return [];
  return readdirSync(ASSETS_SRC, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const file = join(ASSETS_SRC, d.name, 'manifest.json');
      if (!existsSync(file)) throw new Error(`assets-src/${d.name} has no manifest.json`);
      const m = JSON.parse(readFileSync(file, 'utf8')) as PackManifest;
      if (m.id !== d.name)
        throw new Error(`assets-src/${d.name}: manifest id "${m.id}" must match folder`);
      if (m.license !== 'CC0-1.0') throw new Error(`assets-src/${d.name}: only CC0-1.0 is allowed`);
      return m;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export const rawDir = (id: string) => join(ASSETS_SRC, id, 'raw');
