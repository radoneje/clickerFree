'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useTranslations } from 'next-intl';

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)cf_csrf=([^;]*)/);
  return match?.[1] ?? '';
}

interface Invitation {
  id: string;
  lang: 'ru' | 'en';
  expiresAt: number;
}

export function InvitationsPanel({ deviceId, locale }: { deviceId: string; locale: string }) {
  const t = useTranslations('cabinet');
  const [list, setList] = useState<Invitation[]>([]);
  const [lang, setLang] = useState<'ru' | 'en'>('ru');
  const [hours, setHours] = useState(2);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function load() {
    const response = await fetch(`/api/devices/${deviceId}/invitations`).catch(() => null);
    if (response?.ok) setList((await response.json()).invitations);
  }

  useEffect(() => {
    void load();
  }, [deviceId]);

  async function create() {
    setErrorCode(null);
    setCopied(false);
    const response = await fetch(`/api/devices/${deviceId}/invitations`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken(), 'content-type': 'application/json' },
      body: JSON.stringify({ lang, hours }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      setErrorCode(data?.error?.code ?? 'internal_error');
      return;
    }
    const data = (await response.json()) as { url: string };
    setCreatedUrl(data.url);
    setQrSvg(await QRCode.toString(data.url, { type: 'svg', margin: 1 }));
    await load();
  }

  async function revoke(id: string) {
    await fetch(`/api/invitations/${id}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': csrfToken() },
    });
    setCreatedUrl(null);
    setQrSvg('');
    await load();
  }

  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="mt-3 border-t border-neutral-100 pt-3">
      <h3 className="text-sm font-medium">{t('invitationsTitle')}</h3>
      {errorCode ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {errorCode}
        </p>
      ) : null}
      {list.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600">{t('invitations.empty')}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {list.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>
                {invitation.lang.toUpperCase()} · {t('invitations.expires')}:{' '}
                {formatter.format(new Date(invitation.expiresAt))}
              </span>
              <button
                type="button"
                className="text-red-700 hover:underline"
                onClick={() => void revoke(invitation.id)}
              >
                {t('invitations.revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          {t('invitations.lang')}
          <select
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
            value={lang}
            onChange={(event) => setLang(event.target.value as 'ru' | 'en')}
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          {t('invitations.hours')}
          <select
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
            value={hours}
            onChange={(event) => setHours(Number(event.target.value))}
          >
            {[2, 4, 8, 24].map((value) => (
              <option key={value} value={value}>
                {t('invitations.hoursValue', { hours: value })}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
          onClick={() => void create()}
        >
          {t('invitations.create')}
        </button>
      </div>
      {createdUrl ? (
        <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3">
          <p className="text-xs text-neutral-600">{t('invitations.linkHint')}</p>
          <p className="mt-1 break-all font-mono text-xs">{createdUrl}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded border border-neutral-300 bg-white px-3 py-1 text-sm hover:bg-neutral-100"
              onClick={() => {
                void navigator.clipboard.writeText(createdUrl).then(() => setCopied(true));
              }}
            >
              {copied ? t('invitations.copied') : t('invitations.copy')}
            </button>
            {qrSvg ? (
              <span
                aria-label={t('invitations.qr')}
                role="img"
                className="h-28 w-28 [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
