'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Sheet } from '../primitives/Sheet';
import { SyncPanel } from './SyncPanel';
import { startErrorText, type SyncStatus } from './status';

const POLL_MS = 3000;

type SyncCtx = {
  status: SyncStatus | null;
  loading: boolean;
  loadError: boolean;
  starting: boolean;
  notice: string | null;
  start: () => Promise<void>;
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

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/status', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error('bad status');
      setStatus(json.data as SyncStatus);
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

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const value = useMemo(
    () => ({ status, loading, loadError, starting, notice, start, reload, openPanel }),
    [status, loading, loadError, starting, notice, start, reload, openPanel],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <Sheet open={panelOpen} onClose={() => setPanelOpen(false)} title="Синк" wide>
        <SyncPanel />
      </Sheet>
    </Ctx.Provider>
  );
}
