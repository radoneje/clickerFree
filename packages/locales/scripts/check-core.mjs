const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

export function placeholders(text) {
  const found = [...text.matchAll(PLACEHOLDER)].map((match) => match[1]);
  return [...new Set(found)].sort();
}

export function checkDictionaries(ru, en, errorCatalog) {
  const issues = [];

  for (const key of Object.keys(ru)) {
    if (!(key in en)) issues.push(`missing en key: ${key}`);
  }
  for (const key of Object.keys(en)) {
    if (!(key in ru)) issues.push(`missing ru key: ${key}`);
  }

  for (const key of Object.keys(ru)) {
    if (!(key in en)) continue;
    const ruParams = placeholders(ru[key]).join(',');
    const enParams = placeholders(en[key]).join(',');
    if (ruParams !== enParams) {
      issues.push(`placeholder mismatch for "${key}": ru={${ruParams}} en={${enParams}}`);
    }
  }

  for (const [code, params] of Object.entries(errorCatalog)) {
    const key = `errors.${code}`;
    const expected = [...params].sort().join(',');
    for (const [lang, dict] of [
      ['ru', ru],
      ['en', en],
    ]) {
      if (!(key in dict)) {
        issues.push(`missing ${lang} key: ${key}`);
        continue;
      }
      const actual = placeholders(dict[key]).join(',');
      if (actual !== expected) {
        issues.push(
          `error params mismatch for "${key}" (${lang}): expected={${expected}} actual={${actual}}`,
        );
      }
    }
  }

  return issues;
}
