'use client';

import { useId, useState } from 'react';
import type { DurationCounts, GenreCounts, HltbCounts } from '@/server/collection/types';
import type { PlatformCounts } from '@/shared/platform-filter';
import { PlatformChips } from './PlatformChips';
import { formatNumber } from '../format';
import { Icon } from '../icons';
import {
  BACKLOG_SORTS, HLTB_CHIPS, backlogSortId, DURATION_BUCKETS, GENRE_NONE_OPTION, GENRE_OPTIONS, genreCount, hasBacklogFilters, toggleValue, type BacklogFilters as Filters,
} from './backlog';

/** Фильтры бэклога: «Длительность» (чипы со счётчиками), «Жанр» (раскрывающийся список чипов), сортировка. Всё переносится по строкам, без горизонтальной прокрутки. */
export function BacklogFilters({
  filters, counts, genreCounts, hltbCounts, platformCounts = null, nbCount = 0, onChange, onReset,
}: {
  filters: Filters; counts: DurationCounts | null; genreCounts: GenreCounts | null; hltbCounts: HltbCounts | null;
  /** F4: игр бэклога по платформам */
  platformCounts?: PlatformCounts | null;
  /** записей «не куплено» (Фаза 43); чип показываем, если они есть или он уже включён */
  nbCount?: number;
  onChange: (p: Partial<Filters>) => void; onReset: () => void;
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
                <span className="ps-filterchip__t">{b.label}</span>{' '}
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
        <PlatformChips value={filters.platform} counts={platformCounts} onChange={(platform) => onChange({ platform })} />
        {HLTB_CHIPS.map((c) => {
          const n = hltbCounts ? hltbCounts[c.id] : 0;
          const on = filters.hltb.includes(c.id);
          // чип показываем, если есть такие игры или он уже выбран (иначе его не снять)
          if (n <= 0 && !on) return null;
          return (
            <button
              key={c.id} type="button" className="ps-filterchip ps-chip" data-hltb={c.id} aria-pressed={on} aria-label={`${c.label}: ${formatNumber(n)}`}
              onClick={() => onChange({ hltb: toggleValue(filters.hltb, c.id) })}
            >
              <span className="ps-filterchip__t">{c.label}</span>{' '}
              <span className="ps-filterchip__n num">{formatNumber(n)}</span>
            </button>
          );
        })}
        {(nbCount > 0 || filters.nb) && (
          <button
            type="button" className="ps-filterchip ps-chip" data-testid="bl-nb-chip" aria-pressed={filters.nb} aria-label={`Не куплено: ${formatNumber(nbCount)}`}
            onClick={() => onChange({ nb: !filters.nb })}
          >
            <span className="ps-filterchip__t">Не куплено</span>{' '}
            <span className="ps-filterchip__n num">{formatNumber(nbCount)}</span>
          </button>
        )}
        {hasBacklogFilters(filters) && <button type="button" className="ps-link" onClick={onReset}>Сбросить</button>}
      </div>
      {open && (
        <div id={panelId} className="ps-bl-group ps-bl-genres" role="group" aria-label="Жанр">
          {[...GENRE_OPTIONS, GENRE_NONE_OPTION]
            // «Без жанра» показываем, только если такие игры есть или чип уже выбран (иначе его не снять)
            .filter((g) => g.key !== GENRE_NONE_OPTION.key || filters.genres.includes(g.key) || (genreCount(genreCounts, g.key) ?? 0) > 0)
            .map((g) => {
              const n = genreCount(genreCounts, g.key);
              return (
                <button
                  key={g.key} type="button" className="ps-filterchip ps-chip" data-genre={g.key} aria-pressed={filters.genres.includes(g.key)}
                  aria-label={n !== null ? `${g.label}: ${formatNumber(n)}` : g.label}
                  onClick={() => onChange({ genres: toggleValue(filters.genres, g.key) })}
                >
                  <span className="ps-filterchip__t">{g.label}</span>{' '}
                  {n !== null && <span className="ps-filterchip__n num">{formatNumber(n)}</span>}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
