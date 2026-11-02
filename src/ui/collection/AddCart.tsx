'use client';

import Link from 'next/link';
import { useId, type RefObject } from 'react';
import { Icon } from '../icons';
import { BuySegment } from './BuySegment';
import { BATCH_MAX, cartFull, cartLabel, cartPayable, type CartEntry } from './cart';

/** Корзина мультидобавления (design-system §19b.3): липкая панель между телом и нижней строкой панели поиска. */
export function AddCart({
  cart, busy, online, expanded, onToggle, onSetBought, onRemove, onClear, onSubmit, onConfirmDuplicate, banner, bannerRef, requestFailed, onOpenGame,
}: {
  cart: readonly CartEntry[]; busy: boolean; online: boolean; expanded: boolean; onToggle: () => void;
  onSetBought: (id: string, bought: boolean) => void; onRemove: (id: string) => void; onClear: () => void; onSubmit: () => void;
  onConfirmDuplicate: (id: string) => void; banner: string | null; bannerRef: RefObject<HTMLDivElement | null>; requestFailed: boolean;
  /** переход «Открыть в библиотеке» закрывает панель без подтверждения */
  onOpenGame: () => void;
}) {
  const listId = useId();
  if (cart.length === 0 && !banner) return null;
  const payable = cartPayable(cart).length;
  const full = cartFull(cart);
  return (
    <section className="ps-cart" aria-label="Выбранные игры" aria-busy={busy || undefined} data-testid="add-cart">
      {banner && (
        <div ref={bannerRef} tabIndex={-1} className="ps-rec-banner ps-cart__banner" role="alert" data-testid="add-cart-banner">
          <Icon name="circle-alert" size={16} /><span>{banner}</span>
        </div>
      )}
      {requestFailed && (
        <div className="ps-rec-banner ps-cart__banner" role="alert" data-testid="add-cart-banner" data-kind="request">
          <Icon name="circle-alert" size={16} /><span>Не удалось добавить. Повтори.</span>
        </div>
      )}
      {cart.length > 0 && expanded && (
        <div id={listId} className="ps-cart__listwrap">
          <div className="ps-cart__listhead">
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-cart__clear" data-testid="add-cart-clear" disabled={busy} onClick={onClear}>Очистить</button>
          </div>
          <ul className="ps-cart__list" aria-label="Выбранные игры">
            {cart.map((e) => (
              <li key={e.externalId} className="ps-cart__item" data-testid="add-cart-item" data-state={e.state}>
                <span className="ps-cart__title" title={e.title}>{e.title}</span>
                <BuySegment title={e.title} bought={e.bought} compact disabled={busy} testPrefix="add-cart" onChange={(b) => onSetBought(e.externalId, b)} />
                <button
                  type="button" className="ps-cart__x" aria-label={`Убрать из выбранных: ${e.title}`} data-testid="add-cart-remove" disabled={busy}
                  onClick={() => onRemove(e.externalId)}
                ><Icon name="x" size={16} /></button>
                {e.state === 'error' && <p className="ps-add-row__err ps-cart__err" role="alert"><Icon name="circle-alert" size={14} />{e.error ?? 'Не удалось добавить. Повтори.'}</p>}
                {e.state === 'duplicate' && e.dup && (
                  <div className="ps-add-warn ps-cart__warn" role="group" aria-label={`Такая игра уже есть: ${e.title}`} data-testid="add-warn">
                    <h4 className="ps-add-warn__h"><Icon name="circle-alert" size={16} />Такая игра уже есть</h4>
                    {e.dup.game && <p className="ps-add-warn__t">В твоей библиотеке PSN: «{e.dup.game.name}»</p>}
                    {e.dup.planned && <p className="ps-add-warn__t">В Плане: «{e.dup.planned.title}»</p>}
                    <div className="ps-add-warn__btns">
                      {e.dup.game && <Link href={`/?game=${e.dup.game.gameId}`} className="ps-link" onClick={onOpenGame}>Открыть в библиотеке</Link>}
                      <button
                        type="button" className="ps-btn ps-btn--ghost" data-testid="add-warn-confirm" disabled={busy}
                        aria-label={`Всё равно добавить: ${e.title}`} onClick={() => onConfirmDuplicate(e.externalId)}
                      >Всё равно добавить</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {full && <p className="ps-cart__limit">Максимум {BATCH_MAX} за раз</p>}
      {cart.length > 0 && (
        <div className="ps-cart__bar">
          <button
            type="button" className="ps-btn ps-btn--ghost ps-cart__toggle" data-testid="add-cart-toggle" aria-expanded={expanded} aria-controls={listId} onClick={onToggle}
          >
            <Icon name={expanded ? 'chevron-down' : 'chevron-up'} size={16} />
            <span className="ps-cart__lbl">{cartLabel(cart.length)}</span>
            <span className="ps-cart__lbl-s">{cartLabel(cart.length, true)}</span>
          </button>
          {!online && <span className="ps-cart__off">Нет соединения</span>}
          <button
            type="button" className="ps-btn ps-btn--primary ps-cart__go" data-testid="add-cart-submit" disabled={busy || !online || payable === 0} aria-busy={busy || undefined}
            onClick={onSubmit}
          >
            {busy ? <><Icon name="loader" size={14} className="ps-nb-spin" />Добавляю…</> : requestFailed ? `Повторить ${payable}` : `Добавить ${payable}`}
          </button>
        </div>
      )}
    </section>
  );
}
