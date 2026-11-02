'use client';

import { Icon, StatusGlyph } from '../icons';
import { STATUS_META } from '../tokens';
import { Cover } from './Cover';
import { manualAria, manualMeta, releaseMeta, type ManualGame } from './manual';
import { ManualMenu, type ManualHandlers } from './manualMenu';
import { NotPurchasedBadge } from './NotPurchasedBadge';

/** Кнопка «Купил» (ghost) в слоте «Играть»: у записи без данных PSN играть нечем. */
function BoughtButton({ game, handlers, className }: { game: ManualGame; handlers: ManualHandlers; className?: string }) {
  return (
    <button
      type="button" className={`ps-btn ps-btn--ghost ps-nb-bought ${className ?? ''}`} data-testid="np-bought"
      aria-label={`Купил: ${game.title}`} onClick={(e) => handlers.bought(game, () => (e.currentTarget.closest('[data-manual]')?.querySelector<HTMLElement>('.ps-nbmore'))?.focus())}
    >
      <Icon name="check" size={14} />Купил
    </button>
  );
}

/**
 * Карточка записи «не куплено» (десктоп, §19.2): окна игры и смены статуса нет. Фигура □ остаётся неинтерактивной.
 * После «Купил» пометка исчезает, мета «Ждём первый запуск».
 */
export function ManualCard({ game, handlers, today }: { game: ManualGame; handlers: ManualHandlers; today: string }) {
  const meta = manualMeta(game, today);
  return (
    <article className="ps-card ps-card--manual" data-manual={game.id} data-status="backlog" data-not-purchased={game.notPurchased || undefined} aria-label={manualAria(game, today)}>
      <div className="ps-card__cover">
        <Cover url={game.coverUrl} title={game.title} />
        {game.notPurchased && <NotPurchasedBadge variant="cover" />}
        <div className="ps-card__hov" aria-hidden="true">
          <b>{game.title}</b>
          <span>{releaseMeta(game.releaseDate, today)}</span>
          <span>Нет в библиотеке PSN</span>
        </div>
      </div>
      <div className="ps-card__body">
        <p className="ps-card__title" title={game.title}>{game.title}</p>
        <p className="ps-card__meta">{meta}</p>
      </div>
      <div className="ps-card__extra">
        <div className="ps-nb-actions">
          {game.notPurchased && <BoughtButton game={game} handlers={handlers} />}
          <ManualMenu game={game} handlers={handlers} className="ps-nb-actions__menu" />
        </div>
      </div>
      <span className="ps-card__status">
        <span className="ps-card__glyph" data-status="backlog" aria-disabled="true" title={STATUS_META.backlog.label}>
          <StatusGlyph status="backlog" size={16} />
        </span>
      </span>
    </article>
  );
}

/** Строка списка (мобильный «Список» Фазы 33 и десктопный список): пометка рядом с метой, без «Играть» и без перехода в окно игры. */
export function ManualRow({ game, handlers, today }: { game: ManualGame; handlers: ManualHandlers; today: string }) {
  return (
    <li className="ps-blrow ps-blrow--manual" data-testid="bl-row" data-manual={game.id} data-not-purchased={game.notPurchased || undefined}>
      <Cover url={game.coverUrl} title={game.title} className="ps-blrow__thumb" />
      <div className="ps-blrow__text">
        <span className="ps-blrow__title" title={game.title}>{game.title}</span>
        <span className="ps-nb-meta">
          {game.notPurchased && <NotPurchasedBadge />}
          <span className="ps-nb-meta__t">{manualMeta(game, today)}</span>
        </span>
      </div>
      {game.notPurchased && <BoughtButton game={game} handlers={handlers} className="ps-nb-bought--row" />}
      <ManualMenu game={game} handlers={handlers} className="ps-blrow__menu" />
    </li>
  );
}
