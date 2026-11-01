'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useMe } from '../access/useMe';
import { fetchInbox } from './api';
import { buildChips, hideKey, isHiddenToday, mskDay, SKELETON_MAX_MS, type Chip, type InboxResponse, type InboxState } from './model';

export type InboxCtl = {
  enabled: boolean;
  phase: InboxState;
  chips: Chip[];
  hidden: boolean;
  hide: () => void;
  retry: () => void;
  /** Полоса сейчас показывает чип «Проверить статусы»: старый check-chip не рендерим */
  showsCheck: boolean;
};

const hideListeners = new Set<() => void>();
function subscribeHide(cb: () => void): () => void {
  hideListeners.add(cb);
  return () => { hideListeners.delete(cb); };
}
function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * Данные полосы «С прошлого визита». Грузится отдельно от Коллекции и её не задерживает.
 * Скелет живёт максимум 3 с, потом строка ошибки; второй подряд сбой убирает строку до перезагрузки страницы.
 * Скрытие «до 00:00 МСК» хранится в localStorage по пользователю.
 */
export function useInbox(enabled: boolean): InboxCtl {
  const me = useMe();
  const key = hideKey(me === undefined ? '' : me?.id ?? 'unknown');
  const ready = me !== undefined;
  const [phase, setPhase] = useState<InboxState>('loading');
  const [data, setData] = useState<InboxResponse | null>(null);
  const hidden = useSyncExternalStore(subscribeHide, () => isHiddenToday(readStored(key), Date.now()), () => false);
  const checked = ready;
  const seq = useRef(0);
  const fails = useRef(0);
  const started = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    const my = ++seq.current;
    setPhase('loading');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (seq.current === my) setPhase((p) => (p === 'loading' ? 'error' : p)); }, SKELETON_MAX_MS);
    fetchInbox().then(
      (d) => {
        if (seq.current !== my) return;
        if (timer.current) clearTimeout(timer.current);
        fails.current = 0;
        setData(d);
        setPhase('ready');
      },
      () => {
        if (seq.current !== my) return;
        if (timer.current) clearTimeout(timer.current);
        fails.current += 1;
        setPhase(fails.current >= 2 ? 'gone' : 'error');
      },
    );
  }, []);

  useEffect(() => {
    if (!enabled || !checked || hidden || started.current) return;
    started.current = true;
    load();
  }, [enabled, checked, hidden, load]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const hide = useCallback(() => {
    try { localStorage.setItem(key, mskDay(Date.now())); } catch { /* только на эту сессию */ }
    hideListeners.forEach((l) => l());
  }, [key]);

  const chips = useMemo(() => buildChips(data), [data]);
  const visible = enabled && !hidden && phase === 'ready' && chips.length > 0;
  return { enabled, phase, chips, hidden, hide, retry: load, showsCheck: visible && chips.some((c) => c.id === 'check') };
}
