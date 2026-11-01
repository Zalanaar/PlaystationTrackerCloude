'use client';

import { useEffect, useState } from 'react';
import { registerCacheReset } from '../profiles/scope';

/**
 * Владелец ли текущий пользователь (по /api/auth/me). Только для показа пункта меню: права проверяет сервер.
 * Ошибка или сбой сети = false (пункт не показываем). Один запрос на загрузку страницы: промис общий
 * (StrictMode и несколько подписчиков не плодят запросы), результат кэшируется на время жизни вкладки.
 * Тело ответа всегда дочитывается, чтобы соединение не висело.
 */
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;
registerCacheReset(() => { cached = null; }); // смена профиля PSN: роль входа та же, но кэш не держим

function loadIsOwner(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          await r.text().catch(() => '');
          return false; // не кэшируем: следующая загрузка страницы спросит снова
        }
        const j = (await r.json().catch(() => null)) as { ok?: boolean; data?: { role?: string } } | null;
        if (!j?.ok) return false;
        cached = j.data?.role === 'owner';
        return cached;
      })
      .catch(() => false)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function useIsOwner(): boolean {
  const [owner, setOwner] = useState<boolean>(cached ?? false);
  useEffect(() => {
    let alive = true;
    void loadIsOwner().then((v) => { if (alive) setOwner(v); });
    return () => { alive = false; };
  }, []);
  return owner;
}
