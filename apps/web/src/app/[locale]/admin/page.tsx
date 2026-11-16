import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdminHub } from './admin-hub';

export const dynamic = 'force-dynamic';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin');

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
  const me = (await meResponse.json()) as { role: string };
  if (me.role !== 'admin') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <p role="alert" className="text-sm text-red-700">
          {t('forbidden')}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{t('hub')}</h1>
      <AdminHub locale={locale} />
    </main>
  );
}
