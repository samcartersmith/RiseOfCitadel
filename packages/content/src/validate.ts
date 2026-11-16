import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodType } from 'zod';
import { MapSchema } from './map';
import { HeroSchema } from './schemas';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
let errors = 0;
let checked = 0;

/** Validate every JSON file in `data/<folder>` against `schema`, with unique top-level ids. */
function validateFolder(folder: string, schema: ZodType<{ id: string }>): void {
  const dir = join(dataDir, folder);
  if (!existsSync(dir)) return;
  const ids = new Set<string>();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const file of files) {
    checked++;
    const result = schema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    if (!result.success) {
      errors++;
      console.error(
        `${folder}/${file}:\n${result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
      );
    } else if (ids.has(result.data.id)) {
      errors++;
      console.error(`${folder}/${file}: duplicate id "${result.data.id}"`);
    } else {
      ids.add(result.data.id);
    }
  }
}

validateFolder('heroes', HeroSchema);
validateFolder('map', MapSchema);

console.log(`validated ${checked} content file(s), ${errors} error(s)`);
process.exit(errors ? 1 : 0);
