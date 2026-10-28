'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StatusCounts } from '@/server/collection/types';
import { formatNumber } from '../format';
import { Icon, StatusGlyph } from '../icons';
import { useIsMobile } from '../primitives/hooks';
import { Popover } from '../primitives/Popover';
import { Sheet } from '../primitives/Sheet';
import { hasActiveFilters, SORT_OPTIONS, STATUS_TABS, type Filters, type StatusTab } from './filters';
import { VIEW_LABELS, VIEW_MODES, type ViewMode } from '../tokens';

const DEBOUNCE_MS = 250;

function SearchBox({ value, onCommit }: { value: string; onCommit: (q: string) => void }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const last = useRef(value);

  // внешнее изменение (сброс, назад в истории)
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      const t = setTimeout(() => setText(value), 0);
      return () => clearTimeout(t);
    }
  }, [value]);

  useEffect(() => {
    if (text === last.current) return;
    const t = setTimeout(() => {
      last.current = text;
      onCommit(text);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, onCommit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      e.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="ps-search">
      <Icon name="search" size={16} className="ps-search__icon" />
      <input
        ref={ref} type="search" className="ps-search__input" placeholder="Поиск игры…" aria-label="Поиск игры" value={text} maxLength={100}
        onChange={(e) => setText(e.target.value)}
      />
      {!text && <kbd className="ps-search__kbd" aria-hidden="true">/</kbd>}
      {text && (
        <button type="button" className="ps-search__clear" aria-label="Очистить поиск" onClick={() => { setText(''); ref.current?.focus(); }}>
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

function SortSelect({ f, onChange }: { f: Filters; onChange: (p: Partial<Filters>) => void }) {
  return (
    <label className="ps-select">
      <span className="ps-sr">Сортировка</span>
      <select value={f.sort} onChange={(e) => onChange({ sort: e.target.value as Filters['sort'], order: null })}>
        {SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <Icon name="chevron-down" size={14} />
    </label>
  );
}

function ViewSeg({ view, onView }: { view: ViewMode; onView: (v: ViewMode) => void }) {
  return (
    <div className="ps-seg" role="group" aria-label="Вид">
      {VIEW_MODES.map((v) => (
        <button key={v} type="button" aria-pressed={view === v} onClick={() => onView(v)}>{VIEW_LABELS[v]}</button>
      ))}
    </div>
  );
}

/** Пункты меню коллекции «…» (десктоп) и раздела «Коллекция» в sheet «Фильтры» (мобильный). */
function CollectionMenuItems({ hidden, onHidden, onResetAll, close }: { hidden: boolean; onHidden: (v: boolean) => void; onResetAll: () => void; close: () => void }) {
  return (
    <>
      <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall" onClick={() => { close(); onHidden(!hidden); }}>
        <Icon name={hidden ? 'library' : 'eye-off'} size={16} />
        <span className="ps-menu-item__label">
          {hidden ? 'Вся коллекция' : 'Скрытые игры'}
          {!hidden && <small className="ps-menu-item__hint">Убранные из коллекции, можно вернуть</small>}
        </span>
      </button>
      {!hidden && (
        <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall ps-menu-item--sep ps-menu-item--danger" onClick={() => { close(); onResetAll(); }}>
          <Icon name="undo" size={16} />
          <span className="ps-menu-item__label">Сбросить все статусы…</span>
        </button>
      )}
    </>
  );
}

function CollectionMenu(p: { hidden: boolean; onHidden: (v: boolean) => void; onResetAll: () => void }) {
  return (
    <Popover
      align="end" className="ps-collmenu"
      trigger={(t) => (
        <button type="button" className="ps-btn ps-btn--icon" aria-label="Ещё: действия с коллекцией" title="Ещё" {...t}>
          <Icon name="more" size={18} />
        </button>
      )}
    >
      {(close) => <CollectionMenuItems {...p} close={close} />}
    </Popover>
  );
}

export function FilterBar({
  filters, view, counts, onChange, onView, onReset, selectMode, onSelect, canSelect, onHidden, onResetAll,
}: {
  filters: Filters; view: ViewMode; counts: StatusCounts | null;
  onChange: (p: Partial<Filters>) => void; onView: (v: ViewMode) => void; onReset: () => void;
  selectMode: boolean; onSelect: () => void; canSelect: boolean;
  /** Раздел «Скрытые»: войти (true) / выйти (false) */
  onHidden: (v: boolean) => void;
  onResetAll: () => void;
}) {
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState(false);
  const active = hasActiveFilters(filters);
  const commit = useCallback((q: string) => onChange({ q }), [onChange]);

  const selectBtn = (
    <button type="button" className="ps-btn ps-btn--select" aria-pressed={selectMode} aria-label={selectMode ? 'Готово' : 'Выбрать'} onClick={onSelect} disabled={!canSelect}>
      <Icon name="check-circle" size={16} /><span className="ps-btn__t">{selectMode ? 'Готово' : 'Выбрать'}</span>
    </button>
  );

  return (
    <div className="ps-filters">
      <div className="ps-filters__row">
        <SearchBox value={filters.q} onCommit={commit} />
        <div className="ps-tabs" role="group" aria-label="Статус">
          {STATUS_TABS.map((t) => {
            const n = counts ? counts[t.id === 'all' ? 'all' : (t.id as Exclude<StatusTab, 'all'>)] : null;
            const wide = t.id === 'all' || t.id === 'none';
            return (
              <button
                key={t.id} type="button" className="ps-filterchip" data-wide={wide || undefined} aria-label={n !== null ? `${t.label}: ${formatNumber(n)}` : t.label}
                title={t.id === 'service' ? 'Игра-сервис' : undefined} aria-pressed={filters.status === t.id} onClick={() => onChange({ status: t.id })}
              >
                {t.id !== 'all' && <StatusGlyph status={t.id} size={16} />}
                <span className="ps-filterchip__t">{t.label}</span>
                {n !== null && <span className="ps-filterchip__n num">{formatNumber(n)}</span>}
              </button>
            );
          })}
        </div>
        {!mobile && <SortSelect f={filters} onChange={onChange} />}
        {!mobile && <ViewSeg view={view} onView={onView} />}
        {!mobile && selectBtn}
        {active && !mobile && <button type="button" className="ps-link" onClick={onReset}>Сбросить</button>}
        {!mobile && <CollectionMenu hidden={filters.hidden} onHidden={onHidden} onResetAll={onResetAll} />}
      </div>
      {mobile && (
        <div className="ps-filters__row2">
          <button type="button" className="ps-btn ps-btn--filters" onClick={() => setSheet(true)} aria-haspopup="dialog">
            <Icon name="sliders-h" size={16} />Фильтры
          </button>
          <ViewSeg view={view} onView={onView} />
          {selectBtn}
        </div>
      )}
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Фильтры">
        <div className="ps-stack">
          <SortSelect f={filters} onChange={onChange} />
          {active && <button type="button" className="ps-link" onClick={() => { onReset(); setSheet(false); }}>Сбросить фильтры</button>}
          <div role="menu" aria-label="Коллекция" className="ps-list ps-filters__coll">
            <CollectionMenuItems hidden={filters.hidden} onHidden={onHidden} onResetAll={onResetAll} close={() => setSheet(false)} />
          </div>
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => setSheet(false)}>Готово</button>
        </div>
      </Sheet>
    </div>
  );
}
