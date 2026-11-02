'use client';

import { useState } from 'react';
import type { DurationCounts, GenreCounts, HltbCounts } from '@/server/collection/types';
import { formatNumber } from '../format';
import { Icon } from '../icons';
import { Popover } from '../primitives/Popover';
import { Sheet } from '../primitives/Sheet';
import { activeBacklogCount, type BacklogFilters as Filters, type BacklogView } from './backlog';
import { BacklogFilterPanel } from './BacklogFilterPanel';

/** Переключатель вида «Карточки / Список» (Фаза 33). */
export function BacklogViewSeg({ view, onView }: { view: BacklogView; onView: (v: BacklogView) => void }) {
  return (
    <div className="ps-seg ps-bl-seg" role="group" aria-label="Вид">
      <button type="button" aria-pressed={view === 'cards'} aria-label="Карточки" title="Карточки" onClick={() => onView('cards')}><Icon name="grid" size={16} /></button>
      <button type="button" aria-pressed={view === 'list'} aria-label="Список" title="Список" onClick={() => onView('list')}><Icon name="list" size={16} /></button>
    </div>
  );
}

/** Меню страницы «…»: подгрузка длительности с HLTB и перепроверка не найденных. */
export function BacklogPageMenu({ running, onHltb, onAdd }: { running: boolean; onHltb: (recheckNotFound: boolean) => void; onAdd?: () => void }) {
  return (
    <Popover
      align="end" className="ps-bl-pagemenu"
      trigger={(t) => (
        <button type="button" className="ps-btn ps-btn--icon" aria-label="Ещё: действия со страницей" title="Ещё" data-testid="bl-menu" {...t}>
          <Icon name="more" size={18} />
        </button>
      )}
    >
      {(close) => (
        <>
          {onAdd && (
            <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall" data-testid="bl-menu-add" onClick={() => { close(); onAdd(); }}>
              <Icon name="plus" size={16} />
              <span className="ps-menu-item__label">Добавить из магазина PS</span>
            </button>
          )}
          <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall" disabled={running} data-testid="hltb-start" onClick={() => { close(); onHltb(false); }}>
            <Icon name="cloud-download" size={16} />
            <span className="ps-menu-item__label">
              Подтянуть длительность с HLTB
              <small className="ps-menu-item__hint">Для игр без оценки</small>
            </span>
          </button>
          <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall" disabled={running} data-testid="hltb-recheck" onClick={() => { close(); onHltb(true); }}>
            <Icon name="refresh" size={16} />
            <span className="ps-menu-item__label">
              Перепроверить не найденные
              <small className="ps-menu-item__hint">Ещё раз искать игры, которых не было на HLTB</small>
            </span>
          </button>
        </>
      )}
    </Popover>
  );
}

/** Мобильная панель: кнопка «Фильтры» (sheet с сортировкой и фильтрами) и переключатель вида. */
export function BacklogMobileBar({
  filters, counts, genreCounts, hltbCounts, total, nbCount = 0, view, onView, onChange, onReset, onSearch,
}: {
  filters: Filters; counts: DurationCounts | null; genreCounts: GenreCounts | null; hltbCounts: HltbCounts | null; total: number; nbCount?: number;
  view: BacklogView; onView: (v: BacklogView) => void; onChange: (p: Partial<Filters>) => void; onReset: () => void;
  /** иконка поиска между «Фильтры» и видом (Фаза 43.1): открывает лист «Поиск» */
  onSearch?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const n = activeBacklogCount(filters);
  return (
    <div className="ps-bl-bar">
      <button
        type="button" className="ps-btn ps-bl-bar__filters" aria-haspopup="dialog" data-active={n > 0 || undefined}
        aria-label={n > 0 ? `Фильтры и сортировка, активно: ${n}` : 'Фильтры и сортировка'} onClick={() => setOpen(true)}
      >
        <Icon name="sliders-h" size={18} />
        <span>Фильтры</span>
        {n > 0 && <span className="ps-filterchip__n num ps-bl-bar__n">{formatNumber(n)}</span>}
      </button>
      {onSearch && (
        <button
          type="button" className="ps-btn ps-btn--icon ps-bl-bar__search" aria-haspopup="dialog" data-testid="bs-open" data-active={filters.q ? 'true' : undefined}
          aria-label={filters.q ? 'Поиск по бэклогу, задан запрос' : 'Поиск по бэклогу'} onClick={onSearch}
        >
          <Icon name="search" size={18} />
        </button>
      )}
      <BacklogViewSeg view={view} onView={onView} />
      <Sheet open={open} onClose={() => setOpen(false)} title="Фильтры и сортировка">
        <BacklogFilterPanel
          filters={filters} counts={counts} genreCounts={genreCounts} hltbCounts={hltbCounts} total={total} nbCount={nbCount}
          onChange={onChange} onReset={onReset} onDone={() => setOpen(false)}
        />
      </Sheet>
    </div>
  );
}
