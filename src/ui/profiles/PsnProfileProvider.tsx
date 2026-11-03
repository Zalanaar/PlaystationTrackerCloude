'use client';

import { useRouter } from 'next/navigation';
import {
  createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode,
} from 'react';
import { useToast } from '../primitives/Toast';
import { fetchAuthSnapshot, setActiveProfile, ProfilesApiError, type AuthSnapshot, type LightProfile } from './api';
import { switchedToast, switchErrorText, veilText } from './model';
import { Spinner } from './Spinner';
import { resetClientCaches, setActiveProfileId } from './scope';

/** Минимум показа завесы, чтобы она не мигала (§17.2 шаг 3) */
export const VEIL_MIN_MS = 300;
const REFRESH_TIMEOUT_MS = 8000;

type Ctx = {
  /** null: ещё не загрузили /api/auth/me */
  snapshot: AuthSnapshot | null;
  profiles: LightProfile[];
  activeProfileId: number | null;
  /** ник профиля, который сейчас открывается; null = смены нет */
  switching: string | null;
  switchTo: (id: number) => Promise<void>;
  /** Запрос смены уже выполнен снаружи (добавление с activate, отвязка активного): сброс кэшей, router.refresh, тост, фокус */
  completeSwitch: (id: number, nick: string) => Promise<void>;
  reload: () => Promise<AuthSnapshot | null>;
};

const C = createContext<Ctx>({
  snapshot: null, profiles: [], activeProfileId: null, switching: null,
  switchTo: async () => {}, completeSwitch: async () => {}, reload: async () => null,
});
export const usePsnProfiles = () => useContext(C);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function focusPageHeading(): void {
  let tries = 0;
  const go = () => {
    const h = document.querySelector<HTMLElement>('main h1');
    if (h) {
      h.tabIndex = -1; h.focus({ preventScroll: false });
      if (document.activeElement === h) return;
    }
    if (++tries < 15) setTimeout(go, 100);
  };
  requestAnimationFrame(go);
}

/**
 * Профили PSN одного входа (Фаза 41, §17). Держит активный профиль из /api/auth/me, умеет сменить его и
 * перезагрузить данные: сброс клиентских кэшей, `key` на поддереве (все хуки и провайдеры монтируются заново, состояния прежнего профиля нет),
 * `router.refresh()`. Пока идёт смена, контент скрыт (html[data-psw]) и поверх лежит завеса.
 * Должен стоять внутри ToastProvider и снаружи SyncProvider и остальных провайдеров данных.
 */
export function PsnProfileProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [snapshot, setSnapshot] = useState<AuthSnapshot | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [switching, setSwitching] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const waiter = useRef<{ saw: boolean; done: () => void } | null>(null);
  const snapRef = useRef<AuthSnapshot | null>(null);
  const switchRef = useRef<(id: number) => Promise<void>>(async () => {});
  useEffect(() => { snapRef.current = snapshot; }, [snapshot]);

  const apply = useCallback((s: AuthSnapshot | null) => {
    setSnapshot(s);
    setActiveProfileId(s ? s.activeProfileId : null);
  }, []);

  const reload = useCallback(async () => {
    const s = await fetchAuthSnapshot(undefined, { fresh: true }); // после смены/привязки профиля: мимо короткого кэша authMe
    if (s) apply(s);
    return s;
  }, [apply]);

  useEffect(() => {
    let alive = true;
    void fetchAuthSnapshot().then((s) => { if (alive && s) apply(s); });
    return () => { alive = false; };
  }, [apply]);

  // router.refresh() в transition: pending=false после true означает, что новые данные получены
  useEffect(() => {
    const w = waiter.current;
    if (!w) return;
    if (pending) w.saw = true;
    else if (w.saw) { waiter.current = null; w.done(); }
  }, [pending]);

  useEffect(() => {
    document.documentElement.toggleAttribute('data-psw', switching !== null);
    return () => document.documentElement.removeAttribute('data-psw');
  }, [switching]);

  // data-psw уже снят (эффект выше объявлен раньше): main видим, focus() сработает
  useEffect(() => { if (focusTick > 0 && switching === null) focusPageHeading(); }, [focusTick, switching]);

  const nickOf = useCallback((id: number) => snapRef.current?.profiles.find((p) => p.id === id)?.onlineId ?? 'PSN', []);

  const completeSwitch = useCallback(async (id: number, nick: string) => {
    setSwitching(nick); // завеса и скрытый контент до сброса кэшей: данные прежнего профиля не мелькают
    busy.current = true;
    const started = Date.now();
    try {
      resetClientCaches();
      setActiveProfileId(id);
      setEpoch((e) => e + 1);
      const refreshed = new Promise<void>((resolve) => {
        waiter.current = { saw: false, done: resolve };
        setTimeout(() => { if (waiter.current) { waiter.current = null; resolve(); } }, REFRESH_TIMEOUT_MS);
      });
      startTransition(() => { router.refresh(); });
      await Promise.all([refreshed, reload()]);
      const rest = VEIL_MIN_MS - (Date.now() - started);
      if (rest > 0) await sleep(rest);
    } finally {
      busy.current = false;
      setSwitching(null);
    }
    toast({ text: switchedToast(nick), kind: 'info', ttl: 3000 });
    setFocusTick((t) => t + 1);
  }, [reload, router, toast]);

  const switchTo = useCallback(async (id: number) => {
    if (busy.current) return;
    const nick = nickOf(id);
    if (id === snapRef.current?.activeProfileId) return;
    busy.current = true;
    setSwitching(nick);
    try {
      const r = await setActiveProfile(id);
      busy.current = false;
      await completeSwitch(r.activeProfileId, nick);
    } catch (e) {
      busy.current = false;
      setSwitching(null);
      if (e instanceof ProfilesApiError && e.status === 401) return; // редирект на вход уже запущен
      const t = switchErrorText(e instanceof ProfilesApiError ? e : { status: 0, code: 'network' });
      if (t.reload) void reload();
      toast({
        text: t.text, kind: 'error', alert: true,
        action: t.retry ? { label: 'Повторить', run: () => { void switchRef.current(id); } } : undefined,
      });
    }
  }, [completeSwitch, nickOf, reload, toast]);

  useEffect(() => { switchRef.current = switchTo; }, [switchTo]);

  const value = useMemo<Ctx>(() => ({
    snapshot, profiles: snapshot?.profiles ?? [], activeProfileId: snapshot?.activeProfileId ?? null, switching,
    switchTo, completeSwitch, reload,
  }), [snapshot, switching, switchTo, completeSwitch, reload]);

  return (
    <C.Provider value={value}>
      <Fragment key={epoch}>{children}</Fragment>
      {switching !== null && (
        <div className="ps-pswitch-veil">
          <div className="ps-pswitch-veil__panel" role="status" aria-live="polite">
            <Spinner size={20} />
            <span>{veilText(switching)}</span>
          </div>
        </div>
      )}
    </C.Provider>
  );
}
