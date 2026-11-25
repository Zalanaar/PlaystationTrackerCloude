'use client';

import dynamic from 'next/dynamic';
import Link from '@/ui/IntentLink'; // Пакет 6: без предзагрузки по экрану, по намерению
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { useIsOwner } from '../access/useIsOwner';
import { Icon } from '../icons';
import { Avatar } from '../primitives/Avatar';
import { Popover } from '../primitives/Popover';
import { profileLine } from '../profile/model';
import { useProfile } from '../profile/ProfileProvider';
import { usePsnProfiles } from '../profiles/PsnProfileProvider';
import { Sheet } from '../primitives/Sheet';
import { useSync } from '../sync/SyncProvider';
import { useInstall } from '../pwa/InstallPrompt';
import { purgeServiceWorkerCaches } from '../pwa/sw-messages';
import { invalidateApiCache } from '../data/http';
import { useTour } from '../tour/TourProvider';
import { useWhatsNew } from '../whatsnew/WhatsNew';
import { PsnProfileSwitcher } from './PsnProfileSwitcher';
import { SyncIndicator } from './SyncIndicator';
import { collectionMenuOn, emitHeaderAction, headerActionsFor, localSearchOn, useHeaderSearchOpen } from './headerActions';
import { AddMenu } from './AddMenu';
import { AfterCompleteHost } from '../complete/AfterCompleteHost';
import { StartPlayingHost } from '../guides/StartPlayingHost';
import { useAppBadge } from '../pwa/appBadge';
import { useOfflineNav } from './offlineNav';
import { PullToRefresh } from './PullToRefresh';
import { useRefreshOnReturn } from './refresh';
import { NAV_TABS } from '../tokens';
import { useSeasonOffer } from '../wrapped/useSeason';
import { isTabActive, sectionTitle } from './nav';
import { MARK_TAP, MEASURE_TAB, navDir, readScroll, runTabTransition, shouldIntercept, writeScroll } from './tabTransition';
import { ThemePicker, ThemeSwatches } from './ThemePicker';
import { useEverTrue } from '../useEverTrue';
import { pendingBadge, useTriagePending } from './triagePending';
import { useTabHref } from './nextSub';
import { installErrorReporter } from './errorReporter';

const GlobalSearch = dynamic(() => import('./GlobalSearch').then((m) => m.GlobalSearch), { ssr: false });

function useLogout() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function leave(url: string) {
    setBusy(true);
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } finally {
      void purgeServiceWorkerCaches();
      invalidateApiCache(); // данные прошлого входа не должны пережить клиентский переход на /login
      router.replace('/login');
      router.refresh();
    }
  }
  const logout = () => leave('/api/auth/logout');
  /** Фаза 45: все сессии входа (телефон, PWA, другие браузеры) перестают действовать, включая эту. */
  async function logoutAll() {
    if (!window.confirm('Выйти на всех устройствах? Войти заново придётся везде, включая это устройство.')) return;
    await leave('/api/auth/logout-all');
  }
  return { busy, logout, logoutAll };
}

export function AppHeader() {
  const pathname = usePathname();
  const offlineNav = useOfflineNav();
  const { openPanel } = useSync();
  const { busy, logout, logoutAll } = useLogout();
  const [more, setMore] = useState(false);
  const { profile } = useProfile();
  const { profiles, activeProfileId } = usePsnProfiles();
  const psnNick = profiles.length >= 2 ? (profiles.find((p) => p.id === activeProfileId)?.onlineId ?? null) : null;
  const line = profile ? profileLine(profile) : null;
  const offer = useSeasonOffer();
  const isOwner = useIsOwner();
  const { start: startTour } = useTour();
  const install = useInstall();
  const { open: openWhatsNew } = useWhatsNew();
  // D-P2: на мобильном вместо логотипа название раздела, рядом «Поиск» и «+» той страницы, где они есть
  // П9/F25: и у экранов без вкладки («Разбор», «Профили», «Доступ», «Здоровье», «Настройки») название в шапке телефона
  const title = sectionTitle(pathname);
  const tabHref = useTabHref(pathname);
  const hdr = headerActionsFor(pathname);
  const localSearch = localSearchOn(pathname);
  const localSearchOpen = useHeaderSearchOpen();
  const [gsearch, setGsearch] = useState(false);
  const gsearchMounted = useEverTrue(gsearch);
  useAppBadge(); // идея 4: число «Разбора» на иконке PWA
  useRefreshOnReturn(); // П9: долгий возврат в приложение — тихо перечитать данные экрана
  useEffect(() => installErrorReporter(), []); // П10: журнал ошибок браузера

  return (
    <>
      <PullToRefresh />
      <AfterCompleteHost />
      <StartPlayingHost />
      <header className="ps-header">
        <div className="ps-header__in ps-container">
          <Link href="/" className="ps-logo" data-section={title ? '' : undefined}>PS TRACKER</Link>
          {title && <span className="ps-header__title" aria-hidden="true">{title}</span>}
          <nav className="ps-nav" aria-label="Разделы" data-tour="nav">
            {NAV_TABS.map((n) => {
              const href = tabHref(n);
              const dot = n.id === 'stats' && offer !== null;
              return (
                <Link
                  key={n.href} href={href} className="ps-nav-item" aria-current={isTabActive(pathname, n) ? 'page' : undefined}
                  onClick={(e: MouseEvent<HTMLAnchorElement>) => { if (!isTabActive(pathname, n) && offlineNav()) e.preventDefault(); }}
                  aria-label={dot ? `${n.label}, доступны Итоги года` : undefined}
                >
                  {n.label}
                  {dot && <span className="ps-notify-dot" aria-hidden="true" />}
                </Link>
              );
            })}
          </nav>
          <div className="ps-header__right">
            {hdr.search && !localSearch && (
              <button
                type="button" className={localSearch ? 'ps-iconbtn ps-mobile-only' : 'ps-iconbtn'} data-testid="hdr-search" data-tour="search-hdr" aria-label="Найти игру"
                aria-haspopup={localSearch ? undefined : 'dialog'}
                aria-expanded={localSearch ? localSearchOpen : gsearch}
                onPointerDown={(e) => { if (localSearch && localSearchOpen) e.preventDefault(); }}
                onClick={() => (localSearch ? emitHeaderAction('search') : setGsearch(true))}
              >
                <Icon name="search" size={22} />
              </button>
            )}
            {gsearchMounted && <GlobalSearch open={gsearch} onClose={() => setGsearch(false)} />}
            {hdr.add && <AddMenu pathname={pathname} />}
            <SyncIndicator />
            <PsnProfileSwitcher />
            <div className="ps-desktop-only"><ThemePicker /></div>
            <div className="ps-desktop-only">
              <Popover
                align="end" className="ps-profmenu"
                trigger={(p) => (
                  <button type="button" className="ps-avatar" aria-label={profile ? `Профиль ${profile.onlineId}` : 'Меню профиля'} {...p}>
                    {profile ? <Avatar url={profile.avatarUrl} name={profile.onlineId} size={32} /> : 'А'}
                  </button>
                )}
              >
                {(close) => (
                  <>
                    {profile && (
                      <div className="ps-profmenu__head">
                        <Avatar url={profile.avatarUrl} name={profile.onlineId} size={40} />
                        <span className="ps-profmenu__tx">
                          <b title={profile.onlineId}>{profile.onlineId}</b>
                          {line && <small className="num">{line}</small>}
                          {psnNick && <small className="ps-profmenu__psn">PSN: {psnNick}</small>}
                        </span>
                      </div>
                    )}
                    {/* Копия и сброс статусов — в «Настройках»; скрытые игры — в фильтрах Коллекции; тема — и в шапке, и в «⋯» */}
                    <TriageMenuItem active role="menuitem" testid="menu-triage" onClick={close} />
                    <Link href="/profiles" role="menuitem" className="ps-menu-item" onClick={close}>
                      <Icon name="users" size={16} />
                      <span className="ps-menu-item__label">PSN-профили</span>
                    </Link>
                    <Link href="/settings" role="menuitem" className="ps-menu-item" data-testid="menu-settings" onClick={close}>
                      <Icon name="sliders" size={16} />
                      <span className="ps-menu-item__label">Настройки</span>
                    </Link>
                    <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--sep" onClick={() => { close(); startTour(); }}>
                      <Icon name="circle-help" size={16} />
                      <span className="ps-menu-item__label">Как пользоваться</span>
                    </button>
                    <button type="button" role="menuitem" className="ps-menu-item" data-testid="menu-whats-new" onClick={() => { close(); setTimeout(openWhatsNew, 0); }}>
                      <Icon name="info" size={16} />
                      <span className="ps-menu-item__label">Что нового</span>
                    </button>
                    {isOwner && (
                      <Link href="/access" role="menuitem" className="ps-menu-item ps-menu-item--sep" onClick={close}>
                        <Icon name="users" size={16} />
                        <span className="ps-menu-item__label">Доступ</span>
                      </Link>
                    )}
                    {isOwner && (
                      <Link href="/health" role="menuitem" className="ps-menu-item" onClick={close}>
                        <Icon name="shield-alert" size={16} />
                        <span className="ps-menu-item__label">Здоровье</span>
                      </Link>
                    )}
                    <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--sep" onClick={() => void logout()} disabled={busy}>
                      <Icon name="logout" size={16} />
                      <span className="ps-menu-item__label">Выйти</span>
                    </button>
                    <button type="button" role="menuitem" className="ps-menu-item" data-testid="menu-logout-all" onClick={() => void logoutAll()} disabled={busy}>
                      <Icon name="logout" size={16} />
                      <span className="ps-menu-item__label">Выйти на всех устройствах</span>
                    </button>
                  </>
                )}
              </Popover>
            </div>
            <button type="button" className="ps-iconbtn ps-mobile-only" data-tour="menu-more" aria-label="Меню" onClick={() => setMore(true)}>
              <Icon name="more" size={22} />
            </button>
          </div>
        </div>
      </header>

      <Sheet open={more} onClose={() => setMore(false)} title="Меню">
        <div className="ps-stack">
          {profile && (
            <div className="ps-profmenu__head ps-profmenu__head--sheet">
              <Avatar url={profile.avatarUrl} name={profile.onlineId} size={40} />
              <span className="ps-profmenu__tx">
                <b title={profile.onlineId}>{profile.onlineId}</b>
                {line && <small className="num">{line}</small>}
                {psnNick && <small className="ps-profmenu__psn">PSN: {psnNick}</small>}
              </span>
            </div>
          )}
          <p className="ps-micro">Тема</p>
          <ThemeSwatches />
          {collectionMenuOn(pathname) && (
            <>
              {/* F13: действия Коллекции вынесены из листа «Фильтры» в «⋯»; «Другая платформа» — в «+» */}
              <p className="ps-micro ps-menu-group">Коллекция</p>
              <button type="button" className="ps-menu-item" data-testid="sheet-select" onClick={() => { setMore(false); emitHeaderAction('select'); }}>
                <Icon name="check-circle" size={16} /><span className="ps-menu-item__label">Выбрать игры</span>
              </button>
              <button type="button" className="ps-menu-item" data-testid="sheet-tags" aria-haspopup="dialog" onClick={() => { setMore(false); emitHeaderAction('tags'); }}>
                <Icon name="bookmark" size={16} /><span className="ps-menu-item__label">Теги</span>
              </button>
            </>
          )}
          <p className="ps-micro ps-menu-group">Разделы</p>
          <button type="button" className="ps-menu-item" onClick={() => { setMore(false); openPanel(); }}>
            <Icon name="refresh" size={16} /><span className="ps-menu-item__label">Синк с PSN</span>
          </button>
          <TriageMenuItem active={more} testid="more-menu-triage" onClick={() => setMore(false)} />
          <Link href="/profiles" className="ps-menu-item" onClick={() => setMore(false)}>
            <Icon name="users" size={16} /><span className="ps-menu-item__label">PSN-профили</span>
          </Link>
          <Link href="/settings" className="ps-menu-item" data-testid="sheet-settings" onClick={() => setMore(false)}>
            <Icon name="sliders" size={16} /><span className="ps-menu-item__label">Настройки</span>
          </Link>
          <p className="ps-micro ps-menu-group">Помощь</p>
          <button type="button" className="ps-menu-item" onClick={() => { setMore(false); startTour(); }}>
            <Icon name="circle-help" size={16} /><span className="ps-menu-item__label">Как пользоваться</span>
          </button>
          <button type="button" className="ps-menu-item" data-testid="menu-whats-new" onClick={() => { setMore(false); setTimeout(openWhatsNew, 0); }}>
            <Icon name="info" size={16} /><span className="ps-menu-item__label">Что нового</span>
          </button>
          {install.available && (
            <button type="button" className="ps-menu-item" data-testid="menu-install" onClick={() => { setMore(false); setTimeout(install.open, 250); }}>
              <Icon name="download" size={16} /><span className="ps-menu-item__label">Установить приложение</span>
            </button>
          )}
          {isOwner && (
            <>
              <p className="ps-micro ps-menu-group">Администрирование</p>
              <Link href="/access" className="ps-menu-item" onClick={() => setMore(false)}>
                <Icon name="users" size={16} /><span className="ps-menu-item__label">Доступ</span>
              </Link>
              <Link href="/health" className="ps-menu-item" onClick={() => setMore(false)}>
                <Icon name="shield-alert" size={16} /><span className="ps-menu-item__label">Здоровье</span>
              </Link>
            </>
          )}
          <p className="ps-micro ps-menu-group">Выход</p>
          <button type="button" className="ps-menu-item" onClick={() => void logout()} disabled={busy}>
            <Icon name="logout" size={16} /><span className="ps-menu-item__label">Выйти</span>
          </button>
          <button type="button" className="ps-menu-item" data-testid="sheet-logout-all" onClick={() => void logoutAll()} disabled={busy}>
            <Icon name="logout" size={16} /><span className="ps-menu-item__label">Выйти на всех устройствах</span>
          </button>
        </div>
      </Sheet>
    </>
  );
}

/** П9: «Разбор» в меню (вкладку занял «Трофеи»), справа число игр без статуса. */
function TriageMenuItem({ active, role, testid, onClick }: { active: boolean; role?: 'menuitem'; testid: string; onClick: () => void }) {
  const badge = pendingBadge(useTriagePending(active));
  return (
    <Link href="/triage" role={role} className="ps-menu-item" data-testid={testid} onClick={onClick} aria-label={badge ? `Разбор, без статуса: ${badge}` : undefined}>
      <Icon name="list-checks" size={16} />
      <span className="ps-menu-item__label">Разбор</span>
      {badge && <span className="ps-menu-badge num" data-testid="triage-pending" aria-hidden="true">{badge}</span>}
    </Link>
  );
}

function session(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** П11.5.3: прокрутка до сохранённой позиции; контент может догружаться — пробуем до 1,2 с, пока пользователь не тронул экран. */
function restoreScroll(y: number) {
  window.scrollTo(0, y);
  if (y <= 0) return;
  const until = performance.now() + 1200;
  let stop = false;
  const cancel = () => { stop = true; };
  window.addEventListener('touchstart', cancel, { once: true, passive: true });
  window.addEventListener('wheel', cancel, { once: true, passive: true });
  const tick = () => {
    if (stop || Math.abs(window.scrollY - y) < 2 || performance.now() > until) {
      window.removeEventListener('touchstart', cancel); window.removeEventListener('wheel', cancel);
      return;
    }
    window.scrollTo(0, y);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}


function isUnmodifiedClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

function scrollPageTop() {
  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  window.scrollTo({ top: 0, behavior });
  const root = document.scrollingElement;
  if (root && root !== document.body && 'scrollTo' in root) root.scrollTo({ top: 0, behavior });
  for (const el of document.querySelectorAll<HTMLElement>('main, .ps-main')) {
    if (el.scrollTop > 0) el.scrollTo({ top: 0, behavior });
  }
}

export function TabBar() {
  const pathname = usePathname();
  const offer = useSeasonOffer();
  const router = useRouter();
  const active = NAV_TABS.findIndex((n) => isTabActive(pathname, n));
  const tabHref = useTabHref(pathname);
  // П16.2: вкладка подсвечивается сразу по касанию (до смены маршрута); действует, пока адрес прежний.
  // Сбрасываем при уходе с этого адреса: иначе «/?game=» (pathname снова «/») снова подсвечивал вкладку Статистики.
  const [optimistic, setOptimistic] = useState<{ path: string; to: number } | null>(null);
  if (optimistic && optimistic.path !== pathname) setOptimistic(null);
  const shown = optimistic && optimistic.path === pathname ? optimistic.to : active;
  const pending = useRef<{ tab: string; y: number; resolve: () => void } | null>(null);

  // П11.5.3: новый раздел смонтирован -> восстановить прокрутку вкладки и отпустить снимок старого экрана
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p || NAV_TABS[active]?.id !== p.tab) return;
    pending.current = null;
    restoreScroll(p.y);
    // П16.2: сразу, не в requestAnimationFrame — пока ждёт колбэк View Transition, кадры (и rAF) на паузе, и снимок
    // отпускался только по пределу ожидания
    p.resolve();
  }, [active, pathname]);

  // П11.5.3/П16.2: в установленном PWA разделы таббара и данные Бэклога подгружаются заранее, в простое после первого запуска
  // (в браузере — по намерению: касание вкладки; бюджет JS главной)
  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    if (!(nav.standalone === true || matchMedia('(display-mode: standalone)').matches)) return;
    const id = window.setTimeout(() => {
      const run = () => {
        // полная предзагрузка (не только до loading.tsx): с staleTimes.dynamic переход на вкладку не ходит на сервер
        const full = { kind: 'full' } as unknown as Parameters<typeof router.prefetch>[1];
        NAV_TABS.forEach((n) => { try { router.prefetch(n.href, full); } catch { /* необязательно */ } });
        void import('./tabPrefetch').then((m) => m.prefetchTabData('backlog'), () => {});
      };
      if ('requestIdleCallback' in window) window.requestIdleCallback(run); else run();
    }, 1500);
    return () => window.clearTimeout(id);
  }, [router]);
  const warmData = (to: number) => {
    if (to === active) return;
    void import('./tabPrefetch').then((m) => m.prefetchTabData(NAV_TABS[to].id), () => {});
  };

  const offlineNav = useOfflineNav();
  const onTab = (e: MouseEvent<HTMLAnchorElement>, to: number) => {
    // повторное касание уже активной вкладки (включая подмаршруты «Что дальше»: /roadmap, /recommend) — плавно вверх, без смены подвкладки
    if (to === active && isUnmodifiedClick(e)) {
      e.preventDefault();
      scrollPageTop();
      writeScroll(session(), NAV_TABS[to].id, 0);
      return;
    }
    if (!shouldIntercept(e, active, to)) return;
    e.preventDefault();
    if (offlineNav()) return;
    try { performance.clearMarks(MARK_TAP); performance.clearMeasures(MEASURE_TAB); performance.mark(MARK_TAP); } catch { /* метки необязательны */ }
    // подсветка новой вкладки — синхронно, до снимка View Transition: обратная связь в первом же кадре
    flushSync(() => setOptimistic({ path: pathname, to }));
    const ss = session();
    writeScroll(ss, NAV_TABS[active].id, window.scrollY);
    const tab = NAV_TABS[to];
    let resolve: () => void = () => {};
    const ready = new Promise<void>((r) => { resolve = r; });
    pending.current = { tab: tab.id, y: readScroll(ss, tab.id), resolve };
    runTabTransition(navDir(active, to), () => router.push(tabHref(tab), { scroll: false }), () => ready);
  };
  return (
    <nav className="ps-tabbar" aria-label="Разделы" data-tour="nav">
      {NAV_TABS.map((n, i) => {
        const dot = n.id === 'stats' && offer !== null;
        return (
          <Link
            key={n.href} href={tabHref(n)} className="ps-tab" aria-current={i === shown ? 'page' : undefined}
            onClick={(e: MouseEvent<HTMLAnchorElement>) => onTab(e, i)} onTouchStart={() => warmData(i)} onMouseEnter={() => warmData(i)}
            aria-label={dot ? `${n.label}, доступны Итоги года` : undefined}
          >
            <span className="ps-tab__ico">
              <Icon name={n.icon} size={20} />
              {dot && <span className="ps-notify-dot" aria-hidden="true" />}
            </span>
            <span>{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
