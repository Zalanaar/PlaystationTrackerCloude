'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMe } from '../access/useMe';
import { Icon } from '../icons';
import { fetchTourState } from '../tour/api';
import { useTour } from '../tour/TourProvider';
import type { WhatsNewEntry } from './entries';
import {
  announceText, autoVisible, counterText, latestId, parseSeen, planAuto, planMenu, READY_WAIT_MS, seenKey, SHOW_DELAY_MS,
} from './model';

type Shown = { entries: WhatsNewEntry[]; mode: 'auto' | 'manual'; markTo: number | null; seenAtOpen: number };
type Ctx = { open: () => void; shown: Shown | null; index: number; setIndex: (i: number) => void; close: () => void; hidden: boolean };
const C = createContext<Ctx | null>(null);

/** Повтор «Что нового» из меню профиля. Вне провайдера ничего не делает. */
export function useWhatsNew(): { open: () => void } {
  const c = useContext(C);
  return { open: c?.open ?? (() => {}) };
}

function readSeen(userId: number): number | null | undefined {
  try { return parseSeen(localStorage.getItem(seenKey(userId))); } catch { return undefined; } // undefined = хранилища нет
}
function writeSeen(userId: number, id: number): void {
  try {
    const cur = parseSeen(localStorage.getItem(seenKey(userId))) ?? 0;
    localStorage.setItem(seenKey(userId), String(Math.max(cur, id)));
  } catch { /* приватный режим: карточка может показаться снова */ }
}

const blocked = () => !!document.querySelector('[role="dialog"], [role="menu"]');

/**
 * Состояние «Что нового» (спека B.1). Автопоказ: только после готовности страницы + 1500 мс, не при туре, не на Разборе/Итогах.
 * Закрытие любым способом отмечает показанные записи; тур, начавшийся при видимой карточке, скрывает её без отметки.
 */
export function WhatsNewProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const pathname = usePathname();
  const [hasGame, setHasGame] = useState(false);
  const tour = useTour().active;
  const [shown, setShown] = useState<Shown | null>(null);
  const [index, setIndex] = useState(0);
  const [toast, setToast] = useState(false);
  const [tourNew, setTourNew] = useState<boolean | null>(null); // true: у пользователя ещё не пройден тур (автозапуск)
  const suppressed = useRef(false);
  const wasActive = useRef(false);
  const shownRef = useRef<Shown | null>(null);
  useEffect(() => { shownRef.current = shown; }, [shown]);
  const userId = me?.id ?? null;
  const role = me?.role ?? 'member';

  // автозапуск тура у нового пользователя: до конца тура карточки нет, после тура записи тихо прочитаны
  useEffect(() => {
    if (userId === null) return;
    const ac = new AbortController();
    void fetchTourState(ac.signal).then((s) => { if (!ac.signal.aborted) setTourNew(s ? s.shouldAutoStart : null); }); // ошибка: состояние неизвестно, карточку не показываем
    return () => ac.abort();
  }, [userId]);

  useEffect(() => {
    if (tour) {
      wasActive.current = true;
      if (shownRef.current?.mode === 'auto') { suppressed.current = true; setShown(null); } // без отметки: вернётся в следующей сессии
      return;
    }
    if (wasActive.current) {
      wasActive.current = false;
      if (tourNew === true && userId !== null) { suppressed.current = true; writeSeen(userId, latestId()); }
    }
  }, [tour, tourNew, userId]);

  // тосты: на время тоста карточка скрыта
  useEffect(() => {
    // контейнер тостов появляется порталом позже монтирования: следим за всем body
    const sync = () => setToast((document.querySelector('.ps-toasts')?.children.length ?? 0) > 0);
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  // автопоказ
  useEffect(() => {
    if (userId === null || tourNew === null || tourNew || tour || suppressed.current || shown) return;
    const seen = readSeen(userId);
    if (seen === undefined) return;
    const plan = planAuto(seen, role);
    if (plan.entries.length === 0) {
      if (plan.firstRun || (seen ?? 0) < plan.markTo) writeSeen(userId, plan.markTo); // нечего показывать: тихо отмечаем
      return;
    }
    if (!autoVisible({ pathname, hasGameParam: hasGame, tourActive: false, toast: false })) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => { timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms)); };
    const fire = (tries: number) => {
      if (blocked()) { if (tries < 60) later(() => fire(tries + 1), 500); return; }
      if (suppressed.current) return;
      setIndex(0);
      setShown({ entries: plan.entries, mode: 'auto', markTo: plan.markTo, seenAtOpen: seen ?? 0 });
    };
    const waitReady = (waited: number) => {
      const ready = !!document.querySelector('[data-tour-page][data-tour-ready="true"]');
      if (ready || waited >= READY_WAIT_MS) later(() => fire(0), SHOW_DELAY_MS);
      else later(() => waitReady(waited + 200), 200);
    };
    waitReady(0);
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [userId, role, tourNew, tour, pathname, hasGame, shown]);

  const close = useCallback(() => {
    const s = shownRef.current;
    if (s?.mode === 'auto') {
      suppressed.current = true; // повторно в этой сессии не показываем
      if (s.markTo !== null && userId !== null) writeSeen(userId, s.markTo);
    }
    setShown(null);
  }, [userId]);

  const open = useCallback(() => {
    if (userId === null || tour) return;
    const seen = readSeen(userId) ?? 0;
    setIndex(0);
    setShown({ entries: planMenu(role), mode: 'manual', markTo: null, seenAtOpen: seen });
  }, [userId, role, tour]);

  const auto = shown?.mode === 'auto';
  const hidden = tour || toast || (auto && !autoVisible({ pathname, hasGameParam: hasGame, tourActive: false, toast: false }));
  const value = useMemo(() => ({ open, shown, index, setIndex, close, hidden }), [open, shown, index, close, hidden]);
  return (
    <C.Provider value={value}>
      <Suspense fallback={null}><GameParamProbe onChange={setHasGame} /></Suspense>
      {children}
    </C.Provider>
  );
}

/** Читает ?game= (useSearchParams требует Suspense, поэтому отдельный компонент, а не хук в провайдере). */
function GameParamProbe({ onChange }: { onChange: (v: boolean) => void }) {
  const has = useSearchParams().has('game');
  useEffect(() => { onChange(has); }, [has, onChange]);
  return null;
}

/** Плавающая карточка. Стоит в DOM после main и до tab bar. */
export function WhatsNew() {
  const c = useContext(C);
  const ref = useRef<HTMLElement>(null);
  if (!c?.shown || c.hidden || c.shown.entries.length === 0) return null;
  const { entries, seenAtOpen } = c.shown;
  const i = Math.min(c.index, entries.length - 1);
  const e = entries[i];
  const last = i === entries.length - 1;
  const fresh = e.id > seenAtOpen;

  return (
    <section
      ref={ref} className="ps-wn" role="region" aria-label="Что нового" data-testid="whats-new"
      onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); c.close(); } }}
    >
      <header className="ps-wn__head">
        <p className="ps-wn__count ps-micro" data-testid="whats-new-count">{counterText(i, entries.length)}</p>
        {fresh && <span className="ps-wn__new ps-micro">Новое</span>}
        <button type="button" className="ps-iconbtn ps-wn__x" aria-label="Закрыть" data-testid="whats-new-close" onClick={c.close}>
          <Icon name="x" size={16} />
        </button>
      </header>
      <h2 className="ps-wn__title" data-testid="whats-new-title">{e.title}</h2>
      <p className="ps-wn__text">{e.text}</p>
      <footer className="ps-wn__foot">
        {e.action && (
          <Link href={e.action.href} className="ps-link ps-wn__go" data-testid="whats-new-go" onClick={c.close}>{e.action.label} →</Link>
        )}
        <button type="button" className="ps-btn ps-btn--primary ps-wn__next" data-testid="whats-new-next" onClick={() => (last ? c.close() : c.setIndex(i + 1))}>
          {last ? 'Понятно' : 'Дальше'}
        </button>
      </footer>
      <p className="ps-sr" role="status" aria-live="polite">{announceText(e)}</p>
    </section>
  );
}
