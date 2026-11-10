'use client';

import { useRef } from 'react';
import { Icon } from '../icons';
import { Popover } from '../primitives/Popover';
import { gamePage, type ManualGame } from './manual';

export type ManualHandlers = {
  /** «Купил»: снять пометку (оптимистично, с тостом «Отменить») */
  bought: (g: ManualGame, restoreFocus: () => void) => void;
  /** «Убрать из бэклога»: открыть подтверждение */
  remove: (g: ManualGame) => void;
};

/** Меню «…» записи «не куплено» (§19.5): Купил, Открыть на RAWG, Убрать из бэклога. Фокус после «Купил» остаётся на «…». */
export function ManualMenu({ game, handlers, className }: { game: ManualGame; handlers: ManualHandlers; className?: string }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const page = gamePage(game);
  const url = page?.url ?? null;
  return (
    <Popover
      align="end" className={className}
      trigger={(t) => (
        <button ref={triggerRef} type="button" className="ps-btn ps-btn--icon ps-nbmore" aria-label={`Действия: ${game.title}`} {...t}>
          <Icon name="more" size={18} />
        </button>
      )}
    >
      {(close) => (
        <>
          {game.notPurchased && (
            <button
              type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall" data-testid="np-menu-bought"
              onClick={() => { close(); handlers.bought(game, () => triggerRef.current?.focus()); }}
            >
              <Icon name="check" size={16} />
              <span className="ps-menu-item__label">Купил<small className="ps-menu-item__hint">Снять пометку «Не куплено»</small></span>
            </button>
          )}
          {url && (
            <a
              role="menuitem" className="ps-menu-item ps-menu-item--tall" href={url} target="_blank" rel="noopener noreferrer"
              aria-label={`Открыть ${game.title} на ${page?.site ?? 'RAWG'} (новая вкладка)`} onClick={close}
            >
              <Icon name="external-link" size={16} />
              <span className="ps-menu-item__label">Открыть на {page?.site ?? 'RAWG'}</span>
            </a>
          )}
          <button
            type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall ps-menu-item--sep" data-testid="np-menu-remove"
            onClick={() => { close(); triggerRef.current?.focus(); handlers.remove(game); }}
          >
            <Icon name="trash" size={16} />
            <span className="ps-menu-item__label">Убрать из бэклога<small className="ps-menu-item__hint">Игра пропадёт из списка</small></span>
          </button>
        </>
      )}
    </Popover>
  );
}
