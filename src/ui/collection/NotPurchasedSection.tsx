'use client';

import { formatNumber } from '../format';
import { Icon } from '../icons';
import type { BacklogView } from './backlog';
import { GameGrid, GameGridItem } from './GameGrid';
import { ManualCard, ManualRow } from './ManualItems';
import type { ManualGame } from './manual';
import type { ManualHandlers } from './manualMenu';

/** Сколько записей секции видно сразу; остальное по «Показать ещё» без запроса (design-system §19b.4). */
export const NB_PAGE = 12;
export const NB_OPEN_KEY = 'ps.bl.nb.open';

/** Состояние «развёрнуто» из localStorage; недоступное хранилище (приватный режим, запрет) = по умолчанию развёрнуто. */
export function readNbOpen(): boolean {
  try {
    return window.localStorage.getItem(NB_OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}
export function writeNbOpen(open: boolean): void {
  try {
    window.localStorage.setItem(NB_OPEN_KEY, open ? '1' : '0');
  } catch {
    // состояние живёт до перезагрузки
  }
}

/**
 * Секция «Не куплено» под основным списком (design-system §19b.4): пунктирная рамка, сворачивание, до 12 записей.
 * Пустая секция остаётся с сообщением «Всё куплено», если в этой сессии записи в ней были.
 */
export function NotPurchasedSection({
  items, view, open, onToggle, showAll, onShowAll, handlers, today,
}: {
  items: readonly ManualGame[]; view: BacklogView; open: boolean; onToggle: () => void; showAll: boolean; onShowAll: () => void;
  handlers: ManualHandlers; today: string;
}) {
  const shown = showAll ? items : items.slice(0, NB_PAGE);
  const rest = items.length - shown.length;
  return (
    <section className="ps-nbsec" id="not-purchased" aria-labelledby="h-bl-nb" data-testid="bl-nb">
      <div className="ps-bl-service__head">
        <h2 className="ps-h2 ps-h2--icon ps-bl-h" id="h-bl-nb" tabIndex={-1}>
          <Icon name="shopping-cart" size={16} />Не куплено <small className="num ps-bl-service__n" data-testid="bl-nb-count">{formatNumber(items.length)}</small>
        </h2>
        <button
          type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-nbsec__toggle" data-testid="bl-nb-toggle" aria-expanded={open} aria-controls="bl-nb-list" onClick={onToggle}
        >
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />{open ? 'Свернуть' : 'Развернуть'}
        </button>
      </div>
      <p className="ps-bl-service__sub">Добавлено, но ещё не куплено. Не входит в статистику и План.</p>
      {open && (
        <div id="bl-nb-list">
          {items.length === 0 ? (
            <div className="ps-nbsec__empty" data-testid="bl-nb-empty">
              <Icon name="shopping-cart" size={32} />
              <h3 className="ps-h3">Всё куплено</h3>
              <p>Добавь новые игры через «Добавить».</p>
            </div>
          ) : view === 'list' ? (
            <ul className="ps-bl-rows" aria-label="Игры «не куплено»">
              {shown.map((g) => <ManualRow key={g.id} game={g} handlers={handlers} today={today} />)}
            </ul>
          ) : (
            <GameGrid density="comfort" label="Игры «не куплено»">
              {shown.map((g) => <GameGridItem key={g.id}><ManualCard game={g} handlers={handlers} today={today} /></GameGridItem>)}
            </GameGrid>
          )}
          {rest > 0 && (
            <div className="ps-more">
              <button type="button" className="ps-btn" data-testid="bl-nb-more" onClick={onShowAll}>Показать ещё ({formatNumber(rest)})</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
