'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTour } from '../tour/TourProvider';
import {
  EMPTY_STORED, SHOW_DELAY_MS, canShowInstall, canShowManual, dismissOnce, isIosDevice, markDone, platformFor,
  type InstallPlatform,
} from './install-model';
import { countVisit, readInstall, writeInstall } from './install-store';

// П15.5: сама карточка (тексты, шаги iOS) — отдельным чанком: нужна редко, а провайдер живёт на каждой странице.
const InstallCard = dynamic(() => import('./InstallCard'), { ssr: false });

/** Событие Chrome/Android: нет в lib.dom, объявляем сами */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Ctx = { available: boolean; open: () => void };
const C = createContext<Ctx>({ available: false, open: () => {} });

/** Для строки «Установить приложение» в меню: доступна по платформе и не standalone */
export const useInstall = () => useContext(C);

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
const noopSubscribe = () => () => {};
function subscribeMobile(cb: () => void) {
  const mq = window.matchMedia('(max-width: 767px)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const overlayOpen = () => !!document.querySelector('[role="dialog"], [role="menu"], .ps-story');
const conflictOpen = () => !!document.querySelector('.ps-wn, .ps-toasts > *, .ps-selbar');

/**
 * Подсказка «Установить» (design-system §15.2). Провайдер держит платформу, отложенное событие Android и ручной вызов из меню;
 * карточка рисуется здесь же, поверх страницы. Условия автопоказа: install-model.canShowInstall + 8 с задержки.
 */
export function InstallProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const tourActive = useTour().active;
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  // на сервере и при гидратации: не iOS, «установлено», не мобильный (карточку не показываем)
  const ios = useSyncExternalStore(noopSubscribe, () => isIosDevice(navigator), () => false);
  const standaloneNow = useSyncExternalStore(noopSubscribe, isStandalone, () => true);
  const mobile = useSyncExternalStore(subscribeMobile, isMobile, () => false);
  const [installed, setInstalled] = useState(false);
  const standalone = standaloneNow || installed;
  const [manual, setManual] = useState(false);
  const [auto, setAuto] = useState(false);
  const [ready, setReady] = useState(false); // прошло SHOW_DELAY_MS
  const shownRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);

  // платформа, режим, события установки
  useEffect(() => {
    if (isStandalone()) document.documentElement.setAttribute('data-standalone', '');
    const onBip = (e: Event) => { e.preventDefault(); setPrompt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => {
      writeInstall(markDone(readInstall() ?? EMPTY_STORED));
      setPrompt(null); setAuto(false); setManual(false); setInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    countVisit();
    const t = setTimeout(() => setReady(true), SHOW_DELAY_MS);
    return () => {
      clearTimeout(t);
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const platform: InstallPlatform = platformFor({ ios, hasPrompt: prompt !== null });
  const available = canShowManual({ standalone, mobile, platform, pathname });

  // автопоказ: условия проверяем раз в секунду (окна, тосты и «Что нового» не в React-состоянии)
  useEffect(() => {
    if (!ready || manual) return;
    const check = () => {
      setAuto(canShowInstall({
        stored: readInstall(), now: Date.now(), standalone: isStandalone(), mobile: isMobile(), pathname, platform,
        tourActive, overlayOpen: overlayOpen(), conflictOpen: conflictOpen(), shownThisSession: shownRef.current,
      }));
    };
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [ready, manual, pathname, platform, tourActive]);

  const visible = (auto || manual) && platform !== null && !closing && !standalone;
  useEffect(() => { if (visible && !manual) shownRef.current = true; }, [visible, manual]);

  const hide = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setAuto(false); setManual(false); setClosing(false); }, 200);
  }, []);

  const dismiss = useCallback(() => {
    if (!manual) {
      const cur = readInstall();
      if (cur) writeInstall(dismissOnce(cur, Date.now()));
    }
    hide();
  }, [manual, hide]);

  const install = useCallback(async () => {
    if (!prompt || busy) return;
    setBusy(true);
    const ev = prompt;
    setPrompt(null); // событие одноразовое
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      setBusy(false);
      if (outcome === 'accepted') {
        const cur = readInstall();
        if (cur) writeInstall(markDone(cur));
        hide();
      } else {
        dismiss();
      }
    } catch {
      setBusy(false);
      hide(); // ошибка: тихо закрываем без snooze
    }
  }, [prompt, busy, hide, dismiss]);

  const open = useCallback(() => { if (available) setManual(true); }, [available]);
  const value = useMemo(() => ({ available, open }), [available, open]);

  // Escape закрывает как «Не сейчас»
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, dismiss]);

  return (
    <C.Provider value={value}>
      {children}
      {visible && platform && <InstallCard platform={platform} busy={busy} onInstall={() => void install()} onDismiss={dismiss} />}
    </C.Provider>
  );
}
