import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SettingsActions } from './actions';

export const dynamic = 'force-dynamic';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

export interface Me {
  id: string;
  role: string;
  siteLang: 'ru' | 'en';
  providers: string[];
}

async function fetchWithSession(path: string): Promise<Response> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ');
  return fetch(`${API_INTERNAL_URL}${path}`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
}

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('settings');

  const meResponse = await fetchWithSession('/api/me');
  if (meResponse.status === 401) redirect(`/${locale}/login`);
  if (!meResponse.ok) redirect(`/${locale}/login?error=internal_error`);
  const me = (await meResponse.json()) as Me;

  const providersResponse = await fetch(`${API_INTERNAL_URL}/api/auth/providers`, {
    cache: 'no-store',
  });
  const available = providersResponse.ok
    ? (((await providersResponse.json()) as { providers?: string[] }).providers ?? [])
    : [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <SettingsActions me={me} available={available} locale={locale} />
    </main>
  );
}
