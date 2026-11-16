import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

export const dynamic = 'force-dynamic';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

export default async function CabinetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('cabinet');
  const nav = await getTranslations('nav');

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ');
  const meResponse = await fetch(`${API_INTERNAL_URL}/api/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!meResponse.ok) redirect(`/${locale}/login`);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <section
        aria-label={t('title')}
        className="mt-6 rounded border border-neutral-200 bg-white p-6"
      >
        <p className="text-sm font-medium">{t('empty')}</p>
        <p className="mt-2 text-sm text-neutral-600">{t('emptyHint')}</p>
      </section>
      <a
        href={`/${locale}/settings`}
        className="mt-6 inline-block text-sm text-blue-700 hover:underline"
      >
        {nav('settings')}
      </a>
    </main>
  );
}
