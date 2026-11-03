'use client';

import type { GameItem, GameSort, SortOrder } from '@/server/collection/types';
import { ratingAria } from '@/shared/review';
import { formatDayMonth, formatHoursShort } from '../format';
import { Icon, PlatinumIcon, StatusGlyph } from '../icons';
import { StatusMenu, toKey } from '../status';
import { STATUS_META } from '../tokens';
import { Cover } from './Cover';
import { completionInfo, DEFAULT_ORDER } from './filters';
import { dateMenuItem, type GameActions } from './GameCard';

export function GameRow({
  game, actions, selectMode, selected, anchorId,
}: { game: GameItem; actions: GameActions; selectMode: boolean; selected: boolean; /** id первой строки месяца в Хронике (`m2026-10`) */ anchorId?: string }) {
  const done = completionInfo(game);
  const t = game.trophies;
  const key = toKey(game.status);
  const label = STATUS_META[key].label;
  const doneDate = done ? formatDayMonth(done.iso) : null;
  const plat = t?.platinumEarned === true;
  const genres = game.genres.map((g) => g.label).join(', ');
  return (
    <div id={anchorId} tabIndex={anchorId ? -1 : undefined} className="ps-row" role="row" data-selected={selected || undefined} data-status={key} data-platinum={plat || undefined}>
      <div className="ps-row__game" role="cell">
        {/* Фаза 48 (п. 14): кнопка-оверлей внутри ячейки: у role=row детьми могут быть только ячейки (axe aria-required-children) */}
        <button
          type="button" className="ps-row__hit" aria-pressed={selectMode ? selected : undefined}
          aria-label={`${selectMode ? 'Выбрать' : 'Открыть'}: ${game.title}${plat ? ', платина получена' : ''}${ratingAria(game.rating)}`}
          onClick={() => (selectMode ? actions.toggle(game) : actions.open(game))}
        />
        <span className="ps-row__check" aria-hidden="true" data-on={selectMode || undefined}>
          {selectMode && <span className="ps-check" data-checked={selected || undefined}>{selected && <Icon name="check" size={12} />}</span>}
        </span>
        <Cover url={game.coverUrl} title={game.title} className="ps-row__thumb" />
        <span className="ps-row__text">
          <span className="ps-row__title" title={game.title}>
            <span className="ps-row__name">{game.title}</span>
            {plat && <PlatinumIcon size={14} className="ps-row__plat" title="Платина получена" />}
            {game.rating !== null && game.rating !== undefined && <span className="ps-row__rate num" aria-hidden="true" data-testid="row-rating">★ {game.rating}</span>}
          </span>
          {genres && <span className="ps-row__sub">{genres}</span>}
          <span className="ps-row__mobile-meta num" aria-hidden="true">
            {game.hours > 0 ? formatHoursShort(game.hours) : '0 ч'}{t ? ` · ${t.progress}%` : ''}
          </span>
        </span>
      </div>
      <div className="ps-row__status" role="cell">
        <StatusMenu value={game.status} onPick={(s) => actions.setStatus(game, s)} label={`${label}${doneDate ? ` · ${doneDate.replace(/\.$/, '')}` : ''}. Статус: ${game.title}`} extra={dateMenuItem(game, actions)}>
          <StatusGlyph status={key} size={16} />
          <span className="ps-row__status-t" title={STATUS_META[key].title}>{label}{doneDate ? ` · ${doneDate}` : ''}</span>
        </StatusMenu>
      </div>
      <div className="ps-row__hours ps-num" role="cell">{game.hours > 0 ? formatHoursShort(game.hours) : '—'}</div>
      <div className="ps-row__trophies" role="cell">
        {t ? (
          <>
            <span className="ps-meter" aria-hidden="true"><span style={{ width: `${t.progress}%` }} /></span>
            <span className="ps-row__pct ps-num">{t.earned}/{t.defined}</span>
          </>
        ) : <span className="ps-row__pct">нет данных</span>}
      </div>
      <div className="ps-row__last ps-num" role="cell">{formatDayMonth(game.lastPlayedAt, true) ?? '—'}</div>
    </div>
  );
}

const COLS: readonly { label: string; sort: GameSort | null; cls: string }[] = [
  { label: 'Игра', sort: 'title', cls: 'ps-row__game' },
  { label: 'Статус', sort: null, cls: 'ps-row__status' },
  { label: 'Часы', sort: 'hours', cls: 'ps-row__hours' },
  { label: 'Трофеи', sort: 'trophies_progress', cls: 'ps-row__trophies' },
  { label: 'Посл. запуск', sort: 'last_played', cls: 'ps-row__last' },
];

export function RowHeader({
  sort, order, onSort,
}: { sort: GameSort; order: SortOrder | null; onSort: (s: GameSort) => void }) {
  const eff = order ?? DEFAULT_ORDER[sort];
  return (
    <div className="ps-row ps-row--head" role="row">
      {COLS.map((c) => (
        <div key={c.label} className={c.cls} role="columnheader" aria-sort={c.sort && c.sort === sort ? (eff === 'asc' ? 'ascending' : 'descending') : undefined}>
          {c.sort ? (
            <button type="button" className="ps-sortbtn" onClick={() => onSort(c.sort as GameSort)}>
              {c.label}
              {c.sort === sort && <Icon name={eff === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} />}
            </button>
          ) : c.label}
        </div>
      ))}
    </div>
  );
}
