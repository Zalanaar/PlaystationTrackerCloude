'use client';

import { useEffect, useState } from 'react';
import { Icon } from './icons';

type Mode = 'online' | 'offline' | 'back';

/** Сколько показываем «Сеть вернулась» перед скрытием */
export const BACK_VISIBLE_MS = 1500;

/**
 * Полоса «Нет сети» под шапкой (design-system §15.3): для уже открытой страницы.
 * Показывается при `offline`, по `online` на 1,5 с меняется на «Сеть вернулась» и исчезает. Не блокирует контент.
 */
export function OfflineBar() {
  const [mode, setMode] = useState<Mode>('online');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const off = () => { clear(); setMode('offline'); };
    const on = () => {
      clear();
      setMode((m) => (m === 'offline' ? 'back' : m));
      timer = setTimeout(() => setMode('online'), BACK_VISIBLE_MS);
    };
    if (!navigator.onLine) off();
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => { clear(); window.removeEventListener('offline', off); window.removeEventListener('online', on); };
  }, []);
  // role="status" остаётся в разметке всегда, чтобы чтение изменений объявлялось
  return (
    <div className="ps-offline-bar" role="status" aria-live="polite" data-mode={mode === 'online' ? undefined : mode} hidden={mode === 'online'} data-testid="offline-bar">
      {mode !== 'online' && (
        <>
          <Icon name={mode === 'offline' ? 'wifi-off' : 'check'} size={14} />
          <span>{mode === 'offline' ? 'Нет сети, показаны последние данные' : 'Сеть вернулась'}</span>
        </>
      )}
    </div>
  );
}
