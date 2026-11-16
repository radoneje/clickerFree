import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RemoteClient } from './remote-client';

export const dynamic = 'force-dynamic';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

export default async function RemotePage({
  params,
}: {
  params: Promise<{ locale: string; deviceId: string }>;
}) {
  const { locale, deviceId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('remote');

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ');
  const headers = { cookie: cookieHeader };
  const meResponse = await fetch(`${API_INTERNAL_URL}/api/me`, { headers, cache: 'no-store' });
  if (!meResponse.ok) redirect(`/${locale}/login`);
  const devicesResponse = await fetch(`${API_INTERNAL_URL}/api/devices`, {
    headers,
    cache: 'no-store',
  });
  const devices = devicesResponse.ok
    ? ((await devicesResponse.json()) as { devices: Array<{ id: string }> }).devices
    : [];
  if (!devices.some((device) => device.id === deviceId)) redirect(`/${locale}/cabinet`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <RemoteClient deviceId={deviceId} />
    </main>
  );
}
