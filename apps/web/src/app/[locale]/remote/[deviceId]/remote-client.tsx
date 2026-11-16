'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useTranslations } from 'next-intl';

interface TimerState {
  endAt: number | null;
  serverTime: number;
}

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function RemoteClient({
  deviceId,
  isOwner = true,
}: {
  deviceId: string;
  isOwner?: boolean;
}) {
  const t = useTranslations('remote');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const [connected, setConnected] = useState(false);
  const [role, setRole] = useState<'controller' | 'viewer'>('viewer');
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [takeover, setTakeover] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let socket: Socket | null = null;
    (async () => {
      const config = (await fetch('/api/config')
        .then((response) => response.json())
        .catch(() => ({ socketUrl: '' }))) as { socketUrl?: string };
      if (disposed) return;
      socket = io(config.socketUrl ? `${config.socketUrl}/remote` : '/remote', {
        auth: { deviceId },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        randomizationFactor: 0.5,
      });
      socketRef.current = socket;
      socket.on('connect', () => setConnected(true));
      socket.on('disconnect', () => {
        setConnected(false);
        setRole('viewer');
      });
      socket.on('control:state', (state) => {
        setRole(state.role);
        setDeviceOnline(state.deviceOnline);
      });
      socket.on('device:status', (status) => setDeviceOnline(status.online));
      socket.on('timer:state', (state: TimerState) => {
        offsetRef.current = state.serverTime - Date.now();
        setTimer(state);
      });
      socket.on('control:ack', (ack) => {
        if (ack.status === 'rejected') setFailed(ack.errorCode ?? 'internal_error');
      });
      socket.on('control:takeover-request', (request) => setTakeover(request.requestId));
      socket.on('control:released', () => setTakeover(null));
    })();
    return () => {
      disposed = true;
      socket?.disconnect();
    };
  }, [deviceId]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!timer?.endAt) {
        setRemaining(null);
        return;
      }
      setRemaining(Math.max(0, timer.endAt - (Date.now() + offsetRef.current)));
    }, 250);
    return () => clearInterval(id);
  }, [timer]);

  const send = useCallback((action: 'previous' | 'next') => {
    setFailed(null);
    socketRef.current?.emit('control:command', { commandId: crypto.randomUUID(), action });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        send('previous');
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        send('next');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send]);

  const canControl = connected && role === 'controller' && deviceOnline;
  const statusText = !connected
    ? t('status.reconnecting')
    : role === 'viewer'
      ? t('viewer')
      : !deviceOnline
        ? errors('device_offline')
        : t('status.connected');

  function setTimerMinutes(minutes: number | null) {
    socketRef.current?.emit('timer:set', {
      endAt: minutes === null ? null : Date.now() + offsetRef.current + minutes * 60000,
    });
  }

  return (
    <div className="mt-4 flex flex-1 flex-col gap-6">
      <p role="status" aria-live="polite" className="text-sm text-neutral-600">
        {statusText}
      </p>

      {failed ? (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {errors.has(failed) ? errors(failed) : t('commandFailed')}
        </p>
      ) : null}

      {takeover && isOwner ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded border border-blue-300 bg-blue-50 p-3 text-sm"
        >
          <span>{t('takeoverRequest')}</span>
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700"
            onClick={() => {
              socketRef.current?.emit('control:approve', { requestId: takeover });
              setTakeover(null);
            }}
          >
            {t('approve')}
          </button>
          <button
            type="button"
            className="rounded border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100"
            onClick={() => {
              socketRef.current?.emit('control:deny', { requestId: takeover });
              setTakeover(null);
            }}
          >
            {t('deny')}
          </button>
        </div>
      ) : null}

      <div className="grid flex-1 grid-cols-2 gap-4">
        <button
          type="button"
          aria-label={common('back')}
          disabled={!canControl}
          onClick={() => send('previous')}
          className="min-h-32 rounded-2xl bg-blue-600 text-2xl font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          ← {common('back')}
        </button>
        <button
          type="button"
          aria-label={common('forward')}
          disabled={!canControl}
          onClick={() => send('next')}
          className="min-h-32 rounded-2xl bg-blue-600 text-2xl font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {common('forward')} →
        </button>
      </div>

      {role === 'viewer' && connected ? (
        <button
          type="button"
          className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm hover:bg-neutral-100"
          onClick={() => socketRef.current?.emit('control:request')}
        >
          {t('requestControl')}
        </button>
      ) : null}

      <section
        aria-label={t('timerLabel')}
        className="rounded border border-neutral-200 bg-white p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">{t('timerLabel')}</h2>
          <p data-testid="timer-display" className="font-mono text-2xl" aria-live="off">
            {remaining === null
              ? '--:--'
              : remaining === 0
                ? t('timer.finished')
                : formatRemaining(remaining)}
          </p>
        </div>
        {isOwner ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {[5, 10, 15].map((minutes) => (
              <button
                key={minutes}
                type="button"
                className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
                onClick={() => setTimerMinutes(minutes)}
              >
                {t('timer.minutes', { minutes })}
              </button>
            ))}
            <button
              type="button"
              className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
              onClick={() => setTimerMinutes(null)}
            >
              {t('timer.stop')}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
