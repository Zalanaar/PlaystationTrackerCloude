'use client';

import { Icon } from '../icons';
import { Cover } from '../collection/Cover';
import type { OtherPlatformGame } from './api';
import { addedDateText } from './model';

/**
 * Строка списка (design-system §19c.3): обложка, название, плашка платформы, дата добавления, корзина.
 * Ни часов, ни статуса, ни фигур; название не ссылка и не кнопка.
 */
export function OtherPlatformRow({ game, collapsing, onRemove }: { game: OtherPlatformGame; collapsing: boolean; onRemove: (g: OtherPlatformGame) => void }) {
  return (
    <li className="ps-op" data-testid="op-row" data-id={game.id} data-collapsing={collapsing || undefined} aria-hidden={collapsing || undefined}>
      <Cover url={game.coverUrl} title={game.title} className="ps-op__cover" />
      <div className="ps-op__text">
        <span className="ps-op__title" title={game.title}>{game.title}</span>
        {game.platformLabel
          ? <span className="ps-plat-tag" title={game.platformLabel} data-testid="op-row-platform">{game.platformLabel}</span>
          : <span className="ps-op__none" data-testid="op-row-platform">Платформа не указана</span>}
        <time className="ps-op__date" dateTime={game.createdAt} data-testid="op-row-date">{addedDateText(game.createdAt)}</time>
      </div>
      <button
        type="button" className="ps-btn ps-btn--icon ps-op__rm" data-testid="op-remove" aria-label={`Убрать из списка: ${game.title}`}
        disabled={collapsing} onClick={() => onRemove(game)}
      >
        <Icon name="trash" size={16} />
      </button>
    </li>
  );
}
