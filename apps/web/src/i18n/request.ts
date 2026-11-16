import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import ru from '@clickerfree/locales/ru';
import en from '@clickerfree/locales/en';
import { routing } from './routing';

// Словари хранятся плоскими ключами; next-intl ожидает вложенные пространства имён.
function unflatten(flat: Record<string, string>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      node[part] ??= {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1] as string] = value;
  }
  return root;
}

const messages = { ru: unflatten(ru), en: unflatten(en) };

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return { locale, messages: messages[locale] };
});
