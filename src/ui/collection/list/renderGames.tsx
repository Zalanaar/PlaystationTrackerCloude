import type { ReactNode } from 'react';
import type { GameItem } from '@/server/collection/types';
import { formatNumber } from '../../format';
import { Icon } from '../../icons';
import type { BlockId } from '../blocks';
import { previewSlots } from '../chronicle';
import { GameCard } from '../GameCard';
import { GameGrid, GameGridItem } from '../GameGrid';
import { GameRow, RowHeader } from '../GameRow';
import type { RenderCtx } from './renderCtx';

export type GamesOpts = { dateYear?: boolean; withHeader?: boolean; anchors?: Map<number, string>; /** сколько первых обложек грузить с приоритетом (первый ряд) */ eager?: number };

export function renderGames(c: RenderCtx, list: GameItem[], opts: GamesOpts = {}): ReactNode {
  const { view, filters, actions, selectMode, selected, hiddenView, density, setFilters, setHidden } = c;
  if (view === 'list') {
    return (
      <div className="ps-row-table" role="table" aria-label="Игры">
        {opts.withHeader && (
          <RowHeader sort={filters.sort} order={filters.order} onSort={(s) => setFilters({ sort: s, order: s === filters.sort ? ((filters.order ?? (s === 'title' ? 'asc' : 'desc')) === 'asc' ? 'desc' : 'asc') : null })} />
        )}
        {list.map((g) => <GameRow key={g.id} game={g} actions={actions} selectMode={selectMode} selected={selected.has(g.id)} anchorId={opts.anchors?.get(g.id)} />)}
      </div>
    );
  }
  return (
    <GameGrid density={density}>
      {list.map((g, i) => (
        <GameGridItem key={g.id}>
          <GameCard game={g} actions={actions} selectMode={selectMode} selected={selected.has(g.id)} dateWithYear={opts.dateYear} anchorId={opts.anchors?.get(g.id)} priority={i < (opts.eager ?? 0)}>
            {hiddenView && !selectMode && (
              <button type="button" className="ps-btn ps-btn--sm ps-card__restore" aria-label={`Вернуть в коллекцию: ${g.title}`} onClick={() => void setHidden(g, false)}>
                <Icon name="undo" size={14} /><span>Вернуть в коллекцию</span>
              </button>
            )}
          </GameCard>
        </GameGridItem>
      ))}
    </GameGrid>
  );
}

/** Превью одним рядом: cols - 1 обложек и плитка «+N ещё». */
export function renderPreview(c: RenderCtx, list: GameItem[], total: number, tile: ReactNode): ReactNode {
  const { view, cols, density, actions, selectMode, selected } = c;
  const slots = previewSlots(total, view === 'list' ? 5 : cols);
  const shown = list.slice(0, slots.shown);
  if (view === 'list') {
    return (
      <>
        {renderGames(c, shown)}
        {slots.rest > 0 && <div className="ps-preview__more">{tile}</div>}
      </>
    );
  }
  return (
    <GameGrid density={density}>
      {shown.map((g) => (
        <GameGridItem key={g.id}><GameCard game={g} actions={actions} selectMode={selectMode} selected={selected.has(g.id)} /></GameGridItem>
      ))}
      {slots.rest > 0 && <GameGridItem>{tile}</GameGridItem>}
    </GameGrid>
  );
}

export const moreBtn = (c: RenderCtx, block: BlockId | null, remaining: number) => remaining > 0 && (
  <div className="ps-more">
    <button type="button" className="ps-btn" onClick={() => void c.loadMore(block)} disabled={c.more}>
      {c.more ? 'Загрузка…' : `Показать ещё (${formatNumber(remaining)})`}
    </button>
  </div>
);
