'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)cf_csrf=([^;]*)/);
  return match?.[1] ?? '';
}

export function PairingForm({ locale }: { locale: string }) {
  const t = useTranslations('pairing');
  const errors = useTranslations('errors');
  const nav = useTranslations('nav');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<'idle' | 'ok' | string>('idle');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/pairing/confirm', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken(), 'content-type': 'application/json' },
      body: JSON.stringify({ code: code.trim().toUpperCase() }),
    });
    if (response.ok) {
      setResult('ok');
      return;
    }
    const data = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    setResult(data?.error?.code ?? 'internal_error');
  }

  if (result === 'ok') {
    return (
      <div className="mt-6">
        <p
          role="status"
          className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800"
        >
          {t('success')}
        </p>
        <a
          href={`/${locale}/cabinet`}
          className="mt-4 inline-block text-sm text-blue-700 hover:underline"
        >
          {nav('cabinet')}
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
      {result !== 'idle' && errors.has(result) ? (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {errors(result)}
        </p>
      ) : null}
      <label htmlFor="pairing-code" className="text-sm font-medium">
        {t('code')}
      </label>
      <input
        id="pairing-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        maxLength={8}
        autoComplete="off"
        required
        className="rounded border border-neutral-300 bg-white px-3 py-2 font-mono text-lg uppercase tracking-widest"
      />
      <button
        type="submit"
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        {t('submit')}
      </button>
    </form>
  );
}
