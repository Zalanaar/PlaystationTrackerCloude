'use client';

import { useEffect, useState } from 'react';

/**
 * Владелец ли текущий пользователь (по /api/auth/me). Только для показа пункта меню: права проверяет сервер.
 * Ошибка или сбой сети = false (пункт не показываем). Результат кэшируется на время жизни вкладки.
 */
let cached: boolean | null = null;

export function useIsOwner(): boolean {
  const [owner, setOwner] = useState<boolean>(cached ?? false);
  useEffect(() => {
    if (cached !== null) return;
    const ac = new AbortController();
    fetch('/api/auth/me', { cache: 'no-store', signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) { cached = j.data?.role === 'owner'; setOwner(cached); } })
      .catch(() => {});
    return () => ac.abort();
  }, []);
  return owner;
}
