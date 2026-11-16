import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeroSchema } from './schemas';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
let errors = 0;
let checked = 0;

const ids = new Set<string>();
for (const file of readdirSync(join(dataDir, 'heroes')).filter((f) => f.endsWith('.json'))) {
  checked++;
  const result = HeroSchema.safeParse(
    JSON.parse(readFileSync(join(dataDir, 'heroes', file), 'utf8')),
  );
  if (!result.success) {
    errors++;
    console.error(
      `heroes/${file}:\n${result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  } else if (ids.has(result.data.id)) {
    errors++;
    console.error(`heroes/${file}: duplicate id "${result.data.id}"`);
  } else {
    ids.add(result.data.id);
  }
}

console.log(`validated ${checked} content file(s), ${errors} error(s)`);
process.exit(errors ? 1 : 0);
