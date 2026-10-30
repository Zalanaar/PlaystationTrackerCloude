'use client';

import type { GameStatusValue } from '@/server/collection/types';
import { Icon } from '../../icons';
import { StatusMenu } from '../../status';

export function SelectBar({
  count, total, onAll, onPick, onCancel, hiddenView, onHide,
}: {
  count: number; total: number; onAll: () => void; onPick: (s: GameStatusValue | null) => void; onCancel: () => void;
  /** в «Скрытых» вместо статусов одна кнопка «Вернуть в коллекцию» (статусы скрытых массово не меняются, 9.6) */
  hiddenView: boolean; onHide: () => void;
}) {
  return (
    <div className="ps-selbar" role="region" aria-label="Выбор игр">
      <span className="ps-selbar__n">Выбрано {count}</span>
      <button type="button" className="ps-link" onClick={onAll}>Выбрать все ({total})</button>
      <span className="ps-section__spacer" />
      {hiddenView ? (
        <button type="button" className="ps-btn ps-btn--primary" disabled={!count} onClick={onHide}>
          <Icon name="undo" size={16} />Вернуть в коллекцию
        </button>
      ) : (
        <>
          <StatusMenu onPick={onPick} label="Поставить статус" className="ps-selbar__menu">
            <span className={`ps-btn ps-btn--primary ${count ? '' : 'ps-btn--off'}`} aria-disabled={!count}>Поставить статус<Icon name="chevron-down" size={14} /></span>
          </StatusMenu>
          <button type="button" className="ps-btn" aria-label="Сбросить статус" title="Сбросить статус" disabled={!count} onClick={() => onPick(null)}>
            <Icon name="undo" size={16} /><span className="ps-btn__t">Сбросить статус</span>
          </button>
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--danger" aria-label="Убрать из коллекции" title="Убрать из коллекции" disabled={!count} onClick={onHide}>
            <Icon name="eye-off" size={16} /><span className="ps-btn__t">Убрать из коллекции</span>
          </button>
        </>
      )}
      <button type="button" className="ps-btn" onClick={onCancel}>Отмена</button>
    </div>
  );
}

