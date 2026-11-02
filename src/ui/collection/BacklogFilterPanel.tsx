'use client';

import type { DurationCounts, GenreCounts, HltbCounts } from '@/server/collection/types';
import { formatNumber } from '../format';
import { Icon } from '../icons';
import {
  BACKLOG_SORTS, HLTB_CHIPS, backlogSortId, DURATION_BUCKETS, GENRE_NONE_OPTION, GENRE_OPTIONS, genreCount, hasBacklogFilters, toggleValue, type BacklogFilters as Filters,
} from './backlog';

/** Содержимое sheet «Фильтры и сортировка» (мобильный, Фаза 33): сортировка радиогруппой, чипы длительности, жанров и HLTB без аккордеона. Изменения применяются сразу. */
export function BacklogFilterPanel({
  filters, counts, genreCounts, hltbCounts, total, nbCount = 0, onChange, onReset, onDone,
}: {
  filters: Filters; counts: DurationCounts | null; genreCounts: GenreCounts | null; hltbCounts: HltbCounts | null; total: number; nbCount?: number;
  onChange: (p: Partial<Filters>) => void; onReset: () => void; onDone: () => void;
}) {
  const sortId = backlogSortId(filters);
  const showHltb = HLTB_CHIPS.some((c) => (hltbCounts ? hltbCounts[c.id] : 0) > 0 || filters.hltb.includes(c.id));
  return (
    <div className="ps-stack ps-bl-panel">
      <section className="ps-bl-panel__sec" aria-labelledby="bl-p-sort">
        <h3 id="bl-p-sort" className="ps-bl-panel__h">Сортировка</h3>
        <div role="radiogroup" aria-labelledby="bl-p-sort" className="ps-bl-radios">
          {BACKLOG_SORTS.map((s) => (
            <button
              key={s.id} type="button" role="radio" aria-checked={sortId === s.id} className="ps-bl-radio"
              onClick={() => onChange({ sort: s.sort, order: s.order })}
            >
              <span>{s.label}</span>
              {sortId === s.id && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      </section>
      <section className="ps-bl-panel__sec" aria-labelledby="bl-p-dur">
        <h3 id="bl-p-dur" className="ps-bl-panel__h">Длительность</h3>
        <div className="ps-bl-group" role="group" aria-labelledby="bl-p-dur">
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
      </section>
      <section className="ps-bl-panel__sec" aria-labelledby="bl-p-genre">
        <h3 id="bl-p-genre" className="ps-bl-panel__h">Жанр</h3>
        <div className="ps-bl-group" role="group" aria-labelledby="bl-p-genre">
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
                  <span className="ps-filterchip__t">{g.label}</span>
                  {n !== null && <span className="ps-filterchip__n num">{formatNumber(n)}</span>}
                </button>
              );
            })}
        </div>
      </section>
      {showHltb && (
        <section className="ps-bl-panel__sec" aria-labelledby="bl-p-hltb">
          <h3 id="bl-p-hltb" className="ps-bl-panel__h">HowLongToBeat</h3>
          <div className="ps-bl-group" role="group" aria-labelledby="bl-p-hltb">
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
                  <span className="ps-filterchip__t">{c.label}</span>
                  <span className="ps-filterchip__n num">{formatNumber(n)}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {(nbCount > 0 || filters.nb) && (
        <section className="ps-bl-panel__sec" aria-labelledby="bl-p-nb">
          <h3 id="bl-p-nb" className="ps-bl-panel__h">Покупка</h3>
          <div className="ps-bl-group" role="group" aria-labelledby="bl-p-nb">
            <button
              type="button" className="ps-filterchip ps-chip" data-testid="bl-nb-chip" aria-pressed={filters.nb} aria-label={`Не куплено: ${formatNumber(nbCount)}`}
              onClick={() => onChange({ nb: !filters.nb })}
            >
              <span className="ps-filterchip__t">Не куплено</span>
              <span className="ps-filterchip__n num">{formatNumber(nbCount)}</span>
            </button>
          </div>
        </section>
      )}
      <div className="ps-bl-panel__foot">
        {hasBacklogFilters(filters) && <button type="button" className="ps-link" onClick={onReset}>Сбросить</button>}
        <button type="button" className="ps-btn ps-btn--primary" onClick={onDone}>Показать {formatNumber(total)}</button>
      </div>
    </div>
  );
}
