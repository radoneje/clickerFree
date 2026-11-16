import { getTranslations, setRequestLocale } from 'next-intl/server';

export const dynamic = 'force-dynamic';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

async function fetchProviders(): Promise<string[]> {
  try {
    const response = await fetch(`${API_INTERNAL_URL}/api/auth/providers`, { cache: 'no-store' });
    if (!response.ok) return [];
    const data = (await response.json()) as { providers?: string[] };
    return data.providers ?? [];
  } catch {
    return [];
  }
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; provider?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { error, provider } = await searchParams;
  const t = await getTranslations('login');
  const errors = await getTranslations('errors');
  const providers = await fetchProviders();
  const labels: Record<string, string> = {
    vk: t('provider.vk'),
    yandex: t('provider.yandex'),
    dev: t('provider.dev'),
  };

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-2 text-sm text-neutral-600">{t('subtitle')}</p>
      {error && errors.has(error) ? (
        <p
          role="alert"
          className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {errors(error, { provider: provider ?? '' })}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-3">
        {providers.map((id) => (
          <a
            key={id}
            href={`/api/auth/${id}/start`}
            className="rounded bg-blue-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-blue-700"
          >
            {labels[id] ?? id}
          </a>
        ))}
        {providers.length === 0 ? (
          <p className="text-sm text-neutral-600">{t('unavailable')}</p>
        ) : null}
      </div>
    </main>
  );
}
