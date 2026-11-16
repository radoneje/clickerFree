'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Me } from './page';

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)cf_csrf=([^;]*)/);
  return match?.[1] ?? '';
}

async function api(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method,
    headers: {
      'x-csrf-token': csrfToken(),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function SettingsActions({
  me,
  available,
  locale,
}: {
  me: Me;
  available: string[];
  locale: string;
}) {
  const router = useRouter();
  const t = useTranslations('settings');
  const common = useTranslations('common');
  const login = useTranslations('login');
  const errors = useTranslations('errors');
  const [lang, setLang] = useState<'ru' | 'en'>(me.siteLang);
  const [saved, setSaved] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const providerLabels: Record<string, string> = {
    vk: login('provider.vk'),
    yandex: login('provider.yandex'),
    dev: login('provider.dev'),
  };

  async function run(action: () => Promise<Response>, onSuccess?: () => void) {
    setSaved(false);
    setErrorCode(null);
    const response = await action();
    if (response.ok) {
      setSaved(true);
      onSuccess?.();
      router.refresh();
      return;
    }
    const data = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    setErrorCode(data?.error?.code ?? 'internal_error');
  }

  return (
    <div className="mt-8 flex flex-col gap-10">
      {errorCode && errors.has(errorCode) ? (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {errors(errorCode)}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-green-700">
          {common('saved')}
        </p>
      ) : null}

      <section>
        <h2 className="text-lg font-medium">{t('language')}</h2>
        <p className="mt-1 text-sm text-neutral-600">{t('languageHint')}</p>
        <div className="mt-3 flex items-center gap-3">
          <select
            aria-label={t('language')}
            className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
            value={lang}
            onChange={(event) => setLang(event.target.value as 'ru' | 'en')}
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
          <button
            type="button"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() =>
              run(
                () => api('/api/me/language', 'PATCH', { lang }),
                () => router.push(`/${lang}/settings`),
              )
            }
          >
            {common('save')}
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium">{t('providers')}</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {me.providers.map((id) => (
            <li
              key={id}
              className="flex items-center justify-between rounded border border-neutral-200 bg-white px-4 py-2 text-sm"
            >
              <span>{providerLabels[id] ?? id}</span>
              <button
                type="button"
                className="text-red-700 hover:underline"
                onClick={() => run(() => api(`/api/me/providers/${id}`, 'DELETE'))}
              >
                {t('unlink')}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-3">
          {available
            .filter((id) => !me.providers.includes(id))
            .map((id) => (
              <a
                key={id}
                href={`/api/auth/${id}/start?mode=link`}
                className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm hover:bg-neutral-100"
              >
                {t('link')}: {providerLabels[id] ?? id}
              </a>
            ))}
        </div>
      </section>

      <section className="flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm hover:bg-neutral-100"
          onClick={() => run(() => api('/api/auth/sessions/revoke-others', 'POST'))}
        >
          {t('sessions')}
        </button>
        <button
          type="button"
          className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm hover:bg-neutral-100"
          onClick={() =>
            run(
              () => api('/api/auth/logout', 'POST'),
              () => router.push(`/${locale}/login`),
            )
          }
        >
          {t('logout')}
        </button>
      </section>
    </div>
  );
}
