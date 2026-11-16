'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function InviteGate({ token }: { token?: string }) {
  const t = useTranslations('invite');
  const errors = useTranslations('errors');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <p
        role="alert"
        className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
      >
        {t('missing')}
      </p>
    );
  }

  async function open() {
    setBusy(true);
    setError(null);
    const response = await fetch('/api/invitations/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (response.ok) {
      const data = (await response.json()) as { deviceId: string; lang: string };
      // Токен уходит из адресной строки: спикер попадает на пульт без него.
      router.replace(`/${data.lang}/r/${data.deviceId}`);
      return;
    }
    const data = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    setError(data?.error?.code ?? 'internal_error');
    setBusy(false);
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="text-sm text-neutral-600">{t('hint')}</p>
      {error && errors.has(error) ? (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {errors(error)}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void open()}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-neutral-300"
      >
        {t('submit')}
      </button>
    </div>
  );
}
