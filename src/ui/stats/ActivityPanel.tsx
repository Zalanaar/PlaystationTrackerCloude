'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError, errorText, fetchActivity } from '../collection/api';
import { Icon } from '../icons';
import {
  GAPS_HELP, GAPS_NOTE, HEAT_ROW_LABELS, LEGEND_TITLES, activityMode, buildHeat, initialHeatFocus, moveHeatFocus, noYearNote, streakTiles,
  totalsText, unknownNote, yearOf, yearRange, type ActivityData, type HeatCell, type HeatLayout, type StreakTile,
} from './activity';

type Loaded = { year: number; data: ActivityData } | { year: number; error: unknown };

/**
 * «Активность» (п.9): стрик и карта года. Данные грузятся лениво: когда панель подъехала к экрану (IntersectionObserver),
 * отдельным запросом, поэтому страница статистики от него не зависит. Родитель ставит `key={год страницы}`.
 */
export function ActivityPanel({ defaultYear }: { defaultYear: number }) {
  const [year, setYear] = useState(defaultYear);
  const [near, setNear] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { const t = setTimeout(() => setNear(true), 0); return () => clearTimeout(t); }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    const ac = new AbortController();
    fetchActivity(year, ac.signal)
      .then((data) => { if (!ac.signal.aborted) setLoaded({ year, data }); })
      .catch((e: unknown) => {
        if (ac.signal.aborted || (e instanceof ApiError && e.status === 401)) return;
        setLoaded({ year, error: e });
      });
    return () => ac.abort();
  }, [near, year, attempt]);

  const fresh = loaded && loaded.year === year ? loaded : null;
  const data = fresh && 'data' in fresh ? fresh.data : null;
  const failed = fresh && 'error' in fresh ? fresh.error : null;
  const mode = data ? activityMode(data) : null;
  const range = data ? yearRange(data.firstSnapshotDate, data.today) : null;
  const shown = data ?? (loaded && 'data' in loaded ? loaded.data : null);
  const nav = shown ? yearRange(shown.firstSnapshotDate, shown.today) : null;

  return (
    <section ref={root} className="ps-panel ps-st-panel ps-st-panel--wide ps-act" aria-labelledby="st-act" aria-busy={!data && !failed ? true : undefined}>
      <div className="ps-act__head">
        <div>
          <h3 className="ps-st-panel__t" id="st-act">Активность</h3>
          <p className="ps-st-panel__s">Игровые дни по ежедневным снимкам</p>
        </div>
        {nav && mode !== 'empty' && !failed && (
          <div className="ps-st-nav" role="group" aria-label="Год активности">
            <button type="button" className="ps-iconbtn" aria-label="Предыдущий год" disabled={year <= nav.min} onClick={() => setYear((y) => y - 1)}><span aria-hidden="true">‹</span></button>
            <span className="ps-st-nav__label ps-num" aria-live="polite">{year}</span>
            <button type="button" className="ps-iconbtn" aria-label="Следующий год" disabled={year >= nav.max} onClick={() => setYear((y) => y + 1)}><span aria-hidden="true">›</span></button>
          </div>
        )}
      </div>

      {failed ? (
        <div className="ps-act__state" role="alert">
          <Icon name="circle-alert" size={40} />
          <h3 className="ps-act__sh">Не удалось загрузить активность</h3>
          <p>{errorText(failed)}</p>
          <button type="button" className="ps-btn" onClick={() => { setLoaded(null); setAttempt((a) => a + 1); }}>Повторить</button>
        </div>
      ) : !data || !range ? (
        <ActivitySkeleton />
      ) : mode === 'empty' ? (
        <div className="ps-act__state">
          <span className="ps-act__ico"><Icon name="calendar" size={40} /></span>
          <h3 className="ps-act__sh">Пока нет данных об активности</h3>
          <p>Карта заполняется ежедневными снимками. История по дням до первого синка недоступна.</p>
        </div>
      ) : (
        <ActivityBody data={data} mode={mode ?? 'ok'} />
      )}
    </section>
  );
}

function ActivitySkeleton() {
  return (
    <div className="ps-act__sk" aria-hidden="true">
      <div className="ps-act__sk-tiles">{[0, 1, 2].map((i) => <div key={i} className="ps-skeleton ps-act__sk-tile" />)}</div>
      <div className="ps-skeleton ps-act__sk-map" />
    </div>
  );
}

function ActivityBody({ data, mode }: { data: ActivityData; mode: 'ok' | 'noYear' }) {
  const layout = useMemo(() => buildHeat(data.days, data.today, data.firstSnapshotDate), [data]);
  const tiles = streakTiles(data);
  const t = totalsText(data.totals);
  return (
    <>
      <div className="ps-act__top">
        <dl className="ps-streak">{tiles.map((x) => <StreakTileView key={x.id} tile={x} />)}</dl>
        <p className="ps-act__totals">
          <span>Игровых дней <b className="num">{t.days.played}</b> из <b className="num">{t.days.known}</b> известных</span>
          <span>Всего <b className="num">{t.total}</b></span>
        </p>
      </div>
      {mode === 'noYear' && (
        <p className="ps-st-note ps-act__note" role="note"><Icon name="info" size={14} /><span>{noYearNote(data.year, data.firstSnapshotDate)}</span></p>
      )}
      <Heat layout={layout} year={data.year} current={yearOf(data.today) === data.year} />
      <div className="ps-act__legend">
        <p className="ps-act__unknown"><Icon name="info" size={12} /><span>{unknownNote(data.firstSnapshotDate)}</span></p>
        <div className="ps-act__keys" aria-label="Обозначения карты">
          <span>Меньше</span>
          {LEGEND_TITLES.map((title, i) => <i key={title} className="ps-act__sw" data-l={i} title={title} />)}
          <span>Больше</span>
          <span className="ps-act__sep" aria-hidden="true" />
          <i className="ps-act__sw" data-l="u" /><span>Нет данных</span>
        </div>
      </div>
    </>
  );
}

function StreakTileView({ tile }: { tile: StreakTile }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ps-streak__t" data-id={tile.id}>
      <dt>{tile.id === 'current' && <Icon name="flame" size={14} />}<span className="ps-streak__long">{tile.label}</span><span className="ps-streak__short">{tile.labelShort}</span></dt>
      <dd>
        <span className="ps-streak__v ps-num">
          <span className="ps-sr">{tile.aria}</span>
          <span className="ps-streak__long" aria-hidden="true">{tile.value}</span>
          <span className="ps-streak__short" aria-hidden="true">{tile.valueShort}</span>
          {tile.hasGaps && (
            <button type="button" className="ps-streak__help" aria-label="Что значит: есть дни без данных" aria-expanded={open} title={GAPS_HELP} onClick={() => setOpen((o) => !o)}>
              <Icon name="circle-help" size={14} />
            </button>
          )}
        </span>
        <span className="ps-streak__s" title={tile.caption}>{tile.caption}</span>
        {tile.hasGaps && <span className="ps-streak__gaps">{GAPS_NOTE}</span>}
        {open && <span className="ps-streak__pop" role="note">{GAPS_HELP}</span>}
      </dd>
    </div>
  );
}

/** x, y: позиция верха-центра клетки внутри карты; vx: центр клетки в окне (для прижатия к краям экрана) */
type Tip = { index: number; x: number; y: number; vx: number };

function Heat({ layout, year, current }: { layout: HeatLayout; year: number; current: boolean }) {
  const { cells, offset, cols, months } = layout;
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const [focus, setFocus] = useState(() => initialHeatFocus(cells));
  const [tip, setTip] = useState<Tip | null>(null);
  const [pinned, setPinned] = useState(false);
  const [edge, setEdge] = useState({ l: false, r: false });

  const measure = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    setEdge({ l: el.scrollLeft > 1, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
  }, []);

  // открывается на конце года (видны последние недели) для текущего года, иначе в начале
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    el.scrollLeft = current ? el.scrollWidth : 0;
    measure();
  }, [current, year, cols, measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const show = (i: number) => {
    const r = refs.current[i]?.getBoundingClientRect();
    const b = box.current?.getBoundingClientRect();
    if (r && b) setTip({ index: i, x: r.left + r.width / 2 - b.left, y: r.top - b.top, vx: r.left + r.width / 2 });
  };
  const hide = () => { setTip(null); setPinned(false); };

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => { if (!(e.target instanceof Element) || !e.target.closest('.ps-heat__c')) hide(); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [pinned]);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'Escape') { hide(); return; }
    const n = moveHeatFocus(i, e.key, offset, cells.length);
    if (n === null) return;
    e.preventDefault();
    setFocus(n);
    refs.current[n]?.focus();
  };

  const rows = Array.from({ length: 7 }, (_, r) => r);
  const at = (r: number, c: number): number => c * 7 + r - offset;
  const step = 'calc(var(--cell) + var(--heat-gap))';

  return (
    <div ref={box} className="ps-heat" data-edge-l={edge.l || undefined} data-edge-r={edge.r || undefined}>
      <div className="ps-heat__wd" aria-hidden="true">
        {HEAT_ROW_LABELS.map((l, i) => <span key={i}>{l}</span>)}
      </div>
      <div className="ps-heat__scroll" ref={wrap} onScroll={() => { measure(); if (tip) show(tip.index); }}>
        <div className="ps-heat__inner" style={{ ['--cols' as string]: cols }}>
          <div className="ps-heat__months" aria-hidden="true" style={{ width: `calc(${cols} * ${step} - var(--heat-gap))` }}>
            {months.map((m) => <span key={m.col + m.label} style={{ left: `calc(${m.col} * ${step})` }}>{m.label}</span>)}
          </div>
          <div className="ps-heat__cells" role="grid" aria-label={`Активность по дням, ${year}`} aria-rowcount={7} aria-colcount={cols}>
            {rows.map((r) => (
              <div key={r} role="row" className="ps-heat__row">
                {Array.from({ length: cols }, (_, c) => {
                  const i = at(r, c);
                  const cell: HeatCell | undefined = cells[i];
                  if (!cell) return <span key={c} className="ps-heat__c" data-l="x" aria-hidden="true" />;
                  return (
                    <div
                      key={c} ref={(el) => { refs.current[i] = el; }} role="gridcell" className="ps-heat__c" data-l={cell.level === 'unknown' ? 'u' : cell.level === 'future' ? 'f' : cell.level}
                      data-today={cell.isToday || undefined} aria-label={cell.aria} tabIndex={i === focus ? 0 : -1}
                      onMouseEnter={() => { if (!pinned) show(i); }} onMouseLeave={() => { if (!pinned) setTip(null); }}
                      onFocus={() => { setFocus(i); if (!pinned) show(i); }} onBlur={() => { if (!pinned) setTip(null); }}
                      onClick={() => { if (pinned && tip?.index === i) hide(); else { setPinned(true); show(i); } }}
                      onKeyDown={(e) => onKey(e, i)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {tip && cells[tip.index] && <HeatTip cell={cells[tip.index]} x={tip.x} y={tip.y} vx={tip.vx} />}
    </div>
  );
}

function HeatTip({ cell, x, y, vx }: { cell: HeatCell; x: number; y: number; vx: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const vw = document.documentElement.clientWidth;
    const left = vx - w / 2;
    setDx(left < 8 ? 8 - left : left + w > vw - 8 ? vw - 8 - (left + w) : 0);
  }, [vx, cell.date]);
  return (
    <div ref={ref} className="ps-heat__tip" role="tooltip" style={{ left: x + dx, top: y }}>
      <b>{cell.title}</b>
      <span>{cell.detail}</span>
    </div>
  );
}
