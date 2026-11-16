'use client';

import Link from '@/ui/IntentLink'; // Пакет 6: без предзагрузки по экрану, по намерению
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDataRefresh } from '../shell/refresh';
import type { FeedItem, FeedPeriod, FeedResponse, NearListResponse } from '@/server/trophies/types';
import { cachedGet } from '../data/http';
import { SkRoot } from '../skeletons';
import { RareIcon, TypeBadge } from '../stats/RareTrophies';
import { Icon } from '../icons';
import { collapseRuns, runLine, runRarest, type FeedEntry, emptyText, FEED_PERIODS, feedUrl, gameLine, groupFeed, mergePages, EASY_HINT, NEAR_SORTS, NEAR_URL, nearPageUrl, nearSummary, RARE_CHIP, rarityTone, rateText, summaryParts, viewUrl, type NearSort, type TrophiesView } from './model';
import { NearList } from './NearList';
import { LevelCard, LevelCardSkeleton } from './LevelCard';
import type { LevelResponse } from '@/server/trophies/level-query';
import { useChipRow } from '../primitives/useChipRow';

type Load = 'idle' | 'loading' | 'error';

/** Пакет 6, п. 9: «Лента» / «Почти платина». */
function ViewSwitch({ view, onView }: { view: TrophiesView; onView: (v: TrophiesView) => void }) {
  return (
    <div className="ps-seg ps-tf__view" role="group" aria-label="Раздел" data-testid="tf-view">
      <button type="button" aria-pressed={view === 'feed'} onClick={() => onView('feed')}>Лента</button>
      <button type="button" aria-pressed={view === 'near'} onClick={() => onView('near')} data-testid="tf-view-near">Почти платина</button>
    </div>
  );
}

function Head({ period, rare, data, onPeriod, onRare, busy }: {
  period: FeedPeriod; rare: boolean; data: FeedResponse | null; busy: boolean; onPeriod: (p: FeedPeriod) => void; onRare: () => void;
}) {
  const head = FEED_PERIODS.find((p) => p.id === period)?.head ?? '';
  const row = useChipRow<HTMLDivElement>(); // П9: тень у края («Только редкие» за краем) и прокрутка к выбранному
  const parts = data ? summaryParts(data.summary) : null;
  return (
    <>
      <p className="ps-tf__sum" data-testid="tfeed-summary" aria-live="polite">
        {parts ? (
          <>
            {head}{rare ? ' (редкие)' : ''}: <b className="num">{parts[0]}</b>
            {parts.length > 1 && <span className="ps-tf__types">{parts.slice(1).map((p, i) => <span key={p} className={i === 0 ? 'ps-tf__t1' : undefined}>{i === 0 ? <span className="ps-tf__dot"> · </span> : ' · '}{p}</span>)}</span>}
          </>
        ) : <span className="ps-tf__sum-sk">{'\u00a0'}</span>}
      </p>
      <div className="ps-tf__chips ps-chiprow" role="group" aria-label="Период и редкость" aria-busy={busy || undefined} ref={row}>
        {FEED_PERIODS.map((p) => (
          <button key={p.id} type="button" className="ps-tf__chip" aria-pressed={period === p.id} onClick={() => onPeriod(p.id)}>{p.label}</button>
        ))}
        <button type="button" className="ps-tf__chip" aria-pressed={rare} data-testid="tfeed-rare" onClick={onRare} title="Меньше 5 % игроков">{RARE_CHIP}</button>
      </div>
    </>
  );
}

/** Скелет: те же высоты шапки, чипов и строк (CLS 0 при подмене). */
export function TrophyFeedSkeleton() {
  return (
    <SkRoot className="ps-tf">
      <div className="ps-pagehead ps-tf__head"><h1 className="ps-h1">Трофеи</h1></div>
      <LevelCardSkeleton />
      <div className="ps-seg ps-tf__view"><button type="button" disabled>Лента</button><button type="button" disabled>Почти платина</button></div>
      <p className="ps-tf__sum"><span className="ps-tf__sum-sk">{'\u00a0'}</span></p>
      <div className="ps-tf__chips">{FEED_PERIODS.map((p) => <span key={p.id} className="ps-skeleton ps-tf__chip ps-tf__chip--sk" />)}</div>
      {Array.from({ length: 6 }, (_, i) => <span key={i} className="ps-skeleton ps-tf__row-sk" />)}
    </SkRoot>
  );
}

function FeedRow({ it }: { it: FeedItem }) {
  const body = (
    <>
      <span className="ps-tf__icw"><RareIcon url={it.iconUrl} className="ps-tf__ic" /><TypeBadge type={it.type} /></span>
      <span className="ps-tf__tx">
        <span className="ps-tf__nm" title={it.detail ?? undefined}>{it.name?.trim() || 'Без названия'}</span>
        <span className="ps-tf__gm">{gameLine(it)}</span>
      </span>
      <span className="ps-tf__rate num" data-r={rarityTone(it)}>{rateText(it)}</span>
    </>
  );
  return (
    <li data-testid="tfeed-row">
      {it.game
        ? <Link href={`/?game=${it.game.id}&tab=trophies`} className="ps-tf__row">{body}</Link>
        : <span className="ps-tf__row" data-static="">{body}</span>}
    </li>
  );
}

/** П12.2: свёрнутая серия одной игры за день; тап раскрывает трофеи под строкой. */
function RunRow({ run, open, onToggle }: { run: Extract<FeedEntry, { kind: 'run' }>; open: boolean; onToggle: () => void }) {
  const rarest = runRarest(run.items);
  const id = `${run.key}-list`;
  return (
    <li data-testid="tfeed-run" className="ps-tf__run" data-open={open || undefined}>
      <button type="button" className="ps-tf__row ps-tf__runbtn" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span className="ps-tf__icw"><RareIcon url={rarest.iconUrl} className="ps-tf__ic" /><span className="ps-tf__runn num" aria-hidden="true">+{run.items.length}</span></span>
        <span className="ps-tf__tx">
          <span className="ps-tf__nm">{run.title}</span>
          <span className="ps-tf__gm">{runLine(run.items)}</span>
        </span>
        <span className="ps-tf__rate ps-tf__runr num" data-r={rarityTone(rarest)}>{rateText(rarest)}<Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} /></span>
      </button>
      {open && <ul className="ps-tf__rows ps-tf__runlist" id={id}>{run.items.map((it) => <FeedRow key={it.id} it={it} />)}</ul>}
    </li>
  );
}

/** F3 «Лента трофеев» (design-system §20): группы дней МСК, чипы периода и «Только редкие», «Показать ещё». */
export function TrophyFeedView({ initial, period: p0, rare: r0, view: v0 = 'feed', nearInitial = null, nearSort: s0 = 'close', levelInitial = null }: {
  initial: FeedResponse | null; period: FeedPeriod; rare: boolean; view?: TrophiesView; nearInitial?: NearListResponse | null; nearSort?: NearSort; levelInitial?: LevelResponse | null;
}) {
  const [view, setView] = useState<TrophiesView>(v0);
  const [nearSort, setNearSort] = useState<NearSort>(s0);
  const [openRuns, setOpenRuns] = useState<ReadonlySet<string>>(() => new Set());
  const toggleRun = (k: string) => setOpenRuns((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [near, setNear] = useState<NearListResponse | null>(nearInitial);
  const [nearLoad, setNearLoad] = useState<Load>('idle');
  const nearAc = useRef<AbortController | null>(null);
  const [period, setPeriod] = useState<FeedPeriod>(p0);
  const [rare, setRare] = useState(r0);
  const [data, setData] = useState<FeedResponse | null>(initial && initial.period === p0 && initial.rare === r0 ? initial : null);
  const [load, setLoad] = useState<Load>('idle');
  const [more, setMore] = useState<Load>('idle');
  const ac = useRef<AbortController | null>(null);
  const feedArgs = useRef<[FeedPeriod, boolean]>([p0, r0]);

  const fetchFirst = useCallback(async (p: FeedPeriod, r: boolean) => {
    ac.current?.abort();
    const c = new AbortController();
    ac.current = c;
    feedArgs.current = [p, r];
    setLoad('loading');
    try {
      const d = await cachedGet<FeedResponse>(feedUrl(p, r), c.signal);
      if (c.signal.aborted) return;
      ac.current = null;
      setData(d);
      setLoad('idle');
    } catch (e) {
      if (c.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      ac.current = null;
      setLoad('error');
    }
  }, []);

  const fetchNear = useCallback(async () => {
    nearAc.current?.abort();
    const c = new AbortController();
    nearAc.current = c;
    setNearLoad('loading');
    try {
      const d = await cachedGet<NearListResponse>(NEAR_URL, c.signal);
      if (c.signal.aborted) return;
      nearAc.current = null;
      setNear(d);
      setNearLoad('idle');
    } catch (e) {
      if (c.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      nearAc.current = null;
      setNearLoad('error');
    }
  }, []);
  // П9: возврат в приложение, «потяни, чтобы обновить»: перечитать то, что на экране
  useDataRefresh(() => { if (view === 'near') void fetchNear(); else void fetchFirst(period, rare); });

  useEffect(() => {
    if (v0 === 'near') {
      if (near) return;
      const t = setTimeout(() => void fetchNear(), 0);
      return () => clearTimeout(t);
    }
    if (data) return;
    const t = setTimeout(() => void fetchFirst(p0, r0), 0);
    return () => clearTimeout(t);
    // только первый показ без SSR-данных
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Снятие компонента обрывает запросы. В dev React StrictMode снимает и монтирует заново, состояние сохраняется:
  // если запрос (например, клик «Почти платина» до гидратации) оборвался так, его надо повторить, иначе вечный скелетон (флейк trophy-near).
  const resume = useRef<{ near: boolean; feed: [FeedPeriod, boolean] | null }>({ near: false, feed: null });
  useEffect(() => {
    const { near: rn, feed: rf } = resume.current;
    resume.current = { near: false, feed: null };
    if (rn) void fetchNear();
    if (rf) void fetchFirst(rf[0], rf[1]);
    return () => {
      resume.current = { near: nearAc.current !== null, feed: ac.current !== null ? feedArgs.current : null };
      ac.current?.abort();
      nearAc.current?.abort();
    };
  }, [fetchFirst, fetchNear]);

  const apply = (p: FeedPeriod, r: boolean) => {
    setPeriod(p);
    setRare(r);
    window.history.replaceState(window.history.state, '', viewUrl('feed', p, r));
    void fetchFirst(p, r);
  };

  const switchView = (v: TrophiesView) => {
    if (v === view) return;
    setView(v);
    window.history.replaceState(window.history.state, '', v === 'near' ? nearPageUrl(nearSort) : viewUrl(v, period, rare));
    // свежие данные при каждом входе (cachedGet отдаёт из кэша 30 с, без лишних запросов)
    if (v === 'near') void fetchNear();
    else void fetchFirst(period, rare);
  };

  const loadMore = async () => {
    if (!data?.nextCursor || more === 'loading') return;
    setMore('loading');
    try {
      const next = await cachedGet<FeedResponse>(feedUrl(period, rare, data.nextCursor));
      setData((prev) => (prev && prev.period === next.period && prev.rare === next.rare ? mergePages(prev, next) : prev));
      setMore('idle');
    } catch {
      setMore('error');
    }
  };

  const groups = useMemo(() => (data ? groupFeed(data.items, data.today) : []), [data]);
  const busy = load === 'loading';

  return (
    <div className="ps-tf" data-testid="tfeed" data-view={view}>
      <div className="ps-pagehead ps-tf__head">
        <h1 className="ps-h1">Трофеи</h1>
      </div>
      <LevelCard initial={levelInitial} />
      <ViewSwitch view={view} onView={switchView} />
      {view === 'near' ? (
        <>
          <p className="ps-tf__sum" data-testid="tnear-summary" aria-live="polite">
            {near ? nearSummary(near.items.length) : <span className="ps-tf__sum-sk">{'\u00a0'}</span>}
          </p>
          {nearLoad === 'error' && !near && (
            <p className="ps-tf__empty" role="alert">
              Не удалось загрузить список. <button type="button" className="ps-btn ps-btn--sm" onClick={() => void fetchNear()}>Повторить</button>
            </p>
          )}
          {!near && nearLoad !== 'error' && Array.from({ length: 6 }, (_, i) => <span key={i} className="ps-skeleton ps-tnear-sk" aria-hidden="true" />)}
          {/* П12.1: порядок списка — «Ближе всего» (прогресс) или «Лёгкие» (доля игроков с платиной) */}
          <div className="ps-seg ps-tnear__sort" role="group" aria-label="Порядок" data-testid="tnear-sort">
            {NEAR_SORTS.map((o) => (
              <button key={o.id} type="button" aria-pressed={nearSort === o.id} title={o.id === 'easy' ? EASY_HINT : undefined}
                onClick={() => { setNearSort(o.id); window.history.replaceState(window.history.state, '', nearPageUrl(o.id)); }}>{o.label}</button>
            ))}
          </div>
          {near && <NearList data={near} busy={nearLoad === 'loading'} sort={nearSort} />}
        </>
      ) : <>
      <Head period={period} rare={rare} data={data} busy={busy} onPeriod={(p) => apply(p, rare)} onRare={() => apply(period, !rare)} />
      {load === 'error' && !data && (
        <p className="ps-tf__empty" role="alert">
          Не удалось загрузить трофеи. <button type="button" className="ps-btn ps-btn--sm" onClick={() => void fetchFirst(period, rare)}>Повторить</button>
        </p>
      )}
      {!data && load !== 'error' && Array.from({ length: 6 }, (_, i) => <span key={i} className="ps-skeleton ps-tf__row-sk" aria-hidden="true" />)}
      {data && (
        <div className="ps-tf__list" data-busy={busy || undefined} aria-busy={busy || undefined}>
          {groups.length === 0 && <p className="ps-tf__empty" data-testid="tfeed-empty">{emptyText(data.period, data.rare)}</p>}
          {groups.map((g) => (
            <section key={g.key} className="ps-tf__day" aria-label={g.label}>
              <h2 className="ps-tf__dayh">{g.label}</h2>
              <ul className="ps-tf__rows">
                {collapseRuns(g.items).map((e) => (e.kind === 'one'
                  ? <FeedRow key={e.item.id} it={e.item} />
                  : <RunRow key={e.key} run={e} open={openRuns.has(e.key)} onToggle={() => toggleRun(e.key)} />))}
              </ul>
            </section>
          ))}
          {data.nextCursor && (
            <button type="button" className="ps-btn ps-tf__more" data-testid="tfeed-more" onClick={() => void loadMore()} disabled={more === 'loading'}>
              {more === 'loading' ? 'Загрузка…' : more === 'error' ? 'Не удалось. Ещё раз' : 'Показать ещё'}
            </button>
          )}
        </div>
      )}
      </>}
    </div>
  );
}
