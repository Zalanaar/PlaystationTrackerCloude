'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon, type IconName } from '../icons';
import { Popover } from '../primitives/Popover';
import { Sheet } from '../primitives/Sheet';
import { useSync } from '../sync/SyncProvider';
import { SyncIndicator } from './SyncIndicator';
import { ThemeList, ThemePicker } from './ThemePicker';

export const NAV: readonly { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Коллекция', icon: 'library' },
  { href: '/backlog', label: 'Бэклог', icon: 'bookmark' },
  { href: '/stats', label: 'Статистика', icon: 'bar-chart' },
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

  return (
    <>
      <header className="ps-header">
        <div className="ps-header__in ps-container">
          <Link href="/" className="ps-logo">PS TRACKER</Link>
          <nav className="ps-nav" aria-label="Разделы">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="ps-nav-item" aria-current={isActiveNav(pathname, n.href) ? 'page' : undefined}>
                <Icon name={n.icon} size={16} className="ps-nav-item__icon" />
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ps-header__right">
            <SyncIndicator />
            <div className="ps-desktop-only"><ThemePicker /></div>
            <div className="ps-desktop-only">
              <Popover
                align="end"
                trigger={(p) => (
                  <button type="button" className="ps-avatar" aria-label="Меню профиля" {...p}>А</button>
                )}
              >
                {() => (
                  <button type="button" role="menuitem" className="ps-menu-item" onClick={() => void logout()} disabled={busy}>
                    <Icon name="logout" size={16} />
                    <span className="ps-menu-item__label">Выйти</span>
                  </button>
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
          <p className="ps-micro">Тема</p>
          <div role="menu" className="ps-list"><ThemeList onPick={() => setMore(false)} /></div>
          <p className="ps-micro">Аккаунт</p>
          <button type="button" className="ps-menu-item" onClick={() => { setMore(false); openPanel(); }}>
            <Icon name="refresh" size={16} /><span className="ps-menu-item__label">Синк с PSN</span>
          </button>
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
        <Link key={n.href} href={n.href} className="ps-tab" aria-current={isActiveNav(pathname, n.href) ? 'page' : undefined}>
          <Icon name={n.icon} size={20} />
          <span>{n.label}</span>
        </Link>
      ))}
    </nav>
  );
}
