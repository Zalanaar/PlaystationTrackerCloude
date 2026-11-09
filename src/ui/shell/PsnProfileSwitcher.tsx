'use client';

import Link from '@/ui/IntentLink'; // Пакет 6: без предзагрузки по экрану, по намерению
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../icons';
import { initialOf } from '../profiles/model';
import { Spinner } from '../profiles/Spinner';
import { usePsnProfiles } from '../profiles/PsnProfileProvider';
import type { LightProfile } from '../profiles/api';
import { useIsMobile } from '../primitives/hooks';
import { Popover } from '../primitives/Popover';
import { Sheet } from '../primitives/Sheet';

const nickText = (p: LightProfile) => p.onlineId ?? 'Без ника';

/** Стрелки, Home/End по пунктам; Tab закрывает меню (§17.1). `arrows=false`: стрелки уже обрабатывает Popover. */
function menuKeys(e: KeyboardEvent<HTMLElement>, arrows: boolean, close: () => void): void {
  if (e.key === 'Tab') { close(); return; }
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]'));
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  else if (arrows && e.key === 'ArrowDown') next = (i + 1) % items.length;
  else if (arrows && e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
  if (next >= 0) { e.preventDefault(); items[next].focus(); }
}

function Items({ onPick }: { onPick: () => void }) {
  const { profiles, activeProfileId, switchTo } = usePsnProfiles();
  return (
    <>
      {profiles.map((p) => {
        const active = p.id === activeProfileId;
        return (
          <button
            key={p.id} type="button" role="menuitemradio" aria-checked={active} className="ps-menu-item ps-pswitch__item"
            onClick={() => { onPick(); if (!active) void switchTo(p.id); }}
          >
            <span className="ps-pswitch__ini ps-pswitch__ini--lg" aria-hidden="true">{initialOf(p.onlineId)}</span>
            <span className="ps-pswitch__nick" title={nickText(p)}>
              {nickText(p)}
              {p.isPrimary && <small className="ps-pswitch__tag"> основной</small>}
            </span>
            {active && <Icon name="check" size={16} className="ps-pswitch__check" />}
          </button>
        );
      })}
    </>
  );
}

/** Переключатель «Профиль PSN» в шапке (§17.1). В DOM только при двух и более профилях. */
export function PsnProfileSwitcher() {
  const { profiles, activeProfileId, switching } = usePsnProfiles();
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState(false);
  const chipRef = useRef<HTMLButtonElement | null>(null);

  if (profiles.length < 2) return null;
  const active = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const nick = nickText(active);
  const busy = switching !== null;

  const chip = (p: { onClick?: () => void; 'aria-expanded'?: boolean; 'aria-controls'?: string; 'aria-haspopup'?: 'menu' }) => (
    <button
      type="button" ref={chipRef} className="ps-pswitch" disabled={busy}
      aria-label={`Профиль PSN: ${nick}. Сменить`} aria-busy={busy || undefined}
      aria-haspopup="menu" aria-expanded={p['aria-expanded'] ?? sheet} aria-controls={p['aria-controls']}
      onClick={p.onClick ?? (() => setSheet(true))}
      onKeyDown={(e) => { if (e.key === 'ArrowDown' && p.onClick && !p['aria-expanded']) { e.preventDefault(); p.onClick(); } }}
    >
      <span className="ps-pswitch__ini" aria-hidden="true">{initialOf(active.onlineId)}</span>
      <span className="ps-pswitch__nick" title={nick}>{nick}</span>
      {busy
        ? <Spinner size={14} />
        : <Icon name="chevron-down" size={14} className="ps-pswitch__chev" />}
    </button>
  );

  if (mobile) {
    return (
      <>
        {chip({})}
        <Sheet open={sheet && mobile} onClose={() => setSheet(false)} title="Профиль PSN" className="ps-pswitch-sheet">
          <MobileList onClose={() => setSheet(false)} />
        </Sheet>
      </>
    );
  }
  return (
    <Popover align="end" className="ps-pswitch-pop" trigger={(p) => chip(p)}>
      {(close) => (
        <div onKeyDown={(e) => menuKeys(e, false, close)}>
          <p className="ps-pswitch__head" role="presentation">Профиль PSN</p>
          <Items onPick={close} />
          <Link href="/profiles" role="menuitem" className="ps-menu-item ps-menu-item--sep" onClick={close}>
            <Icon name="users" size={16} /><span className="ps-menu-item__label">Управлять профилями</span>
          </Link>
        </div>
      )}
    </Popover>
  );
}

function MobileList({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // после того, как Sheet сфокусировал диалог
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="ps-stack">
      <div ref={ref} role="menu" aria-label="Профиль PSN" className="ps-list" onKeyDown={(e) => { if (e.key !== 'Tab') menuKeys(e, true, onClose); }}>
        <Items onPick={onClose} />
      </div>
      <Link href="/profiles" className="ps-btn ps-btn--ghost ps-pswitch__manage" onClick={onClose}>
        <Icon name="users" size={16} />Управлять профилями
      </Link>
    </div>
  );
}
