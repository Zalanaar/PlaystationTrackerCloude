'use client';

// П15.6: блоки «Отложено» и «Сервис» страницы Бэклога — общий каркас (заголовок с числом, свернуть/развернуть, сетка или строки).
import type { ReactNode } from 'react';
import type { GameItem } from '@/server/collection/types';
import { EmptyState } from '../EmptyState';
import { formatNumber } from '../format';
import { Icon, StatusGlyph } from '../icons';
import { GameCard, type GameActions } from './GameCard';
import { GameGrid, GameGridItem } from './GameGrid';
import type { BacklogView } from './backlog';

type Kind = 'shelved' | 'service';
const META: Record<Kind, { title: string; sub: string; label: string }> = {
  shelved: { title: 'Отложено', sub: 'Отложено на потом. В бэклог и план эти игры не входят.', label: 'Отложенные игры' },
  service: { title: 'Сервис', sub: 'Не попадают в план прохождения.', label: 'Сервис' },
};

export function BacklogSideSection({ kind, items, total, open, onToggle, view, rows, actions, cardBody, more }: {
  kind: Kind;
  items: GameItem[];
  total: number;
  open: boolean;
  onToggle: () => void;
  view: BacklogView;
  /** вид «Список»: строки страницы (с меню), рисует BacklogView */
  rows: (list: GameItem[], kind: Kind, label: string) => ReactNode;
  actions: GameActions;
  /** содержимое карточки под обложкой (кнопки действий) */
  cardBody: (g: GameItem) => ReactNode;
  /** «Показать ещё» (только «Отложено») */
  more?: { busy: boolean; onMore: () => void };
}) {
  const m = META[kind];
  return (
    <section className="ps-bl-service" id={kind} aria-labelledby={`h-bl-${kind}`} data-testid={`bl-${kind}`}>
      <div className="ps-bl-service__head">
        <h2 className="ps-h2 ps-h2--icon ps-bl-h" id={`h-bl-${kind}`} tabIndex={-1}>
          <StatusGlyph status={kind} size={16} />{m.title} <small className="num ps-bl-service__n" data-testid={`bl-${kind}-count`}>{formatNumber(total)}</small>
        </h2>
        <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" aria-expanded={open} aria-controls={`bl-${kind}-list`} onClick={onToggle}>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />{open ? 'Свернуть' : 'Развернуть'}
        </button>
      </div>
      <p className="ps-bl-service__sub">{m.sub}</p>
      {open && (
        <div id={`bl-${kind}-list`}>
          {kind === 'shelved' && items.length === 0 ? (
            <EmptyState icon={<StatusGlyph status="shelved" size={40} />} title="Отложенных игр нет" text="Поставь игре статус «Отложено» в меню карточки, и она появится здесь." />
          ) : view === 'list' ? rows(items, kind, m.label) : (
            <GameGrid density="comfort" label={m.label}>
              {items.map((g) => (
                <GameGridItem key={g.id}>
                  <GameCard game={g} actions={actions} selectMode={false} selected={false}>{cardBody(g)}</GameCard>
                </GameGridItem>
              ))}
            </GameGrid>
          )}
          {more && items.length > 0 && items.length < total && (
            <div className="ps-more">
              <button type="button" className="ps-btn" data-testid={`bl-${kind}-more`} onClick={more.onMore} disabled={more.busy}>
                {more.busy ? 'Загрузка…' : `Показать ещё (${formatNumber(total - items.length)})`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
