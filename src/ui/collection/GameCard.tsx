'use client';

import { useState, type ReactNode } from 'react';
import type { GameItem, GameStatusValue } from '@/server/collection/types';
import { formatDayMonth, formatPlayTime, launchesText } from '../format';
import { Icon, PlatinumIcon, StatusGlyph } from '../icons';
import { useIsMobile } from '../primitives/hooks';
import { StatusMenu, StatusSheet, toKey } from '../status';
import { STATUS_META } from '../tokens';
import { Cover } from './Cover';
import { completionInfo } from './filters';
import { useLongPress } from './useLongPress';

export type GameActions = {
  open: (g: GameItem, editDate?: boolean) => void;
  setStatus: (g: GameItem, s: GameStatusValue | null) => void;
  toggle: (g: GameItem) => void;
};

/** Пункт меню «Изменить дату» только для пройденных и брошенных. */
export function dateMenuItem(g: GameItem, actions: GameActions) {
  if (!completionInfo(g)) return undefined;
  return function DateMenuItem(close: () => void) {
    return (
      <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall ps-menu-item--sep" onClick={() => { close(); actions.open(g, true); }}>
        <Icon name="calendar" size={16} />
        <span className="ps-menu-item__label">Изменить дату…</span>
      </button>
    );
  };
}

function GlyphBadge({ status, title }: { status: GameStatusValue | null; title?: string }) {
  const key = toKey(status);
  return (
    <span className="ps-card__glyph" data-status={key} title={title ?? STATUS_META[key].title ?? STATUS_META[key].label}>
      <StatusGlyph status={key} size={16} />
    </span>
  );
}

/**
 * Карточка в «Играх месяца» (Статистика): фигура в углу только у события месяца (пройдено/брошено), без меню статуса;
 * плашка даты = дата события; под обложкой часы за месяц вместо общих.
 */
export type CardMonth = { finished: 'completed' | 'dropped' | null; finishedAt: string | null; hoursText: string | null; hoursLabel: string | null };

export function GameCard({
  game, actions, selectMode, selected, active, dateWithYear, month, children,
}: {
  game: GameItem; actions: GameActions; selectMode: boolean; selected: boolean; active?: boolean;
  /** «9 окт. 2026» вместо «9 окт.» (плоский список результатов) */
  dateWithYear?: boolean;
  month?: CardMonth;
  /** быстрые действия под карточкой (Бэклог) */
  children?: ReactNode;
}) {
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState(false);
  const { handlers, wasLong } = useLongPress(() => { if (!selectMode) setSheet(true); }, mobile);
  const time = formatPlayTime(game.playSeconds);
  const done = month ? (month.finished && month.finishedAt ? { kind: month.finished, iso: month.finishedAt } : null) : completionInfo(game);
  const date = done ? formatDayMonth(done.iso, dateWithYear) : null;
  const meta = month ? month.hoursText : time;
  const t = game.trophies;
  const key = toKey(game.status);
  const plat = t?.platinumEarned === true;
  return (
    <article
      className="ps-card" data-status={key} data-platinum={plat || undefined} data-selected={selected || undefined} data-select={selectMode || undefined} data-active={active || undefined}
    >
      <div className="ps-card__cover">
        <Cover url={game.coverUrl} title={game.title} />
        {plat && (
          <span className="ps-card__plat" title="Платина получена" aria-hidden="true">
            <PlatinumIcon size={20} />
          </span>
        )}
        {date && <span className="ps-card__date num" data-kind={done?.kind}>{date}</span>}
        <div className="ps-card__hov" aria-hidden="true">
          <b>{game.title}</b>
          {time && <span>{time}{game.playCount > 0 ? ` · ${launchesText(game.playCount)}` : ''}</span>}
          {t && (
            <>
              <span className="ps-card__hovtr">{plat && <PlatinumIcon size={12} className="ps-card__hovplat" />}Трофеи {t.earned}/{t.defined}</span>
              <span className="ps-card__bar"><i style={{ width: `${t.progress}%` }} /></span>
            </>
          )}
          {game.lastPlayedAt && <span>Последний запуск {formatDayMonth(game.lastPlayedAt)}</span>}
        </div>
        {selectMode && (
          <span className="ps-card__check" aria-hidden="true">{selected && <Icon name="check" size={14} />}</span>
        )}
      </div>
      <div className="ps-card__body">
        <p className="ps-card__title" title={game.title}>{game.title}</p>
        {meta && <p className="ps-card__meta num" aria-label={month?.hoursLabel ?? undefined}>{meta}</p>}
      </div>
      {children && <div className="ps-card__extra">{children}</div>}
      {month ? (
        month.finished && (
          <span className="ps-card__status">
            <GlyphBadge status={month.finished} title={month.finished === 'completed' ? 'Пройдена в этом месяце' : 'Брошена в этом месяце'} />
          </span>
        )
      ) : !selectMode && !mobile ? (
        <StatusMenu
          value={game.status} onPick={(s) => actions.setStatus(game, s)} label={`Статус: ${game.title}`}
          extra={dateMenuItem(game, actions)} className="ps-card__status" align="end"
        >
          <GlyphBadge status={game.status} />
        </StatusMenu>
      ) : (
        <span className="ps-card__status"><GlyphBadge status={game.status} /></span>
      )}
      <button
        type="button" className="ps-card__hit" aria-pressed={selectMode ? selected : undefined}
        aria-label={`${selectMode ? 'Выбрать' : 'Открыть'}: ${game.title}${plat ? ', платина получена' : ''}`}
        onClick={() => { if (wasLong()) return; if (selectMode) actions.toggle(game); else actions.open(game); }}
        {...handlers}
      />
      {mobile && (
        <StatusSheet
          open={sheet} onClose={() => setSheet(false)} title={game.title} value={game.status}
          onPick={(s) => actions.setStatus(game, s)} extra={dateMenuItem(game, actions)}
        />
      )}
    </article>
  );
}
