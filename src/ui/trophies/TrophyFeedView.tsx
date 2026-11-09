'use client';

import Link from '@/ui/IntentLink'; // Пакет 6: без предзагрузки по экрану, по намерению
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedPeriod, FeedResponse } from '@/server/trophies/types';
import { cachedGet } from '../data/http';
import { SkRoot } from '../skeletons';
import { RareIcon, TypeBadge } from '../stats/RareTrophies';
import { emptyText, FEED_PERIODS, feedUrl, gameLine, groupFeed, mergePages, pageUrl, RARE_CHIP, rarityTone, rateText, summaryParts } from './model';

type Load = 'idle' | 'loading' | 'error';

function Head({ period, rare, data, onPeriod, onRare, busy }: {
  period: FeedPeriod; rare: boolean; data: FeedResponse | null; busy: boolean; onPeriod: (p: FeedPeriod) => void; onRare: () => void;
}) {
  const head = FEED_PERIODS.find((p) => p.id === period)?.head ?? '';
  const parts = data ? summaryParts(data.summary) : null;
  return (
    <>
      <div className="ps-pagehead ps-tf__head">
        <h1 className="ps-h1">Трофеи</h1>
      </div>
      <p className="ps-tf__sum" data-testid="tfeed-summary" aria-live="polite">
        {parts ? (
          <>
            {head}{rare ? ' (редкие)' : ''}: <b className="num">{parts[0]}</b>
            {parts.length > 1 && <span className="ps-tf__types">{parts.slice(1).map((p, i) => <span key={p} className={i === 0 ? 'ps-tf__t1' : undefined}>{i === 0 ? <span className="ps-tf__dot"> · </span> : ' · '}{p}</span>)}</span>}
          </>
        ) : <span className="ps-tf__sum-sk">{'\u00a0'}</span>}
      </p>
      <div className="ps-tf__chips" role="group" aria-label="Период и редкость" aria-busy={busy || undefined}>
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
      <p className="ps-tf__sum"><span className="ps-tf__sum-sk">{'\u00a0'}</span></p>
      <div className="ps-tf__chips">{FEED_PERIODS.map((p) => <span key={p.id} className="ps-skeleton ps-tf__chip ps-tf__chip--sk" />)}</div>
      {Array.from({ length: 6 }, (_, i) => <span key={i} className="ps-skeleton ps-tf__row-sk" />)}
    </SkRoot>
  );
}

/** F3 «Лента трофеев» (design-system §20): группы дней МСК, чипы периода и «Только редкие», «Показать ещё». */
export function TrophyFeedView({ initial, period: p0, rare: r0 }: { initial: FeedResponse | null; period: FeedPeriod; rare: boolean }) {
  const [period, setPeriod] = useState<FeedPeriod>(p0);
  const [rare, setRare] = useState(r0);
  const [data, setData] = useState<FeedResponse | null>(initial && initial.period === p0 && initial.rare === r0 ? initial : null);
  const [load, setLoad] = useState<Load>('idle');
  const [more, setMore] = useState<Load>('idle');
  const ac = useRef<AbortController | null>(null);

  const fetchFirst = useCallback(async (p: FeedPeriod, r: boolean) => {
    ac.current?.abort();
    const c = new AbortController();
    ac.current = c;
    setLoad('loading');
    try {
      const d = await cachedGet<FeedResponse>(feedUrl(p, r), c.signal);
      if (c.signal.aborted) return;
      setData(d);
      setLoad('idle');
    } catch (e) {
      if (c.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setLoad('error');
    }
  }, []);

  useEffect(() => {
    if (data) return;
    const t = setTimeout(() => void fetchFirst(p0, r0), 0);
    return () => clearTimeout(t);
    // только первый показ без SSR-данных
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => ac.current?.abort(), []);

  const apply = (p: FeedPeriod, r: boolean) => {
    setPeriod(p);
    setRare(r);
    window.history.replaceState(window.history.state, '', pageUrl(p, r));
    void fetchFirst(p, r);
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
    <div className="ps-tf" data-testid="tfeed">
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
                {g.items.map((it) => {
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
                    <li key={it.id} data-testid="tfeed-row">
                      {it.game
                        ? <Link href={`/?game=${it.game.id}&tab=trophies`} className="ps-tf__row">{body}</Link>
                        : <span className="ps-tf__row" data-static="">{body}</span>}
                    </li>
                  );
                })}
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
    </div>
  );
}
