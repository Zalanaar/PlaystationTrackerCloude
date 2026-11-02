'use client';

import { useId, useMemo, useState } from 'react';
import type { GameItem } from '@/server/collection/types';
import type { StatsTop } from '@/server/stats/types';
import { Cover, THUMB_SIZES } from '../collection/Cover';
import { Icon, PlatinumIcon } from '../icons';
import { TOP_EMPTY, TOP_MODES, TOP_SUBTITLE, TROPHY_POINTS, topHoursRows, topTrophyRows, type TopMode, type TopRow } from './model';

function Row({ row, mode, onOpen }: { row: TopRow; mode: TopMode; onOpen: (g: GameItem) => void }) {
  return (
    <li className="ps-top__li">
      <button type="button" className="ps-top__row" aria-label={`${row.rank}. ${row.game.title}. ${row.valueLabel}`} onClick={() => onOpen(row.game)} data-top={row.rank <= 3 || undefined}>
        <span className="ps-top__rank num">{row.rank}</span>
        <Cover url={row.game.coverUrl} title={row.game.title} className="ps-top__cover" sizes={THUMB_SIZES} />
        <span className="ps-top__tx">
          <span className="ps-top__name" title={row.game.title}>{row.game.title}</span>
          {mode === 'hours' ? (
            <span className="ps-top__bar" aria-hidden="true"><i style={{ width: `${row.widthPct}%` }} /></span>
          ) : (
            <span className="ps-top__counts" aria-hidden="true">
              {row.counts.map((c) => (
                <span key={c.kind} data-kind={c.kind}>
                  {c.kind === 'platinum' ? <PlatinumIcon size={12} /> : <Icon name="trophy" size={12} />}
                  <b className="num">{c.count}</b>
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="ps-top__val num" title={row.approx ? 'Часть часов оценена' : row.valueLabel}>
          {row.approx && <span className="ps-approx" aria-hidden="true">≈ </span>}{row.valueText}
        </span>
      </button>
    </li>
  );
}

/** Топ-10 игр периода с переключателем «Часы / Трофеи» (design-system §4.17.2). Выбор не хранится. */
export function TopGames({ top, onOpen, scope }: { top: StatsTop; onOpen: (g: GameItem) => void; scope?: 'all' }) {
  const [mode, setMode] = useState<TopMode>('hours');
  const titleId = useId();
  const rows = useMemo(() => (mode === 'hours' ? topHoursRows(top.byHours) : topTrophyRows(top.byTrophies)), [mode, top]);
  return (
    <section className="ps-panel ps-st-panel ps-st-panel--top" aria-labelledby={titleId}>
      <div className="ps-top__head">
        <h3 className="ps-st-panel__t" id={titleId}>Топ-10 игр</h3>
        <div className="ps-seg" role="group" aria-label="Что считать в топе">
          {TOP_MODES.map((m) => <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>)}
        </div>
      </div>
      <p className="ps-st-panel__s">{scope === 'all' ? (mode === 'hours' ? 'за всё время' : `Очки за все трофеи: платина ${TROPHY_POINTS.platinum}, золото ${TROPHY_POINTS.gold}, серебро ${TROPHY_POINTS.silver}, бронза ${TROPHY_POINTS.bronze}`) : TOP_SUBTITLE[mode]}</p>
      {rows.length === 0 ? (
        <p className="ps-top__empty">{TOP_EMPTY[mode]}</p>
      ) : (
        <ol className="ps-top">{rows.map((r) => <Row key={r.id} row={r} mode={mode} onOpen={onOpen} />)}</ol>
      )}
    </section>
  );
}

export function TopSkeleton() {
  return (
    <div className="ps-st-panel ps-st-panel--top" aria-hidden="true">
      <div className="ps-skeleton ps-top__sk-h" />
      {Array.from({ length: 10 }, (_, i) => <div key={i} className="ps-skeleton ps-top__sk-row" />)}
    </div>
  );
}
