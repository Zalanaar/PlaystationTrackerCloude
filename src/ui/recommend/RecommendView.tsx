'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import '../recommend.css';
import { BacklogMode } from './BacklogMode';
import { DiscoverMode } from './DiscoverMode';
import { DISCOVER_SUB, pageHref, parseTab, TABS, type TabValue } from './discover-model';
import { candidatesText, parseTime, type TimeValue } from './model';

/**
 * Экран «Подскажи» (/recommend): вкладки «Из бэклога» и «У тебя нет» (`?tab=discover`, спека Фазы 31, 12.1).
 * Вкладка монтируется при первом выборе и дальше остаётся в памяти (скрыта). Подборка «У тебя нет» запрашивается при первом открытии.
 */
export function RecommendView() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTabState] = useState<TabValue>(() => parseTab(params.get('tab')));
  const [visited, setVisited] = useState<ReadonlySet<TabValue>>(() => new Set([parseTab(params.get('tab'))]));
  const [cands, setCands] = useState<{ n: number | null; total: number | null }>({ n: null, total: null });
  const setCandidates = useCallback((n: number | null, total: number | null) => setCands((c) => (c.n === n && c.total === total ? c : { n, total })), []);
  const [announce, setAnnounce] = useState('');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabRef = useRef(tab);
  const timeRef = useRef<TimeValue>(parseTime(params.get('time')));

  // лишние и устаревшие параметры убираются при открытии (`mode`, неизвестный `tab`, `time` на вкладке «У тебя нет»)
  useEffect(() => {
    const rawTab = params.get('tab');
    const dirty = params.get('mode') !== null || (rawTab !== null && rawTab !== 'discover') || (parseTab(rawTab) === 'discover' && params.get('time') !== null);
    if (!dirty) return;
    if (parseTab(rawTab) === 'discover') timeRef.current = 'any';
    router.replace(pageHref(parseTab(rawTab), timeRef.current), { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- нормализация адреса только при открытии страницы
  }, []);

  const pick = useCallback((t: TabValue) => {
    if (t === tabRef.current) return;
    tabRef.current = t;
    setTabState(t);
    setVisited((s) => new Set(s).add(t));
    setAnnounce(`Вкладка: ${TABS.find((o) => o.value === t)?.label ?? ''}`);
    router.replace(pageHref(t, timeRef.current), { scroll: false });
  }, [router]);

  const onTime = useCallback((t: TimeValue) => { timeRef.current = t; }, []);

  const onKey = (e: KeyboardEvent, i: number) => {
    const n = TABS.length;
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    pick(TABS[to].value);
    tabs.current[to]?.focus();
  };

  const sub = tab === 'discover' ? DISCOVER_SUB : cands.n !== null ? candidatesText(cands.n, cands.total) : null;

  return (
    <div className="ps-rec-page">
      <div className="ps-pagehead ps-rec-head">
        <h1 className="ps-h1">Подскажи</h1>
        {sub && <p className="ps-rec-sub">{sub}</p>}
      </div>
      <div className="ps-seg ps-rec-modes" role="tablist" aria-label="Режим подсказок">
        {TABS.map((o, i) => (
          <button
            key={o.value} type="button" role="tab" id={`rec-tab-${o.value}`} aria-selected={tab === o.value} aria-controls={`rec-panel-${o.value}`}
            tabIndex={tab === o.value ? 0 : -1} ref={(el) => { tabs.current[i] = el; }} onClick={() => pick(o.value)} onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="ps-rec-sr" aria-live="polite">{announce}</div>
      {visited.has('backlog') && <BacklogMode active={tab === 'backlog'} onCandidates={setCandidates} onTime={onTime} />}
      {visited.has('discover') && <DiscoverMode active={tab === 'discover'} onBacklog={() => pick('backlog')} />}
    </div>
  );
}
