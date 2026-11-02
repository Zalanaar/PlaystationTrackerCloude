'use client';

import { useMemo, useState } from 'react';
import type { RareTrophy, StatsGenreGame, StatsResponse } from '@/server/stats/types';
import { Cover, THUMB_SIZES } from '../collection/Cover';
import { Icon, PlatinumIcon } from '../icons';
import { RARE_EMPTY, RARE_SUBTITLE, rareList, rareRows, type RareRow, type RareScope } from './rare';

/** Иконка трофея с запасным значком (нет адреса или не загрузилась). */
export function RareIcon({ url, className }: { url: string | null; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) {
    return <span className={`ps-rare__ic ps-rare__ic--empty ${className ?? ''}`} aria-hidden="true"><Icon name="trophy" size={20} /></span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- иконки трофеев с CDN PSN
    <img className={`ps-rare__ic ${className ?? ''}`} src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(url)} />
  );
}

export function TypeBadge({ type }: { type: RareTrophy['type'] }) {
  return (
    <span className="ps-rare__ty" data-type={type} aria-hidden="true">
      {type === 'platinum' ? <PlatinumIcon size={14} /> : <Icon name="trophy" size={14} />}
    </span>
  );
}

function RarityMark({ row }: { row: RareRow }) {
  if (!row.rarityKnown) return <span className="ps-rare__rar ps-rare__rar--none">{row.rarity}</span>;
  return (
    <span className="ps-rare__rar" data-r={4 - row.segments}>
      <b>{row.rarity}</b>
      <span className="ps-rare__seg" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} data-on={i < row.segments || undefined} />)}</span>
    </span>
  );
}

/** «Редкие трофеи» (п.7): топ-5 по проценту получивших, за период страницы или за всё время. */
export function RareTrophies({
  data, periodLabel, onOpen, withService = false, onWithService,
}: { data: StatsResponse; periodLabel: string; onOpen: (g: StatsGenreGame) => void; withService?: boolean; onWithService?: (v: boolean) => void }) {
  const [scope, setScope] = useState<RareScope>('period');
  const list = useMemo(() => rareList(data.rareTrophies, scope), [data.rareTrophies, scope]);
  const rows = useMemo(() => rareRows(list), [list]);
  if (!data.rareTrophies) return null;
  return (
    <section className="ps-panel ps-st-panel ps-st-panel--wide ps-rare" aria-labelledby="st-rare">
      <div className="ps-rare__head">
        <h3 className="ps-st-panel__t" id="st-rare">Редкие трофеи</h3>
        <div className="ps-seg ps-rare__seg-ctl" role="group" aria-label="Область">
          <button type="button" aria-pressed={scope === 'period'} onClick={() => setScope('period')}>{periodLabel}</button>
          <button type="button" aria-pressed={scope === 'allTime'} onClick={() => setScope('allTime')}>За всё время</button>
        </div>
      </div>
      <p className="ps-st-panel__s">{RARE_SUBTITLE}</p>
      {onWithService && (
        <label className="ps-rare__svc">
          <input type="checkbox" checked={withService} onChange={(e) => onWithService(e.target.checked)} />
          <span>С играми-сервисами</span>
        </label>
      )}
      {rows.length === 0 ? (
        <p className="ps-rare__empty">{RARE_EMPTY[scope]}</p>
      ) : (
        <ol className="ps-rare__list">
          {rows.map((r, i) => {
            const game = list[i].game;
            const body = (
              <>
                <span className="ps-rare__rk num" data-first={r.rank === 1 || undefined}>{r.rank}</span>
                <span className="ps-rare__icw"><RareIcon url={r.iconUrl} /><TypeBadge type={r.type} /></span>
                <span className="ps-rare__tx">
                  <span className="ps-rare__nm" title={r.detail ?? undefined}>{r.name}</span>
                  <span className="ps-rare__gm">
                    {game && r.coverUrl && <Cover url={r.coverUrl} title={r.gameName} className="ps-rare__th" sizes={THUMB_SIZES} />}
                    <span className="ps-rare__gn">{r.gameName}</span>
                    <em>{r.date}</em>
                  </span>
                </span>
                <span className="ps-rare__rr">
                  <b className="num">{r.rate}</b>
                  <RarityMark row={r} />
                </span>
              </>
            );
            return (
              <li key={r.key} className="ps-rare__row">
                {game ? (
                  <button type="button" className="ps-rare__btn" aria-label={r.aria} onClick={() => onOpen(game)}>{body}</button>
                ) : (
                  <div className="ps-rare__btn" data-static aria-label={r.aria} role="group">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function RareSkeleton() {
  return (
    <div className="ps-st-panel ps-st-panel--wide" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => <div key={i} className="ps-skeleton ps-rare__sk" />)}
    </div>
  );
}
