'use client';

import type { GameItem, GameStatusValue } from '@/server/collection/types';
import { formatDate, formatPlayTime } from '../format';
import { Icon } from '../icons';
import { StatusChip, StatusMenu } from '../status';
import { Cover } from './Cover';
import { completionInfo } from './filters';

export type GameActions = {
  open: (g: GameItem, editDate?: boolean) => void;
  setStatus: (g: GameItem, s: GameStatusValue | null) => void;
  toggle: (g: GameItem) => void;
};

const TROPHY: readonly { key: 'platinum' | 'gold' | 'silver' | 'bronze'; label: string }[] = [
  { key: 'platinum', label: 'платиновых' }, { key: 'gold', label: 'золотых' },
  { key: 'silver', label: 'серебряных' }, { key: 'bronze', label: 'бронзовых' },
];

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

export function GameCard({
  game, actions, selectMode, selected, active,
}: { game: GameItem; actions: GameActions; selectMode: boolean; selected: boolean; active?: boolean }) {
  const time = formatPlayTime(game.playSeconds);
  const done = completionInfo(game);
  return (
    <article
      className="ps-card" data-status={game.status ?? 'none'} data-selected={selected || undefined} data-select={selectMode || undefined} data-active={active || undefined}
    >
      <div className="ps-card__cover">
        <Cover url={game.coverUrl} title={game.title} />
        <div className="ps-card__top">
          <span className="ps-card__chips">
            {time && <span className="ps-occhip"><Icon name="clock" size={11} />{time}</span>}
            {game.playCount > 0 && <span className="ps-occhip"><Icon name="play" size={10} />{game.playCount}</span>}
          </span>
          <span className="ps-badge-ps" title={game.platform}>PS</span>
        </div>
        {game.trophies?.platinumEarned && (
          <span className="ps-card__plat" title="Платина получена" role="img" aria-label="Платина получена">
            <Icon name="trophy" size={14} />
          </span>
        )}
        {selectMode && (
          <span className="ps-card__check" aria-hidden="true">{selected && <Icon name="check" size={14} />}</span>
        )}
        <div className="ps-card__trophies" aria-label={game.trophies ? 'Трофеи' : 'Трофеев нет'}>
          {TROPHY.map((t) => {
            const n = game.trophies?.byType[t.key].earned ?? 0;
            return (
              <span key={t.key} className="ps-tcell" data-zero={n === 0 || undefined} title={n ? `${n} ${t.label}` : undefined}>
                {n > 0 ? <><Icon name="trophy" size={10} className={`ps-t-${t.key}`} />{n}</> : '—'}
              </span>
            );
          })}
        </div>
      </div>
      <div className="ps-card__cap">
        <StatusMenu value={game.status} onPick={(s) => actions.setStatus(game, s)} label={`Статус: ${game.title}`} extra={dateMenuItem(game, actions)} className="ps-card__status">
          <StatusChip status={game.status} iconOnly />
        </StatusMenu>
        <h3 className="ps-card__title" title={game.title}>{game.title}</h3>
      </div>
      {done && (
        <div className="ps-card__plaque" data-kind={done.kind}>
          {done.kind === 'completed' ? 'Завершено' : 'Брошено'} · {formatDate(done.iso)}
        </div>
      )}
      <button
        type="button" className="ps-card__hit" aria-pressed={selectMode ? selected : undefined}
        aria-label={selectMode ? `Выбрать: ${game.title}` : `Открыть: ${game.title}`}
        onClick={() => (selectMode ? actions.toggle(game) : actions.open(game))}
      />
    </article>
  );
}
