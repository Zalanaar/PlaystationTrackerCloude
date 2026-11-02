'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useIsOwner } from '../access/useIsOwner';
import { useOtherCount } from '../other-platforms/countStore';
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
import { StatusDialogs, StatusMenuItems, useStatusMenu } from '../backup/StatusMenu';
import { SyncIndicator } from './SyncIndicator';
import { NAV_TABS } from '../tokens';
import { useSeasonOffer } from '../wrapped/useSeason';
import { isTabActive } from './nav';
import { ThemeList, ThemePicker } from './ThemePicker';

const RestoreFileDialog = dynamic(() => import('../backup/RestoreFileDialog').then((m) => m.RestoreFileDialog), { ssr: false });

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
  const { openPanel } = useSync();
  const { busy, logout, logoutAll } = useLogout();
  const [more, setMore] = useState(false);
  const [restore, setRestore] = useState(false);
  const statusMenu = useStatusMenu();
  const { profile } = useProfile();
  const { profiles, activeProfileId } = usePsnProfiles();
  const psnNick = profiles.length >= 2 ? (profiles.find((p) => p.id === activeProfileId)?.onlineId ?? null) : null;
  const line = profile ? profileLine(profile) : null;
  const offer = useSeasonOffer();
  const isOwner = useIsOwner();
  const otherCount = useOtherCount();
  const { start: startTour } = useTour();
  const install = useInstall();
  const { open: openWhatsNew } = useWhatsNew();

  return (
    <>
      <header className="ps-header">
        <div className="ps-header__in ps-container">
          <Link href="/" className="ps-logo">PS TRACKER</Link>
          <nav className="ps-nav" aria-label="Разделы" data-tour="nav">
            {NAV_TABS.map((n) => {
              const dot = n.id === 'stats' && offer !== null;
              return (
                <Link
                  key={n.href} href={n.href} className="ps-nav-item" aria-current={isTabActive(pathname, n) ? 'page' : undefined}
                  aria-label={dot ? `${n.label}, доступны Итоги года` : undefined}
                >
                  {n.label}
                  {dot && <span className="ps-notify-dot" aria-hidden="true" />}
                </Link>
              );
            })}
          </nav>
          <div className="ps-header__right">
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
                    <button type="button" role="menuitem" className="ps-menu-item" onClick={() => { close(); startTour(); }}>
                      <Icon name="circle-help" size={16} />
                      <span className="ps-menu-item__label">Как пользоваться</span>
                    </button>
                    <button type="button" role="menuitem" className="ps-menu-item" data-testid="menu-whats-new" onClick={() => { close(); setTimeout(openWhatsNew, 0); }}>
                      <Icon name="info" size={16} />
                      <span className="ps-menu-item__label">Что нового</span>
                    </button>
                    <Link href="/?hidden=1" role="menuitem" className="ps-menu-item" onClick={close}>
                      <Icon name="eye-off" size={16} />
                      <span className="ps-menu-item__label">Скрытые игры</span>
                    </Link>
                    <Link href="/other-platforms" role="menuitem" className="ps-menu-item" data-testid="profile-menu-other" onClick={close}>
                      <Icon name="library" size={16} />
                      <span className="ps-menu-item__label">Играл на другой платформе</span>
                      {otherCount !== null && <small className="num ps-menu-item__count">{otherCount}</small>}
                    </Link>
                    <Link href="/profiles" role="menuitem" className="ps-menu-item" onClick={close}>
                      <Icon name="users" size={16} />
                      <span className="ps-menu-item__label">PSN-профили</span>
                    </Link>
                    <a href="/api/backup" download role="menuitem" className="ps-menu-item" onClick={close}>
                      <Icon name="download" size={16} />
                      <span className="ps-menu-item__label">Скачать копию</span>
                    </a>
                    <button type="button" role="menuitem" className="ps-menu-item" onClick={() => { close(); setRestore(true); }}>
                      <Icon name="upload" size={16} />
                      <span className="ps-menu-item__label">Восстановить из файла</span>
                    </button>
                    <StatusMenuItems m={statusMenu} close={close} menu />
                    {isOwner && (
                      <Link href="/access" role="menuitem" className="ps-menu-item" onClick={close}>
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
          <div role="menu" className="ps-list"><ThemeList onPick={() => setMore(false)} /></div>
          <p className="ps-micro">Аккаунт</p>
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
          <button type="button" className="ps-menu-item" onClick={() => { setMore(false); openPanel(); }}>
            <Icon name="refresh" size={16} /><span className="ps-menu-item__label">Синк с PSN</span>
          </button>
          <Link href="/?hidden=1" className="ps-menu-item" onClick={() => setMore(false)}>
            <Icon name="eye-off" size={16} /><span className="ps-menu-item__label">Скрытые игры</span>
          </Link>
          <Link href="/other-platforms" className="ps-menu-item ps-menu-item--tall" data-testid="more-menu-other" onClick={() => setMore(false)}>
            <Icon name="library" size={16} /><span className="ps-menu-item__label">Играл на другой платформе</span>
          </Link>
          <Link href="/profiles" className="ps-menu-item" onClick={() => setMore(false)}>
            <Icon name="users" size={16} /><span className="ps-menu-item__label">PSN-профили</span>
          </Link>
          <a href="/api/backup" download className="ps-menu-item" onClick={() => setMore(false)}>
            <Icon name="download" size={16} /><span className="ps-menu-item__label">Скачать копию</span>
          </a>
          <button type="button" className="ps-menu-item" onClick={() => { setMore(false); setRestore(true); }}>
            <Icon name="upload" size={16} /><span className="ps-menu-item__label">Восстановить из файла</span>
          </button>
          {more && <StatusMenuItems m={statusMenu} close={() => setMore(false)} menu={false} />}
          {isOwner && (
            <Link href="/access" className="ps-menu-item" onClick={() => setMore(false)}>
              <Icon name="users" size={16} /><span className="ps-menu-item__label">Доступ</span>
            </Link>
          )}
          {isOwner && (
            <Link href="/health" className="ps-menu-item" onClick={() => setMore(false)}>
              <Icon name="shield-alert" size={16} /><span className="ps-menu-item__label">Здоровье</span>
            </Link>
          )}
          <button type="button" className="ps-menu-item" onClick={() => void logout()} disabled={busy}>
            <Icon name="logout" size={16} /><span className="ps-menu-item__label">Выйти</span>
          </button>
          <button type="button" className="ps-menu-item" data-testid="sheet-logout-all" onClick={() => void logoutAll()} disabled={busy}>
            <Icon name="logout" size={16} /><span className="ps-menu-item__label">Выйти на всех устройствах</span>
          </button>
        </div>
      </Sheet>
      <RestoreFileDialog open={restore} onClose={() => setRestore(false)} />
      <StatusDialogs m={statusMenu} />
    </>
  );
}

export function TabBar() {
  const pathname = usePathname();
  const offer = useSeasonOffer();
  return (
    <nav className="ps-tabbar" aria-label="Разделы" data-tour="nav">
      {NAV_TABS.map((n) => {
        const dot = n.id === 'stats' && offer !== null;
        return (
          <Link
            key={n.href} href={n.href} className="ps-tab" aria-current={isTabActive(pathname, n) ? 'page' : undefined}
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
