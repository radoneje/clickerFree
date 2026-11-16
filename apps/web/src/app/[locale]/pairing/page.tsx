import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PairingForm } from './form';

export const dynamic = 'force-dynamic';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

export default async function PairingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pairing');

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
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-2 text-sm text-neutral-600">{t('hint')}</p>
      <PairingForm locale={locale} />
    </main>
  );
}
