import { getTranslations, setRequestLocale } from 'next-intl/server';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

const DOWNLOAD_TARGETS = [
  { os: 'windows', arch: 'x64', labelKey: 'os.windows' },
  { os: 'macos', arch: 'arm64', labelKey: 'os.macos' },
] as const;

async function fetchDownloads() {
  const results = [];
  for (const target of DOWNLOAD_TARGETS) {
    let available = false;
    try {
      const response = await fetch(
        `${API_INTERNAL_URL}/api/worker/version?os=${target.os}&arch=${target.arch}&appVersion=0.0.0&protocolVersion=1`,
        { cache: 'no-store' },
      );
      if (response.ok) {
        const info = (await response.json()) as { downloadUrl: string | null };
        available = info.downloadUrl !== null;
      }
    } catch {
      available = false;
    }
    results.push({ ...target, available });
  }
  return results;
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('landing');
  const downloads = await fetchDownloads();

  const features = [t('features.remote'), t('features.speaker'), t('features.secure')];
  const steps = [t('steps.one'), t('steps.two'), t('steps.three')];
  const faq = [
    { q: t('faq.q1'), a: t('faq.a1') },
    { q: t('faq.q2'), a: t('faq.a2') },
    { q: t('faq.q3'), a: t('faq.a3') },
    { q: t('faq.q4'), a: t('faq.a4') },
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <section className="text-center">
        <h1 className="text-3xl font-semibold sm:text-4xl">{t('hero.title')}</h1>
        <p className="mx-auto mt-3 max-w-xl text-neutral-600">{t('hero.subtitle')}</p>
        <a
          href={`/${locale}/login`}
          className="mt-6 inline-block rounded bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t('hero.cta')}
        </a>
      </section>

      <section className="mt-16" aria-labelledby="features">
        <h2 id="features" className="text-xl font-semibold">
          {t('features.title')}
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          {features.map((feature) => (
            <li
              key={feature}
              className="rounded border border-neutral-200 bg-white p-4 text-sm text-neutral-700"
            >
              {feature}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16" aria-labelledby="steps">
        <h2 id="steps" className="text-xl font-semibold">
          {t('steps.title')}
        </h2>
        <ol className="mt-4 flex list-decimal flex-col gap-3 pl-6 text-sm text-neutral-700">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="mt-16" aria-labelledby="os">
        <h2 id="os" className="text-xl font-semibold">
          {t('os.title')}
        </h2>
        <ul className="mt-4 flex flex-wrap gap-3 text-sm">
          <li className="rounded border border-neutral-200 bg-white px-4 py-2">
            {t('os.windows')}
          </li>
          <li className="rounded border border-neutral-200 bg-white px-4 py-2">{t('os.macos')}</li>
        </ul>
      </section>

      <section className="mt-16" aria-labelledby="download" id="download">
        <h2 id="download" className="text-xl font-semibold">
          {t('download.title')}
        </h2>
        {downloads.some((item) => item.available) ? (
          <ul className="mt-4 flex flex-col gap-3">
            {downloads
              .filter((item) => item.available)
              .map((item) => (
                <li key={`${item.os}-${item.arch}`}>
                  <a
                    href={`/api/download/${item.os}/${item.arch}`}
                    className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    {t('download.get')} — {t(item.labelKey)}
                  </a>
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-3 rounded border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
            {t('download.soon')}
          </p>
        )}
      </section>

      <section className="mt-16" aria-labelledby="faq">
        <h2 id="faq" className="text-xl font-semibold">
          {t('faq.title')}
        </h2>
        <div className="mt-4 flex flex-col gap-2">
          {faq.map((item) => (
            <details
              key={item.q}
              className="rounded border border-neutral-200 bg-white px-4 py-3 text-sm"
            >
              <summary className="cursor-pointer font-medium">{item.q}</summary>
              <p className="mt-2 text-neutral-600">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
