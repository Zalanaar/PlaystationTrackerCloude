'use client';

import { useEffect, useRef, useState } from 'react';
import { STATUSES_CHANGED_EVENT } from './backup/StatusMenu';
import { Icon } from './icons';
import { flushQueue, QUEUE_EVENT, queueSize, type QueueItem } from './offline/changeQueue';
import { requestDataRefresh } from './shell/refresh';

type Mode = 'online' | 'offline' | 'back';

/** Сколько показываем «Сеть вернулась» перед скрытием */
export const BACK_VISIBLE_MS = 1500;

async function sendItem(item: QueueItem): Promise<'ok' | 'drop' | 'retry'> {
  try {
    const res = await fetch(item.url, {
      method: item.method,
      headers: item.body ? { 'Content-Type': 'application/json' } : undefined,
      body: item.body,
      cache: 'no-store',
    });
    if (res.status === 401 && typeof window !== 'undefined') {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- как в http.ts: полная перезагрузка на вход
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return 'retry';
    }
    if (res.ok) return 'ok';
    if (res.status >= 400 && res.status < 500) return 'drop';
    return 'retry';
  } catch {
    return 'retry';
  }
}

/**
 * Полоса «Нет сети» под шапкой (design-system §15.3): для уже открытой страницы.
 * Показывается при `offline`, по `online` на 1,5 с меняется на «Сеть вернулась» и исчезает. Не блокирует контент.
 * Если есть очередь офлайн-изменений — пишет, сколько ждёт сеть, и проигрывает её при появлении связи.
 */
export function OfflineBar() {
  const [mode, setMode] = useState<Mode>('online');
  const [pending, setPending] = useState(0);
  const flushing = useRef(false);

  useEffect(() => {
    const sync = () => setPending(queueSize());
    sync();
    window.addEventListener(QUEUE_EVENT, sync);
    return () => window.removeEventListener(QUEUE_EVENT, sync);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const off = () => { clear(); setMode('offline'); };
    const on = () => {
      clear();
      setMode((m) => (m === 'offline' ? 'back' : m));
      timer = setTimeout(() => setMode('online'), BACK_VISIBLE_MS);
      void runFlush();
    };
    if (!navigator.onLine) off();
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => { clear(); window.removeEventListener('offline', off); window.removeEventListener('online', on); };
  }, []);

  async function runFlush() {
    if (flushing.current || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    if (queueSize() === 0) return;
    flushing.current = true;
    try {
      const n = await flushQueue(sendItem);
      setPending(queueSize());
      if (n > 0) {
        window.dispatchEvent(new Event(STATUSES_CHANGED_EVENT));
        requestDataRefresh('change');
      }
    } finally {
      flushing.current = false;
    }
  }

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void runFlush(); };
    document.addEventListener('visibilitychange', onVis);
    void runFlush();
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const showPending = pending > 0;
  const hidden = mode === 'online' && !showPending;
  const text = showPending
    ? (mode === 'offline'
      ? `Нет сети, ${pending} ${pending === 1 ? 'изменение ждёт' : 'изменений ждут'} сеть`
      : `${pending} ${pending === 1 ? 'изменение отправляем' : 'изменений отправляем'}`)
    : mode === 'offline' ? 'Нет сети, показаны последние данные' : 'Сеть вернулась';

  return (
    <div className="ps-offline-bar" role="status" aria-live="polite" data-mode={hidden ? undefined : (showPending && mode === 'online' ? 'pending' : mode)} hidden={hidden} data-testid="offline-bar">
      {!hidden && (
        <>
          <Icon name={mode === 'offline' ? 'wifi-off' : 'check'} size={14} />
          <span data-testid={showPending ? 'offline-queue' : undefined}>{text}</span>
        </>
      )}
    </div>
  );
}
