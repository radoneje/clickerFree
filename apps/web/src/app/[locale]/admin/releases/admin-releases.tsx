'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)cf_csrf=([^;]*)/);
  return match?.[1] ?? '';
}

interface Release {
  id: string;
  version: string;
  os: string;
  arch: string;
  protocolVersion: number;
  downloadUrl: string;
  manifestUrl: string | null;
  sha256: string;
  descriptionKey: string;
  minSupportedVersion: string;
  isAvailable: boolean;
}

const EMPTY_FORM = {
  version: '',
  os: 'macos',
  arch: 'arm64',
  protocolVersion: 1,
  downloadUrl: '',
  manifestUrl: '',
  sha256: '',
  descriptionKey: '',
  minSupportedVersion: '0.0.0',
};

export function AdminReleases() {
  const t = useTranslations('admin');
  const [releases, setReleases] = useState<Release[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function load() {
    const response = await fetch('/api/admin/releases').catch(() => null);
    if (response?.ok) setReleases((await response.json()).releases);
  }

  useEffect(() => {
    void load();
  }, []);

  async function post(path: string, body?: unknown) {
    setErrorCode(null);
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'x-csrf-token': csrfToken(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      setErrorCode(data?.error?.code ?? 'internal_error');
      return;
    }
    await load();
  }

  function field(key: keyof typeof EMPTY_FORM, label: string, type = 'text') {
    return (
      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        {label}
        <input
          type={type}
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          value={form[key]}
          onChange={(event) =>
            setForm({
              ...form,
              [key]: type === 'number' ? Number(event.target.value) : event.target.value,
            })
          }
        />
      </label>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      {errorCode ? (
        <p role="alert" className="text-sm text-red-700">
          {errorCode}
        </p>
      ) : null}

      {releases.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {releases.map((release) => (
            <li
              key={release.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-neutral-200 bg-white p-3 text-sm"
            >
              <span>
                {release.version} · {release.os}/{release.arch} ·{' '}
                {release.isAvailable ? t('available') : t('draft')}
              </span>
              <button
                type="button"
                className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100"
                onClick={() =>
                  void post(
                    `/api/admin/releases/${release.id}/${release.isAvailable ? 'unpublish' : 'publish'}`,
                  )
                }
              >
                {release.isAvailable ? t('unpublish') : t('publish')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid gap-3 rounded border border-neutral-200 bg-white p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void post('/api/admin/releases', {
            ...form,
            manifestUrl: form.manifestUrl || null,
          }).then(() => setForm(EMPTY_FORM));
        }}
      >
        {field('version', t('version'))}
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          {t('os')}
          <select
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            value={form.os}
            onChange={(event) => setForm({ ...form, os: event.target.value })}
          >
            <option value="macos">macOS</option>
            <option value="windows">Windows</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          {t('arch')}
          <select
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            value={form.arch}
            onChange={(event) => setForm({ ...form, arch: event.target.value })}
          >
            <option value="arm64">arm64</option>
            <option value="x64">x64</option>
          </select>
        </label>
        {field('protocolVersion', t('protocol'), 'number')}
        {field('downloadUrl', t('downloadUrl'))}
        {field('manifestUrl', t('manifestUrl'))}
        {field('sha256', t('sha256'))}
        {field('descriptionKey', t('descriptionKey'))}
        {field('minSupportedVersion', t('minSupported'))}
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t('create')}
          </button>
        </div>
      </form>
    </div>
  );
}
