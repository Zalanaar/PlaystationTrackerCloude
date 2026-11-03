'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StatusCounts } from '@/server/collection/types';
import { formatNumber } from '../format';
import { Icon, PlatinumIcon, StatusGlyph } from '../icons';
import { Popover } from '../primitives/Popover';
import { Sheet } from '../primitives/Sheet';
import { filtersDot, hasActiveFilters, SORT_OPTIONS, STATUS_TABS, type Filters, type StatusTab } from './filters';
import { VIEW_LABELS, VIEW_MODES, type ViewMode } from '../tokens';
import { PLATFORM_KEY_LABEL, parsePlatform, platformChoices, type PlatformCounts } from '@/shared/platform-filter';

const DEBOUNCE_MS = 250;

function SearchBox({ value, onCommit, autoFocus, onEscape }: { value: string; onCommit: (q: string) => void; autoFocus?: boolean; onEscape?: () => void }) {
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

  // D-P1: открыто кнопкой шапки — курсор сразу в поле (iOS показывает клавиатуру, жест пользователя тот же кадр)
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <div className="ps-search" data-tour="search">
      <Icon name="search" size={16} className="ps-search__icon" />
      <input
        ref={ref} type="search" className="ps-search__input" placeholder="Поиск игры…" aria-label="Поиск игры" value={text} maxLength={100}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && onEscape && !text) onEscape(); }}
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

export type BackupInfo = { id: number; createdAt: string; count: number };

/** Пункты меню коллекции «…» (десктоп) и раздела «Коллекция» в sheet «Фильтры» (мобильный). Сброс и откат статусов: меню профиля (Фаза 48). */
function CollectionMenuItems({ hidden, onHidden, close }: { hidden: boolean; onHidden: (v: boolean) => void; close: () => void }) {
  return (
    <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall" onClick={() => { close(); onHidden(!hidden); }}>
      <Icon name={hidden ? 'library' : 'eye-off'} size={16} />
      <span className="ps-menu-item__label">
        {hidden ? 'Вся коллекция' : 'Скрытые игры'}
        {!hidden && <small className="ps-menu-item__hint">Убранные из коллекции, можно вернуть</small>}
      </span>
    </button>
  );
}

function CollectionMenu(p: { hidden: boolean; onHidden: (v: boolean) => void }) {
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

type BarProps = {
  filters: Filters; view: ViewMode; counts: StatusCounts | null;
  /** F4: игр по платформам из сводки; null, пока сводка грузится */
  platformCounts: PlatformCounts | null;
  /** Игр с платиной (`platinumChipCount`: сводка или, при поиске, текущая выборка); null, пока сводка грузится */
  platinumCount: number | null;
  onChange: (p: Partial<Filters>) => void; onView: (v: ViewMode) => void; onReset: () => void;
  selectMode: boolean; onSelect: () => void; canSelect: boolean;
  /** Раздел «Скрытые»: войти (true) / выйти (false) */
  onHidden: (v: boolean) => void;
  /** Ничего не найдено: сброс уже есть в пустом состоянии, второй ссылки в панели не нужно (Фаза 48, п. 15) */
  empty?: boolean;
};

/** Чипы статуса и чип «Платина»: общие для десктопа и мобильного слота под hero. */
function StatusChips({ filters, counts, platinumCount, onChange }: Pick<BarProps, 'filters' | 'counts' | 'platinumCount' | 'onChange'>) {
  return (
    <div className="ps-tabs" data-tour="filters">
      <div className="ps-tabs__grp" role="group" aria-label="Статус">
        {STATUS_TABS.map((t) => {
          const n = counts ? counts[t.id === 'all' ? 'all' : (t.id as Exclude<StatusTab, 'all'>)] : null;
          const wide = t.id === 'all' || t.id === 'none';
          return (
            <button
              key={t.id} type="button" className="ps-filterchip ps-chip" data-wide={wide || undefined} aria-label={n !== null ? `${t.label}: ${formatNumber(n)}` : t.label}
              title={t.id === 'service' ? 'Игра-сервис' : undefined} aria-pressed={filters.status === t.id} onClick={() => onChange({ status: t.id })}
            >
              {t.id !== 'all' && <StatusGlyph status={t.id} size={16} />}
              <span className="ps-filterchip__t">{t.label}</span>
              {n !== null ? <span className="ps-filterchip__n num">{formatNumber(n)}</span> : <span className="ps-filterchip__n num" style={{ display: 'inline-block', width: '2ch' }} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <span className="ps-tabs__sep" aria-hidden="true" />
      <button
        type="button" className="ps-filterchip ps-chip ps-filterchip--plat" aria-pressed={filters.platinum}
        aria-label={platinumCount !== null ? `Платина: ${formatNumber(platinumCount)}` : 'Платина'}
        disabled={platinumCount === 0 && !filters.platinum} title={platinumCount === 0 ? 'Платин пока нет' : undefined}
        onClick={() => onChange({ platinum: !filters.platinum })}
      >
        <PlatinumIcon size={16} className="ps-filterchip__plat" />
        <span className="ps-filterchip__t">Платина</span>
        {platinumCount !== null ? <span className="ps-filterchip__n num">{formatNumber(platinumCount)}</span> : <span className="ps-filterchip__n num" style={{ display: 'inline-block', width: '2ch' }} aria-hidden="true" />}
      </button>
    </div>
  );
}

/** Десктоп и планшет (768+): одна панель фильтров. Мобильный рендерит `MobileSearch` над hero и `MobileChips` под ним (§8.3). */
export function FilterBar(p: BarProps) {
  const { filters, view, counts, platinumCount, onChange, onView, onReset, selectMode, onSelect, canSelect, onHidden } = p;
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
        <StatusChips filters={filters} counts={counts} platinumCount={platinumCount} onChange={onChange} />
        <PlatformSelect filters={filters} platformCounts={p.platformCounts} onChange={onChange} />
        <SortSelect f={filters} onChange={onChange} />
        <ViewSeg view={view} onView={onView} />
        {selectBtn}
        {active && !p.empty && <button type="button" className="ps-link" onClick={onReset}>Сбросить</button>}
        <CollectionMenu hidden={filters.hidden} onHidden={onHidden} />
      </div>
    </div>
  );
}

/** Мобильный слот 1 (D-P1): поле поиска. Открывается кнопкой с лупой в шапке, видно, пока открыто или есть запрос. */
export function MobileSearch(p: BarProps & { autoFocus?: boolean; onClose: () => void }) {
  const { filters, onChange, onClose } = p;
  const commit = useCallback((q: string) => onChange({ q }), [onChange]);
  return (
    <div className="ps-filters ps-filters--search">
      <div className="ps-filters__srow">
        <SearchBox value={filters.q} onCommit={commit} autoFocus={p.autoFocus} onEscape={filters.q ? undefined : onClose} />
        {!filters.q && (
          <button type="button" className="ps-btn ps-btn--ghost ps-filters__sclose" onClick={onClose}>Отмена</button>
        )}
      </div>
    </div>
  );
}

/** F4: выбор платформы. Десктоп: select фиксированной ширины (место есть всегда, без сдвига); варианты по сводке. */
function PlatformSelect({ filters, platformCounts, onChange }: Pick<BarProps, 'filters' | 'platformCounts' | 'onChange'>) {
  const opts = platformChoices(platformCounts, filters.platform);
  return (
    <label className="ps-select ps-select--plat" data-active={filters.platform ? true : undefined}>
      <span className="ps-sr">Платформа</span>
      <select
        value={filters.platform ?? ''} disabled={opts.length === 0 && !filters.platform} data-testid="platform-select"
        onChange={(e) => onChange({ platform: parsePlatform(e.target.value) })}
      >
        <option value="">Все платформы</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}{o.n ? ` · ${formatNumber(o.n)}` : ''}</option>)}
      </select>
      <Icon name="chevron-down" size={14} />
    </label>
  );
}

/** F4, мобильный sheet «Фильтры»: сегмент платформ (только если вариантов больше одного или платформа выбрана). */
function PlatformSeg({ filters, platformCounts, onChange }: Pick<BarProps, 'filters' | 'platformCounts' | 'onChange'>) {
  const opts = platformChoices(platformCounts, filters.platform);
  if (opts.length === 0) return null;
  return (
    <div className="ps-stack ps-stack--tight">
      <span className="ps-label">Платформа</span>
      <div className="ps-seg" role="group" aria-label="Платформа" data-testid="platform-seg">
        <button type="button" aria-pressed={!filters.platform} onClick={() => onChange({ platform: null })}>Все</button>
        {opts.map((o) => <button key={o.id} type="button" aria-pressed={filters.platform === o.id} onClick={() => onChange({ platform: o.id })}>{o.label}</button>)}
      </div>
    </div>
  );
}

/** Мобильный слот 2: кнопка «Фильтры» (sheet: платформа, сортировка, вид, выбор игр, действия с коллекцией) и чипы статусов. */
export function MobileChips(p: BarProps) {
  const { filters, view, onChange, onView, onReset, selectMode, onSelect, canSelect, onHidden } = p;
  const [sheet, setSheet] = useState(false);
  const active = hasActiveFilters(filters);
  const dot = filtersDot(filters, view);
  return (
    <div className="ps-filters ps-filters--chips">
      <button
        type="button" className="ps-btn ps-btn--filters ps-btn--fsheet" data-tour="filters-btn" onClick={() => setSheet(true)} aria-haspopup="dialog"
        aria-label={dot ? 'Фильтры и сортировка (есть изменения)' : 'Фильтры и сортировка'} data-active={dot || undefined}
      >
        <Icon name="sliders-h" size={20} />
        {dot && <span className="ps-notify-dot" aria-hidden="true" />}
      </button>
      {filters.platform && (
        <button
          type="button" className="ps-filterchip ps-chip ps-filterchip--platx" aria-pressed="true" data-testid="platform-chip"
          aria-label={`Платформа ${PLATFORM_KEY_LABEL[filters.platform]}: показать все`} onClick={() => onChange({ platform: null })}
        >
          <span className="ps-filterchip__t">{PLATFORM_KEY_LABEL[filters.platform]}</span><Icon name="x" size={14} />
        </button>
      )}
      <StatusChips filters={filters} counts={p.counts} platinumCount={p.platinumCount} onChange={onChange} />
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Фильтры">
        <div className="ps-stack">
          <PlatformSeg filters={filters} platformCounts={p.platformCounts} onChange={onChange} />
          <SortSelect f={filters} onChange={onChange} />
          <ViewSeg view={view} onView={onView} />
          {active && <button type="button" className="ps-link" onClick={() => { onReset(); setSheet(false); }}>Сбросить фильтры</button>}
          <div role="menu" aria-label="Коллекция" className="ps-list ps-filters__coll">
            <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall" disabled={!canSelect && !selectMode} onClick={() => { setSheet(false); onSelect(); }}>
              <Icon name="check-circle" size={16} /><span className="ps-menu-item__label">{selectMode ? 'Готово' : 'Выбрать игры'}</span>
            </button>
            <CollectionMenuItems hidden={filters.hidden} onHidden={onHidden} close={() => setSheet(false)} />
          </div>
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => setSheet(false)}>Готово</button>
        </div>
      </Sheet>
    </div>
  );
}
