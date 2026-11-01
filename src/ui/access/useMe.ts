'use client';

import { useEffect, useState } from 'react';

export type Me = { id: number; role: 'owner' | 'member' };

/**
 * Текущий пользователь по /api/auth/me: id для ключей localStorage и роль для «Что нового».
 * undefined = загрузка, null = не удалось узнать (сбой не показывается пользователю). Результат не кэшируется между монтированиями (смена пользователя без перезагрузки), запросы общие, пока идёт один.
 */
let inflight: Promise<Me | null> | null = null;

function loadMe(): Promise<Me | null> {
  if (!inflight) {
    inflight = fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          await r.text().catch(() => '');
          return null;
        }
        const j = (await r.json().catch(() => null)) as { ok?: boolean; data?: { id?: unknown; role?: unknown } } | null;
        const id = j?.data?.id;
        if (!j?.ok || typeof id !== 'number') return null;
        return { id, role: j.data?.role === 'owner' ? 'owner' : 'member' } as Me;
      })
      .catch(() => null)
      .finally(() => { inflight = null; });
  }
  return inflight;
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
