'use client';

import { useEffect, useRef, useState } from 'react';

const HOME = () => `${window.location.origin}/`;

type St = 'idle' | 'retrying' | 'still-offline';

/**
 * Кнопка «Повторить» страницы /offline (§15.3). Без JS работает как обычная ссылка на «/».
 * Проверка сети: лёгкий запрос манифеста (публичный, не API). Событие `online` само уводит на «/».
 */
export function OfflineRetry() {
  const [st, setSt] = useState<St>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const go = () => window.location.assign(HOME());
    window.addEventListener('online', go);
    return () => { window.removeEventListener('online', go); if (timer.current) clearTimeout(timer.current); };
  }, []);
  async function retry(e: React.MouseEvent) {
    e.preventDefault();
    if (st === 'retrying') return;
    setSt('retrying');
    try {
      const r = await fetch('/manifest.webmanifest', { cache: 'no-store' });
      if (r.ok) { window.location.assign(HOME()); return; }
      throw new Error('offline');
    } catch {
      setSt('still-offline');
      timer.current = setTimeout(() => setSt('idle'), 2000);
    }
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- запасной вариант без JS и полная перезагрузка вне оболочки */}
      <a href="/" className="ps-btn ps-btn--primary ps-offline__btn" onClick={(e) => void retry(e)} aria-disabled={st === 'retrying' || undefined}>Повторить</a>
      <p className="ps-offline__note" aria-live="polite">{st === 'still-offline' ? 'Сети всё ещё нет' : ''}</p>
    </>
  );
}
