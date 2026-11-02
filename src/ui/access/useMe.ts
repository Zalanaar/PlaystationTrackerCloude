'use client';

import { useEffect, useState } from 'react';
import { fetchAuthMe } from './authMe';

export type Me = { id: number; role: 'owner' | 'member' };

/**
 * Текущий пользователь по /api/auth/me: id для ключей localStorage и роль для «Что нового».
 * undefined = загрузка, null = не удалось узнать (сбой не показывается пользователю). Результат не кэшируется между монтированиями (смена пользователя без перезагрузки), запрос общий с useIsOwner и снапшотом профилей (authMe.ts).
 */
function loadMe(): Promise<Me | null> {
  return fetchAuthMe().then((r) => {
    if (!r || r.status < 200 || r.status >= 300) return null;
    const j = r.json as { ok?: boolean; data?: { id?: unknown; role?: unknown } } | null;
    const id = j?.data?.id;
    if (!j?.ok || typeof id !== 'number') return null;
    return { id, role: j.data?.role === 'owner' ? 'owner' : 'member' } as Me;
  });
}

export function useMe(): Me | null | undefined {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadMe().then((v) => { if (alive) setMe(v); });
    return () => { alive = false; };
  }, []);
  return me;
}
