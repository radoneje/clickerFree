import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ru', 'en'],
  defaultLocale: 'ru',
  localeCookie: { name: 'cf_lang', sameSite: 'lax' },
  localePrefix: 'always',
});
