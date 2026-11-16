'use client';

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useTranslations } from 'next-intl';

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)cf_csrf=([^;]*)/);
  return match?.[1] ?? '';
}

async function post(path: string, body?: unknown) {
  return fetch(path, {
    method: 'POST',
    headers: {
      'x-csrf-token': csrfToken(),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface Status {
  enabled: boolean;
  verified: boolean;
}

interface MetricRow {
  day: string;
  metric: string;
  dimension: string;
  value: number;
}

interface AdminUser {
  id: string;
  role: string;
  totpEnabled: boolean;
}

export function AdminHub({ locale }: { locale: string }) {
  const t = useTranslations('admin');
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qrSvg, setQrSvg] = useState('');
  const [code, setCode] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);

  const loadStatus = useCallback(async () => {
    const response = await fetch('/api/admin/totp/status').catch(() => null);
    if (response?.ok) setStatus(await response.json());
  }, []);

  const loadStats = useCallback(async () => {
    const response = await fetch(`/api/admin/stats?from=${from}&to=${to}`).catch(() => null);
    if (response?.ok) setRows((await response.json()).rows);
    const usersResponse = await fetch('/api/admin/users').catch(() => null);
    if (usersResponse?.ok) setUsers((await usersResponse.json()).users);
  }, [from, to]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (status?.enabled && status.verified) void loadStats();
  }, [status, loadStats]);

  async function startSetup() {
    setErrorCode(null);
    const response = await post('/api/admin/totp/setup');
    if (!response.ok) return setErrorCode('internal_error');
    const data = await response.json();
    setSetup(data);
    setQrSvg(await QRCode.toString(data.otpauthUrl, { type: 'svg', margin: 1 }));
  }

  async function submitCode(path: string) {
    setErrorCode(null);
    const response = await post(path, { code });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      setErrorCode(data?.error?.code ?? 'internal_error');
      return;
    }
    setCode('');
    setSetup(null);
    await loadStatus();
  }

  async function changeRole(id: string, role: string) {
    setErrorCode(null);
    const response = await post(`/api/admin/users/${id}/role`, { role });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      setErrorCode(data?.error?.code ?? 'internal_error');
      return;
    }
    await loadStats();
  }

  if (!status) return <p className="mt-6 text-sm text-neutral-600">…</p>;

  const errorText =
    errorCode === 'totp_invalid' || errorCode === 'totp_required' ? errorCode : null;

  if (!status.enabled) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        {errorCode ? (
          <p role="alert" className="text-sm text-red-700">
            {errorCode}
          </p>
        ) : null}
        {!setup ? (
          <button
            type="button"
            className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => void startSetup()}
          >
            {t('totp.setup')}
          </button>
        ) : (
          <div className="flex flex-col gap-3 rounded border border-neutral-200 bg-white p-4">
            <p className="text-sm text-neutral-600">{t('totp.scan')}</p>
            <span
              role="img"
              aria-label={t('totp.setup')}
              className="h-40 w-40 [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="break-all font-mono text-xs">
              {t('totp.secret')}: {setup.secret}
            </p>
            <label className="flex flex-col gap-1 text-xs text-neutral-600">
              {t('totp.code')}
              <input
                className="w-40 rounded border border-neutral-300 px-2 py-1 font-mono text-sm"
                value={code}
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              onClick={() => void submitCode('/api/admin/totp/verify')}
            >
              {t('totp.enable')}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!status.verified) {
    return (
      <div className="mt-6 flex flex-col gap-3">
        <p className="text-sm text-neutral-600">{t('totp.required')}</p>
        {errorText ? (
          <p role="alert" className="text-sm text-red-700">
            {errorText}
          </p>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          {t('totp.code')}
          <input
            className="w-40 rounded border border-neutral-300 px-2 py-1 font-mono text-sm"
            value={code}
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          onClick={() => void submitCode('/api/admin/totp/authenticate')}
        >
          {t('totp.authenticate')}
        </button>
      </div>
    );
  }

  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.metric, (totals.get(row.metric) ?? 0) + row.value);
  }
  const metricLabels: Record<string, string> = {
    downloads: t('stats.downloads'),
    first_runs: t('stats.firstRuns'),
    pairings: t('stats.pairings'),
    active_users: t('stats.activeUsers'),
    usage_sessions: t('stats.sessions'),
    usage_duration_seconds: t('stats.duration'),
    commands: t('stats.commands'),
    command_errors: t('stats.errors'),
    suspicious_events: t('stats.suspicious'),
  };

  return (
    <div className="mt-6 flex flex-col gap-8">
      {errorCode ? (
        <p role="alert" className="text-sm text-red-700">
          {errorCode}
        </p>
      ) : null}

      <section aria-label={t('stats.title')}>
        <h2 className="text-lg font-medium">{t('stats.title')}</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            {t('stats.from')}
            <input
              type="date"
              className="rounded border border-neutral-300 px-2 py-1 text-sm"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            {t('stats.to')}
            <input
              type="date"
              className="rounded border border-neutral-300 px-2 py-1 text-sm"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
            onClick={() => void loadStats()}
          >
            {t('stats.apply')}
          </button>
          <a
            className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
            href={`/api/admin/stats.csv?from=${from}&to=${to}`}
          >
            {t('stats.csv')}
          </a>
        </div>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-600">{t('stats.empty')}</p>
        ) : (
          <>
            <dl className="mt-4 grid gap-2 sm:grid-cols-2">
              {[...totals.entries()]
                .filter(([metric]) => metricLabels[metric])
                .map(([metric, value]) => (
                  <div
                    key={metric}
                    className="flex justify-between rounded border border-neutral-200 bg-white px-3 py-2 text-sm"
                  >
                    <dt>{metricLabels[metric]}</dt>
                    <dd className="font-mono">{value}</dd>
                  </div>
                ))}
            </dl>
            <div className="mt-4 max-h-64 overflow-auto rounded border border-neutral-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="px-2 py-1">day</th>
                    <th className="px-2 py-1">metric</th>
                    <th className="px-2 py-1">dimension</th>
                    <th className="px-2 py-1">value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className="border-t border-neutral-100">
                      <td className="px-2 py-1">{row.day}</td>
                      <td className="px-2 py-1">{row.metric}</td>
                      <td className="px-2 py-1">{row.dimension}</td>
                      <td className="px-2 py-1 font-mono">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section aria-label={t('users.title')}>
        <h2 className="text-lg font-medium">{t('users.title')}</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {users.map((user) => (
            <li
              key={user.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-neutral-200 bg-white px-3 py-2 text-sm"
            >
              <span className="font-mono text-xs">{user.id}</span>
              <span className="flex items-center gap-2">
                {t('users.role')}: {user.role}
                <button
                  type="button"
                  className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
                  onClick={() => void changeRole(user.id, user.role === 'admin' ? 'user' : 'admin')}
                >
                  {user.role === 'admin' ? t('users.revokeAdmin') : t('users.makeAdmin')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <a href={`/${locale}/admin/releases`} className="text-sm text-blue-700 hover:underline">
        {t('releases.link')}
      </a>
    </div>
  );
}
