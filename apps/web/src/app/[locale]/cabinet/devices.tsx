'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface Device {
  id: string;
  name: string;
  os: string;
  arch: string;
  appVersion: string;
  protocolVersion: number;
  lastSeenAt: number | null;
  online: boolean;
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)cf_csrf=([^;]*)/);
  return match?.[1] ?? '';
}

export function DeviceList({ devices, locale }: { devices: Device[]; locale: string }) {
  const t = useTranslations('cabinet');
  const errors = useTranslations('errors');
  const router = useRouter();
  const [names, setNames] = useState<Record<string, string>>({});
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function act(request: () => Promise<Response>) {
    setErrorCode(null);
    const response = await request();
    if (response.ok) {
      router.refresh();
      return;
    }
    const data = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    setErrorCode(data?.error?.code ?? 'internal_error');
  }

  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="mt-6 flex flex-col gap-4">
      {errorCode && errors.has(errorCode) ? (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {errors(errorCode)}
        </p>
      ) : null}
      {devices.map((device) => (
        <section
          key={device.id}
          aria-label={device.name}
          className="rounded border border-neutral-200 bg-white p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">{device.name}</h2>
            <p className="text-sm text-neutral-600">
              {device.online ? t('device.online') : t('device.offline')}
            </p>
          </div>
          <dl className="mt-2 grid gap-1 text-sm text-neutral-600">
            <div className="flex gap-2">
              <dt>{t('device.version')}:</dt>
              <dd>{device.appVersion}</dd>
            </div>
            <div className="flex gap-2">
              <dt>{t('device.lastSeen')}:</dt>
              <dd>
                {device.lastSeenAt
                  ? formatter.format(new Date(device.lastSeenAt))
                  : t('device.never')}
              </dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`name-${device.id}`}>
              {t('device.name')}
            </label>
            <input
              id={`name-${device.id}`}
              className="rounded border border-neutral-300 px-3 py-1 text-sm"
              value={names[device.id] ?? device.name}
              maxLength={64}
              onChange={(event) => setNames({ ...names, [device.id]: event.target.value })}
            />
            <button
              type="button"
              className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
              onClick={() =>
                act(() =>
                  fetch(`/api/devices/${device.id}`, {
                    method: 'PATCH',
                    headers: { 'x-csrf-token': csrfToken(), 'content-type': 'application/json' },
                    body: JSON.stringify({ name: names[device.id] ?? device.name }),
                  }),
                )
              }
            >
              {t('device.rename')}
            </button>
            <button
              type="button"
              className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
              onClick={() => {
                if (window.confirm(t('device.unlinkConfirm'))) {
                  void act(() =>
                    fetch(`/api/devices/${device.id}`, {
                      method: 'DELETE',
                      headers: { 'x-csrf-token': csrfToken() },
                    }),
                  );
                }
              }}
            >
              {t('device.unlink')}
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
