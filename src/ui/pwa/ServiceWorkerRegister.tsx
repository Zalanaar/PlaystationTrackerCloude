'use client';

import { useEffect, useRef, useState } from 'react';
import { SW_URL } from './sw-messages';

/**
 * Регистрация service worker (public/sw.js) внешним файлом: inline-скрипт не нужен, CSP на nonce не затронут.
 * Только в production. Обновление: новая версия ждёт (waiting), пользователь подтверждает кнопкой, перезагрузка только после нажатия «Обновить» (первая установка SW страницу не перезагружает).
 */
export function ServiceWorkerRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const userAccepted = useRef(false); // true только после нажатия «Обновить»
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let reloading = false;
    const onChange = () => { if (!userAccepted.current || reloading) return; reloading = true; window.location.reload(); };
    let cancelled = false;
    navigator.serviceWorker.register(SW_URL, { scope: '/' }).then((reg) => {
      if (cancelled) return;
      const watch = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) setWaiting(w); });
      };
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
    }, () => { /* регистрация не удалась: сайт работает без SW */ });
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    return () => { cancelled = true; navigator.serviceWorker.removeEventListener('controllerchange', onChange); };
  }, []);
  if (!waiting) return null;
  return (
    <div className="ps-update" role="region" aria-label="Обновление приложения" data-shown="true" data-testid="sw-update">
      <div className="ps-install__head">
        <div className="ps-install__tx">
          <h2 className="ps-install__title">Доступна новая версия</h2>
          <p className="ps-install__text">Обновите, когда будет удобно</p>
        </div>
      </div>
      <div className="ps-install__foot">
        <button type="button" className="ps-btn ps-btn--primary ps-install__btn" onClick={() => { userAccepted.current = true; waiting.postMessage({ type: 'SKIP_WAITING' }); }}>Обновить</button>
        <button type="button" className="ps-btn ps-btn--ghost ps-install__btn" onClick={() => setWaiting(null)}>Позже</button>
      </div>
    </div>
  );
}
