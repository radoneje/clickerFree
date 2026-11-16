import { readFileSync } from 'node:fs';
import { errorCatalog } from '@clickerfree/contracts';
import { checkDictionaries } from './check-core.mjs';

const packageRoot = new URL('../', import.meta.url);
const ru = JSON.parse(readFileSync(new URL('ru.json', packageRoot), 'utf8'));
const en = JSON.parse(readFileSync(new URL('en.json', packageRoot), 'utf8'));

const issues = checkDictionaries(ru, en, errorCatalog);
if (issues.length > 0) {
  console.error(`locales check failed (${issues.length} issue(s)):`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}
console.log(`locales check passed: ${Object.keys(ru).length} keys, ru/en in sync.`);
