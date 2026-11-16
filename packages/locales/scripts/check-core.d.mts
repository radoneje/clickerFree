export type Dictionary = Record<string, string>;

export function placeholders(text: string): string[];

export function checkDictionaries(
  ru: Dictionary,
  en: Dictionary,
  errorCatalog: Record<string, readonly string[]>,
): string[];
