'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import Link from '@/ui/IntentLink';
import type { ChecklistResponse } from '@/server/checklist/checklist';
import { week1HintCookie } from '@/shared/week1-hint';
import { Icon } from '../icons';
import { Sheet } from '../primitives/Sheet';
import { useInstall } from '../pwa/InstallPrompt';
import { readInstall } from '../pwa/install-store';
import { ThemeSwatches } from '../shell/ThemePicker';
import { useSync } from '../sync/SyncProvider';
import { THEME_STORAGE_KEY } from '../tokens';
import { dismissChecklistApi, fetchChecklist } from './api';
import { checklistItems, daysLeft, progressText, type ClientFlags, type Item } from './model';

function readFlags(pwaAvailable: boolean): ClientFlags {
  let themeChosen = false;
  try { themeChosen = !!window.localStorage.getItem(THEME_STORAGE_KEY); } catch { /* приватный режим */ }
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return { themeChosen, pwaInstalled: standalone || readInstall()?.done === true, pwaAvailable };
}

/**
 * П13.4: «Первая неделя» на главной — короткий чек-лист нового пользователя (7 дней от онбординга): синк, статусы, HLTB,
 * тема, установка на экран «Домой», Telegram. Пункты считаются по данным; «Скрыть» — насовсем, на всех устройствах.
 * Высота постоянная (один ряд пунктов с прокруткой); место под карточку по cookie-подсказке `ps-week1` — без сдвига.
 */
export function FirstWeekCard({ hint }: { hint: boolean | undefined }) {
  const hid = useId();
  const sync = useSync();
  const install = useInstall();
  const [data, setData] = useState<ChecklistResponse | null>(null);
  const [flags, setFlags] = useState<ClientFlags | null>(null);
  const [left, setLeft] = useState(0);
  const [gone, setGone] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetchChecklist(ac.signal).then(
      (r) => {
        if (ac.signal.aborted) return;
        setData(r);
        setLeft(daysLeft(r.endsAt, Date.now()));
        setFlags(readFlags(install.available));
        if (r.show !== hint) document.cookie = week1HintCookie(r.show);
      },
      () => { if (!ac.signal.aborted) setGone(true); },
    );
    return () => ac.abort();
  }, [hint, install.available]);

  const dismiss = useCallback(() => {
    setGone(true);
    document.cookie = week1HintCookie(false);
    void dismissChecklistApi().catch(() => {});
  }, []);

  if (gone || (data && (!data.show || !data.items))) return null;
  if (!data || !data.items || !flags) {
    return hint ? <div className="ps-week1 ps-week1--sk" aria-hidden="true"><div className="ps-skeleton ps-week1__sk" /></div> : null;
  }
  const list = checklistItems(data.items, flags);
  const all = list.every((i) => i.done);
  const action = (i: Item) => {
    const inner = <><Icon name="plus-circle" size={16} /><span>{i.label}</span></>;
    switch (i.id) {
      case 'statuses': return <Link href="/triage" className="ps-week1__item">{inner}</Link>;
      case 'hltb': return <Link href="/backlog" className="ps-week1__item">{inner}</Link>;
      case 'theme': return <button type="button" className="ps-week1__item" aria-haspopup="dialog" onClick={() => setThemeOpen(true)}>{inner}</button>;
      case 'pwa': return <button type="button" className="ps-week1__item" aria-haspopup="dialog" onClick={() => install.open()}>{inner}</button>;
      default: return <button type="button" className="ps-week1__item" aria-haspopup="dialog" onClick={() => sync.openPanel()}>{inner}</button>;
    }
  };
  return (
    <section className="ps-week1" aria-labelledby={hid} data-testid="week1">
      <div className="ps-week1__head">
        <h2 id={hid} className="ps-week1__t">{all ? 'Первая неделя: всё готово' : 'Первая неделя'}</h2>
        <span className="ps-week1__p num" data-testid="week1-progress">{progressText(list)} · ещё {left} дн.</span>
        <button type="button" className="ps-btn ps-btn--icon ps-week1__x" aria-label="Скрыть «Первую неделю»" onClick={dismiss}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <ul className="ps-week1__list" aria-label="Что сделать">
        {list.map((i) => (
          <li key={i.id} data-item={i.id} data-done={i.done || undefined}>
            {i.done ? (
              <span className="ps-week1__item ps-week1__item--done"><Icon name="check-circle" size={16} /><span>{i.label}</span><span className="ps-sr"> — готово</span></span>
            ) : action(i)}
          </li>
        ))}
      </ul>
      <Sheet open={themeOpen} onClose={() => { setThemeOpen(false); setFlags(readFlags(install.available)); }} title="Тема">
        <div className="ps-stack">
          <ThemeSwatches />
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => { setThemeOpen(false); setFlags(readFlags(install.available)); }}>Готово</button>
        </div>
      </Sheet>
    </section>
  );
}
