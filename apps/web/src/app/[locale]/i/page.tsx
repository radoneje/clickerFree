import { getTranslations, setRequestLocale } from 'next-intl/server';
import { InviteGate } from './gate';

export const dynamic = 'force-dynamic';

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { token } = await searchParams;
  const t = await getTranslations('invite');

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <InviteGate token={token} />
    </main>
  );
}
