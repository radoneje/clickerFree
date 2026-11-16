import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DeviceList, type Device } from './devices';

export const dynamic = 'force-dynamic';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

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

export default async function CabinetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('cabinet');
  const nav = await getTranslations('nav');

  const meResponse = await fetchWithSession('/api/me');
  if (!meResponse.ok) redirect(`/${locale}/login`);

  const devicesResponse = await fetchWithSession('/api/devices');
  const devices: Device[] = devicesResponse.ok
    ? ((await devicesResponse.json()) as { devices: Device[] }).devices
    : [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {devices.length === 0 ? (
        <section
          aria-label={t('devices')}
          className="mt-6 rounded border border-neutral-200 bg-white p-6"
        >
          <p className="text-sm font-medium">{t('empty')}</p>
          <p className="mt-2 text-sm text-neutral-600">{t('emptyHint')}</p>
        </section>
      ) : (
        <DeviceList devices={devices} locale={locale} />
      )}
      <a
        href={`/${locale}/settings`}
        className="mt-6 inline-block text-sm text-blue-700 hover:underline"
      >
        {nav('settings')}
      </a>
    </main>
  );
}
