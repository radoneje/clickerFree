import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { LocaleSwitcher } from '@/components/locale-switcher';
import '../globals.css';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

async function isSignedIn(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore
      .getAll()
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ');
    const response = await fetch(`${API_INTERNAL_URL}/api/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('app');
  const nav = await getTranslations('nav');
  const authed = await isSignedIn();

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <NextIntlClientProvider>
          <header className="border-b border-neutral-200 bg-white">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3">
              <a href={`/${locale}`} className="text-lg font-semibold">
                {t('name')}
              </a>
              <nav aria-label={t('name')} className="flex flex-wrap items-center gap-3 text-sm">
                <a className="text-blue-700 hover:underline" href={`/${locale}/cabinet`}>
                  {nav('cabinet')}
                </a>
                <a className="text-blue-700 hover:underline" href={`/${locale}/settings`}>
                  {nav('settings')}
                </a>
                <a className="text-blue-700 hover:underline" href={`/${locale}/login`}>
                  {nav('login')}
                </a>
                <LocaleSwitcher locale={locale} isAuthed={authed} />
              </nav>
            </div>
          </header>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
