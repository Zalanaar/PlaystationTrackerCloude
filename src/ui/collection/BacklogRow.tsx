'use client';

import type { GameItem } from '@/server/collection/types';
import { Icon, PlatinumIcon } from '../icons';
import { Popover } from '../primitives/Popover';
import { RemainingMeter } from './RemainingMeter';
import { Cover } from './Cover';

export type RowMenuItem = { label: string; run: () => void };

/** Строка вида «Список» страницы «Бэклог» (Фаза 33): обложка, название, длительность, «Играть» и меню «…». Нажатие на строку открывает окно игры. */
export function BacklogRow({
  game, onOpen, onPlay, menu, hideBar = false,
}: { game: GameItem; onOpen: () => void; onPlay: () => void; menu: readonly RowMenuItem[]; hideBar?: boolean }) {
  const plat = game.trophies?.platinumEarned === true;
  return (
    <li className="ps-blrow" data-testid="bl-row">
      <Cover url={game.coverUrl} title={game.title} className="ps-blrow__thumb" />
      <div className="ps-blrow__text">
        <span className="ps-blrow__title" title={game.title}>
          {game.title}
          {plat && <PlatinumIcon size={14} className="ps-blrow__plat" title="Платина получена" />}
        </span>
        <RemainingMeter duration={game.duration} playedSeconds={game.playSeconds} variant="row" hideBar={hideBar} />
      </div>
      <button type="button" className="ps-btn ps-btn--primary ps-blrow__play" aria-label={`Начать играть: ${game.title}`} onClick={onPlay}>
        Играть
      </button>
      <Popover
        align="end" className="ps-blrow__menu"
        trigger={(t) => (
          <button type="button" className="ps-btn ps-btn--icon ps-blrow__more" aria-label={`Действия: ${game.title}`} {...t}>
            <Icon name="more" size={18} />
          </button>
        )}
      >
        {(close) => menu.map((m) => (
          <button key={m.label} type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall" onClick={() => { close(); m.run(); }}>
            <span className="ps-menu-item__label">{m.label}</span>
          </button>
        ))}
      </Popover>
      <button type="button" className="ps-blrow__hit" aria-label={`Открыть: ${game.title}`} onClick={onOpen} />
    </li>
  );
}
