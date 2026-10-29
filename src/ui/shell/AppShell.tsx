'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon, StatusGlyph, type IconName } from '../icons';
import { Avatar } from '../primitives/Avatar';
import { Popover } from '../primitives/Popover';
import { profileLine } from '../profile/model';
import { useProfile } from '../profile/ProfileProvider';
import { Sheet } from '../primitives/Sheet';
import { useSync } from '../sync/SyncProvider';
import { SyncIndicator } from './SyncIndicator';
import { ThemeList, ThemePicker } from './ThemePicker';

export const NAV: readonly { href: string; label: string; icon: IconName; short?: string }[] = [
  { href: '/', label: 'Коллекция', icon: 'library' },
  { href: '/backlog', label: 'Бэклог', icon: 'bookmark' },
  { href: '/roadmap', label: 'План', icon: 'roadmap' },
  { href: '/recommend', label: 'Подскажи', icon: 'lightbulb' },
  { href: '/stats', label: 'Статистика', icon: 'bar-chart', short: 'Стат.' },
  { href: '/wrapped', label: 'Итоги', icon: 'sparkles' },
];

export function isActiveNav(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function useLogout() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }
  return { busy, logout };
}

export function AppHeader() {
  const pathname = usePathname();
  const { openPanel } = useSync();
  const { busy, logout } = useLogout();
  const [more, setMore] = useState(false);
  const { profile } = useProfile();
  const line = profile ? profileLine(profile) : null;

  return (
    <>
      <header className="ps-header">
        <div className="ps-header__in ps-container">
          <Link href="/" className="ps-logo">PS TRACKER</Link>
          <nav className="ps-nav" aria-label="Разделы">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="ps-nav-item" aria-current={isActiveNav(pathname, n.href) ? 'page' : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ps-header__right">
            <SyncIndicator />
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
                        </span>
                      </div>
                    )}
                    <Link href="/triage" role="menuitem" className="ps-menu-item" onClick={close}>
                      <StatusGlyph status="none" size={16} />
                      <span className="ps-menu-item__label">Разобрать игры</span>
                    </Link>
                    <Link href="/?hidden=1" role="menuitem" className="ps-menu-item" onClick={close}>
                      <Icon name="eye-off" size={16} />
                      <span className="ps-menu-item__label">Скрытые игры</span>
                    </Link>
                    <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--sep" onClick={() => void logout()} disabled={busy}>
                      <Icon name="logout" size={16} />
                      <span className="ps-menu-item__label">Выйти</span>
                    </button>
                  </>
                )}
              </Popover>
            </div>
            <button type="button" className="ps-iconbtn ps-mobile-only" aria-label="Меню" onClick={() => setMore(true)}>
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
              </span>
            </div>
          )}
          <p className="ps-micro">Тема</p>
          <div role="menu" className="ps-list"><ThemeList onPick={() => setMore(false)} /></div>
          <p className="ps-micro">Аккаунт</p>
          <Link href="/triage" className="ps-menu-item" onClick={() => setMore(false)}>
            <StatusGlyph status="none" size={16} /><span className="ps-menu-item__label">Разобрать игры</span>
          </Link>
          <button type="button" className="ps-menu-item" onClick={() => { setMore(false); openPanel(); }}>
            <Icon name="refresh" size={16} /><span className="ps-menu-item__label">Синк с PSN</span>
          </button>
          <Link href="/?hidden=1" className="ps-menu-item" onClick={() => setMore(false)}>
            <Icon name="eye-off" size={16} /><span className="ps-menu-item__label">Скрытые игры</span>
          </Link>
          <button type="button" className="ps-menu-item" onClick={() => void logout()} disabled={busy}>
            <Icon name="logout" size={16} /><span className="ps-menu-item__label">Выйти</span>
          </button>
        </div>
      </Sheet>
    </>
  );
}

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="ps-tabbar" aria-label="Разделы">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} className="ps-tab" aria-label={n.short ? n.label : undefined} aria-current={isActiveNav(pathname, n.href) ? 'page' : undefined}>
          <Icon name={n.icon} size={20} />
          {n.short ? <><span className="ps-tab__full" aria-hidden="true">{n.label}</span><span className="ps-tab__short" aria-hidden="true">{n.short}</span></> : <span>{n.label}</span>}
        </Link>
      ))}
    </nav>
  );
}
