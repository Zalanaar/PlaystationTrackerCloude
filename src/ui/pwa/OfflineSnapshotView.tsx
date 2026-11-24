'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { OfflineGame, OfflinePlan, OfflineSnapshot } from '@/shared/offline-snapshot';
import { readOfflineSnapshot } from './offline-data';
import {
  asOfLabel, backlogView, COLLECTION_FILTERS, filterCounts, filterGames, hoursText, approxText, MONTHS_SHORT_NOM, OFFLINE_TABS, PLAN_KIND_LABEL, planRangeText, planSummary, tabFromPath, trophiesText,
  type CollectionFilter, type OfflineTab,
} from './offline-view';

const PAGE = 60;
const STATUS_LABEL: Record<string, string> = { playing: 'Играю', completed: 'Пройдено', backlog: 'Бэклог', dropped: 'Брошено', shelved: 'Отложено', service: 'Сервис' };

/**
 * Пакет 7, п. 2 + критика п.6: экран /offline. Есть сохранённая копия активного профиля — показываем коллекцию, бэклог, план и статистику года
 * только для просмотра, с пометкой «Данные от …». Копии нет (или Cache Storage недоступен) — прежняя заглушка `stub`.
 */
export function OfflineSnapshotView({ stub, retry }: { stub: ReactNode; retry: ReactNode }) {
  const [snap, setSnap] = useState<OfflineSnapshot | null | undefined>(undefined);
  const [tab, setTab] = useState<OfflineTab>('collection');
  const [now, setNow] = useState(0);
  useEffect(() => {
    let alive = true;
    void readOfflineSnapshot().then((s) => {
      if (!alive) return;
      // вкладка — по адресу, который открывали без сети; «сейчас» — для года в пометке «Данные от …»
      setTab(tabFromPath(window.location.pathname));
      setNow(Date.now());
      setSnap(s);
    });
    return () => { alive = false; };
  }, []);

  if (!snap) return <main className="ps-offline">{stub}{retry}<p className="ps-offline__logo ps-micro">PS TRACKER</p></main>;

  return (
    <main className="ps-offline ps-offline--data" data-testid="offline-snapshot">
      <header className="ps-offline__head">
        <div className="ps-offline__headtx">
          <h1 className="ps-h1 ps-offline__title">Нет сети</h1>
          <p className="ps-offline__sub">
            Сохранённая копия, только просмотр{snap.onlineId ? <> · <span className="ps-offline__who">{snap.onlineId}</span></> : null}
          </p>
          <p className="ps-offline__asof" data-testid="offline-asof" role="status">{asOfLabel(snap.generatedAt, now)}</p>
        </div>
        <div className="ps-offline__headact">{retry}</div>
      </header>
      <div className="ps-offline__tabs" role="tablist" aria-label="Разделы сохранённой копии">
        {OFFLINE_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="ps-offline__tab" onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" className="ps-offline__panel" aria-label={OFFLINE_TABS.find((t) => t.id === tab)?.label}>
        {tab === 'collection' ? <CollectionPanel s={snap} /> : tab === 'backlog' ? <BacklogPanel s={snap} /> : tab === 'plan' ? <PlanPanel plan={snap.plan} /> : <StatsPanel s={snap} />}
      </div>
    </main>
  );
}

function GameRow({ g, extra }: { g: OfflineGame; extra?: string | null }) {
  const [failed, setFailed] = useState(false);
  const tr = trophiesText(g.trophies);
  const meta = [g.status ? STATUS_LABEL[g.status] : 'Без статуса', g.platform, g.hours > 0 ? hoursText(g.hours) : null, tr, extra].filter(Boolean).join(' · ');
  return (
    <li className="ps-offline__game" data-testid="offline-game">
      {g.coverUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- обложка с CDN PSN; без сети не загрузится, тогда заглушка
        <img className="ps-offline__cover" src={g.coverUrl} alt="" width={40} height={40} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : <span className="ps-offline__cover ps-offline__cover--empty" aria-hidden="true">{g.title.slice(0, 1)}</span>}
      <span className="ps-offline__gtx">
        <span className="ps-offline__gname">{g.title}</span>
        <span className="ps-offline__gmeta">{meta}</span>
      </span>
    </li>
  );
}

function More({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return <button type="button" className="ps-btn ps-btn--ghost ps-offline__more" onClick={onMore}>Показать ещё {Math.min(PAGE, total - shown)}</button>;
}

function CollectionPanel({ s }: { s: OfflineSnapshot }) {
  const [f, setF] = useState<CollectionFilter>('all');
  const [shown, setShown] = useState(PAGE);
  const counts = useMemo(() => filterCounts(s.games), [s]);
  const list = useMemo(() => filterGames(s.games, f), [s, f]);
  return (
    <>
      <div className="ps-offline__chips" role="group" aria-label="Фильтр по статусу">
        {COLLECTION_FILTERS.filter((x) => x.id === 'all' || counts[x.id] > 0).map((x) => (
          <button key={x.id} type="button" className="ps-offline__chip" aria-pressed={f === x.id} onClick={() => { setF(x.id); setShown(PAGE); }}>
            {x.label} <span className="num">{counts[x.id]}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? <p className="ps-offline__empty">Игр нет.</p> : (
        <ul className="ps-offline__list">{list.slice(0, shown).map((g) => <GameRow key={g.id} g={g} />)}</ul>
      )}
      <More shown={shown} total={list.length} onMore={() => setShown((n) => n + PAGE)} />
    </>
  );
}

function BacklogPanel({ s }: { s: OfflineSnapshot }) {
  const [shown, setShown] = useState(PAGE);
  const v = useMemo(() => backlogView(s), [s]);
  if (v.items.length === 0) return <p className="ps-offline__empty">Бэклог пуст.</p>;
  return (
    <>
      <p className="ps-offline__sum" data-testid="offline-backlog-sum">
        {v.items.length} в бэклоге{v.knownHours > 0 ? ` · ≈ ${approxText(v.knownHours)}` : ''}{v.unknown > 0 ? ` · без длительности: ${v.unknown}` : ''}
      </p>
      <ul className="ps-offline__list">
        {v.items.slice(0, shown).map((g) => <GameRow key={g.id} g={g} extra={g.durationHours !== null ? `≈ ${approxText(g.durationHours)} на прохождение` : null} />)}
      </ul>
      <More shown={shown} total={v.items.length} onMore={() => setShown((n) => n + PAGE)} />
    </>
  );
}

function StatsPanel({ s }: { s: OfflineSnapshot }) {
  const hId = useId();
  const st = s.stats;
  const max = Math.max(1, ...st.hoursByMonth.map((h) => h ?? 0));
  const tiles: [string, string][] = [
    ['Игр', String(s.totals.games)],
    ['Часов всего', hoursText(s.totals.hours)],
    ['Трофеев', String(s.totals.trophiesEarned)],
    ['Платин', String(s.totals.platinumEarned)],
  ];
  const year: [string, string][] = [
    ['Пройдено', String(st.completed)],
    ['Брошено', String(st.dropped)],
    ['Часов', hoursText(st.hours)],
    ['Платин', String(st.platinum)],
  ];
  return (
    <>
      <dl className="ps-offline__tiles" aria-label="За всё время">
        {tiles.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="num">{v}</dd></div>)}
      </dl>
      <h2 className="ps-offline__h2" id={hId}>{st.year} год</h2>
      <dl className="ps-offline__tiles" aria-labelledby={hId}>
        {year.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="num">{v}</dd></div>)}
      </dl>
      <div className="ps-offline__bars" role="img" aria-label={`Часы по месяцам ${st.year}: ${st.hoursByMonth.map((h, i) => `${MONTHS_SHORT_NOM[i]} ${hoursText(h)}`).join(', ')}`}>
        {st.hoursByMonth.map((h, i) => (
          <span key={i} className="ps-offline__bar"><i style={{ height: `${Math.round(((h ?? 0) / max) * 100)}%` }} /><b>{MONTHS_SHORT_NOM[i].slice(0, 1)}</b></span>
        ))}
      </div>
      {st.topByHours.length > 0 && (
        <>
          <h2 className="ps-offline__h2">Больше всего часов за год</h2>
          <ol className="ps-offline__top">
            {st.topByHours.map((x, i) => <li key={i}><span>{x.title}</span><span className="num">{hoursText(x.hours)}</span></li>)}
          </ol>
        </>
      )}
    </>
  );
}

function PlanPanel({ plan }: { plan: OfflinePlan | undefined }) {
  const [shown, setShown] = useState(PAGE);
  if (!plan || plan.items.length === 0) {
    return (
      <>
        {plan ? <p className="ps-offline__sum" data-testid="offline-plan-sum">{planSummary(plan)}</p> : null}
        <p className="ps-offline__empty">В сохранённой копии плана нет.</p>
      </>
    );
  }
  return (
    <>
      <p className="ps-offline__sum" data-testid="offline-plan-sum">
        {planSummary(plan)}{plan.notFit > 0 ? ` · не влезли: ${plan.notFit}` : ''}
      </p>
      <ul className="ps-offline__list">
        {plan.items.slice(0, shown).map((g, i) => {
          const range = planRangeText(g.start, g.end);
          const extra = [PLAN_KIND_LABEL[g.kind], range, g.hours != null ? hoursText(g.hours) : null].filter(Boolean).join(' · ');
          return (
            <li key={`${g.title}-${g.start}-${i}`} className="ps-offline__game" data-testid="offline-plan-item">
              {g.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- обложка с CDN; без сети может не загрузиться
                <img className="ps-offline__cover" src={g.coverUrl} alt="" width={40} height={40} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              ) : <span className="ps-offline__cover ps-offline__cover--empty" aria-hidden="true">{g.title.slice(0, 1)}</span>}
              <span className="ps-offline__gtx">
                <span className="ps-offline__gname">{g.title}</span>
                <span className="ps-offline__gmeta">{extra}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <More shown={shown} total={plan.items.length} onMore={() => setShown((n) => n + PAGE)} />
    </>
  );
}
