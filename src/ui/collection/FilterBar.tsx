'use client';

import { useEffect, useRef, useState } from 'react';
import type { StatusCounts } from '@/server/collection/types';
import { formatNumber } from '../format';
import { Icon, StatusIcon } from '../icons';
import { useIsMobile } from '../primitives/hooks';
import { Sheet } from '../primitives/Sheet';
import type { StatusKey } from '../tokens';
import { hasActiveFilters, SORT_OPTIONS, STATUS_TABS, type Filters, type StatusTab } from './filters';

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
      {text && (
        <button type="button" className="ps-search__clear" aria-label="Очистить поиск" onClick={() => { setText(''); ref.current?.focus(); }}>
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

function Selects({ f, years, onChange }: { f: Filters; years: number[]; onChange: (p: Partial<Filters>) => void }) {
  return (
    <>
      <label className="ps-select">
        <span className="ps-sr">Год завершения</span>
        <select
          value={f.year ?? ''} onChange={(e) => onChange({ year: e.target.value ? +e.target.value : null })}
          title="Год даты завершения (пройдено или брошено)"
        >
          <option value="">Все годы</option>
          {f.year !== null && !years.includes(f.year) && <option value={f.year}>{f.year}</option>}
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <Icon name="chevron-down" size={14} />
      </label>
      <label className="ps-select">
        <span className="ps-sr">Сортировка</span>
        <select value={f.sort} onChange={(e) => onChange({ sort: e.target.value as Filters['sort'], order: null })}>
          {SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <Icon name="chevron-down" size={14} />
      </label>
    </>
  );
}

export function FilterBar({
  filters, counts, years, onChange, onReset,
}: {
  filters: Filters; counts: StatusCounts | null; years: number[];
  onChange: (p: Partial<Filters>) => void; onReset: () => void;
}) {
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState(false);
  const active = hasActiveFilters(filters);
  const commit = (q: string) => onChange({ q });

  return (
    <div className="ps-filters">
      <div className="ps-filters__row">
        <SearchBox value={filters.q} onCommit={commit} />
        {mobile ? (
          <button type="button" className="ps-btn ps-btn--filters" onClick={() => setSheet(true)} aria-haspopup="dialog">
            <Icon name="sliders" size={16} />Фильтры
          </button>
        ) : (
          <Selects f={filters} years={years} onChange={onChange} />
        )}
        {active && !mobile && <button type="button" className="ps-link" onClick={onReset}>Сбросить</button>}
      </div>
      <div className="ps-tabs" role="group" aria-label="Статус">
        {STATUS_TABS.map((t) => {
          const key: StatusKey | null = t.id === 'all' ? null : (t.id as StatusKey);
          const n = counts ? counts[t.id === 'all' ? 'all' : (t.id as Exclude<StatusTab, 'all'>)] : null;
          return (
            <button key={t.id} type="button" className="ps-filterchip" aria-pressed={filters.status === t.id} onClick={() => onChange({ status: t.id })}>
              {key && <StatusIcon status={key} size={14} />}
              {t.label}
              {n !== null && <span className="ps-filterchip__n ps-num">{formatNumber(n)}</span>}
            </button>
          );
        })}
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Фильтры">
        <div className="ps-stack">
          <Selects f={filters} years={years} onChange={onChange} />
          {active && <button type="button" className="ps-link" onClick={() => { onReset(); setSheet(false); }}>Сбросить фильтры</button>}
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => setSheet(false)}>Готово</button>
        </div>
      </Sheet>
    </div>
  );
}
