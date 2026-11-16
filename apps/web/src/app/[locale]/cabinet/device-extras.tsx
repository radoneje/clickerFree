'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)cf_csrf=([^;]*)/);
  return match?.[1] ?? '';
}

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

interface TimerState {
  endAt: number | null;
  serverTime: number;
}

export function DeviceExtras({ deviceId }: { deviceId: string }) {
  const t = useTranslations('cabinet');
  const remote = useTranslations('remote');
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [requests, setRequests] = useState<Array<{ requestId: string }>>([]);
  const timerRef = useRef<TimerState | null>(null);
  const offsetRef = useRef(0);
  timerRef.current = timer;

  useEffect(() => {
    let active = true;
    async function loadTimer() {
      const response = await fetch(`/api/devices/${deviceId}/timer`).catch(() => null);
      if (active && response?.ok) {
        const state = (await response.json()) as TimerState;
        offsetRef.current = state.serverTime - Date.now();
        setTimer(state);
      }
    }
    async function loadRequests() {
      const response = await fetch(`/api/devices/${deviceId}/control/requests`).catch(() => null);
      if (active && response?.ok) {
        setRequests((await response.json()).requests);
      }
    }
    void loadTimer();
    void loadRequests();
    const poll = setInterval(loadRequests, 3000);
    const tick = setInterval(() => {
      const state = timerRef.current;
      setRemaining(
        state?.endAt ? Math.max(0, state.endAt - (Date.now() + offsetRef.current)) : null,
      );
    }, 250);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [deviceId]);

  async function post(path: string, body: unknown) {
    await fetch(path, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function setTimerMinutes(minutes: number | null) {
    const endAt = minutes === null ? null : Date.now() + offsetRef.current + minutes * 60000;
    await post(`/api/devices/${deviceId}/timer`, { endAt });
    setTimer({ endAt, serverTime: Date.now() + offsetRef.current });
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-neutral-100 pt-3">
      {requests.map((request) => (
        <div
          key={request.requestId}
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded border border-blue-300 bg-blue-50 p-2 text-sm"
        >
          <span>{remote('takeoverRequest')}</span>
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700"
            onClick={async () => {
              await post(`/api/devices/${deviceId}/control/approve`, {
                requestId: request.requestId,
              });
              setRequests([]);
            }}
          >
            {remote('approve')}
          </button>
          <button
            type="button"
            className="rounded border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100"
            onClick={async () => {
              await post(`/api/devices/${deviceId}/control/deny`, { requestId: request.requestId });
              setRequests([]);
            }}
          >
            {remote('deny')}
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-neutral-600">{t('device.timer')}:</span>
        <span className="font-mono">
          {remaining === null
            ? '--:--'
            : remaining === 0
              ? remote('timer.finished')
              : formatRemaining(remaining)}
        </span>
        {[5, 10, 15].map((minutes) => (
          <button
            key={minutes}
            type="button"
            className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
            onClick={() => void setTimerMinutes(minutes)}
          >
            {remote('timer.minutes', { minutes })}
          </button>
        ))}
        <button
          type="button"
          className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
          onClick={() => void setTimerMinutes(null)}
        >
          {remote('timer.stop')}
        </button>
      </div>
    </div>
  );
}
