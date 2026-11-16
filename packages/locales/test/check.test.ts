import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { errorCatalog } from '@clickerfree/contracts';
import { checkDictionaries, placeholders } from '../scripts/check-core.mjs';

function loadDictionary(name: string): Record<string, string> {
  return JSON.parse(readFileSync(new URL(`../${name}.json`, import.meta.url), 'utf8'));
}

const ru = loadDictionary('ru');
const en = loadDictionary('en');

describe('placeholder extraction', () => {
  it('extracts, deduplicates and sorts placeholders', () => {
    expect(placeholders('Повторите через {retryAfterSeconds} с.')).toEqual(['retryAfterSeconds']);
    expect(placeholders('{b} и {a} и {b}')).toEqual(['a', 'b']);
    expect(placeholders('без параметров')).toEqual([]);
  });
});

describe('real dictionaries', () => {
  it('ru and en are complete and in sync with the error catalog', () => {
    expect(checkDictionaries(ru, en, errorCatalog)).toEqual([]);
  });
});

describe('checkDictionaries detects problems', () => {
  const catalog = { sample_error: ['value'] } as const;
  const baseRu = { 'errors.sample_error': 'Значение: {value}.' };
  const baseEn = { 'errors.sample_error': 'Value: {value}.' };

  it('passes valid dictionaries', () => {
    expect(checkDictionaries(baseRu, baseEn, catalog)).toEqual([]);
  });

  it('flags a missing en key', () => {
    const issues = checkDictionaries({ ...baseRu, 'common.back': 'Назад' }, baseEn, catalog);
    expect(issues).toContain('missing en key: common.back');
  });

  it('flags a missing ru key', () => {
    const issues = checkDictionaries(baseRu, { ...baseEn, 'common.back': 'Back' }, catalog);
    expect(issues).toContain('missing ru key: common.back');
  });

  it('flags placeholder mismatch between locales', () => {
    const issues = checkDictionaries(baseRu, { 'errors.sample_error': 'Value: {val}.' }, catalog);
    expect(issues.some((issue) => issue.startsWith('placeholder mismatch'))).toBe(true);
  });

  it('flags params that differ from the error catalog', () => {
    const issues = checkDictionaries({ 'errors.sample_error': 'Значение.' }, baseEn, catalog);
    expect(issues.some((issue) => issue.startsWith('error params mismatch'))).toBe(true);
  });

  it('flags a missing error key required by the catalog', () => {
    const issues = checkDictionaries({}, {}, catalog);
    expect(issues).toContain('missing ru key: errors.sample_error');
    expect(issues).toContain('missing en key: errors.sample_error');
  });

  it('flags keys that are prefixes of other keys', () => {
    const issues = checkDictionaries(
      { 'settings.language': 'Язык', 'settings.language.hint': 'Подсказка' },
      { 'settings.language': 'Language', 'settings.language.hint': 'Hint' },
      {},
    );
    expect(issues).toContain(
      'key prefix collision: "settings.language" is a prefix of another key',
    );
  });
});
