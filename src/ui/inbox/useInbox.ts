'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useMe } from '../access/useMe';
import { registerCacheReset } from '../profiles/scope';
import { fetchInbox } from './api';
import { buildChips, chipsWhenHidden, hideKey, isHiddenToday, mskDay, SKELETON_MAX_MS, type Chip, type InboxResponse, type InboxState } from './model';

export type InboxCtl = {
  enabled: boolean;
  phase: InboxState;
  chips: Chip[];
  hidden: boolean;
  hide: () => void;
  retry: () => void;
  /** Новое число вопросов «Это та игра?» после ответов в листе (Фаза 43) */
  setMatchCount: (n: number) => void;
  /** Полоса сейчас показывает чип «Проверить статусы»: старый check-chip не рендерим */
  showsCheck: boolean;
  /**
   * Клиентский переход без памяти вкладки, а прошлый ответ был пустым: место под полосу не резервируем (ни скелета, ни
   * коробки «ничего нового»). Пустой ответ — ничего не рисуем, сдвига нет; ошибка — молча (повтор при следующем визите).
   */
  quiet: boolean;
};

/**
 * Последний ответ /api/inbox в памяти вкладки (п. B): при возврате на `/` (клиентская навигация) полоса сразу показывает его,
 * без скелета и без сдвига вёрстки, а свежий ответ подменяет его молча. Сбрасывается сменой профиля PSN; на сервере не используется.
 */
let memory: InboxResponse | null = null;
/** Подсказка между загрузками страницы: прошлый ответ был без чипов (тогда на клиентском переходе место не резервируем). */
export const INBOX_EMPTY_KEY = 'ps-inbox-empty';
function writeEmptyHint(empty: boolean | null): void {
  try { if (empty) localStorage.setItem(INBOX_EMPTY_KEY, '1'); else localStorage.removeItem(INBOX_EMPTY_KEY); } catch { /* приватный режим */ }
}
registerCacheReset(() => { memory = null; writeEmptyHint(null); });
/** Только для тестов. */
export function resetInboxMemory(): void { memory = null; }
const remember = (d: InboxResponse | null) => {
  if (typeof window === 'undefined' || !d) return;
  memory = d;
  writeEmptyHint(buildChips(d).length === 0);
};
const noopSubscribe = () => () => {};

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
export function useInbox(enabled: boolean, seed?: { data: InboxResponse | null; hidden: boolean }): InboxCtl {
  const me = useMe();
  const key = hideKey(me === undefined ? '' : me?.id ?? 'unknown');
  const ready = me !== undefined;
  // seed (item 4): ответ /api/inbox из серверного рендера `/` и подсказка «скрыто сегодня» — полоса сразу в HTML, без скелета и сдвига
  const seeded = !!seed?.data;
  // память вкладки: только при монтировании на клиенте после прошлого показа (при гидрации она пуста, разметка совпадает с сервером)
  const [fromMemory] = useState(() => !seeded && typeof window !== 'undefined' && memory !== null);
  // true только при монтировании на клиенте (переход), при гидрации — false: разметка совпадает с серверным скелетом
  const clientMount = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [quiet] = useState(() => clientMount && !seeded && !fromMemory && readStored(INBOX_EMPTY_KEY) === '1');
  const [phase, setPhase] = useState<InboxState>(seeded || fromMemory ? 'ready' : 'loading');
  const [data, setData] = useState<InboxResponse | null>(() => {
    if (seeded) { remember(seed!.data); return seed!.data; }
    return fromMemory ? memory : null;
  });
  const serverHidden = seed?.hidden ?? false;
  // пока /api/auth/me не ответил, ключ скрытия неизвестен: держим подсказку сервера, иначе полоса мигнула бы
  const hidden = useSyncExternalStore(subscribeHide, () => (ready ? isHiddenToday(readStored(key), Date.now()) : serverHidden), () => serverHidden);
  const checked = ready;
  const seq = useRef(0);
  const fails = useRef(0);
  const started = useRef(seeded);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** silent: полоса уже показана из памяти; без скелета, сбой оставляет показанное. */
  const load = useCallback((silent = false) => {
    const my = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    if (!silent) {
      setPhase('loading');
      timer.current = setTimeout(() => { if (seq.current === my) setPhase((p) => (p === 'loading' ? 'error' : p)); }, SKELETON_MAX_MS);
    }
    fetchInbox().then(
      (d) => {
        if (seq.current !== my) return;
        if (timer.current) clearTimeout(timer.current);
        fails.current = 0;
        remember(d);
        setData(d);
        setPhase('ready');
      },
      () => {
        if (seq.current !== my || silent) return;
        if (timer.current) clearTimeout(timer.current);
        fails.current += 1;
        setPhase(fails.current >= 2 ? 'gone' : 'error');
      },
    );
  }, []);
  const retry = useCallback(() => load(false), [load]);

  useEffect(() => {
    if (!enabled || !checked || started.current) return;
    started.current = true;
    load(fromMemory);
  }, [enabled, checked, load, fromMemory]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const hide = useCallback(() => {
    try { localStorage.setItem(key, mskDay(Date.now())); } catch { /* только на эту сессию */ }
    hideListeners.forEach((l) => l());
  }, [key]);

  const setMatchCount = useCallback((n: number) => setData((d) => {
    const next = d ? { ...d, matchCount: n } : d;
    remember(next);
    return next;
  }), []);
  const all = useMemo(() => buildChips(data), [data]);
  // скрыто на сегодня: остаётся только чип подтверждения совпадений
  const chips = useMemo(() => (hidden ? chipsWhenHidden(all) : all), [all, hidden]);
  const visible = enabled && phase === 'ready' && chips.length > 0;
  return { enabled, phase, chips, hidden, hide, retry, setMatchCount, showsCheck: visible && chips.some((c) => c.id === 'check'), quiet };
}
