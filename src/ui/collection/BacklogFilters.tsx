'use client';

import { useId, useState } from 'react';
import type { DurationCounts } from '@/server/collection/types';
import { formatNumber } from '../format';
import { Icon } from '../icons';
import {
  BACKLOG_SORTS, backlogSortId, DURATION_BUCKETS, GENRE_OPTIONS, hasBacklogFilters, toggleValue, type BacklogFilters as Filters,
} from './backlog';

/** Фильтры бэклога: «Длительность» (чипы со счётчиками), «Жанр» (раскрывающийся список чипов), сортировка. Всё переносится по строкам, без горизонтальной прокрутки. */
export function BacklogFilters({
  filters, counts, onChange, onReset,
}: {
  filters: Filters; counts: DurationCounts | null; onChange: (p: Partial<Filters>) => void; onReset: () => void;
}) {
  const [open, setOpen] = useState(filters.genres.length > 0);
  const panelId = useId();
  const sortId = backlogSortId(filters);
  return (
    <div className="ps-bl-filters">
      <div className="ps-bl-filters__row">
        <div className="ps-bl-group" role="group" aria-label="Длительность">
          <span className="ps-bl-group__label" aria-hidden="true">Длительность</span>
          {DURATION_BUCKETS.map((b) => {
            const n = counts ? counts[b.id] : null;
            return (
              <button
                key={b.id} type="button" className="ps-filterchip ps-chip" data-bucket={b.id} aria-pressed={filters.duration.includes(b.id)}
                aria-label={n !== null ? `${b.label}: ${formatNumber(n)}` : b.label}
                onClick={() => onChange({ duration: toggleValue(filters.duration, b.id) })}
              >
                <span className="ps-filterchip__t">{b.label}</span>
                {n !== null && <span className="ps-filterchip__n num">{formatNumber(n)}</span>}
              </button>
            );
          })}
        </div>
        <label className="ps-select ps-bl-sort">
          <span className="ps-sr">Сортировка</span>
          <select
            value={sortId}
            onChange={(e) => {
              const o = BACKLOG_SORTS.find((s) => s.id === e.target.value);
              if (o) onChange({ sort: o.sort, order: o.order });
            }}
          >
            {BACKLOG_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <Icon name="chevron-down" size={14} />
        </label>
      </div>
      <div className="ps-bl-filters__row">
        <button
          type="button" className="ps-btn ps-bl-genrebtn" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}
        >
          Жанр{filters.genres.length > 0 && <span className="ps-filterchip__n num">{filters.genres.length}</span>}
          <Icon name="chevron-down" size={14} />
        </button>
        {hasBacklogFilters(filters) && <button type="button" className="ps-link" onClick={onReset}>Сбросить</button>}
      </div>
      {open && (
        <div id={panelId} className="ps-bl-group ps-bl-genres" role="group" aria-label="Жанр">
          {GENRE_OPTIONS.map((g) => (
            <button
              key={g.key} type="button" className="ps-filterchip ps-chip" data-genre={g.key} aria-pressed={filters.genres.includes(g.key)}
              onClick={() => onChange({ genres: toggleValue(filters.genres, g.key) })}
            >
              <span className="ps-filterchip__t">{g.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
