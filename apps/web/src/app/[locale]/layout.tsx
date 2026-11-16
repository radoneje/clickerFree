import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import '../globals.css';

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

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <NextIntlClientProvider>
          <header className="border-b border-neutral-200 bg-white">
            <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
              <a href={`/${locale}`} className="text-lg font-semibold">
                {t('name')}
              </a>
              <nav className="flex gap-4 text-sm">
                <a className="text-blue-700 hover:underline" href={`/${locale}/login`}>
                  {nav('login')}
                </a>
                <a className="text-blue-700 hover:underline" href={`/${locale}/settings`}>
                  {nav('settings')}
                </a>
              </nav>
            </div>
          </header>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
