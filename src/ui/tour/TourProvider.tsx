'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TOUR_VERSION } from '@/shared/tour';
import { fetchTourState, saveTourDone } from './api';
import {
  AUTO_DELAY_MS, canAutoStart, nextIndex, parseResume, prevIndex, TOUR_SEEN_KEY, TOUR_SHOWN_KEY, TOUR_STEP_KEY,
} from './model';
import { TOUR_STEPS, type TourRoute } from './steps';
import { TourOverlay } from './TourOverlay';

type Ctx = { start: () => void; active: boolean };
const C = createContext<Ctx>({ start: () => {}, active: false });

/** Запуск тура из меню («Как пользоваться»). Вне провайдера ничего не делает. */
export const useTour = () => useContext(C);

/** Ждём закрытия меню (--dur-base + 50 мс), потом запускаем тур */
const MENU_CLOSE_MS = 250;

function store(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

function focusHeading() {
  const h1 = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('h1');
  if (!h1) return;
  if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
  h1.focus({ preventScroll: true });
}

/**
 * Интерактивный тур (design-system §10): состояние шага, автозапуск, возобновление, сохранение прогресса.
 * Любая ошибка API ничего не ломает: тур просто не стартует автоматически (fail-open).
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [index, setIndex] = useState<number | null>(null);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const indexRef = useRef<number | null>(null);
  const pathRef = useRef(pathname);
  const prevPath = useRef(pathname);
  const navRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((i: number | null, d: 'fwd' | 'back' = 'fwd') => {
    indexRef.current = i;
    setDir(d);
    setIndex(i);
    const ss = store();
    try {
      if (i === null) ss?.removeItem(TOUR_STEP_KEY);
      else ss?.setItem(TOUR_STEP_KEY, TOUR_STEPS[i].id);
    } catch { /* хранилище недоступно: возобновления не будет */ }
  }, []);

  const close = useCallback((focus: boolean) => {
    show(null);
    void saveTourDone(TOUR_VERSION);
    if (focus) setTimeout(focusHeading, 0);
  }, [show]);

  const start = useCallback(() => {
    if (indexRef.current !== null || timer.current) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    timer.current = setTimeout(() => { timer.current = null; show(0); }, MENU_CLOSE_MS);
  }, [show]);

  const navigate = useCallback((route: TourRoute) => {
    if (route === '*' || pathRef.current === route) return;
    navRef.current = route;
    router.push(route, { scroll: false });
  }, [router]);

  useEffect(() => { pathRef.current = pathname; }, [pathname]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // возобновление после перезагрузки (и запуск из онбординга: он кладёт id первого шага в sessionStorage)
  useEffect(() => {
    const i = parseResume(store()?.getItem(TOUR_STEP_KEY));
    if (i !== null && indexRef.current === null) show(i);
  }, [show]);

  // смена пути не по команде тура (кнопка «назад» браузера, ссылка): закрыть как пропущенный
  useEffect(() => {
    if (prevPath.current === pathname) return;
    prevPath.current = pathname;
    if (index === null) { navRef.current = null; return; }
    if (navRef.current === pathname) { navRef.current = null; return; }
    close(false);
  }, [pathname, index, close]);

  // автозапуск
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => { timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms)); };
    const blocked = () => !!document.querySelector('[role="dialog"], [role="menu"]');
    const input = (apiShouldStart: boolean) => {
      let seenFlag: string | null = null;
      let shown = false;
      try { seenFlag = localStorage.getItem(TOUR_SEEN_KEY); shown = store()?.getItem(TOUR_SHOWN_KEY) === '1'; } catch { /* нет хранилища */ }
      return {
        pathname: pathRef.current, search: window.location.search, apiShouldStart, shownThisSession: shown, seenFlag, version: TOUR_VERSION,
        tourActive: indexRef.current !== null,
      };
    };
    (async () => {
      if (!canAutoStart(input(true))) return; // дёшево отсекаем до запроса
      const state = await fetchTourState();
      if (cancelled || !state?.shouldAutoStart) return;
      const startPath = pathRef.current;
      const waitReady = (tries: number) => {
        if (pathRef.current !== startPath) return; // «максимум до следующей навигации»
        const ready = !!document.querySelector('[data-tour-page][data-tour-ready="true"]');
        if (ready || tries >= 20) later(() => attempt(0), AUTO_DELAY_MS);
        else later(() => waitReady(tries + 1), 200);
      };
      const attempt = (tries: number) => {
        if (pathRef.current !== startPath) return;
        if (!canAutoStart(input(true))) return;
        if (blocked()) { if (tries < 120) later(() => attempt(tries + 1), 500); return; }
        try { store()?.setItem(TOUR_SHOWN_KEY, '1'); } catch { /* ок */ }
        show(0);
      };
      waitReady(0);
    })();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [show]);

  const value = useMemo(() => ({ start, active: index !== null }), [start, index]);

  return (
    <C.Provider value={value}>
      {children}
      {index !== null && (
        <TourOverlay
          index={index} dir={dir} navigate={navigate}
          onNext={() => show(nextIndex(index), 'fwd')}
          onPrev={() => show(prevIndex(index), 'back')}
          onSkip={() => close(true)}
          onFinish={(openTriage) => {
            close(!openTriage);
            if (openTriage) { navRef.current = '/triage'; router.push('/triage'); }
          }}
        />
      )}
    </C.Provider>
  );
}
