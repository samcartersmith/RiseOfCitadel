/**
 * Download every CC0 source pack listed in assets-src/<pack>/manifest.json
 * into assets-src/<pack>/raw (git-ignored), then verify its license file.
 *
 *   pnpm assets:fetch            # fetch packs that are missing
 *   pnpm assets:fetch --force    # re-download everything
 *   pnpm assets:fetch <pack-id>  # just one pack
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { unzipSync } from 'fflate';
import { loadManifests, rawDir, type Download, type PackManifest } from './manifest';

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

async function get(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { 'User-Agent': 'citadel-asset-fetch' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function extractZip(bytes: Uint8Array, dest: string, stripTopDir: boolean) {
  const files = unzipSync(bytes);
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    let rel = name;
    if (stripTopDir) rel = name.split('/').slice(1).join('/');
    if (!rel) continue;
    const out = normalize(join(dest, rel));
    if (!out.startsWith(normalize(dest))) throw new Error(`zip path escapes target: ${name}`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
  }
}

async function download(d: Download, dest: string) {
  switch (d.type) {
    case 'github-zip':
      extractZip(
        await get(`https://codeload.github.com/${d.repo}/zip/refs/heads/${d.ref}`),
        dest,
        true,
      );
      break;
    case 'zip':
      extractZip(await get(d.url), dest, false);
      break;
    case 'file':
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, d.filename), await get(d.url));
      break;
  }
}

function verifyLicense(m: PackManifest) {
  if (!m.licenseFile) return;
  const file = join(rawDir(m.id), m.licenseFile);
  if (!existsSync(file))
    throw new Error(`${m.id}: license file ${m.licenseFile} missing after download`);
  const text = readFileSync(file, 'utf8').toLowerCase();
  const needle = (m.licenseMustContain ?? 'cc0').toLowerCase();
  if (!text.includes(needle)) throw new Error(`${m.id}: license file does not mention "${needle}"`);
}

let failed = 0;
for (const m of loadManifests()) {
  if (only.length && !only.includes(m.id)) continue;
  const dest = rawDir(m.id);
  if (existsSync(dest) && !force) {
    console.log(`skip   ${m.id} (already fetched)`);
    continue;
  }
  rmSync(dest, { recursive: true, force: true });
  try {
    process.stdout.write(`fetch  ${m.id} … `);
    for (const d of m.downloads) await download(d, dest);
    verifyLicense(m);
    console.log('ok');
  } catch (err) {
    failed++;
    rmSync(dest, { recursive: true, force: true });
    console.log(`FAILED\n  ${(err as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
