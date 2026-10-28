'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PsnProfile } from '@/server/collection/types';
import { fetchSummary } from '../collection/api';
import { usableProfile } from './model';

type Ctx = { profile: PsnProfile | null; loading: boolean; publish: (p: PsnProfile | null) => void };
const C = createContext<Ctx>({ profile: null, loading: false, publish: () => {} });

/** Профиль PSN для шапки (аватар, меню) и мобильного меню. */
export const useProfile = () => useContext(C);

/**
 * Хранит `summary.profile` для AppShell. На главной профиль публикует сама Коллекция (у неё своя сводка),
 * на остальных страницах провайдер читает сводку один раз. Ошибка не показывается: шапка рисует инициал-заглушку.
 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [profile, setProfile] = useState<PsnProfile | null>(null);
  const [loading, setLoading] = useState(pathname !== '/');
  const [seen, setSeen] = useState(false);

  const publish = useCallback((p: PsnProfile | null) => { setProfile(usableProfile(p)); setSeen(true); setLoading(false); }, []);

  useEffect(() => {
    if (pathname === '/' || seen) return;
    const ac = new AbortController();
    fetchSummary().then(
      (s) => { if (!ac.signal.aborted) publish(s.profile ?? null); },
      () => { if (!ac.signal.aborted) setLoading(false); },
    );
    return () => ac.abort();
  }, [pathname, seen, publish]);

  const value = useMemo(() => ({ profile, loading, publish }), [profile, loading, publish]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
