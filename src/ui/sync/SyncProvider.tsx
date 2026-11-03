'use client';

import dynamic from 'next/dynamic';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { invalidateApiCache } from '../data/http';
import { Sheet } from '../primitives/Sheet';
import { startErrorText, stopErrorText, type SyncStatus } from './status';

// Панель синка открывается по клику: отдельный чанк (Фаза 47)
const SyncPanel = dynamic(() => import('./SyncPanel').then((m) => m.SyncPanel), { ssr: false });
const TelegramDigestPanel = dynamic(() => import('../telegram/TelegramDigestPanel').then((m) => m.TelegramDigestPanel), { ssr: false });

const POLL_MS = 3000;

type SyncCtx = {
  status: SyncStatus | null;
  loading: boolean;
  loadError: boolean;
  starting: boolean;
  notice: string | null;
  stopping: boolean;
  restarting: boolean;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  restart: () => Promise<void>;
  reload: () => Promise<void>;
  openPanel: () => void;
};

const Ctx = createContext<SyncCtx | null>(null);

export function useSync(): SyncCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync вне SyncProvider');
  return v;
}

/** Общее состояние синка для шапки, баннеров, пустого состояния и панели в окне. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const busy = useRef(false); // синхронная защита от двойного клика
  const lastSuccessRef = useRef<string | null | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/status', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error('bad status');
      const next = json.data as SyncStatus;
      // синк завершился (новый lastSuccessAt): кэш GET устарел до того, как экраны перечитают данные
      if (lastSuccessRef.current !== undefined && lastSuccessRef.current !== next.lastSuccessAt) invalidateApiCache();
      lastSuccessRef.current = next.lastSuccessAt;
      setStatus(next);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  const running = status?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [running, reload]);

  const start = useCallback(async () => {
    setStarting(true);
    setNotice(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (res.status !== 202) {
        const json = await res.json().catch(() => null);
        setNotice(startErrorText(res.status, json?.error?.code));
      }
      await reload();
    } catch {
      setNotice('Не удалось запустить синк.');
    } finally {
      setStarting(false);
    }
  }, [reload]);

  const post = useCallback(async (url: string, body: string, action: 'cancel' | 'restart') => {
    if (busy.current) return;
    busy.current = true;
    if (action === 'cancel') setStopping(true); else setRestarting(true);
    setNotice(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setNotice(stopErrorText(res.status, json?.error?.code, action));
      }
      // cancelled:false (уже завершён) и успех: тихо обновляем статус
      await reload();
    } catch {
      setNotice(stopErrorText(0, undefined, action));
    } finally {
      busy.current = false;
      setStopping(false);
      setRestarting(false);
    }
  }, [reload]);

  const cancel = useCallback(() => post('/api/sync/cancel', '{}', 'cancel'), [post]);
  const restart = useCallback(() => post('/api/sync', '{"restart":true}', 'restart'), [post]);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const value = useMemo(
    () => ({ status, loading, loadError, starting, stopping, restarting, notice, start, cancel, restart, reload, openPanel }),
    [status, loading, loadError, starting, stopping, restarting, notice, start, cancel, restart, reload, openPanel],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <Sheet open={panelOpen} onClose={() => setPanelOpen(false)} title="Синхронизация с PSN" wide>
        <div className="flex flex-col gap-4">
          <SyncPanel />
          <TelegramDigestPanel />
        </div>
      </Sheet>
    </Ctx.Provider>
  );
}
