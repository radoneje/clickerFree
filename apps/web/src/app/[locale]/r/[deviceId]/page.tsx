import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RemoteClient } from '../../remote/[deviceId]/remote-client';

export const dynamic = 'force-dynamic';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

export default async function SpeakerRemotePage({
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
  const sessionResponse = await fetch(`${API_INTERNAL_URL}/api/invitations/session`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!sessionResponse.ok) redirect(`/${locale}/i`);
  const session = (await sessionResponse.json()) as { deviceId: string };
  if (session.deviceId !== deviceId) redirect(`/${locale}/i`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <RemoteClient deviceId={deviceId} isOwner={false} />
    </main>
  );
}
