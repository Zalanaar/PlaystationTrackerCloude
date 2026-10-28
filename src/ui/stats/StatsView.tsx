'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameItem, GameStatusValue } from '@/server/collection/types';
import type { StatsGenreGame, StatsResponse } from '@/server/stats/types';
import { ApiError, errorText, fetchStats, patchStatusDate, putHidden, putStatus } from '../collection/api';
import { type GameActions } from '../collection/GameCard';
import { GameDialog, type GameStub } from '../collection/GameDialog';
import { EmptyState } from '../EmptyState';
import { formatNumber, plural } from '../format';
import { Icon, StatusGlyph } from '../icons';
import { useNow } from '../primitives/hooks';
import { useToast } from '../primitives/Toast';
import { GenreRow } from './GenrePopover';
import { PlayedBlock } from './PlayedBlock';
import { TopGames, TopSkeleton } from './TopGames';
import {
  type HoursBar, barsHaveEstimate, estimateNote, genreBars, highlightedMonth, hoursBars, isEmptyPeriod, linePath, linePoints, MONTH_LABELS, formatHours, parseSelection, periodLabel,
  selectionKey, selectionToParams, setPeriodType, shiftSelection, todayMsk, type PeriodType, type Selection,
} from './model';

type Loaded = { key: string; data: StatsResponse } | { key: string; error: unknown };

export function StatsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const now = useNow();
  const today = useMemo(() => todayMsk(now), [now]);
  const sel = useMemo(() => parseSelection(params, today), [params, today]);
  const key = selectionKey(sel);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [years, setYears] = useState<number[]>([]);
  /** Окно игры: полный GameItem, если он известен, иначе заглушка (открытие из поповера жанров) */
  const [open, setOpen] = useState<{ id: number; game: GameItem | null; stub: GameStub | null } | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async (s: Selection, k: string) => {
    const id = ++reqId.current;
    try {
      const data = await fetchStats(selectionToParams(s));
      if (id !== reqId.current) return;
      setYears(data.years);
      setLoaded({ key: k, data });
    } catch (e) {
      if (id !== reqId.current) return;
      if (e instanceof ApiError && e.status === 401) return;
      setLoaded({ key: k, error: e });
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(sel, key), 0);
    return () => clearTimeout(t);
  }, [load, sel, key]);

  const go = (s: Selection | null) => {
    if (s) router.push(`${pathname}?${selectionToParams(s).toString()}`, { scroll: false });
  };
  const prev = shiftSelection(sel, -1, years, today);
  const next = shiftSelection(sel, 1, years, today);

  const fresh = loaded && loaded.key === key ? loaded : null;
  const stale = loaded && loaded.key !== key && 'data' in loaded ? loaded.data : null;
  const data = fresh && 'data' in fresh ? fresh.data : stale;
  const failed = fresh && 'error' in fresh ? fresh.error : null;
  const loading = !fresh;

  // ---------- действия над карточками игр периода ----------
  const reload = useCallback(() => void load(sel, key), [load, sel, key]);
  /** Вернуть прошлый статус и его ручную дату (правило 1.3 иначе возьмёт дату последнего запуска). */
  const revert = useCallback(async (prev: GameItem) => {
    try {
      await putStatus(prev.id, prev.status);
      const date = prev.status === 'completed' ? prev.completedAt : prev.status === 'dropped' ? prev.droppedAt : null;
      if (date && (prev.status === 'completed' || prev.status === 'dropped')) await patchStatusDate(prev.id, prev.status, date);
      toast({ text: 'Статус возвращён' });
    } catch (e) {
      toast({ kind: 'error', text: `Не удалось вернуть статус. ${errorText(e)}` });
    }
    reload();
  }, [reload, toast]);
  const setStatus = useCallback(async (g: GameItem, status: GameStatusValue | null) => {
    if (g.status === status) return;
    try {
      const r = await putStatus(g.id, status);
      setOpen((o) => (o && o.id === g.id ? { ...o, game: r.game } : o));
      toast({ text: status === null ? 'Статус сброшен' : 'Статус изменён', action: { label: 'Отменить', run: () => void revert(g) } });
      reload();
    } catch (e) {
      toast({ kind: 'error', text: `Не удалось сменить статус. ${errorText(e)}` });
    }
  }, [reload, revert, toast]);
  const unhide = useCallback(async (g: GameItem) => {
    try {
      const r = await putHidden(g.id, false);
      setOpen((o) => (o && o.id === g.id ? { ...o, game: r.game } : o));
      toast({ text: `«${g.title}» возвращена в коллекцию` });
    } catch (e) {
      toast({ kind: 'error', text: `Не удалось вернуть игру. ${errorText(e)}` });
    }
    reload();
  }, [reload, toast]);
  const setHidden = useCallback(async (g: GameItem, hidden: boolean) => {
    if (!hidden) return void unhide(g);
    try {
      await putHidden(g.id, true);
      setOpen(null);
      toast({ text: `«${g.title}» убрана из коллекции`, action: { label: 'Вернуть', run: () => void unhide(g) } });
      reload();
    } catch (e) {
      toast({ kind: 'error', text: `Не удалось убрать игру. ${errorText(e)}` });
    }
  }, [reload, toast, unhide]);
  const setDate = useCallback(async (g: GameItem, kind: 'completed' | 'dropped', iso: string) => {
    try {
      const r = await patchStatusDate(g.id, kind, iso);
      setOpen((o) => (o && o.id === g.id ? { ...o, game: r.game } : o));
      toast({ text: 'Дата завершения сохранена' });
      reload();
    } catch (e) {
      toast({ kind: 'error', text: `Не удалось сохранить дату. ${errorText(e)}` });
    }
  }, [reload, toast]);
  const actions: GameActions = useMemo(() => ({
    open: (g) => setOpen({ id: g.id, game: g, stub: null }),
    setStatus: (g, s) => void setStatus(g, s),
    toggle: () => {},
  }), [setStatus]);

  const openGame = useCallback((g: GameItem) => setOpen({ id: g.id, game: g, stub: null }), []);
  const openStub = useCallback((g: StatsGenreGame) => setOpen({ id: g.id, game: null, stub: { id: g.id, title: g.title, coverUrl: g.coverUrl } }), []);
  const dialogGame = open
    ? (data?.played.groups.flatMap((g) => g.items).find((i) => i.game.id === open.id)?.game ?? open.game)
    : null;

  return (
    <div className="ps-stats-page">
      <div className="ps-pagehead">
        <h1 className="ps-h1">Статистика</h1>
      </div>
      <PeriodSwitch
        sel={sel} today={today} onType={(p) => go(setPeriodType(sel, p, today))}
        onPrev={prev ? () => go(prev) : null} onNext={next ? () => go(next) : null}
      />
      {failed ? (
        <EmptyState icon="circle-alert" role="alert" title="Что-то пошло не так" text={`Не удалось загрузить статистику. ${errorText(failed)}`}>
          <button type="button" className="ps-btn ps-btn--primary" onClick={reload}>Повторить</button>
        </EmptyState>
      ) : !data ? (
        <StatsSkeleton />
      ) : (
        <div className="ps-st" aria-busy={loading || undefined} data-stale={loading || undefined}>
          <Content data={data} sel={sel} today={today} actions={actions} onOpenGame={openGame} onOpenStub={openStub} onChanged={reload} />
        </div>
      )}
      <GameDialog
        game={dialogGame} stub={open?.stub ?? null} startEditing={false} now={now} onClose={() => setOpen(null)}
        onLoaded={(g) => setOpen((o) => (o && o.id === g.id && !o.game ? { ...o, game: g } : o))}
        onStatus={(g, s) => void setStatus(g, s)} onDate={(g, k, iso) => void setDate(g, k, iso)}
        onHidden={(g, h) => void setHidden(g, h)}
      />
    </div>
  );
}

function PeriodSwitch({
  sel, today, onType, onPrev, onNext,
}: { sel: Selection; today: { year: number; month: number }; onType: (p: PeriodType) => void; onPrev: (() => void) | null; onNext: (() => void) | null }) {
  const unit = sel.period === 'year' ? 'год' : 'месяц';
  return (
    <div className="ps-st-switch">
      <div className="ps-seg" role="group" aria-label="Период">
        <button type="button" aria-pressed={sel.period === 'year'} onClick={() => onType('year')}>Год</button>
        <button type="button" aria-pressed={sel.period === 'month'} onClick={() => onType('month')}>Месяц</button>
      </div>
      <div className="ps-st-nav" role="group" aria-label="Выбор периода">
        <button type="button" className="ps-iconbtn" aria-label={`Предыдущий ${unit}`} disabled={!onPrev} onClick={() => onPrev?.()}><span aria-hidden="true">‹</span></button>
        <span className="ps-st-nav__label ps-num" aria-live="polite" data-today={sel.year === today.year || undefined}>{periodLabel(sel)}</span>
        <button type="button" className="ps-iconbtn" aria-label={`Следующий ${unit}`} disabled={!onNext} onClick={() => onNext?.()}><span aria-hidden="true">›</span></button>
      </div>
    </div>
  );
}

function Content({
  data, sel, today, actions, onOpenGame, onOpenStub, onChanged,
}: {
  data: StatsResponse; sel: Selection; today: { year: number; month: number }; actions: GameActions;
  onOpenGame: (g: GameItem) => void; onOpenStub: (g: StatsGenreGame) => void; onChanged: () => void;
}) {
  const empty = isEmptyPeriod(data, sel.period);
  return (
    <>
      <PeriodHeader data={data} sel={sel} />
      {data.hours.hasEstimate && (
        <p className="ps-st-note" role="note"><Icon name="info" size={14} /><span>{estimateNote(data.hours.firstSnapshotDate)}</span></p>
      )}
      {empty ? (
        <EmptyState icon="bar-chart" title="За этот период ничего нет" text="Нет часов, трофеев и завершённых игр. Выбери другой период." />
      ) : (
        <>
          <div className="ps-st-grid">
            <HoursPanel data={data} sel={sel} today={today} wide={!data.genres.hasData} />
            {data.genres.hasData && <GenresPanel data={data} onOpenGame={onOpenStub} />}
          </div>
          <TopGames top={data.top} onOpen={onOpenGame} />
          <TrophiesPanel data={data} sel={sel} />
          <PlayedBlock data={data} sel={sel} actions={actions} onChanged={onChanged} />
        </>
      )}
    </>
  );
}

function PeriodHeader({ data, sel }: { data: StatsResponse; sel: Selection }) {
  const h = data.header;
  const scope = sel.period === 'year' ? 'за год' : 'за месяц';
  return (
    <header className="ps-year ps-st-head">
      <div className="ps-year__btn" data-expanded="true">
        <h2 className="ps-year__y ps-st-head__y">{periodLabel(sel)}</h2>
        <span className="ps-year__k"><StatusGlyph status="completed" size={16} />пройдено <b className="num">{formatNumber(h.completed)}</b></span>
        <span className="ps-year__k"><StatusGlyph status="dropped" size={16} />брошено <b className="num">{formatNumber(h.dropped)}</b></span>
        <span className="ps-year__k">
          {h.hours === null
            ? <span title="Нет данных о часах за этот период"><b className="num">— ч</b><span className="ps-year__more"> {scope}</span></span>
            : data.hours.estimatedHours > 0
              ? (
                <span title="Часть часов оценена" aria-label={`Примерно ${formatHours(h.hours)} ч ${scope}. Часть часов оценена`}>
                  <b className="num"><span className="ps-approx" aria-hidden="true">≈</span> {formatHours(h.hours)} ч</b><span className="ps-year__more"> {scope}</span>
                </span>
              )
              : <><b className="num">{formatHours(h.hours)} ч</b><span className="ps-year__more"> {scope}</span></>}
        </span>
        <span className="ps-year__k"><Icon name="trophy" size={16} /><b className="num">{formatNumber(h.platinum)}</b> {plural(h.platinum, ['платина', 'платины', 'платин'])}</span>
      </div>
    </header>
  );
}

function Panel({ title, sub, className, labelId, aside, children }: { title: string; sub?: string; className?: string; labelId: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`ps-panel ps-st-panel ${className ?? ''}`} aria-labelledby={labelId}>
      <h3 className="ps-st-panel__t" id={labelId}>{title}</h3>
      {sub && <p className="ps-st-panel__s">{sub}</p>}
      {aside}
      {children}
    </section>
  );
}

function HoursPanel({ data, sel, today, wide }: { data: StatsResponse; sel: Selection; today: { year: number; month: number }; wide: boolean }) {
  const bars = useMemo(() => hoursBars(data.hours.byMonth, data.hours.estimatedByMonth, sel.year), [data.hours.byMonth, data.hours.estimatedByMonth, sel.year]);
  const showLegend = data.hours.hasEstimate || barsHaveEstimate(bars);
  const hl = highlightedMonth(sel, today);
  const [active, setActive] = useState<number | null>(null);
  // Закреплённая кликом/тапом подсказка: не закрывается уходом курсора, закрывается повторным тапом, тапом вне или Escape.
  const [pinned, setPinned] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (groupRef.current && e.target instanceof Node && groupRef.current.contains(e.target)) return;
      setPinned(false);
      setActive(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [pinned]);
  const close = () => { setPinned(false); setActive(null); };
  return (
    <Panel
      title="Часы по месяцам" sub={`Выбранный год: ${sel.year}. Часы игр за месяц`} labelId="st-hours"
      className={wide ? 'ps-st-panel--hours-wide' : 'ps-st-panel--hours'}
      aside={showLegend ? <HoursLegend /> : undefined}
    >
      <div className="ps-st-bars" ref={groupRef} role="group" aria-label={`Часы по месяцам, ${sel.year}`} onMouseLeave={() => { if (!pinned) setActive(null); }}>
        {bars.map((b, i) => (
          <button
            key={b.month} type="button" className="ps-st-bar" aria-label={b.text} data-nodata={b.value === null || undefined}
            data-cur={hl === b.month || undefined} data-active={active === i || undefined} data-est={b.estimated > 0 || undefined}
            onMouseEnter={() => { if (!pinned) setActive(i); }} onFocus={() => { if (!pinned) setActive(i); }}
            onBlur={() => { if (!pinned) setActive((a) => (a === i ? null : a)); }}
            onClick={() => { if (pinned && active === i) close(); else { setPinned(true); setActive(i); } }}
            onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
          >
            <span className="ps-st-bar__col">
              {b.heightPct > 0 && (
                <span className="ps-st-bar__stack" style={{ height: `${b.heightPct}%` }}>
                  {b.estimated > 0 && <span className="ps-st-bar__est" style={{ flexGrow: 100 - b.realShare }} />}
                  {b.real > 0 && <span className="ps-st-bar__fill" style={{ flexGrow: b.realShare }} />}
                </span>
              )}
            </span>
            {active === i && <BarTip bar={b} />}
            <span className="ps-st-bar__lbl" aria-hidden="true">{b.label}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function HoursLegend() {
  return (
    <ul className="ps-st-legend" aria-label="Обозначения">
      <li><i className="ps-st-sw ps-st-sw--real" aria-hidden="true" />Измерено</li>
      <li><i className="ps-st-sw ps-st-sw--est" aria-hidden="true" />Оценка</li>
    </ul>
  );
}

/** Подсказка столбца (§4.11): месяц, всего, затем измеренная и оценочная части; нулевая часть не выводится. */
function BarTip({ bar }: { bar: HoursBar }) {
  const ref = useRef<HTMLSpanElement>(null);
  // Прижимаем подсказку к границам вьюпорта (десктоп не затрагивается: сдвиг 0, если помещается).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.translate = '';
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const m = 8;
    const dx = r.right > vw - m ? vw - m - r.right : r.left < m ? m - r.left : 0;
    if (dx) el.style.translate = `${dx}px 0`;
  });
  if (bar.value === null) return <span ref={ref} className="ps-st-tip ps-num" role="tooltip"><b>{bar.title}</b><span>нет данных</span></span>;
  return (
    <span ref={ref} className="ps-st-tip ps-num" role="tooltip">
      <b>{bar.title}</b>
      <span><b>{formatHours(bar.value)} ч</b> всего</span>
      {bar.real > 0 && <span><i className="ps-st-sw ps-st-sw--real" aria-hidden="true" />Измерено: {formatHours(bar.real)} ч</span>}
      {bar.estimated > 0 && <span><i className="ps-st-sw ps-st-sw--est" aria-hidden="true" />Оценка: {formatHours(bar.estimated)} ч</span>}
    </span>
  );
}

function GenresPanel({ data, onOpenGame }: { data: StatsResponse; onOpenGame: (g: StatsGenreGame) => void }) {
  const bars = genreBars(data.genres.items);
  return (
    <Panel title="Жанры" sub="Игра делится между своими жанрами поровну" labelId="st-genres" className="ps-st-panel--genres">
      <ul className="ps-st-genres">
        {bars.map((g) => <GenreRow key={g.key} bar={g} games={data.genres.games} onOpenGame={onOpenGame} />)}
      </ul>
    </Panel>
  );
}

const TROPHY_KINDS = [
  { id: 'platinum', label: 'Платина' }, { id: 'gold', label: 'Золото' }, { id: 'silver', label: 'Серебро' }, { id: 'bronze', label: 'Бронза' },
] as const;
const LINE_W = 600;
const LINE_H = 120;

function TrophiesPanel({ data, sel }: { data: StatsResponse; sel: Selection }) {
  const c = data.trophies.counts;
  const points = useMemo(() => linePoints(data.trophies.byMonth.map((m) => m.total), LINE_W, LINE_H, 10), [data.trophies.byMonth]);
  const hasLine = data.trophies.byMonth.some((m) => m.total > 0);
  return (
    <Panel title="Трофеи" sub={`Получено за период: ${formatNumber(c.total)}`} labelId="st-trophies" className="ps-st-panel--wide">
      <ul className="ps-st-troph">
        {TROPHY_KINDS.map((k) => (
          <li key={k.id} data-kind={k.id} aria-label={`${k.label}: ${formatNumber(c[k.id])}`}>
            <Icon name="trophy" size={22} />
            <span className="ps-st-troph__v ps-num">{formatNumber(c[k.id])}</span>
            <span className="ps-st-troph__l">{k.label}</span>
          </li>
        ))}
      </ul>
      {hasLine && (
        <div className="ps-st-line">
          <svg viewBox={`0 0 ${LINE_W} ${LINE_H}`} role="img" aria-label={`Трофеи по месяцам, ${sel.year}: ${data.trophies.byMonth.map((m) => `${MONTH_LABELS[m.month - 1]} ${m.total}`).join(', ')}`} preserveAspectRatio="none">
            <line className="ps-st-line__axis" x1="0" x2={LINE_W} y1={LINE_H - 10} y2={LINE_H - 10} vectorEffect="non-scaling-stroke" />
            <path className="ps-st-line__path" d={linePath(points)} vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="ps-st-line__pts" aria-hidden="true">
            {points.map((p) => (
              <span key={p.month} className="ps-st-line__pt" style={{ left: `${(p.x / LINE_W) * 100}%`, top: `${(p.y / LINE_H) * 100}%` }} title={`${MONTH_LABELS[p.month - 1]}: ${p.value}`} />
            ))}
          </div>
          <div className="ps-st-line__lbls" aria-hidden="true">{MONTH_LABELS.map((m) => <span key={m}>{m}</span>)}</div>
        </div>
      )}
    </Panel>
  );
}

function StatsSkeleton() {
  return (
    <div className="ps-st" aria-busy="true" aria-label="Загрузка статистики">
      <div className="ps-skeleton ps-sk-year" aria-hidden="true" />
      <div className="ps-st-grid" aria-hidden="true">
        <div className="ps-st-panel ps-st-panel--hours"><div className="ps-skeleton ps-st-sk" /></div>
        <div className="ps-st-panel ps-st-panel--genres"><div className="ps-skeleton ps-st-sk" /></div>
      </div>
      <TopSkeleton />
      <div className="ps-st-panel ps-st-panel--wide" aria-hidden="true"><div className="ps-skeleton ps-st-sk ps-st-sk--short" /></div>
    </div>
  );
}
