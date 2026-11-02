'use client';

import { useEffect, useState } from 'react';
import { registerCacheReset } from '../profiles/scope';
import { fetchAuthMe } from './authMe';

/**
 * Владелец ли текущий пользователь (по /api/auth/me). Только для показа пункта меню: права проверяет сервер.
 * Ошибка или сбой сети = false (пункт не показываем). Один запрос на загрузку страницы: промис общий
 * (StrictMode и несколько подписчиков не плодят запросы), результат кэшируется на время жизни вкладки.
 * Тело ответа всегда дочитывается, чтобы соединение не висело.
 */
let cached: boolean | null = null;
registerCacheReset(() => { cached = null; }); // смена профиля PSN: роль входа та же, но кэш не держим

function loadIsOwner(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  return fetchAuthMe().then((r) => {
    if (!r || r.status < 200 || r.status >= 300) return false; // не кэшируем: следующая загрузка страницы спросит снова
    const j = r.json as { ok?: boolean; data?: { role?: string } } | null;
    if (!j?.ok) return false;
    cached = j.data?.role === 'owner';
    return cached;
  });
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
